# 墨章 InkChapter

面向 Typora 的 Markdown **文档结构、自动编号、段落排版、图表题注、文档检测与图片工作流**增强插件。

| 项目 | 值 |
|---|---|
| 版本 | `0.1.0-alpha.1`（未发布正式版本号） |
| 平台 | Windows（`win32`），Typora ≥ 1.6.0（当前验证环境 1.6.7） |
| 依赖 | 社区框架 `@typora-community-plugin/core ≥ 2.9.0` |
| 加载方式 | vault 级 `<vault>/.typora/plugins/` 或用户级社区插件目录 |

> 完整功能讲解与逐步操作指南见 [墨章功能全览与使用指南](docs/INKCHAPTER-FEATURE-GUIDE.md)。

## 当前分支状态

| 项目 | 值 |
|---|---|
| 分支 | `feature/diagnostics-trae-ui-quick-fix` |
| 最新提交 | `496046f` — R07 单项修复精确化、面板联动与过期诊断以当前文档为准 |
| 前序提交 | `2308144` — R06 历史诊断安全加固、过期诊断自动重检与真实 Typora 运行时验收 |
| 工作树 | 本 README 与 2 份新增文档（功能指南、空行修复专项测试报告）尚未提交 |
| 最近验证 | `tsc --noEmit` 通过；全量 357 个测试文件 / 6198 个用例通过；生产构建 `28300EB0…3F80`；`pnpm run accept:blank` PASS（11 步 / 41 条断言） |
| 验证环境 | Windows / Typora 1.6.7 / 插件 `loadSource=vault` |

> 本表随分支推进更新；以 `git log` 与 `test/vault/runtime/acceptance/acceptance-last-run.json` 为准。

---

## 主要功能

### 标题编号与结构

- **标题自动编号（H1–H6）**：5 种预设（十进制层级 / 中文章节 / 中文大纲 / 罗马数字 / 空白）+ 自定义多级组合格式。
- **逐级样式**：数字样式（阿拉伯、全角、中文、大写中文、带圈、字母、希腊字母、天干、地支、罗马）、分隔符、前后缀、起始值、重新开始规则。
- **文档级覆盖**：同一篇文档可单独设置；支持「当前标题」「当前标题及下级」「整篇清除」。
- **范围与例外**：可配置参与编号的最大级别；摘要 / Abstract / 参考文献等特殊标题自动排除。
- **标题排版**：逐级对齐、首行缩进、标题间距；`..` / `。。` + `Enter` 强制段落首行缩进。
- **结构模式**：Loose（默认）与 Strict（首块必须 H1、唯一 H1、禁止跳级）。
- **大纲同步**：编号同步到 Typora 原生大纲面板，不改大纲文本。

### 图表、公式与题注

- **图表题注**：图片 / 表格 / 代码统一编号与题注名称，支持连续、按 H1/H2/H3 重置、章节联动、自定义模板。
- **公式编号**：块级公式语义编号，默认「节内编号」（如 `1.1-1`），可切换全局编号；空公式块也占用编号。
- **对象结构约束**：1 个对象 = 1 个独立块 = 1 个编号目标；标题内 / 列表内 / 引用内 / 表格内的图片会被检测并提示。

### 文档检测与修复

- **实时诊断**：错误 / 警告 / 提示三级，覆盖标题结构、文档结构、空行与换行、编号一致性、图片、表格、代码、公式、链接与脚注等域。
- **可操作**：`Lxx` 行号、点击定位（滚动 + 高亮 + 行内提示）、单项修复、同类修复、一键修复可处理项。
- **空行规范矩阵**：正文↔正文最多 1 个额外渲染空行，其余块对 0；文首 0，文末恰好 1 个换行；单个结构分隔空行不计为多余空行。
- **安全修复**：修复按稳定块身份在当前文档重新定位；目标不存在或存在多个同类候选时**不写入**；过期诊断会自动重检并刷新列表。
- **写回可撤销**：修复使用 Typora 自身编辑事务，一次写回 = 一条撤销记录，`Ctrl+Z` / `Ctrl+Y` 可撤销与重做。

### 文档工作区

- **文档状态方块**：右上角 12px 三色方块，单击展开「检测 / 图片 / 锁定」，双击切换锁定。
- **滚动导航器**：右下角 ▲▼ 快速滚动；与原生字数统计面板自动避让。
- **编辑锁定**：临时禁止自动写入，便于审阅。
- **内容块工具栏**：代码块复制源码与预览行数（5/10 行）、图片复制/下载/命名、表格工具。
- **文档标签右键**：关闭全部、复制完整/相对路径、在文件树中定位、在资源管理器中显示。
- **空工作区**：双击空白区快速新建 Markdown。

### 图片工作流

- 统一图片策略：资源目录、存储模式、引用模式、上传服务（GitHub / PicGo 等，多 profile）。
- 插入时自动本地化、自动上传；命名策略、压缩与 WebP 转换。
- 文档管理中心「图片」页：上传全部 / 下载全部 / 检查并补齐双链 / 图片设置（预检 → 确认 → 执行，复用优先，默认不改写 Markdown）。
- 凭据只保存本地引用，不写入文档、不进入仓库。

