/**
 * CPU topology probe and its output parser.
 *
 * The same POSIX `sh` fragment runs on localhost and on an SSH host. It reports
 * the number of *physical* cores (unique socket/core pairs, `hw.physicalcpu`,
 * or `kern.smp.cores`), the logical CPU count, the process affinity count, and
 * an optional cgroup CPU quota. The allocation limit is the smallest of those,
 * because a container or a scheduler allocation can hand out fewer CPUs than
 * the machine physically has.
 *
 * Discovery is deliberately dependency-light: `getconf`, `nproc`, `awk`,
 * `lscpu`, `sysctl`, and `/proc/cpuinfo` only. Output records are tab-separated
 * between two markers, so login-shell noise cannot be mistaken for a count.
 *
 * @module @local/dsh-cpu-alloc/lib/probe
 */

/** Hard ceiling accepted from one probe, to keep messages and UIs sane. */
export const DEFAULT_MAX_CORES = 4096

const BEGIN_MARKER = '__DSH_CPU_BEGIN__'
const END_MARKER = '__DSH_CPU_END__'

/**
 * Build the probe script. It is POSIX `sh`; the target's login shell executes
 * it, so it avoids bashisms and `set -e`.
 *
 * @returns {string}
 */
export function buildCpuProbeScript() {
  return `set +e
export LC_ALL=C
printf '${BEGIN_MARKER}\\n'
emit() { printf '%s\\t%s\\n' "$1" "$2"; }

os=$(uname -s 2>/dev/null)
if [ -z "$os" ]; then os=unknown; fi

# Logical CPUs that are online. getconf is portable; /proc/cpuinfo covers
# systems without getconf.
logical=
if command -v getconf >/dev/null 2>&1; then
  logical=$(getconf _NPROCESSORS_ONLN 2>/dev/null)
fi
case "$logical" in ''|*[!0-9]*) logical= ;; esac
if [ -z "$logical" ] && [ -r /proc/cpuinfo ]; then
  logical=$(awk '/^processor[[:space:]]*:/ { n++ } END { if (n > 0) print n }' /proc/cpuinfo 2>/dev/null)
fi
case "$logical" in ''|*[!0-9]*) logical= ;; esac

# CPUs this process may actually run on (a cpuset or scheduler allocation is
# smaller than the online count). GNU nproc honours sched_getaffinity.
affinity=
if command -v nproc >/dev/null 2>&1; then
  affinity=$(nproc 2>/dev/null)
fi
case "$affinity" in ''|*[!0-9]*) affinity= ;; esac

# Physical cores: unique (socket, core) pairs from /proc/cpuinfo first, then
# lscpu; both avoid conflating SMT threads with cores.
physical=
source=
if [ -r /proc/cpuinfo ]; then
  physical=$(awk '
    /^physical id[[:space:]]*:/ {
      text = $0
      sub(/^[^:]*:[[:space:]]*/, "", text)
      socket = text
      next
    }
    /^core id[[:space:]]*:/ {
      text = $0
      sub(/^[^:]*:[[:space:]]*/, "", text)
      if (text != "") {
        key = socket "/" text
        if (!(key in seen)) { seen[key] = 1; total++ }
      }
    }
    END { if (total > 0) print total }
  ' /proc/cpuinfo 2>/dev/null)
  case "$physical" in ''|*[!0-9]*) physical= ;; *) source=procfs ;; esac
fi

if [ -z "$physical" ] && command -v lscpu >/dev/null 2>&1; then
  physical=$(lscpu -p=CORE,SOCKET 2>/dev/null | awk -F, '
    !/^#/ && NF >= 2 && $1 ~ /^[0-9]+$/ && $2 ~ /^[0-9]+$/ {
      key = $2 "/" $1
      if (!(key in seen)) { seen[key] = 1; total++ }
    }
    END { if (total > 0) print total }
  ' 2>/dev/null)
  case "$physical" in ''|*[!0-9]*) physical= ;; *) source=lscpu ;; esac
fi

# macOS and the BSDs expose the physical count through sysctl.
if [ -z "$physical" ] && command -v sysctl >/dev/null 2>&1; then
  for _key in hw.physicalcpu kern.smp.cores hw.ncpu; do
    _value=$(sysctl -n "$_key" 2>/dev/null)
    case "$_value" in ''|*[!0-9]*) continue ;; esac
    physical=$_value
    source=sysctl:$_key
    break
  done
fi

# Last resort: every online CPU is one usable core.
if [ -z "$physical" ] && [ -n "$logical" ]; then
  physical=$logical
  source=\${source:-fallback}
fi

# cgroup CPU quota (v2 then v1), walking up from this process's own cgroup so a
# systemd scope or a container limit is found instead of only the root.
quota=
cgroup_path=
if [ -r /proc/self/cgroup ]; then
  cgroup_path=$(awk -F: '$1 == "0" && $2 == "" { print $3; exit }' /proc/self/cgroup 2>/dev/null)
fi
if [ -z "$cgroup_path" ]; then cgroup_path=/; fi
while [ -n "$cgroup_path" ]; do
  _file="/sys/fs/cgroup\${cgroup_path%/}/cpu.max"
  if [ -r "$_file" ]; then
    _quota=
    _period=
    read -r _quota _period < "$_file" 2>/dev/null
    if [ -n "$_quota" ] && [ "$_quota" != "max" ] && [ -n "$_period" ]; then
      case "$_quota$_period" in
        *[!0-9]*) ;;
        *)
          if [ "$_period" -gt 0 ]; then
            quota=$(( _quota / _period ))
            if [ "$quota" -lt 1 ]; then quota=1; fi
          fi
          ;;
      esac
    fi
    break
  fi
  if [ "$cgroup_path" = "/" ]; then break; fi
  cgroup_path=$(dirname "$cgroup_path")
done

if [ -z "$quota" ] && [ -r /sys/fs/cgroup/cpu/cpu.cfs_quota_us ]; then
  _quota=$(cat /sys/fs/cgroup/cpu/cpu.cfs_quota_us 2>/dev/null)
  _period=$(cat /sys/fs/cgroup/cpu/cpu.cfs_period_us 2>/dev/null)
  case "$_quota$_period" in
    ''|*[!0-9]*) ;;
    *)
      if [ "$_quota" -gt 0 ] && [ "$_period" -gt 0 ]; then
        quota=$(( _quota / _period ))
        if [ "$quota" -lt 1 ]; then quota=1; fi
      fi
      ;;
  esac
fi

emit OS "$os"
emit PHYSICAL "$physical"
emit LOGICAL "$logical"
emit AFFINITY "$affinity"
emit QUOTA "$quota"
emit SOURCE "\${source:-unknown}"
printf '${END_MARKER}\\n'
`
}

