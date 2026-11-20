window.__ModuleLoader__.load({
  id: '@local/dsh-session-notify',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const PACKAGE = '@local/dsh-session-notify'
    const NS = 'sessionNotify'
    const TITLE = 'Deepseek Harness'
    const PREFS_KEY = 'dsh.session-notify.disabled.v1'
    const NOTIFICATION_TAG = 'dsh-session-notify'
    const TITLE_LIMIT = 80

    const zh = {
      'toggle.off': '开启本会话的系统通知',
      'toggle.on': '关闭本会话的系统通知',
      'toggle.ask': '通知已开启，但浏览器尚未授权；关闭后再开启即可授权',
      'toggle.blocked': '系统通知被浏览器阻止，请在站点设置中允许',
      'toggle.unsupported': '当前浏览器不支持系统通知',
      'notify.body': '[{title}]：{message}',
      'notify.complete': '回复已就绪',
      'notify.question': '请求回答',
      'notify.approval': '请求批复',
      'notify.plan': '请求确认计划',
      'notify.other': '需要你的操作',
    }

    const en = {
      'toggle.off': 'Enable notifications for this session',
      'toggle.on': 'Disable notifications for this session',
      'toggle.ask': 'Notifications are on but not authorized; turn them off and on to allow them',
      'toggle.blocked': 'Notifications are blocked; allow them in the site settings',
      'toggle.unsupported': 'This browser does not support desktop notifications',
      'notify.body': '[{title}]: {message}',
      'notify.complete': 'Reply is ready',
      'notify.question': 'The Agent is asking you a question',
      'notify.approval': 'The Agent needs your approval',
      'notify.plan': 'The Agent wants you to confirm a plan',
      'notify.other': 'The Agent needs your input',
    }

    const STYLE = `
.dsh-session-notify-button{position:relative;flex:none;box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:0;border:0;border-radius:999px;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;transition:background-color .12s ease,color .12s ease,opacity .12s ease}
.dsh-session-notify-button:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}
.dsh-session-notify-button:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
.dsh-session-notify-button[data-enabled="false"]{opacity:.65}
.dsh-session-notify-button[data-enabled="true"]{color:var(--dsw-alias-state-business-primary)}
.dsh-session-notify-button[data-enabled="true"]:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-state-business-primary)}
.dsh-session-notify-button[data-enabled="true"] svg{filter:drop-shadow(0 0 3px color-mix(in srgb,currentColor 35%,transparent))}
.dsh-session-notify-dot{position:absolute;top:3px;right:3px;width:6px;height:6px;border-radius:50%;box-shadow:0 0 0 1.5px var(--dsw-alias-bg-module-platform,var(--dsw-alias-bg-l1,#fff))}
.dsh-session-notify-dot[data-state="pending"]{background:var(--dsw-alias-state-warning-primary,#d9a300)}
.dsh-session-notify-dot[data-state="blocked"]{background:var(--dsw-alias-state-error-primary,#e5484d)}
`

    /** Minimal React-compatible snapshot store. */
    function createStore(initial) {
      let value = initial
      const listeners = new Set()
      return {
        getSnapshot: () => value,
        subscribe(listener) {
          listeners.add(listener)
          return () => {
            listeners.delete(listener)
          }
        },
        set(next) {
          if (Object.is(next, value)) return
          value = next
          for (const listener of [...listeners]) listener()
        },
      }
    }

    function readJson(key, fallback) {
      try {
        const raw = window.localStorage.getItem(key)
        if (raw === null) return fallback
        const parsed = JSON.parse(raw)
        return parsed !== null && typeof parsed === 'object' ? parsed : fallback
      } catch {
        return fallback
      }
    }

    function writeJson(key, value) {
      try {
        window.localStorage.setItem(key, JSON.stringify(value))
      } catch {
        // Storage can be unavailable (private mode, quota); notifications still work.
      }
    }

    /** Sessions explicitly switched off; absent means enabled (the default). */
    const disabledStore = createStore(readJson(PREFS_KEY, {}))

    function isEnabled(sessionId) {
      return disabledStore.getSnapshot()[sessionId] !== true
    }

    function setEnabled(sessionId, enabled) {
      const current = disabledStore.getSnapshot()
      if (enabled === (current[sessionId] !== true)) return
      const next = { ...current }
      if (enabled) delete next[sessionId]
      else next[sessionId] = true
      disabledStore.set(next)
      writeJson(PREFS_KEY, next)
    }

    function syncPreferences() {
      disabledStore.set(readJson(PREFS_KEY, {}))
    }

    /** `Notification.permission`, or a sentinel the UI can style. */
    function currentPermission() {
      if (typeof Notification === 'undefined') return 'unsupported'
      return Notification.permission
    }

    const permissionStore = createStore(currentPermission())

    function refreshPermission() {
      permissionStore.set(currentPermission())
    }

    let permissionRequest
    function requestPermission() {
      if (currentPermission() !== 'default') return Promise.resolve()
      if (permissionRequest !== undefined) return permissionRequest
      permissionRequest = (async () => {
        try {
          await Notification.requestPermission()
        } catch {
          // A refused prompt leaves the permission at "default"; the next click retries.
        } finally {
          permissionRequest = undefined
          refreshPermission()
        }
      })()
      return permissionRequest
    }

    /**
     * Ask once, from the user's first gesture. Browsers ignore or reject a
     * permission request that no gesture backs, so this is the only reliable
     * way to grant the default-enabled preference without the user having to
     * touch the switch.
     */
    /** Whether a gesture belongs to the notification switch itself. */
    function isNotifyControl(target) {
      return target !== null && typeof target === 'object' && typeof target.closest === 'function'
        ? target.closest('.dsh-session-notify-button') !== null
        : false
    }

    function armPermissionPrompt() {
      if (currentPermission() !== 'default') return () => {}
      let asked = false
      const cleanup = () => {
        document.removeEventListener('pointerdown', ask, true)
        document.removeEventListener('keydown', ask, true)
      }
      const ask = (event) => {
        if (asked) return
        // The switch owns its own click: it authorizes when it turns on and
        // must stay able to turn off without the global prompt firing first.
        if (event !== undefined && isNotifyControl(event.target)) return
        asked = true
        cleanup()
        void requestPermission()
      }
      document.addEventListener('pointerdown', ask, true)
      document.addEventListener('keydown', ask, true)
      return cleanup
    }

    /** Mirror out-of-band permission changes into the switch's indicator. */
    function watchPermission() {
      refreshPermission()
      let active = true
      const refresh = () => {
        refreshPermission()
      }
      window.addEventListener('focus', refresh)
      document.addEventListener('visibilitychange', refresh)
      let status
      let query
      if (typeof navigator !== 'undefined' && navigator.permissions && typeof navigator.permissions.query === 'function') {
        try {
          query = navigator.permissions.query({ name: 'notifications' })
          if (query && typeof query.then === 'function') {
            query.then((result) => {
              if (!active) return
              status = result
              if (status && typeof status.addEventListener === 'function') {
                status.addEventListener('change', refresh)
              }
            }, () => {})
          }
        } catch {
          // Permissions API unsupported; focus and visibility still refresh the state.
        }
      }
      return () => {
        active = false
        window.removeEventListener('focus', refresh)
        document.removeEventListener('visibilitychange', refresh)
        if (status && typeof status.removeEventListener === 'function') {
          status.removeEventListener('change', refresh)
        }
      }
    }

    function savePreferencesListener() {
      const onStorage = (event) => {
        if (event.key === PREFS_KEY) syncPreferences()
      }
      window.addEventListener('storage', onStorage)
      return () => {
        window.removeEventListener('storage', onStorage)
      }
    }

    /** The session the main view is showing, if any. */
    function activeSessionId(ctx) {
      const list = ctx.sessions.list.getSnapshot()
      for (const sessionId of list.ids) {
        const row = list.byId[sessionId]
        if (row && (row.retainedBy?.mainView ?? 0) > 0) return sessionId
      }
      return undefined
    }

    /**
     * Whether the user is looking at this session right now: the page is
     * visible and focused, no global panel covers the conversation, and this
     * session is the one the main view retained.
     */
    function userIsAttending(ctx, sessionId) {
      if (typeof document === 'undefined') return false
      if (document.visibilityState !== 'visible') return false
      if (typeof document.hasFocus === 'function' && !document.hasFocus()) return false
      const layout = ctx.get('layout')
      if (layout && layout.panelInfo && typeof layout.panelInfo.getSnapshot === 'function') {
        try {
          if (layout.panelInfo.getSnapshot().activePanelId != null) return false
        } catch {
          // Treat an unreadable panel store as "no panel" rather than dropping the alert.
        }
      }
      return activeSessionId(ctx) === sessionId
    }

    /**
     * Background subagents are internal work, not the conversation the person
     * is following, so their completions stay silent unless the main view has
     * that subagent open. Sessions missing from the catalog are also ignored:
     * they cannot be named or opened from a notification.
     */
    function isNotifiableSession(ctx, sessionId) {
      const row = ctx.sessions.list.getSnapshot().byId[sessionId]
      if (row === undefined) return false
      if (row.origin === 'subagent' && (row.retainedBy?.mainView ?? 0) === 0) return false
      return true
    }

    function sessionTitle(ctx, sessionId) {
      const row = ctx.sessions.list.getSnapshot().byId[sessionId]
      const title = row?.displayTitle || row?.title
      const text = typeof title === 'string' ? title.replace(/\s+/gu, ' ').trim() : ''
      const label = text === '' ? String(sessionId) : text
      return label.length > TITLE_LIMIT ? `${label.slice(0, TITLE_LIMIT - 1)}…` : label
    }

    /** Notifications currently on screen, keyed by their tag, so a resolved
     * request can withdraw the alert that pointed at it. */
    const liveNotifications = new Map()

    function notificationTag(sessionId, kind, interactionKey) {
      return kind === 'complete'
        ? `${NOTIFICATION_TAG}:${sessionId}:complete`
        : `${NOTIFICATION_TAG}:${sessionId}:${kind}:${interactionKey ?? ''}`
    }

    function closeLiveNotification(tag) {
      const notification = liveNotifications.get(tag)
      if (notification === undefined) return
      liveNotifications.delete(tag)
      try {
        notification.close()
      } catch {
        // Closing an already-dismissed notification is harmless.
      }
    }

    const KIND_MESSAGES = {
      complete: 'notify.complete',
      question: 'notify.question',
      approval: 'notify.approval',
      plan: 'notify.plan',
      other: 'notify.other',
    }

    function deliver(ctx, t, sessionId, kind, interactionKey) {
      if (!isEnabled(sessionId)) return false
      if (!isNotifiableSession(ctx, sessionId)) return false
      if (currentPermission() !== 'granted') return false
      if (userIsAttending(ctx, sessionId)) return false

      // Same tag replaces a stale notification instead of stacking one per
      // page when several DSH tabs are open; renotify re-alerts on a new turn.
      const tag = notificationTag(sessionId, kind, interactionKey)

      const body = t('notify.body', {
        title: sessionTitle(ctx, sessionId),
        message: t(KIND_MESSAGES[kind] ?? KIND_MESSAGES.other),
      })

      let notification
      try {
        notification = new Notification(TITLE, {
          body,
          tag,
          renotify: true,
          requireInteraction: kind !== 'complete',
        })
      } catch (error) {
        console.warn('[session-notify] could not show a notification:', error)
        return false
      }

      liveNotifications.set(tag, notification)
      if (typeof notification.addEventListener === 'function') {
        notification.addEventListener('close', () => {
          if (liveNotifications.get(tag) === notification) liveNotifications.delete(tag)
        })
      }
      notification.onclick = () => {
        try {
          window.focus()
        } catch {
          // Some embedders refuse window.focus(); opening the session still helps.
        }
        const workspace = ctx.get('uiWorkspace')
        if (workspace && typeof workspace.openSession === 'function') {
          try {
            workspace.openSession(sessionId)
          } catch (error) {
            console.warn('[session-notify] could not open the session:', error)
          }
        }
        closeLiveNotification(tag)
      }
      return true
    }

    /** Map a pending interaction's domain kind to the copy family. */
    function pendingKind(pending) {
      if (pending.kind === 'approval') return 'approval'
      if (pending.kind === 'plan-review') return 'plan'
      if (pending.kind === 'question') return 'question'
      return 'other'
    }

    /**
     * Deliver any still-pending request the user is no longer looking at.
     * Runs when attention changes (blur, tab hidden, session switch, panel
     * open), so a question that arrived while the user watched the session is
     * still announced if they leave before answering it.
     */
    function sweepPending(ctx, t, notified) {
      const snapshot = ctx.uiSession.sessionStatus.getSnapshot()
      for (const [sessionId, status] of snapshot) {
        const pending = status.pendingInteraction
        if (pending === undefined) continue
        const key = `${sessionId}\u0000${pending.key}`
        if (notified.has(key)) continue
        if (deliver(ctx, t, sessionId, pendingKind(pending), pending.key)) notified.add(key)
      }
    }

    /**
     * Watch the unified Session status and turn it into alerts:
     * running true → false is a finished turn; a newly published
     * pending interaction is the Agent asking for an answer or approval.
     */
    function startStatusWatcher(ctx, t, notified) {
      const source = ctx.uiSession.sessionStatus
      let previous = new Map(source.getSnapshot())
      return source.subscribe(() => {
        const next = source.getSnapshot()
        for (const [sessionId, status] of next) {
          const before = previous.get(sessionId)
          if (before === undefined) continue
          const pending = status.pendingInteraction
          if (before.running === true && status.running === false && pending === undefined) {
            deliver(ctx, t, sessionId, 'complete')
          }
          const beforePending = before.pendingInteraction
          if (beforePending !== undefined && (pending === undefined || pending.key !== beforePending.key)) {
            closeLiveNotification(notificationTag(sessionId, pendingKind(beforePending), beforePending.key))
          }
          if (pending !== undefined) {
            if (beforePending === undefined || beforePending.key !== pending.key) {
              if (deliver(ctx, t, sessionId, pendingKind(pending), pending.key)) {
                notified.add(`${sessionId}\u0000${pending.key}`)
              }
            }
          }
        }
        // Forget identities that are no longer pending so the set stays bounded.
        const current = new Set()
        for (const [sessionId, status] of next) {
          if (status.pendingInteraction !== undefined) {
            current.add(`${sessionId}\u0000${status.pendingInteraction.key}`)
          }
        }
        for (const key of notified) if (!current.has(key)) notified.delete(key)
        previous = next
      })
    }

    /** Re-check pending requests whenever the person's attention can move. */
    function watchAttention(ctx, t, notified) {
      const onChange = () => {
        sweepPending(ctx, t, notified)
      }
      window.addEventListener('blur', onChange)
      window.addEventListener('focus', onChange)
      document.addEventListener('visibilitychange', onChange)
      const stopList = ctx.sessions.list.subscribe(onChange)
      return () => {
        window.removeEventListener('blur', onChange)
        window.removeEventListener('focus', onChange)
        document.removeEventListener('visibilitychange', onChange)
        stopList()
      }
    }

    function BellIcon({ filled }) {
      if (filled) {
        return h('svg', {
          viewBox: '0 0 16 16',
          width: 17,
          height: 17,
          'aria-hidden': true,
          focusable: 'false',
          fill: 'currentColor',
        },
          h('path', { d: 'M8 1.9a4.5 4.5 0 0 0-4.5 4.5v2.2L2.1 10.7a.75.75 0 0 0 .64 1.14h10.52a.75.75 0 0 0 .64-1.14L12.5 8.6V6.4A4.5 4.5 0 0 0 8 1.9Z' }),
          h('path', { d: 'M6.4 12.7a1.6 1.6 0 0 0 3.2 0Z' }),
        )
      }
      return h('svg', {
        viewBox: '0 0 16 16',
        width: 17,
        height: 17,
        'aria-hidden': true,
        focusable: 'false',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.3,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      },
        h('path', { d: 'M8 2.2a4.2 4.2 0 0 0-4.2 4.2v2.3L2.6 10.9a.7.7 0 0 0 .6 1.1h9.6a.7.7 0 0 0 .6-1.1l-1.2-2.2V6.4A4.2 4.2 0 0 0 8 2.2Z' }),
        h('path', { d: 'M6.6 12.6a1.4 1.4 0 0 0 2.8 0' }),
      )
    }

    /**
     * The one-icon switch. Lit means notifications are enabled for this
     * session (the default); dim means they are off. A small dot explains why
     * an enabled switch cannot deliver yet.
     */
    function NotifyToggle({ sessionId, t }) {
      const enabled = React.useSyncExternalStore(
        disabledStore.subscribe,
        () => isEnabled(sessionId),
      )
      const permission = React.useSyncExternalStore(
        permissionStore.subscribe,
        permissionStore.getSnapshot,
      )
      const supported = permission !== 'unsupported'
      const label = !supported
        ? t('toggle.unsupported')
        : !enabled
          ? t('toggle.off')
          : permission === 'granted'
            ? t('toggle.on')
            : permission === 'denied'
              ? t('toggle.blocked')
              : t('toggle.ask')

      const onClick = () => {
        if (!supported) return
        const next = !enabled
        setEnabled(sessionId, next)
        // Turning notifications on is a gesture, so this is where the switch
        // itself may ask for permission.
        if (next && currentPermission() === 'default') void requestPermission()
      }

      const dot = enabled && permission !== 'granted'
        ? h('span', {
          className: 'dsh-session-notify-dot',
          'data-state': permission === 'denied' ? 'blocked' : 'pending',
          'aria-hidden': true,
        })
        : null

      return h('button', {
        type: 'button',
        className: 'dsh-session-notify-button',
        'data-enabled': enabled ? 'true' : 'false',
        'data-permission': permission,
        'aria-pressed': enabled,
        'aria-label': label,
        title: label,
        onClick,
      },
        h(BellIcon, { filled: enabled }),
        dot,
      )
    }

    function installStyles() {
      if (typeof document === 'undefined') return () => {}
      const selector = `style[data-plugin-css="${PACKAGE}"]`
      const previous = document.querySelector(selector)
      if (previous) previous.remove()
      const style = document.createElement('style')
      style.dataset.plugin = PACKAGE
      style.dataset.pluginCss = PACKAGE
      style.textContent = STYLE
      document.head.appendChild(style)
      return () => {
        style.remove()
      }
    }

    const inject = ['slots', 'locale', 'sessions', 'uiSession']

    /**
     * Client plugin body: dictionaries, styles, the Session status watcher,
     * permission plumbing, and the composer switch.
     * @param ctx - client root context.
     */
    function apply(ctx) {
      const t = ctx.locale.bind(NS)

      const notifiedPending = new Set()
      ctx.effect(installStyles, 'session-notify: client styles')
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'session-notify: dictionaries')
      ctx.effect(() => startStatusWatcher(ctx, t, notifiedPending), 'session-notify: status watcher')
      ctx.effect(() => watchAttention(ctx, t, notifiedPending), 'session-notify: attention watcher')
      if (typeof ctx.inject === 'function') {
        // The layout service may arrive after this plugin; wait for it so
        // opening a global panel counts as leaving the conversation.
        ctx.inject(['layout'], (scope) => {
          scope.effect(() => {
            const layout = ctx.get('layout')
            if (!layout || !layout.panelInfo || typeof layout.panelInfo.subscribe !== 'function') return () => {}
            return layout.panelInfo.subscribe(() => {
              sweepPending(ctx, t, notifiedPending)
            })
          }, 'session-notify: panel attention')
        })
      }
      ctx.effect(watchPermission, 'session-notify: permission state')
      ctx.effect(armPermissionPrompt, 'session-notify: permission prompt')
      ctx.effect(savePreferencesListener, 'session-notify: preferences sync')
      ctx.effect(() => () => {
        for (const notification of liveNotifications.values()) {
          try {
            notification.close()
          } catch {
            // Ignore a notification the system already dismissed.
          }
        }
        liveNotifications.clear()
      }, 'session-notify: notification cleanup')

      ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
        name: 'conversation.input.right',
        id: 'session-notify',
        order: 20,
        locale: NS,
      }, NotifyToggle))
    }

    return { inject, apply }
  },
})
