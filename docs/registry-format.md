# 注册表 JSON 格式

注册表是 Local Project CLI 的唯一持久化文件，默认位于 `~/.local-project-cli/registry.json`，也可通过 `--registry` 或 `LOCAL_PROJECT_CLI_REGISTRY` 选择。

```json
{
  "schemaVersion": 1,
  "projects": [
    {
      "id": "uuid",
      "name": "示例项目",
      "slug": "示例项目",
      "workspacePath": "/Users/example/code/demo.code-workspace",
      "webhooks": [
        {
          "id": "uuid",
          "name": "发布测试服",
          "url": "https://ci.example.com/hooks/deploy?token=secret",
          "createdAt": "2026-09-04T00:00:00.000Z",
          "updatedAt": "2026-09-04T00:00:00.000Z"
        }
      ],
      "repositories": [
        {
          "id": "uuid",
          "name": "backend",
          "slug": "backend",
          "path": "/Users/example/code/demo/backend",
          "defaultOpenerId": "phpstorm",
          "createdAt": "2026-08-25T00:00:00.000Z",
          "updatedAt": "2026-08-25T00:00:00.000Z"
        }
      ],
      "createdAt": "2026-08-25T00:00:00.000Z",
      "updatedAt": "2026-08-25T00:00:00.000Z"
    }
  ],
  "openers": [
    {
      "id": "codex-cli",
      "name": "Codex CLI",
      "command": "codex",
      "args": ["-C", "{path}"],
      "mode": "terminal"
    }
  ],
  "settings": {
    "defaultOpenerId": "vscode"
  }
}
```

## 约束

- `schemaVersion` 当前固定为 `1`。
- `Project.slug` 全局唯一；`Repository.slug` 在所属项目内唯一。
- `Project.webhooks` 可省略；存在时必须是数组，同一项目内 Webhook 名称（忽略大小写）和 id 分别唯一。
- Webhook 地址只允许 `http` 或 `https`。Desktop 固定发送 `Content-Type: application/json`、body 为 `{}` 的 `POST` 请求，拒绝自动跟随重定向，并在 15 秒后超时。
- 服务端返回 HTTP 响应时，无论是否为 2xx，Desktop 都会展示状态码和响应体；显示内容最多 64 KiB，不持久化到 registry。
- Webhook URL 可能包含访问 token，注册表会原样明文保存；不要共享真实 registry 或将其提交到代码仓库。
- 同一个规范化物理路径只能登记一次。
- 非 Git 目录允许登记，JSON 结构与 Git 仓库相同。
- `openers[].args` 中的 `{path}` 在执行时替换为仓库路径或 `openTarget`。
- `openers[].mode` 可省略或设为 `terminal`；省略时后台启动，`terminal` 会在 macOS Terminal 中交互运行。
- 同一工具的多个版本通过不同 opener id 和具体命令参数区分。
- `Repository.defaultOpenerId` 是显式设置的代码库默认工具；缺失时跟随全局默认。临时选择其他工具打开不会修改该字段。
- `settings.defaultOpenerId` 是没有仓库历史选择时使用的全局默认值，只能在设置中显式修改。
- CLI 保存时先写临时文件再原子替换原文件。

## Opener 命令

建议通过 CLI 管理 opener，避免手工编辑 JSON 时破坏引用关系：

```bash
project opener list
project opener get <id>
project opener add --id <id> --name <name> --command <command> --arg "{path}" [--mode terminal]
project opener update <id> --name <name> [--mode background|terminal]
project opener default <id>
project opener remove <id>
```

全局默认 opener 或仍被 `Repository.defaultOpenerId` 引用的 opener 不能删除。

## 代码库自定义命令

`Repository.commands` 是可选数组；旧注册表不需要迁移。每项包含 `id`、`name`、`command`，名称在同一代码库内唯一（忽略大小写）。例如：

```json
"commands": [
  { "id": "uuid", "name": "启动开发服务", "command": "pnpm dev" },
  { "id": "uuid-2", "name": "构建项目", "command": "pnpm build" }
]
```

Desktop 详情页底部“运行命令”菜单可新增并执行命令；右上角“更多操作 → 自定义命令管理”可新增、编辑和删除。

`settings.defaultTerminalId` 可选 `terminal` 或 `ghostty`，缺失时使用 macOS 自带 Terminal。在全局设置中修改后对所有代码库生效，不影响已有 opener 定义。

运行时主进程按照代码库 ID 和命令 ID 重新读取注册表，在 `Repository.path` 根目录执行（不使用 `openTarget`）。通过登录交互 shell 加载终端环境，命令结束后显示退出码并保留交互窗口。支持 macOS 常见的 zsh/bash；其它 shell 回退到 `/bin/zsh`。Ghostty 需预先安装；Terminal 首次启动可能需要允许系统自动化权限。

应用的“已交给终端”只代表终端启动请求成功，不代表命令执行成功。输出、退出码及常驻开发服务均在终端中查看和控制；浏览器预览不会真正执行命令。

### Ghostty 多标签修正

Ghostty 的 macOS 启动改用单个 `--initial-command=shell:…` 配置参数传递完整命令，不再把 `/bin/zsh` 和代码库目录作为裸路径参数放在 `-e` 后面，避免被应用当作文件额外打开。路径及命令仍分别经过 shell 参数引用。回归测试覆盖含中文、空格、单引号及 `$` 的目录；配置格式依据本机 Ghostty 1.3.1 文档；配置检查工具出现 SentryInitFailed，未作为通过证据。安装后的标签数量需要重新验收。
