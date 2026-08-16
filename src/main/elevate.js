'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawn } = require('child_process')

const ELEVATED_FLAG = '--elevated'

function isElevated () {
  const probe = path.join(
    process.env.SystemRoot || 'C:\\Windows',
    'System32',
    `.fflag-elev-${process.pid}`
  )
  try {
    fs.writeFileSync(probe, '')
    fs.unlinkSync(probe)
    return true
  } catch {
    return false
  }
}

function relaunchElevated (target) {
  const scriptPath = path.join(os.tmpdir(), `fflag-elevate-${Date.now()}.vbs`)
  const script = [
    'Set shell = CreateObject("Shell.Application")',
    `shell.ShellExecute "${target}", "${ELEVATED_FLAG}", "", "runas", 1`,
    'Set fso = CreateObject("Scripting.FileSystemObject")',
    'On Error Resume Next',
    `fso.DeleteFile "${scriptPath}"`,
    ''
  ].join('\r\n')

  fs.writeFileSync(scriptPath, script, 'ascii')
  spawn('wscript.exe', [scriptPath], { detached: true, stdio: 'ignore' }).unref()
}

function ensureElevated (app) {
  if (process.platform !== 'win32' || !app.isPackaged) return true

  if (process.argv.includes(ELEVATED_FLAG)) return true
  if (isElevated()) return true

  try {
    relaunchElevated(process.env.PORTABLE_EXECUTABLE_FILE || process.execPath)
    return false
  } catch (error) {
    console.error('[elevate] relaunch failed, continuing unelevated:', error.message)
    return true
  }
}

module.exports = { ensureElevated, isElevated, ELEVATED_FLAG }
