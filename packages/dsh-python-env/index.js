/**
 * Python/conda environment selector for DeepSeek Harness.
 *
 * The selector is a second, session-durable bar above the composer. It mirrors
 * the SSH plugin's execution target: the target comes from the `ssh-target`
 * session projection (or the SSH plugin's `sshExecution` service), and
 * environments are discovered on that target by running one POSIX discovery
 * script through the same non-interactive execution path as `ssh_exec`.
 *
 * The selected environment is folded into a `python-env` session projection so
 * reloads, reconnects, and resumed sessions keep it. A system-prompt section and
 * the `python_envs` / `python_exec` tools make the Agent use that interpreter
 * for Python work, while the local bash tool receives DSH_PYTHON-style
 * environment facts when the current target is localhost.
 *
 * @module @local/dsh-python-env
 */

import z from '@deepseek-ai/schemastery'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { z as zod } from 'zod'

import { activationHint, buildPythonCommand } from './lib/command.js'
import {
  buildDiscoveryScript,
  defaultPythonFor,
  environmentDisplayLabel,
  findEnvironment,
  formatEnvironmentTable,
  parseDiscoveryOutput,
} from './lib/discover.js'

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
export const name = 'python-env'

/** Required services; `commands` and `shellEnv` are optional and injected below. */
export const inject = ['tools', 'systemPrompt', 'sessionProjections', 'sshExecution']

/** Tunables live in the user's patch layer so they survive upgrades. */
export const Config = z.object({
  /** Timeout for one discovery run on a target, in milliseconds. */
  discoveryTimeoutMs: z.number().default(30_000),
  /** Timeout used by `python_exec` when a call does not pass `timeoutMs`. */
  defaultTimeoutMs: z.number().default(120_000),
  /** Upper bound for one `python_exec` call, in milliseconds. */
  maxTimeoutMs: z.number().default(600_000),
  /** How long a discovered catalog is reused before the next refresh. */
  cacheTtlMs: z.number().default(60_000),
  /** Hard cap on rows returned by one discovery. */
  maxEnvironments: z.number().default(200),
  /** Tail retained per output stream, in bytes/characters. */
  maxOutputBytes: z.number().default(262_144),
  /** Additional conda installation roots to inspect. */
  extraCondaRoots: z.array(z.string()).default([]),
  /** Additional directories whose `python*` entries should be inspected. */
  extraPythonDirs: z.array(z.string()).default([]),
  /** Register the human `/python-env` command. */
  enableCommands: z.boolean().default(true),
})

const COMMAND_NAME = 'python-env'
const PROJECTION_KEY = 'python-env'
const PROMPT_ORDER = 5100
const LOCAL_COMMAND = 'ssh-local'

/** Internal projection state: the mirrored SSH target plus the selected id. */
const stateSchema = zod.object({
  sshCommand: zod.string(),
  sshArgs: zod.string(),
  /** In-flight `/ssh` invocation; the target commits only after success. */
  pendingSshRun: zod.object({
    id: zod.string(),
    args: zod.string(),
  }).optional(),
  /** In-flight `/python-env` selection; the choice commits only after success. */
  pendingEnv: zod.object({
    id: zod.string(),
    selectedId: zod.string(),
    sshCommand: zod.string(),
    sshArgs: zod.string(),
  }).optional(),
  selectedId: zod.string(),
  selectedSshCommand: zod.string(),
  selectedSshArgs: zod.string(),
  revision: zod.number(),
})

const environmentSchema = zod.object({
  id: zod.string(),
  kind: zod.enum(['python', 'conda']),
  label: zod.string(),
  detail: zod.string(),
  path: zod.string(),
  pythonPath: zod.string(),
  condaRoot: zod.string(),
  condaName: zod.string(),
  version: zod.string(),
})

/** Client-visible selection and the catalog discovered for the current target. */
const viewSchema = zod.object({
  target: zod.string(),
  targetKind: zod.enum(['localhost', 'host', 'unknown']),
  targetAddress: zod.string(),
  selectedId: zod.string(),
  selectedLabel: zod.string(),
  selectedKind: zod.enum(['auto', 'python', 'conda']),
  selectedPath: zod.string(),
  selectedActive: zod.boolean(),
  environments: zod.array(environmentSchema),
  loading: zod.boolean(),
  error: zod.string(),
  revision: zod.number(),
})

