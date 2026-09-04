# 安全策略

## 报告安全问题

请不要为未公开的安全问题创建公开 Issue。请通过 GitHub Security Advisory 的“Report a vulnerability”入口私下报告，并附上影响范围、复现步骤和建议修复方式。

## 配置边界

LocalProject CLI 和 Desktop 都会执行注册表中 opener 的 `command` 和 `args`。程序不会通过 shell 拼接执行这些参数，但恶意或被篡改的注册表仍可能启动不可信程序。请只使用自己创建或确认可信的注册表，不要直接运行来源不明的配置文件。

Terminal 模式必须把命令交给终端 shell 执行。实现会逐个引用 `command` 和 `args`，避免代码库路径被当作 shell 语法解析；但 opener 本身仍是用户授权执行的命令配置，安全边界与普通终端命令一致。

Desktop 使用隔离的 Renderer：`contextIsolation` 和 Electron sandbox 保持开启，Renderer 不直接获得 Node.js 权限，只能通过受限 preload API 请求本机操作。引入新的 IPC 接口时，应在主进程中重新解析并校验项目、代码库或 opener 标识，不能直接信任 Renderer 传入的文件路径或命令。

项目 Webhook URL 可能包含用于触发流水线的访问 token，并会以明文保存在 registry 中。请限制该文件及备份的读取权限，不要提交或分享真实配置。Desktop 只在用户确认触发时，由主进程向已保存的 `http/https` 地址发送 POST；不会把 Renderer 临时传入的任意 URL 直接作为请求目标。

LocalProject 不提供云端账号、同步或遥测服务。Git 网络访问只发生在用户主动执行 Fetch、Pull 或 Push 时，并由本机 Git 使用代码库自身的远端和凭据完成；Webhook 网络访问只发生在用户主动确认触发时。
