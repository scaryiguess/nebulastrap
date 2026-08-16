'use strict'

const { BrowserWindow } = require('electron')
const paths = require('./paths')

function createWindow (config) {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1040,
    minHeight: 680,
    frame: false,
    show: false,
    backgroundColor: '#07080c',
    title: 'NebulaStrap',
    icon: paths.icon,
    webPreferences: {
      preload: paths.preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false
    }
  })

  applyStreamproof(window, Boolean(config.streamproof))

  window.loadFile(paths.rendererIndex)
  window.once('ready-to-show', () => reveal(window))

  for (const event of ['maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen']) {
    window.on(event, () => {
      if (!window.isDestroyed()) {
        window.webContents.send('window:state', { maximized: window.isMaximized() })
      }
    })
  }

  return window
}

function reveal (window, attempt = 0) {
  if (!window || window.isDestroyed() || window.isVisible()) return
  if (attempt === 0) window.show()
  else window.showInactive()
  if (window.isVisible() || attempt > 3) return
  setTimeout(() => reveal(window, attempt + 1), 220)
}

function applyStreamproof (window, enabled) {
  if (!window || window.isDestroyed()) return
  try {
    window.setContentProtection(enabled)
    window.setSkipTaskbar(enabled)
  } catch (error) {
    console.error('[window] streamproof failed:', error.message)
  }
}

module.exports = { createWindow, applyStreamproof, reveal }
