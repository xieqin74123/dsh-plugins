# DSH SSH 主机插件

> ⚠️ 代码由 DSH 生成，未经人工审核；使用前请自行审查。见[仓库说明](../../README.md)。

在 DeepSeek Harness Web UI 中读取 `~/.ssh/config` 保存的 SSH 主机，在输入框上方显示并切换当前执行目标（`localhost` 或某台 SSH 主机），并让 Agent 在目标主机上执行命令。

## 功能

- **执行目标栏**：聊天输入框上方常驻一条「执行目标」栏，显示当前是 `localhost` 还是某台 SSH 主机；点击后可在 `localhost` 和 `~/.ssh/config` 中的主机之间切换。
- **localhost 选项**：随时可以切回本机；切回后系统提示会要求 Agent 使用本地 `bash` / `read` / `write` 等工具，而不是 `ssh_exec`。
- **主机列表**：解析 `~/.ssh/config`（含 `Include`），并用 `ssh -G` 解析每个 Host 实际生效的 `user`、`hostname`、`port`、`ProxyJump`。
- **持久选择**：当前目标通过 session projection 从 `command/run` 事件折叠得出，刷新页面、重连、恢复会话后仍然保持；不是仅存在于浏览器内存里的状态。
- **对话上下文**：切换目标时注入一条用户上下文消息，说明新的目标以及 Agent 应使用的工具。Agent 在下一条消息即可看到它。
- **每轮提醒**：每条用户消息开始时，当前执行目标会作为一条持久上下文快照附在会话末尾（与其他 dock 插件合并成同一条快照；Agent 自己的多步循环不重复注入），因此长对话或上下文压缩后 Agent 仍不会忘记目标。
- **Agent 工具**：
  - `ssh_hosts`：列出 `~/.ssh/config` 中的主机。
  - `ssh_exec`：通过系统 OpenSSH 客户端在指定主机上运行命令，支持 `workdir`、`timeoutMs`，返回 stdout / stderr / 退出码。
- **斜杠命令**：只保留一个 `/ssh` 命令。`/ssh` 列出主机，`/ssh <host>` 切到指定主机，`/ssh localhost` 切回本机；输入不存在的别名只返回错误，不会改变当前目标。目标栏的菜单直接通过 `/ssh <host>` 切换，不再为每台主机注册 `/ssh-<别名>` 命令，所以输入框的 `/` 菜单和 `+` 菜单里不会出现一堆主机条目。
- **自动刷新**：`~/.ssh/config` 变化后 watcher 会重载工具和系统提示；每次 `/ssh`（包括打开目标栏菜单后的切换/刷新）都会重新读取配置并更新目标栏的主机列表。

## 安装

本插件是 [dsh-plugins](../../README.md) 里的一个 DSH bundle。在 DSH Web 侧边栏打开 **Plugins → 添加插件**，把下面这一行粘贴到输入框：

```text
https://github.com/xieqin74123/dsh-plugins#path:/packages/dsh-ssh-hosts
```

`#path:` 是 pnpm 的 Git 子目录参数，DSH 的安装器会把整条 spec 交给 pnpm，所以一个仓库可以放多个插件。也可以先把仓库克隆到本地，在同一个输入框里填本目录的绝对路径（必须是绝对路径，例如 `/home/you/dsh-plugins/packages/dsh-ssh-hosts`）。安装后 bundle 默认启用；如果页面没有自动重载，刷新页面或重启 `dsh web`。完整说明见[仓库根 README](../../README.md)。

## 配置

bundle 的 patch 默认写入以下配置，可在 `~/.dsh/profiles/web/cordis.patch.yml` 中按行 id 覆盖：

```yaml
- id: ssh-hosts
  config:
    configPath: '~/.ssh/config'
    sshBinary: ssh
    excludeHosts: []
    connectTimeoutSeconds: 10
    defaultTimeoutMs: 120000
    maxTimeoutMs: 600000
    maxOutputBytes: 131072
    enableCommands: true
```

