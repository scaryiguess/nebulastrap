'use strict'

const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')
const { JsonLineChild } = require('./line-child')
const paths = require('./paths')

const MAX_AUTO_RESTARTS = 3

class Engine extends JsonLineChild {
  #restarts = 0

  constructor () {
    super('engine')

    this.on('exit', reason => {
      this.emit('event', { ev: 'log', msg: `[-] Engine ${reason}`, level: 'error' })
      this.emit('event', { ev: 'status', connected: false, pid: null, offsets: 0, injected: 0, reinjections: 0, monitoring: false, version: '', flags: 0 })
      if (this.#restarts < MAX_AUTO_RESTARTS) {
        this.#restarts++
        setTimeout(() => {
          this.emit('event', { ev: 'log', msg: `[*] Restarting engine (attempt ${this.#restarts}/${MAX_AUTO_RESTARTS})`, level: 'warning' })
          this.start()
        }, 800)
      }
    })

    this.on('stderr', text => {
      this.emit('event', { ev: 'log', msg: `[engine] ${text.slice(0, 400)}`, level: 'warning' })
    })

    this.on('message', message => {
      if (message && message.ev) this.emit('event', message)
    })
  }

  _spawn () {
    const target = paths.enginePath
    if (!fs.existsSync(target)) throw new Error(`engine not found at ${target}`)

    const options = {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      cwd: path.dirname(target)
    }
    return target.endsWith('.py')
      ? spawn(process.env.FFLAG_PYTHON || 'python', ['-u', target], options)
      : spawn(target, [], options)
  }

  call (op, args = {}) {
    return super.call({ op, args })
  }

  restart () {
    this.#restarts = 0
    this.stop()
    setTimeout(() => this.start(), 500)
  }
}

module.exports = { Engine }
