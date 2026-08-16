'use strict'

const fs = require('fs')
const path = require('path')
const paths = require('./paths')

const DEFAULTS = {
  streamproof: false,
  fuzzy: false,
  guard: true,
  limits: true,
  monitorInterval: 20,
  monitor: false,
  autoAttach: false,
  lastView: 'dashboard',
  exitMode: 'ask',
  multiInstance: false,
  fpsLock: false,
  autoUpdate: true,
  updateUrl: '',
  hotkeys: {
    attach: '',
    detach: '',
    inject: '',
    save: '',
    uninject: '',
    flush: '',
    record: 'F9',
    stopAll: 'F10'
  },
  flush: {
    intervalSeconds: 2,
    deep: true,
    guard: true,
    threshold: 88
  },
  appearance: {
    accent: '#00d4ff',
    accentAlt: '#7c5cff',
    base: 'obsidian',
    glow: 0.6,
    radius: 14,
    density: 'comfortable',
    motion: true,
    ambient: false,
    snow: false
  }
}

function isPlainObject (value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function merge (base, override) {
  const out = { ...base }
  for (const [key, value] of Object.entries(override || {})) {
    out[key] = isPlainObject(value) && isPlainObject(base[key]) ? merge(base[key], value) : value
  }
  return out
}

class Config {
  constructor () {
    this.data = { ...DEFAULTS }
    this._writeTimer = null
  }

  load () {
    try {
      const raw = fs.readFileSync(paths.settingsFile, 'utf8')
      this.data = merge(DEFAULTS, JSON.parse(raw))
    } catch {
      this.data = { ...DEFAULTS }
    }
    return this.data
  }

  get all () {
    return this.data
  }

  patch (changes) {
    this.data = merge(this.data, changes || {})
    this.scheduleSave()
    return this.data
  }

  scheduleSave () {
    clearTimeout(this._writeTimer)
    this._writeTimer = setTimeout(() => this.save(), 400)
  }

  save () {
    clearTimeout(this._writeTimer)
    try {
      fs.mkdirSync(path.dirname(paths.settingsFile), { recursive: true })
      fs.writeFileSync(paths.settingsFile, JSON.stringify(this.data, null, 2), 'utf8')
    } catch (error) {
      console.error('[config] save failed:', error.message)
    }
  }
}

module.exports = { Config, DEFAULTS }
