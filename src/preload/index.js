'use strict'

const { contextBridge, ipcRenderer } = require('electron')
const channels = require('../shared/channels')

function subscribe (channel, handler) {
  const listener = (_event, payload) => handler(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

contextBridge.exposeInMainWorld('host', {
  engine: {
    call: (op, args) => ipcRenderer.invoke(channels.ENGINE_CALL, { op, args }),
    restart: () => ipcRenderer.invoke(channels.ENGINE_RESTART),
    backlog: () => ipcRenderer.invoke(channels.ENGINE_BACKLOG),
    onEvent: handler => subscribe(channels.ENGINE_EVENT, handler)
  },

  memory: {
    call: (op, args) => ipcRenderer.invoke(channels.MEMORY_CALL, { op, args }),
    onEvent: handler => subscribe(channels.MEMORY_EVENT, handler)
  },

  multi: {
    set: enabled => ipcRenderer.invoke(channels.MULTI_SET, enabled),
    state: () => ipcRenderer.invoke(channels.MULTI_STATE)
  },

  macros: {
    list: () => ipcRenderer.invoke(channels.MACRO_LIST),
    read: id => ipcRenderer.invoke(channels.MACRO_READ, id),
    write: payload => ipcRenderer.invoke(channels.MACRO_WRITE, payload),
    remove: id => ipcRenderer.invoke(channels.MACRO_DELETE, id),
    rename: (id, name) => ipcRenderer.invoke(channels.MACRO_RENAME, { id, name }),
    setActive: (id, active) => ipcRenderer.invoke(channels.MACRO_ACTIVE, { id, active }),
    duplicate: (id, name) => ipcRenderer.invoke(channels.MACRO_DUPLICATE, { id, name })
  },

  hotkeys: {
    apply: (bindings, macroKeys) => ipcRenderer.invoke(channels.HOTKEY_APPLY, { bindings, macroKeys }),
    onFired: handler => subscribe(channels.HOTKEY_FIRED, handler)
  },

  fps: {
    read: () => ipcRenderer.invoke(channels.FPS_READ),
    uncap: () => ipcRenderer.invoke(channels.FPS_UNCAP),
    lock: on => ipcRenderer.invoke(channels.FPS_LOCK, on),
    onEvent: handler => subscribe(channels.FPS_EVENT, handler)
  },

  updates: {
    state: () => ipcRenderer.invoke(channels.UPDATE_STATE),
    check: () => ipcRenderer.invoke(channels.UPDATE_CHECK),
    apply: what => ipcRenderer.invoke(channels.UPDATE_APPLY, what),
    set: changes => ipcRenderer.invoke(channels.UPDATE_SET, changes),
    onEvent: handler => subscribe(channels.UPDATE_EVENT, handler)
  },

  config: {
    read: () => ipcRenderer.invoke(channels.CONFIG_READ),
    write: changes => ipcRenderer.invoke(channels.CONFIG_WRITE, changes)
  },

  presets: {
    list: () => ipcRenderer.invoke(channels.PRESET_LIST),
    read: id => ipcRenderer.invoke(channels.PRESET_READ, id),
    write: payload => ipcRenderer.invoke(channels.PRESET_WRITE, payload),
    remove: id => ipcRenderer.invoke(channels.PRESET_DELETE, id),
    rename: (id, name) => ipcRenderer.invoke(channels.PRESET_RENAME, { id, name }),
    duplicate: (id, name) => ipcRenderer.invoke(channels.PRESET_DUPLICATE, { id, name })
  },

  files: {
    importDialog: () => ipcRenderer.invoke(channels.FILE_IMPORT),
    exportDialog: (flags, suggestedName) =>
      ipcRenderer.invoke(channels.FILE_EXPORT, { flags, suggestedName })
  },

  window: {
    minimize: () => ipcRenderer.send(channels.WINDOW_ACTION, 'minimize'),
    maximize: () => ipcRenderer.send(channels.WINDOW_ACTION, 'maximize'),
    close: () => ipcRenderer.send(channels.WINDOW_ACTION, 'close'),
    quit: () => ipcRenderer.send(channels.WINDOW_ACTION, 'quit'),
    background: () => ipcRenderer.send(channels.WINDOW_ACTION, 'background'),
    setStreamproof: enabled => ipcRenderer.send(channels.STREAMPROOF, enabled),
    onState: handler => subscribe(channels.WINDOW_STATE, handler),
    onExitAsk: handler => subscribe(channels.WINDOW_EXIT_ASK, handler)
  }
})
