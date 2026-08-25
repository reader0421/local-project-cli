# 参与贡献

感谢你改进 Local Project CLI。

## 开发环境

- macOS
- Node.js 20 或更高版本

项目没有运行时第三方依赖。克隆仓库后可以直接执行：

本仓库以 npm 和 `package-lock.json` 为唯一包管理基线，请勿提交其他包管理器生成的锁文件。

```bash
npm ci
npm run check
npm test
```

使用开发版本的全局命令：

```bash
npm link
```

## 提交变更

1. 为行为变化补充或更新测试。
2. 保持注册表向后兼容；如需迁移，在 `loadRegistry()` 的规范化阶段完成。
3. 不要提交真实的 `~/.local-project-cli/registry.json`、本机绝对路径、凭据或内部项目资料。
4. 提交 Pull Request 前运行 `npm run check && npm test && npm pack --dry-run`。

Opener 是通用的 `command + args` 配置。新增内置 opener 时，应优先选择广泛可用且名称稳定的 macOS 应用；版本化、本机专用或团队专用的工具应通过 `project opener add` 配置，而不是写入公共默认值。
