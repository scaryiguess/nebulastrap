'use strict'

const { globalShortcut } = require('electron')

const ACTIONS = [
  'attach', 'detach', 'inject', 'save', 'uninject',
  'flush', 'record', 'stopAll'
]

function normalize (accelerator) {
  return String(accelerator || '').trim()
}

class Hotkeys {
  constructor (run) {
    this.run = run
    this.bindings = {}
    this.macroKeys = {}
    this.failed = []
  }

  applyAll (bindings, macroKeys) {
    globalShortcut.unregisterAll()
    this.failed = []
    this.bindings = { ...(bindings || {}) }
    this.macroKeys = { ...(macroKeys || {}) }

    const taken = new Set()

    for (const action of ACTIONS) {
      const key = normalize(this.bindings[action])
      if (!key || taken.has(key)) continue
      if (this.register(key, () => this.run({ kind: 'action', action }))) taken.add(key)
    }

    for (const [id, key] of Object.entries(this.macroKeys)) {
      const accelerator = normalize(key)
      if (!accelerator || taken.has(accelerator)) continue
      if (this.register(accelerator, () => this.run({ kind: 'macro', id }))) taken.add(accelerator)
    }

    return { ok: true, failed: this.failed }
  }

  register (accelerator, handler) {
    try {
      const ok = globalShortcut.register(accelerator, handler)
      if (!ok) this.failed.push(accelerator)
      return ok
    } catch {
      this.failed.push(accelerator)
      return false
    }
  }

  stop () {
    try {
      globalShortcut.unregisterAll()
    } catch {}
  }
}

module.exports = { Hotkeys, ACTIONS }
