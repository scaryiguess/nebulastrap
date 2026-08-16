'use strict'

const fs = require('fs')
const path = require('path')
const https = require('https')
const crypto = require('crypto')
const { spawn } = require('child_process')
const { EventEmitter } = require('events')
const { app } = require('electron')

const paths = require('./paths')

const DEFAULT_MANIFEST = 'https://github.com/scaryiguess/nebulastrap/releases/latest/download/latest.json'

const FIRST_CHECK_DELAY = 8000
const RECHECK_EVERY = 6 * 60 * 60 * 1000
const MAX_REDIRECTS = 6
const REQUEST_TIMEOUT = 30000
const MAX_MANIFEST_BYTES = 256 * 1024
const MAX_ASSET_BYTES = 400 * 1024 * 1024
const PROGRESS_MIN_INTERVAL = 200

function versionParts (value) {
  return String(value || '0').split(/[.\-+]/).map(part => {
    const digits = parseInt(part, 10)
    return Number.isFinite(digits) ? digits : 0
  })
}

function compareVersions (left, right) {
  const a = versionParts(left)
  const b = versionParts(right)
  const length = Math.max(a.length, b.length)
  for (let index = 0; index < length; index++) {
    const one = a[index] || 0
    const two = b[index] || 0
    if (one !== two) return one > two ? 1 : -1
  }
  return 0
}

function isSafeUrl (value) {
  return typeof value === 'string' && /^https:\/\/[\w.-]+\//i.test(value)
}

function download (url, { limit, onProgress, redirects = MAX_REDIRECTS } = {}) {
  return new Promise((resolve, reject) => {
    if (!isSafeUrl(url)) {
      reject(new Error('the update URL has to be an https address'))
      return
    }

    const request = https.get(url, {
      headers: {
        'User-Agent': `NebulaStrap/${app.getVersion()}`,
        Accept: '*/*'
      }
    }, response => {
      const status = response.statusCode || 0

      if (status >= 300 && status < 400 && response.headers.location) {
        response.resume()
        if (redirects <= 0) {
          reject(new Error('too many redirects'))
          return
        }
        const next = new URL(response.headers.location, url).toString()
        download(next, { limit, onProgress, redirects: redirects - 1 }).then(resolve, reject)
        return
      }

      if (status !== 200) {
        response.resume()
        reject(new Error(status === 404
          ? 'nothing published at that address yet (404)'
          : `the server answered ${status}`))
        return
      }

      const total = Number(response.headers['content-length']) || 0
      if (limit && total > limit) {
        response.destroy()
        reject(new Error('that file is larger than this app will download'))
        return
      }

      const chunks = []
      let received = 0
      let reported = 0

      response.on('data', chunk => {
        received += chunk.length
        if (limit && received > limit) {
          response.destroy()
          reject(new Error('that file is larger than this app will download'))
          return
        }
        chunks.push(chunk)
        const now = Date.now()
        if (onProgress && now - reported >= PROGRESS_MIN_INTERVAL) {
          reported = now
          onProgress(received, total)
        }
      })

      response.on('end', () => {
        if (onProgress) onProgress(received, total || received)
        resolve(Buffer.concat(chunks))
      })
      response.on('error', reject)
    })

    request.setTimeout(REQUEST_TIMEOUT, () => {
      request.destroy(new Error('the update server did not answer in time'))
    })
    request.on('error', reject)
  })
}

function sha256 (buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex')
}

function readEntry (manifest, key) {
  const entry = manifest && manifest[key]
  if (!entry || !isSafeUrl(entry.url) || !entry.version) return null
  return {
    version: String(entry.version),
    url: entry.url,
    sha256: typeof entry.sha256 === 'string' ? entry.sha256.toLowerCase() : '',
    size: Number(entry.size) || 0
  }
}

