'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')
const { ipcMain, dialog, app } = require('electron')

const channels = require('../shared/channels')
const presets = require('./presets')
const macros = require('./macros')
const { applyStreamproof } = require('./window')

function register ({ getWindow, engine, memory, config, multi, fps, hotkeys, exit, updater }) {
  const send = (channel, payload) => {
    const window = getWindow()
    if (window && !window.isDestroyed()) window.webContents.send(channel, payload)
  }

  const backlog = []
  let sequence = 0
  const BACKLOG_LIMIT = 400

  const stamp = event => {
    const stamped = { ...event, seq: ++sequence }
    if (event.ev === 'log') {
      backlog.push(stamped)
      if (backlog.length > BACKLOG_LIMIT) backlog.shift()
    }
    return stamped
  }

  engine.on('event', event => {
    if (event.ev === 'ready' && event.engine) updater?.setEngineVersion(event.engine)
    send(channels.ENGINE_EVENT, stamp(event))
  })

  memory.on('event', event => send(channels.MEMORY_EVENT, event))

  updater?.on('log', ({ msg, level }) => send(channels.ENGINE_EVENT, stamp({ ev: 'log', msg, level })))
  updater?.on('event', event => send(channels.UPDATE_EVENT, event))

  ipcMain.handle(channels.UPDATE_STATE, () => (updater ? { ok: true, ...updater.state } : { ok: false, error: 'not available' }))

  ipcMain.handle(channels.UPDATE_CHECK, () => {
    if (!updater) return { ok: false, error: 'not available' }
    return updater.check({ auto: false })
  })

  ipcMain.handle(channels.UPDATE_APPLY, (_event, what) => {
    if (!updater) return { ok: false, error: 'not available' }
    if (what === 'engine') return updater.applyEngine()
    if (what === 'app') {
      if (!updater.pendingApp) return { ok: false, error: 'nothing downloaded' }
      exit?.quit()
      return { ok: true, restarting: true }
    }
    return { ok: false, error: `unknown update target: ${what}` }
  })

  ipcMain.handle(channels.UPDATE_SET, (_event, changes) => {
    if (!updater) return { ok: false, error: 'not available' }
    if (changes && 'auto' in changes) updater.setAuto(changes.auto)
    if (changes && 'url' in changes) return updater.setUrl(changes.url)
    return { ok: true, ...updater.state }
  })

  ipcMain.handle(channels.ENGINE_BACKLOG, () => ({ events: backlog, seq: sequence }))

  ipcMain.handle(channels.ENGINE_CALL, async (_event, { op, args }) => {
    try {
      return await engine.call(op, args || {})
    } catch (error) {
      return { ok: false, error: error.message }
    }
  })

  ipcMain.handle(channels.ENGINE_RESTART, () => {
    engine.restart()
    return { ok: true }
  })

  ipcMain.handle(channels.MEMORY_CALL, async (_event, { op, args }) => {
    try {
      switch (op) {
        case 'status': return { ok: true, ...(await memory.status()) }
        case 'flush': return { ok: true, ...(await memory.flushOnce(args?.deep)) }
        case 'start': return { ok: true, ...memory.startLoop(args || {}) }
        case 'stop': return { ok: true, ...memory.stopLoop() }
        case 'guard': return { ok: true, guard: memory.startGuard(args || {}) }
        case 'unguard': return { ok: true, guard: memory.stopGuard() }
        case 'settings': return { ok: true, ...memory.settings, guard: memory.guard }
        default: return { ok: false, error: `unknown memory op: ${op}` }
      }
    } catch (error) {
      return { ok: false, error: error.message }
    }
  })

  ipcMain.handle(channels.MULTI_SET, (_event, enabled) => {
    try {
      const running = multi ? multi.set(Boolean(enabled)) : false
      config.patch({ multiInstance: Boolean(enabled) })
      return { ok: true, running }
    } catch (error) {
      return { ok: false, error: error.message }
    }
  })

  ipcMain.handle(channels.MULTI_STATE, () => ({ ok: true, running: Boolean(multi?.running) }))

  ipcMain.handle(channels.MACRO_LIST, () => macros.list())
  ipcMain.handle(channels.MACRO_READ, (_event, id) => {
    try {
      return { ok: true, macro: macros.read(id) }
    } catch (error) {
      return { ok: false, error: error.message }
    }
  })
  ipcMain.handle(channels.MACRO_WRITE, (_event, payload) => {
    try {
      return macros.write(payload || {})
    } catch (error) {
      return { ok: false, error: error.message }
    }
  })
  ipcMain.handle(channels.MACRO_DELETE, (_event, id) => macros.remove(id))
  ipcMain.handle(channels.MACRO_RENAME, (_event, { id, name }) => macros.rename(id, name))
  ipcMain.handle(channels.MACRO_ACTIVE, (_event, { id, active }) => macros.setActive(id, active))
  ipcMain.handle(channels.MACRO_DUPLICATE, (_event, { id, name }) => macros.duplicate(id, name))

  ipcMain.handle(channels.HOTKEY_APPLY, (_event, { bindings, macroKeys }) => {
    if (!hotkeys) return { ok: false, error: 'not available' }
    const result = hotkeys.applyAll(bindings, macroKeys)
    config.patch({ hotkeys: bindings || {} })
    return result
  })

  fps?.on('event', event => send(channels.FPS_EVENT, event))

  ipcMain.handle(channels.FPS_READ, () => {
    if (!fps) return { ok: false, error: 'not available' }
    return fps.read()
  })

  ipcMain.handle(channels.FPS_UNCAP, () => {
    if (!fps) return { ok: false, error: 'not available' }
    const result = fps.uncap()
    if (!result.ok) return result
    return { ...fps.read(), changed: result.changed, previous: result.previous }
  })

  ipcMain.handle(channels.FPS_LOCK, (_event, on) => {
    if (!fps) return { ok: false, error: 'not available' }
    const result = fps.lock(Boolean(on))
    if (result.ok) config.patch({ fpsLock: Boolean(on) })
    return result
  })

  ipcMain.handle(channels.CONFIG_READ, () => config.all)

  ipcMain.handle(channels.CONFIG_WRITE, (_event, changes) => {
    const next = config.patch(changes)
    if (changes && 'streamproof' in changes) {
      applyStreamproof(getWindow(), Boolean(changes.streamproof))
    }
    return next
  })

  ipcMain.handle(channels.PRESET_LIST, () => presets.list())
  ipcMain.handle(channels.PRESET_READ, (_event, id) => {
    try {
      return { ok: true, preset: presets.read(id) }
    } catch (error) {
      return { ok: false, error: error.message }
    }
  })
  ipcMain.handle(channels.PRESET_WRITE, (_event, payload) => {
    try {
      return { ok: true, ...presets.write(payload || {}) }
    } catch (error) {
      return { ok: false, error: error.message }
    }
  })
  ipcMain.handle(channels.PRESET_DELETE, (_event, id) => presets.remove(id))
  ipcMain.handle(channels.PRESET_RENAME, (_event, { id, name }) => presets.rename(id, name))
  ipcMain.handle(channels.PRESET_DUPLICATE, (_event, { id, name }) => presets.duplicate(id, name))

  ipcMain.handle(channels.FILE_IMPORT, async () => {
    const result = await dialog.showOpenDialog(getWindow(), {
      title: 'Import FFlags',
      defaultPath: path.join(os.homedir(), 'Downloads'),
      properties: ['openFile'],
      filters: [
        { name: 'FFlag files', extensions: ['json', 'txt', 'cfg', 'log'] },
        { name: 'All files', extensions: ['*'] }
      ]
    })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle(channels.FILE_EXPORT, async (_event, { flags, suggestedName }) => {
    const result = await dialog.showSaveDialog(getWindow(), {
      title: 'Export FFlags',
      defaultPath: path.join(os.homedir(), 'Downloads', suggestedName || 'fflags.json'),
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (result.canceled || !result.filePath) return { ok: false, canceled: true }
    try {
      fs.writeFileSync(result.filePath, JSON.stringify(flags || {}, null, 2), 'utf8')
      return { ok: true, path: result.filePath, count: Object.keys(flags || {}).length }
    } catch (error) {
      return { ok: false, error: error.message }
    }
  })

  ipcMain.on(channels.WINDOW_ACTION, (_event, action) => {
    const window = getWindow()
    if (!window || window.isDestroyed()) return
    switch (action) {
      case 'minimize':
        window.minimize()
        break
      case 'maximize':
        if (window.isMaximized()) window.unmaximize()
        else window.maximize()
        break
      case 'close':
        exit ? exit.request() : app.quit()
        break
      case 'background':
        exit?.background()
        break
      case 'quit':
        exit ? exit.quit() : app.quit()
        break
    }
  })

  ipcMain.on(channels.STREAMPROOF, (_event, enabled) => {
    applyStreamproof(getWindow(), Boolean(enabled))
    config.patch({ streamproof: Boolean(enabled) })
  })
}

module.exports = { register }
