/**
 * Shell command construction for the selected environment.
 *
 * The selector must work on localhost and on an SSH host. Both targets receive
 * a plain POSIX command string, so activation is expressed with `export` and a
 * direct interpreter path instead of depending on the user's interactive shell
 * having already initialized conda.
 *
 * @module @local/dsh-python-env/lib/command
 */

import { posix } from 'node:path'

/** Quote one token for a POSIX shell. */
export function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'\\''`)}'`
}

/** The directory holding the interpreter, for PATH precedence. */
function pythonDirectory(env, pythonPath) {
  return env !== undefined && env.kind === 'conda'
    ? posix.join(env.path, 'bin')
    : posix.dirname(pythonPath)
}

/**
 * Environment exports that make the selected interpreter the default one for
 * this command. Conda's marker variables are set explicitly so libraries that
 * inspect CONDA_PREFIX (CUDA builds, compilers, Jupyter kernels) agree with the
 * interpreter that is actually running.
 *
 * @param {object | undefined} env
 * @param {string} pythonPath
 * @returns {string}
 */
export function environmentExports(env, pythonPath) {
  const lines = []
  const directory = pythonDirectory(env, pythonPath)
  const pathEntries = directory === '.' || directory.length === 0 ? [] : [directory]
  if (env !== undefined && env.kind === 'conda' && env.condaRoot.length > 0) {
    const condaBin = posix.join(env.condaRoot, 'bin')
    if (condaBin !== directory) pathEntries.push(condaBin)
  }
  // Environment bin first, conda installation bin second: subprocesses that
  // invoke `python` or `pip` must resolve the selected environment, not base.
  if (pathEntries.length > 0) {
    lines.push(`export PATH=${pathEntries.map(shellQuote).join(':')}:"$PATH"`)
  }
  if (env !== undefined && env.kind === 'conda') {
    lines.push(`export CONDA_PREFIX=${shellQuote(env.path)}`)
    lines.push(`export CONDA_DEFAULT_ENV=${shellQuote(env.condaName)}`)
    if (env.condaRoot.length > 0) {
      lines.push(`export CONDA_EXE=${shellQuote(posix.join(env.condaRoot, 'bin', 'conda'))}`)
    }
  }
  return lines.join('; ')
}

/**
 * A prompt-friendly activation hint. It prefers conda's own shell hook when the
 * installation provides one, and otherwise falls back to PATH exports.
 *
 * @param {object | undefined} env
 * @param {string} pythonPath
 * @returns {string}
 */
export function activationHint(env, pythonPath) {
  if (env === undefined || env.kind !== 'conda') {
    return `export PATH=${shellQuote(posix.dirname(pythonPath))}:"$PATH"`
  }
  if (env.condaRoot.length === 0) return environmentExports(env, pythonPath)
  const profile = posix.join(env.condaRoot, 'etc', 'profile.d', 'conda.sh')
  return `. ${shellQuote(profile)} && conda activate ${shellQuote(env.path)}`
}

/**
 * Build one Python invocation that runs `code` with the chosen interpreter.
 *
 * @param {object | undefined} env
 * @param {string} pythonPath
 * @param {string} code
 * @returns {string}
 */
export function buildPythonCommand(env, pythonPath, code) {
  return [
    environmentExports(env, pythonPath),
    `exec ${shellQuote(pythonPath)} -c ${shellQuote(code)}`,
  ].filter((part) => part.length > 0).join('; ')
}