### 设置与运行时

- **设置工作台 4 页签**：编号方案 / 标题格式 / 文档规则 / 图表对象。
- **界面设置**：文件树定位闪烁、空工作区双击创建、标签右键菜单项、Ribbon、代码块预览行数、诊断 profile、阅读宽度。
- **运行时身份**：启动写入加载回执（构建标记 / SHA256 / 加载来源），提供诊断命令与审计日志（不含正文内容）。

---

## 快速开始

### 环境要求

- Windows 10/11，Typora ≥ 1.6.0
- 社区插件框架 `@typora-community-plugin/core ≥ 2.9.0`
- 开发：Node.js + pnpm

### 安装

1. **vault 级**：把构建产物放到 `<vault>/.typora/plugins/dist/`，并用 Typora「打开文件夹」打开该 vault。
2. **用户级**：按框架标准安装到 `%APPDATA%\Typora\plugins\plugins\ranzhi.inkchapter`，对任意 Markdown 文件生效。

### 验证是否加载

1. 打开文档后，编辑器右上角出现三色方块。
2. 查看 `<vault>/.typora/inkchapter-runtime-load.json`：`loadSource` 应为 `vault` 或 `global`，`mainJsSha256` 应与部署产物一致。
3. 更换构建后若界面未变，请**彻底退出 Typora** 再打开（插件在启动时加载）。

### 开发构建

```bash
pnpm install
pnpm build:dev    # 开发构建并部署到 test/vault
```

---

## 构建与测试

```bash
pnpm run build          # 生产构建 → dist/main.js + dist/style.css
pnpm run pack           # 生产构建 + 打包 zip
pnpm test               # 全量 Vitest
pnpm run typecheck      # TypeScript 严格类型检查
pnpm run docs:verify    # 文档链接 / 路径校验
pnpm run accept:blank   # 空行修复真实 Typora 运行时验收
```

- 当前全量测试：**357 个测试文件 / 6198 个用例**。
- 部署到隔离测试 vault：`powershell -ExecutionPolicy Bypass -File scripts/deploy-test-vault.ps1`
- 空行修复链路的专项结论见 [空行修复链路专项测试报告](docs/diagnostics/BLANK_LINE_FIX_CHAIN_TEST_REPORT.md)。

> 启动命令成功 ≠ Runtime 验证通过；以运行时回执与验收报告为准，详见 [runtime-verification.md](docs/operations/runtime-verification.md)。

---

## 文档索引

| 文档 | 内容 |
|---|---|
| [功能全览与使用指南](docs/INKCHAPTER-FEATURE-GUIDE.md) | 按界面入口与操作步骤介绍全部功能 |
| [功能模块索引](docs/modules/README.md) | 每个模块的实现与行为约定 |
| [诊断规则全量清单](docs/diagnostics/DOCUMENT_DIAGNOSTICS_FULL_INVENTORY.md) | 已实现的诊断规则、触发条件与权威代码 |
| [空行修复链路专项测试报告](docs/diagnostics/BLANK_LINE_FIX_CHAIN_TEST_REPORT.md) | 分层测试统计、场景矩阵与运行时证据 |
| [空行修复运行时验收](docs/diagnostics/BLANK_LINE_R06_RUNTIME_ACCEPTANCE.md) | 三层验收方式、报告字段与撤销/重做语义 |
| [构建与部署](docs/operations/build-and-deploy.md) | 构建产物、部署路径与一致性校验 |
| [测试环境](docs/operations/testing.md) | 测试 vault 与自动化入口 |
| [已知缺口](docs/roadmap/known-gaps-and-deferred-work.md) | 未闭环项与阻塞原因 |
| [CHANGELOG](CHANGELOG.md) | 面向用户的变更记录 |

完整文档索引见 [docs/README.md](docs/README.md)。

---

## 已知限制

- **真实鼠标点击检测面板**尚未自动化验收：Typora 1.6.7 不暴露 UI Automation 树、CDP 无页面目标，前台焦点易被抢占；现有证据来自与面板相同的业务入口。
- **像素级视觉门禁**（`PIXEL_GATE`）仍为人工目检。
- 空行装饰标记在部分文档/缩放下不绘制，标记断言只能证明"不残留"。
- 大文档（数千行）实时检测与绘制延迟仍在持续优化；≥2000 行矩阵未做真机全量验证。
- 公式编号默认关闭（需在设置中启用）；公式 GUI 延迟预算（P95）未闭环。
- 跨文件 Anchor 检测、结构化对象正文引用解析、用户源侧题注格式与编号冲突检测暂未实现。

完整列表与优先级见 [known-gaps-and-deferred-work.md](docs/roadmap/known-gaps-and-deferred-work.md)。

---

## License

[MIT](LICENSE.md)