/** One positive integer, or zero when the value is absent or unusable. */
function toCount(value, maxCores) {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return 0
  return Math.min(maxCores, parsed)
}

/** Drop transport noise OpenSSH prints on stderr before the command runs. */
function usefulStderr(stderr) {
  return String(stderr)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => !/hostfile_replace_entries|update_known_hosts|Warning: Permanently added/i.test(line))
    .slice(-3)
    .join(' ')
}

/**
 * Parse the probe script's output.
 *
 * @param {string} stdout
 * @param {string} [stderr]
 * @param {{ maxCores?: number }} [options]
 * @returns {{
 *   physical: number,
 *   logical: number,
 *   affinity: number,
 *   quota: number,
 *   os: string,
 *   source: string,
 *   warnings: string[],
 * }}
 */
export function parseCpuProbeOutput(stdout, stderr = '', options = {}) {
  const maxCores = Math.max(1, Math.floor(options.maxCores ?? DEFAULT_MAX_CORES))
  const values = {}
  let sawBegin = false
  let sawEnd = false

  for (const rawLine of String(stdout).split(/\r?\n/)) {
    if (rawLine === BEGIN_MARKER) {
      sawBegin = true
      continue
    }
    if (rawLine === END_MARKER) {
      sawEnd = true
      continue
    }
    const tab = rawLine.indexOf('\t')
    if (tab <= 0) continue
    const key = rawLine.slice(0, tab).trim().toUpperCase()
    if (key === 'OS' || key === 'SOURCE') {
      values[key] = rawLine.slice(tab + 1).trim().slice(0, 64)
      continue
    }
    if (key === 'PHYSICAL' || key === 'LOGICAL' || key === 'AFFINITY' || key === 'QUOTA') {
      values[key] = toCount(rawLine.slice(tab + 1), maxCores)
    }
  }

  const physical = values.PHYSICAL ?? 0
  const logical = values.LOGICAL ?? 0
  const affinity = values.AFFINITY ?? 0
  const quota = values.QUOTA ?? 0
  const warnings = []
  if ((!sawBegin || !sawEnd) && physical === 0) {
    const tail = usefulStderr(stderr)
    if (tail.length > 0) warnings.push(tail)
  }
  if (physical > 0 && logical === 0) {
    // A target that reports cores but not the online logical count (older
    // sysctl-only systems) still has a usable number.
    values.LOGICAL = physical
  }

  return {
    physical,
    logical: values.LOGICAL ?? 0,
    affinity,
    quota,
    os: values.OS ?? '',
    source: values.SOURCE ?? '',
    warnings,
  }
}

/**
 * The allocation ceiling for one probe result: the physical core count, capped
 * by the logical CPUs, the process affinity, and a cgroup quota when present.
 *
 * @param {object | undefined} record
 * @returns {number} a positive count, or 0 when nothing was read
 */
export function availableCoresOf(record) {
  if (record === undefined || record === null) return 0
  const physical = Math.max(0, Math.floor(record.physical ?? 0))
  if (physical === 0) return 0
  let limit = physical
  for (const value of [record.logical, record.affinity, record.quota]) {
    const count = Math.max(0, Math.floor(value ?? 0))
    if (count > 0) limit = Math.min(limit, count)
  }
  return Math.max(1, limit)
}

/** `1 physical core` / `8 physical cores`. */
export function formatCoreCount(count) {
  return `${count} physical core${count === 1 ? '' : 's'}`
}

/**
 * A compact, human-readable description of one probe record.
 *
 * @param {object} record
 * @returns {string}
 */
export function describeCpuRecord(record) {
  const parts = [formatCoreCount(record.physical)]
  const logical = record.logical ?? 0
  parts.push(`${logical > 0 ? logical : record.physical} logical CPUs`)
  if (record.affinity > 0 && record.affinity !== logical) {
    parts.push(`affinity ${record.affinity}`)
  }
  if (record.quota > 0) parts.push(`cgroup quota ${record.quota}`)
  if (record.os.length > 0) parts.push(record.os)
  return parts.join(' · ')
}

/**
 * The effective allocation for one selection: `requested` cores clamped to the
 * available count, or every available core when `requested` is 0.
 *
 * @param {number} requested
 * @param {number} available
 * @returns {number}
 */
export function effectiveCores(requested, available) {
  if (requested > 0) return available > 0 ? Math.min(requested, available) : requested
  return available
}
