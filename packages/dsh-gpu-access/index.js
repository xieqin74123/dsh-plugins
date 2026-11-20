/**
 * GPU device-access switch for DeepSeek Harness.
 *
 * The shipped bash sandbox confines every command (Landlock on this host) with
 * a writable allow-list of the workspace, the temp areas, and `/dev/null` only.
 * CUDA opens `/dev/nvidiactl`, `/dev/nvidia0`, `/dev/nvidia-uvm`, ... read-write,
 * so inside the sandbox those opens fail with EACCES. The only sanctioned way to
 * run that command today is a retry with `sandbox_permissions:
 * danger-full-access`, which asks the user for a one-shot approval every time.
 *
 * This plugin replaces that per-command approval with one switch:
 *
 *  - The active sandbox provider is wrapped so that, while the switch is on, the
 *    configured device roots (by default `/dev` and `/dev/shm`) join the policy's
 *    `additionalWritableRoots` for that call. Every enforcement dialect derives
 *    its allow-list from that field, so the Landlock launcher receives
 *    `--rw /dev --rw /dev/shm`: CUDA can open and `ioctl` the NVIDIA nodes while
 *    the workspace stays the only writable data area. Nothing else changes.
 *  - The switch is session-durable: `/gpu on|off` (or the GPU pill above the
 *    composer) writes ordinary command events, and a `gpu-access` session
 *    projection folds them, so the state survives reload and resume.
 *
 * The wrap is an own-property override of `confine` on the live provider
 * instance, so it works on a running profile without a restart; it re-wraps
 * itself if the provider instance is ever replaced.
 *
 * @module @local/dsh-gpu-access
 */

import { Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { existsSync } from 'node:fs'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { z as zod } from 'zod'

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
export const name = 'gpu-access'

/** The session projection registry is required; the sandbox service is optional. */
export const inject = ['sessionProjections']

/** Tunables live in the user's patch layer so they survive upgrades. */
export const Config = z.object({
  /** Switch state for a session that never recorded `/gpu`. */
  defaultEnabled: z.boolean().default(true),
  /** Physical paths granted read-write inside the sandbox while the switch is on. */
  deviceRoots: z.array(z.string()).default(['/dev', '/dev/shm']),
  /** Register the human `/gpu` command. */
  enableCommands: z.boolean().default(true),
})

const COMMAND_NAME = 'gpu'
const PROJECTION_KEY = 'gpu-access'
const SERVICE_NAME = 'gpuAccess'

/** Folded state of one session: the switch plus the in-flight `/gpu` run. */
const stateSchema = zod.object({
  /** Whether the device roots are granted inside the sandbox. */
  enabled: zod.boolean(),
  /** In-flight `/gpu` invocation; the switch commits only after success. */
  pending: zod
    .object({
      id: zod.string(),
      value: zod.boolean().nullable(),
    })
    .optional(),
})

/** What the composer pill reads. */
const viewSchema = zod.object({
  /** Whether the session granted GPU device access. */
  enabled: zod.boolean(),
  /** Whether the live sandbox provider is actually wrapped in this process. */
  active: zod.boolean(),
})

function initialSelectionState(defaultEnabled) {
  return { enabled: defaultEnabled }
}

function parseSwitch(rawInput) {
  const input = String(rawInput ?? '')
    .trim()
    .replace(/^@/, '')
    .toLowerCase()
  if (input === '' || input === 'status') return { kind: 'status' }
  if (input === 'on' || input === 'enable' || input === 'true') return { kind: 'set', value: true }
  if (input === 'off' || input === 'disable' || input === 'false') return { kind: 'set', value: false }
  return { kind: 'invalid', input }
}

/** Small warn helper: a plugin must not abort the composition for a soft failure. */
function warn(ctx, message) {
  try {
    ctx.logger?.warn?.(message)
  } catch {
    /* logging must never break activation */
  }
}

/**
 * The `gpuAccess` service: owns the switch state, the device roots, and the
 * wrap of the live sandbox provider.
 */
class GpuAccessService extends Service {
  constructor(ctx, settings) {
    super(ctx, SERVICE_NAME)
    this.defaultEnabled = settings.defaultEnabled
    this.roots = settings.deviceRoots
    this.handle = undefined
    this.wrapped = undefined
    this.unwrap = undefined
  }

  /** Device roots that exist on this host right now. */
  deviceRoots() {
    return this.roots.filter((root) => {
      try {
        return existsSync(root)
      } catch {
        return false
      }
    })
  }

  /** Whether the live provider is currently wrapped. */
  isActive() {
    return this.wrapped !== undefined
  }

  /**
   * Whether the session granted GPU device access.
   * @param sessionId - the session id carried by the resolved sandbox policy.
   * @returns the projected switch state, or the configured default.
   */
  enabledFor(sessionId) {
    return this.stateFor(sessionId).enabled
  }

  /** The projected switch state with the configured default as the fallback. */
  stateFor(sessionId) {
    if (this.handle === undefined || sessionId === undefined) return { enabled: this.defaultEnabled }
    let session
    try {
      session = this.ctx.get('sessions')?.get?.(sessionId)
    } catch {
      return { enabled: this.defaultEnabled }
    }
    if (session === undefined || session === null) return { enabled: this.defaultEnabled }
    try {
      const state = this.handle.stateOf(session)
      return { enabled: state.enabled === true }
    } catch {
      return { enabled: this.defaultEnabled }
    }
  }

  /** Attach or detach the projection handle this service reads. */
  attach(handle) {
    this.handle = handle
  }

  /** The device roots to grant for one call (empty unless they apply). */
  grantedRoots(policy) {
    if (policy === undefined || policy.mode !== 'workspace-write') return []
    if (!this.enabledFor(policy.sessionId)) return []
    return this.deviceRoots()
  }

  /**
   * Ensure the current `ctx.sandbox` provider is wrapped. Cheap enough to run
   * on every consulted call: one lookup and one identity comparison, and a
   * re-wrap when a reload replaced the provider instance.
   */
  ensureWrapped() {
    let sandbox
    try {
      sandbox = this.ctx.get('sandbox')
    } catch {
      sandbox = undefined
    }
    if (sandbox === undefined || sandbox === this.wrapped) return this.wrapped !== undefined
    this.unwrap?.()
    const service = this
    const original = sandbox.confine
    if (typeof original !== 'function') return false
    const wrappedConfine = function confine(argv, policy, signal) {
      const roots = service.grantedRoots(policy)
      if (roots.length === 0) return original.call(this, argv, policy, signal)
      return original.call(
        this,
        argv,
        {
          ...policy,
          additionalWritableRoots: [
            ...new Set([...(policy.additionalWritableRoots ?? []), ...roots]),
          ],
        },
        signal,
      )
    }
    try {
      Object.defineProperty(sandbox, 'confine', {
        value: wrappedConfine,
        configurable: true,
        writable: true,
        enumerable: false,
      })
    } catch {
      return false
    }
    this.wrapped = sandbox
    this.unwrap = () => {
      try {
        if (sandbox.confine === wrappedConfine) delete sandbox.confine
      } catch {
        /* the provider is gone or frozen; nothing to restore */
      }
      this.wrapped = undefined
      this.unwrap = undefined
    }
    return true
  }
}

/** Register the human `/gpu` command; `commands` is optional. */
function registerCommand(commandCtx, service, settings) {
  const disposers = []
  try {
    disposers.push(
      commandCtx.commands.register({
        name: COMMAND_NAME,
        description: 'Turn sandboxed GPU device access on or off for this conversation',
        input: { hint: '[on|off|status]' },
        handler: async ({ agent, rawInput }) => {
          const parsed = parseSwitch(rawInput)
          const sessionId = agent?.session?.id ?? agent?.id
          service.ensureWrapped()
          const state = service.stateFor(sessionId)
          if (parsed.kind === 'invalid') {
            return { kind: 'error', text: `Expected "on", "off", or "status"; got "${parsed.input}".` }
          }
          if (parsed.kind === 'status' || parsed.value === state.enabled) {
            return { kind: 'success', text: describe(service, state.enabled) }
          }
          if (parsed.value && service.deviceRoots().length === 0) {
            return {
              kind: 'error',
              text: `None of the configured device roots (${settings.deviceRoots.join(', ')}) exists on this host, so there is no GPU device to grant.`,
            }
          }
          return { kind: 'success', text: describe(service, parsed.value) }
        },
      }),
    )
  } catch (error) {
    warn(commandCtx, `gpu-access: could not register /${COMMAND_NAME}: ${String(error)}`)
  }
  return () => {
    for (const dispose of disposers) {
      try {
        dispose()
      } catch {
        /* already gone */
      }
    }
  }
}

function describe(service, enabled) {
  const roots = service.deviceRoots()
  if (!service.isActive()) {
    return `GPU device access: ${enabled ? 'on' : 'off'}. The sandbox provider is not available in this process yet, so the switch has no effect.`
  }
  if (enabled) {
    return `GPU device access: on. Sandboxed commands may open ${roots.length > 0 ? roots.join(', ') : 'the configured device roots'} read-write; CUDA runs without an escalation approval.`
  }
  return 'GPU device access: off. Sandboxed commands may read device nodes but a write open (what CUDA needs) is denied, so CUDA work asks for an escalation approval.'
}

/**
 * Activate the switch: provide the service, wrap the live sandbox provider,
 * register the projection that gives the switch its durable state, and wire
 * the command.
 */

/** One-line GPU switch for the per-turn settings snapshot. */
function settingsGpuText(enabled) {
  return enabled
    ? 'Enabled — GPU devices are writable inside the sandbox, so CUDA commands need no per-command approval.'
    : 'Off — GPU device access is denied inside the sandbox; ask the user to enable the GPU pill (or run `/gpu on`) before GPU work.'
}

export async function apply(ctx, config = {}) {
  const settings = {
    defaultEnabled: config.defaultEnabled !== false,
    deviceRoots:
      Array.isArray(config.deviceRoots) && config.deviceRoots.length > 0
        ? config.deviceRoots.map(String)
        : ['/dev', '/dev/shm'],
    enableCommands: config.enableCommands !== false,
  }

  const service = new GpuAccessService(ctx, settings)

  // The sandbox provider may load after this row; wrap it once it exists.
  ctx.inject(['sandbox'], () => {
    service.ensureWrapped()
    return () => service.unwrap?.()
  })
  service.ensureWrapped()
  ctx.effect(() => () => service.unwrap?.())

  let commandDispose
  ctx.inject(['commands'], (commandsCtx) => {
    if (!settings.enableCommands) return undefined
    commandDispose = registerCommand(commandsCtx, service, settings)
    return () => {
      commandDispose?.()
      commandDispose = undefined
    }
  })

  try {
    const handle = await ctx.sessionProjections.register({
      key: PROJECTION_KEY,
      stateSchema,
      stateVersion: 1,
      init: () => initialSelectionState(settings.defaultEnabled),
      apply: (previous, event) => {
        if (event.type === 'command/run') {
          if (String(event.data.name ?? '') !== COMMAND_NAME) return previous
          const parsed = parseSwitch(event.data.args)
          return {
            ...previous,
            pending: {
              id: String(event.data.commandId ?? ''),
              value: parsed.kind === 'set' ? parsed.value : null,
            },
          }
        }
        if (event.type === 'command/done') {
          const pending = previous.pending
          if (pending === undefined) return previous
          if (String(event.data.commandId ?? '') !== pending.id) return previous
          const next = { ...previous }
          delete next.pending
          if (event.data.kind === 'success' && pending.value !== null) next.enabled = pending.value
          return next
        }
        return previous
      },
      wire: {
        viewSchema,
        view: (state) => viewOf(state, service.isActive()),
      },
    })
    service.attach(handle)
    ctx.effect(() => () => {
      service.attach(undefined)
      try {
        handle.dispose?.()
      } catch {
        /* already released */
      }
    })
  } catch (error) {
    warn(ctx, `gpu-access: session projection registration failed: ${String(error)}`)
  }

  // Re-assert the GPU switch on every user turn.
  ctx.on('agent/pre-step', async ({ agent, messages }, next) => {
    const decision = await next()
    if (decision.kind === 'reject' || !hasUserMessage(messages)) return decision
    try {
      const { enabled } = service.stateFor(agent.session.id)
      return {
        ...decision,
        messages: withSettingsSection(decision.messages, {
          name: 'GPU access',
          text: settingsGpuText(enabled),
        }),
      }
    } catch (error) {
      warn(ctx, `settings reminder failed: ${String(error)}`)
      return decision
    }
  })
}

/** Stable view references, so an unchanged switch publishes nothing. */
const viewCache = new WeakMap()
function viewOf(state, active) {
  const cached = viewCache.get(state)
  if (cached !== undefined && cached.active === active) return cached.view
  const view = { enabled: state.enabled === true, active }
  viewCache.set(state, { active, view })
  return view
}
