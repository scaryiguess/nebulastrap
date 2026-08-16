'use strict'

const fs = require('fs')
const path = require('path')
const paths = require('./paths')

const MAX_STEPS = 200000

function slugify (name) {
  const base = String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  return base || `macro-${Date.now()}`
}

function ensureDir () {
  fs.mkdirSync(paths.macroDir, { recursive: true })
}

function fileFor (id) {
  const safe = path.basename(String(id)).replace(/[^A-Za-z0-9._-]/g, '')
  if (!safe || safe === '.' || safe === '..') throw new Error('invalid macro id')
  return path.join(paths.macroDir, safe.endsWith('.json') ? safe : `${safe}.json`)
}

function repeatOf (value, fallback = 1) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.max(0, Math.round(number))
}

function speedOf (value) {
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) return 1
  return Math.min(10, Math.max(0.1, number))
}

function duration (steps) {
  if (!steps.length) return 0
  return Number(steps[steps.length - 1].t) || 0
}

function sanitize (steps) {
  if (!Array.isArray(steps)) return []
  const out = []
  for (const step of steps.slice(0, MAX_STEPS)) {
    if (!step || typeof step !== 'object') continue
    const t = Math.max(0, Math.round(Number(step.t) || 0))
    if (step.kind === 'key') {
      const code = Math.round(Number(step.code) || 0)
      if (code > 0 && code < 256) out.push({ t, kind: 'key', code, down: Boolean(step.down) })
    } else if (step.kind === 'mouse') {
      const button = String(step.button || '')
      if (['left', 'right', 'middle', 'x1', 'x2'].includes(button)) {
        out.push({ t, kind: 'mouse', button, down: Boolean(step.down) })
      }
    } else if (step.kind === 'move') {
      out.push({ t, kind: 'move', x: Math.round(Number(step.x) || 0), y: Math.round(Number(step.y) || 0) })
    } else if (step.kind === 'wheel') {
      out.push({ t, kind: 'wheel', delta: Math.round(Number(step.delta) || 0) })
    } else if (step.kind === 'wait') {
      out.push({ t, kind: 'wait' })
    }
  }
  return out.sort((a, b) => a.t - b.t)
}

function list () {
  try {
    ensureDir()
    return fs.readdirSync(paths.macroDir)
      .filter(name => name.endsWith('.json'))
      .map(fileName => {
        const id = fileName.replace(/\.json$/, '')
        try {
          const body = JSON.parse(fs.readFileSync(path.join(paths.macroDir, fileName), 'utf8'))
          const steps = Array.isArray(body.steps) ? body.steps : []
          return {
            id,
            name: body.name || id,
            note: body.note || '',
            count: steps.length,
            duration: duration(steps),
            repeat: repeatOf(body.repeat),
            speed: speedOf(body.speed),
            hotkey: body.hotkey || '',
            active: body.active !== false,
            updated: body.updated || 0
          }
        } catch {
          return { id, name: id, note: '', count: 0, duration: 0, active: false, updated: 0, broken: true }
        }
      })
      .sort((a, b) => b.updated - a.updated)
  } catch {
    return []
  }
}

function read (id) {
  const body = JSON.parse(fs.readFileSync(fileFor(id), 'utf8'))
  return {
    id,
    name: body.name || id,
    note: body.note || '',
    steps: sanitize(body.steps),
    repeat: repeatOf(body.repeat),
    speed: speedOf(body.speed),
    hotkey: body.hotkey || '',
    active: body.active !== false
  }
}

function write ({ id, name, note, steps, repeat, speed, hotkey, active }) {
  ensureDir()
  const targetId = id || slugify(name)
  const clean = sanitize(steps)
  const payload = {
    name: name || targetId,
    note: note || '',
    steps: clean,
    repeat: repeatOf(repeat),
    speed: speedOf(speed),
    hotkey: String(hotkey || ''),
    active: active !== false,
    updated: Date.now()
  }
  const target = fileFor(targetId)
  const staging = `${target}.tmp`
  fs.writeFileSync(staging, JSON.stringify(payload, null, 2), 'utf8')
  fs.renameSync(staging, target)
  return { ok: true, id: targetId, count: clean.length, duration: duration(clean) }
}

function rename (id, name) {
  const wanted = String(name || '').trim()
  if (!wanted) return { ok: false, error: 'give the macro a name' }
  try {
    const body = JSON.parse(fs.readFileSync(fileFor(id), 'utf8'))
    body.name = wanted
    body.updated = Date.now()
    const target = fileFor(id)
    const staging = `${target}.tmp`
    fs.writeFileSync(staging, JSON.stringify(body, null, 2), 'utf8')
    fs.renameSync(staging, target)
    return { ok: true, id, name: wanted }
  } catch (error) {
    return { ok: false, error: error.message }
  }
}

function setActive (id, active) {
  try {
    const body = JSON.parse(fs.readFileSync(fileFor(id), 'utf8'))
    body.active = Boolean(active)
    body.updated = Date.now()
    const target = fileFor(id)
    const staging = `${target}.tmp`
    fs.writeFileSync(staging, JSON.stringify(body, null, 2), 'utf8')
    fs.renameSync(staging, target)
    return { ok: true, id, active: body.active }
  } catch (error) {
    return { ok: false, error: error.message }
  }
}

function duplicate (id, name) {
  try {
    const source = read(id)
    const wanted = String(name || '').trim() || `${source.name} copy`
    const made = write({ ...source, id: null, name: wanted, hotkey: '' })
    return { ok: true, ...made, name: wanted }
  } catch (error) {
    return { ok: false, error: error.message }
  }
}

function remove (id) {
  try {
    fs.unlinkSync(fileFor(id))
    return { ok: true }
  } catch (error) {
    return { ok: false, error: error.message }
  }
}

module.exports = { list, read, write, rename, setActive, duplicate, remove, sanitize, slugify }
