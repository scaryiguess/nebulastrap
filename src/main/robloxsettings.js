'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')
const { EventEmitter } = require('events')

const UNCAPPED = 999999
const CONSIDERED_UNCAPPED = 240
const CAP_RE = /(<int name="FramerateCap">)(-?\d+)(<\/int>)/
const FILE_RE = /^GlobalBasicSettings_(\d+)\.xml$/i
const SETTLE_MS = 400
const RESCAN_MS = 5000

class RobloxSettings extends EventEmitter {
  constructor () {
    super()
    this._watcher = null
    this._rescan = null
    this._settle = null
    this.locked = false
  }

  get dir () {
    const local = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local')
    return path.join(local, 'Roblox')
  }

  get file () {
    let best = null
    let names = []
    try {
      names = fs.readdirSync(this.dir)
    } catch {
      return null
    }
    for (const name of names) {
      const found = FILE_RE.exec(name)
      if (!found) continue
      const version = Number(found[1])
      if (!best || version > best.version) {
        best = { version, file: path.join(this.dir, name) }
      }
    }
    return best ? best.file : null
  }

  read () {
    const file = this.file
    if (!file) {
      return {
        ok: false,
        error: 'Roblox has not saved its settings yet — open Roblox once and close it, then try again'
      }
    }
    let text = ''
    try {
      text = fs.readFileSync(file, 'utf8')
    } catch (error) {
      return { ok: false, error: error.message, file }
    }
    const found = CAP_RE.exec(text)
    const cap = found ? Number(found[2]) : null
    return {
      ok: true,
      file,
      cap,
      uncapped: cap !== null && cap >= CONSIDERED_UNCAPPED,
      locked: this.locked
    }
  }

  write (value = UNCAPPED) {
    const file = this.file
    if (!file) return { ok: false, error: 'no settings file' }

    let text = ''
    try {
      text = fs.readFileSync(file, 'utf8')
    } catch (error) {
      return { ok: false, error: error.message }
    }
    if (!text.includes('</roblox>')) {
      return { ok: false, error: 'settings file is mid-write — try again in a moment' }
    }

    const found = CAP_RE.exec(text)
    const previous = found ? Number(found[2]) : null
    if (previous === value) return { ok: true, cap: value, previous, changed: false, file }

    const next = found
      ? text.replace(CAP_RE, `$1${value}$3`)
      : text.replace('</Properties>', `\t\t\t<int name="FramerateCap">${value}</int>\n\t\t</Properties>`)
    if (next === text) return { ok: false, error: 'could not place FramerateCap in the file' }

    try {
      const backup = `${file}.nebula.bak`
      if (!fs.existsSync(backup)) fs.copyFileSync(file, backup)
      fs.writeFileSync(file, next, 'utf8')
    } catch (error) {
      return { ok: false, error: error.message }
    }
    return { ok: true, cap: value, previous, changed: true, file }
  }

  uncap () {
    return this.write(UNCAPPED)
  }

  lock (on) {
    if (!on) {
      this.locked = false
      this._stopWatching()
      return { ok: true, locked: false, ...this.read() }
    }

    const applied = this.write(UNCAPPED)
    if (!applied.ok && !this.file) return { ok: false, error: applied.error, locked: false }

    this.locked = true
    this._startWatching()
    return { ok: true, locked: true, applied, ...this.read() }
  }

  _startWatching () {
    if (this._watcher) return
    try {
      this._watcher = fs.watch(this.dir, (_event, name) => {
        if (name && !FILE_RE.test(name)) return
        this._schedule()
      })
      this._watcher.on('error', () => this._stopWatching())
    } catch {
      this._watcher = null
    }
    if (!this._rescan) this._rescan = setInterval(() => this._enforce(), RESCAN_MS)
  }

  _stopWatching () {
    if (this._watcher) {
      try {
        this._watcher.close()
      } catch {}
      this._watcher = null
    }
    clearInterval(this._rescan)
    clearTimeout(this._settle)
    this._rescan = null
    this._settle = null
  }

  _schedule () {
    clearTimeout(this._settle)
    this._settle = setTimeout(() => this._enforce(), SETTLE_MS)
  }

  _enforce () {
    if (!this.locked) return
    const current = this.read()
    if (!current.ok || current.cap === null || current.cap >= UNCAPPED) return

    const result = this.write(UNCAPPED)
    if (result.ok && result.changed) {
      this.emit('event', {
        kind: 'relocked',
        cap: UNCAPPED,
        previous: result.previous,
        file: result.file
      })
    }
  }

  stop () {
    this.locked = false
    this._stopWatching()
  }
}

module.exports = { RobloxSettings, UNCAPPED }
