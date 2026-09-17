# LocalProject Desktop 源码运行与本机打包

LocalProject Desktop 只适配 macOS。本仓库公开 Desktop 源码和构建脚本，但不提供官方 Desktop 二进制 Release、自动更新服务或签名安装包。

Desktop 与 npm 包 `local-project-cli` 可以独立运行，只共享兼容的 `~/.local-project-cli/registry.json`。Desktop 会把当前 shared core 编入应用，不调用或覆盖全局 `project` 命令。

## 刷新 Git 状态

启动扫描、右上角全局刷新和代码库详情刷新都会先 fetch，再读取本地状态。详情刷新只处理当前代码库。未初始化 Git 或未配置远端时跳过 fetch；已配置远端但未设置上游分支时仍可 fetch，不会自动设置上游或合并代码。

每次 fetch 最多等待 10 秒，超时会终止 Git 及传输子进程。后台获取禁止交互式认证，HTTP 请求使用 HTTP/1.1 以避开部分网络环境的 HTTP/2 传输错误，这些选项不修改仓库或全局 Git 配置。全局扫描中的单个仓库失败不会阻止其他仓库完成，失败详情会提示远端差异可能不是最新的。

## 从源码运行

要求：macOS 13 或更高版本、Node.js 20 或更高版本、pnpm 11、Git。

```bash
git clone https://github.com/reader0421/local-project-cli.git
cd local-project-cli/desktop
corepack enable
pnpm install --frozen-lockfile
pnpm test
pnpm build
pnpm dev
```

## 最近常用排序与菜单栏

- 项目列表按最近七个本地自然日（含今天）的使用次数降序排列，同次数保持原配置顺序。每次应用进程启动时确定顺序，之后刷新、修改配置、关闭并重新打开窗口都不会按新次数跳动；新增项目放到末尾。
- 切换到 Repo 详情、从其他页面返回详情、执行一条保存的命令，各给 Repo 和所属项目加一次。重复点击当前详情、启动时的默认选择不计数。
- Webhook 在确认触发时给所属项目加一次。它属于项目，不分摊到某个 Repo；打开确认框后取消不计数。命令或 Webhook 执行失败，仍计作一次使用。
- macOS 菜单栏左键点击图标，按滚动最近 24 小时的 Repo 次数排序，最多显示十个；同次数优先最近使用。每次打开菜单重新计算并保存快照，不足十个时依次用上次快照、当前注册表补齐，过滤已删除的 Repo。长期未使用时也保留可用入口。
- 点击菜单中的 Repo 会恢复或重建桌面窗口、进入详情，并按 Repo 默认打开工具（未设置时用全局默认）打开 `openTarget` 或仓库目录。点击菜单栏入口也计一次使用。
- 关闭窗口后菜单栏继续驻留；彻底退出请用菜单中的“退出 LocalProject”或应用退出操作。图标使用透明背景的模板图案，由 macOS 适配菜单栏深浅配色。

统计与快照仅保存在 Electron `userData/usage/` 中，按注册表绝对路径隔离，不写入共享 `registry.json`。计数按天分组，启动、记录、打开菜单及每小时清理七天前的数据，精确时间明细只保留最近 24 小时。历史快照只保存最多十个 Repo ID。

除单元测试外，可以执行隔离的 Electron 冒烟验收：

```bash
pnpm build
pnpm exec electron scripts/smoke-usage-macos.mjs
```

该脚本只使用临时注册表、临时统计目录和本机 HTTP 服务，验证真实渲染器/IPC、命令失败计数、菜单项回调、窗口恢复与重建、默认 opener 的参数和图标透明通道，不操作现有项目和真实 IDE。菜单通过程序触发，实际鼠标点击及系统主题下的视觉效果需人工验收。

## 本机打包

Apple Silicon：

```bash
pnpm package:mac:arm64
```

Intel Mac：

```bash
pnpm package:mac:x64
```

脚本会运行测试和生产构建，生成应用图标，打包 `.app`、DMG、ZIP、SHA-256 摘要及第三方许可证。产物位于 `desktop/release/`，许可证文件位于应用包的 `Contents/Resources/licenses/`。

若 `desktop/vendor/electron/` 中存在对应版本的官方 Electron ZIP，打包会复用它；否则由 `@electron/packager` 下载。Electron ZIP、构建目录和安装包都被 Git 忽略，不进入公开源码仓库。

## 本机安装验收

1. 打开与本机架构一致的 DMG。
2. 将 `LocalProject.app` 拖入 Applications。
3. 启动应用，确认读取现有注册表，而不是创建另一份数据。
4. 核对项目、代码库、opener 和 Git 状态。
5. 关闭 Desktop 后运行 `project list`，确认 CLI 配置未被覆盖。
6. 覆盖安装新版本后，再次确认注册表仍保留。

本机打包产物仅用于自行构建和验证，不代表仓库维护者提供了可公开分发的官方 Desktop 安装包。
