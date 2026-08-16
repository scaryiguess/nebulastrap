'use strict'

const fs = require('fs')
const path = require('path')
const paths = require('./paths')
const builtins = require('./builtins')

const BUILTIN = new Map(builtins.map(preset => [preset.id, preset]))

function isBuiltin (id) {
  return BUILTIN.has(String(id))
}

function slugify (name) {
  const base = String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  return base || `preset-${Date.now()}`
}

function ensureDir () {
  fs.mkdirSync(paths.presetDir, { recursive: true })
}

function fileFor (id) {
  const safe = path.basename(String(id)).replace(/[^A-Za-z0-9._-]/g, '')
  if (!safe || safe === '.' || safe === '..') throw new Error('invalid preset id')
  return path.join(paths.presetDir, safe.endsWith('.json') ? safe : `${safe}.json`)
}

function builtinRows () {
  return builtins.map(preset => ({
    id: preset.id,
    name: preset.name,
    note: preset.note || '',
    count: Object.keys(preset.flags).length,
    updated: 0,
    locked: true,
    danger: Boolean(preset.danger)
  }))
}

function list () {
  try {
    ensureDir()
    const mine = fs.readdirSync(paths.presetDir)
      .filter(name => name.endsWith('.json'))
      .map(fileName => {
        const id = fileName.replace(/\.json$/, '')
        try {
          const body = JSON.parse(fs.readFileSync(path.join(paths.presetDir, fileName), 'utf8'))
          return {
            id,
            name: body.name || id,
            note: body.note || '',
            count: Object.keys(body.flags || {}).length,
            updated: body.updated || 0
          }
        } catch {
          return { id, name: id, note: '', count: 0, updated: 0, broken: true }
        }
      })
      .filter(row => !isBuiltin(row.id))
      .sort((a, b) => b.updated - a.updated)
    return [...builtinRows(), ...mine]
  } catch {
    return builtinRows()
  }
}

function read (id) {
  const embedded = BUILTIN.get(String(id))
  if (embedded) {
    return {
      id: embedded.id,
      name: embedded.name,
      note: embedded.note || '',
      flags: { ...embedded.flags },
      locked: true,
      danger: Boolean(embedded.danger)
    }
  }
  const body = JSON.parse(fs.readFileSync(fileFor(id), 'utf8'))
  return {
    id,
    name: body.name || id,
    note: body.note || '',
    flags: body.flags && typeof body.flags === 'object' ? body.flags : {}
  }
}

function freeId (wanted) {
  let candidate = wanted
  let n = 2
  while (isBuiltin(candidate)) candidate = `${wanted}-${n++}`
  return candidate
}

function write ({ id, name, note, flags }) {
  if (isBuiltin(id)) throw new Error(`${BUILTIN.get(String(id)).name} is built in and cannot be overwritten`)
  ensureDir()
  const targetId = freeId(id || slugify(name))
  const payload = {
    name: name || targetId,
    note: note || '',
    flags: flags && typeof flags === 'object' ? flags : {},
    updated: Date.now()
  }
  const target = fileFor(targetId)
  const staging = `${target}.tmp`
  fs.writeFileSync(staging, JSON.stringify(payload, null, 2), 'utf8')
  fs.renameSync(staging, target)
  return { id: targetId, count: Object.keys(payload.flags).length }
}

function rename (id, name) {
  const wanted = String(name || '').trim()
  if (isBuiltin(id)) return { ok: false, error: `${BUILTIN.get(String(id)).name} is built in and cannot be renamed` }
  if (!wanted) return { ok: false, error: 'give the preset a name' }
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

function duplicate (id, name) {
  try {
    const source = read(id)
    const wanted = String(name || '').trim() || `${source.name} copy`
    const made = write({ name: wanted, note: source.note, flags: source.flags })
    return { ok: true, ...made, name: wanted }
  } catch (error) {
    return { ok: false, error: error.message }
  }
}

function remove (id) {
  if (isBuiltin(id)) return { ok: false, error: `${BUILTIN.get(String(id)).name} is built in and cannot be deleted` }
  try {
    fs.unlinkSync(fileFor(id))
    return { ok: true }
  } catch (error) {
    return { ok: false, error: error.message }
  }
}

module.exports = { list, read, write, rename, duplicate, remove, slugify, isBuiltin }