class Updater extends EventEmitter {
  constructor ({ config, engine, isBusy }) {
    super()
    this.config = config
    this.engine = engine
    this.isBusy = isBusy || (() => false)

    this.appVersion = app.getVersion()
    this.engineVersion = ''
    this.phase = 'idle'
    this.error = ''
    this.latest = null
    this.notes = ''
    this.checkedAt = 0
    this.progress = null
    this.pendingApp = null
    this.pendingEngine = null

    this._timer = null
    this._first = null
    this._busy = false
  }

  get url () {
    const custom = this.config?.all?.updateUrl
    return isSafeUrl(custom) ? custom : DEFAULT_MANIFEST
  }

  get state () {
    return {
      phase: this.phase,
      error: this.error,
      appVersion: this.appVersion,
      engineVersion: this.engineVersion,
      latest: this.latest,
      notes: this.notes,
      checkedAt: this.checkedAt,
      progress: this.progress,
      pendingApp: this.pendingApp && { version: this.pendingApp.version },
      pendingEngine: this.pendingEngine && { version: this.pendingEngine.version },
      auto: this.config?.all?.autoUpdate !== false,
      url: this.url,
      customUrl: this.config?.all?.updateUrl || '',
      busy: Boolean(this.isBusy())
    }
  }

  _push (extra) {
    this.emit('event', { ev: 'update', ...this.state, ...(extra || {}) })
  }

  _log (message, level = 'info') {
    this.emit('log', { msg: message, level })
  }

  setEngineVersion (version) {
    if (!version || version === this.engineVersion) return
    this.engineVersion = String(version)
    this._push()
  }

  start () {
    clearTimeout(this._first)
    clearInterval(this._timer)
    if (!app.isPackaged) return
    this._first = setTimeout(() => this.check({ auto: true }), FIRST_CHECK_DELAY)
    this._timer = setInterval(() => this.check({ auto: true }), RECHECK_EVERY)
  }

  stop () {
    clearTimeout(this._first)
    clearInterval(this._timer)
  }

  setUrl (url) {
    const clean = String(url || '').trim()
    if (clean && !isSafeUrl(clean)) return { ok: false, error: 'that has to be a full https:// address' }
    this.config.patch({ updateUrl: clean })
    this._push()
    return { ok: true, url: this.url }
  }

  setAuto (on) {
    this.config.patch({ autoUpdate: Boolean(on) })
    this._push()
    return { ok: true }
  }

  async check ({ auto = false } = {}) {
    if (this._busy) return { ok: false, error: 'already working' }
    if (auto && this.config?.all?.autoUpdate === false) return { ok: false, error: 'auto update is off' }

    this._busy = true
    this.phase = 'checking'
    this.error = ''
    this.progress = null
    this._push()

    try {
      const raw = await download(this.url, { limit: MAX_MANIFEST_BYTES })
      const manifest = JSON.parse(raw.toString('utf8'))

      const appEntry = readEntry(manifest, 'app')
      const engineEntry = readEntry(manifest, 'engine')
      this.notes = typeof manifest.notes === 'string' ? manifest.notes.slice(0, 2000) : ''
      this.latest = {
        version: String(manifest.version || appEntry?.version || ''),
        app: appEntry,
        engine: engineEntry
      }
      this.checkedAt = Date.now()

      const wantApp = appEntry && compareVersions(appEntry.version, this.appVersion) > 0
      const wantEngine = !wantApp && engineEntry && this.engineVersion &&
        compareVersions(engineEntry.version, this.engineVersion) > 0

      if (!wantApp && !wantEngine) {
        this.phase = 'uptodate'
        this._push()
        if (!auto) this._log(`[+] NebulaStrap ${this.appVersion} is the newest build`, 'success')
        return { ok: true, ...this.state }
      }

      if (this.pendingApp && wantApp && this.pendingApp.version === appEntry.version) {
        this.phase = 'ready'
        this._push()
        return { ok: true, ...this.state }
      }

      this.phase = 'downloading'
      this._push()

      if (wantApp) {
        this._log(`[*] Update ${appEntry.version} found - downloading in the background`, 'info')
        this.pendingApp = await this._fetchAsset(appEntry, 'app', paths.updateDir, `NebulaStrap-${appEntry.version}.exe`)
        this.phase = 'ready'
        this._log(`[+] Update ${appEntry.version} is ready - it installs when you close the app`, 'success')
      } else {
        this._log(`[*] Engine update ${engineEntry.version} found - downloading`, 'info')
        this.pendingEngine = await this._fetchAsset(engineEntry, 'engine', paths.engineDir, `engine-${engineEntry.version}.exe`)
        this.phase = 'ready'
        const applied = this.applyEngine()
        if (!applied.ok) {
          this._log(`[*] Engine ${engineEntry.version} downloaded - it starts once you detach`, 'info')
        }
      }

      this.progress = null
      this._push()
      return { ok: true, ...this.state }
    } catch (error) {
      this.phase = 'error'
      this.error = error.message
      this.progress = null
      this._push()
      if (!auto) this._log(`[-] Update check failed: ${error.message}`, 'error')
      return { ok: false, error: error.message }
    } finally {
      this._busy = false
    }
  }

