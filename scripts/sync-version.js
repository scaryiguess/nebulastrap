'use strict'

const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const target = path.join(root, 'python', 'fflag', 'version.py')

const next = `ENGINE_VERSION = "${version}"\n`
const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : ''

if (current !== next) {
  fs.writeFileSync(target, next, 'utf8')
  console.log(`engine version -> ${version}`)
} else {
  console.log(`engine version already ${version}`)
}
