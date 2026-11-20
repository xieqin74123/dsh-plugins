window.__ModuleLoader__.load({
  id: '@local/dsh-ssh-hosts',
  factory(require) {
    const React = require('react')
    const { createPortal } = require('react-dom')
    const h = React.createElement

    const PACKAGE = '@local/dsh-ssh-hosts'
    const HOST_COMMAND_PREFIX = 'ssh-'
    const LOCAL_ROW_KEY = 'ssh-local'
    const PROJECTION_KEY = 'ssh-target'

    const zh = {
      'bar.label': '执行目标',
      'bar.choose': '选择执行目标',
      'bar.localhost': 'localhost',
      'bar.localDetail': '本机 · 不通过 SSH',
      'bar.current': '当前',
      'bar.refresh': '刷新主机列表',
      'bar.loading': '读取主机…',
      'bar.error': '无法读取主机：{error}',
      'bar.unknown': '未知目标：{target}',
      'bar.switching': '切换中…',
      'bar.failed': '切换失败：{error}',
      'bar.hint': 'Agent 将在该目标上执行命令',
      'bar.noHosts': '~/.ssh/config 中没有主机',
      'bar.hostSection': 'SSH 主机',
      'bar.unknownSection': '未识别的选择',
      'bar.aria': '当前执行目标：{target}。点击选择 localhost 或其他 SSH 主机',
      'bar.targetValue': '{target}',
      'bar.close': '关闭',
    }

    const en = {
      'bar.label': 'Target',
      'bar.choose': 'Choose execution target',
      'bar.localhost': 'localhost',
      'bar.localDetail': 'This machine · no SSH',
      'bar.current': 'Current',
      'bar.refresh': 'Refresh hosts',
      'bar.loading': 'Loading hosts…',
      'bar.error': 'Could not load hosts: {error}',
      'bar.unknown': 'Unknown target: {target}',
      'bar.switching': 'Switching…',
      'bar.failed': 'Could not switch: {error}',
      'bar.hint': 'The Agent runs commands on this target',
      'bar.noHosts': 'No hosts in ~/.ssh/config',
      'bar.hostSection': 'SSH hosts',
      'bar.unknownSection': 'Unresolved selection',
      'bar.aria': 'Current execution target: {target}. Click to choose localhost or another SSH host',
      'bar.targetValue': '{target}',
      'bar.close': 'Close',
    }

    const STYLE = `
.dsh-ssh-target-bar{box-sizing:border-box;width:calc(100% - var(--dsh-composer-side-clearance) - var(--dsh-composer-side-clearance) - var(--dsh-composer-dock-inset) - var(--dsh-composer-dock-inset));max-width:calc(var(--dsh-composer-card-max-width) - var(--dsh-composer-dock-inset) - var(--dsh-composer-dock-inset));margin:0 auto;padding:0 var(--dsh-composer-dock-inset);display:flex;align-items:center;gap:8px;flex:none}
.dsh-ssh-target-trigger{box-sizing:border-box;display:inline-flex;align-items:center;gap:7px;max-width:100%;min-height:28px;padding:2px 9px 2px 8px;border:.5px solid var(--dsw-alias-border-l1);border-radius:999px;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);cursor:pointer;font:inherit;font-size:12px;line-height:18px}
.dsh-ssh-target-trigger:hover,.dsh-ssh-target-trigger[aria-expanded=true]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsh-ssh-target-trigger:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
.dsh-ssh-target-trigger svg{flex:none;display:block}
.dsh-ssh-target-label{flex:none;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}
.dsh-ssh-target-value{min-width:0;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:var(--dsw-font-mono);font-size:12px;line-height:18px;color:var(--dsw-alias-label-primary)}
.dsh-ssh-target-address{min-width:0;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary)}
.dsh-ssh-target-chevron{flex:none;color:var(--dsw-alias-label-tertiary)}
.dsh-ssh-target-menu{z-index:100;box-sizing:border-box;position:fixed;display:flex;flex-direction:column;overflow:hidden;border:.5px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-lg);background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-primary);backdrop-filter:none;-webkit-backdrop-filter:none;box-shadow:var(--dsw-elevation-prominent);font-size:13px;line-height:20px}
.dsh-ssh-target-menu:focus{outline:none}
.dsh-ssh-target-head{display:flex;align-items:center;gap:8px;padding:9px 12px;border-bottom:.5px solid var(--dsw-alias-border-l1);flex:none}
.dsh-ssh-target-title{flex:1;min-width:0;font-size:12px;font-weight:600;line-height:18px}
.dsh-ssh-target-iconButton{flex:none;display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;padding:0;border:0;border-radius:var(--dsw-radius-sm);background:0 0;color:var(--dsw-alias-label-tertiary);cursor:pointer}
.dsh-ssh-target-iconButton:hover,.dsh-ssh-target-iconButton:focus-visible{background:var(--dsw-alias-fill-l1);color:var(--dsw-alias-label-primary)}
.dsh-ssh-target-body{flex:1;min-height:0;overflow-y:auto;padding:4px}
.dsh-ssh-target-section{padding:4px 8px 3px;color:var(--dsw-alias-label-tertiary);font-size:10px;line-height:15px;letter-spacing:.02em;text-transform:uppercase}
.dsh-ssh-target-row{box-sizing:border-box;display:flex;align-items:center;gap:9px;width:100%;min-height:34px;padding:5px 8px;border:0;border-radius:var(--dsw-radius-md);background:0 0;color:inherit;text-align:left;cursor:pointer;font:inherit}
.dsh-ssh-target-row:hover,.dsh-ssh-target-row:focus-visible{background:var(--dsw-alias-fill-l1)}
.dsh-ssh-target-row[aria-current=true]{background:var(--dsw-alias-fill-l2)}
.dsh-ssh-target-rowIcon{flex:none;display:inline-flex;align-items:center;justify-content:center;width:16px;color:var(--dsw-alias-label-tertiary)}
.dsh-ssh-target-rowMain{display:flex;flex-direction:column;min-width:0;flex:1;gap:1px}
.dsh-ssh-target-rowLabel{font-family:var(--dsw-font-mono);font-size:12px;line-height:18px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-ssh-target-rowDetail{font-family:var(--dsw-font-mono);font-size:10px;line-height:15px;color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-ssh-target-badge{flex:none;border-radius:var(--dsw-radius-xs);background:var(--dsw-alias-state-business-tertiary);color:var(--dsw-alias-label-primary-bluish);padding:0 5px;font-size:10px;line-height:16px}
.dsh-ssh-target-pending{flex:none;color:var(--dsw-alias-label-tertiary);font-size:10px;line-height:16px}
.dsh-ssh-target-state{padding:14px 12px;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;text-align:center}
.dsh-ssh-target-stateError{color:var(--dsw-alias-state-error-primary)}
.dsh-ssh-target-foot{padding:7px 12px 9px;border-top:.5px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-tertiary);font-size:10px;line-height:15px;flex:none}
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

    function TerminalIcon({ size = 14 }) {
      return h('svg', { viewBox: '0 0 16 16', width: size, height: size, 'aria-hidden': true },
        h('path', {
          d: 'M2.2 2.5h11.6c.7 0 1.2.5 1.2 1.2v8.6c0 .7-.5 1.2-1.2 1.2H2.2c-.7 0-1.2-.5-1.2-1.2V3.7c0-.7.5-1.2 1.2-1.2Zm0 1.1c-.1 0-.2.1-.2.2v8.6c0 .1.1.2.2.2h11.6c.1 0 .2-.1.2-.2V3.8c0-.1-.1-.2-.2-.2H2.2Zm1.6 1.7 2.7 2.1-2.7 2.1-.7-.9 1.8-1.2-1.8-1.2.7-.9Zm3.1 3.9h3v1.1h-3v-1.1Z',
          fill: 'currentColor',
        }))
    }

    function HomeIcon({ size = 14 }) {
      return h('svg', { viewBox: '0 0 16 16', width: size, height: size, 'aria-hidden': true },
        h('path', {
          d: 'M8 1.6 1.7 7.1l.7.8 1.1-1v6.5c0 .6.5 1.1 1.1 1.1h2.3v-3.6h2.2v3.6h2.3c.6 0 1.1-.5 1.1-1.1V6.9l1.1 1 .7-.8L8 1.6Z',
          fill: 'currentColor',
        }))
    }

    function ServerIcon({ size = 14 }) {
      return h('svg', { viewBox: '0 0 16 16', width: size, height: size, 'aria-hidden': true },
        h('path', {
          d: 'M3 2.2h10c.6 0 1.1.5 1.1 1.1v3c0 .6-.5 1.1-1.1 1.1H3c-.6 0-1.1-.5-1.1-1.1v-3c0-.6.5-1.1 1.1-1.1Zm0 1.1c-.1 0-.1 0-.1.1v3c0 .1 0 .1.1.1h10c.1 0 .1 0 .1-.1v-3c0-.1 0-.1-.1-.1H3Zm0 5.3h10c.6 0 1.1.5 1.1 1.1v3c0 .6-.5 1.1-1.1 1.1H3c-.6 0-1.1-.5-1.1-1.1v-3c0-.6.5-1.1 1.1-1.1Zm0 1.1c-.1 0-.1 0-.1.1v3c0 .1 0 .1.1.1h10c.1 0 .1 0 .1-.1v-3c0-.1 0-.1-.1-.1H3Zm1.3-5.9h1.2v1.1H4.3V3.8Zm0 5.3h1.2v1.1H4.3V9.1Z',
          fill: 'currentColor',
        }))
    }

    function ChevronIcon({ size = 12 }) {
      return h('svg', { viewBox: '0 0 16 16', width: size, height: size, 'aria-hidden': true },
        h('path', {
          d: 'm4.2 6 3.8 4 3.8-4 .9.8-4.7 5-4.7-5 .9-.8Z',
          fill: 'currentColor',
        }))
    }

    function RefreshIcon({ size = 13 }) {
      return h('svg', { viewBox: '0 0 16 16', width: size, height: size, 'aria-hidden': true },
        h('path', {
          d: 'M8 2.3a5.7 5.7 0 1 1-5.4 7.5h1.3A4.4 4.4 0 1 0 8 3.6H6.9l1.5 1.5-.8.8L4.7 3l2.9-2.9.8.8-1.5 1.4H8Z',
          fill: 'currentColor',
        }))
    }

    function CheckIcon({ size = 13 }) {
      return h('svg', { viewBox: '0 0 16 16', width: size, height: size, 'aria-hidden': true },
        h('path', {
          d: 'm13.4 3.6-7.2 7.2-3.6-3.6.8-.8 2.8 2.8 6.4-6.4.8.8Z',
          fill: 'currentColor',
        }))
    }

    function remoteErrorText(error, fallback) {
      if (error instanceof Error && error.message) return error.message
      if (error && typeof error === 'object' && typeof error.message === 'string') return error.message
      return fallback
    }

    function slugifyAlias(alias) {
      return alias
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 48)
    }

    /**
     * Read the host rows out of the `/ssh` listing result. The projection is the
     * primary source, but a listing carries the same rows immediately, which
     * keeps the picker correct even when a cached projection is stale.
     */
    function parseHostTable(text) {
      if (typeof text !== 'string' || text.length === 0) return undefined
      if (/No SSH hosts were found/i.test(text)) return []
      const rows = []
      for (const line of text.split('\n')) {
        const match = /^-\s+(.+?)\s+—\s+(.+)$/.exec(line)
        if (match === null) continue
        rows.push({ alias: match[1], address: match[2] })
      }
      return rows.length === 0 ? undefined : rows
    }

    function SshTargetBar({ sessionId, useProjection, t, commands }) {
      const projection = useProjection(PROJECTION_KEY)
      const [open, setOpen] = React.useState(false)
      const [pending, setPending] = React.useState(undefined)
      const [refreshing, setRefreshing] = React.useState(false)
      const [switchError, setSwitchError] = React.useState(undefined)
      const [position, setPosition] = React.useState(undefined)
      const [listedHosts, setListedHosts] = React.useState(undefined)
      const triggerRef = React.useRef(null)
      const menuRef = React.useRef(null)

      const projectedHosts = Array.isArray(projection?.hosts) ? projection.hosts : []
      const hosts = (listedHosts ?? projectedHosts).filter((host) => typeof host?.alias === 'string')
      const loading = projection === undefined

      const target = projection === undefined
        ? undefined
        : typeof projection.target === 'string' && projection.target.length > 0
          ? projection.target
          : 'localhost'
      const kind = projection === undefined ? undefined : projection.kind
      const historicalSlug = typeof target === 'string' && target.startsWith(HOST_COMMAND_PREFIX)
        ? target.slice(HOST_COMMAND_PREFIX.length)
        : undefined
      const host = target === undefined || kind === 'localhost'
        ? undefined
        : (hosts.find((candidate) => candidate.alias === target)
          ?? (historicalSlug === undefined
            ? undefined
            : hosts.find((candidate) => slugifyAlias(candidate.alias) === historicalSlug)))
      // The host catalog can finish loading after the projection's first read;
      // resolve an unknown label against the fresh catalog before showing it.
      const effectiveKind = host !== undefined ? 'host' : kind

      const targetLabel = target === undefined
        ? '…'
        : effectiveKind === 'host'
          ? (host?.alias ?? target)
          : effectiveKind === 'unknown'
            ? t('bar.unknown', { target })
            : t('bar.localhost')
      const targetDetail = effectiveKind === 'host' && host !== undefined
        ? host.address
        : effectiveKind === 'localhost'
          ? t('bar.localDetail')
          : undefined

      const place = React.useCallback(() => {
        const trigger = triggerRef.current
        if (!trigger) return
        const rect = trigger.getBoundingClientRect()
        const width = Math.min(360, Math.max(260, window.innerWidth - 16))
        const left = Math.min(Math.max(8, rect.left), Math.max(8, window.innerWidth - width - 8))
        setPosition({
          left,
          width,
          bottom: window.innerHeight - rect.top + 6,
          maxHeight: Math.max(160, rect.top - 16),
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

      // A table parsed from the most recent explicit refresh is more current than
      // a cached projection that never republished (for example after a plugin
      // reload), so it stays authoritative until the next refresh.

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

      const refreshHosts = async () => {
        if (refreshing) return
        if (!commands) {
          setSwitchError('commands are unavailable')
          return
        }
        setRefreshing(true)
        setSwitchError(undefined)
        try {
          // `/ssh` with no input re-lists the catalog; the projection bumps its
          // revision so the picker receives the fresh host rows.
          const result = await commands.execute(sessionId, '/ssh', [])
          if (!result.ok) {
            setSwitchError(remoteErrorText(result.error, 'unknown error'))
            return
          }
          if (result.value?.result.kind === 'error') {
            setSwitchError(result.value.result.text ?? 'unknown error')
            return
          }
          const listed = parseHostTable(result.value?.result.text)
          if (listed !== undefined) setListedHosts(listed)
        } catch (caught) {
          setSwitchError(remoteErrorText(caught, 'unknown error'))
        } finally {
          setRefreshing(false)
        }
      }

      const trigger = h('button', {
        ref: triggerRef,
        type: 'button',
        className: 'dsh-ssh-target-trigger',
        'aria-haspopup': 'menu',
        'aria-expanded': open,
        'aria-label': t('bar.aria', { target: targetLabel }),
        title: t('bar.choose'),
        onClick: () => {
          setOpen((current) => !current)
          setSwitchError(undefined)
        },
      }, [
        h(TerminalIcon, { key: 'icon' }),
        h('span', { key: 'label', className: 'dsh-ssh-target-label' }, t('bar.label')),
        h('span', { key: 'value', className: 'dsh-ssh-target-value' }, targetLabel),
        targetDetail === undefined
          ? null
          : h('span', { key: 'detail', className: 'dsh-ssh-target-address' }, targetDetail),
        h('span', { key: 'chevron', className: 'dsh-ssh-target-chevron' }, h(ChevronIcon)),
      ])

      const rows = []
      rows.push(h('button', {
        key: LOCAL_ROW_KEY,
        type: 'button',
        className: 'dsh-ssh-target-row',
        'aria-current': effectiveKind === 'localhost',
        onClick: () => { void choose('/ssh localhost', 'localhost') },
      }, [
        h('span', { key: 'icon', className: 'dsh-ssh-target-rowIcon' }, h(HomeIcon)),
        h('span', { key: 'main', className: 'dsh-ssh-target-rowMain' }, [
          h('span', { key: 'label', className: 'dsh-ssh-target-rowLabel' }, t('bar.localhost')),
          h('span', { key: 'detail', className: 'dsh-ssh-target-rowDetail' }, t('bar.localDetail')),
        ]),
        pending === 'localhost' ? h('span', { key: 'pending', className: 'dsh-ssh-target-pending' }, t('bar.switching'))
          : effectiveKind === 'localhost' ? h('span', { key: 'badge', className: 'dsh-ssh-target-badge' }, t('bar.current'))
            : null,
      ]))

      if (effectiveKind === 'unknown' && target !== undefined) {
        rows.push(h('div', {
          key: 'unknown',
          className: 'dsh-ssh-target-section',
        }, t('bar.unknownSection')))
        rows.push(h('div', {
          key: 'unknown-row',
          className: 'dsh-ssh-target-row',
          'aria-current': true,
        }, [
          h('span', { key: 'icon', className: 'dsh-ssh-target-rowIcon' }, h(ServerIcon)),
          h('span', { key: 'main', className: 'dsh-ssh-target-rowMain' }, [
            h('span', { key: 'label', className: 'dsh-ssh-target-rowLabel' }, target),
            h('span', { key: 'detail', className: 'dsh-ssh-target-rowDetail' }, t('bar.unknown', { target })),
          ]),
        ]))
      }

      rows.push(h('div', { key: 'host-section', className: 'dsh-ssh-target-section' }, t('bar.hostSection')))
      if (loading && hosts.length === 0) {
        rows.push(h('div', { key: 'loading', className: 'dsh-ssh-target-state' }, t('bar.loading')))
      } else if (hosts.length === 0) {
        rows.push(h('div', { key: 'empty', className: 'dsh-ssh-target-state' }, t('bar.noHosts')))
      } else {
        for (const row of hosts) {
          rows.push(h('button', {
            key: row.alias,
            type: 'button',
            className: 'dsh-ssh-target-row',
            'aria-current': effectiveKind === 'host' && host?.alias === row.alias,
            onClick: () => { void choose(`/ssh ${row.alias}`, row.alias) },
          }, [
            h('span', { key: 'icon', className: 'dsh-ssh-target-rowIcon' }, h(ServerIcon)),
            h('span', { key: 'main', className: 'dsh-ssh-target-rowMain' }, [
              h('span', { key: 'label', className: 'dsh-ssh-target-rowLabel' }, row.alias),
              h('span', { key: 'detail', className: 'dsh-ssh-target-rowDetail' }, row.address),
            ]),
            pending === row.alias ? h('span', { key: 'pending', className: 'dsh-ssh-target-pending' }, t('bar.switching'))
              : effectiveKind === 'host' && host?.alias === row.alias ? h('span', { key: 'badge', className: 'dsh-ssh-target-badge' }, t('bar.current'))
                : null,
          ]))
        }
      }

      const menu = open && position !== undefined ? createPortal(h('div', {
        ref: menuRef,
        className: 'dsh-ssh-target-menu',
        role: 'menu',
        'aria-label': t('bar.choose'),
        tabIndex: -1,
        style: {
          left: `${position.left}px`,
          bottom: `${position.bottom}px`,
          width: `${position.width}px`,
          maxHeight: `${position.maxHeight}px`,
        },
      }, [
        h('div', { key: 'head', className: 'dsh-ssh-target-head' }, [
          h('span', { key: 'title', className: 'dsh-ssh-target-title' }, t('bar.choose')),
          h('button', {
            key: 'refresh',
            type: 'button',
            className: 'dsh-ssh-target-iconButton',
            title: t('bar.refresh'),
            'aria-label': t('bar.refresh'),
            disabled: refreshing,
            onClick: () => { void refreshHosts() },
          }, h(RefreshIcon)),
        ]),
        h('div', { key: 'body', className: 'dsh-ssh-target-body' }, rows),
        switchError === undefined ? null : h('div', {
          key: 'error',
          className: 'dsh-ssh-target-state dsh-ssh-target-stateError',
          role: 'status',
        }, t('bar.failed', { error: switchError })),
        h('div', { key: 'foot', className: 'dsh-ssh-target-foot' }, t('bar.hint')),
      ]), document.body) : null

      return h(React.Fragment, null,
        h('div', { className: 'dsh-ssh-target-bar' }, trigger),
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
      }, 'ssh-hosts: client styles')

      ctx.effect(
        () => ctx.locale.register('ssh-hosts', { zh, en }),
        'ssh-hosts: dictionaries',
      )

      ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
        name: 'conversation.input.dock',
        id: 'ssh-target',
        order: 5,
        locale: 'ssh-hosts',
        inject: () => ({ commands: ctx.remote.commands }),
      }, SshTargetBar))
    }

    return { inject, apply }
  },
})