  async _fetchAsset (entry, what, directory, filename) {
    const buffer = await download(entry.url, {
      limit: MAX_ASSET_BYTES,
      onProgress: (received, total) => {
        this.progress = {
          what,
          received,
          total,
          percent: total ? Math.min(100, Math.round((received / total) * 100)) : 0
        }
        this._push()
      }
    })

    if (entry.size && buffer.length !== entry.size) {
      throw new Error('the download did not come through in one piece')
    }
    if (entry.sha256) {
      const got = sha256(buffer)
      if (got !== entry.sha256) throw new Error('the download does not match its checksum')
    }

    fs.mkdirSync(directory, { recursive: true })
    const target = path.join(directory, filename)
    const staging = `${target}.part`
    fs.writeFileSync(staging, buffer)
    try {
      fs.rmSync(target, { force: true })
    } catch {}
    fs.renameSync(staging, target)

    this._sweep(directory, path.basename(target))
    return { version: entry.version, file: target }
  }

  _sweep (directory, keep) {
    try {
      for (const name of fs.readdirSync(directory)) {
        if (name === keep || name === 'engine.json') continue
        try {
          fs.rmSync(path.join(directory, name), { force: true })
        } catch {}
      }
    } catch {}
  }

  applyEngine () {
    if (!this.pendingEngine) return { ok: false, error: 'nothing downloaded' }
    if (this.isBusy()) return { ok: false, error: 'detach from Roblox first' }

    try {
      fs.mkdirSync(paths.engineDir, { recursive: true })
      fs.writeFileSync(path.join(paths.engineDir, 'engine.json'), JSON.stringify({
        version: this.pendingEngine.version,
        file: this.pendingEngine.file,
        appVersion: this.appVersion
      }, null, 2), 'utf8')
    } catch (error) {
      return { ok: false, error: error.message }
    }

    const version = this.pendingEngine.version
    this.pendingEngine = null
    this.phase = this.pendingApp ? 'ready' : 'uptodate'
    this._log(`[+] Engine ${version} is in - restarting it now, nothing else to do`, 'success')
    this.engine.restart()
    this._push({ engineApplied: version })
    return { ok: true, version }
  }

  applyAppOnQuit () {
    if (!this.pendingApp) return false
    const target = paths.selfExe
    const helper = paths.updateHelper
    if (!app.isPackaged || !fs.existsSync(helper) || !fs.existsSync(this.pendingApp.file)) return false
    if (!/\.exe$/i.test(target)) return false

    try {
      const child = spawn('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-WindowStyle', 'Hidden',
        '-ExecutionPolicy', 'Bypass',
        '-File', helper,
        '-ProcessId', String(process.pid),
        '-Target', target,
        '-Source', this.pendingApp.file
      ], { detached: true, stdio: 'ignore', windowsHide: true })
      child.unref()
      return true
    } catch (error) {
      console.error('[updater] could not hand off the swap:', error.message)
      return false
    }
  }
}

module.exports = { Updater, compareVersions, DEFAULT_MANIFEST }
