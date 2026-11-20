/**
 * Discovery of Python interpreters and conda environments on one execution
 * target.
 *
 * The same POSIX `sh` script runs on localhost and on an SSH host. It prints
 * tab-separated records between two markers so shell startup noise cannot be
 * mistaken for a result. Discovery is intentionally explicit rather than a
 * filesystem-wide scan: the login shell's `python*`, `whereis python`, common
 * conda installation roots, conda's own `env list --json`, pyenv, and a few
 * standard interpreter directories.
 *
 * @module @local/dsh-python-env/lib/discover
 */

import { posix } from 'node:path'

/** Common conda/mamba installation roots, in discovery priority order. */
export const DEFAULT_CONDA_ROOTS = [
  '~/miniconda3',
  '~/anaconda3',
  '~/miniforge3',
  '~/mambaforge',
  '~/micromamba',
  '/opt/conda',
  '/opt/miniconda3',
  '/opt/anaconda3',
  '/opt/mambaforge',
  '/usr/local/miniconda3',
  '/usr/local/anaconda3',
  '/usr/local/conda',
  '/opt/homebrew/Caskroom/miniforge/base',
]

/** Quote one token for a POSIX shell. */
function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'\\''`)}'`
}

/** Expand a leading `~/` into a remote-safe `$HOME/...` expression. */
function homeExpression(value) {
  const text = String(value)
  if (text === '~') return '"$HOME"'
  if (text.startsWith('~/')) return `"$HOME/${text.slice(2)}"`
  if (text === '$HOME') return '"$HOME"'
  if (text.startsWith('$HOME/')) return `"$HOME/${text.slice(6)}"`
  return shellQuote(text)
}

/** One line of shell that inspects an environment directory. */
function scanEnvDirExpression(dirExpression) {
  return [
    `scan_env_dir ${dirExpression}`,
  ].join('\n')
}

/**
 * Build the discovery script. Every path that comes from configuration is
 * quoted before it reaches the shell.
 *
 * @param {object} [options]
 * @param {string[]} [options.condaRoots]
 * @param {string[]} [options.pythonDirs]
 * @returns {string}
 */
export function buildDiscoveryScript(options = {}) {
  const condaRoots = [...DEFAULT_CONDA_ROOTS, ...(options.condaRoots ?? [])]
    .filter((root) => typeof root === 'string' && root.length > 0)
  const pythonDirs = (options.pythonDirs ?? [])
    .filter((dir) => typeof dir === 'string' && dir.length > 0)
  const rootExpressions = condaRoots.map(homeExpression)
  const pythonDirExpressions = pythonDirs.map(homeExpression)

  return `set +e
export LC_ALL=C
printf '__DSH_ENV_BEGIN__\\n'
emit() { printf '%s\\t%s\\n' "$1" "$2"; }
have_timeout=0
if command -v timeout >/dev/null 2>&1; then have_timeout=1; fi
version_of() {
  if [ "$have_timeout" -eq 1 ]; then
    timeout 5 "$1" -c 'import sys;sys.stdout.write("%d.%d.%d"%sys.version_info[:3])' 2>/dev/null
  else
    "$1" -c 'import sys;sys.stdout.write("%d.%d.%d"%sys.version_info[:3])' 2>/dev/null
  fi
}
py_emit() {
  _p=$1
  if [ -z "$_p" ] || [ ! -f "$_p" ] || [ ! -x "$_p" ]; then return 0; fi
  case "\${_p##*/}" in
    python|python[0-9]*) ;;
    *) return 0 ;;
  esac
  _v=$(version_of "$_p" | head -n 1)
  printf 'PY\t%s\t%s\n' "$_p" "$_v"
}
scan_env_dir() {
  _dir=$1
  if [ -z "$_dir" ] || [ ! -d "$_dir" ]; then return 0; fi
  for _env in "$_dir"/*; do
    if [ ! -d "$_env" ]; then continue; fi
    if [ ! -d "$_env/conda-meta" ] && [ ! -x "$_env/bin/python" ]; then continue; fi
    emit CONDA_ENV "$_env"
    py_emit "$_env/bin/python"
  done
}

# Interpreters reachable from the login shell.
for _name in python python3 python3.14 python3.13 python3.12 python3.11 python3.10 python3.9 python3.8 python3.7; do
  _p=$(command -v "$_name" 2>/dev/null) || _p=
  py_emit "$_p"
done

# whereis covers interpreters that are not on PATH (for example /usr/bin/python3.6).
if command -v whereis >/dev/null 2>&1; then
  for _name in python python3; do
    whereis -b "$_name" 2>/dev/null | sed -e 's/^[^:]*: *//' | tr ' ' '\\n' | while IFS= read -r _p; do
      py_emit "$_p"
    done
  done
fi

# pyenv-managed interpreters.
if [ -d "$HOME/.pyenv/versions" ]; then
  for _env in "$HOME"/.pyenv/versions/*; do
    if [ -d "$_env" ]; then py_emit "$_env/bin/python"; fi
  done
fi

# A few standard locations whose entries may not be on PATH.
for _p in /usr/bin/python* /usr/local/bin/python* /opt/homebrew/bin/python*; do
  case "\${_p##*/}" in
    *-config|*-doc) continue ;;
  esac
  py_emit "$_p"
