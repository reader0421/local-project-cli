# 参与贡献

感谢你改进 LocalProject。仓库同时包含 npm CLI 和 Electron Desktop。

## 开发环境

- macOS
- Node.js 20 或更高版本
- pnpm 11（仅 Desktop 开发需要）

CLI 位于仓库根目录，使用 npm 和根目录 `package-lock.json`：

```bash
npm ci
npm run check
npm test
```

Desktop 位于 `desktop/`，使用 pnpm 和必须提交的 `desktop/pnpm-lock.yaml`：

```bash
cd desktop
corepack enable
pnpm install --frozen-lockfile
pnpm test
pnpm build
```

不要在仓库根目录提交 pnpm 锁文件，也不要在 `desktop/` 中生成 npm 或 Yarn 锁文件。

使用开发版本的全局命令：

```bash
npm link
```

## 提交变更

1. 为行为变化补充或更新测试。
2. 保持注册表向后兼容；如需迁移，在 `loadRegistry()` 的规范化阶段完成。
3. 不要提交真实的 `~/.local-project-cli/registry.json`、本机绝对路径、凭据或内部项目资料。
4. 修改 CLI 或共享 core 后，运行 `npm run check && npm test && npm pack --dry-run`。
5. 修改 Desktop 或共享 core 后，在 `desktop/` 运行 `pnpm test && pnpm build`。
6. 不要提交 `desktop/release/`、Electron 运行时 ZIP、真实项目截图或本机设计验收记录。

Opener 是通用的 `command + args` 配置。新增内置 opener 时，应优先选择广泛可用且名称稳定的 macOS 应用；版本化、本机专用或团队专用的工具应通过 `project opener add` 配置，而不是写入公共默认值。
