'use strict'

const { app, Tray, Menu } = require('electron')

const channels = require('../shared/channels')
const paths = require('./paths')
const { ensureElevated } = require('./elevate')
const { Config } = require('./config')
const { Engine } = require('./engine')
const { MemoryWorker } = require('./memory')
const { MultiInstance } = require('./multi')
const { RobloxSettings } = require('./robloxsettings')
const { Hotkeys } = require('./hotkeys')
const { Updater } = require('./updater')
const { createWindow, reveal: revealWindow } = require('./window')
const ipc = require('./ipc')

if (!ensureElevated(app)) {
  app.exit(0)
} else if (!app.requestSingleInstanceLock()) {
  app.exit(0)
} else {
  main()
}

const SHUTDOWN_RESTORE_MS = 12000

function main () {
  const config = new Config()
  const engine = new Engine()
  const memory = new MemoryWorker()
  const multi = new MultiInstance()
  const fps = new RobloxSettings()
  const hotkeys = new Hotkeys(payload => {
    const target = window
    if (target && !target.isDestroyed()) target.webContents.send(channels.HOTKEY_FIRED, payload)
  })
  let window = null
  let tray = null
  let leaving = false
  let quitting = false
  let lastStatus = {}

  const updater = new Updater({
    config,
    engine,
    isBusy: () => Boolean(lastStatus.connected)
  })

  engine.on('event', event => {
    if (event.ev === 'status') lastStatus = event
  })

  app.on('second-instance', () => reveal())

  function reveal () {
    if (!window || window.isDestroyed()) return
    if (window.isMinimized()) window.restore()
    revealWindow(window)
    window.focus()
  }

  function ensureTray () {
    if (tray && !tray.isDestroyed()) return tray
    try {
      tray = new Tray(paths.icon)
      tray.setToolTip('NebulaStrap — running in the background')
      tray.setContextMenu(Menu.buildFromTemplate([
        { label: 'Open NebulaStrap', click: reveal },
        { type: 'separator' },
        { label: 'Quit and strip every flag', click: quitNow }
      ]))
      tray.on('click', reveal)
      tray.on('double-click', reveal)
    } catch (error) {
      console.error('[tray] could not be created:', error.message)
      tray = null
    }
    return tray
  }

  function background () {
    if (!window || window.isDestroyed()) return
    ensureTray()
    window.hide()
  }

  function quitNow () {
    quitting = true
    app.quit()
  }

  function requestExit () {
    const mode = config.all.exitMode
    if (mode === 'background') return background()
    if (mode === 'quit') return quitNow()
    if (!window || window.isDestroyed()) return quitNow()
    reveal()
    window.webContents.send(channels.WINDOW_EXIT_ASK)
  }

  app.whenReady().then(() => {
    config.load()

    ipc.register({
      getWindow: () => window,
      engine,
      memory,
      config,
      multi,
      fps,
      hotkeys,
      updater,
      exit: { request: requestExit, background, quit: quitNow }
    })

    window = createWindow(config.all)
    window.on('closed', () => { window = null })
    window.on('close', event => {
      if (quitting) return
      event.preventDefault()
      requestExit()
    })

    engine.start()
    updater.start()

    if (config.all.multiInstance) {
      try {
        multi.start()
      } catch (error) {
        console.error('[multi] could not hold the mutex:', error.message)
      }
    }

    if (config.all.fpsLock) {
      try {
        fps.lock(true)
      } catch (error) {
        console.error('[fps] lock failed to start:', error.message)
      }
    }

    if (config.all.flush?.guard !== false) {
      try {
        memory.startGuard({
          threshold: config.all.flush?.threshold,
          deep: config.all.flush?.deep !== false
        })
      } catch (error) {
        console.error('[memory] guard failed to start:', error.message)
      }
    }
  })

  app.on('window-all-closed', () => quitNow())

  app.on('before-quit', event => {
    config.save()
    quitting = true
    if (leaving) return

    event.preventDefault()
    leaving = true

    if (window && !window.isDestroyed()) window.hide()

    let torn = false
    const teardown = () => {
      if (torn) return
      torn = true
      engine.stop()
      memory.stop()
      multi.stop()
      fps.stop()
      hotkeys.stop()
      updater.stop()
      try {
        updater.applyAppOnQuit()
      } catch (error) {
        console.error('[updater] swap handoff failed:', error.message)
      }
      if (tray && !tray.isDestroyed()) tray.destroy()
      app.quit()
    }

    const deadline = setTimeout(teardown, SHUTDOWN_RESTORE_MS)
    Promise.resolve()
      .then(() => engine.call('detach'))
      .then(() => engine.call('quit'))
      .catch(() => {})
      .finally(() => {
        clearTimeout(deadline)
        teardown()
      })
  })
}
