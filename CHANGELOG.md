# 变更记录

本仓库发布 npm CLI，并公开 LocalProject Desktop 源码。二者共享注册表格式，但版本号互不绑定；仓库不提供官方 Desktop 二进制 Release。

## 未发布

- 支持为每个项目配置多个 Webhook，并在项目栏中通过确认弹窗触发流水线。
- Webhook 请求由 Electron 主进程发送，固定使用 JSON `{}` 作为 POST body，并设置 15 秒超时。
- 无论 HTTP 状态是否为 2xx，都展示服务端状态与响应体，由用户根据返回内容判断流水线是否成功接收。
- 项目详情的同一资源栏调整为上方代码库、下方 Webhook，分别独立滚动。

## CLI 0.2.0（待发布）

- 增加安全拉取与更完整的 Git 状态、最近提交、未推送提交和未拉取提交读取。
- 增加注册表写入锁和并发修改冲突保护。
- 支持修改项目和代码库显示名称。
- 将代码库打开工具改为显式默认值；临时选择其他 opener 不再修改默认配置。
- 清理旧 `lastOpenerId` 历史字段，不将临时使用记录迁移为默认工具。

## Desktop 0.1.1（源码版本）

- 增加 LocalProject Electron + Vue 桌面界面，与 CLI 共享 `~/.local-project-cli/registry.json`。
- 提供项目、代码库、Git 状态、未提交文件、未推送提交、未拉取提交和最近提交视图。
- 提供安全 Fetch、Pull、Push，以及 Finder、IDE 和自定义 opener 打开入口。
- 支持项目、代码库和 opener 管理，并明确区分临时打开工具与代码库默认工具。
- 完成紧凑黑白灰界面、长路径中间折叠、状态语义色和渐进式 Git 扫描反馈。

## CLI 0.1.0（2026-08-25）

- 首次公开发布 Local Project CLI。
- 支持项目与代码库注册表、Git 状态查看和 opener 管理。
