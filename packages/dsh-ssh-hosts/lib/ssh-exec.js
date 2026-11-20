/**
 * Local SSH process plumbing for the ssh-hosts plugin.
 *
 * Every child process is spawned with an argument vector and no local shell, so
 * host aliases, paths and commands never pass through `sh -c` on this machine.
 * The remote command string is intentionally executed by the remote login
 * shell: that is how `ssh host 'command'` works.
 *
 * @module @local/dsh-ssh-hosts/lib/ssh-exec
 */

import { spawn } from 'node:child_process'

/** Quote one token for a POSIX remote shell. */
export function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'\\''`)}'`
}

/**
 * Build the single command string OpenSSH hands to the remote user's shell.
 * A workdir is entered first, in the same non-interactive shell.
 *
 * `~` is expanded by the remote login shell, but quoting the whole path would
 * suppress that expansion; `"$HOME"` is used so paths such as `~/project`
 * still work without exposing the rest of the path to the shell.
 */
export function buildRemoteCommand(command, workdir) {
  if (workdir === undefined || workdir === null || String(workdir).length === 0) return command
  const value = String(workdir)
  let target
  if (value === '~') {
    target = '"$HOME"'
  } else if (value.startsWith('~/')) {
    const rest = value.slice(2)
    target = rest.length === 0 ? '"$HOME"' : `"$HOME"/${shellQuote(rest)}`
  } else {
    target = shellQuote(value)
  }
  return `cd ${target} && ${command}`
}

/** Kill the direct child and, on POSIX, everything in its process group. */
function killTree(child) {
  if (child?.pid === undefined) return
  if (process.platform !== 'win32') {
    try {
      process.kill(-child.pid, 'SIGKILL')
      return
    } catch {
      // Fall back to the single-process kill.
    }
  }
  try { child.kill('SIGKILL') } catch { /* already gone */ }
}

/**
 * One captured non-interactive run.
 *
 * The child is detached into its own process group so a timeout can kill
 * grandchildren too. Even then a grandchild may keep the stdio pipes open, so
 * a short grace timer settles the promise from the bytes already collected
 * instead of hanging a host-config reload forever.
 */
function capture(binary, args, timeoutMs) {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn(binary, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: process.env,
        detached: process.platform !== 'win32',
      })
    } catch (error) {
      resolve({ code: undefined, stdout: '', stderr: String(error), error })
      return
    }
    let stdout = ''
    let stderr = ''
    let settled = false
    let timer
    let grace
    const finish = (code, error) => {
      if (settled) return
      settled = true
      if (timer !== undefined) clearTimeout(timer)
      if (grace !== undefined) clearTimeout(grace)
      child.stdout?.destroy()
      child.stderr?.destroy()
      resolve({ code, stdout, stderr, error })
    }
    timer = setTimeout(() => {
      killTree(child)
      grace = setTimeout(() => finish(undefined), 500)
    }, Math.max(250, timeoutMs))
    child.stdout?.on('data', (chunk) => { stdout += String(chunk) })
    child.stderr?.on('data', (chunk) => { stderr += String(chunk) })
    child.on('error', (error) => finish(undefined, error))
    child.on('close', (code) => finish(typeof code === 'number' ? code : undefined))
  })
}

/**
 * Run `ssh -G <alias>`: OpenSSH resolves the complete effective configuration
 * without opening a connection. Returns the effective scalar fields.
 *
 * @param {object} options
 * @param {string} options.sshBinary
 * @param {string} options.configPath
 * @param {string} options.alias
 * @param {number} [options.timeoutMs]
 * @returns {Promise<Record<string, string | string[]>>}
 */
export async function resolveSshConfig(options) {
  const result = await capture(
    options.sshBinary,
    ['-F', options.configPath, '-G', options.alias],
    options.timeoutMs ?? 4000,
  )
  const effective = {}
  if (result.code !== 0) return effective
  for (const line of result.stdout.split(/\r?\n/)) {
    const split = line.indexOf(' ')
    if (split <= 0) continue
    const key = line.slice(0, split).toLowerCase()
    const value = line.slice(split + 1).trim()
    if (value.length === 0) continue
    if (key === 'identityfile') {
      if (!Array.isArray(effective.identityFiles)) effective.identityFiles = []
      effective.identityFiles.push(value)
      continue
    }
    if (key === 'user' || key === 'hostname' || key === 'port' || key === 'proxyjump') {
      if (effective[key] === undefined) effective[key] = value
    }
  }
  return effective
}

/**
 * Run one command on a remote host through the system OpenSSH client.
 *
 * @param {object} options
 * @param {string} options.sshBinary
 * @param {string} options.configPath
 * @param {string} options.alias
 * @param {string} options.command
 * @param {string | undefined} options.workdir
 * @param {number} options.timeoutMs
 * @param {number} options.connectTimeoutSeconds
 * @param {number} options.maxOutputBytes
 * @param {AbortSignal | undefined} options.signal
 * @returns {Promise<{
 *   exitCode: number | undefined,
 *   exitSignal: string | undefined,
 *   stdout: string,
 *   stderr: string,
 *   timedOut: boolean,
 *   aborted: boolean,
 *   spawnError: string | undefined,
 *   durationMs: number,
 *   stdoutTruncated: boolean,
 *   stderrTruncated: boolean,
 * }>}
 */
export function runRemoteCommand(options) {
  const startedAt = Date.now()
  const {
    sshBinary = 'ssh',
    configPath,
    alias,
    command,
    workdir,
    timeoutMs = 120_000,
    connectTimeoutSeconds = 10,
    maxOutputBytes = 128 * 1024,
    signal,
  } = options

  const args = [
    '-F', configPath,
    '-T',
    '-o', 'BatchMode=yes',
    '-o', `ConnectTimeout=${Math.max(1, Math.floor(connectTimeoutSeconds))}`,
    '-o', 'ServerAliveInterval=15',
    '-o', 'ServerAliveCountMax=2',
    alias,
    buildRemoteCommand(command, workdir),
  ]

  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let stdoutTruncated = false
    let stderrTruncated = false
    let timedOut = false
    let aborted = false
    let settled = false
    let child
    let timer
    let grace
    let onAbort = () => {}

    const finish = (exitCode, exitSignal, spawnError) => {
      if (settled) return
      settled = true
      if (timer !== undefined) clearTimeout(timer)
      if (grace !== undefined) clearTimeout(grace)
      signal?.removeEventListener('abort', onAbort)
      child?.stdout?.destroy()
      child?.stderr?.destroy()
      resolve({
        exitCode,
        exitSignal,
        stdout,
        stderr,
        timedOut,
        aborted,
        spawnError,
        durationMs: Date.now() - startedAt,
        stdoutTruncated,
        stderrTruncated,
      })
    }

    if (signal?.aborted) {
      resolve({
        exitCode: undefined,
        exitSignal: undefined,
        stdout: '',
        stderr: '',
        timedOut: false,
        aborted: true,
        spawnError: undefined,
        durationMs: 0,
        stdoutTruncated: false,
        stderrTruncated: false,
      })
      return
    }

    const kill = () => {
      killTree(child)
      // A descendant that escaped the process group can keep the pipes open;
      // settle from the output collected so far rather than hanging the tool.
      if (grace === undefined && !settled) {
        grace = setTimeout(() => finish(undefined, undefined, undefined), 1_000)
      }
    }
    onAbort = () => {
      aborted = true
      kill()
    }

    try {
      child = spawn(sshBinary, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: process.env,
        // A process group lets a timeout or cancellation take the whole local
        // ssh tree down; otherwise a child holding the pipes open can delay
        // settlement past the deadline.
        detached: process.platform !== 'win32',
      })
    } catch (error) {
      finish(undefined, undefined, String(error))
      return
    }

    timer = setTimeout(() => {
      timedOut = true
      kill()
    }, Math.max(1000, Math.floor(timeoutMs)))

    signal?.addEventListener('abort', onAbort, { once: true })
    // An abort between the early check above and listener registration would
    // otherwise be lost, leaving the ssh child running until its timeout.
    if (signal?.aborted) onAbort()

    const append = (which, chunk) => {
      const text = String(chunk)
      if (which === 'stdout') {
        stdout += text
        if (stdout.length > maxOutputBytes) {
          stdout = stdout.slice(-maxOutputBytes)
          stdoutTruncated = true
        }
      } else {
        stderr += text
        if (stderr.length > maxOutputBytes) {
          stderr = stderr.slice(-maxOutputBytes)
          stderrTruncated = true
        }
      }
    }

    child.stdout?.on('data', (chunk) => append('stdout', chunk))
    child.stderr?.on('data', (chunk) => append('stderr', chunk))
    child.on('error', (error) => finish(undefined, undefined, String(error)))
    child.on('close', (code, exitSignal) => finish(
      typeof code === 'number' ? code : undefined,
      exitSignal === null || exitSignal === undefined ? undefined : String(exitSignal),
      undefined,
    ))
  })
}
