'use strict'

const Store = {
  status: {
    connected: false,
    pid: null,
    offsets: 0,
    injected: 0,
    reinjections: 0,
    monitoring: false,
    version: '',
    flags: 0,
    fuzzy: false
  },
  config: null,
  injecting: false,
  view: 'dashboard',

  applyStatus (patch) {
    this.status = { ...this.status, ...patch }
    window.UI.Bus.emit('status', this.status)
    return this.status
  },

  setInjecting (value) {
    if (this.injecting === value) return
    this.injecting = value
    window.UI.Bus.emit('injecting', value)
  },

  setConfig (config) {
    this.config = config
    window.UI.Bus.emit('config', config)
    return config
  }
}

window.Store = Store
