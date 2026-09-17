# LocalProject Logo

## 2026-09-17 菜单栏图标

新增 `desktop/resources/TrayTemplate.png`：白色实心双层文件夹，Git 分支和外部背景镂空透明。最终采用用户指定的首版黑色图标，直接反转 RGB，逐像素保留 alpha；不采用后续生成或矢量重绘版本。主应用图标保持现状。

黑色源图保存在 `desktop/resources/TraySource.png`，最初由内置 imagegen 根据当前 Logo 生成。复现反色：

```bash
cd desktop
pnpm exec electron scripts/build-tray-icon.mjs
```

Electron 将最终图片标记为 macOS template image，提供 18 pt 与 Retina 的 36 px 表示；系统根据菜单栏配色决定最终黑白显示。打包仅包含最终 PNG，源图和导出脚本保留在源码中。

## 当前方案：2026-09-15 青绿文件夹

根据实际 Dock 截图的反馈，替换此前粗白轮廓、深色底板的图标。采用瓷白背景、前后两层青绿文件夹和一个米白色 Git 分支符号；通过简化形状与轻微立体层次，改善小尺寸下的识别与视觉重量。

- 源文件仍为 `desktop/resources/AppIcon.png`，通过现有脚本生成 `AppIcon.icns`。
- 背景铺满正方形画布，避免把额外的圆角底板和外部留白预先画入源图。
- 旧图备份在 `docs/assets/icon-2026-09-15/旧版图标.png`。
- [生成提示词](assets/icon-2026-09-15/生成提示词.md)记录内置 image_gen 的生成和编辑步骤。
- [macOS 样式预览](assets/icon-2026-09-15/macOS样式模拟预览.png)展示圆角、阴影、小尺寸与 Dock 对比，属于 AI 视觉模拟，不是 macOS 实际渲染截图。安装后的系统遮罩、图标缓存与实际 Dock 效果仍需验收。

以下为历史方案记录。

## 产品定位

面向 macOS 开发者的轻量本地项目工作台。CLI 与 Desktop 共享本机注册表，按项目组织多个代码库，集中查看 Git 状态，安全拉取与推送，并快速打开编辑器、IDE、终端。Desktop 还支持触发项目 Webhook。

## 设计含义

- 外层白色文件夹：本地项目与工作空间。
- 内部叠放模块：一个项目下的多个代码库。
- 薄荷绿模块：当前关注的工作对象，不作为运行状态指示。
- 模块内的 Git 分支与三个提交节点：代码库版本管理，以及项目的 Git 状态、拉取和推送能力。
- 深灰底色与简洁轮廓：呼应现有深色界面，减少细节对小尺寸识别的影响。

图标源文件：`desktop/resources/AppIcon.png`。通过现有 `node desktop/scripts/build-icon-macos.mjs` 生成打包所用的 `AppIcon.icns`。本次使用内置 image_gen 生成；PNG 为栅格素材，没有对应的矢量源文件。实际 Dock 显示需在重新打包安装后验收。

## 初版生成提示词

```text
Use case: logo-brand
Asset type: production macOS app icon for LocalProject, a local-first developer workspace manager.
Primary request: Design a new distinctive minimal logo expressing one local project containing multiple code repositories and quick access to developer tools. The product organizes projects and repositories, shows Git state, launches editors and terminals. Its UI is restrained charcoal and white.
Subject: a single bold geometric folder/workspace emblem, with an elegant L-shaped outer structure enclosing two offset repository tiles. Make these shapes feel like one coherent memorable mark, not a diagram. The folder lip and negative space should suggest an open workspace. White primary mark with one restrained mint-teal repository tile accent.
Composition: one centered icon only, frontal orthographic view, square 1024x1024 canvas. A charcoal rounded-square macOS icon tile occupies 88% of the canvas with balanced transparent margins outside the tile; genuinely transparent outer corners. Symbol occupies about 62% of tile width, strong negative space, thick shapes legible at 32px.
Style: precise vector-like geometry, softly rounded corners, matte charcoal tile with very subtle edge lighting and understated depth. Flat crisp white and mint emblem. Professional developer utility, calm, purposeful, premium.
Constraints: no text, no letters rendered as typography, no watermark, no extra icons, no database cylinders, no cloud, no branching network diagram, no neon glow, no glass, no glossy 3D extrusion, no presentation mockup, no multiple options. Deliver the actual standalone app icon.
```

## Git 元素修订提示词

使用内置 image_gen 编辑初版图标，最终采用带真实透明通道的版本。

```text
Edit this transparent PNG app icon. Add just one dark charcoal git-branch symbol inside the mint green rectangle: 3 circular nodes and a vertical line with a curved branch to the upper right. Keep everything else unchanged, including the original transparent alpha background. Output with background=transparent, real alpha transparency. Do not paint a checkerboard. The area outside the rounded dark app tile is empty transparent, not gray checkered. Preserve folder and colors and size.
```

## 2026-09-14：修正系统底板叠加与留白

本机安装后发现深色圆角图标与 macOS 26 的浅色底板叠加，形成明显白边。保留文件夹和 Git 图案，将深色背景延伸至整个正方形画布，去掉原图的透明边距、圆角边框和外部阴影。当前 `AppIcon.png` 为 1254 × 1254、不含透明通道的 PNG；仍由现有脚本生成各尺寸 ICNS。版本号保持 0.1.1。最终系统遮罩及安装后的显示效果以本机重新安装验收为准。

## 中心图案放大

根据安装后的视觉反馈，将中心文件夹与 Git 图案整体放大，宽度从画布约 50% 调整至约 76%，减少深色背景占比。保留全铺满的不透明深色背景及原有白色、薄荷绿配色，并重新生成 ICNS。