done

# Configured extra interpreter directories.
${pythonDirExpressions.map((dir) => `for _p in ${dir}/python*; do py_emit "$_p"; done`).join('\n')}

# Conda roots: base interpreter, binaries, and named environments.
${rootExpressions.map((root) => `py_emit ${root}/bin/python
if [ -x ${root}/bin/conda ]; then CONDA_BINS="$CONDA_BINS
${root}/bin/conda"; fi
if [ -x ${root}/bin/mamba ]; then CONDA_BINS="$CONDA_BINS
${root}/bin/mamba"; fi
${scanEnvDirExpression(`${root}/envs`)}`).join('\n')}
scan_env_dir "$HOME/.conda/envs"

# Conda binaries reachable from PATH and whereis.
for _name in conda mamba micromamba; do
  _b=$(command -v "$_name" 2>/dev/null) || _b=
  if [ -n "$_b" ]; then CONDA_BINS="$CONDA_BINS
$_b"; fi
done
if command -v whereis >/dev/null 2>&1; then
  for _b in $(whereis -b conda 2>/dev/null | sed -e 's/^[^:]*: *//'); do
    if [ -x "$_b" ]; then CONDA_BINS="$CONDA_BINS
$_b"; fi
  done
fi
printf '%s\\n' "$CONDA_BINS" | sed -e '/^[[:space:]]*$/d' | sort -u | while IFS= read -r _b; do
  emit CONDA_BIN "$_b"
  if [ "$have_timeout" -eq 1 ]; then
    _json=$(timeout 15 "$_b" env list --json 2>/dev/null | tr -d '\\r\\n' | sed -e 's/^[[:space:]]*//')
  else
    _json=$("$_b" env list --json 2>/dev/null | tr -d '\\r\\n' | sed -e 's/^[[:space:]]*//')
  fi
  case "$_json" in
    \\{*) emit CONDA_JSON "$_json" ;;
  esac
done