function warn(ctx, message) {
  try {
    ctx.logger?.warn(`python-env: ${message}`)
  } catch {
    // Logging must never fail a tool call or a reload.
  }
}

function positiveInteger(value, fallback, minimum, maximum) {
  if (!Number.isFinite(value)) return fallback
  return Math.min(maximum, Math.max(minimum, Math.floor(value)))
}

function errorMessage(error) {
  if (error instanceof Error && error.message.length > 0) return error.message
  return String(error)
}

function initialSelectionState() {
  return {
    sshCommand: LOCAL_COMMAND,
    sshArgs: '',
    selectedId: 'auto',
    selectedSshCommand: LOCAL_COMMAND,
    selectedSshArgs: '',
    revision: 0,
  }
}

function targetSummary(target) {
  if (target.kind === 'host') {
    return `SSH host "${target.name}"${target.address === undefined ? '' : ` — ${target.address}`}`
  }
  if (target.kind === 'unknown') return `unresolved selection "${target.name}"`
  return 'localhost (this machine)'
}

function renderTargetPrefix(target) {
  if (target.kind === 'host') return `host: ${target.name}`
  if (target.kind === 'unknown') return `target: unresolved (${target.name})`
  return 'host: localhost'
}

function renderExecResult(value) {
  const lines = [
    renderTargetPrefix({ kind: value.targetKind, name: value.target }),
    `environment: ${value.environment}`,
    `python: ${value.pythonPath}`,
  ]
  const prefix = value.workdir === undefined ? '' : `cd ${value.workdir} && `
  lines.push(`$ ${prefix}python -c <snippet>`)
  if (value.stdout.length > 0) lines.push(value.stdout.replace(/\n$/, ''))
  if (value.stderr.length > 0) lines.push('[stderr]', value.stderr.replace(/\n$/, ''))
  if (value.spawnError !== undefined) lines.push(`[command could not start: ${value.spawnError}]`)
  if (value.timedOut) lines.push(`[timed out after ${Math.round(value.durationMs)}ms; the process was killed]`)
  if (value.aborted) lines.push('[aborted: the tool call was cancelled]')
  if (value.exitSignal !== undefined) lines.push(`[signal: ${value.exitSignal}]`)
  if (value.exitCode !== undefined) lines.push(`[exit code: ${value.exitCode}]`)
  if (value.stdoutTruncated) lines.push(`[stdout truncated to its last ${value.stdout.length} characters]`)
  if (value.stderrTruncated) lines.push(`[stderr truncated to its last ${value.stderr.length} characters]`)
  return lines.join('\n')
}

/** One-line Python environment for the per-turn settings snapshot. */
function settingsEnvironmentText(selection) {
  const { target, env } = selection
  if (target.kind === 'unknown') return 'Unavailable until the execution target is chosen.'
  const version = env !== undefined && env.version.length > 0 ? ` (Python ${env.version})` : ''
  if (env !== undefined) {
    const where = target.kind === 'host' ? ` on SSH host \`${target.name}\`` : ''
    return `${environmentDisplayLabel(env)}${where} — use \`${env.pythonPath}\`${version} for every Python, pip, or conda command.`
  }
  return target.kind === 'host'
    ? `auto — the default \`python3\` on SSH host \`${target.name}\`.`
    : 'auto — use `python3` on this machine (falling back to `python`).'
}

