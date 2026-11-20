/**
 * Minimal `~/.ssh/config` reader for the ssh-hosts plugin.
 *
 * The reader discovers concrete `Host` aliases (including files reached through
 * `Include`) and then asks `ssh -G` for each alias's effective user, hostname,
 * port and ProxyJump. OpenSSH therefore remains the authority for `Match`
 * blocks, wildcard blocks and nested includes; the local parser only has to name
 * the hosts a person can pick.
 *
 * @module @local/dsh-ssh-hosts/lib/ssh-config
 */

import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { homedir, userInfo } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'

import { resolveSshConfig } from './ssh-exec.js'

/** Expand a leading `~`, `~/` or `%d` (OpenSSH's home token). */
export function expandHome(value) {
  if (typeof value !== 'string' || value.length === 0) return value
  let text = value.replaceAll('%d', homedir())
  if (text === '~') return homedir()
  if (text.startsWith('~/')) return join(homedir(), text.slice(2))
  if (text === '$HOME') return homedir()
  if (text.startsWith('$HOME/')) return join(homedir(), text.slice(6))
  return text
}

/** One concrete host block from a config file. */
function createHost(alias) {
  return { alias, values: {}, source: undefined }
}

/** A bare pattern names a selectable host; wildcards and negations do not. */
function isConcreteAlias(pattern) {
  return pattern.length > 0
    && !pattern.startsWith('!')
    && !pattern.startsWith('-')
    && !pattern.includes('*')
    && !pattern.includes('?')
    && !pattern.includes('[')
}

/** Strip a line only when the first non-space character is `#`. */
function isComment(line) {
  return line.trimStart().startsWith('#')
}

/** Parse `Key value`, `Key=value`, and quoted values. */
function splitDirective(line) {
  const match = /^([A-Za-z][A-Za-z0-9]*)\s*(?:=\s*|\s+)?(.*)$/.exec(line)
  if (match === null) return undefined
  let value = match[2].trim()
  if (value.length >= 2 && (
    (value.startsWith('"') && value.endsWith('"'))
    || (value.startsWith("'") && value.endsWith("'"))
  )) {
    value = value.slice(1, -1)
  }
  return { key: match[1].toLowerCase(), value }
}

/** Expand the simple `*`/`?` wildcard syntax OpenSSH uses in Include paths. */
function globToRegExp(pattern) {
  let source = '^'
  for (const character of pattern) {
    if (character === '*') source += '[^/]*'
    else if (character === '?') source += '[^/]'
    else source += character.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`${source}$`)
}

async function expandInclude(pattern, baseDirectory) {
  const expanded = expandHome(pattern)
  const absolute = isAbsolute(expanded) ? expanded : resolve(baseDirectory, expanded)
  if (!/[*?]/.test(absolute)) return existsSync(absolute) ? [absolute] : []
  let entries
  try {
    entries = await readdir(dirname(absolute), { withFileTypes: true })
  } catch {
    return []
  }
  const matcher = globToRegExp(basename(absolute))
  return entries
    .filter((entry) => matcher.test(entry.name) && (entry.isFile() || entry.isSymbolicLink()))
    .map((entry) => join(dirname(absolute), entry.name))
    .sort()
}

/**
 * Parse one config file (and every file it Includes) into concrete Host
 * entries. Options inside wildcard or Match blocks are left for `ssh -G`; the
 * parser only keeps options that unambiguously belong to a concrete alias.
 *
 * @param {string} file
 * @param {{ seen?: Set<string>, global?: Record<string, string> }} [state]
 */
