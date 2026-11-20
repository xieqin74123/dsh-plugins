window.__ModuleLoader__.load({
  id: '@local/dsh-python-env',
  factory(require) {
    const React = require('react')
    const { createPortal } = require('react-dom')
    const h = React.createElement

    const PACKAGE = '@local/dsh-python-env'
    const PROJECTION_KEY = 'python-env'

    const zh = {
      'env.label': '环境',
      'env.choose': '选择 Python / Conda 环境',
      'env.auto': '自动（目标默认）',
      'env.autoShort': '自动',
      'env.autoDetail': '使用该目标上的默认 Python',
      'env.condaSection': 'Conda 环境',
      'env.pythonSection': 'Python 解释器',
      'env.current': '当前',
      'env.refresh': '刷新环境列表',
      'env.refreshing': '正在刷新…',
      'env.loading': '正在读取环境…',
      'env.noEnvs': '该目标上没有发现 Python 或 Conda 环境',
      'env.error': '环境读取失败：{error}',
      'env.switching': '切换中…',
      'env.failed': '切换失败：{error}',
      'env.hint': '当前目标：{target} · 切换目标后请重新选择环境',
      'env.aria': '当前 Python 环境：{label}。点击选择其他环境',
      'env.unknownTarget': '执行目标未解析，请先在上方选择目标',
      'env.close': '关闭',
      'env.targetAuto': '默认 Python',
    }

    const en = {
      'env.label': 'Env',
      'env.choose': 'Choose Python / Conda environment',
      'env.auto': 'Auto (target default)',
      'env.autoShort': 'Auto',
      'env.autoDetail': 'Use the default Python on this target',
      'env.condaSection': 'Conda environments',
      'env.pythonSection': 'Python interpreters',
      'env.current': 'Current',
      'env.refresh': 'Refresh environments',
      'env.refreshing': 'Refreshing…',
      'env.loading': 'Loading environments…',
      'env.noEnvs': 'No Python or conda environments found on this target',
      'env.error': 'Could not load environments: {error}',
      'env.switching': 'Switching…',
      'env.failed': 'Could not switch: {error}',
      'env.hint': 'Current target: {target} · choose again after switching targets',
      'env.aria': 'Current Python environment: {label}. Click to choose another one',
      'env.unknownTarget': 'The execution target is unresolved; choose one in the bar above',
      'env.close': 'Close',
      'env.targetAuto': 'Default Python',
    }

    const STYLE = `
.dsh-python-env-bar{box-sizing:border-box;width:calc(100% - var(--dsh-composer-side-clearance) - var(--dsh-composer-side-clearance) - var(--dsh-composer-dock-inset) - var(--dsh-composer-dock-inset));max-width:calc(var(--dsh-composer-card-max-width) - var(--dsh-composer-dock-inset) - var(--dsh-composer-dock-inset));margin:0 auto;padding:0 var(--dsh-composer-dock-inset);display:flex;align-items:center;gap:8px;flex:none}
.dsh-python-env-trigger{box-sizing:border-box;display:inline-flex;align-items:center;gap:7px;max-width:100%;min-height:28px;padding:2px 9px 2px 8px;border:.5px solid var(--dsw-alias-border-l1);border-radius:999px;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);cursor:pointer;font:inherit;font-size:12px;line-height:18px}
.dsh-python-env-trigger:hover,.dsh-python-env-trigger[aria-expanded=true]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsh-python-env-trigger:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
.dsh-python-env-trigger svg{flex:none;display:block}
.dsh-python-env-label{flex:none;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}
.dsh-python-env-value{min-width:0;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:var(--dsw-font-mono);font-size:12px;line-height:18px;color:var(--dsw-alias-label-primary)}
.dsh-python-env-detail{min-width:0;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary)}
.dsh-python-env-chevron{flex:none;color:var(--dsw-alias-label-tertiary)}
.dsh-python-env-menu{z-index:100;box-sizing:border-box;position:fixed;display:flex;flex-direction:column;overflow:hidden;border:.5px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-lg);background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-primary);backdrop-filter:none;-webkit-backdrop-filter:none;box-shadow:var(--dsw-elevation-prominent);font-size:13px;line-height:20px}
.dsh-python-env-menu:focus{outline:none}
.dsh-python-env-head{display:flex;align-items:center;gap:8px;padding:9px 12px;border-bottom:.5px solid var(--dsw-alias-border-l1);flex:none}
.dsh-python-env-title{flex:1;min-width:0;font-size:12px;font-weight:600;line-height:18px}
.dsh-python-env-target{min-width:0;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-tertiary);font-family:var(--dsw-font-mono);font-size:10px;line-height:15px}
.dsh-python-env-iconButton{flex:none;display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;padding:0;border:0;border-radius:var(--dsw-radius-sm);background:0 0;color:var(--dsw-alias-label-tertiary);cursor:pointer}
.dsh-python-env-iconButton:hover,.dsh-python-env-iconButton:focus-visible{background:var(--dsw-alias-fill-l1);color:var(--dsw-alias-label-primary)}
.dsh-python-env-iconButton:disabled{opacity:.45;cursor:default}
.dsh-python-env-body{flex:1;min-height:0;overflow-y:auto;padding:4px}
.dsh-python-env-section{padding:4px 8px 3px;color:var(--dsw-alias-label-tertiary);font-size:10px;line-height:15px;letter-spacing:.02em;text-transform:uppercase}
.dsh-python-env-row{box-sizing:border-box;display:flex;align-items:center;gap:9px;width:100%;min-height:34px;padding:5px 8px;border:0;border-radius:var(--dsw-radius-md);background:0 0;color:inherit;text-align:left;cursor:pointer;font:inherit}
.dsh-python-env-row:hover,.dsh-python-env-row:focus-visible{background:var(--dsw-alias-fill-l1)}
.dsh-python-env-row[aria-current=true]{background:var(--dsw-alias-fill-l2)}
.dsh-python-env-row:disabled{opacity:.55;cursor:default}
.dsh-python-env-rowIcon{flex:none;display:inline-flex;align-items:center;justify-content:center;width:16px;color:var(--dsw-alias-label-tertiary)}
.dsh-python-env-rowMain{display:flex;flex-direction:column;min-width:0;flex:1;gap:1px}
.dsh-python-env-rowLabel{font-family:var(--dsw-font-mono);font-size:12px;line-height:18px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-python-env-rowDetail{font-family:var(--dsw-font-mono);font-size:10px;line-height:15px;color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-python-env-badge{flex:none;border-radius:var(--dsw-radius-xs);background:var(--dsw-alias-state-business-tertiary);color:var(--dsw-alias-label-primary-bluish);padding:0 5px;font-size:10px;line-height:16px}
.dsh-python-env-pending{flex:none;color:var(--dsw-alias-label-tertiary);font-size:10px;line-height:16px}
.dsh-python-env-state{padding:14px 12px;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;text-align:center}
.dsh-python-env-stateError{color:var(--dsw-alias-state-error-primary)}
.dsh-python-env-foot{padding:7px 12px 9px;border-top:.5px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-tertiary);font-size:10px;line-height:15px;flex:none}
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
`

    function PythonIcon({ size = 14 }) {
      return h('svg', { viewBox: '0 0 16 16', width: size, height: size, 'aria-hidden': true }, [
        h('path', {
          key: 'left',
          d: 'M7.6 1.2c-2 0-3.2.9-3.2 2.3v1.6h3.3v.5H3.6C2.1 5.6 1.2 6.7 1.2 8.1s.9 2.5 2.4 2.5h1.1V8.9c0-1.3.9-2.2 2.2-2.2h3c1.2 0 2.1-.9 2.1-2.1V3.5c0-1.4-1.2-2.3-3.2-2.3H7.6Zm-1 1a.6.6 0 1 1 0 1.2.6.6 0 0 1 0-1.2Z',
          fill: 'currentColor',
        }),
        h('path', {
          key: 'right',
          d: 'M8.4 14.8c2 0 3.2-.9 3.2-2.3v-1.6H8.3v-.5h4.1c1.5 0 2.4-1.1 2.4-2.5s-.9-2.5-2.4-2.5H11.3v1.7c0 1.3-.9 2.2-2.2 2.2h-3c-1.2 0-2.1.9-2.1 2.1v1.1c0 1.4 1.2 2.3 3.2 2.3h1.2Zm1-1a.6.6 0 1 1 0-1.2.6.6 0 0 1 0 1.2Z',
          fill: 'currentColor',
          opacity: '.72',
        }),
      ])
    }

    function CondaIcon({ size = 14 }) {
      return h('svg', { viewBox: '0 0 16 16', width: size, height: size, 'aria-hidden': true },
        h('path', {
          d: 'M8 1.5 14 5v6l-6 3.5L2 11V5l6-3.5Zm0 1.3L3.1 5.6v4.8L8 13.2l4.9-2.8V5.6L8 2.8Zm0 2.1a3.1 3.1 0 1 1 0 6.2 3.1 3.1 0 0 1 0-6.2Zm0 1.2a1.9 1.9 0 1 0 0 3.8 1.9 1.9 0 0 0 0-3.8Z',
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

    function remoteErrorText(error, fallback) {
      if (error instanceof Error && error.message) return error.message
      if (error && typeof error === 'object' && typeof error.message === 'string') return error.message
      return fallback
    }

    function PythonEnvBar({ sessionId, useProjection, t, commands }) {
      const projection = useProjection(PROJECTION_KEY)
      const [open, setOpen] = React.useState(false)
      const [pending, setPending] = React.useState(undefined)
      const [refreshing, setRefreshing] = React.useState(false)
      const [switchError, setSwitchError] = React.useState(undefined)
      const [position, setPosition] = React.useState(undefined)
      const triggerRef = React.useRef(null)
      const menuRef = React.useRef(null)
      const refreshedFor = React.useRef(undefined)

      const environments = Array.isArray(projection?.environments)
        ? projection.environments.filter((env) => typeof env?.id === 'string' && typeof env?.label === 'string')
        : []
      const loading = projection === undefined || projection.loading === true
      const target = typeof projection?.target === 'string' && projection.target.length > 0
        ? projection.target
        : '…'
      const targetKind = projection?.targetKind
      const selectedLabel = projection === undefined
        ? '…'
        : (typeof projection.selectedLabel === 'string' && projection.selectedLabel.length > 0
          ? projection.selectedLabel
          : t('env.auto'))
      const selectedPath = typeof projection?.selectedPath === 'string' ? projection.selectedPath : ''
      const selectedActive = projection?.selectedActive !== false
      const autoSelected = projection === undefined
        || projection.selectedId === 'auto'
        || !selectedActive
      const effectiveSelectedLabel = projection === undefined
        ? '…'
        : autoSelected ? t('env.autoShort') : selectedLabel
      const effectiveSelectedDetail = !autoSelected && selectedPath.length > 0
        ? selectedPath
        : t('env.targetAuto')
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

      const refreshEnvironments = async (force = false) => {
        if (refreshing) return
        if (!commands) {
          setSwitchError('commands are unavailable')
          return
        }
        setRefreshing(true)
        setSwitchError(undefined)
        try {
          const line = force ? '/python-env refresh' : '/python-env'
          const result = await commands.execute(sessionId, line, [])
          if (!result.ok) {
            setSwitchError(remoteErrorText(result.error, 'unknown error'))
            return
          }
          if (result.value?.result.kind === 'error') {
            setSwitchError(result.value.result.text ?? 'unknown error')
          }
        } catch (caught) {
          setSwitchError(remoteErrorText(caught, 'unknown error'))
        } finally {
          setRefreshing(false)
        }
      }

      // Opening the picker refreshes the catalog for the current target once.
      // The host command also bumps the projection revision, so the returned
      // environment list lands in this component.
      React.useEffect(() => {
        if (!open) {
          refreshedFor.current = undefined
          return
        }
        const key = `${targetKind ?? ''}:${target}`
        if (refreshedFor.current === key) return
        refreshedFor.current = key
        void refreshEnvironments()
      }, [open, target, targetKind])

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

      const trigger = h('button', {
        ref: triggerRef,
        type: 'button',
        className: 'dsh-python-env-trigger',
        'aria-haspopup': 'menu',
        'aria-expanded': open,
        'aria-label': t('env.aria', { label: effectiveSelectedLabel }),
        title: t('env.choose'),
        onClick: () => {
          setOpen((current) => !current)
          setSwitchError(undefined)
        },
      }, [
        h(PythonIcon, { key: 'icon' }),
        h('span', { key: 'label', className: 'dsh-python-env-label' }, t('env.label')),
        h('span', { key: 'value', className: 'dsh-python-env-value' }, effectiveSelectedLabel),
        h('span', { key: 'detail', className: 'dsh-python-env-detail' }, effectiveSelectedDetail),
        h('span', { key: 'chevron', className: 'dsh-python-env-chevron' }, h(ChevronIcon)),
      ])

      const rows = []
      rows.push(h('button', {
        key: 'auto',
        type: 'button',
        className: 'dsh-python-env-row',
        'aria-current': selectedActive && projection?.selectedId === 'auto',
        disabled: pending !== undefined,
        onClick: () => { void choose('/python-env auto', 'auto') },
      }, [
        h('span', { key: 'icon', className: 'dsh-python-env-rowIcon' }, h(PythonIcon)),
        h('span', { key: 'main', className: 'dsh-python-env-rowMain' }, [
          h('span', { key: 'label', className: 'dsh-python-env-rowLabel' }, t('env.auto')),
          h('span', { key: 'detail', className: 'dsh-python-env-rowDetail' }, t('env.autoDetail')),
        ]),
        pending === 'auto' ? h('span', { key: 'pending', className: 'dsh-python-env-pending' }, t('env.switching'))
          : selectedActive && projection?.selectedId === 'auto' ? h('span', { key: 'badge', className: 'dsh-python-env-badge' }, t('env.current'))
            : null,
      ]))

      if (targetKind === 'unknown') {
        rows.push(h('div', { key: 'unknown', className: 'dsh-python-env-state dsh-python-env-stateError' }, t('env.unknownTarget')))
      } else if (loading) {
        rows.push(h('div', { key: 'loading', className: 'dsh-python-env-state' }, t('env.loading')))
      } else if (environments.length === 0) {
        rows.push(h('div', { key: 'empty', className: 'dsh-python-env-state' }, t('env.noEnvs')))
      } else {
        const conda = environments.filter((env) => env.kind === 'conda')
        const pythons = environments.filter((env) => env.kind !== 'conda')
        const appendSection = (key, title, list, icon) => {
          if (list.length === 0) return
          rows.push(h('div', { key: `${key}-section`, className: 'dsh-python-env-section' }, title))
          for (const env of list) {
            const isCurrent = selectedActive && projection?.selectedId === env.id
            rows.push(h('button', {
              key: env.id,
              type: 'button',
              className: 'dsh-python-env-row',
              'aria-current': isCurrent,
              disabled: pending !== undefined,
              onClick: () => { void choose(`/python-env ${env.id}`, env.label) },
            }, [
              h('span', { key: 'icon', className: 'dsh-python-env-rowIcon' }, h(icon)),
              h('span', { key: 'main', className: 'dsh-python-env-rowMain' }, [
                h('span', { key: 'label', className: 'dsh-python-env-rowLabel' }, env.label),
                h('span', { key: 'detail', className: 'dsh-python-env-rowDetail' }, env.detail),
              ]),
              pending === env.label ? h('span', { key: 'pending', className: 'dsh-python-env-pending' }, t('env.switching'))
                : isCurrent ? h('span', { key: 'badge', className: 'dsh-python-env-badge' }, t('env.current'))
                  : null,
            ]))
          }
        }
        appendSection('conda', t('env.condaSection'), conda, CondaIcon)
        appendSection('python', t('env.pythonSection'), pythons, PythonIcon)
      }

      const menu = open && position !== undefined ? createPortal(h('div', {
        ref: menuRef,
        className: 'dsh-python-env-menu',
        role: 'menu',
        'aria-label': t('env.choose'),
        tabIndex: -1,
        style: {
          left: `${position.left}px`,
          bottom: `${position.bottom}px`,
          width: `${position.width}px`,
          maxHeight: `${position.maxHeight}px`,
        },
      }, [
        h('div', { key: 'head', className: 'dsh-python-env-head' }, [
          h('span', { key: 'title', className: 'dsh-python-env-title' }, t('env.choose')),
          h('span', { key: 'target', className: 'dsh-python-env-target' }, target),
          h('button', {
            key: 'refresh',
            type: 'button',
            className: 'dsh-python-env-iconButton',
            title: t('env.refresh'),
            'aria-label': t('env.refresh'),
            disabled: refreshing,
            onClick: () => { void refreshEnvironments(true) },
          }, h(RefreshIcon)),
        ]),
        h('div', { key: 'body', className: 'dsh-python-env-body' }, rows),
        refreshing ? h('div', { key: 'refreshing', className: 'dsh-python-env-state' }, t('env.refreshing')) : null,
        displayError === undefined ? null : h('div', {
          key: 'error',
          className: 'dsh-python-env-state dsh-python-env-stateError',
          role: 'status',
        }, t('env.error', { error: displayError })),
        h('div', { key: 'foot', className: 'dsh-python-env-foot' }, t('env.hint', { target })),
      ]), document.body) : null

      return h(React.Fragment, null,
        h('div', { className: 'dsh-python-env-bar' }, trigger),
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
      }, 'python-env: client styles')

      ctx.effect(
        () => ctx.locale.register('python-env', { zh, en }),
        'python-env: dictionaries',
      )

      ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
        name: 'conversation.input.dock',
        id: 'python-env',
        order: 6,
        locale: 'python-env',
        inject: () => ({ commands: ctx.remote.commands }),
      }, PythonEnvBar))
    }

    return { inject, apply }
  },
})
