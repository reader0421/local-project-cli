# 安全策略

## 报告安全问题

请不要为未公开的安全问题创建公开 Issue。请通过 GitHub Security Advisory 的“Report a vulnerability”入口私下报告，并附上影响范围、复现步骤和建议修复方式。

## 配置边界

Local Project CLI 会执行注册表中 opener 的 `command` 和 `args`。程序不会通过 shell 拼接执行这些参数，但恶意或被篡改的注册表仍可能启动不可信程序。请只使用自己创建或确认可信的注册表，不要直接运行来源不明的配置文件。

Terminal 模式必须把命令交给终端 shell 执行。实现会逐个引用 `command` 和 `args`，避免代码库路径被当作 shell 语法解析；但 opener 本身仍是用户授权执行的命令配置，安全边界与普通终端命令一致。