printf '__DSH_ENV_END__\\n'
`
}

/** Strip the `/bin/conda` (or mamba) suffix from a conda binary path. */
export function condaRootFromBinary(binary) {
  for (const suffix of ['/bin/conda', '/bin/mamba', '/bin/micromamba']) {
    if (binary.endsWith(suffix)) return binary.slice(0, -suffix.length)
  }
  return undefined
}

/** Heuristically derive the installation root from one environment path. */
export function condaRootFromEnvPath(envPath) {
  const marker = '/envs/'
  const index = envPath.lastIndexOf(marker)
  if (index > 0) return envPath.slice(0, index)
  if (envPath.endsWith('/envs')) return envPath.slice(0, -'/envs'.length)
  return undefined
}

/** True when the path is a plausible Python executable. */
function isPythonName(fileName) {
  return /^python([0-9.]*)$/.test(fileName)
}

/**
 * Parse the discovery script's output.
 *
 * @param {string} stdout
 * @param {string} [stderr]
 * @param {object} [options]
 * @param {number} [options.maxEnvironments]
 * @returns {{ environments: Array<object>, warnings: string[] }}
 */
export function parseDiscoveryOutput(stdout, stderr = '', options = {}) {
  const maxEnvironments = Math.max(1, Math.floor(options.maxEnvironments ?? 200))
  const pythonVersions = new Map()
  const condaEnvPaths = new Set()
  const condaBins = new Set()
  const condaJsons = []
  const warnings = []

  for (const rawLine of String(stdout).split(/\r?\n/)) {
    if (rawLine.length === 0) continue
    const tab = rawLine.indexOf('\t')
    if (tab <= 0) continue
    const tag = rawLine.slice(0, tab)
    const rest = rawLine.slice(tab + 1)
    if (tag === 'PY') {
      const nextTab = rest.indexOf('\t')
      const path = (nextTab === -1 ? rest : rest.slice(0, nextTab)).trim()
      const version = (nextTab === -1 ? '' : rest.slice(nextTab + 1)).trim()
      if (path.length > 0) pythonVersions.set(path, version)
      continue
    }
    if (tag === 'CONDA_ENV') {
      const path = rest.trim()
      if (path.length > 0) condaEnvPaths.add(path)
      continue
    }
    if (tag === 'CONDA_BIN') {
      const path = rest.trim()
      if (path.length > 0) condaBins.add(path)
      continue
    }
    if (tag === 'CONDA_JSON') {
      try {
        const parsed = JSON.parse(rest)
        if (parsed !== null && typeof parsed === 'object' && Array.isArray(parsed.envs)) {
          condaJsons.push(parsed)
        }
      } catch {
        warnings.push('conda returned an unreadable environment list')
      }
    }
  }

  const roots = new Set()
  const basePaths = new Set()
  const jsonEnvPaths = new Set()
  for (const binary of condaBins) {
    const root = condaRootFromBinary(binary)
    if (root !== undefined) roots.add(root)
  }
  for (const envPath of condaEnvPaths) {
    const root = condaRootFromEnvPath(envPath)
    if (root !== undefined) roots.add(root)
  }
  for (const json of condaJsons) {
    const details = json.envs_details !== null && typeof json.envs_details === 'object'
      ? json.envs_details
      : {}
    for (const envPath of json.envs) {
      if (typeof envPath !== 'string' || envPath.length === 0) continue
      jsonEnvPaths.add(envPath)
      const info = details[envPath]
      if (info !== null && typeof info === 'object' && info.base === true) basePaths.add(envPath)
      const root = condaRootFromEnvPath(envPath)
      if (root !== undefined) roots.add(root)
    }
  }

  const condaEnvironments = new Map()
  const addCondaEnvironment = (envPath, explicitRoot) => {
    if (typeof envPath !== 'string' || envPath.length === 0) return
    if (condaEnvironments.has(envPath)) return
    const root = explicitRoot ?? condaRootFromEnvPath(envPath) ?? roots.values().next().value ?? ''
    const pythonPath = posix.join(envPath, 'bin/python')
    const name = basePaths.has(envPath) || envPath === root
      ? 'base'
      : (posix.basename(envPath) || 'env')
    condaEnvironments.set(envPath, {
      id: `conda:${envPath}`,
      kind: 'conda',
      label: name,
      detail: envPath,
      path: envPath,
      pythonPath,
      condaRoot: root,
      condaName: name,
      version: pythonVersions.get(pythonPath) ?? '',
    })
  }

  for (const root of roots) addCondaEnvironment(root, root)
  for (const json of condaJsons) {
    for (const envPath of json.envs) addCondaEnvironment(envPath)
  }
  for (const envPath of condaEnvPaths) addCondaEnvironment(envPath)

  const condaPythonPaths = new Set([...condaEnvironments.values()].map((env) => env.pythonPath))
  const pythonEnvironments = []
  for (const [path, version] of pythonVersions) {
    if (condaPythonPaths.has(path)) continue
    if (!isPythonName(posix.basename(path))) continue
    // Interpreters inside a conda environment are represented by that
    // environment, not as a second unrelated row.
    if ([...condaEnvironments.values()].some((env) => path.startsWith(`${env.path}/bin/`))) continue
    pythonEnvironments.push({
      id: `python:${path}`,
      kind: 'python',
      label: posix.basename(path),
      detail: version.length > 0 ? `${version} · ${path}` : path,
      path,
      pythonPath: path,
      condaRoot: '',
      condaName: '',
      version,
    })
  }

  const conda = [...condaEnvironments.values()].sort((left, right) => {
    if (left.label === 'base' && right.label !== 'base') return -1
    if (right.label === 'base' && left.label !== 'base') return 1
    return left.label.localeCompare(right.label) || left.detail.localeCompare(right.detail)
  })
  const pythons = pythonEnvironments.sort((left, right) => left.detail.localeCompare(right.detail))

  const environments = [...conda, ...pythons].slice(0, maxEnvironments)
  const usefulStderr = String(stderr)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => !/hostfile_replace_entries|update_known_hosts|Warning: Permanently added/i.test(line))
  if (environments.length === 0 && usefulStderr.length > 0) {
    warnings.push(usefulStderr.slice(-3).join(' '))
  }

  return { environments, warnings }
}

/** Find an environment by id, label, basename, or path. */
export function findEnvironment(environments, wanted) {
  const input = String(wanted ?? '').trim()
  if (input.length === 0) return undefined
  const exact = environments.find((env) => env.id === input)
  if (exact !== undefined) return exact
  const byPath = environments.find((env) => env.path === input || env.pythonPath === input)
  if (byPath !== undefined) return byPath
  const byLabel = environments.find((env) => env.label === input)
  if (byLabel !== undefined) return byLabel
  const folded = input.toLowerCase()
  return environments.find((env) => env.label.toLowerCase() === folded)
}

/** Prefer a sensible interpreter when the user selected "auto". */
export function defaultPythonFor(environments) {
  const preferred = environments.find((env) => env.kind === 'python'
    && (env.path === '/usr/bin/python3' || env.path === '/usr/local/bin/python3'))
  if (preferred !== undefined) return preferred
  const anyPython = environments.find((env) => env.kind === 'python')
  if (anyPython !== undefined) return anyPython
  // A target whose only interpreter lives in conda base (a common minimal
  // image) still has a sensible default.
  const condaBase = environments.find((env) => env.kind === 'conda' && env.label === 'base')
  if (condaBase !== undefined) return condaBase
  return undefined
}

/** One line per environment, for commands and the model-facing tool. */
export function formatEnvironmentTable(environments) {
  if (environments.length === 0) return 'No Python or conda environments were found on this target.'
  return environments.map((env) => {
    const kind = env.kind === 'conda' ? 'conda' : 'python'
    const version = env.version.length > 0 ? ` [${env.version}]` : ''
    return `- ${env.label} (${kind}) — ${env.path}${version}`
  }).join('\n')
}

/** A concise display label for one environment. */
export function environmentDisplayLabel(env) {
  if (env === undefined) return 'auto'
  return env.kind === 'conda' ? `${env.label} (conda)` : env.label
}