async function parseConfigFile(file, state = {}) {
  const seen = state.seen ?? new Set()
  const inherited = state.global ?? {}
  const absolute = resolve(expandHome(file))
  if (seen.has(absolute)) return { hosts: new Map(), global: { ...inherited } }
  seen.add(absolute)

  let text
  try {
    text = await readFile(absolute, 'utf8')
    // Editors on Windows may save a UTF-8 BOM; OpenSSH does not treat it as
    // part of the first keyword.
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1)
  } catch (error) {
    if (error?.code === 'ENOENT') return { hosts: new Map(), global: { ...inherited } }
    throw error
  }

  const hosts = new Map()
  const globalValues = { ...inherited }
  const includes = []
  let current = undefined // { entries: Host[] }
  let inMatch = false

  for (const rawLine of text.split(/\r?\n/)) {
    if (rawLine.length === 0 || isComment(rawLine)) continue
    const directive = splitDirective(rawLine.trim())
    if (directive === undefined) continue
    const { key, value } = directive

    if (key === 'host') {
      const patterns = value.split(/\s+/).filter(Boolean)
      const entries = []
      for (const pattern of patterns) {
        if (!isConcreteAlias(pattern)) continue
        if (!hosts.has(pattern)) hosts.set(pattern, createHost(pattern))
        const host = hosts.get(pattern)
        if (host.source === undefined) host.source = absolute
        entries.push(host)
      }
      current = { entries }
      inMatch = false
      continue
    }
    if (key === 'match') {
      // Match conditions are evaluated by OpenSSH, not here. Options in the
      // block must not leak into the global fallback values.
      current = undefined
      inMatch = true
      continue
    }
    if (key === 'include') {
      includes.push({ pattern: value })
      continue
    }
    if (current === undefined) {
      if (!inMatch && globalValues[key] === undefined) globalValues[key] = value
      continue
    }
    for (const host of current.entries) {
      if (host.values[key] === undefined) host.values[key] = value
    }
  }

  for (const { pattern } of includes) {
    for (const includePattern of pattern.split(/\s+/).filter(Boolean)) {
      // OpenSSH resolves relative Include paths against ~/.ssh, not against
      // the directory of the file that contains the directive.
      for (const includeFile of await expandInclude(includePattern, join(homedir(), '.ssh'))) {
        const nested = await parseConfigFile(includeFile, { seen, global: globalValues })
        for (const [alias, host] of nested.hosts) {
          if (!hosts.has(alias)) {
            hosts.set(alias, host)
            continue
          }
          const existing = hosts.get(alias)
          for (const [key, value] of Object.entries(host.values)) {
            if (existing.values[key] === undefined) existing.values[key] = value
          }
          if (existing.source === undefined) existing.source = host.source
        }
      }
    }
  }

  for (const host of hosts.values()) {
    for (const [key, value] of Object.entries(globalValues)) {
      if (host.values[key] === undefined) host.values[key] = value
    }
  }

  return { hosts, global: globalValues }
}

function defaultUserName() {
  try {
    return userInfo().username
  } catch {
    return process.env.USER ?? 'root'
  }
}

/** Compose the raw block with OpenSSH's effective resolution for the alias. */
function finalizeHost(raw, effective) {
  const user = effective.user ?? raw.values.user ?? defaultUserName()
  const hostname = effective.hostname ?? raw.values.hostname ?? raw.alias
  const parsedPort = Number.parseInt(String(effective.port ?? raw.values.port ?? '22'), 10)
  const port = Number.isFinite(parsedPort) && parsedPort > 0 && parsedPort <= 65535 ? parsedPort : 22
  const proxyJump = effective.proxyjump !== undefined && effective.proxyjump !== 'none'
    ? effective.proxyjump
    : (raw.values.proxyjump !== undefined && raw.values.proxyjump !== 'none' ? raw.values.proxyjump : undefined)
  return {
    alias: raw.alias,
    user,
    hostname,
    port,
    ...proxyJump === undefined ? {} : { proxyJump },
    ...Array.isArray(effective.identityFiles) && effective.identityFiles.length > 0
      ? { identityFiles: effective.identityFiles }
      : {},
    source: raw.source,
  }
}

/**
 * Discover every concrete alias and resolve its effective connection fields.
 *
 * @param {object} [options]
 * @param {string} [options.configPath]
 * @param {string} [options.sshBinary]
 * @param {string[]} [options.excludeHosts]
 * @param {number} [options.resolveTimeoutMs]
 * @returns {Promise<Array<{ alias: string, user: string, hostname: string, port: number, proxyJump?: string, identityFiles?: string[], source?: string }>>}
 */
export async function loadSshHosts(options = {}) {
  const configPath = expandHome(options.configPath ?? '~/.ssh/config')
  const sshBinary = options.sshBinary ?? 'ssh'
  const excluded = new Set(options.excludeHosts ?? [])
  const resolveTimeoutMs = options.resolveTimeoutMs ?? 4000

  const parsed = await parseConfigFile(configPath)
  const aliases = [...parsed.hosts.values()]
    .filter((host) => !excluded.has(host.alias))
    .sort((left, right) => left.alias.localeCompare(right.alias))

  const hosts = await Promise.all(aliases.map(async (raw) => {
    const effective = await resolveSshConfig({
      sshBinary,
      configPath,
      alias: raw.alias,
      timeoutMs: resolveTimeoutMs,
    })
    return finalizeHost(raw, effective)
  }))

  return hosts
}

/** Human-readable `user@host:port`, omitting the default port. */
export function formatHostAddress(host) {
  const literal = host.hostname.includes(':') ? `[${host.hostname}]` : host.hostname
  const address = `${host.user}@${literal}`
  return host.port === 22 ? address : `${address}:${host.port}`
}

/** One line per host, for command results and the model-facing tool. */
export function formatHostTable(hosts) {
  if (hosts.length === 0) return 'No SSH hosts were found.'
  return hosts.map((host) => {
    const proxy = host.proxyJump === undefined ? '' : ` via ${host.proxyJump}`
    return `- ${host.alias} — ${formatHostAddress(host)}${proxy}`
  }).join('\n')
}
