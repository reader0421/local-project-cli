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
