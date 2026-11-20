# DSH CPU 分配插件

在 DeepSeek Harness Web UI 的输入框上方增加一条「CPU」栏：读取当前执行目标**可用的物理核心数**（不是逻辑核心 / 超线程数），并让用户把一定数量的核心分配给当前对话。Agent 会在系统提示中看到这项目标拓扑与分配预算，并用它限制构建、测试和计算任务的并行度。

插件对 SSH 插件是**可选依赖**：

- 已加载 `@local/dsh-ssh-hosts` 时，目标跟随「执行目标」栏，可以在 SSH 主机上读取 CPU 并分配核心；
- 未加载 SSH 插件时，插件独立工作，只读取本机（localhost）。

## 功能

- **CPU 栏**：输入框上方靠右显示 `CPU 全部 · 8` 或 `CPU 4 / 8`，与左侧的执行目标、Python 环境分开；点击后弹出分配菜单。
- **物理核心，而非逻辑核心**：探测脚本按 `(socket, core)` 去重统计物理核心；同时读取在线逻辑 CPU 数、进程可用 CPU 数（affinity）和 cgroup 配额，分配上限取这几项的最小值，因此容器 / Slurm 等受限环境不会显示整机的核心数。
- **按目标探测**：目标来自 SSH 插件的 `ssh-target` 状态。切换 SSH 目标后，CPU 栏自动重新探测新目标；每个目标的结果按 TTL 缓存，菜单右上角可强制重新探测。
- **持久分配**：分配结果折叠进 `cpu-alloc` session projection，刷新页面、重连、恢复会话后仍然保持；分配记录绑定在“当时的目标”上，切到其它目标时自动按“全部”处理，切回原目标时恢复原分配。
- **对话上下文**：分配或清除分配时注入一条用户上下文消息，说明目标、可用核心数、分配核心数和应使用的并行参数。
- **系统提示**：每轮请求都包含目标、物理 / 逻辑核心、cgroup 配额和当前分配，并明确要求 Agent 不要自行提高预算。
- **每轮提醒**：每条用户消息开始时，当前 CPU 预算会作为一条持久上下文快照附在会话末尾（与其他 dock 插件合并成同一条快照；多步循环不重复注入），因此长对话或上下文压缩后 Agent 仍不会忘记该预算。
- **Agent 工具**：`cpu_info` 读取当前目标的 CPU 拓扑和当前分配；`refresh=true` 可强制重新探测。
- **本地 bash 环境事实**：当前目标是 localhost 且已读到 CPU 信息时，本地 bash 工具会收到 `DSH_CPUS`（本次对话分配的核心数）、`DSH_CPU_PHYSICAL`（可用物理核）、`DSH_CPU_LOGICAL`（逻辑 CPU）。远程目标不注入这些变量，避免本地命令误用远程数值。
- **斜杠命令**：只注册一个 `/cpu`：
  - `/cpu` — 列出目标、可用核心和当前分配；
  - `/cpu <n>` — 把 n 个物理核心分配给当前对话；
  - `/cpu all` — 使用全部可用核心（清除显式分配）；
  - `/cpu refresh` — 强制重新探测当前目标。
- **自动探测**：插件启动时先探测 localhost；CPU 栏发现当前目标还没有数据时自动执行一次 `/cpu`，因此刷新页面后无需手动点开菜单也能看到核心数。

## 安装

本插件是 [dsh-plugins](../../README.md) 里的一个 DSH bundle。在 DSH Web 侧边栏打开 **Plugins → 添加插件**，把下面这一行粘贴到输入框：

```text
https://github.com/xieqin74123/dsh-plugins#path:/packages/dsh-cpu-alloc
```

`#path:` 是 pnpm 的 Git 子目录参数，DSH 的安装器会把整条 spec 交给 pnpm，所以一个仓库可以放多个插件。也可以先把仓库克隆到本地，在同一个输入框里填本目录的绝对路径（必须是绝对路径，例如 `/home/you/dsh-plugins/packages/dsh-cpu-alloc`）。安装后 bundle 默认启用；如果页面没有自动重载，刷新页面或重启 `dsh web`。完整说明见[仓库根 README](../../README.md)。

## 配置

bundle 的 patch 默认写入以下配置，可在 `~/.dsh/profiles/web/cordis.patch.yml` 中按行 id 覆盖：

```yaml
- id: cpu-alloc
  config:
    discoveryTimeoutMs: 15000
    cacheTtlMs: 60000
    maxOutputBytes: 65536
    maxCores: 4096
    enableCommands: true
```

