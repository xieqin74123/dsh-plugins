/**
 * CPU allocation selector for DeepSeek Harness.
 *
 * The plugin reads the number of *physical* cores available on the current
 * execution target and lets the user allocate a number of them to the
 * conversation. The selector is a session-durable bar above the composer,
 * below the SSH target bar and the Python environment bar.
 *
 * The SSH plugin is an optional dependency: when its `sshExecution` service is
 * present, the target follows the SSH target bar and CPU information is read on
 * that host through the same non-interactive path as `ssh_exec`. Without it the
 * plugin only reads this machine (localhost) and still works on its own.
 *
 * The allocation is folded into a `cpu-alloc` session projection so reloads,
 * reconnects, and resumed sessions keep it. A system-prompt section and the
 * `cpu_info` tool tell the Agent the target's topology and the allocation, and
 * the local bash tool receives `DSH_CPUS` / `DSH_CPU_PHYSICAL` /
 * `DSH_CPU_LOGICAL` facts on localhost.
 *
 * @module @local/dsh-cpu-alloc
 */

import z from '@deepseek-ai/schemastery'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { z as zod } from 'zod'

import { runLocalCommand } from './lib/local-exec.js'
import {
  availableCoresOf,
  buildCpuProbeScript,
  describeCpuRecord,
  effectiveCores,
  formatCoreCount,
  parseCpuProbeOutput,
} from './lib/probe.js'

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
export const name = 'cpu-alloc'

/** Required services; `commands` and `shellEnv` are optional and injected below. */
export const inject = ['tools', 'systemPrompt', 'sessionProjections']

/** Tunables live in the user's patch layer so they survive upgrades. */
export const Config = z.object({
  /** Timeout for one CPU probe on a target, in milliseconds. */
  discoveryTimeoutMs: z.number().default(15_000),
  /** How long a probe result is reused before the next refresh. */
  cacheTtlMs: z.number().default(60_000),
  /** Tail retained per output stream, in bytes/characters. */
  maxOutputBytes: z.number().default(65_536),
  /** Hard ceiling for a reported core count, to keep messages and UIs sane. */
  maxCores: z.number().default(4_096),
  /** Register the human `/cpu` command. */
  enableCommands: z.boolean().default(true),
})

const COMMAND_NAME = 'cpu'
const PROJECTION_KEY = 'cpu-alloc'
const PROMPT_ORDER = 5200
const LOCAL_COMMAND = 'ssh-local'

/** The localhost target used when the SSH plugin is not loaded. */
const LOCAL_TARGET = Object.freeze({ kind: 'localhost', name: 'localhost', key: 'localhost' })

/** Internal projection state: the mirrored SSH target plus the allocation. */
const stateSchema = zod.object({
  sshCommand: zod.string(),
  sshArgs: zod.string(),
  /** In-flight `/ssh` invocation; the target commits only after success. */
  pendingSshRun: zod.object({
    id: zod.string(),
    args: zod.string(),
  }).optional(),
  /** In-flight `/cpu` selection; the allocation commits only after success. */
  pendingCpu: zod.object({
    id: zod.string(),
    cores: zod.number(),
    sshCommand: zod.string(),
    sshArgs: zod.string(),
  }).optional(),
  /** Allocated physical cores; `0` means "all available". */
  selectedCores: zod.number(),
  selectedSshCommand: zod.string(),
  selectedSshArgs: zod.string(),
  revision: zod.number(),
})

/** Client-visible allocation and the CPU catalog for the current target. */
const viewSchema = zod.object({
  target: zod.string(),
  targetKind: zod.enum(['localhost', 'host', 'unknown']),
  targetAddress: zod.string(),
  physical: zod.number(),
  logical: zod.number(),
  affinity: zod.number(),
  quota: zod.number(),
  available: zod.number(),
  selectedCores: zod.number(),
  effectiveCores: zod.number(),
  selectedActive: zod.boolean(),
  loading: zod.boolean(),
  error: zod.string(),
  revision: zod.number(),
})

