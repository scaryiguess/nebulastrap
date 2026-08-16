'use strict'

const { EventEmitter } = require('events')

const MAX_BUFFERED_LINE = 64 * 1024 * 1024

class JsonLineChild extends EventEmitter {
  #child = null
  #buffer = ''
  #pending = new Map()
  #nextId = 1

  constructor (name) {
    super()
    this.name = name
  }

  get running () {
    return this.#child !== null && this.#child.exitCode === null
  }

  _spawn () {
    throw new Error('_spawn() not implemented')
  }

  start () {
    if (this.running) return
    const child = this._spawn()
    this.#child = child
    this.#buffer = ''

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', chunk => this.#consume(chunk))
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', chunk => {
      const text = chunk.trim()
      if (text) this.emit('stderr', text)
    })

    child.on('error', error => this.#die(`spawn failed: ${error.message}`))
    child.on('exit', code => this.#die(`exited with code ${code}`))
    this.emit('start')
  }

  #consume (chunk) {
    this.#buffer += chunk
    if (this.#buffer.length > MAX_BUFFERED_LINE) this.#buffer = ''

    let newline
    while ((newline = this.#buffer.indexOf('\n')) !== -1) {
      const line = this.#buffer.slice(0, newline).trim()
      this.#buffer = this.#buffer.slice(newline + 1)
      if (!line) continue
      let message
      try {
        message = JSON.parse(line)
      } catch {
        this.emit('noise', line)
        continue
      }
      this.#route(message)
    }
  }

  #route (message) {
    if (message && message.id !== undefined && this.#pending.has(message.id)) {
      const { resolve } = this.#pending.get(message.id)
      this.#pending.delete(message.id)
      resolve(message)
      return
    }
    this.emit('message', message)
  }

  #die (reason) {
    const child = this.#child
    this.#child = null
    for (const { reject } of this.#pending.values()) {
      reject(new Error(`${this.name} ${reason}`))
    }
    this.#pending.clear()
    if (child) this.emit('exit', reason)
  }

  call (payload, { timeout = 0 } = {}) {
    if (!this.running) return Promise.reject(new Error(`${this.name} is not running`))

    const id = this.#nextId++
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject })
      try {
        this.#child.stdin.write(JSON.stringify({ id, ...payload }) + '\n')
      } catch (error) {
        this.#pending.delete(id)
        reject(error)
        return
      }
      if (timeout > 0) {
        setTimeout(() => {
          if (!this.#pending.has(id)) return
          this.#pending.delete(id)
          reject(new Error(`${this.name} timed out after ${timeout}ms`))
        }, timeout).unref?.()
      }
    })
  }

  stop () {
    const child = this.#child
    if (!child) return
    try {
      child.stdin.end()
    } catch {  }
    setTimeout(() => {
      try {
        if (child.exitCode === null) child.kill()
      } catch {  }
    }, 400).unref?.()
  }
}

module.exports = { JsonLineChild }
