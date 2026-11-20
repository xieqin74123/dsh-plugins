/**
 * SSH host plugin for DeepSeek Harness.
 *
 * The User-facing half discovers the hosts in `~/.ssh/config`, exposes each one
 * as a human command (the Web target bar lists those commands), and records the
 * conversation's current execution target as a durable session projection. The
 * model-facing half registers `ssh_hosts` / `ssh_exec` tools so the Agent can
 * inspect the discovered hosts and run commands through the system OpenSSH
 * client. The target can be `localhost` (this machine) or one SSH host.
 *
 * @module @local/dsh-ssh-hosts
 */

import { watch } from 'node:fs'
import { basename, dirname } from 'node:path'

import z from '@deepseek-ai/schemastery'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { z as zod } from 'zod'

import {
  expandHome,
  formatHostAddress,
  formatHostTable,
  loadSshHosts,
} from './lib/ssh-config.js'
import { runLocalCommand } from './lib/local-exec.js'
import { runRemoteCommand } from './lib/ssh-exec.js'

/* ── Per-turn session settings snapshot ───────────────────────────────────
   A long run or a compaction must not lose these dock settings, so every
   user-initiated step carries one durable snapshot naming the current
   execution target, Python environment, CPU allocation, and GPU switch. The
   agent's own follow-up steps never add one: the snapshot is built only when
   the claimed inbox carries a real user message. Each plugin merges its line
   into the same message, so one turn shows one settings card that supersedes
   the previous one. */
const SETTINGS_KIND = 'session-settings'
const SETTINGS_HEADER = 'Session settings — set by the user in the composer bars and in effect until the user changes them:'
const SETTINGS_SECTIONS = ['Execution target', 'Python environment', 'CPU allocation', 'GPU access']

function settingsSnapshot(sections) {
  const ordered = [...sections].sort(
    (left, right) => SETTINGS_SECTIONS.indexOf(left.name) - SETTINGS_SECTIONS.indexOf(right.name),
  )
  return createUserMessage({
    content: [
      {
        type: 'text',
        text: `${SETTINGS_HEADER}\n\n${ordered.map((section) => `- ${section.name}: ${section.text}`).join('\n')}`,
      },
    ],
    source: { kind: SETTINGS_KIND, form: 'snapshot', sections: ordered },
  })
}

function withSettingsSection(messages, section) {
  const index = messages.findIndex((message) => message?.source?.kind === SETTINGS_KIND)
  if (index < 0) return [...messages, settingsSnapshot([section])]
  const sections = (messages[index].source.sections ?? []).filter((entry) => entry.name !== section.name)
  return messages.map((message, at) => (at === index ? settingsSnapshot([...sections, section]) : message))
}

function hasUserMessage(messages) {
  return messages.some((message) => message?.source?.kind === 'user')
}

/** Loader plugin name. */
export const name = 'ssh-hosts'

/** Services this plugin needs; commands is optional and injected below. */
export const inject = ['tools', 'systemPrompt', 'sessionProjections']

/** Tunables live in the user's patch layer so they survive upgrades. */
export const Config = z.object({
  /** OpenSSH client configuration file to read. */
  configPath: z.string().default('~/.ssh/config'),
  /** OpenSSH binary used for connection and configuration resolution. */
  sshBinary: z.string().default('ssh'),
  /** Host aliases to hide from the picker and the model. */
  excludeHosts: z.array(z.string()).default([]),
  /** TCP connect timeout handed to OpenSSH, in seconds. */
  connectTimeoutSeconds: z.number().default(10),
  /** Timeout used when a call does not pass `timeoutMs`. */
  defaultTimeoutMs: z.number().default(120_000),
  /** Upper bound for a single `ssh_exec` call, in milliseconds. */
  maxTimeoutMs: z.number().default(600_000),
  /** Tail retained per output stream, in bytes/characters. */
  maxOutputBytes: z.number().default(131_072),
  /** Register the human `/ssh` list/switch command. */
  enableCommands: z.boolean().default(true),
})

