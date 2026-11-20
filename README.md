# dsh-plugins

DeepSeek Harness（DSH）Web 的一组插件，按 **bundle** 方式安装：把插件的
GitHub 地址粘贴到 **Plugins → 添加插件** 即可，不需要 npm 包，也不需要构建。

English: five bundles for DeepSeek Harness Web — SSH execution target,
Python/Conda environment, CPU allocation, GPU sandbox access, and per-session
desktop notifications. Each bundle is installed from the Plugins page by
pasting its GitHub URL (a pnpm Git-subdirectory spec); there is no build step.

## 插件

| 包 | 作用 | 依赖 |
| --- | --- | --- |
| [`@local/dsh-ssh-hosts`](packages/dsh-ssh-hosts/README.md) | 输入框上方的「执行目标」栏；`ssh_hosts` / `ssh_exec` 工具 | — |
| [`@local/dsh-python-env`](packages/dsh-python-env/README.md) | Python/Conda 环境选择；`python_envs` / `python_exec` | 需要 `ssh-hosts` 提供的 `sshExecution` 服务 |
| [`@local/dsh-cpu-alloc`](packages/dsh-cpu-alloc/README.md) | 物理 CPU 核心分配；`cpu_info` 工具与 `DSH_CPUS` 环境事实 | 可选依赖 `ssh-hosts` |
| [`@local/dsh-gpu-access`](packages/dsh-gpu-access/README.md) | 沙箱内 GPU 设备访问开关（`/gpu`） | — |
| [`@local/dsh-session-notify`](packages/dsh-session-notify/README.md) | 会话完成 / 等待回答的桌面通知 | — |

## 安装

### 方式一：Plugins 页面 + GitHub 地址

在 DSH Web 侧边栏打开 **Plugins → 添加插件**，按需粘贴下面任意一行：

```text
https://github.com/xieqin74123/dsh-plugins#path:/packages/dsh-ssh-hosts
https://github.com/xieqin74123/dsh-plugins#path:/packages/dsh-python-env
https://github.com/xieqin74123/dsh-plugins#path:/packages/dsh-cpu-alloc
https://github.com/xieqin74123/dsh-plugins#path:/packages/dsh-gpu-access
https://github.com/xieqin74123/dsh-plugins#path:/packages/dsh-session-notify
```

`#path:` 是 pnpm 的 Git 子目录语法，DSH 安装器会把整条 spec 交给 pnpm，因此
同一个仓库里的多个 bundle 可以分别安装。安装器自己完成依赖安装、bundle 选择
与热加载；如果页面没有自动重载，刷新页面或重启 `dsh web`。

包名保留 `@local/` 前缀，这是本地 bundle 的约定；DSH 按包名解析，不需要 npm
scope 或发布。Git 地址安装会固定到安装时的默认分支；要更新就重新安装一次。

### 方式二：克隆后本地安装

```sh
git clone https://github.com/xieqin74123/dsh-plugins.git
```

把 `dsh-plugins/packages/<插件目录>` 的**绝对路径**粘贴到同一个输入框，效果相同。

### 安装顺序

`dsh-python-env` 声明了 `sshExecution` 服务依赖（由 `dsh-ssh-hosts` 提供）。
先装 `ssh-hosts` 再装 `python-env`；其余插件顺序随意。如果先装了
`python-env`，装上 `ssh-hosts` 后重新加载即可。

### 兼容性

- 在 DSH `0.2.2-rc.1`（Web profile）上开发与验证；每个包的 `engines.dsh`
  与 `@deepseek-ai/*` peer 范围见其 `package.json`。
- 只支持 Web/Electron 桌面端；headless/CLI 没有对应的 UI，插件会安全退化。

## 一起用时是什么样

- 输入框上方是一行 chip：左侧「执行目标」「环境」，右侧「CPU」「GPU」；首屏
  （新会话）和会话中的布局一致，左右边缘与输入卡片对齐。
- 每轮用户消息都会附带一条 `session-settings` 上下文快照（四个插件合并为
  一条），长对话或上下文压缩后 Agent 也不会忘记当前设置；Agent 自己的多步
  工具循环不会重复注入。
- `dsh-session-notify` 在输入框右下角、模型选择器旁显示一个铃铛，按会话
  开关桌面通知（默认开启）。

## 配置

每个插件在 profile 的 patch 层里各有一行（`ssh-hosts`、`python-env`、
`cpu-alloc`、`gpu-access`、`session-notify`），可配置字段见各插件 README
的「配置」一节。

## 安全

- `ssh_exec` 非交互执行（`BatchMode=yes`）；目标主机必须已信任本机公钥，
  不会弹出密码或口令提示。
- `dsh-gpu-access` 只是在沙箱策略的 `additionalWritableRoots` 中加入
  `/dev`、`/dev/shm`，不是 `danger-full-access`；工作区仍是唯一可写数据区。
- 这些插件只读写自己的 session projection 与 profile 配置，不收集数据、
  不上报遥测。

## 目录

```text
dsh-plugins/
├── README.md
├── LICENSE
├── scripts/check.mjs              # 语法 + 包元数据 + notify 离线测试
├── .github/workflows/check.yml
└── packages/
    ├── dsh-ssh-hosts/
    ├── dsh-python-env/
    ├── dsh-cpu-alloc/
    ├── dsh-gpu-access/
    └── dsh-session-notify/
```

## 开发

没有构建步骤；`packages/*` 里的 `index.js`（Host）、`client.js`（浏览器）
和 `lib/` 就是发布内容。修改后运行：

```sh
node scripts/check.mjs
node packages/dsh-session-notify/test/harness.mjs
```

本地开发时，用 Plugins 页面安装本地目录（方式二）即可热加载。

## License

MIT © 2026 Qin Xie
