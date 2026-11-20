window.__ModuleLoader__.load({
  id: '@local/dsh-cpu-alloc',
  factory(require) {
    const React = require('react')
    const { createPortal } = require('react-dom')
    const h = React.createElement

    const PACKAGE = '@local/dsh-cpu-alloc'
    const PROJECTION_KEY = 'cpu-alloc'
    const MAX_CHIPS = 256

    const zh = {
      'cpu.label': 'CPU',
      'cpu.choose': '分配当前对话的 CPU 核心',
      'cpu.all': '全部',
      'cpu.allRow': '全部可用核心',
      'cpu.allDetail': '不限制，最多 {n} 个物理核',
      'cpu.allDetailUnknown': '不限制，使用目标默认并行度',
      'cpu.coresSection': '分配物理核心数',
      'cpu.current': '当前',
      'cpu.refresh': '重新探测 CPU',
      'cpu.refreshing': '正在探测…',
      'cpu.loading': '正在读取目标 CPU…',
      'cpu.unknownTarget': '执行目标未解析，请先在上方选择目标',
      'cpu.summary': '可用 {physical} 物理核 · {logical} 逻辑核',
      'cpu.summaryQuota': '可用 {physical} 物理核 · {logical} 逻辑核 · cgroup 限制 {quota} 核',
      'cpu.error': 'CPU 读取失败：{error}',
      'cpu.switching': '切换中…',
      'cpu.failed': '切换失败：{error}',
      'cpu.aria': '当前 CPU 分配：{label}。点击修改',
      'cpu.hint': '当前目标 {target} · Agent 会把并行度限制在分配的核心数内',
      'cpu.hintAll': '当前目标 {target} · Agent 可以使用全部 {n} 个物理核',
      'cpu.large': '超过 {max} 核时请用 /cpu <n> 指定',
      'cpu.coreLabel': '{n} 个物理核',
      'cpu.unknownValue': '未知',
    }

    const en = {
      'cpu.label': 'CPU',
      'cpu.choose': 'Allocate CPU cores to this conversation',
      'cpu.all': 'All',
      'cpu.allRow': 'All available cores',
      'cpu.allDetail': 'No limit, up to {n} physical cores',
      'cpu.allDetailUnknown': 'No limit, use the target default parallelism',
      'cpu.coresSection': 'Physical cores to allocate',
      'cpu.current': 'Current',
      'cpu.refresh': 'Probe CPU again',
      'cpu.refreshing': 'Probing…',
      'cpu.loading': 'Loading target CPU…',
      'cpu.unknownTarget': 'The execution target is unresolved; choose one in the bar above',
      'cpu.summary': '{physical} physical cores · {logical} logical CPUs',
      'cpu.summaryQuota': '{physical} physical cores · {logical} logical CPUs · cgroup quota {quota}',
      'cpu.error': 'Could not read CPU information: {error}',
      'cpu.switching': 'Switching…',
      'cpu.failed': 'Could not switch: {error}',
      'cpu.aria': 'Current CPU allocation: {label}. Click to change it',
      'cpu.hint': 'Current target: {target} · the Agent keeps parallelism within the allocation',
      'cpu.hintAll': 'Current target: {target} · the Agent may use all {n} physical cores',
      'cpu.large': 'Use /cpu <n> for more than {max} cores',
      'cpu.coreLabel': '{n} physical cores',
      'cpu.unknownValue': 'unknown',
    }

    const STYLE = `
.dsh-cpu-bar{box-sizing:border-box;width:calc(100% - var(--dsh-composer-side-clearance) - var(--dsh-composer-side-clearance) - var(--dsh-composer-dock-inset) - var(--dsh-composer-dock-inset));max-width:calc(var(--dsh-composer-card-max-width) - var(--dsh-composer-dock-inset) - var(--dsh-composer-dock-inset));margin:0 auto;padding:0 var(--dsh-composer-dock-inset);display:flex;align-items:center;gap:8px;flex:none}
.dsh-cpu-trigger{box-sizing:border-box;display:inline-flex;align-items:center;gap:7px;max-width:100%;min-height:28px;padding:2px 9px 2px 8px;border:.5px solid var(--dsw-alias-border-l1);border-radius:999px;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);cursor:pointer;font:inherit;font-size:12px;line-height:18px}
.dsh-cpu-trigger:hover,.dsh-cpu-trigger[aria-expanded=true]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsh-cpu-trigger:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
.dsh-cpu-trigger svg{flex:none;display:block}
.dsh-cpu-label{flex:none;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}
.dsh-cpu-value{min-width:0;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:var(--dsw-font-mono);font-size:12px;line-height:18px;color:var(--dsw-alias-label-primary)}
.dsh-cpu-detail{min-width:0;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary)}
.dsh-cpu-chevron{flex:none;color:var(--dsw-alias-label-tertiary)}
.dsh-cpu-menu{z-index:100;box-sizing:border-box;position:fixed;display:flex;flex-direction:column;overflow:hidden;border:.5px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-lg);background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-primary);backdrop-filter:none;-webkit-backdrop-filter:none;box-shadow:var(--dsw-elevation-prominent);font-size:13px;line-height:20px}
.dsh-cpu-menu:focus{outline:none}
.dsh-cpu-head{display:flex;align-items:center;gap:8px;padding:9px 12px;border-bottom:.5px solid var(--dsw-alias-border-l1);flex:none}
.dsh-cpu-title{flex:1;min-width:0;font-size:12px;font-weight:600;line-height:18px}
.dsh-cpu-target{min-width:0;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-tertiary);font-family:var(--dsw-font-mono);font-size:10px;line-height:15px}
.dsh-cpu-iconButton{flex:none;display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;padding:0;border:0;border-radius:var(--dsw-radius-sm);background:0 0;color:var(--dsw-alias-label-tertiary);cursor:pointer}
.dsh-cpu-iconButton:hover,.dsh-cpu-iconButton:focus-visible{background:var(--dsw-alias-fill-l1);color:var(--dsw-alias-label-primary)}
.dsh-cpu-iconButton:disabled{opacity:.45;cursor:default}
.dsh-cpu-body{flex:1;min-height:0;overflow-y:auto;padding:4px}
.dsh-cpu-summary{padding:6px 8px 8px;color:var(--dsw-alias-label-secondary);font-size:11px;line-height:16px}
.dsh-cpu-summaryMono{font-family:var(--dsw-font-mono);color:var(--dsw-alias-label-tertiary)}
.dsh-cpu-section{padding:4px 8px 3px;color:var(--dsw-alias-label-tertiary);font-size:10px;line-height:15px;letter-spacing:.02em;text-transform:uppercase}
.dsh-cpu-row{box-sizing:border-box;display:flex;align-items:center;gap:9px;width:100%;min-height:34px;padding:5px 8px;border:0;border-radius:var(--dsw-radius-md);background:0 0;color:inherit;text-align:left;cursor:pointer;font:inherit}
.dsh-cpu-row:hover,.dsh-cpu-row:focus-visible{background:var(--dsw-alias-fill-l1)}
.dsh-cpu-row[aria-current=true]{background:var(--dsw-alias-fill-l2)}
.dsh-cpu-row:disabled{opacity:.55;cursor:default}
.dsh-cpu-rowIcon{flex:none;display:inline-flex;align-items:center;justify-content:center;width:16px;color:var(--dsw-alias-label-tertiary)}
.dsh-cpu-rowMain{display:flex;flex-direction:column;min-width:0;flex:1;gap:1px}
.dsh-cpu-rowLabel{font-family:var(--dsw-font-mono);font-size:12px;line-height:18px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-cpu-rowDetail{font-family:var(--dsw-font-mono);font-size:10px;line-height:15px;color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-cpu-grid{display:flex;flex-wrap:wrap;gap:4px;padding:4px 8px 8px}
.dsh-cpu-chip{box-sizing:border-box;min-width:36px;height:28px;padding:0 7px;border:.5px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);cursor:pointer;font-family:var(--dsw-font-mono);font-size:12px;line-height:26px;text-align:center}
.dsh-cpu-chip:hover,.dsh-cpu-chip:focus-visible{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsh-cpu-chip[aria-current=true]{border-color:var(--dsw-alias-state-business-primary);background:var(--dsw-alias-fill-l2);color:var(--dsw-alias-label-primary)}
.dsh-cpu-chip:disabled{opacity:.55;cursor:default}
.dsh-cpu-badge{flex:none;border-radius:var(--dsw-radius-xs);background:var(--dsw-alias-state-business-tertiary);color:var(--dsw-alias-label-primary-bluish);padding:0 5px;font-size:10px;line-height:16px}
.dsh-cpu-pending{flex:none;color:var(--dsw-alias-label-tertiary);font-size:10px;line-height:16px}
.dsh-cpu-state{padding:14px 12px;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;text-align:center}
.dsh-cpu-stateError{color:var(--dsw-alias-state-error-primary)}
.dsh-cpu-foot{padding:7px 12px 9px;border-top:.5px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-tertiary);font-size:10px;line-height:15px;flex:none}
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
/* Keep the chip right-aligned inside the bar whenever the bar itself is
   stretched (for example when this plugin is loaded without the other dock
   plugins); the shared row layout shrink-wraps the bar, so it has no effect
   there. */
div[class*="composerStack"] [data-slot="conversation.input.dock"] .dsh-cpu-bar{justify-content:flex-end}
`

    function CpuIcon({ size = 14 }) {
      return h('svg', { viewBox: '0 0 16 16', width: size, height: size, 'aria-hidden': true },
        h('path', {
          d: 'M5.2 4h5.6c.7 0 1.2.5 1.2 1.2v5.6c0 .7-.5 1.2-1.2 1.2H5.2c-.7 0-1.2-.5-1.2-1.2V5.2c0-.7.5-1.2 1.2-1.2Zm0 1.1c-.1 0-.1 0-.1.1v5.6c0 .1 0 .1.1.1h5.6c.1 0 .1 0 .1-.1V5.2c0-.1 0-.1-.1-.1H5.2ZM2.4 5h1.1v1.2H2.4V5Zm0 2.4h1.1v1.2H2.4V7.4Zm0 2.4h1.1v1.2H2.4v-1.2ZM12.5 5h1.1v1.2h-1.1V5Zm0 2.4h1.1v1.2h-1.1V7.4Zm0 2.4h1.1v1.2h-1.1v-1.2ZM5 2.4h1.2v1.1H5V2.4Zm2.4 0h1.2v1.1H7.4V2.4Zm2.4 0h1.2v1.1h-1.2V2.4ZM5 12.5h1.2v1.1H5v-1.1Zm2.4 0h1.2v1.1H7.4v-1.1Zm2.4 0h1.2v1.1h-1.2v-1.1Z',
          fill: 'currentColor',
        }))
    }

    function ChevronIcon({ size = 12 }) {
      return h('svg', { viewBox: '0 0 16 16', width: size, height: size, 'aria-hidden': true },
        h('path', { d: 'm4.2 6 3.8 4 3.8-4 .9.8-4.7 5-4.7-5 .9-.8Z', fill: 'currentColor' }))
    }

    function RefreshIcon({ size = 13 }) {
      return h('svg', { viewBox: '0 0 16 16', width: size, height: size, 'aria-hidden': true },
        h('path', {
          d: 'M8 2.3a5.7 5.7 0 1 1-5.4 7.5h1.3A4.4 4.4 0 1 0 8 3.6H6.9l1.5 1.5-.8.8L4.7 3l2.9-2.9.8.8-1.5 1.4H8Z',
          fill: 'currentColor',
        }))
    }

    function AllCoresIcon({ size = 14 }) {
      return h('svg', { viewBox: '0 0 16 16', width: size, height: size, 'aria-hidden': true },
        h('path', {
          d: 'M2.2 2.2h4.2v4.2H2.2V2.2Zm1.1 1.1v2h2v-2h-2Zm6.3-1.1h4.2v4.2H9.6V2.2Zm1.1 1.1v2h2v-2h-2ZM2.2 9.6h4.2v4.2H2.2V9.6Zm1.1 1.1v2h2v-2h-2Zm6.3-1.1h4.2v4.2H9.6V9.6Zm1.1 1.1v2h2v-2h-2Z',
          fill: 'currentColor',
        }))
    }

    function remoteErrorText(error, fallback) {
      if (error instanceof Error && error.message) return error.message
      if (error && typeof error === 'object' && typeof error.message === 'string') return error.message
      return fallback
    }

    function CpuBar({ sessionId, useProjection, t, commands }) {
      const projection = useProjection(PROJECTION_KEY)
      const [open, setOpen] = React.useState(false)
      const [pending, setPending] = React.useState(undefined)
      const [refreshing, setRefreshing] = React.useState(false)
      const [switchError, setSwitchError] = React.useState(undefined)
      const [position, setPosition] = React.useState(undefined)
      const triggerRef = React.useRef(null)
      const menuRef = React.useRef(null)
      const refreshedFor = React.useRef(undefined)
      const autoLoadedFor = React.useRef(undefined)

      const available = typeof projection?.available === 'number' && projection.available > 0
        ? Math.floor(projection.available)
        : 0
      const physical = typeof projection?.physical === 'number' ? Math.floor(projection.physical) : 0
      const logical = typeof projection?.logical === 'number' ? Math.floor(projection.logical) : 0
      const quota = typeof projection?.quota === 'number' ? Math.floor(projection.quota) : 0
      const target = typeof projection?.target === 'string' && projection.target.length > 0
        ? projection.target
        : '…'
      const targetKind = projection?.targetKind
      const loading = projection === undefined || projection.loading === true
      const selectedCores = typeof projection?.selectedCores === 'number' ? Math.floor(projection.selectedCores) : 0
      const effectiveCores = typeof projection?.effectiveCores === 'number' ? Math.floor(projection.effectiveCores) : 0
      const selectedActive = projection?.selectedActive === true
      const autoSelected = projection === undefined || selectedCores === 0 || !selectedActive
      const shownCores = autoSelected ? available : (effectiveCores > 0 ? effectiveCores : selectedCores)
      const valueText = projection === undefined
        ? '…'
        : autoSelected
          ? (available > 0 ? `${t('cpu.all')} · ${available}` : t('cpu.all'))
          : (available > 0 ? `${shownCores} / ${available}` : `${shownCores}`)
      const displayError = switchError ?? (typeof projection?.error === 'string' && projection.error.length > 0 ? projection.error : undefined)

      const place = React.useCallback(() => {
        const trigger = triggerRef.current
        if (!trigger) return
        const rect = trigger.getBoundingClientRect()
        const width = Math.min(380, Math.max(280, window.innerWidth - 16))
        const left = Math.min(Math.max(8, rect.left), Math.max(8, window.innerWidth - width - 8))
        setPosition({
          left,
          width,
          bottom: window.innerHeight - rect.top + 6,
          maxHeight: Math.max(180, rect.top - 16),
        })
      }, [])

      const refreshCpu = async (force = false) => {
        if (refreshing) return false
        if (!commands) {
          setSwitchError('commands are unavailable')
          return false
        }
        setRefreshing(true)
        setSwitchError(undefined)
        try {
          const result = await commands.execute(sessionId, force ? '/cpu refresh' : '/cpu', [])
          if (!result.ok) {
            setSwitchError(remoteErrorText(result.error, 'unknown error'))
            return false
          }
          if (result.value?.result.kind === 'error') {
            setSwitchError(result.value.result.text ?? 'unknown error')
            return false
          }
          return true
        } catch (caught) {
          setSwitchError(remoteErrorText(caught, 'unknown error'))
          return false
        } finally {
          setRefreshing(false)
        }
      }

      const choose = async (line, label) => {
        if (pending !== undefined) return
        if (!commands) {
          setSwitchError('commands are unavailable')
          return
        }
        setPending(label)
        setSwitchError(undefined)
        try {
          const result = await commands.execute(sessionId, line, [])
          if (!result.ok) {
            setSwitchError(remoteErrorText(result.error, 'unknown error'))
            return
          }
          const execution = result.value
          if (execution === undefined) {
            setSwitchError(`${line} is no longer available`)
            return
          }
          if (execution.result.kind === 'error') {
            setSwitchError(execution.result.text ?? 'unknown error')
            return
          }
          setOpen(false)
        } catch (caught) {
          setSwitchError(remoteErrorText(caught, 'unknown error'))
        } finally {
          setPending(undefined)
        }
      }

      React.useEffect(() => {
        if (!open) return undefined
        place()
        const onResize = () => place()
        window.addEventListener('resize', onResize)
        window.addEventListener('scroll', onResize, true)
        return () => {
          window.removeEventListener('resize', onResize)
          window.removeEventListener('scroll', onResize, true)
        }
      }, [open, place])

      React.useEffect(() => {
        if (!open) return undefined
        const onPointerDown = (event) => {
          const node = event.target
          if (triggerRef.current?.contains(node)) return
          if (menuRef.current?.contains(node)) return
          setOpen(false)
        }
        const onKeyDown = (event) => {
          if (event.key !== 'Escape') return
          setOpen(false)
          triggerRef.current?.focus()
        }
        document.addEventListener('pointerdown', onPointerDown, true)
        document.addEventListener('keydown', onKeyDown)
        return () => {
          document.removeEventListener('pointerdown', onPointerDown, true)
          document.removeEventListener('keydown', onKeyDown)
        }
      }, [open])

      React.useEffect(() => {
        if (open) menuRef.current?.focus()
      }, [open])

      // Probe the current target once as soon as the chip knows the catalog is
      // missing (a fresh page load, or a target switch). The host refreshes the
      // projection when the command settles, so the chip fills in by itself.
      React.useEffect(() => {
        if (!projection) return
        if (projection.loading !== true) return
        if (projection.targetKind === 'unknown') return
        const key = `${projection.targetKind}:${projection.target}`
        if (autoLoadedFor.current === key) return
        autoLoadedFor.current = key
        void refreshCpu(false).then((ok) => {
          // A command that is not registered yet must not block the chip
          // forever; clearing the marker lets the next target change retry.
          if (!ok) autoLoadedFor.current = undefined
        })
      }, [projection?.loading, projection?.target, projection?.targetKind])

      // Opening the menu refreshes the catalog for the current target once.
      React.useEffect(() => {
        if (!open) {
          refreshedFor.current = undefined
          return
        }
        const key = `${targetKind ?? ''}:${target}`
        if (refreshedFor.current === key) return
        refreshedFor.current = key
        void refreshCpu(false)
      }, [open, target, targetKind])

      const trigger = h('button', {
        ref: triggerRef,
        type: 'button',
        className: 'dsh-cpu-trigger',
        'aria-haspopup': 'menu',
        'aria-expanded': open,
        'aria-label': t('cpu.aria', { label: valueText }),
        title: t('cpu.choose'),
        onClick: () => {
          setOpen((current) => !current)
          setSwitchError(undefined)
        },
      }, [
        h(CpuIcon, { key: 'icon' }),
        h('span', { key: 'label', className: 'dsh-cpu-label' }, t('cpu.label')),
        h('span', { key: 'value', className: 'dsh-cpu-value' }, valueText),
        h('span', { key: 'chevron', className: 'dsh-cpu-chevron' }, h(ChevronIcon)),
      ])

      const body = []
      if (targetKind === 'unknown') {
        body.push(h('div', { key: 'unknown', className: 'dsh-cpu-state dsh-cpu-stateError' }, t('cpu.unknownTarget')))
      } else if (loading) {
        body.push(h('div', { key: 'loading', className: 'dsh-cpu-state' }, t('cpu.loading')))
      } else if (physical <= 0) {
        body.push(h('div', { key: 'noCores', className: 'dsh-cpu-state dsh-cpu-stateError' }, t('cpu.error', { error: displayError ?? t('cpu.unknownValue') })))
      } else {
        body.push(h('div', { key: 'summary', className: 'dsh-cpu-summary' }, [
          h('span', { key: 'text' }, quota > 0
            ? t('cpu.summaryQuota', { physical, logical: logical > 0 ? logical : physical, quota })
            : t('cpu.summary', { physical, logical: logical > 0 ? logical : physical })),
        ]))
        body.push(h('button', {
          key: 'all',
          type: 'button',
          className: 'dsh-cpu-row',
          'aria-current': autoSelected,
          disabled: pending !== undefined,
          onClick: () => { void choose('/cpu all', 'all') },
        }, [
          h('span', { key: 'icon', className: 'dsh-cpu-rowIcon' }, h(AllCoresIcon)),
          h('span', { key: 'main', className: 'dsh-cpu-rowMain' }, [
            h('span', { key: 'label', className: 'dsh-cpu-rowLabel' }, t('cpu.allRow')),
            h('span', { key: 'detail', className: 'dsh-cpu-rowDetail' }, available > 0
              ? t('cpu.allDetail', { n: available })
              : t('cpu.allDetailUnknown')),
          ]),
          pending === 'all' ? h('span', { key: 'pending', className: 'dsh-cpu-pending' }, t('cpu.switching'))
            : autoSelected ? h('span', { key: 'badge', className: 'dsh-cpu-badge' }, t('cpu.current'))
              : null,
        ]))
        body.push(h('div', { key: 'cores-section', className: 'dsh-cpu-section' }, t('cpu.coresSection')))
        const chips = []
        const limit = Math.min(available, MAX_CHIPS)
        for (let n = 1; n <= limit; n += 1) {
          const isCurrent = !autoSelected && shownCores === n
          chips.push(h('button', {
            key: `core-${n}`,
            type: 'button',
            className: 'dsh-cpu-chip',
            'aria-current': isCurrent,
            'aria-label': t('cpu.coreLabel', { n }),
            disabled: pending !== undefined,
            onClick: () => { void choose(`/cpu ${n}`, String(n)) },
          }, pending === String(n) ? t('cpu.switching') : String(n)))
        }
        body.push(h('div', { key: 'cores-grid', className: 'dsh-cpu-grid' }, chips))
        if (available > MAX_CHIPS) {
          body.push(h('div', { key: 'large', className: 'dsh-cpu-state' }, t('cpu.large', { max: MAX_CHIPS })))
        }
      }

      const hint = available > 0
        ? (autoSelected ? t('cpu.hintAll', { target, n: available }) : t('cpu.hint', { target: `${target} · ${shownCores}/${available}` }))
        : t('cpu.hint', { target })

      const menu = open && position !== undefined ? createPortal(h('div', {
        ref: menuRef,
        className: 'dsh-cpu-menu',
        role: 'menu',
        'aria-label': t('cpu.choose'),
        tabIndex: -1,
        style: {
          left: `${position.left}px`,
          bottom: `${position.bottom}px`,
          width: `${position.width}px`,
          maxHeight: `${position.maxHeight}px`,
        },
      }, [
        h('div', { key: 'head', className: 'dsh-cpu-head' }, [
          h('span', { key: 'title', className: 'dsh-cpu-title' }, t('cpu.choose')),
          h('span', { key: 'target', className: 'dsh-cpu-target' }, target),
          h('button', {
            key: 'refresh',
            type: 'button',
            className: 'dsh-cpu-iconButton',
            title: t('cpu.refresh'),
            'aria-label': t('cpu.refresh'),
            disabled: refreshing,
            onClick: () => { void refreshCpu(true) },
          }, h(RefreshIcon)),
        ]),
        h('div', { key: 'body', className: 'dsh-cpu-body' }, body),
        refreshing ? h('div', { key: 'refreshing', className: 'dsh-cpu-state' }, t('cpu.refreshing')) : null,
        switchError === undefined ? null : h('div', {
          key: 'error',
          className: 'dsh-cpu-state dsh-cpu-stateError',
          role: 'status',
        }, t('cpu.failed', { error: switchError })),
        h('div', { key: 'foot', className: 'dsh-cpu-foot' }, hint),
      ]), document.body) : null

      return h(React.Fragment, null,
        h('div', { className: 'dsh-cpu-bar' }, trigger),
        menu,
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
        return () => { style.remove() }
      }, 'cpu-alloc: client styles')

      ctx.effect(
        () => ctx.locale.register('cpu-alloc', { zh, en }),
        'cpu-alloc: dictionaries',
      )

      ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
        name: 'conversation.input.dock',
        id: 'cpu-alloc',
        order: 7,
        locale: 'cpu-alloc',
        inject: () => ({ commands: ctx.remote.commands }),
      }, CpuBar))
    }

    return { inject, apply }
  },
})