function warn(ctx, message) {
  try {
    ctx.logger?.warn(`cpu-alloc: ${message}`)
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
    selectedCores: 0,
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

/** The empty catalog record used for failures and unresolved targets. */
function emptyRecord(error) {
  return {
    loadedAt: Date.now(),
    os: '',
    source: '',
    physical: 0,
    logical: 0,
    affinity: 0,
    quota: 0,
    available: 0,
    warnings: [],
    ...error === undefined ? {} : { error },
  }
}

/** One-line CPU budget for the per-turn settings snapshot. */
function settingsCpuText(selection) {
  if (selection.target.kind === 'unknown') return 'No target yet — pick localhost or a host before planning parallel work.'
  if (!(selection.available > 0)) return 'The target core count is not known yet; run `cpu_info` before planning parallel work.'
  const cores = selection.effective
  const budget = selection.requested > 0
    ? `${selection.requested} of ${formatCoreCount(selection.available)} allocated`
    : `all ${formatCoreCount(selection.available)} available`
  const where = selection.target.kind === 'host' ? ` on SSH host \`${selection.target.name}\`` : ' on this machine'
  return `${budget}${where} — keep parallel commands at -j ${cores} (or OMP_NUM_THREADS=${cores}, MKL_NUM_THREADS=${cores}).`
}

export function apply(ctx, config = {}) {
  const settings = {
    discoveryTimeoutMs: positiveInteger(config.discoveryTimeoutMs, 15_000, 1_000, 86_400_000),
    cacheTtlMs: positiveInteger(config.cacheTtlMs, 60_000, 1_000, 86_400_000),
    maxOutputBytes: positiveInteger(config.maxOutputBytes, 65_536, 1_024, 16 * 1024 * 1024),
    maxCores: positiveInteger(config.maxCores, 4_096, 1, 100_000),
    enableCommands: config.enableCommands !== false,
  }

  /** target key → probe record */
  const catalogs = new Map()
  /** target key → in-flight probe */
  const inflight = new Map()
  let projection
  let disposed = false
  let commandContext
  let commandDisposers = []
  let shellEnvAvailable = false

  function sshService() {
    if (disposed) return undefined
    try {
      return ctx.get('sshExecution')
    } catch {
      return undefined
    }
  }

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

  /**
   * Resolve one mirrored `ssh-target` state to a target. Without the SSH plugin
   * only localhost exists: a historical remote selection must not be applied to
   * this machine, so it becomes an unresolved target instead.
   */
  function resolveMirroredTarget(command, args) {
    const local = command === LOCAL_COMMAND || command === '' || command === undefined
    const ssh = sshService()
    if (ssh === undefined) {
      if (local) return LOCAL_TARGET
      const name = typeof args === 'string' && args.length > 0 ? args : String(command)
      return { kind: 'unknown', name, key: `unknown:${name}` }
    }
    try {
      return ssh.resolveState({ command, args })
    } catch {
      const name = typeof args === 'string' && args.length > 0 ? args : String(command)
      return { kind: 'unknown', name, key: `unknown:${name}` }
    }
  }

  /** The target the session is actually on: SSH target when available, else localhost. */
  function resolveSessionTarget(session) {
    const ssh = sshService()
    if (ssh === undefined) return LOCAL_TARGET
    try {
      return ssh.resolveSession(session)
    } catch {
      return LOCAL_TARGET
    }
  }

  /**
   * The target a mirrored `ssh-target` state maps to for the current session.
   * Without the SSH plugin a remote mirror is not a real target here: this
   * machine is, so only a local mirror keeps its meaning.
   */
  function currentTargetForState(projected) {
    if (sshService() === undefined) return LOCAL_TARGET
    return resolveMirroredTarget(projected.sshCommand, projected.sshArgs)
  }

  function selectionFor(session) {
    const state = readSelectionState(session) ?? initialSelectionState()
    const target = resolveSessionTarget(session)
    const selectedTarget = resolveMirroredTarget(state.selectedSshCommand, state.selectedSshArgs)
    const sameTarget = target.key === selectedTarget.key
    const record = catalogs.get(target.key)
    const available = availableCoresOf(record)
    const requested = sameTarget && state.selectedCores > 0 ? state.selectedCores : 0
    const effective = effectiveCores(requested, available)
    return { state, target, record, sameTarget, requested, available, effective }
  }

  async function runOnTarget(target, command, options) {
    const ssh = sshService()
    if (ssh !== undefined) {
      return ssh.run({
        target,
        command,
        timeoutMs: options.timeoutMs,
        maxOutputBytes: options.maxOutputBytes,
        signal: options.signal,
      })
    }
    if (target.kind !== 'localhost') {
      throw new Error(`the execution target ${target.name} needs the SSH plugin, which is not loaded`)
    }
    return runLocalCommand({
      command,
      timeoutMs: options.timeoutMs,
      maxOutputBytes: options.maxOutputBytes,
      signal: options.signal,
    })
  }

  /**
   * Probe one target, reusing a fresh cached record. Concurrent callers share
   * one probe; `force` bypasses the cache but still joins an in-flight probe.
   */
  async function ensureCatalog(target, options = {}) {
    if (target.kind === 'unknown') {
      const record = emptyRecord(
        `The execution target is unresolved (${target.name}); choose localhost or an SSH host in the target bar first.`,
      )
      catalogs.set(target.key, record)
      return record
    }
    const key = target.key
    const cached = catalogs.get(key)
    const fresh = cached !== undefined
      && cached.error === undefined
      && (Date.now() - cached.loadedAt) < settings.cacheTtlMs
    if (!options.force && fresh) return cached
    const running = inflight.get(key)
    if (running !== undefined) return running

    const script = buildCpuProbeScript()
    const promise = (async () => {
      let result
      try {
        result = await runOnTarget(target, script, {
          timeoutMs: settings.discoveryTimeoutMs,
          maxOutputBytes: settings.maxOutputBytes,
          signal: options.signal,
        })
      } catch (error) {
        const record = emptyRecord(`Could not read CPU information on ${targetSummary(target)}: ${errorMessage(error)}`)
        catalogs.set(key, record)
        return record
      }
      if (disposed) return emptyRecord('the plugin is unloading')

      const probe = parseCpuProbeOutput(result.stdout, result.stderr, { maxCores: settings.maxCores })
      let error
      if (result.timedOut) {
        error = `CPU discovery timed out after ${Math.round(result.durationMs)}ms on ${targetSummary(target)}.`
      } else if (result.spawnError !== undefined) {
        error = `Could not start CPU discovery on ${targetSummary(target)}: ${result.spawnError}`
      } else if (result.aborted) {
        error = 'CPU discovery was cancelled.'
      } else if (probe.physical === 0) {
        const tail = probe.warnings.join(' ').trim()
        error = `The target did not report a physical CPU count${tail.length > 0 ? `: ${tail}` : '.'}`
      } else if (result.exitCode !== undefined && result.exitCode !== 0) {
        error = `CPU discovery exited with code ${result.exitCode} on ${targetSummary(target)}; the reported counts may be partial.`
      }

      const record = {
        loadedAt: Date.now(),
        os: probe.os,
        source: probe.source,
        physical: probe.physical,
        logical: probe.logical,
        affinity: probe.affinity,
        quota: probe.quota,
        available: availableCoresOf(probe),
        warnings: probe.warnings,
        ...error === undefined ? {} : { error },
      }
      catalogs.set(key, record)
      return record
    })().finally(() => {
      inflight.delete(key)
    })
    inflight.set(key, promise)
    return promise
  }

  function allocationLine(selection) {
    if (selection.target.kind === 'unknown') return 'Allocated: unknown (the execution target is unresolved).'
    if (selection.record === undefined) return 'Allocated: not read yet.'
    if (selection.available <= 0) return 'Allocated: unknown (no CPU count was read).'
    if (selection.requested > 0) {
      return `Allocated: ${formatCoreCount(selection.effective)} of ${formatCoreCount(selection.available)} (chosen by the user).`
    }
    return `Allocated: every available core (${formatCoreCount(selection.available)}).`
  }

  function availabilityLine(selection) {
    if (selection.target.kind === 'unknown') {
      return 'The execution target is unresolved; choose localhost or an SSH host in the target bar first.'
    }
    if (selection.record === undefined) {
      return 'CPU information for this target has not been read yet; call cpu_info or run /cpu to probe it.'
    }
    if (selection.record.physical <= 0) {
      return `Could not read CPU information${selection.record.error === undefined ? '.' : `: ${selection.record.error}`}`
    }
    return `Available: ${describeCpuRecord(selection.record)}`
  }

  function guidanceLines(selection) {
    const lines = []
    const cores = selection.effective
    if (selection.target.kind === 'localhost' && shellEnvAvailable && cores > 0) {
      lines.push('The local bash tool exports DSH_CPUS, DSH_CPU_PHYSICAL, and DSH_CPU_LOGICAL; `-j "$DSH_CPUS"` follows the allocation.')
    }
    if (cores > 0) {
      lines.push(`Keep one CPU-heavy command to about ${formatCoreCount(cores)}: -j ${cores}, --threads ${cores}, OMP_NUM_THREADS=${cores}, MKL_NUM_THREADS=${cores}, or an equivalent limit.`)
      lines.push('Do not raise the allocation on your own; the user changes it in the CPU bar above the composer or with /cpu <n>.')
    } else {
      lines.push('Plan parallel work only after the target CPU count is known; run cpu_info or ask the user to pick a target in the target bar.')
    }
    if (selection.target.kind === 'host') {
      lines.push(`The target is remote: pass these limits inside the command you send through ssh_exec with host "${selection.target.name}".`)
    }
    return lines
  }

  function selectionContextText(selection) {
    const lines = [
      `The user allocated ${formatCoreCount(selection.effective)} (of ${formatCoreCount(selection.available)} available) to this conversation on the current execution target: ${targetSummary(selection.target)}.`,
      'Treat that number as the CPU budget for every parallel or CPU-bound command in this conversation.',
      ...guidanceLines(selection),
    ]
    return lines.join('\n')
  }

  function allContextText(selection) {
    const lines = [
      `The user cleared the explicit CPU allocation on the current execution target: ${targetSummary(selection.target)}.`,
      selection.available > 0
        ? `Use at most all ${formatCoreCount(selection.available)} available on this target; prefer the target default parallelism.`
        : 'Use the target default parallelism after its CPU count is known.',
      ...guidanceLines(selection),
    ]
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
        description: 'List available physical CPU cores, or allocate cores to this conversation',
        input: { hint: '[all|<cores>|refresh]' },
        handler: async ({ agent, rawInput }) => {
          const input = rawInput.trim().replace(/^@/, '').toLowerCase()
          const target = resolveSessionTarget(agent.session)
          if (target.kind === 'unknown') {
            return {
              kind: 'error',
              text: `The execution target is unresolved (${target.name}). Choose localhost or an SSH host in the target bar first.`,
            }
          }
          if (input.length === 0 || input === 'refresh') {
            const record = await ensureCatalog(target, { force: input === 'refresh' })
            const selection = selectionFor(agent.session)
            const lines = [
              `Target: ${targetSummary(target)}`,
              availabilityLine(selection),
              allocationLine(selection),
            ]
            if (record.warnings.length > 0) lines.push('', `Probe note: ${record.warnings.join(' ')}`)
            if (record.error !== undefined && record.physical > 0) lines.push('', `Probe note: ${record.error}`)
            lines.push(
              '',
              'Usage:',
              '- /cpu <n> — allocate n physical cores to this conversation',
              '- /cpu all — use every available core',
              '- /cpu refresh — probe the target again',
            )
            return { kind: 'success', text: lines.join('\n') }
          }
          if (input === 'all' || input === 'auto' || input === 'none' || input === '0') {
            const selection = selectionFor(agent.session)
            if (selection.record === undefined) await ensureCatalog(target)
            try {
              agent.inject(createUserMessage({
                content: [{ type: 'text', text: allContextText(selectionFor(agent.session)) }],
                source: { kind: 'user' },
              }))
            } catch (error) {
              return { kind: 'error', text: `Could not clear the CPU allocation: ${errorMessage(error)}` }
            }
            return { kind: 'success', text: `CPU allocation on ${targetSummary(target)}: all available cores.` }
          }
          if (!/^\d+$/.test(input)) {
            return { kind: 'error', text: `Expected a core count, "all", or "refresh"; got "${input}".` }
          }
          const cores = Number.parseInt(input, 10)
          if (!Number.isFinite(cores) || cores < 1) {
            return { kind: 'error', text: `A CPU allocation must be at least 1 physical core; got "${input}".` }
          }
          const record = await ensureCatalog(target)
          const available = availableCoresOf(record)
          if (available <= 0) {
            return {
              kind: 'error',
              text: `Could not determine the available physical cores on ${targetSummary(target)}${record.error === undefined ? '.' : `: ${record.error}`}`,
            }
          }
          if (cores > available) {
            return {
              kind: 'error',
              text: `Only ${formatCoreCount(available)} are available on ${targetSummary(target)}; choose 1–${available}.`,
            }
          }
          const selection = selectionFor(agent.session)
          try {
            agent.inject(createUserMessage({
              content: [{ type: 'text', text: selectionContextText({ ...selection, target, record, available, requested: cores, effective: cores }) }],
              source: { kind: 'user' },
            }))
          } catch (error) {
            return { kind: 'error', text: `Could not allocate CPU cores: ${errorMessage(error)}` }
          }
          return {
            kind: 'success',
            text: `CPU allocation on ${targetSummary(target)}: ${formatCoreCount(cores)} of ${available}. The Agent will use that budget with your next message.`,
          }
        },
      }))
    } catch (error) {
      warn(ctx, `could not register /${COMMAND_NAME}: ${String(error)}`)
    }
  }

  async function initializeProjection() {
    // Wait for the SSH catalog before the first view is computed, so a resumed
    // session with a remote target does not publish an "unknown" target that no
    // later state change would refresh. Without the SSH plugin this is skipped.
    const ssh = sshService()
    if (ssh !== undefined) {
      try {
        await Promise.race([
          ssh.ready(),
          new Promise((resolve) => setTimeout(resolve, 8_000)),
        ])
      } catch {
        // The plugin still works with the SSH service's partially loaded catalog.
      }
    }
    if (disposed || projection !== undefined) return
    try {
      projection = await ctx.sessionProjections.register({
        key: PROJECTION_KEY,
        stateSchema,
        stateVersion: 1,
        init: () => initialSelectionState(),
        apply: (previous, event) => {
          // Discovery is asynchronous and starts after `command/run` is
          // appended. `command/done` is the first event guaranteed to arrive
          // after the handler populated the catalog, so every completion bumps
          // the revision and makes the client view recompute with fresh data.
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
            const pendingCpu = previous.pendingCpu
            if (pendingCpu !== undefined && pendingCpu.id === event.data.commandId) {
              next.pendingCpu = undefined
              // Only a successful selection command commits the allocation; an
              // unknown target or a failed context injection leaves it intact.
              if (event.data.kind === 'success') {
                next.selectedCores = pendingCpu.cores
                next.selectedSshCommand = pendingCpu.sshCommand
                next.selectedSshArgs = pendingCpu.sshArgs
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
          const lowered = args.toLowerCase()
          let cores
          if (lowered === 'all' || lowered === 'auto' || lowered === 'none' || lowered === '0') {
            cores = 0
          } else if (/^\d+$/.test(lowered)) {
            cores = Number.parseInt(lowered, 10)
          }
          if (cores === undefined) return previous
          return {
            ...previous,
            pendingCpu: {
              id: event.data.commandId,
              cores,
              sshCommand: previous.sshCommand,
              sshArgs: previous.sshArgs,
            },
          }
        },
        wire: {
          viewSchema,
          view: (projected) => {
            const target = currentTargetForState(projected)
            const selectedTarget = resolveMirroredTarget(projected.selectedSshCommand, projected.selectedSshArgs)
            const sameTarget = target.key === selectedTarget.key
            const record = catalogs.get(target.key)
            const available = availableCoresOf(record)
            const requested = sameTarget && projected.selectedCores > 0 ? projected.selectedCores : 0
            return {
              target: target.name,
              targetKind: target.kind,
              targetAddress: target.address ?? '',
              physical: record?.physical ?? 0,
              logical: record?.logical ?? 0,
              affinity: record?.affinity ?? 0,
              quota: record?.quota ?? 0,
              available,
              selectedCores: requested,
              effectiveCores: effectiveCores(requested, available),
              selectedActive: sameTarget,
              loading: record === undefined && target.kind !== 'unknown',
              error: record?.error ?? '',
              revision: projected.revision,
            }
          },
          summary: true,
        },
      })
    } catch (error) {
      warn(ctx, `could not register CPU projection: ${String(error)}`)
    }
  }

  ctx.effect(() => () => {
    disposed = true
    disposeCommands()
  }, 'cpu-alloc: registration lifetime')

  // Model-facing tool. It reads the live selection and probes on demand, so a
  // machine whose topology changed is visible without a reload.
  ctx.tools.register(defineTool({
    name: 'cpu_info',
    description: [
      'Report the physical CPU cores available on the current execution target and the allocation chosen for this conversation.',
      'The target follows the target bar: localhost reads this machine, an SSH host is queried through OpenSSH when the SSH plugin is loaded.',
      'Physical cores are unique socket/core pairs, not SMT threads; the result also shows the logical CPU count, process affinity, and any cgroup quota, which can all lower the usable ceiling.',
      'Call this before choosing parallelism for a build or compute job, and set refresh=true after a topology or allocation change.',
    ].join(' '),
    parameters: {
      refresh: {
        type: 'boolean',
        description: 'Probe the target again instead of using the cached result.',
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args, exec) {
      if (exec.signal.aborted) throw new Error('cpu_info was cancelled')
      const selection = selectionFor(exec.agent.session)
      const record = await ensureCatalog(selection.target, {
        force: args.refresh === true,
        signal: exec.signal,
      })
      const current = selectionFor(exec.agent.session)
      const lines = [
        `Target: ${targetSummary(current.target)}`,
        availabilityLine(current),
        allocationLine(current),
      ]
      if (record.source.length > 0) {
        lines.push(`Probe: ${record.os.length > 0 ? record.os : 'unknown OS'} via ${record.source}.`)
      }
      if (record.warnings.length > 0) lines.push(`Probe note: ${record.warnings.join(' ')}`)
      if (record.error !== undefined) lines.push(`Probe note: ${record.error}`)
      lines.push('')
      lines.push(...guidanceLines(current))
      return lines.join('\n')
    },
    presentCall: () => ({ card: 'generic', title: 'CPU information', kind: 'read' }),
  }))

  ctx.systemPrompt.section({
    name: 'cpu:allocation',
    order: PROMPT_ORDER,
    interpolate: false,
    text: (promptContext) => {
      const agent = promptContext?.agent
      const selection = agent === undefined
        ? {
            state: undefined,
            target: LOCAL_TARGET,
            record: catalogs.get(LOCAL_TARGET.key),
            sameTarget: true,
            requested: 0,
            available: availableCoresOf(catalogs.get(LOCAL_TARGET.key)),
            effective: availableCoresOf(catalogs.get(LOCAL_TARGET.key)),
          }
        : selectionFor(agent.session)
      const target = selection.target
      const record = selection.record
      // Warm the catalog for the next message when the first prompt arrives
      // before the initial probe finished. The view republishes when it lands.
      if (agent !== undefined && record === undefined && target.kind !== 'unknown') {
        void ensureCatalog(target).catch(() => {})
      }
      const lines = ['## CPU allocation', '', `Execution target: **${targetSummary(target)}**.`]
      if (target.kind === 'unknown') {
        lines.push(
          'The execution target is unresolved, so no CPU count is known.',
          'Ask the user to pick localhost or an SSH host in the target bar before planning parallel work.',
        )
        return lines.join('\n')
      }
      if (record === undefined) {
        lines.push(
          'Available: not read yet for this target.',
          'Call `cpu_info` before choosing a parallelism level; do not assume the machine\'s core count.',
        )
      } else if (record.physical <= 0) {
        lines.push(`Available: unknown${record.error === undefined ? '.' : ` — ${record.error}`}`)
      } else {
        lines.push(`Available: **${describeCpuRecord(record)}**.`)
        if (selection.requested > 0) {
          lines.push(
            `Allocated to this conversation: **${formatCoreCount(selection.effective)}** of ${formatCoreCount(selection.available)}.`,
          )
        } else {
          lines.push(`Allocated to this conversation: **all ${formatCoreCount(selection.available)}**.`)
          if (selection.state !== undefined && selection.state.selectedCores > 0 && !selection.sameTarget) {
            lines.push(
              `A recorded allocation of ${formatCoreCount(selection.state.selectedCores)} belongs to a different target, so it does not apply here.`,
            )
          }
        }
        lines.push('', ...guidanceLines(selection))
      }
      if (record?.error !== undefined) lines.push('', `CPU probe note: ${record.error}`)
      lines.push(
        '',
        'Use `cpu_info` to re-read the target, and follow the allocation shown in the CPU bar above the composer.',
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

  // Expose the allocation to local bash calls as trusted DSH_* facts. Only a
  // localhost target is exported; remote paths must not shadow local commands.
  ctx.inject(['shellEnv'], (shellCtx) => {
    let dispose
    try {
      dispose = shellCtx.shellEnv.register({
        name: 'cpu-alloc',
        variables: {
          DSH_CPUS: { description: 'Physical cores allocated to the current conversation.' },
          DSH_CPU_PHYSICAL: { description: 'Available physical cores on the local execution target.' },
          DSH_CPU_LOGICAL: { description: 'Logical CPUs on the local execution target.' },
        },
        resolve: (execution) => {
          const agent = execution.agent
          if (agent === undefined || disposed) return {}
          const selection = selectionFor(agent.session)
          if (selection.target.kind !== 'localhost') return {}
          if (selection.record === undefined || selection.available <= 0) return {}
          const allocated = selection.requested > 0
            ? Math.min(selection.requested, selection.available)
            : selection.available
          const values = {
            DSH_CPUS: String(allocated),
            DSH_CPU_PHYSICAL: String(selection.available),
          }
          if (selection.record.logical > 0) {
            values.DSH_CPU_LOGICAL = String(selection.record.logical)
          }
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

  async function initialize() {
    await initializeProjection()
    if (disposed) return
    // Warm localhost so the chip and DSH_CPUS are populated without opening
    // the menu. A remote target probes lazily when its bar is opened.
    try {
      await ensureCatalog(LOCAL_TARGET)
    } catch (error) {
      warn(ctx, `initial CPU probe failed: ${String(error)}`)
    }
  }

  // Re-assert the CPU budget on every user turn.
  ctx.on('agent/pre-step', async ({ agent, messages }, next) => {
    const decision = await next()
    if (decision.kind === 'reject' || !hasUserMessage(messages)) return decision
    try {
      return {
        ...decision,
        messages: withSettingsSection(decision.messages, {
          name: 'CPU allocation',
          text: settingsCpuText(selectionFor(agent.session)),
        }),
      }
    } catch (error) {
      warn(ctx, `settings reminder failed: ${String(error)}`)
      return decision
    }
  })

  void initialize()
}