| 字段 | 默认值 | 说明 |
|---|---|---|
| `configPath` | `~/.ssh/config` | OpenSSH 配置文件路径 |
| `sshBinary` | `ssh` | OpenSSH 可执行文件 |
| `excludeHosts` | `[]` | 不显示、也不允许 Agent 使用的主机别名 |
| `connectTimeoutSeconds` | `10` | 传给 OpenSSH 的 `ConnectTimeout` |
| `defaultTimeoutMs` | `120000` | `ssh_exec` 默认超时 |
| `maxTimeoutMs` | `600000` | `ssh_exec` 允许的最大超时 |
| `maxOutputBytes` | `131072` | stdout / stderr 各自保留的尾部长度 |
| `enableCommands` | `true` | 是否注册 `/ssh`；关闭后目标栏无法切换目标 |

## 供其他插件使用

插件通过 `ctx.provide('sshExecution', ...)` 暴露当前执行目标和统一的执行路径，其他插件（例如 Python 环境选择器）注入 `sshExecution` 后可以复用同一套目标解析和 SSH 参数策略：

| 方法 | 说明 |
|---|---|
| `ready()` | 等待主机目录和 `ssh-target` projection 就绪 |
| `hosts()` | 返回主机目录的副本 |
| `findHost(alias)` | 按别名/旧 slug 解析一台主机 |
| `resolveState({ command, args })` | 把 projection 的 `command`/`args` 解析成目标 |
| `resolveSession(session)` | 解析某个会话当前的目标 |
| `keyOf(target)` | 目标比较用的稳定键 |
| `run({ target \| host, command, workdir, timeoutMs, maxOutputBytes, signal })` | 在目标上执行命令：`localhost` 走本地 shell，SSH 主机走 OpenSSH |

## 安全说明

- 主机别名必须是 `~/.ssh/config` 中真实存在的 Host；`ssh_exec` 不接受任意 host 字符串，避免把 `-oProxyCommand=...` 之类的参数当作主机传入。`sshExecution.run` 的 `localhost` 分支会通过本地 `bash -c` 执行，只应被可信插件调用。
- `ssh` 进程使用 `spawn` + 参数数组启动，别名和路径不会经过本地 shell；远程命令本来就会交给远端登录 shell 执行。`sshExecution.run` 的 `localhost` 分支按设计通过本地 `bash -c` 执行。
- 使用 `BatchMode=yes`：不会弹出密码提示，主机必须已经信任本机密钥，且 host key 必须已接受。未知 host key 会直接失败并在 stderr 中说明。
- 超时或取消会杀掉本地 `ssh` 进程组；远端命令可能仍继续运行。
- 与 `bash` 工具一样，`ssh_exec` 是模型可调用的执行能力，请在可信的会话和 Agent 配置中使用。

## 目录

```
dsh-ssh-hosts/
  index.js             Host 插件：目标 projection、工具、命令、系统提示、上下文注入
  client.js            Web 客户端：输入框上方的执行目标栏与目标选择菜单
  lib/ssh-config.js    ~/.ssh/config 解析与 ssh -G 解析
  lib/ssh-exec.js      OpenSSH 子进程、超时、取消与输出截断
  lib/local-exec.js    localhost 目标使用的本地 bash 执行路径
  cordis.patch.yml     bundle patch
  locale/{zh,en}.json  插件管理页显示元数据
  icon.svg             插件图标
```

目标栏的当前值来自 Host 端注册的 `ssh-target` session projection；它从会话日志中的 `command/run` / `command/done` 事件折叠，因此不依赖浏览器本地状态。只有在 `/ssh` 成功结束后才提交新目标，输错别名或注入上下文失败都不会改变当前目标。选择 `localhost` 时，系统提示会明确要求 Agent 使用本地工具；选择某台主机时，系统提示会指向该主机并要求通过 `ssh_exec` 操作。
