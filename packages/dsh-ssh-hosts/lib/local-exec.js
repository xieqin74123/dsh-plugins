/**
 * Local shell plumbing for the ssh-hosts target service.
 *
 * The environment selector needs to run the same discovery command on
 * `localhost` that it runs on an SSH host. The local path deliberately mirrors
 * `runRemoteCommand`: an argument vector, no extra shell interpolation on this
 * side, a detached process group for reliable timeout/cancellation, bounded
 * output tails, and one normalized result shape.
 *
 * @module @local/dsh-ssh-hosts/lib/local-exec
 */

import { spawn } from 'node:child_process'
import { homedir } from 'node:os'
import { resolve } from 'node:path'

/** Expand a leading `~` because `cwd` is not shell-expanded. */
function expandWorkdir(workdir) {
  if (typeof workdir !== 'string' || workdir.length === 0) return undefined
  if (workdir === '~') return homedir()
  if (workdir.startsWith('~/')) return resolve(homedir(), workdir.slice(2))
  return workdir
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
 * Run one command through the local login shell.
 *
 * @param {object} options
 * @param {string} options.command
 * @param {string} [options.workdir]
 * @param {string} [options.shellBinary]
 * @param {number} options.timeoutMs
 * @param {number} [options.maxOutputBytes]
 * @param {AbortSignal} [options.signal]
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
export function runLocalCommand(options) {
  const startedAt = Date.now()
  const {
    command,
    workdir,
    shellBinary = 'bash',
    timeoutMs = 120_000,
    maxOutputBytes = 128 * 1024,
    signal,
  } = options
  const cwd = expandWorkdir(workdir) ?? process.cwd()

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
      if (grace === undefined && !settled) {
        grace = setTimeout(() => finish(undefined, undefined, undefined), 1_000)
      }
    }
    onAbort = () => {
      aborted = true
      kill()
    }

    try {
      child = spawn(shellBinary, ['-c', command], {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: process.env,
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
