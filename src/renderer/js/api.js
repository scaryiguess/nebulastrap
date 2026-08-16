'use strict'

const Engine = {
  attach: () => host.engine.call('attach'),
  detach: () => host.engine.call('detach'),
  loadFile: path => host.engine.call('load', { path }),
  inject: () => host.engine.call('inject'),
  sync: () => host.engine.call('sync'),
  cancel: () => host.engine.call('cancel'),
  monitor: (on, interval) => host.engine.call('monitor', { on, interval }),
  restore: mode => host.engine.call('restore', { mode }),
  status: () => host.engine.call('status'),
  settings: patch => host.engine.call('settings', patch),

  page: (query, offset, limit) => host.engine.call('sample', { query, offset, limit }),
  allFlags: () => host.engine.call('flags_all'),
  setFlag: (name, value, previous) => host.engine.call('flag_set', { name, value, previous }),
  removeFlags: names => host.engine.call('flag_remove', { names }),
  replaceFlags: (flags, merge = false, keep = false) => host.engine.call('flags_replace', { flags, merge, keep }),
  addText: (text, merge = true, keep = false) => host.engine.call('flags_text', { text, merge, keep }),
  parseFile: path => host.engine.call('parse', { path }),
  parseText: text => host.engine.call('parse_text', { text }),
  suggest: (query, limit) => host.engine.call('suggest', { query, limit }),
  probe: () => host.engine.call('probe'),
  macroRecord: (on, moves) => host.engine.call('macro_record', { on, moves }),
  macroPlay: (steps, repeat, speed) => host.engine.call('macro_play', { steps, repeat, speed }),
  macroStop: () => host.engine.call('macro_stop'),
  macroState: () => host.engine.call('macro_state'),
  macroCursor: () => host.engine.call('macro_cursor'),
  clearFlags: () => host.engine.call('clear'),

  restart: () => host.engine.restart(),
  backlog: () => host.engine.backlog(),
  onEvent: handler => host.engine.onEvent(handler)
}

const Memory = {
  status: () => host.memory.call('status'),
  flush: deep => host.memory.call('flush', { deep }),
  startLoop: (intervalSeconds, deep) => host.memory.call('start', { intervalSeconds, deep }),
  stopLoop: () => host.memory.call('stop'),
  startGuard: (threshold, deep) => host.memory.call('guard', { threshold, deep }),
  stopGuard: () => host.memory.call('unguard'),
  settings: () => host.memory.call('settings'),
  onEvent: handler => host.memory.onEvent(handler)
}

const Settings = {
  read: () => host.config.read(),
  write: changes => host.config.write(changes)
}

const Updates = {
  state: () => host.updates.state(),
  check: () => host.updates.check(),
  apply: what => host.updates.apply(what),
  set: changes => host.updates.set(changes),
  onEvent: handler => host.updates.onEvent(handler)
}

const Presets = host.presets
const Files = host.files
const Win = host.window
const Multi = host.multi
const Fps = host.fps
const Macros = host.macros
const Keys = host.hotkeys

window.API = { Engine, Memory, Settings, Updates, Presets, Files, Win, Multi, Fps, Macros, Keys }
