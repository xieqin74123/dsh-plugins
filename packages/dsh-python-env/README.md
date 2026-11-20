# DSH Python / Conda 环境插件

在 DeepSeek Harness Web UI 的对话框上方增加「环境」选择栏。它联动 SSH 插件的**执行目标**：在 `localhost` 或当前 SSH 主机上发现可用的 Python 解释器和 conda 环境，选择后让 Agent 在对应目标上使用指定解释器。

## 功能

- **环境选择栏**：聊天输入框上方、SSH「执行目标」栏下方显示当前 Python 环境；点击后按 `Conda 环境` / `Python 解释器` 分组列出目标上的候选项。
- **与 SSH 目标联动**：当前目标直接来自 SSH 插件的 `ssh-target` projection 和 `sshExecution` 服务。切换目标后，环境栏按新目标重新解析，原目标上的选择不会错误地套用到新目标；打开菜单时会发现新目标的环境。
- **目标上的发现**：通过一条 POSIX `sh` 脚本在目标上收集：
  - 登录 shell 的 `python` / `python3` / `ipython` 等；
  - `whereis -b python python3` 找到的其它解释器；
  - 常见 conda/mamba 根目录及其 `envs/*`；
  - `conda env list --json`；
  - pyenv 解释器；
  - 配置中的额外目录。
- **持久选择**：选择通过 `python-env` session projection 折叠会话日志，刷新页面、恢复会话后仍然保持。
- **切换上下文**：选择环境或选择「自动」时注入一条用户上下文消息，说明目标的 Python 路径、激活方式以及应该使用的工具。
- **系统提示**：每轮请求都包含当前目标、选中的解释器、激活命令，以及「所有 Python/pip/conda 命令都必须使用它」的指令。
- **每轮提醒**：每条用户消息开始时，当前目标与解释器会作为一条持久上下文快照附在会话末尾（与其他 dock 插件合并成同一条快照；多步循环不重复注入），因此长对话或上下文压缩后 Agent 仍不会忘记该选择。
- **Agent 工具**：
  - `python_envs`：列出当前目标上的解释器和 conda 环境；`refresh=true` 可跳过缓存重新发现。
  - `python_exec`：用选中的解释器运行 Python 代码；在 localhost 本地执行，在 SSH 主机上通过 OpenSSH 执行，并导出 `PATH` / `CONDA_PREFIX` / `CONDA_DEFAULT_ENV`。
- **本地 bash 环境事实**：当前目标是 `localhost` 且选中了环境时，本地 bash 工具会收到 `DSH_PYTHON`、`DSH_PYTHON_ENV`，conda 环境还会有 `DSH_CONDA_PREFIX`。远程目标不会注入这些变量，避免本地命令误用远程路径。
- **斜杠命令**：只注册一个 `/python-env` 命令；`/python-env` 列出环境（缓存过期时自动发现），`/python-env refresh` 强制重新发现，`/python-env <id>` 切换，`/python-env auto` 恢复目标默认解释器。

## 安装

本插件是 [dsh-plugins](../../README.md) 里的一个 DSH bundle。在 DSH Web 侧边栏打开 **Plugins → 添加插件**，把下面这一行粘贴到输入框：

```text
https://github.com/xieqin74123/dsh-plugins#path:/packages/dsh-python-env
```

`#path:` 是 pnpm 的 Git 子目录参数，DSH 的安装器会把整条 spec 交给 pnpm，所以一个仓库可以放多个插件。也可以先把仓库克隆到本地，在同一个输入框里填本目录的绝对路径（必须是绝对路径，例如 `/home/you/dsh-plugins/packages/dsh-python-env`）。安装后 bundle 默认启用；如果页面没有自动重载，刷新页面或重启 `dsh web`。完整说明见[仓库根 README](../../README.md)。

## 配置

bundle 的 patch 默认写入以下配置，可在 `~/.dsh/profiles/web/cordis.patch.yml` 中按行 id 覆盖：

```yaml
- id: python-env
  config:
    discoveryTimeoutMs: 30000
    defaultTimeoutMs: 120000
    maxTimeoutMs: 600000
    cacheTtlMs: 60000
    maxEnvironments: 200
    maxOutputBytes: 262144
    extraCondaRoots: []
    extraPythonDirs: []
    enableCommands: true
```

| 字段 | 默认值 | 说明 |
|---|---|---|
| `discoveryTimeoutMs` | `30000` | 单次环境发现的超时；在 SSH 主机上过慢时会返回超时说明 |
| `defaultTimeoutMs` | `120000` | `python_exec` 默认超时 |
| `maxTimeoutMs` | `600000` | `python_exec` 允许的最大超时 |
| `cacheTtlMs` | `60000` | 环境列表缓存时间；打开菜单使用缓存，菜单右上角刷新按钮强制重新发现 |
| `maxEnvironments` | `200` | 单次发现返回的最大条目数 |
| `maxOutputBytes` | `262144` | stdout / stderr 各自保留的尾部长度 |
| `extraCondaRoots` | `[]` | 额外 conda 安装根目录，例如 `~/opt/miniconda3` |
| `extraPythonDirs` | `[]` | 额外扫描 `python*` 的目录，例如 `/opt/py/bin` |
| `enableCommands` | `true` | 是否注册 `/python-env` |

## 与 SSH 插件的关系

本插件把 `@local/dsh-ssh-hosts` 作为前置依赖：

- `inject` 中要求 `sshExecution` 服务；
- 通过 `sshExecution.resolveSession(session)` 读取当前会话的目标；
- 通过 `sshExecution.run(...)` 在 localhost 使用本地 bash、在 SSH 主机上使用与 `ssh_exec` 相同的 OpenSSH 参数执行发现/运行命令；
- 折叠 `/ssh`、`/ssh-local`、`/ssh-<slug>` 的 `command/run` 事件，使环境栏能感知目标切换。

未安装 SSH 插件时本插件不会激活，这是有意为之：没有可靠的目标就不应该猜测环境属于哪台机器。

## 安全说明

- 只允许选择**实际发现到**的环境 id；手工输入未知 id 会返回错误。
- 目标上的发现脚本是固定的 POSIX 脚本；额外目录来自配置并在拼接前做 shell 引号处理。
- `python_exec` 会执行 Agent 提供的任意 Python 代码，与 `bash` / `ssh_exec` 一样是模型可调用的执行能力，请在可信会话中使用。
- SSH 目标沿用 SSH 插件的 `BatchMode=yes` 策略：不会弹密码提示，主机必须已信任本机密钥且 host key 已接受。
- 取消/超时会杀掉本地 `ssh` 或本地 bash 进程组；远端进程可能继续运行。

## 目录

```
dsh-python-env/
  index.js            Host 插件：目标镜像、环境发现缓存、projection、工具、命令、系统提示、bash 环境事实
  client.js           Web 客户端：输入框上方的环境栏与选择菜单
  lib/discover.js     目标上的 POSIX 发现脚本、输出解析、环境表格式化
  lib/command.js      激活命令、PATH/CONDA_* 注入、python_exec 命令构造
  cordis.patch.yml    bundle patch
  locale/{zh,en}.json 插件管理页显示元数据
  icon.svg            插件图标
```

环境栏的当前值来自 Host 端注册的 `python-env` session projection。它从会话日志里的 `command/run` 事件折叠 `ssh` / `python-env` 命令，因此不依赖浏览器本地状态；环境目录本身由当前目标发现并缓存，打开菜单时使用缓存，点击刷新按钮才会强制重新发现。
