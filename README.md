# 墨章 InkChapter

面向 Typora 的 Markdown 文档结构、自动编号、段落排版、图表题注与文档工作流增强插件。

## 主要功能

- 标题自动编号（H1–H6）与多种编号预设、自定义多级格式、文档级覆盖
- 标题排版与段落缩进、标题级数范围控制、特殊标题排除
- 表格 / 图片 / 代码题注与独立编号；公式语义编号投影
- 大纲（侧栏目录）编号同步
- 文档诊断（错误 / 警告 / 提示）+ 点击定位 / Drawer / 编辑锁定 / 滚动导航；连续空行标记实时更新，拆分 / 合并后高亮按语义血缘继承
- 字数统计面板与右下滚动导航的智能避让（不遮挡按钮），导航手势一次执行一次动作
- 设置工作台、UI 视觉体系、运行时身份验证
- 原生 MathJax 块公式渲染；公式编号已可用（默认关闭，新装默认「节内编号」，可切换全局编号）

## Quick Start（开发环境）

- TypeScript（严格类型检查）、pnpm、esbuild
- Typora ≥ 1.6.0（Windows）、社区框架 `@typora-community-plugin/core ≥ 2.9.0`（与 `src/manifest.json` 的 `minCoreVersion` 一致）

```bash
pnpm install
pnpm build:dev   # 开发构建 + 部署到 test/vault（Typora 已在运行时不关闭/重启窗口，需手动重开以加载新构建）
```

## Build

```bash
pnpm run build   # 生产构建（esbuild）→ dist/main.js + dist/style.css
pnpm run pack    # 生产构建 + 打包 zip
```

## Global Install（全局社区插件）

墨章是 Typora **用户级**插件，安装后可对任意 Markdown 路径生效（不要求文档目录存在 `.typora`）。全局安装布局遵循框架标准 `.typora/community-plugins/plugins/<id>`。详见 [docs/operations/build-and-deploy.md](docs/operations/build-and-deploy.md)。

> 注意：启动命令成功 ≠ Runtime Identity PASS；以 15 项验证全部通过为准（见 [docs/operations/runtime-verification.md](docs/operations/runtime-verification.md)）。

## Testing

- 真实 Runtime 测试 vault：`test/vault/`（详见 [docs/operations/testing.md](docs/operations/testing.md)）
- 单元测试：`pnpm test`（vitest，`vitest.config.ts`）

## Documentation Index

- [docs/README.md](docs/README.md) — 完整文档索引（架构 / 模块 / 运维 / Roadmap / Maintenance）
- [CHANGELOG.md](CHANGELOG.md)

## Known Limitations

- 公式编号默认关闭（需在设置中启用）；桌面端 GUI 夹具验收与延迟预算（P95）尚未闭环，见 [docs/modules/formula-numbering.md](docs/modules/formula-numbering.md) §14。
- 连续空行标记的实时更新只到「DOM 提交」证据，屏幕像素级 Paint 尚未测量；≥2000 行文档与三层拆分/合并未做真机矩阵（见 [docs/modules/document-utilities.md](docs/modules/document-utilities.md) §3「连续空行实时链路收口」）。
- 跨文件 Anchor 检测、结构化对象正文引用解析、用户源侧 caption 格式与编号冲突检测暂未实现。
- 部分文档诊断的像素级人工验收（`PIXEL_GATE`）尚未闭环。

完整列表见 [docs/roadmap/known-gaps-and-deferred-work.md](docs/roadmap/known-gaps-and-deferred-work.md)。

## Changelog

见 [CHANGELOG.md](CHANGELOG.md)。