/** Stable prefix for per-host human commands. */
const COMMAND_PREFIX = 'ssh-'
const LOCAL_COMMAND = 'ssh-local'
const COMMAND_SLUG_MAX = 48
const PROMPT_ORDER = 5000
const TARGET_PROJECTION_KEY = 'ssh-target'

/** Session target state: the last target-changing human command, plus a catalog revision. */
const targetStateSchema = zod.object({
  command: zod.string(),
  args: zod.string(),
  revision: zod.number(),
  /**
   * In-flight `/ssh` invocation. The target only changes once `command/done`
   * reports success, so a rejected alias (or a failed context injection) cannot
   * become the durable target. An empty `args` listing republishes the catalog
   * when it settles.
   */
  pendingRun: zod.object({
    id: zod.string(),
    args: zod.string(),
  }).optional(),
})

/** Client-visible target label and the host catalog the picker renders. */
const targetViewSchema = zod.object({
  target: zod.string(),
  kind: zod.enum(['localhost', 'host', 'unknown']),
  hosts: zod.array(zod.object({
    alias: zod.string(),
    address: zod.string(),
  })),
})

function warn(ctx, message) {
  try {
    ctx.logger?.warn(`ssh-hosts: ${message}`)
  } catch {
    // Logging must never fail a tool call or a reload.
  }
}

function positiveInteger(value, fallback, minimum, maximum) {
  if (!Number.isFinite(value)) return fallback
  return Math.min(maximum, Math.max(minimum, Math.floor(value)))
}

function slugify(alias) {
  const slug = alias
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return (slug.length === 0 ? 'host' : slug).slice(0, COMMAND_SLUG_MAX)
}

function hostContextText(host) {
  const proxy = host.proxyJump === undefined ? '' : `, proxied through ${host.proxyJump}`
  return [
    `The user switched the current execution target to SSH host "${host.alias}" (${formatHostAddress(host)}${proxy}).`,
    `The host is defined in the user's ~/.ssh/config. Use the \`ssh_exec\` tool with host "${host.alias}" for commands about the target environment.`,
    'Commands are non-interactive (BatchMode): the host must already accept this machine\'s key and its host key must already be trusted.',
    'This machine is still localhost: local file tools do not see the remote filesystem unless you go through ssh_exec.',
  ].join('\n')
}

function localhostContextText() {
  return [
    'The user switched the current execution target back to localhost (this machine, where DSH runs).',
    'Use the local tools (bash, read, write, edit) for commands about the target environment.',
    'Do not call ssh_exec unless the user explicitly asks for a remote host.',
  ].join('\n')
}

function renderExecResult(value) {
  const lines = [`host: ${value.host}`]
  const prefix = value.workdir === undefined ? '' : `cd ${value.workdir} && `
  lines.push(`$ ${prefix}${value.command}`)
  if (value.stdout.length > 0) lines.push(value.stdout.replace(/\n$/, ''))
  if (value.stderr.length > 0) {
    lines.push('[stderr]', value.stderr.replace(/\n$/, ''))
  }
  if (value.spawnError !== undefined) lines.push(`[ssh could not start: ${value.spawnError}]`)
  if (value.timedOut) lines.push(`[timed out after ${Math.round(value.durationMs)}ms; the ssh client was killed]`)
  if (value.aborted) lines.push('[aborted: the tool call was cancelled]')
  if (value.exitSignal !== undefined) lines.push(`[signal: ${value.exitSignal}]`)
  if (value.exitCode !== undefined) lines.push(`[exit code: ${value.exitCode}]`)
  if (value.stdoutTruncated) lines.push(`[stdout truncated to its last ${value.stdout.length} characters]`)
  if (value.stderrTruncated) lines.push(`[stderr truncated to its last ${value.stderr.length} characters]`)
  return lines.join('\n')
}

