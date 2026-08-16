'use strict'

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const root = path.join(__dirname, '..')
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))

const REPO = process.env.NEBULA_REPO || 'scaryiguess/nebulastrap'
const version = pkg.version
const tag = `v${version}`

const distDir = path.join(root, 'dist')
const outDir = path.join(distDir, 'release')

const assets = [
  { key: 'app', file: 'NebulaStrap.exe', from: path.join(distDir, 'NebulaStrap.exe') },
  { key: 'engine', file: 'engine.exe', from: path.join(distDir, 'engine.exe') }
]

function hash (file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function human (bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const missing = assets.filter(asset => !fs.existsSync(asset.from))
if (missing.length) {
  console.error(`missing build output: ${missing.map(asset => asset.file).join(', ')}`)
  console.error('run "npm run engine" then "npm run build" first')
  process.exit(1)
}

const enginePy = fs.readFileSync(path.join(root, 'python', 'fflag', 'version.py'), 'utf8')
const engineDeclared = (enginePy.match(/"([^"]+)"/) || [])[1]
if (engineDeclared !== version) {
  console.error(`python/fflag/version.py says ${engineDeclared} but package.json says ${version}`)
  console.error('run "npm run engine" again so the engine is stamped with this version')
  process.exit(1)
}

fs.rmSync(outDir, { recursive: true, force: true })
fs.mkdirSync(outDir, { recursive: true })

const manifest = {
  version,
  tag,
  notes: '',
  published: new Date().toISOString()
}

const notesFile = path.join(root, 'RELEASE_NOTES.txt')
if (fs.existsSync(notesFile)) manifest.notes = fs.readFileSync(notesFile, 'utf8').trim().slice(0, 2000)

for (const asset of assets) {
  const size = fs.statSync(asset.from).size
  const sum = hash(asset.from)
  fs.copyFileSync(asset.from, path.join(outDir, asset.file))
  manifest[asset.key] = {
    version,
    url: `https://github.com/${REPO}/releases/download/${tag}/${asset.file}`,
    sha256: sum,
    size
  }
  console.log(`${asset.file.padEnd(18)} ${human(size).padStart(9)}  ${sum.slice(0, 16)}...`)
}

fs.writeFileSync(path.join(outDir, 'latest.json'), JSON.stringify(manifest, null, 2), 'utf8')

console.log('')
console.log(`release ${tag} staged in dist\\release`)
console.log('')
console.log('  1. open   https://github.com/' + REPO + '/releases/new')
console.log(`  2. tag    ${tag}   (choose "Create new tag on publish")`)
console.log('  3. drag   NebulaStrap.exe, engine.exe, latest.json  from dist\\release')
console.log('  4. click  Publish release')
console.log('')
console.log('every installed copy points at')
console.log(`  https://github.com/${REPO}/releases/latest/download/latest.json`)