export function apply(ctx, config = {}) {
  const settings = {
    discoveryTimeoutMs: positiveInteger(config.discoveryTimeoutMs, 30_000, 1_000, 86_400_000),
    defaultTimeoutMs: positiveInteger(config.defaultTimeoutMs, 120_000, 1_000, 86_400_000),
    maxTimeoutMs: positiveInteger(config.maxTimeoutMs, 600_000, 1_000, 86_400_000),
    cacheTtlMs: positiveInteger(config.cacheTtlMs, 60_000, 1_000, 86_400_000),
    maxEnvironments: positiveInteger(config.maxEnvironments, 200, 1, 2_000),
    maxOutputBytes: positiveInteger(config.maxOutputBytes, 262_144, 1_024, 16 * 1024 * 1024),
    extraCondaRoots: Array.isArray(config.extraCondaRoots) ? config.extraCondaRoots : [],
    extraPythonDirs: Array.isArray(config.extraPythonDirs) ? config.extraPythonDirs : [],
    enableCommands: config.enableCommands !== false,
  }
  if (settings.maxTimeoutMs < settings.defaultTimeoutMs) {
    settings.maxTimeoutMs = settings.defaultTimeoutMs
  }
  if (settings.discoveryTimeoutMs > settings.maxTimeoutMs) {
    settings.discoveryTimeoutMs = settings.maxTimeoutMs
  }

  /** target key → { environments, warnings, loadedAt, error } */
  const catalogs = new Map()
  /** target key → in-flight discovery promise */
  const inflight = new Map()
  let projection
  let disposed = false
  let commandContext
  let commandDisposers = []
  let shellEnvAvailable = false

  function readSelectionState(session) {
    if (projection !== undefined) {
      try {
        return projection.stateOf(session)
      } catch {
        // Fall through to the registry read.
      }
    }
    try {
      return ctx.sessionProjections.stateOf(session, PROJECTION_KEY)
    } catch {
      return undefined
    }
  }

  function resolveMirroredTarget(command, args) {
    try {
      return ctx.sshExecution.resolveState({ command, args })
    } catch {
      return { kind: 'unknown', name: String(args), key: `unknown:${String(args)}` }
    }
  }

  function selectionFor(session) {
    const state = readSelectionState(session) ?? initialSelectionState()
    const target = ctx.sshExecution.resolveSession(session)
    const selectedTarget = resolveMirroredTarget(state.selectedSshCommand, state.selectedSshArgs)
    const sameTarget = target.key === selectedTarget.key
    const cached = catalogs.get(target.key)
    const env = state.selectedId === 'auto' || !sameTarget
      ? undefined
      : findEnvironment(cached?.environments ?? [], state.selectedId)
    return { state, target, env, sameTarget, cached }
  }

  async function ensureCatalog(target, options = {}) {
    if (target.kind === 'unknown') {
      return {
        environments: [],
        warnings: [],
        loadedAt: Date.now(),
        error: `The execution target is unresolved (${target.name}); choose localhost or an SSH host in the target bar first.`,
      }
    }
    const key = target.key
    const cached = catalogs.get(key)
    const fresh = cached !== undefined && (Date.now() - cached.loadedAt) < settings.cacheTtlMs
    if (!options.force && fresh) return cached
    const running = inflight.get(key)
    if (running !== undefined) return running

    const script = buildDiscoveryScript({
      condaRoots: settings.extraCondaRoots,
      pythonDirs: settings.extraPythonDirs,
    })
    const promise = (async () => {
      const result = await ctx.sshExecution.run({
        target,
        command: script,
        timeoutMs: settings.discoveryTimeoutMs,
        maxOutputBytes: settings.maxOutputBytes,
        signal: options.signal,
      })
      if (disposed) {
        return { environments: [], warnings: [], loadedAt: Date.now(), error: 'plugin is unloading' }
      }
      const parsed = parseDiscoveryOutput(result.stdout, result.stderr, {
        maxEnvironments: settings.maxEnvironments,
      })
      let error
      if (result.timedOut) {
        error = `Discovery timed out after ${Math.round(result.durationMs)}ms on ${targetSummary(target)}.`
      } else if (result.spawnError !== undefined) {
        error = `Could not start discovery on ${targetSummary(target)}: ${result.spawnError}`
      } else if (result.aborted) {
        error = 'Discovery was cancelled.'
      } else if (result.exitCode !== undefined && result.exitCode !== 0 && parsed.environments.length === 0) {
        const tail = result.stderr.trim().split(/\r?\n/).slice(-3).join(' ')
        error = `Discovery exited with code ${result.exitCode} on ${targetSummary(target)}${tail.length > 0 ? `: ${tail}` : '.'}`
      } else if (parsed.warnings.length > 0 && parsed.environments.length === 0) {
        error = parsed.warnings.join(' ')
      }
      const record = {
        environments: parsed.environments,
        warnings: parsed.warnings,
        loadedAt: Date.now(),
        ...error === undefined ? {} : { error },
      }
      catalogs.set(key, record)
      return record
    })().catch((error) => {
      const record = {
        environments: [],
        warnings: [],
        loadedAt: Date.now(),
        error: `Could not discover environments on ${targetSummary(target)}: ${errorMessage(error)}`,
      }
      catalogs.set(key, record)
      return record
    }).finally(() => {
      inflight.delete(key)
    })
    inflight.set(key, promise)
    return promise
  }

  async function resolveSelectionForExecution(session, signal) {
    const state = readSelectionState(session) ?? initialSelectionState()
    const target = ctx.sshExecution.resolveSession(session)
    const selectedTarget = resolveMirroredTarget(state.selectedSshCommand, state.selectedSshArgs)
    const sameTarget = target.key === selectedTarget.key
    // A stale-but-present catalog is good enough to run with the already
    // selected interpreter; only an absent catalog (or a failed empty one) is
    // worth a fresh discovery on the execution path.
    let record = catalogs.get(target.key)
    if (record === undefined) {
      record = await ensureCatalog(target, { signal })
    }
    if (state.selectedId === 'auto' || !sameTarget) {
      return { target, env: undefined, state, record }
    }
    let env = findEnvironment(record.environments, state.selectedId)
    if (env === undefined && record.environments.length === 0 && record.error !== undefined) {
      record = await ensureCatalog(target, { force: true, signal })
      env = findEnvironment(record.environments, state.selectedId)
    }
    return { target, env, state, record }
  }

  function selectionContextText(target, env) {
    const activation = activationHint(env, env.pythonPath)
    const lines = [
      `The user selected the Python environment "${environmentDisplayLabel(env)}" on the current execution target: ${targetSummary(target)}.`,
      `Python interpreter: ${env.pythonPath}`,
      `Activation: ${activation}`,
      'Use this interpreter for every Python, pip, conda, pytest, or similar command about the target environment.',
      'If the activation command is unavailable in the target shell, invoke the interpreter path directly.',
      'Do not install packages into a different environment unless the user explicitly asks for it.',
    ]
    if (target.kind === 'host') {
      lines.push(
        `The host is remote: pass the activation prefix and the command to \`ssh_exec\` with host "${target.name}".`,
        'Local file tools still operate on this machine; they do not see the remote filesystem.',
      )
    } else {
      lines.push('On localhost, prefix bash commands with the activation command above, or invoke the interpreter path directly.')
      if (shellEnvAvailable) {
        lines.push(
          'The local bash tool exports DSH_PYTHON, DSH_PYTHON_ENV, and (for conda) DSH_CONDA_PREFIX for this selection.',
          'Prefer "$DSH_PYTHON" for Python invocations and "$DSH_PYTHON" -m pip for pip; that avoids depending on PATH resolution.',
        )
      }
    }
    return lines.join('\n')
  }

  function autoContextText(target) {
    const lines = [
      `The user reset the Python environment on ${targetSummary(target)} to automatic.`,
      'Use the target\'s default `python3` (falling back to `python`) for Python work, or ask the user to pick an environment in the Python environment bar.',
    ]
    if (target.kind === 'host') {
      lines.push(`Run commands on this host through \`ssh_exec\` with host "${target.name}".`)
    } else {
      lines.push('On localhost, use the local tools (bash, read, write, edit).')
    }
    return lines.join('\n')
  }

  function disposeCommands() {
    for (const dispose of commandDisposers) {
      try { dispose() } catch { /* already gone */ }
    }
    commandDisposers = []
  }

  function registerCommands() {
    disposeCommands()
    if (disposed || !settings.enableCommands || commandContext === undefined) return
    try {
      commandDisposers.push(commandContext.commands.register({
        name: COMMAND_NAME,
        description: 'List Python/conda environments, or switch the environment for the current target',
        input: { hint: '[auto|<environment>|refresh]' },
        handler: async ({ agent, rawInput }) => {
          const input = rawInput.trim().replace(/^@/, '')
          const target = ctx.sshExecution.resolveSession(agent.session)
          if (target.kind === 'unknown') {
            return {
              kind: 'error',
              text: `The execution target is unresolved (${target.name}). Choose localhost or an SSH host in the target bar first.`,
            }
          }
          if (input.length === 0 || input === 'refresh') {
            const record = await ensureCatalog(target, { force: input === 'refresh' })
            const selection = selectionFor(agent.session)
            const effective = selection.env === undefined ? 'auto' : environmentDisplayLabel(selection.env)
            const lines = [
              `Target: ${targetSummary(target)}`,
              `Selected: ${effective}`,
              '',
              'Available environments:',
              `- auto — ${defaultPythonFor(record.environments)?.pythonPath ?? 'default python3 on the target'}`,
              formatEnvironmentTable(record.environments),
            ]
            if (record.error !== undefined) lines.push('', `Discovery note: ${record.error}`)
            lines.push('', 'Use /python-env <environment> to switch, /python-env auto to reset, or /python-env refresh to discover again.')
            return { kind: 'success', text: lines.join('\n') }
          }
          if (input === 'auto' || input === 'default' || input === 'none') {
            try {
              agent.inject(createUserMessage({
                content: [{ type: 'text', text: autoContextText(target) }],
                source: { kind: 'user' },
              }))
            } catch (error) {
              return { kind: 'error', text: `Could not switch the environment: ${errorMessage(error)}` }
            }
            return {
              kind: 'success',
              text: `Python environment on ${targetSummary(target)}: auto (target default).`,
            }
          }
          let record = await ensureCatalog(target)
          let env = findEnvironment(record.environments, input)
          if (env === undefined && record.environments.length === 0) {
            record = await ensureCatalog(target, { force: true })
            env = findEnvironment(record.environments, input)
          }
          if (env === undefined) {
            const available = record.environments.map((candidate) => candidate.label).join(', ')
            return {
              kind: 'error',
              text: `No environment "${input}" was found on ${targetSummary(target)}. Available: ${available || '(none)'}.`,
            }
          }
          try {
            agent.inject(createUserMessage({
              content: [{ type: 'text', text: selectionContextText(target, env) }],
              source: { kind: 'user' },
            }))
          } catch (error) {
            return { kind: 'error', text: `Could not switch the environment: ${errorMessage(error)}` }
          }
          return {
            kind: 'success',
            text: `Python environment on ${targetSummary(target)}: ${environmentDisplayLabel(env)} — ${env.pythonPath}. The Agent will use it with your next message.`,
          }
        },
      }))
    } catch (error) {
      warn(ctx, `could not register /${COMMAND_NAME}: ${String(error)}`)
    }
  }

  async function initializeProjection() {
    try {
      await ctx.sshExecution.ready()
    } catch {
      // The catalog still works if the target projection could not register.
    }
    if (disposed || projection !== undefined) return
    try {
      projection = await ctx.sessionProjections.register({
        key: PROJECTION_KEY,
        stateSchema,
        stateVersion: 2,
        init: () => initialSelectionState(),
        apply: (previous, event) => {
          // Discovery is asynchronous and starts after `command/run` is
          // appended. `command/done` is the first event guaranteed to arrive
          // after the handler populated the catalog, so every completion bumps
          // the revision and makes the client view recompute with fresh rows.
          if (event.type === 'command/done') {
            const pending = previous.pendingSshRun
            const next = { ...previous, revision: previous.revision + 1 }
            if (pending !== undefined && pending.id === event.data.commandId) {
              next.pendingSshRun = undefined
              // An empty args listing only republishes the catalog; a failed
              // switch keeps the old target. This mirrors ssh-target exactly.
              if (pending.args.length > 0 && event.data.kind === 'success') {
                next.sshCommand = 'ssh'
                next.sshArgs = pending.args
              }
            }
            const pendingEnv = previous.pendingEnv
            if (pendingEnv !== undefined && pendingEnv.id === event.data.commandId) {
              next.pendingEnv = undefined
              // Only a successful selection command commits the environment;
              // an unknown id or a failed context injection leaves the previous
              // selection intact.
              if (event.data.kind === 'success') {
                next.selectedId = pendingEnv.selectedId
                next.selectedSshCommand = pendingEnv.sshCommand
                next.selectedSshArgs = pendingEnv.sshArgs
              }
            }
            return next
          }
          if (event.type !== 'command/run') return previous
          const command = event.data.name
          const args = (event.data.args ?? '').trim().replace(/^@/, '')
          if (command === 'ssh') {
            return {
              ...previous,
              pendingSshRun: { id: event.data.commandId, args },
            }
          }
          if (command === LOCAL_COMMAND) {
            if (previous.sshCommand === LOCAL_COMMAND && previous.pendingSshRun === undefined) return previous
            return { ...previous, sshCommand: LOCAL_COMMAND, sshArgs: '', pendingSshRun: undefined }
          }
          if (command.startsWith('ssh-')) {
            if (previous.sshCommand === command && previous.pendingSshRun === undefined) return previous
            return { ...previous, sshCommand: command, sshArgs: '', pendingSshRun: undefined }
          }
          if (command !== COMMAND_NAME) return previous
          if (args.length === 0 || args === 'refresh') {
            return { ...previous, revision: previous.revision + 1 }
          }
          const selectedId = args === 'default' || args === 'none' ? 'auto' : args
          return {
            ...previous,
            pendingEnv: {
              id: event.data.commandId,
              selectedId,
              sshCommand: previous.sshCommand,
              sshArgs: previous.sshArgs,
            },
          }
        },
        wire: {
          viewSchema,
          view: (projected) => {
            const target = resolveMirroredTarget(projected.sshCommand, projected.sshArgs)
            const selectedTarget = resolveMirroredTarget(projected.selectedSshCommand, projected.selectedSshArgs)
            const sameTarget = target.key === selectedTarget.key
            const record = catalogs.get(target.key)
            const env = projected.selectedId === 'auto' || !sameTarget
              ? undefined
              : findEnvironment(record?.environments ?? [], projected.selectedId)
            const selectedActive = projected.selectedId === 'auto'
              || (sameTarget && env !== undefined)
            return {
              target: target.name,
              targetKind: target.kind,
              targetAddress: target.address ?? '',
              selectedId: env?.id ?? 'auto',
              selectedLabel: env === undefined ? 'auto' : environmentDisplayLabel(env),
              selectedKind: env?.kind ?? 'auto',
              selectedPath: env?.pythonPath ?? '',
              selectedActive,
              environments: record?.environments ?? [],
              loading: record === undefined,
              error: record?.error ?? '',
              revision: projected.revision,
            }
          },
          summary: true,
        },
      })
    } catch (error) {
      warn(ctx, `could not register environment projection: ${String(error)}`)
    }
  }

  ctx.effect(() => () => {
    disposed = true
    disposeCommands()
  }, 'python-env: registration lifetime')

  // Model-facing tools. They read the live selection and refresh the catalog on
  // demand, so a newly created conda environment is visible without a reload.
  ctx.tools.register(defineTool({
    name: 'python_envs',
    description: [
      'List the Python interpreters and conda environments discovered on the current execution target.',
      'The list comes from the same target selector as ssh_exec: localhost uses this machine, an SSH host is queried over OpenSSH.',
      'Use refresh=true to bypass the short discovery cache after creating or deleting an environment.',
    ].join(' '),
    parameters: {
      refresh: {
        type: 'boolean',
        description: 'Run discovery again instead of using the cached catalog.',
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args, exec) {
      if (exec.signal.aborted) throw new Error('python_envs was cancelled')
      const target = ctx.sshExecution.resolveSession(exec.agent.session)
      const record = await ensureCatalog(target, { force: args.refresh === true, signal: exec.signal })
      const selection = selectionFor(exec.agent.session)
      const effective = selection.env === undefined ? 'auto' : environmentDisplayLabel(selection.env)
      const lines = [
        `Target: ${targetSummary(target)}`,
        `Selected: ${effective}`,
        '',
        'Environments (auto uses the target default):',
        `- auto — ${defaultPythonFor(record.environments)?.pythonPath ?? 'default python3 on the target'}`,
        formatEnvironmentTable(record.environments),
      ]
      if (record.error !== undefined) lines.push('', `Discovery note: ${record.error}`)
      return lines.join('\n')
    },
    presentCall: () => ({ card: 'generic', title: 'List Python environments', kind: 'read' }),
  }))

  ctx.tools.register(defineTool({
    name: 'python_exec',
    description: [
      'Run Python code with the Python environment selected in the Python environment bar on the current execution target.',
      'The code is passed to the interpreter\'s -c option; stdout and stderr are returned with the exit code.',
      'The selected conda environment exports PATH, CONDA_PREFIX, and CONDA_DEFAULT_ENV before the interpreter starts.',
      'When the current target is an SSH host the code runs there through OpenSSH; when it is localhost it runs in this machine\'s local shell.',
      'Use python_envs to see which interpreters and conda environments exist on the target.',
    ].join(' '),
    parameters: {
      code: {
        type: 'string',
        required: true,
        description: 'Python source code to execute with the selected interpreter.',
      },
      workdir: {
        type: 'string',
        description: 'Directory to enter before running the code.',
      },
      timeoutMs: {
        type: 'number',
        description: `Milliseconds before the process is killed. Defaults to ${settings.defaultTimeoutMs}; at most ${settings.maxTimeoutMs}.`,
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          target: { type: 'string', required: true },
          targetKind: { type: 'string', required: true },
          environment: { type: 'string', required: true },
          pythonPath: { type: 'string', required: true },
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
      if (args.code.trim().length === 0) throw new Error('python_exec code must be a non-empty string')
      const selection = await resolveSelectionForExecution(exec.agent.session, exec.signal)
      let env = selection.env
      let pythonPath = env?.pythonPath
      if (pythonPath === undefined) {
        const fallback = defaultPythonFor(selection.record.environments)
        env = fallback
        pythonPath = fallback?.pythonPath ?? 'python3'
      }
      const command = buildPythonCommand(env, pythonPath, args.code)
      const timeoutMs = positiveInteger(args.timeoutMs, settings.defaultTimeoutMs, 1_000, settings.maxTimeoutMs)
      const result = await ctx.sshExecution.run({
        target: selection.target,
        command,
        workdir: args.workdir,
        timeoutMs,
        maxOutputBytes: settings.maxOutputBytes,
        signal: exec.signal,
      })
      return {
        target: selection.target.name,
        targetKind: selection.target.kind,
        environment: env === undefined ? 'auto' : environmentDisplayLabel(env),
        pythonPath,
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
      title: 'python_exec',
      kind: 'execute',
      rawInput: args.code,
    }),
  }))

  ctx.systemPrompt.section({
    name: 'python:environment',
    order: PROMPT_ORDER,
    interpolate: false,
    text: (promptContext) => {
      const agent = promptContext?.agent
      const selection = agent === undefined
        ? { state: undefined, target: ctx.sshExecution.resolveState({ command: LOCAL_COMMAND, args: '' }), env: undefined, sameTarget: true, cached: undefined }
        : selectionFor(agent.session)
      const target = selection.target
      const env = selection.env
      const lines = ['## Python environment', '', `Execution target: **${targetSummary(target)}**.`]
      if (target.kind === 'unknown') {
        lines.push(
          'The target selection is unresolved, so no environment can be verified.',
          'Ask the user to pick localhost or an SSH host in the target bar before running Python work.',
        )
        return lines.join('\n')
      }
      if (env !== undefined) {
        lines.push(
          `Selected: **${environmentDisplayLabel(env)}** — ${env.path}${env.version.length > 0 ? ` (Python ${env.version})` : ''}.`,
          `Python interpreter: \`${env.pythonPath}\``,
          `Activation: \`${activationHint(env, env.pythonPath)}\``,
          '',
          'Use this environment for every Python, pip, conda, pytest, or Jupyter command.',
        )
        if (target.kind === 'host') {
          lines.push(
            `The target is remote: pass the activation prefix and the command to \`ssh_exec\` with host \`${target.name}\`.`,
            'If the activation command is unavailable, invoke the interpreter path directly inside the ssh_exec command.',
            'Local tools still operate on this machine and do not see the remote filesystem.',
          )
        } else {
          lines.push('On localhost, prefix bash commands with the activation command above, or invoke the interpreter path directly.')
          if (shellEnvAvailable) {
            lines.push(
              'The local bash tool exports DSH_PYTHON, DSH_PYTHON_ENV, and (for conda) DSH_CONDA_PREFIX for this selection.',
              'Prefer `"$DSH_PYTHON"` for Python invocations and `"$DSH_PYTHON" -m pip` for pip; that avoids depending on PATH resolution.',
            )
          }
        }
      } else {
        const recordedId = selection.state !== undefined && selection.state.selectedId !== 'auto'
          ? selection.state.selectedId
          : undefined
        const stale = recordedId !== undefined && !selection.sameTarget
        const pending = recordedId !== undefined && selection.sameTarget && selection.cached === undefined
        const missing = recordedId !== undefined && selection.sameTarget && selection.cached !== undefined
        if (pending) {
          lines.push(
            `Selected: recorded environment \`${recordedId}\` on this target, but its catalog has not been loaded in this process yet.`,
            'Call `python_envs` (or ask the user to open the Python environment bar) to discover it before running Python work; do not assume the target default.',
          )
        } else if (missing) {
          lines.push(
            `Selected: recorded environment \`${recordedId}\`, but it is not in the current catalog for this target (it may have been removed).`,
            'Ask the user to pick an environment again; do not silently use a different environment.',
          )
        } else {
          lines.push(
            stale
              ? 'The previously selected environment belongs to a different target; the effective selection is **auto**. Ask the user to choose an environment for this target.'
              : 'Selected: **auto** — the target\'s default interpreter.',
            'For Python work use `python3` (falling back to `python`), or ask the user to pick an environment in the Python environment bar.',
          )
        }
        if (target.kind === 'host') {
          lines.push(`Run commands on this host through \`ssh_exec\` with host \`${target.name}\`.`)
        } else {
          lines.push('On localhost, use the local tools (bash, read, write, edit).')
        }
      }
      const record = selection.cached
      if (record?.error !== undefined) {
        lines.push('', `Environment discovery note: ${record.error}`)
      }
      lines.push(
        '',
        'Use `python_envs` to list interpreters and conda environments on the current target, and `python_exec` to run code with the selected interpreter.',
        'When the user switches the target or environment, follow the newest selection for subsequent commands.',
      )
      return lines.join('\n')
    },
  })

  ctx.inject(['commands'], (commandsCtx) => {
    commandContext = commandsCtx
    registerCommands()
    return () => {
      commandContext = undefined
      disposeCommands()
    }
  })

  // Expose the selection to local bash calls as trusted DSH_* facts. Only
  // localhost selections are exported; a remote path must not shadow the
  // local interpreter in local commands.
  ctx.inject(['shellEnv'], (shellCtx) => {
    let dispose
    try {
      dispose = shellCtx.shellEnv.register({
        name: 'python-env',
        variables: {
          DSH_PYTHON: { description: 'Python interpreter selected for the current target.' },
          DSH_PYTHON_ENV: { description: 'Display label of the selected Python environment.' },
          DSH_CONDA_PREFIX: { description: 'Conda environment root selected for the current target.' },
        },
        resolve: (execution) => {
          const agent = execution.agent
          if (agent === undefined) return {}
          const selection = selectionFor(agent.session)
          if (selection.target.kind !== 'localhost' || selection.env === undefined) return {}
          const values = {
            DSH_PYTHON: selection.env.pythonPath,
            DSH_PYTHON_ENV: selection.env.label,
          }
          if (selection.env.kind === 'conda') values.DSH_CONDA_PREFIX = selection.env.path
          return values
        },
      })
      shellEnvAvailable = true
    } catch (error) {
      warn(ctx, `could not register shell env facts: ${String(error)}`)
      return
    }
    return () => {
      shellEnvAvailable = false
      try { dispose() } catch { /* already gone */ }
    }
  })

  // Re-assert the selected interpreter on every user turn.
  ctx.on('agent/pre-step', async ({ agent, messages }, next) => {
    const decision = await next()
    if (decision.kind === 'reject' || !hasUserMessage(messages)) return decision
    try {
      return {
        ...decision,
        messages: withSettingsSection(decision.messages, {
          name: 'Python environment',
          text: settingsEnvironmentText(selectionFor(agent.session)),
        }),
      }
    } catch (error) {
      warn(ctx, `settings reminder failed: ${String(error)}`)
      return decision
    }
  })

  void initializeProjection()
}