/** One-line execution target for the per-turn settings snapshot. */
function settingsTargetText(target) {
  if (target.kind === 'host') {
    return `SSH host \`${target.host.alias}\` (${formatHostAddress(target.host)}). Run target-environment commands with \`ssh_exec\` host \`${target.host.alias}\`; local tools do not see the remote filesystem.`
  }
  if (target.kind === 'unknown') {
    return `Unresolved selection \`${target.name}\`. Fall back to localhost for now and ask the user to pick a host in the target bar.`
  }
  return 'localhost (this machine). Use the local tools; call `ssh_exec` only when the user explicitly names a remote host.'
}

export function apply(ctx, config = {}) {
  const settings = {
    configPath: expandHome(config.configPath ?? '~/.ssh/config'),
    sshBinary: config.sshBinary ?? 'ssh',
    excludeHosts: config.excludeHosts ?? [],
    connectTimeoutSeconds: positiveInteger(config.connectTimeoutSeconds, 10, 1, 600),
    defaultTimeoutMs: positiveInteger(config.defaultTimeoutMs, 120_000, 1_000, 86_400_000),
    maxTimeoutMs: positiveInteger(config.maxTimeoutMs, 600_000, 1_000, 86_400_000),
    maxOutputBytes: positiveInteger(config.maxOutputBytes, 131_072, 1_024, 16 * 1024 * 1024),
    enableCommands: config.enableCommands !== false,
  }
  if (settings.maxTimeoutMs < settings.defaultTimeoutMs) {
    settings.maxTimeoutMs = settings.defaultTimeoutMs
  }

  const state = {
    hosts: [],
    loaded: false,
    error: undefined,
  }

  let commandContext
  let commandDisposers = []
  let disposed = false
  let refreshChain = Promise.resolve()

  function findHost(input) {
    if (typeof input !== 'string') return undefined
    const wanted = input.trim().replace(/^@/, '')
    if (wanted.length === 0) return undefined
    const exact = state.hosts.find((host) => host.alias === wanted)
    if (exact !== undefined) return exact
    const wantedSlug = slugify(wanted)
    return state.hosts.find((host) => slugify(host.alias) === wantedSlug)
  }

  function targetForState(projected) {
    const command = typeof projected?.command === 'string' ? projected.command : LOCAL_COMMAND
    const args = typeof projected?.args === 'string' ? projected.args : ''
    if (command === LOCAL_COMMAND) {
      return { kind: 'localhost', name: 'localhost' }
    }
    if (command === 'ssh') {
      const input = args.trim()
      if (input === '' || input === 'localhost' || input === 'local') {
        return { kind: 'localhost', name: 'localhost' }
      }
      const host = findHost(input)
      return host === undefined
        ? { kind: 'unknown', name: input }
        : { kind: 'host', name: host.alias, host }
    }
    if (command.startsWith(COMMAND_PREFIX)) {
      // Historical selections used /ssh-<slug>; resolve them against the
      // current catalog so old sessions keep their target after this upgrade.
      const slug = command.slice(COMMAND_PREFIX.length)
      const host = state.hosts.find((candidate) => slugify(candidate.alias) === slug)
      return host === undefined
        ? { kind: 'unknown', name: command }
        : { kind: 'host', name: host.alias, host }
    }
    return { kind: 'localhost', name: 'localhost' }
  }

  /** Stable identity used to compare two resolved targets across catalogs. */
  function targetKeyOf(target) {
    if (target.kind === 'host') return `host:${target.name}`
    if (target.kind === 'unknown') return `unknown:${target.name}`
    return 'localhost'
  }

  /** Public, JSON-friendly view of a resolved target for dependent plugins. */
  function describeTarget(target) {
    const described = {
      kind: target.kind,
      name: target.name,
      key: targetKeyOf(target),
    }
    if (target.kind === 'host' && target.host !== undefined) {
      described.address = formatHostAddress(target.host)
      described.alias = target.host.alias
    }
    return described
  }

  let targetProjection
  let resolveProjectionReady
  const projectionReady = new Promise((resolve) => {
    resolveProjectionReady = resolve
  })

  function readTargetState(session) {
    if (targetProjection !== undefined) {
      try {
        return targetProjection.stateOf(session)
      } catch {
        // Fall through to the registry read.
      }
    }
    try {
      return ctx.sessionProjections.stateOf(session, TARGET_PROJECTION_KEY)
    } catch {
      return undefined
    }
  }

  // Durable selection: every target-changing human command is folded from the
  // session log, so the target survives reloads, resumes, and multiple clients.
  // Registration starts after the catalog load, but apply itself stays
  // synchronous so an HMR replacement never leaves the tools unregistered while
  // an asynchronous projection registration is still settling.
  async function initializeTargetProjection() {
    // `refreshChain` is seeded with the initial catalog load so tools and the
    // `sshExecution` service never observe the empty pre-load catalog.
    await refreshChain
    if (disposed || targetProjection !== undefined) {
      resolveProjectionReady()
      return
    }
    try {
      targetProjection = await ctx.sessionProjections.register({
        key: TARGET_PROJECTION_KEY,
        stateSchema: targetStateSchema,
        stateVersion: 2,
        init: () => ({ command: LOCAL_COMMAND, args: '', revision: 0 }),
        apply: (previous, event) => {
          // `command/run` is appended before the handler runs; commit only after
          // `command/done` reports success. A rejected alias or a failed context
          // injection therefore cannot become the durable target.
          if (event.type === 'command/done') {
            const pending = previous.pendingRun
            if (pending === undefined || pending.id !== event.data.commandId) return previous
            if (pending.args.length === 0) {
              // A listing refreshes the catalog inside its handler; bumping the
              // revision now recomputes the view against the fresh hosts.
              return { ...previous, pendingRun: undefined, revision: previous.revision + 1 }
            }
            if (event.data.kind !== 'success') return { ...previous, pendingRun: undefined }
            if (previous.command === 'ssh' && previous.args === pending.args) {
              return { ...previous, pendingRun: undefined }
            }
            return { command: 'ssh', args: pending.args, revision: previous.revision, pendingRun: undefined }
          }
          if (event.type !== 'command/run') return previous
          const name = event.data.name
          if (name === 'ssh') {
            const args = (event.data.args ?? '').trim()
            return {
              ...previous,
              pendingRun: { id: event.data.commandId, args },
            }
          }
          if (name === LOCAL_COMMAND) {
            return previous.command === LOCAL_COMMAND && previous.args === ''
              ? previous
              : { command: LOCAL_COMMAND, args: '', revision: previous.revision }
          }
          if (name.startsWith(COMMAND_PREFIX)) {
            return previous.command === name
              ? previous
              : { command: name, args: '', revision: previous.revision }
          }
          return previous
        },
        wire: {
          viewSchema: targetViewSchema,
          view: (projected) => {
            const target = targetForState(projected)
            return {
              target: target.name,
              kind: target.kind,
              hosts: state.hosts.map((host) => ({ alias: host.alias, address: formatHostAddress(host) })),
            }
          },
          summary: true,
        },
      })
    } catch (error) {
      // A reload can race the old registration's disposal. Keep the tools and
      // the prompt working; the old projection (if still alive) keeps serving
      // the client and `stateOf` below reads it when the key is available.
      warn(ctx, `could not register target projection: ${String(error)}`)
    } finally {
      // The environment selector waits for this, then registers its own
      // projection. A failed registration must not leave that waiter hanging.
      resolveProjectionReady()
    }
  }

  function disposeCommands() {
    for (const dispose of commandDisposers) {
      try { dispose() } catch { /* already gone */ }
    }
    commandDisposers = []
  }

  function registerHostCommands() {
    disposeCommands()
    if (disposed || !settings.enableCommands || commandContext === undefined) return

    try {
      commandDisposers.push(commandContext.commands.register({
        name: 'ssh',
        description: 'List SSH hosts, or switch the current execution target',
        input: { hint: '[host|localhost]' },
        handler: async ({ agent, rawInput }) => {
          const input = rawInput.trim().replace(/^@/, '')
          // Every invocation rereads the config: a switch must not use a host that
          // was removed, and the picker's catalog is refreshed by the same call.
          await requestRefresh()
          if (input.length === 0) {
            const target = targetForState(readTargetState(agent.session))
            if (state.error !== undefined) {
              return {
                kind: 'error',
                text: `Could not read ${settings.configPath}: ${state.error}`,
              }
            }
            return {
              kind: 'success',
              text: state.hosts.length === 0
                ? `No SSH hosts were found in ${settings.configPath}. Current target: ${target.name}.`
                : `Current target: ${target.name}\n\nSSH hosts from ${settings.configPath}:\n${formatHostTable(state.hosts)}\n\nUse /ssh <host> to switch to a host, or /ssh localhost to switch back to localhost.`,
            }
          }
          if (input === 'localhost' || input === 'local') return switchToLocalhost(agent)
          if (state.error !== undefined) {
            return {
              kind: 'error',
              text: `Could not read ${settings.configPath}: ${state.error}`,
            }
          }
          const host = findHost(input)
          if (host === undefined) {
            return {
              kind: 'error',
              text: `Unknown SSH host "${input}". Available: ${state.hosts.map((candidate) => candidate.alias).join(', ') || '(none)'}.`,
            }
          }
          return switchToHost(agent, host)
        },
      }))
    } catch (error) {
      warn(ctx, `could not register /ssh: ${String(error)}`)
    }
  }

  function switchToHost(agent, host) {
    try {
      agent.inject(createUserMessage({
        content: [{ type: 'text', text: hostContextText(host) }],
        source: { kind: 'user' },
      }))
    } catch (error) {
      return {
        kind: 'error',
        text: `Could not switch to SSH host ${host.alias}: ${error instanceof Error ? error.message : String(error)}`,
      }
    }
    return {
      kind: 'success',
      text: `Current target: SSH host ${host.alias} (${formatHostAddress(host)}). The Agent will use it with your next message.`,
    }
  }

  function switchToLocalhost(agent) {
    try {
      agent.inject(createUserMessage({
        content: [{ type: 'text', text: localhostContextText() }],
        source: { kind: 'user' },
      }))
    } catch (error) {
      return {
        kind: 'error',
        text: `Could not switch to localhost: ${error instanceof Error ? error.message : String(error)}`,
      }
    }
    return {
      kind: 'success',
      text: 'Current target: localhost (this machine). The Agent will use local tools with your next message.',
    }
  }

  async function refresh() {
    try {
      const hosts = await loadSshHosts({
        configPath: settings.configPath,
        sshBinary: settings.sshBinary,
        excludeHosts: settings.excludeHosts,
        resolveTimeoutMs: 4_000,
      })
      if (disposed) return
      state.hosts = hosts
      state.loaded = true
      state.error = undefined
    } catch (error) {
      if (disposed) return
      state.loaded = true
      state.error = error instanceof Error ? error.message : String(error)
      warn(ctx, `could not read ${settings.configPath}: ${state.error}`)
    }
  }

  function requestRefresh() {
    refreshChain = refreshChain
      .then(() => refresh())
      .catch((error) => {
        warn(ctx, `refresh failed: ${String(error)}`)
      })
    return refreshChain
  }

  ctx.effect(() => () => {
    disposed = true
    disposeCommands()
  }, 'ssh-hosts: registration lifetime')

  // Model-facing tools. They read the live catalog, so a config edit is
  // reflected by the next call without re-registering a schema.
  ctx.tools.register(defineTool({
    name: 'ssh_hosts',
    description: [
      'List the SSH hosts defined in the user\'s ~/.ssh/config.',
      'Each entry shows the alias the user selected, the effective user@hostname:port resolved by OpenSSH, and an optional ProxyJump host.',
      'Use the returned alias verbatim as the host argument of ssh_exec. The file is re-read on each call.',
    ].join(' '),
    parameters: {},
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(_args, exec) {
      if (exec.signal.aborted) throw new Error('ssh_hosts was cancelled')
      // Listings are rare; reread the config so a host added since the last
      // watcher tick is visible to the model immediately.
      await requestRefresh()
      const table = formatHostTable(state.hosts)
      if (state.error !== undefined) return `Could not fully read ${settings.configPath}: ${state.error}\n\n${table}`
      if (state.hosts.length === 0) return `No SSH hosts were found in ${settings.configPath}.`
      return table
    },
    presentCall: () => ({ card: 'generic', title: 'List SSH hosts', kind: 'read' }),
  }))

  ctx.tools.register(defineTool({
    name: 'ssh_exec',
    description: [
      'Run a shell command on a remote host defined in the user\'s ~/.ssh/config, through the system OpenSSH client.',
      'The current execution target is stated in the Execution target section; prefer that host unless the user explicitly asks for another one.',
      'Pass the exact alias returned by ssh_hosts. Execution is non-interactive (BatchMode): the host must already trust this machine\'s key, and an unknown host key fails instead of prompting.',
      'stdout and stderr are returned with the exit code; a non-zero exit is a normal result to interpret, not a tool failure.',
      'Set workdir to enter a remote directory first; leading ~ and ~/ are expanded on the remote side. Commands run in a fresh remote shell, so use workdir instead of relying on a previous cd.',
      'Long output is truncated to its tail. The timeout kills the local ssh client; the remote process may keep running.',
    ].join(' '),
    parameters: {
      host: {
        type: 'string',
        required: true,
        description: 'Exact SSH host alias from ssh_hosts, for example "gpu_6000pro".',
      },
      command: {
        type: 'string',
        required: true,
        description: 'Shell command to execute on the remote host.',
      },
      workdir: {
        type: 'string',
        description: 'Remote directory to enter before running the command.',
      },
      timeoutMs: {
        type: 'number',
        description: `Milliseconds before the local ssh client is killed. Defaults to ${settings.defaultTimeoutMs}; at most ${settings.maxTimeoutMs}.`,
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          host: { type: 'string', required: true },
          command: { type: 'string', required: true },
          workdir: { type: 'string' },
          stdout: { type: 'string', required: true },
          stderr: { type: 'string', required: true },
          exitCode: { type: 'integer' },
          exitSignal: { type: 'string' },
          timedOut: { type: 'boolean', required: true },
          aborted: { type: 'boolean', required: true },
          spawnError: { type: 'string' },
          durationMs: { type: 'number', required: true },
          stdoutTruncated: { type: 'boolean', required: true },
          stderrTruncated: { type: 'boolean', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderExecResult(value) }],
    },
    async execute(args, exec) {
      await refreshChain
      const requested = String(args.host ?? '').trim().replace(/^@/, '')
      const host = state.hosts.find((candidate) => candidate.alias === requested)
      if (host === undefined) {
        const available = state.hosts.map((candidate) => candidate.alias).join(', ')
        throw new Error(`unknown SSH host "${requested}". Available hosts: ${available || '(none — check ~/.ssh/config)'}`)
      }
      if (args.command.trim().length === 0) {
        throw new Error('ssh_exec command must be a non-empty string')
      }
      const timeoutMs = positiveInteger(args.timeoutMs, settings.defaultTimeoutMs, 1_000, settings.maxTimeoutMs)
      const result = await runRemoteCommand({
        sshBinary: settings.sshBinary,
        configPath: settings.configPath,
        alias: host.alias,
        command: args.command,
        workdir: args.workdir,
        timeoutMs,
        connectTimeoutSeconds: settings.connectTimeoutSeconds,
        maxOutputBytes: settings.maxOutputBytes,
        signal: exec.signal,
      })
      return {
        host: host.alias,
        command: args.command,
        ...args.workdir === undefined ? {} : { workdir: args.workdir },
        stdout: result.stdout,
        stderr: result.stderr,
        ...result.exitCode === undefined ? {} : { exitCode: result.exitCode },
        ...result.exitSignal === undefined ? {} : { exitSignal: result.exitSignal },
        timedOut: result.timedOut,
        aborted: result.aborted,
        ...result.spawnError === undefined ? {} : { spawnError: result.spawnError },
        durationMs: result.durationMs,
        stdoutTruncated: result.stdoutTruncated,
        stderrTruncated: result.stderrTruncated,
      }
    },
    presentCall: (args) => ({
      card: 'generic',
      title: `ssh_exec ${args.host}`,
      kind: 'execute',
      rawInput: args.command,
    }),
  }))

  ctx.systemPrompt.section({
    name: 'ssh:target',
    order: PROMPT_ORDER,
    interpolate: false,
    text: (promptContext) => {
      const agent = promptContext?.agent
      const projected = agent === undefined ? undefined : readTargetState(agent.session)
      const target = targetForState(projected)
      const lines = ['## Execution target', '']
      if (target.kind === 'host') {
        lines.push(
          `Current target: **SSH host ${target.host.alias}** — ${formatHostAddress(target.host)}.`,
          `Use \`ssh_exec\` with host \`${target.host.alias}\` for commands about the target environment.`,
          'Local tools still operate on this machine; they do not see the remote filesystem.',
        )
      } else if (target.kind === 'unknown') {
        lines.push(
          `Current target: unresolved selection \`${target.name}\`.`,
          'Fall back to localhost for the next step and ask the user to pick a valid host in the target bar.',
        )
      } else {
        lines.push(
          'Current target: **localhost** — this machine, where DSH runs.',
          'Use the local tools (bash, read, write, edit) for commands about the target environment.',
          'Do not call `ssh_exec` unless the user explicitly asks for a remote host.',
        )
      }

      if (state.hosts.length > 0) {
        lines.push(
          '',
          '### SSH hosts',
          '',
          `The user's ${settings.configPath} defines these SSH hosts:`,
          formatHostTable(state.hosts),
          '',
          'Use `ssh_exec` with an exact alias from this list to run commands there; use `ssh_hosts` to list them again.',
          'Only these aliases are accepted. Execution is non-interactive, so a host must already trust this machine\'s key and have an accepted host key.',
          'When the user switches the target in the target bar, a user message names the new target: follow it until the user changes it.',
        )
      } else {
        lines.push('', `No SSH hosts were found in ${settings.configPath}.`)
      }
      return lines.join('\n')
    },
  })

  ctx.inject(['commands'], (commandsCtx) => {
    commandContext = commandsCtx
    registerHostCommands()
    return () => {
      commandContext = undefined
      disposeCommands()
    }
  })

  ctx.effect(() => {
    let watcher
    let timer
    try {
      watcher = watch(dirname(settings.configPath), { persistent: false }, (_event, filename) => {
        if (filename !== null && filename !== undefined && String(filename) !== basename(settings.configPath)) return
        if (timer !== undefined) clearTimeout(timer)
        timer = setTimeout(() => {
          timer = undefined
          requestRefresh()
        }, 500)
      })
      watcher.on('error', (error) => warn(ctx, `config watcher: ${String(error)}`))
    } catch (error) {
      warn(ctx, `could not watch ${settings.configPath}: ${String(error)}`)
    }
    return () => {
      if (timer !== undefined) clearTimeout(timer)
      try { watcher?.close() } catch { /* already closed */ }
    }
  }, 'ssh-hosts: config watcher')

  // Seed the shared chain before publishing the service: tools, `sshExecution`
  // callers, and the projection registration all wait for the first catalog.
  refreshChain = refresh().catch((error) => {
    warn(ctx, `refresh failed: ${String(error)}`)
  })

  // Dependent plugins (for example the Python environment selector) need the
  // same target resolution and the same non-interactive execution path without
  // re-reading ~/.ssh/config or duplicating the ssh argument policy.
  ctx.provide('sshExecution', {
    /** Resolves once the host catalog and the target projection are ready. */
    ready: () => Promise.all([refreshChain, projectionReady]),
    /** Current host catalog as plain objects. */
    hosts: () => state.hosts.map((host) => ({ ...host })),
    /** Resolve one alias exactly as the target bar and ssh_exec do. */
    findHost: (alias) => findHost(alias),
    /** Resolve a projected `command`/`args` pair to a target. */
    resolveState: (projected) => describeTarget(targetForState(projected)),
    /** Resolve the current target recorded for a session. */
    resolveSession: (session) => describeTarget(targetForState(readTargetState(session))),
    /** Stable identity for comparing targets from different commands. */
    keyOf: (target) => targetKeyOf(target),
    /**
     * Run one command on a resolved target. `target` may be the object returned
     * by resolveState/resolveSession, or `host` may name an alias (or
     * `localhost`). Localhost uses the local shell; a host uses OpenSSH with the
     * same BatchMode/ConnectTimeout policy as ssh_exec.
     */
    async run(options = {}) {
      await refreshChain
      const command = typeof options.command === 'string' ? options.command : ''
      if (command.trim().length === 0) {
        throw new Error('target command must be a non-empty string')
      }
      const timeoutMs = positiveInteger(options.timeoutMs, settings.defaultTimeoutMs, 1_000, settings.maxTimeoutMs)
      const maxOutputBytes = positiveInteger(options.maxOutputBytes, settings.maxOutputBytes, 1_024, 16 * 1024 * 1024)
      let target = options.target

      if (target === undefined) {
        const alias = typeof options.host === 'string' ? options.host.trim().replace(/^@/, '') : ''
        if (alias.length === 0 || alias === 'localhost' || alias === 'local') {
          target = { kind: 'localhost', name: 'localhost' }
        } else {
          const host = state.hosts.find((candidate) => candidate.alias === alias)
          if (host === undefined) {
            const available = state.hosts.map((candidate) => candidate.alias).join(', ')
            throw new Error(`unknown SSH host "${alias}". Available hosts: ${available || '(none — check ~/.ssh/config)'}`)
          }
          target = { kind: 'host', name: host.alias, host }
        }
      }

      if (target.kind === 'host') {
        const host = state.hosts.find((candidate) => candidate.alias === target.name) ?? target.host
        if (host === undefined) {
          throw new Error(`unknown SSH host "${target.name}"`)
        }
        return runRemoteCommand({
          sshBinary: settings.sshBinary,
          configPath: settings.configPath,
          alias: host.alias,
          command,
          workdir: options.workdir,
          timeoutMs,
          connectTimeoutSeconds: settings.connectTimeoutSeconds,
          maxOutputBytes,
          signal: options.signal,
        })
      }
      if (target.kind === 'localhost') {
        return runLocalCommand({
          command,
          workdir: options.workdir,
          timeoutMs,
          maxOutputBytes,
          signal: options.signal,
        })
      }
      throw new Error(`cannot run commands on unresolved target "${target.name}"`)
    },
  })

  // Re-assert the execution target on every user turn so a long run or a
  // compaction cannot lose it.
  ctx.on('agent/pre-step', async ({ agent, messages }, next) => {
    const decision = await next()
    if (decision.kind === 'reject' || !hasUserMessage(messages)) return decision
    try {
      const target = targetForState(readTargetState(agent.session))
      return {
        ...decision,
        messages: withSettingsSection(decision.messages, {
          name: 'Execution target',
          text: settingsTargetText(target),
        }),
      }
    } catch (error) {
      warn(ctx, `settings reminder failed: ${String(error)}`)
      return decision
    }
  })

  void initializeTargetProjection()
}
