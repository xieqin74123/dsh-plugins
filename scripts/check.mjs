#!/usr/bin/env node
/**
 * Repository check: every package is a complete DSH bundle, every JavaScript
 * file parses, and the notification harness passes. No dependencies needed.
 *
 * Run from the repository root:
 *   node scripts/check.mjs
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const root = process.cwd()
const packagesDir = join(root, 'packages')
const required = ['package.json', 'index.js', 'client.js', 'cordis.patch.yml', 'README.md', 'LICENSE']
const failures = []

const fail = (message) => {
  failures.push(message)
  console.error(`✗ ${message}`)
}
const ok = (message) => console.log(`✓ ${message}`)

function walk(dir) {
  const files = []
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) files.push(...walk(full))
    else if (/\.(?:js|mjs)$/.test(entry)) files.push(full)
  }
  return files
}

const packages = existsSync(packagesDir)
  ? readdirSync(packagesDir).filter((name) => statSync(join(packagesDir, name)).isDirectory())
  : []
if (packages.length === 0) fail('packages/ has no plugin directories')

for (const name of packages) {
  const dir = join(packagesDir, name)
  for (const file of required) {
    if (!existsSync(join(dir, file))) fail(`${name}: missing ${file}`)
  }
  let manifest
  try {
    manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  } catch (error) {
    fail(`${name}: package.json does not parse: ${error.message}`)
    continue
  }
  if (manifest.name === undefined) fail(`${name}: package.json has no name`)
  if (manifest.dsh?.bundle?.patch === undefined) fail(`${name}: package.json has no dsh.bundle.patch`)
  if (manifest.dsh?.client === undefined) fail(`${name}: package.json has no dsh.client`)
  if (manifest.repository?.directory !== `packages/${name}`) fail(`${name}: repository.directory should be packages/${name}`)
  if (manifest.license !== 'MIT') fail(`${name}: license should be MIT`)
  if (!manifest.files?.includes('LICENSE')) fail(`${name}: files[] should include LICENSE`)
  ok(`${name}: ${manifest.name}@${manifest.version}`)
}

for (const file of walk(packagesDir)) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' })
  } catch (error) {
    fail(`${relative(root, file)}: syntax error\n${String(error.stderr ?? error.message)}`)
  }
}

try {
  const output = execFileSync(process.execPath, [join(packagesDir, 'dsh-session-notify/test/harness.mjs')], {
    encoding: 'utf8',
    stdio: 'pipe',
  })
  if (output.includes('all checks passed')) ok('session-notify harness')
  else fail(`session-notify harness did not report success: ${output.trim()}`)
} catch (error) {
  fail(`session-notify harness failed\n${String(error.stdout ?? '')}${String(error.stderr ?? '')}`)
}

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed`)
  process.exit(1)
}
console.log(`\nall checks passed (${packages.length} packages)`)
