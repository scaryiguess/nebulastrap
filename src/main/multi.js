'use strict'

const { EventEmitter } = require('events')
const { spawn } = require('child_process')

const paths = require('./paths')

class MultiInstance extends EventEmitter {
  #child = null

  get running () {
    return this.#child !== null && this.#child.exitCode === null
  }

  start () {
    if (this.running) return true

    const child = spawn('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy', 'Bypass',
      '-WindowStyle', 'Hidden',
      '-File', paths.multiScript
    ], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })

    this.#child = child
    child.stdout?.setEncoding('utf8')
    child.on('error', error => {
      this.#child = null
      this.emit('error', error)
    })
    child.on('exit', () => {
      this.#child = null
      this.emit('state', false)
    })

    this.emit('state', true)
    return true
  }

  stop () {
    const child = this.#child
    this.#child = null
    if (!child) return false
    try {
      child.kill()
    } catch {  }
    this.emit('state', false)
    return true
  }

  set (enabled) {
    if (enabled) this.start()
    else this.stop()
    return this.running
  }
}

module.exports = { MultiInstance }
