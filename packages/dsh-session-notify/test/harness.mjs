/**
 * Offline harness for the browser half.
 *
 * The real bundle only registers a factory through `window.__ModuleLoader__`,
 * so this script evaluates it in a vm with a tiny DOM, React, and Notification
 * stub, then drives the unified Session status source the way ui-session does.
 * It checks the notification decision rules (focus, active session, panel,
 * switch, permission) and the exact bodies.
 *
 * Run with: node test/harness.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const source = readFileSync(join(root, 'client.js'), 'utf8')

function makeTarget() {
  const listeners = new Map()
  return {
    addEventListener(type, listener) {
      let set = listeners.get(type)
      if (!set) listeners.set(type, (set = new Set()))
      set.add(listener)
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener)
    },
    dispatchEvent(event) {
      for (const listener of [...(listeners.get(event.type) ?? [])]) listener(event)
    },
    listenerCount(type) {
      return listeners.get(type)?.size ?? 0
    },
  }
}

const windowTarget = makeTarget()
const documentTarget = makeTarget()
const document = Object.assign(documentTarget, {
  visibilityState: 'visible',
  focused: true,
  hasFocus() {
    return this.focused
  },
  querySelector() {
    return null
  },
  createElement() {
    return { dataset: {}, textContent: '', remove() {} }
  },
  head: { appendChild() {} },
})

const storage = new Map()
const localStorage = {
  getItem(key) {
    return storage.has(key) ? storage.get(key) : null
  },
  setItem(key, value) {
    storage.set(key, String(value))
  },
  removeItem(key) {
    storage.delete(key)
  },
  clear() {
    storage.clear()
  },
}

class FakeNotification {
  static permission = 'granted'
  static instances = []
  static requestPermission = async () => FakeNotification.permission

  constructor(title, options) {
    this.title = title
    this.options = options
    this.onclick = null
    this.closed = false
    FakeNotification.instances.push(this)
  }

  close() {
    this.closed = true
  }
}

const windowObject = Object.assign(windowTarget, {
  localStorage,
  focus() {},
  __ModuleLoader__: {
    definition: undefined,
    load(definition) {
      this.definition = definition
    },
  },
})

const sandbox = {
  window: windowObject,
  document,
  localStorage,
  Notification: FakeNotification,
  navigator: {},
  console,
  setTimeout,
  clearTimeout,
  queueMicrotask,
  URL,
}

vm.runInNewContext(source, sandbox, { filename: 'client.js' })

const definition = windowObject.__ModuleLoader__.definition
assert.ok(definition, 'the bundle registers a module factory')
assert.equal(definition.id, '@local/dsh-session-notify')

const React = {
  createElement(type, props, ...children) {
    return { type, props, children }
  },
  useSyncExternalStore(_subscribe, getSnapshot) {
    return getSnapshot()
  },
  Fragment: Symbol('Fragment'),
}

const plugin = definition.factory((specifier) => {
  if (specifier === 'react') return React
  throw new Error(`unexpected require(${JSON.stringify(specifier)})`)
})
assert.ok(plugin && typeof plugin.apply === 'function', 'factory returns the plugin')

// --- fake client services -------------------------------------------------

let list = { ids: [], byId: {}, phase: 'ready', projectionsBySession: {} }
let status = new Map()
const statusListeners = new Set()
let panelId = null
const panelListeners = new Set()

function setPanel(next) {
  panelId = next
  for (const listener of [...panelListeners]) listener()
}

const dictionaries = {}
const cleanups = []
let registered = null

const ctx = {
  effect(callback) {
    const dispose = callback()
    if (typeof dispose === 'function') cleanups.push(dispose)
  },
  locale: {
    bind() {
      return (key, params) => {
        let template = dictionaries[key] ?? key
        if (params) {
          template = template.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match))
        }
        return template
      }
    },
    register(_namespace, dicts) {
      Object.assign(dictionaries, dicts.zh)
      return () => {}
    },
  },
  slots: {
    inject(_name, callback) {
      callback()
      return () => {}
    },
    register(entry, component) {
      registered = { entry, component }
      return () => {}
    },
  },
  sessions: {
    list: {
      getSnapshot: () => list,
      subscribe() {
        return () => {}
      },
    },
  },
  uiSession: {
    sessionStatus: {
      getSnapshot: () => status,
      subscribe(listener) {
        statusListeners.add(listener)
        return () => statusListeners.delete(listener)
      },
    },
  },
  inject(_deps, callback) {
    callback({
      effect(effect) {
        const dispose = effect()
        if (typeof dispose === 'function') cleanups.push(dispose)
      },
    })
  },
  get(name) {
    if (name === 'layout') {
      return {
        panelInfo: {
          getSnapshot: () => ({ activePanelId: panelId }),
          subscribe(listener) {
            panelListeners.add(listener)
            return () => panelListeners.delete(listener)
          },
        },
      }
    }
    if (name === 'uiWorkspace') {
      return { openSession() {} }
    }
    return undefined
  },
}

function row(id, title, mainView) {
  return {
    id,
    displayTitle: title,
    running: false,
    retainedBy: mainView ? { mainView: 1 } : {},
    blank: false,
    updatedAt: 0,
  }
}

function setList(ids, activeId) {
  list = {
    ids,
    byId: Object.fromEntries(ids.map((id) => [id, row(id, id === 'a' ? 'Alpha 会话' : `Session ${id}`, id === activeId)])),
    phase: 'ready',
    projectionsBySession: {},
  }
}

function setStatus(next) {
  status = new Map(next)
  for (const listener of [...statusListeners]) listener()
}

function resetNotifications() {
  FakeNotification.instances.length = 0
}

function shown() {
  return FakeNotification.instances.map((instance) => ({
    title: instance.title,
    body: instance.options.body,
    tag: instance.options.tag,
    requireInteraction: instance.options.requireInteraction,
  }))
}

function entry(id, running, pending) {
  return [id, { running, pendingInteraction: pending, completionUnread: false }]
}

function away() {
  document.visibilityState = 'hidden'
  document.focused = false
}

function attending() {
  document.visibilityState = 'visible'
  document.focused = true
}

// --- apply ----------------------------------------------------------------

plugin.apply(ctx)
assert.equal(registered.entry.name, 'conversation.input.right')
assert.equal(registered.entry.id, 'session-notify')
assert.equal(registered.entry.order, 20)

// --- 1. finished turn while the page is hidden ----------------------------

setList(['a', 'b'], 'a')
setStatus([entry('a', true), entry('b', true)])
away()
resetNotifications()
setStatus([entry('a', false), entry('b', false)])
assert.deepEqual(shown().map((item) => item.body), [
  '[Alpha 会话]：回复已就绪',
  '[Session b]：回复已就绪',
])
assert.ok(shown().every((item) => item.title === 'Deepseek Harness'))
assert.ok(shown().every((item) => item.requireInteraction === false))

// --- 2. same session while the user is looking at it is silent -------------

attending()
panelId = null
setStatus([entry('a', true), entry('b', true)])
resetNotifications()
setStatus([entry('a', false), entry('b', true)])
assert.equal(shown().length, 0, 'no alert for the focused active session')

// --- 3. another session finishing while this one is focused ----------------

resetNotifications()
setStatus([entry('a', false), entry('b', false)])
assert.deepEqual(shown().map((item) => item.body), ['[Session b]：回复已就绪'])

// --- 4. a global panel means the conversation is not being watched ---------

panelId = 'settings'
setStatus([entry('a', true), entry('b', true)])
resetNotifications()
setStatus([entry('a', false), entry('b', true)])
assert.deepEqual(shown().map((item) => item.body), ['[Alpha 会话]：回复已就绪'])
panelId = null

// --- 5. question and approval requests -------------------------------------

away()
setStatus([entry('a', true), entry('b', true)])
resetNotifications()
setStatus([entry('a', true, { key: 'q1', kind: 'question', sessionId: 'a' }), entry('b', true)])
assert.deepEqual(shown().map((item) => item.body), ['[Alpha 会话]：请求回答'])
assert.equal(shown()[0].requireInteraction, true)

setStatus([
  entry('a', true, { key: 'q1', kind: 'question', sessionId: 'a' }),
  entry('b', true, { key: 'ap1', kind: 'approval', sessionId: 'b' }),
])
assert.deepEqual(shown().map((item) => item.body), [
  '[Alpha 会话]：请求回答',
  '[Session b]：请求批复',
])

resetNotifications()
setStatus([
  entry('a', true, { key: 'q2', kind: 'plan-review', sessionId: 'a' }),
  entry('b', true, { key: 'ap1', kind: 'approval', sessionId: 'b' }),
])
assert.deepEqual(shown().map((item) => item.body), ['[Alpha 会话]：请求确认计划'], 'a new request key alerts once')
setStatus([
  entry('a', true, { key: 'q2', kind: 'plan-review', sessionId: 'a' }),
  entry('b', true, { key: 'ap1', kind: 'approval', sessionId: 'b' }),
])
assert.equal(shown().length, 1, 'the same pending request does not alert twice')

// --- 5b. a request seen while focused is announced when the user leaves ----

attending()
panelId = null
setStatus([entry('a', true), entry('b', true)])
resetNotifications()
setStatus([entry('a', true, { key: 'q3', kind: 'question', sessionId: 'a' }), entry('b', true)])
assert.equal(shown().length, 0, 'a question arriving while the session is watched is silent')
away()
windowObject.dispatchEvent({ type: 'blur' })
assert.deepEqual(shown().map((item) => item.body), ['[Alpha 会话]：请求回答'])
const q3Notification = FakeNotification.instances[0]
attending()
windowObject.dispatchEvent({ type: 'focus' })
away()
windowObject.dispatchEvent({ type: 'blur' })
assert.equal(shown().length, 1, 'leaving again does not repeat the same request')

// --- 5c. opening a global panel without blurring also announces -----------

attending()
panelId = null
setStatus([entry('a', true), entry('b', true)])
resetNotifications()
setStatus([entry('a', true, { key: 'q4', kind: 'question', sessionId: 'a' }), entry('b', true)])
assert.equal(shown().length, 0, 'still watching the conversation')
setPanel('settings')
assert.deepEqual(shown().map((item) => item.body), ['[Alpha 会话]：请求回答'])
setPanel(null)

// --- 6. an enabled switch still needs browser permission -------------------

setStatus([entry('a', false), entry('b', false)])
assert.equal(q3Notification.closed, true, 'resolving a request withdraws its notification')
FakeNotification.permission = 'denied'
setStatus([entry('a', true), entry('b', false)])
resetNotifications()
setStatus([entry('a', false), entry('b', false)])
assert.equal(shown().length, 0, 'denied permission suppresses alerts')
FakeNotification.permission = 'granted'

// --- 6b. background subagents and uncatalogued sessions stay silent --------

list = {
  ids: ['a', 'b'],
  byId: {
    a: { ...row('a', 'Alpha 会话', false), origin: 'subagent' },
    b: row('b', 'Session b', true),
  },
  phase: 'ready',
  projectionsBySession: {},
}
away()
setStatus([entry('a', true), entry('b', true), entry('ghost', true)])
resetNotifications()
setStatus([entry('a', false), entry('b', true), entry('ghost', false)])
assert.equal(shown().length, 0, 'background subagents and unknown sessions do not alert')

// --- 7. switching a session off suppresses its alerts ----------------------

localStorage.setItem('dsh.session-notify.disabled.v1', JSON.stringify({ a: true }))
windowObject.dispatchEvent({ type: 'storage', key: 'dsh.session-notify.disabled.v1' })
away()
setStatus([entry('a', true), entry('b', true)])
resetNotifications()
setStatus([entry('a', false), entry('b', false)])
assert.deepEqual(shown().map((item) => item.body), ['[Session b]：回复已就绪'], 'session a is switched off')

// --- 8. the component's switch state ---------------------------------------

// The component is a real function; it only needs the standard slot props.
const component = registered.component
const enabledTree = component({ sessionId: 'b', t: (key) => dictionaries[key] ?? key })
assert.equal(enabledTree.props['data-enabled'], 'true')
assert.equal(enabledTree.props['aria-pressed'], true)
const disabledTree = component({ sessionId: 'a', t: (key) => dictionaries[key] ?? key })
assert.equal(disabledTree.props['data-enabled'], 'false')
assert.equal(disabledTree.props['aria-pressed'], false)
// Toggling session a back on is what the click handler would do; verify the
// store update reaches the next render.
assert.equal(disabledTree.props.title, '开启本会话的系统通知')
localStorage.removeItem('dsh.session-notify.disabled.v1')
windowObject.dispatchEvent({ type: 'storage', key: 'dsh.session-notify.disabled.v1' })
assert.equal(component({ sessionId: 'a', t: (key) => dictionaries[key] ?? key }).props['data-enabled'], 'true')

// --- 9. the switch toggles, and turning on authorizes ---------------------

FakeNotification.permission = 'default'
windowObject.dispatchEvent({ type: 'focus' })
let permissionRequests = 0
FakeNotification.requestPermission = () => {
  permissionRequests += 1
  return new Promise(() => {})
}
const askTree = component({ sessionId: 'b', t: (key) => dictionaries[key] ?? key })
assert.equal(askTree.props['data-enabled'], 'true')
// A click on the switch must not be consumed by the global first-gesture prompt.
documentTarget.dispatchEvent({ type: 'pointerdown', target: { closest: () => ({}) } })
assert.equal(permissionRequests, 0)
// Re-render before every click so the handler sees the current switch state.
const clickSwitch = () => component({ sessionId: 'b', t: (key) => dictionaries[key] ?? key }).props.onClick()
// Lit -> dim turns it off without asking.
askTree.props.onClick()
assert.equal(component({ sessionId: 'b', t: (key) => dictionaries[key] ?? key }).props['data-enabled'], 'false')
assert.equal(permissionRequests, 0)
// Dim -> lit turns it on and asks.
clickSwitch()
assert.equal(permissionRequests, 1)
assert.equal(component({ sessionId: 'b', t: (key) => dictionaries[key] ?? key }).props['data-enabled'], 'true')
// Off and on again while the first request is in flight reuses it.
clickSwitch()
clickSwitch()
assert.equal(permissionRequests, 1, 'the in-flight permission request is shared')
assert.equal(component({ sessionId: 'b', t: (key) => dictionaries[key] ?? key }).props['data-enabled'], 'true')
FakeNotification.permission = 'granted'

for (const dispose of cleanups.reverse()) dispose()

console.log('session-notify harness: all checks passed')
