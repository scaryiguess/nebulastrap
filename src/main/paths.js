'use strict'

const fs = require('fs')
const path = require('path')
const { app } = require('electron')

const projectRoot = path.join(__dirname, '..', '..')

function engineOverride () {
  try {
    const marker = path.join(app.getPath('userData'), 'engine', 'engine.json')
    const saved = JSON.parse(fs.readFileSync(marker, 'utf8'))
    if (!saved || !saved.file || saved.appVersion !== app.getVersion()) return null
    return fs.existsSync(saved.file) ? saved : null
  } catch {
    return null
  }
}

module.exports = {
  projectRoot,
  engineOverride,

  get bundledEngine () {
    return app.isPackaged
      ? path.join(process.resourcesPath, 'engine.exe')
      : path.join(projectRoot, 'python', 'run.py')
  },

  get enginePath () {
    if (!app.isPackaged) return path.join(projectRoot, 'python', 'run.py')
    const saved = engineOverride()
    return saved ? saved.file : path.join(process.resourcesPath, 'engine.exe')
  },

  get updateHelper () {
    return app.isPackaged
      ? path.join(process.resourcesPath, 'apply-update.ps1')
      : path.join(projectRoot, 'scripts', 'apply-update.ps1')
  },

  get selfExe () {
    return process.env.PORTABLE_EXECUTABLE_FILE || process.execPath
  },

  get engineDir () {
    return path.join(app.getPath('userData'), 'engine')
  },

  get updateDir () {
    return path.join(app.getPath('userData'), 'updates')
  },

  get memoryWorker () {
    return app.isPackaged
      ? path.join(process.resourcesPath, 'memory-worker.ps1')
      : path.join(projectRoot, 'scripts', 'memory-worker.ps1')
  },

  get multiScript () {
    return app.isPackaged
      ? path.join(process.resourcesPath, 'multi-instance.ps1')
      : path.join(projectRoot, 'scripts', 'multi-instance.ps1')
  },

  get rendererIndex () {
    return path.join(projectRoot, 'src', 'renderer', 'index.html')
  },

  get preload () {
    return path.join(projectRoot, 'src', 'preload', 'index.js')
  },

  get icon () {
    return path.join(projectRoot, 'build', 'icon.png')
  },

  get userData () {
    return app.getPath('userData')
  },

  get settingsFile () {
    return path.join(app.getPath('userData'), 'settings.json')
  },

  get presetDir () {
    return path.join(app.getPath('userData'), 'presets')
  },

  get macroDir () {
    return path.join(app.getPath('userData'), 'macros')
  }
}
