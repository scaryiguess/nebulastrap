'use strict'

module.exports = {
  ENGINE_CALL: 'engine:call',
  ENGINE_EVENT: 'engine:event',
  ENGINE_RESTART: 'engine:restart',
  ENGINE_BACKLOG: 'engine:backlog',

  MEMORY_CALL: 'memory:call',
  MEMORY_EVENT: 'memory:event',

  CONFIG_READ: 'config:read',
  CONFIG_WRITE: 'config:write',

  PRESET_LIST: 'preset:list',
  PRESET_READ: 'preset:read',
  PRESET_WRITE: 'preset:write',
  PRESET_DELETE: 'preset:delete',
  PRESET_RENAME: 'preset:rename',
  PRESET_DUPLICATE: 'preset:duplicate',

  FILE_IMPORT: 'file:import',
  FILE_EXPORT: 'file:export',

  MULTI_SET: 'multi:set',
  MULTI_STATE: 'multi:state',

  MACRO_LIST: 'macro:list',
  MACRO_READ: 'macro:read',
  MACRO_WRITE: 'macro:write',
  MACRO_DELETE: 'macro:delete',
  MACRO_RENAME: 'macro:rename',
  MACRO_ACTIVE: 'macro:active',
  MACRO_DUPLICATE: 'macro:duplicate',

  HOTKEY_APPLY: 'hotkey:apply',
  HOTKEY_FIRED: 'hotkey:fired',

  FPS_READ: 'roblox:fps-read',
  FPS_UNCAP: 'roblox:fps-uncap',
  FPS_LOCK: 'roblox:fps-lock',
  FPS_EVENT: 'roblox:fps-event',

  UPDATE_STATE: 'update:state',
  UPDATE_CHECK: 'update:check',
  UPDATE_APPLY: 'update:apply',
  UPDATE_SET: 'update:set',
  UPDATE_EVENT: 'update:event',

  WINDOW_ACTION: 'window:action',
  WINDOW_STATE: 'window:state',
  WINDOW_EXIT_ASK: 'window:exit-ask',
  STREAMPROOF: 'window:streamproof'
}
