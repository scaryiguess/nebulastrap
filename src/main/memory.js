'use strict'

const fs = require('fs')
const { spawn } = require('child_process')
const { JsonLineChild } = require('./line-child')
const paths = require('./paths')

const MIN_INTERVAL_SECONDS = 0.05
const FLUSH_TIMEOUT_MS = 30000

const GUARD_POLL_MS = 4000
const GUARD_COOLDOWN_MS = 12000
const GUARD_MIN_THRESHOLD = 50
const GUARD_MAX_THRESHOLD = 99

class MemoryWorker extends JsonLineChild {
  #timer = null
  #inFlight = false
  #settings = { intervalSeconds: 2, deep: true }

  #guardTimer = null
  #guardAt = 0
  #guard = { on: false, threshold: 88, deep: true }

  constructor () {
    super('memory worker')
    this.on('exit', () => {
      this.stopLoop()
      this.emit('event', { ev: 'worker', running: false })
    })
    this.on('stderr', text => {
      this.emit('event', { ev: 'error', message: text.slice(0, 300) })
    })
  }

  _spawn () {
    const script = paths.memoryWorker
    if (!fs.existsSync(script)) throw new Error(`memory worker not found at ${script}`)

    return spawn('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy', 'Bypass',
      '-WindowStyle', 'Hidden',
      '-File', script
    ], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
  }

  get looping () {
    return this.#timer !== null
  }

  get settings () {
    return { ...this.#settings, looping: this.looping }
  }

  ensure () {
    if (!this.running) this.start()
  }

  async status () {
    this.ensure()
    return this.call({ op: 'status' }, { timeout: 8000 })
  }

  async flushOnce (deep = this.#settings.deep) {
    this.ensure()
    const result = await this.call({ op: 'flush', deep }, { timeout: FLUSH_TIMEOUT_MS })
    this.emit('event', { ev: 'flush', ...result })
    return result
  }

  startLoop ({ intervalSeconds, deep } = {}) {
    this.stopLoop()
    if (intervalSeconds !== undefined) {
      this.#settings.intervalSeconds = Math.max(MIN_INTERVAL_SECONDS, Number(intervalSeconds) || 2)
    }
    if (deep !== undefined) this.#settings.deep = Boolean(deep)
    this.ensure()

    const period = Math.round(this.#settings.intervalSeconds * 1000)
    this.#timer = setInterval(() => this.#tick(), period)
    this.emit('event', { ev: 'loop', running: true, ...this.settings })
    this.#tick()
    return this.settings
  }

  async #tick () {
    if (this.#inFlight) return
    this.#inFlight = true
    try {
      await this.flushOnce()
    } catch (error) {
      this.emit('event', { ev: 'error', message: error.message })
      this.stopLoop()
    } finally {
      this.#inFlight = false
    }
  }

  stopLoop () {
    if (!this.#timer) return this.settings
    clearInterval(this.#timer)
    this.#timer = null
    this.emit('event', { ev: 'loop', running: false, ...this.settings })
    return this.settings
  }

  get guard () {
    return { ...this.#guard, watching: this.#guardTimer !== null }
  }

  startGuard ({ threshold, deep } = {}) {
    if (this.#guardTimer) clearInterval(this.#guardTimer)
    if (threshold !== undefined) {
      const wanted = Number(threshold) || this.#guard.threshold
      this.#guard.threshold = Math.max(GUARD_MIN_THRESHOLD, Math.min(GUARD_MAX_THRESHOLD, Math.round(wanted)))
    }
    if (deep !== undefined) this.#guard.deep = Boolean(deep)
    this.#guard.on = true

    this.#guardTimer = setInterval(() => this.#watch(), GUARD_POLL_MS)
    this.emit('event', { ev: 'guard', ...this.guard })
    return this.guard
  }

  stopGuard () {
    this.#guard.on = false
    if (!this.#guardTimer) return this.guard
    clearInterval(this.#guardTimer)
    this.#guardTimer = null
    this.emit('event', { ev: 'guard', ...this.guard })
    return this.guard
  }

  async #watch () {
    if (this.#inFlight) return
    if (Date.now() - this.#guardAt < GUARD_COOLDOWN_MS) return

    let percent = 0
    try {
      const reading = await this.status()
      percent = Number(reading?.memory?.percent || 0)
    } catch {
      return
    }
    if (percent < this.#guard.threshold) return

    this.#guardAt = Date.now()
    this.#inFlight = true
    try {
      const result = await this.call({ op: 'flush', deep: this.#guard.deep }, { timeout: FLUSH_TIMEOUT_MS })
      this.emit('event', { ev: 'flush', ...result, auto: true, trigger: percent })
    } catch (error) {
      this.emit('event', { ev: 'error', message: error.message })
    } finally {
      this.#inFlight = false
    }
  }

  stop () {
    this.stopLoop()
    this.stopGuard()
    super.stop()
  }
}

module.exports = { MemoryWorker }
