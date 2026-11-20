# GPU device access

A session switch for DeepSeek Harness that lets CUDA work reach the NVIDIA
device nodes **inside** the bash sandbox, so GPU commands stop asking for a
per-command sandbox-escalation approval.

## The problem it removes

On Linux the shipped bash sandbox confines every command with Landlock (or
bubblewrap) and grants writes only to:

- the session workspace,
- `/tmp` and the user temp dir,
- `/dev/null`.

CUDA opens `/dev/nvidiactl`, `/dev/nvidia0`, `/dev/nvidia-uvm`,
`/dev/nvidia-uvm-tools` and `/dev/dri/renderD*` **read-write**, and issues
`ioctl` on them. Inside the sandbox those opens fail with `EACCES`
(`NVIDIA-SMI has failed ... Failed to initialize NVML`), so the only sanctioned
way to run the command was a retry with `sandbox_permissions:
danger-full-access` — a one-shot approval prompt for every CUDA command.

## What the switch does

When the switch is on, the plugin adds the configured device roots to the
policy's `additionalWritableRoots` for that confined call. Both enforcement
dialects derive their allow-list from that field, so the Landlock launcher
receives `--rw /dev --rw /dev/shm` (and bubblewrap would bind them), which
grants `read file`, `write file`, and `ioctl` on the device nodes under them.
The workspace stays the only writable **data** area — the grant is the device
tree, not `danger-full-access`.

The wrap is an own-property override of `confine` on the live provider
instance, so it applies to a running profile without a restart, and it re-wraps
itself if the provider instance is replaced. When the plugin unloads, the
override is removed and the shipped behavior returns.

### Per-turn reminder

Every user turn carries one durable context snapshot naming the current switch
state, so a long run or a context compaction cannot leave the model guessing
whether GPU access is on. The snapshot is merged with the execution-target,
Python-environment, and CPU-allocation lines of the other dock plugins, and the
agent's own follow-up steps do not duplicate it.

## Installation

This plugin is a DSH bundle in the [dsh-plugins repository](../../README.md). In
the DSH Web sidebar open **Plugins → Add plugin** and paste:

```text
https://github.com/xieqin74123/dsh-plugins#path:/packages/dsh-gpu-access
```

`#path:` is pnpm's Git-subdirectory parameter, and the installer hands the whole
spec to pnpm, so one repository can host several plugins. Alternatively clone the
repository and paste this directory's absolute path into the same field. See the
[repository README](../../README.md) for the full instructions.

## Using it

- Above the composer, next to the target/environment/CPU chips, click the
  **GPU** pill: it toggles the switch for the current session.
- Or run `/gpu` (`status`), `/gpu on`, `/gpu off`. The chip and the command read
  the same state.
- The state is folded into a `gpu-access` session projection, so it survives a
  page reload, a reconnect, and a resumed session.
- Without a connected Harness page the switch still works through `/gpu`, and
  the Agent sees the result of its own tool calls.

The default for a session that never ran `/gpu` is `defaultEnabled` (on).

## Configuration

The row is `gpu-access` in the profile's `cordis.patch.yml` layer:

```yaml
- id: gpu-access
  config:
    defaultEnabled: true          # switch state for a session without /gpu
    deviceRoots: ['/dev', '/dev/shm']
    enableCommands: true          # register the /gpu command
```

A narrower grant is possible by listing only the device nodes' directory that
exists on your host; Landlock rules are path-subtree rules, so the roots must be
directories (`/dev` covers the NVIDIA nodes because they are files inside it).

## Verify

```sh
nvidia-smi -L          # now lists the GPUs inside the sandbox
python3 -c "import torch; print(torch.cuda.is_available())"
```

With the switch off, the same command fails with `EACCES` opening
`/dev/nvidiactl` and the Agent is back to asking for an escalation approval.

## Limits

- The grant applies under `workspace-write` only; a `read-only` session still
  denies the write opens, and `danger-full-access` needs no grant at all.
- Remote SSH targets are not affected: the sandbox described here is the local
  bash tool's; commands run on another host are confined (or not) there.
- `nvidia-modprobe` may need to create `/dev/nvidia-uvm` on demand; the `/dev`
  grant is writable, so that works, and `/dev` is included by default.
- The plugin wraps a service instance method. If a future DSH release changes
  the sandbox seam, the wrap stops matching and the switch has no effect — the
  shipped confinement stays intact.
