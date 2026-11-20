window.__ModuleLoader__.load({
  id: '@local/dsh-gpu-access',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const PACKAGE = '@local/dsh-gpu-access'
    const PROJECTION_KEY = 'gpu-access'

    const zh = {
      'gpu.label': 'GPU',
      'gpu.on': '已开启',
      'gpu.off': '关闭',
      'gpu.unknown': '未知',
      'gpu.enable': '开启沙箱内的 GPU 设备访问，CUDA 不再逐次申请授权',
      'gpu.disable': '关闭沙箱内的 GPU 设备访问',
      'gpu.pending': '切换中…',
      'gpu.failed': '切换失败：{error}',
      'gpu.aria': 'GPU 设备访问：{state}。点击切换',
      'gpu.restart': '沙箱未就绪',
    }

    const en = {
      'gpu.label': 'GPU',
      'gpu.on': 'on',
      'gpu.off': 'off',
      'gpu.unknown': 'unknown',
      'gpu.enable': 'Allow GPU device access inside the sandbox so CUDA needs no per-command approval',
      'gpu.disable': 'Deny GPU device access inside the sandbox',
      'gpu.pending': 'Switching…',
      'gpu.failed': 'Could not switch: {error}',
      'gpu.aria': 'GPU device access: {state}. Click to switch',
      'gpu.restart': 'sandbox not ready',
    }

    const STYLE = `
.dsh-gpu-bar{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:flex-end;flex:0 0 auto;min-width:0;margin:0;padding:0;width:auto}
/* Composer dock row — identical in all four local dock plugins, so the row
   survives whichever subset stays enabled. The dock outlets use
   display:contents, so these bars lay out as flex children of the composer
   stack although the DOM nests them under the dock anchor. The hero and an
   active Session both keep one row between the workspace row (hero only) and
   the composer card: execution target and environment on the left, CPU and
   GPU on the right, inset like the card's own dock items. */
div[class*="composerStack"]:has([data-slot="conversation.input.dock"] :is(.dsh-ssh-target-bar,.dsh-python-env-bar,.dsh-cpu-bar,.dsh-gpu-bar)){--dsh-dock-edge-inset:calc(max(var(--dsh-composer-side-clearance,16px),(100% - var(--dsh-composer-card-max-width)) / 2) + 2 * var(--dsh-composer-dock-inset,8px));flex-flow:row wrap;align-items:center}
div[class*="composerStack"]:has([data-slot="conversation.input.dock"] :is(.dsh-ssh-target-bar,.dsh-python-env-bar,.dsh-cpu-bar,.dsh-gpu-bar)) > *{flex:0 0 100%;height:auto}
div[class*="composerStack"]:has([data-slot="conversation.input.dock"] :is(.dsh-ssh-target-bar,.dsh-python-env-bar,.dsh-cpu-bar,.dsh-gpu-bar)) > [data-slot="conversation.composer.bar"] > *{flex:0 0 100%}
div[class*="composerStack"]:has([data-slot="conversation.input.dock"] :is(.dsh-ssh-target-bar,.dsh-python-env-bar,.dsh-cpu-bar,.dsh-gpu-bar)) [data-slot="conversation.input.dock"] :is(.dsh-ssh-target-bar,.dsh-python-env-bar,.dsh-cpu-bar,.dsh-gpu-bar){box-sizing:border-box;width:auto;max-width:none;min-width:0;flex:0 0 auto;margin:0;padding:0}
div[class*="composerStack"]:has([data-slot="conversation.input.dock"] :is(.dsh-ssh-target-bar,.dsh-python-env-bar,.dsh-cpu-bar,.dsh-gpu-bar)) [data-slot="conversation.input.dock"] .dsh-ssh-target-bar{margin-left:var(--dsh-dock-edge-inset)}
div[class*="composerStack"]:has([data-slot="conversation.input.dock"] :is(.dsh-ssh-target-bar,.dsh-python-env-bar,.dsh-cpu-bar,.dsh-gpu-bar)) [data-slot="conversation.input.dock"] .dsh-python-env-bar{margin-left:0}
div[class*="composerStack"]:has([data-slot="conversation.input.dock"] :is(.dsh-ssh-target-bar,.dsh-python-env-bar,.dsh-cpu-bar,.dsh-gpu-bar)):not(:has([data-slot="conversation.input.dock"] .dsh-ssh-target-bar)) [data-slot="conversation.input.dock"] .dsh-python-env-bar{margin-left:var(--dsh-dock-edge-inset)}
div[class*="composerStack"]:has([data-slot="conversation.input.dock"] :is(.dsh-ssh-target-bar,.dsh-python-env-bar,.dsh-cpu-bar,.dsh-gpu-bar)) [data-slot="conversation.input.dock"] .dsh-cpu-bar{margin-left:auto}
div[class*="composerStack"]:has([data-slot="conversation.input.dock"] :is(.dsh-ssh-target-bar,.dsh-python-env-bar,.dsh-cpu-bar,.dsh-gpu-bar)):not(:has([data-slot="conversation.input.dock"] .dsh-gpu-bar)) [data-slot="conversation.input.dock"] .dsh-cpu-bar{margin-right:var(--dsh-dock-edge-inset)}
div[class*="composerStack"]:has([data-slot="conversation.input.dock"] :is(.dsh-ssh-target-bar,.dsh-python-env-bar,.dsh-cpu-bar,.dsh-gpu-bar)) [data-slot="conversation.input.dock"] .dsh-gpu-bar{margin-right:var(--dsh-dock-edge-inset)}
div[class*="composerStack"]:has([data-slot="conversation.input.dock"] :is(.dsh-ssh-target-bar,.dsh-python-env-bar,.dsh-cpu-bar,.dsh-gpu-bar)):not(:has([data-slot="conversation.input.dock"] .dsh-cpu-bar)) [data-slot="conversation.input.dock"] .dsh-gpu-bar{margin-left:auto}
.dsh-gpu-trigger{box-sizing:border-box;display:inline-flex;align-items:center;gap:7px;max-width:100%;min-height:28px;padding:2px 9px 2px 8px;border:.5px solid var(--dsw-alias-border-l1);border-radius:999px;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);cursor:pointer;font:inherit;font-size:12px;line-height:18px}
.dsh-gpu-trigger:hover,.dsh-gpu-trigger[aria-pressed=true]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsh-gpu-trigger:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
.dsh-gpu-trigger:disabled{opacity:.55;cursor:default}
.dsh-gpu-trigger svg{flex:none;display:block}
.dsh-gpu-label{flex:none;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}
.dsh-gpu-value{min-width:2.4em;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:var(--dsw-font-mono);font-size:12px;line-height:18px;color:var(--dsw-alias-label-primary)}
.dsh-gpu-dot{flex:none;width:6px;height:6px;border-radius:999px;background:var(--dsw-alias-label-tertiary)}
.dsh-gpu-dot[data-on=true][data-active=true]{background:var(--dsw-alias-state-business-primary)}
.dsh-gpu-dot[data-on=true][data-active=false]{background:var(--dsw-alias-state-warning-primary,var(--dsw-alias-label-tertiary))}
.dsh-gpu-error{flex:none;max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-state-error-primary);font-size:11px;line-height:16px}
`

    function GpuIcon({ size = 14 }) {
      return h(
        'svg',
        { viewBox: '0 0 16 16', width: size, height: size, 'aria-hidden': true },
        h('path', {
          fill: 'currentColor',
          d: 'M2 3.5A1.5 1.5 0 0 1 3.5 2h9A1.5 1.5 0 0 1 14 3.5v9a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 12.5v-9Zm1.2 0v3h2.1v-3H3.2Zm3.3 0v3h3v-3h-3Zm4.2 0v3h2.1v-3h-2.1ZM3.2 7.6v2.9h2.1V7.6H3.2Zm3.3 0v2.9h3V7.6h-3Zm4.2 0v2.9h2.1V7.6h-2.1ZM3.2 11.7v.8h9.6v-.8H3.2Z',
        }),
      )
    }

    function remoteErrorText(error, fallback) {
      if (error === undefined || error === null) return fallback
      if (typeof error === 'string') return error
      if (typeof error.message === 'string' && error.message.length > 0) return error.message
      return fallback
    }

    function GpuBar({ sessionId, useProjection, t, commands }) {
      const projection = useProjection(PROJECTION_KEY)
      const [pending, setPending] = React.useState(false)
      const [error, setError] = React.useState(undefined)

      const known = projection !== undefined && projection !== null
      const enabled = known && projection.enabled === true
      const active = known && projection.active !== false
      const stateText = !known ? t('gpu.unknown') : !active ? t('gpu.restart') : enabled ? t('gpu.on') : t('gpu.off')

      const toggle = async () => {
        if (pending || !known || !commands) return
        setPending(true)
        setError(undefined)
        try {
          const line = enabled ? '/gpu off' : '/gpu on'
          const result = await commands.execute(sessionId, line, [])
          if (!result.ok) {
            setError(t('gpu.failed', { error: remoteErrorText(result.error, 'unknown error') }))
            return
          }
          const execution = result.value
          if (execution?.result?.kind === 'error') {
            setError(t('gpu.failed', { error: execution.result.text ?? 'unknown error' }))
          }
        } catch (caught) {
          setError(t('gpu.failed', { error: remoteErrorText(caught, 'unknown error') }))
        } finally {
          setPending(false)
        }
      }

      return h(
        'div',
        { className: 'dsh-gpu-bar' },
        h(
          'button',
          {
            type: 'button',
            className: 'dsh-gpu-trigger',
            'aria-pressed': enabled,
            'aria-label': t('gpu.aria', { state: stateText }),
            title: enabled ? t('gpu.disable') : t('gpu.enable'),
            disabled: pending || !known,
            onClick: () => {
              void toggle()
            },
          },
          h(GpuIcon),
          h('span', { className: 'dsh-gpu-dot', 'data-on': enabled, 'data-active': active }),
          h('span', { className: 'dsh-gpu-label' }, t('gpu.label')),
          h('span', { className: 'dsh-gpu-value' }, pending ? t('gpu.pending') : stateText),
        ),
        error === undefined ? null : h('span', { className: 'dsh-gpu-error', role: 'status' }, error),
      )
    }

    const inject = ['slots', 'locale', 'remote', 'remote.commands']

    function apply(ctx) {
      ctx.effect(() => {
        if (typeof document === 'undefined') return undefined
        const previous = document.querySelector(`style[data-plugin-css="${PACKAGE}"]`)
        if (previous) previous.remove()
        const style = document.createElement('style')
        style.dataset.plugin = PACKAGE
        style.dataset.pluginCss = PACKAGE
        style.textContent = STYLE
        document.head.appendChild(style)
        return () => {
          style.remove()
        }
      }, 'gpu-access: client styles')

      ctx.effect(
        () => ctx.locale.register('gpu-access', { zh, en }),
        'gpu-access: dictionaries',
      )

      ctx.slots.inject('conversation.input.dock', () =>
        ctx.slots.register(
          {
            name: 'conversation.input.dock',
            id: 'gpu-access',
            order: 8,
            locale: 'gpu-access',
            inject: () => ({ commands: ctx.remote.commands }),
          },
          GpuBar,
        ),
      )
    }

    return { inject, apply }
  },
})