| 字段 | 默认值 | 说明 |
|---|---|---|
| `discoveryTimeoutMs` | `15000` | 单目标 CPU 探测超时；SSH 主机过慢时返回超时说明 |
| `cacheTtlMs` | `60000` | 探测结果缓存时间；菜单中的刷新按钮强制重新探测 |
| `maxOutputBytes` | `65536` | stdout / stderr 各自保留的尾部长度 |
| `maxCores` | `4096` | 核心数上限，防止异常输出撑大界面与消息 |
| `enableCommands` | `true` | 是否注册 `/cpu`；关闭后只能通过菜单查看（菜单本身也依赖该命令） |

## 与 SSH 插件的关系

本插件**不 require** `sshExecution`，而是通过 `ctx.get('sshExecution')` 动态读取：

- 服务存在时：用 `sshExecution.resolveSession(session)` 解析当前会话目标，用 `sshExecution.run(...)` 在 localhost（本地 bash）或 SSH 主机（OpenSSH，`BatchMode=yes`）上执行同一段探测脚本；并镜像 `/ssh`、`/ssh-local`、`/ssh-<slug>` 的 `command/run` 事件来感知目标切换。
- 服务不存在时：目标固定为 localhost，探测走插件自带的 `lib/local-exec.js`（本地 bash、进程组超时/取消、输出截断），因此单独安装本插件也能使用。
- 若 SSH 插件被卸载而后又恢复，本插件无需重载：每次解析目标都会重新查找服务；目标变化后会由 `command/done` 事件触发视图刷新。

这种可选关系与 Python 环境插件不同：Python 环境插件把 `sshExecution` 作为硬性依赖（没有目标就不猜环境），而 CPU 分配在本机也有明确意义，所以缺失 SSH 插件时退回本机。

## CPU 探测方式

一段固定的 POSIX `sh` 脚本在目标上执行，输出带标记的 `KEY<TAB>VALUE` 记录：

| 记录 | 来源 |
|---|---|
| `PHYSICAL` | `/proc/cpuinfo` 的 `physical id` + `core id` 去重；否则 `lscpu -p=CORE,SOCKET` 去重；macOS/BSD 用 `sysctl hw.physicalcpu` / `kern.smp.cores`；最后退回逻辑 CPU 数 |
| `LOGICAL` | `getconf _NPROCESSORS_ONLN`，否则 `/proc/cpuinfo` 计数 |
| `AFFINITY` | `nproc`（GNU nproc 遵守 `sched_getaffinity`） |
| `QUOTA` | cgroup v2 `cpu.max` 或 v1 `cpu.cfs_quota_us / cpu.cfs_period_us`，向上遍历进程所在 cgroup |
| `OS` / `SOURCE` | `uname -s` 与实际采用的数据来源，用于诊断 |

分配上限 = `min(PHYSICAL, LOGICAL, AFFINITY, QUOTA)`（忽略缺失项，至少为 1）。这样在 64 核机器上的 8 核容器里只会显示 8 个可分配核心。

## 安全说明

- 只允许分配 1 到“当前可用物理核数”之间的整数；未知目标、读取失败或越界都返回错误，不会改变已有分配。
- 探测脚本是固定的 POSIX 脚本，不拼接用户输入。
- SSH 目标沿用 SSH 插件的 `BatchMode=yes` 策略：不会弹密码提示，主机必须已信任本机密钥且 host key 已接受。
- 分配是**协作式预算**：插件通过系统提示、上下文消息和 `DSH_CPUS` 让 Agent 与本地命令遵守它，但不会用 `taskset`/cgroup 强制限制 Agent 启动的进程。需要硬隔离时请使用容器、cgroup 或调度器。

## 目录

```
dsh-cpu-alloc/
  index.js            Host 插件：目标镜像、CPU 探测缓存、projection、工具、命令、系统提示、bash 环境事实
  client.js           Web 客户端：输入框上方右侧的 CPU 栏、核心数选择菜单（目标/环境靠左、CPU 靠右）
  lib/probe.js        目标上的 POSIX 探测脚本、输出解析、可用核心计算
  lib/local-exec.js   未安装 SSH 插件时 localhost 使用的本地 bash 执行路径
  cordis.patch.yml    bundle patch
  locale/{zh,en}.json 插件管理页显示元数据
  icon.svg            插件图标
```

CPU 栏的当前值来自 Host 端注册的 `cpu-alloc` session projection：它从会话日志里的 `command/run` / `command/done` 事件折叠 SSH 目标镜像与 `/cpu` 分配，只有在 `/cpu` 成功结束后才提交新分配。核心数本身来自当前目标的探测结果，由 Host 缓存并随 projection 的 revision 一起发布给客户端。
