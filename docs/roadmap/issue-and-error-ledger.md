# 墨章 InkChapter · 问题与错误全量清单（开发至今）

> 本文档由对项目全量资料的系统性遍历汇总而成，覆盖：Git 提交历史、项目内 Markdown 日志/证据/复盘文档、Agent 记忆库历史、全量代码与配置、运行/错误/调试日志。
> 组织方式：**先按问题类型分章（每类下逐条编号）**，再给出**时间线索引**、**同类规避经验库**、**未闭环项**与**被推翻结论记录**。全文不使用纯表格，采用条目化叙述，每条均可追溯来源。

---

## 0. 统计概览

### 0.1 采集范围与原始线索量

| 来源簇 | 采集内容 | 原始线索数 |
|---|---|---|
| Git 历史 | `git log --all` 全部 239 条提交；其中问题/缺陷/回归/冻结/性能相关提交 | 156 条编号记录（去重约 136 个唯一提交） |
| 项目 Markdown 文档 | `docs/**`、`runtime/evidence/**`、`CHANGELOG.md`、`docs/prompts/pending/**` 等 | 95 条（D-01…D-95） |
| Agent 记忆库 | `project_memory.md`、各日期 `topics.md`、`session_memory_*.jsonl` | 70 条（M-01…M-70） |
| 代码 / 配置 / 运行日志 | `src/**`、`build.js`、`package.json`、`test/vault/.typora/**`、`audit/runtime-sess-*.log`（333 个） | 45 条（C-01…C-45） |

原始线索合计 **366 条**（156 + 95 + 70 + 45）。

### 0.2 去重后的问题/错误总数量

跨来源去重、并将"同一问题族的多轮反复修复"合并计数后，本清单共收录 **112 个独立问题/错误条目**，编号如下：

- 构建/依赖/工具链/环境（BU）：14 条
- 插件生命周期/加载/侧栏/整窗冻结（LC）：9 条
- 标题编号与编号预设（HN）：17 条
- 标题格式/布局/缩进/光标（HL）：9 条
- 大纲与文件树（OL）：6 条
- 题注系统（表/图/代码）（CAP）：7 条
- 公式编号与渲染（FM）：16 条
- 段落排版 / Enter / 空块事务（EN）：11 条
- 文档诊断·检测规则与口径（DG）：9 条
- 文档诊断·视觉几何与定位（DV）：18 条
- 活动文档 / 工作区 / 启动（AW）：6 条
- 设置页与 UI 视觉（UI）：6 条
- 部署 / 运行时身份（DP）：4 条
- 文档/流程/审计工具类（TO）：5 条

若按"修复提交/文档记录"的事件粒度统计（即不合并同一问题族的多轮修复），问题性事件累计 **约 240 次**（含同一缺陷的反复修补），其中在 Git 历史中留下 fix 类提交的约 136 次。

### 0.3 时间分布

- **2026-07-20 ~ 07-31**（项目起步，标题编号 MVP 阶段）：约 22 个问题（编号逻辑、大纲同步、预设规范为主）。
- **2026-08-01 ~ 08-16**（格式编辑/共享样式槽/设置页阶段）：约 30 个问题。
- **2026-08-17 ~ 08-26**（大纲观察器 + 公式/题注语义权威阶段）：约 26 个问题。
- **2026-09-06 ~ 09-14**（UI 工作台 + 诊断视觉几何阶段）：约 20 个问题。
- **2026-09-28 ~ 10-04**（诊断定位 V5.12~V5.15 + 诊断能力矩阵）：约 26 个问题。
- **2026-10-05 ~ 10-12**（诊断文案/排序/光标隔离 + Enter/EOF 根因追查 + P0 冻结修复）：约 32 个问题。

### 0.4 状态分布（截至 2026-10-12）

- 已修复并静态验证（tsc/测试/build/SHA 通过）：约 **70%**
- 已修复且经真实 Typora Runtime 验证：约 **12%**
- 代码修复完成但像素/交互验收仍 `PENDING_USER_RUNTIME`：约 **10%**
- 明确未闭环 / `FAIL` / `UNKNOWN` / `PARTIAL`：14 条（见 §4）
- 被后续证据推翻并修正结论：11 组（见 §5）
- 环境阻塞导致的自动化盲区（非代码缺陷）：6 条

---

## 1. 按问题类型分类清单

> 每条字段：**时间 / 场景与表现 / 根因 / 修复与代码变更 / 状态与验证 / 同类规避**。

### 1.1 构建 / 依赖 / 工具链 / 环境（BU）

**BU-01｜koa-connect wrapper 导致 `ctx` 泄漏**
时间：2026-08 前（项目早期）。场景/表现：插件框架桥接层使用 koa-connect 包装，导致请求上下文 `ctx` 跨请求泄漏。根因：koa-connect 的包装持有了 `ctx` 引用。修复：改为原生 Koa 中间件重写。状态：已修复（固化为 `project_memory.md` Lessons）。规避：桥接层不引入持久的上下文闭包。

**BU-02｜构建正则缺 `/s` 致跨行 `import type` 产出非法 JS**
时间：项目早期（`build.js:14–32`）。表现：`esbuild-plugin-typora` 的正则 `/import type .+? from/g` 无 `/s` 标志，跨行 `import type {...} from` 匹配失败，产出非法 JS。修复：构建前幂等补丁为正则加 `/s`，且仅当未打过补丁时执行（避免二次替换）。状态：已修复。规避：对上游依赖缺陷在构建脚本中固化修复并做幂等保护。

**BU-03｜Sass 产物命名 `main.css` 与运行时契约 `style.css` 不一致**
时间：项目早期（`build.js:63–70`）。表现：`esbuild-sass-plugin` 以入口名产出 `dist/main.css`，而运行时加载器/部署契约期望 `dist/style.css`。修复：生产构建后显式 `rename main.css → style.css`（缺失则静默跳过）。状态：已修复；同一陷阱在记忆库中以"构建命名坑"再次被记录（M-56），说明曾长期存在隐患。规避：产物命名以加载契约单一权威为准。

**BU-04｜插件启动 bundle 兼容性（native class / super）**
时间：2026-08-22（`4baa951`）。表现：生产 bundle 在 Typora 内启动异常。根因：构建方式的类/继承产物不兼容。修复：生产构建改 `node build.js --prod`（esbuild native classes）；从 esbuild-sass-plugin 的 `main.css` 输出 `style.css`；新增 `INKCHAPTER-BOOT-*` 标记与显式 `super()`。状态：已修复（constructor/bundle 定向回归）。规避：引入启动标记便于区分"未加载/加载失败/加载成功"。

**BU-05｜esbuild 与 rollup 构建管线差异致 style SHA 不一致**
时间：2026-06~08 约束固化（`pnpm run build:dev` vs `pnpm run build`）。表现：同一源码经不同管线产出不同 style SHA，导致 SHA 校验困惑。根因：esbuild 去空白与 rollup 输出差异（非源码差异）。修复：约定构建必须用 `pnpm run build:dev`(esbuild)，禁止 `pnpm run build`(rollup)；唯一 runtime 路径固定。状态：约束固化。规避：构建管线唯一化，SHA 比较必须同管线。

**BU-06｜PowerShell 5 默认 ANSI 读取中文 `manifest.json` 报错**
时间：2026-10-12（`ENTER-EOF-FIX-REPORT.md` §7）。表现：`scripts/deploy-test-vault.ps1` 用 `Get-Content $ManifestSrc -Raw`（PS5 默认 ANSI）读取含中文的 `src/manifest.json`，触发 `ConvertFrom-Json : Invalid object passed in` 而中止部署。根因：PowerShell 5 `Get-Content` 默认编码非 UTF8。修复：本轮改用手工 `Copy-Item` 并逐项校验 SHA（未越界改用户 WIP 脚本）；建议后续改 `-Encoding UTF8`。状态：已规避（脚本本身未修）。规避：`$PSDefaultParameterValues['Get-Content:Encoding']='UTF8'`。

**BU-07｜PowerShell 终端丢失 `E:\NodeJS` PATH**
时间：2026-10-09（记忆 M-52）。表现：某些 PowerShell 终端中 `pnpm`/`node` 不可用。根因：终端环境 PATH 丢失。修复：`$env:Path="E:\NodeJS;"+$env:Path` 或改用绝对路径 `& "E:\NodeJS\pnpm.CMD"`。状态：约束固化。规避：脚本内不假设 PATH。

**BU-08｜TRAE 沙箱阻止 Typora 访问 lockfile/日志/leveldb → 运行时验收长期 INCOMPLETE**
时间：2026-08-18 起贯穿全程（记忆 M-01/M-03/M-07/M-08/M-54/M-55/M-59 等）。表现：静态测试全绿，但真实 Typora 运行时验收（RUNTIME ACCEPTANCE）持续无法完成。根因：沙箱阻止 Typora 访问 lockfile、log、config、leveldb。修复：记录可通过 Settings→Conversation→Custom Sandbox Configuration 解除；未闭环前如实标注。状态：长期未闭环（环境限制，非代码缺陷）。规避：静态 PASS 一律不等于 Runtime PASS。

**BU-09｜测试超时阈值过低**
时间：项目早期（`53f08b9`）。表现：部分用例超时抖动。修复：vitest `testTimeout` 提升至 15000ms。状态：已修复（测试基础设施）。规避：异步/几何用例给予足量超时。

**BU-10｜GitHub Push Protection 假阳性（变量名 `hvs`）**
时间：2026-09-30（V5.14-R1）。表现：首次 push 被 GH013 拒绝，理由是变量名 `hvs` 与紧随的 `.` 被判定为 HashiCorp Vault 服务令牌前缀。根因：扫描器假阳性。修复：变量改名 `headingGates`（无行为变化）并重建部署。状态：已处理。规避：局部变量改名后必须重新 build/deploy，使归档源码与产物一致。

**BU-11｜`verify-docs.mjs` 把行内代码误判为 Markdown 链接**
时间：2026-10-11（`prompt-consolidation-record.md`）。表现：文档校验脚本把 `` `[text](target)` ``（行内代码）误判为真实链接，产生假阳性报错。根因：解析未排除行内代码。修复：新增 `stripInlineCode` 修正。状态：已修复。规避：含已删除路径的 PROVENANCE 文件需白名单。

**BU-12｜运行时产物污染版本库**
时间：2026-08-19 起（`2703369`、`f262106`、存档提交）。表现：`test/vault/.typora` 运行时产物被纳入版本控制，造成仓库噪音与污染。修复：将 `test/vault/.typora` 排除出版本控制（`.gitignore`）。状态：已修复。规避：运行时产物与源码分离。

**BU-13｜构建产物未部署，Typora 仍加载旧 BuildId**
时间：2026-08-21（R60.1，记忆 M-32）。表现：源码改动后 Typora 仍加载 r59.2。根因：项目 `dist` 未部署到 Runtime 插件目录 `test/vault/.typora/plugins/dist/`。修复：build → copy deploy → SHA 校验 → BuildId 校验 → Runtime 验证（并清缓存重启）；六项完成条件全通过。状态：已闭环。规避：编译成功 ≠ 部署 ≠ 实际加载；三者须逐一核验。

**BU-14｜非 vault 目录被创建 `.typora`（目录污染）**
时间：2026-10-09（`2840444`，另 `ae96d25` 清理）。表现：在普通文档文件夹内生成 `.typora` 目录。修复：global-load 不再在非 vault 目录创建 `.typora`；并清理仓库内被污染的嵌套 sidecar。状态：已修复。规避：路径权威分层，用户级插件不在无本地 `.typora` 的目录写盘。

---

### 1.2 插件生命周期 / 加载 / 侧栏 / 整窗冻结（LC）

**LC-01｜P0 整窗冻结（H1，最高严重级）**
时间：2026-10-09。场景/表现：Typora 整窗无响应（`Responding=False`），会话在 `05:58:46.827Z → 06:00:23.172Z` 突然结束且无日志 flush（证据 `runtime/evidence/typora-freeze-20261009/EVIDENCE-NOTE.txt`）。根因：committed HEAD 的 `enforceRibbonVisibility` 常驻 `body.class` MutationObserver，反复 `classList.remove('typ-ribbon--enable')` 与框架争用 → **写-观察反馈环**。修复：移除观察器；`applyRibbonVisibility` 幂等、只写 `inkchapter-ribbon-hidden`、不写框架类；`style.scss` 命名空间 CSS 恢复原生侧栏（归零 `--typ-ribbon-width`）。验证：R1 复现场景（项目外 README + 全局 + `ribbonEnableClass=true`）实测 `Responding=True`、无冻结、未建 `.typora` sidecar。状态：已修复并真机验证。规避：禁止写-观察反馈环；禁止常驻全量 MutationObserver；视觉状态写入必须幂等且只写自有命名空间。

**LC-02｜社区 Ribbon 注入替换 Typora 原生侧栏**
时间：2026-08-02（`addc1e3`）、2026-10-09（`cd9c5f2`）。表现：Typora 原生侧栏被框架 Ribbon 模式替换。根因：`WorkspaceRibbon` 被启用。修复：默认撤掉框架 Ribbon 模式，保持原生侧栏。状态：已修复。规避：不启用会替换宿主原生 UI 的框架能力。

**LC-03｜非规定文件夹仍被注入 Ribbon**
时间：2026-10-09（`cd9c5f2` 同批）。表现：非规定文件夹下框架 Ribbon 模式仍被注入。修复：默认关闭并做路径判定。状态：已修复。规避：同 LC-02。

**LC-04｜插件未生成 runtime 文件（未定论）**
时间：2026-08-21（记忆 M-35）。表现：logger 显示新构建 SHA 匹配，但插件未创建 runtime 文件；窗口标题仍为 "Typora"、audit 为空。根因：疑似插件加载问题（未定论）。修复：记录待查。状态：未闭环（UNKNOWN）。规避：加载标记（`runtime-load.json`）作为加载成功的单一证据。

**LC-05｜R60.x 公式渲染介入导致"不可修正"回归 → 两次回滚**
时间：2026-08-21（记忆 M-22/M-36/M-37）。表现：引入 R60.x 公式渲染介入后出现无法修正的回归，团队先后 `git reset --hard` 至 `89f1a9e`、再至 `d8aca1f`（后者无 tex2svg/typesetPromise 调用），公式块恢复正常。根因：`76c0cf7` 提交引入的公式渲染干预代码。修复：回滚至无公式渲染干预的基线。状态：已回滚闭环。规避：渲染生命周期介入改动须在可回滚的小步内验证；禁止一次性大规模接管宿主渲染。

**LC-06｜启动顺序：MathJax 首渲染早于插件权威建立**
时间：2026-08-20 ~ 08-21（记忆 M-26~M-34）。表现：公式首次渲染早于 InkChapter 权威（registry/store/slot）建立 → Typora 原生编号接管。根因：`resolveCurrentEditorRoot()` 启动返回 null → `bindEditor()` 未调用 → 跳过文档切换；MathJax 先于 slot 创建。修复：新增 `formula-source-bootstrap.ts` / `formula-runtime-bootstrap.ts` / `formula-render-barrier.ts`，在 `main.ts` 中把上下文与 registry 前置于 CaptionService；经 `MarkdownView.load()/open()` 与 MathJax 之间入口接管。状态：部分闭环（R60.1 曾真机通过，但后续回滚）。规避：宿主渲染生命周期必须由显式 Render Barrier 控制，不依赖 `Plugin.onload`。

**LC-07｜全局加载路径权威缺失（单 vaultRoot 误判）**
时间：项目中期（`runtime-audit-and-identity.md` §14）。表现：用户级插件在无本地 `.typora` 的文档中被误判；`pluginMainSha256` 优先取 project 构建，无法发现"陈旧部署"。修复：拆分为分层路径权威（`vaultRoot` 允许 null）；额外计算 deployed artifact SHA。状态：已解决。规避：install / workspace / vault / document 根绝不可互相代用。

**LC-08｜部署产物陈旧检测失效（SHA 自比自恒真）**
时间：2026-10-02（`61d2206`）。表现：插件永远无法报告陈旧部署——`shaMatch` 结构性恒为 true。根因：`legacyPluginMainSha256` 优先取 `projectDistPath`（`dist/main.js`），只回退部署副本，等于把项目构建与自身比较。修复：`main.ts` 从真实部署产物计算 `deployedMainSha256` 并传入；`runtimeIntegrityFindingsFromIdentity()` 判 `RUNTIME_IDENTITY_SHA_MISMATCH`；不可读 SHA 不伪造 mismatch。状态：已修复（+3 测试；真机基线 PASS / 制造陈旧 FAIL / 恢复 PASS）。规避：校验必须比较"两个不同来源"，禁止同一路径自比。

**LC-09｜插件自身 presentation mutation 触发全文重扫反馈环**
时间：2026-09-30（`document-utilities.md` Performance Closure V1）。表现：插件绘制的展示层 DOM 变更被误判为 `CONTENT_RELEVANT` → 触发全文 semantic/caption/code 重扫 → 再次 mutation。根因：缺少变更来源（provenance）分流。修复：`MutationProvenance`（`USER_CONTENT`/`PLUGIN_PRESENTATION`/`LAYOUT_ONLY`/`UNKNOWN`），`PLUGIN_PRESENTATION` 绝不进入 semantic pipeline。状态：PARTIAL（无专属单测；stress Runtime Matrix 未跑）。规避：无法证明为插件视觉的变更 → 归 `UNKNOWN`（fail-safe），不做为内容变更。

---

### 1.3 标题编号与编号预设（HN）

**HN-01｜一级编号选项不生效**
时间：2026-07-20（`2d90151`）。表现：开启 H1 编号无效果。根因：`formatNumberedHeadings` 从计数器重算（总含 H1），与显示逻辑不一致。修复：改用引擎预计算的 label。状态：已修复。规避：编号 label 单一来源（引擎预计算），显示层不重算。

**HN-02｜Roman 与 Decimal 预设无法区分 / H1 隐藏时首可见层级 tokenStyle 继承错误**
时间：2026-07-21（`c3842c2`）、2026-08-02（`88d9dd1`）。表现：预设混淆；H1 隐藏时第一可见层级继承了 H1 的 tokenStyle。修复：区分 Roman/Decimal；Roman 预设各层级统一 `roman-upper`（移除 H3–H6 阿拉伯回退）。状态：已修复（+2 tests）。规避：预设由规范 formatter 单一生成，禁止层级回退硬编码。

**HN-03｜严格 H1 override 优先级错误**
时间：2026-08-08（`9a47410`）。表现：逐标题 override 可绕过结构规则。根因：`heading-override-store` 在严格模式下 H1 优先级判定错误。修复：移除可见 UI 中的旧 H1 语义，修正严格 H1 override 优先级（+23 tests）。状态：已修复。规避：结构规则优先级高于逐项 override。

**HN-04｜父级渲染标签泄漏进子级编号**
时间：2026-08-03（`b1cfff3`）。表现：academic-paper / appendix-hierarchical 预设下，父级的已渲染标签泄漏进子级编号。修复：H1-off 时子引用改用纯阿拉伯/字母计数。状态：已修复。规避：层级引用计数不得复用父级渲染文本。

**HN-05｜严格模式物理布局 override off-by-one（P0）**
时间：2026-08-09（`0442e11`）。表现：严格模式下编号/间距错位。根因：`applyLayoutOverridesToSettings.numberTitleSpacing` 把物理 override 直接写入 `settings.levels[physical]`（StyleSlot 索引）；严格模式下 Physical H1 污染 S1/H2、H2→H3、H6→未用 S6。修复：写前做 Physical→StyleSlot 转换（strict: physical−1，loose: identity）。状态：已修复（+9 tests）。规避：见 §3 经验库（物理层级 vs StyleSlot 永不混用）。

**HN-06｜拖拽重排 Physical→StyleSlot remap 产生重复 H5 段（P0）**
时间：2026-08-09（`2ec27f8`）。表现：拖拽后出现重复 H5 段。根因：`onContextualDragEnd` 传物理层级作 `currentLevel` 而非 `slotLvForDrag`。修复：改用 `slotLvForDrag` + `checkDragInvariant()`（+13 tests）。状态：已修复。规避：拖拽上下文一律以 slot 索引为键。

**HN-07｜P/S/R 坐标空间混用导致 H2→H3 双重位移（P1）**
时间：2026-08-09（`5a3702a`）。表现：提交后编号位移出错。根因：`handlePresetSelect('custom')` 写物理层级而非 slotLv（严格 H2 建 SELF 于 level=2）；引用插入对已 slot 的 refLv 重复 `resolveSlotLevel`。修复：统一 slot 语义 + 21 项 Settings 回归测试。状态：已修复。规避：ADR-003 —— 全持久化数据用 S（slot），UI 显示 S→P；禁止对存储值做 ±1 补丁。

**HN-08｜slot 映射与引用选择器物理显示错误（P0）**
时间：2026-08-08（`1cb0d0c`）。表现：引用选择器显示错误。修复：`renderLevelConfigPage` 物理 lv→slotLv（+30 tests）。状态：已修复。规避：同 HN-05~HN-07。

**HN-09｜编号预设预设预览与代码不一致 / 预设数量过少**
时间：2026-07-24 ~ 2026-08-03（`222e93a`、`fdc54e0`）。表现：卡片预览变体选择错误、应用更新后仍显示"有更新"；系统预设从 4 个扩展到 9 个。修复：加 version 追踪；预设规范化（+12 tests）。状态：已修复。规避：预设单一规范来源，预览复用实际 formatter。

**HN-10｜编号方案预设 + 旧版迁移（Phase 5）**
时间：2026-08-22（`f954a90`、`3513246`、`e3f57aa`）。表现：对象编号预设引入需兼容旧配置。修复：对象编号预设 + legacy 迁移 + 配置一致性守卫 + 预设 UI 配置。状态：已修复。规避：迁移必须容错旧数据并加错误边界（见 HN-11）。

**HN-11｜设置迁移不容错旧版 `customDefinition`**
时间：2026-07-22（`07102a3`）。表现：旧版自定义定义导致迁移抛错。修复：迁移容错处理旧版 `customDefinition` + 错误边界（try-catch，失败返回安全默认值，Notice 不阻断插件主体）。状态：已修复。规避：迁移路径必须 fail-soft，绝不阻断插件主体。

**HN-12｜层级预设父后缀错误（`withoutLevelOne`）**
时间：2026-08-05（`c049ab3`）、2026-07-25（`efce157`）。表现：层级预设迁移到后缀模型后，`withoutLevelOne` 的父后缀错误。修复：迁移为后缀模型并动态派生 `withoutLevelOne`。状态：已修复。规避：层级变体动态派生，不静态写死。

**HN-13｜全局与自定义 H1 编号控件不同步**
时间：2026-07-23（`1ef3adb`）、2026-08-04（`941114b`）。表现：两个控件状态分裂。修复：单一状态源 `showLevelOneNumber` + cycle guard；大纲菜单与设置页双向同步（`clearOutlineNumbering()`/`notifySettingsListeners()`/`syncFromExternalChange()`）。状态：已修复。规避：单一状态源 + 单向写权威。

**HN-14｜编号关闭后设置页保存未清 body/outline 编号**
时间：2026-08-04（`806bd14`）。表现：关闭编号后正文/大纲仍残留编号装饰。修复：`wasEnabled` 检查 + 显式 `clearNumbering()`/`clearOutlineNumbering()`。状态：已修复。规避：关闭操作必须显式清理两侧渲染。

**HN-15｜标题格式编辑器：格式段排序/分隔符/迁移覆盖上下文格式**
时间：2026-07-21 ~ 07-24（`9e850a7`、`5904917`、`0dffd8f`、`0991dea`）。表现：格式段自动插入分隔符与自动排序干扰用户；迁移覆盖已配置的上下文格式；拖拽排序不稳定。修复：移除自动分隔符/自动排序、稳定拖拽排序、阻止迁移覆盖上下文格式、上下文写入时同步多级。状态：已修复。规避：用户配置优先于迁移；排序用户可控。

**HN-16｜标题编号缓存跨文档污染 / 标题 key 碰撞 / 特殊名称不编号移除**
时间：2026-07-26（`5ebd975`）。表现：无 data-line/id 时 override map 污染同级标题；大纲缓存未按文档；特殊名称排除逻辑错误。根因：`elementKey()` 缺唯一性；`outline-numbering-controller` 缓存未带 documentKey。修复：`elementKey()` 加绝对 DOM index 回退（`H2:idx:N`）；`buildLabelFromContextualFormat` 仅过滤严格低于当前的层级；`isValidOutlineRoot()` 要求 `<a href='#'>`；缓存按 `documentKey+revision`；跨文档应用阻断。状态：已修复。规避：缓存键必须含文档身份；成员匹配可按文本，身份匹配不可按文本。

**HN-17｜内置标题预设未正确应用到预览与文档**
时间：2026-07-24（`548e21c`）。表现：内置预设应用到预览/文档时未走上下文格式段。修复：内建预设经上下文格式段应用。状态：已修复。规避：预设应用路径唯一化。

---

### 1.4 标题格式 / 布局 / 缩进 / 光标（HL）

**HL-01｜聚焦时标题文本位置跳动**
时间：2026-07-20（`ebee5a8`）。表现：编辑标题获得焦点时文字位移。修复：保持标题文本位置稳定。状态：已修复。规避：编号 gutter 与文本列分离，focus 不改变布局。

**HL-02｜编辑时标题编号消失/错位**
时间：2026-07-20（`c7f0b98`）。表现：进入编辑后编号不可见或错位。修复：编辑时保持编号可见并对齐布局。状态：已修复。规避：见 HL-01。

**HL-03｜`text-indent` 继承导致双击/focus 双重缩进**
时间：2026-08-05（`62e484f`）。表现：双击进入编辑时缩进翻倍。根因：`text-indent` 可继承，被内层再次应用。修复：改用不可继承的 `padding-inline-start`。状态：已修复。规避：首行缩进用不可继承属性。

**HL-04｜首行缩进重复应用到标题内容组**
时间：2026-08-05（`94da56c`）。表现：完整标题内容组被缩进多次。修复：仅应用一次（预览改可视画布）。状态：已修复。规避：缩进以内容组为单一作用单元。

**HL-05｜Enter 后标题 gap 消失**
时间：2026-08-08（`aea4647`）。表现：Enter 后标题间距丢失。修复：`areGapsValid()` 校验 `GAP_ATTR`。状态：已修复。规避：间距校验以属性存在为门。

**HL-06｜一级编号隐藏时 H1 gap 未锁定**
时间：2026-08-05（`b6f3427`）。修复：一级编号隐藏时锁定 H1 gap 为 none。状态：已修复。规避：关联设置联动锁定。

**HL-07｜自定义格式保存清空编辑器 / 保存并应用丢视图**
时间：2026-08-08（`aea4647`）。表现：保存自定义格式后编辑器被清空；"保存并应用"后丢失选中视图。修复：`saveFormatDraft` 同步 version；保存/恢复视图意图。状态：已修复。规避：保存操作不得重置编辑上下文。

**HL-08｜布局保存丢失 `formatSource` / 草稿共享 / 一次性通知**
时间：2026-08-05（`8012a88`）、2026-08-07（`d790291`、`3f230a2`、`3f0659f`）。表现：布局保存丢 `formatSource`；继承模式仍显示文档级"应用更新"按钮（根因：`getAppliedFormatVersion` 恢复继承后返回 undefined → `(0 < templateVersion)` 恒真）。修复：保留 `formatSource` + `DocumentLayoutOverrides`；仅在文档有独立 `formatSource` 时计算 version；双徽标改独立 if。状态：已修复。规避：见 ADR-004（Format Definition / Applied Snapshot / Effective Settings 三层分离）。

**HL-09｜formatSource 跨文档泄漏 / 设置页切文档不刷新**
时间：2026-08-06（`1d873cc`）。表现：切换文档后设置页保留上一文档格式状态。修复：新增 `onDocumentChanged()` 订阅 + `loadDocumentContext()` 跟踪 documentKey。状态：已修复。规避：设置页状态键必须含 documentKey。

---

### 1.5 大纲与文件树（OL）

**OL-01｜文件树编号污染**
时间：2026-07-25（`efce157`）。表现：文件树节点被误加编号装饰。修复：`FILE_TREE_SELECTORS` + `clearFileTreeNumberingAttributes` 隔离大纲与文件树 DOM。状态：已修复。规避：大纲/文件树 DOM 作用域严格隔离。

**OL-02｜大纲根误识别 / 结构脆弱**
时间：2026-07-29（`3800d98`）、2026-07-26（`5ebd975`）。表现：大纲根被误识别；要求 `a[href^=#]` 过严。修复：DOM 无关的大纲根检测（`isValidOutlineRoot`）；重复标题 occurrence 匹配。状态：已修复（`findOutlineRootRelaxed` 仍待真机验证）。规避：native level 不以视觉 padding-left 作唯一 authority。

**OL-03｜大纲重复身份碰撞（同名不同级）**
时间：2026-09-07（`194b3fe`）。表现：相邻同名不同级（H1 "text" + H2 "text"），第二个 H2 编号装饰缺失，`expected=11/actual=10`、`OUTLINE-STRICT-VERIFY FAIL / DECORATION_COUNT_MISMATCH`。根因：collector 用 `seenTexts: Set<string>` 仅按文本去重（`FIRST_FAILING_LAYER=C`）。修复：删除 text-only 去重；native identity 含 `rawDomOrdinal+depth+normalizedText+sameTextOccurrenceOrdinal`；先 MATCH ALL HEADINGS 再决定 decoration。状态：已修复（F1–F10）。规避：成员判定可按文本，身份判定不可按文本。

**OL-04｜大纲编号在原生变更后漂移/丢失（v27）**
时间：项目中期（记忆 M-55）。根因：缺乏 quiescence 与 post-apply 稳定性验证。修复：`nativeDirty`/`repairRequired` + `scheduleNativeStabilityCheck`（双 RAF，事件驱动无固定 timeout）；Coverage Gap 两阶段 `PENDING_DELIVERY → POST_DELIVERY RESOLVED/FAIL`；latest-wins + burst 合并。状态：功能完成，STRESS ACCEPTANCE INCOMPLETE。规避：post-apply watch 不可用固定 timeout。

**OL-05｜semantic fingerprint 误阻断大纲编号（v28）**
时间：项目中期（记忆 M-54）。根因：以 semantic sequence 作门 + v28 refresh EXHAUSTED 永久阻塞。修复：MODEL_K（EVENT→DIRTY→CURRENT-DOCUMENT-READINESS→FULL RESYNC→VERIFY→CLEAN）；readiness 改为 mature matcher；semantic fingerprint 降级为 `NON_BLOCKING_MISMATCH`；移除 EXHAUSTED 阻塞。状态：功能完成，RUNTIME INCOMPLETE。规避：诊断性不匹配不得作为硬门。

**OL-06｜大纲标题切换遗留陈旧 bold 状态 / 编号前缀字重不同步**
时间：2026-08-04（`b891d8d`、`6789080`）。表现：切换标题后旧粗体残留；大纲编号前缀字重与标题不同步。修复：clean-slate 重导 + class observer；编号前缀 font-weight 与标题 bold 同步。状态：已修复。规避：视觉状态切换用 clean-slate 重导而非增量。

---

### 1.6 题注系统（表/图/代码）（CAP）

**CAP-01｜题注位置耦合导致对象-标题绑定错误（Phase 6.1）**
时间：2026-08-24 吸收。表现：以 raw DOM H1..H6 → precedingHeadingCount → 假设 DOM index==snapshot index 绑定，导致对象归属错误。修复：改 Heading Authority → canonical heading DOM binding → 最近前置 canonical heading 身份 → stableIdentity 查语义状态；对象条目用 `precedingHeadingStableIdentity` 取代 `precedingHeadingCount`。状态：已解决。规避：禁止 index±1 补丁；`compareDocumentPosition` 集中为单一 helper。

**CAP-02｜caption deferred 无界热循环**
时间：2026-08-24（`8a655ea`）。表现：延迟状态机无熔断，CodeMirror/代码块渲染 mutation 未分类导致投影反馈环。修复：`CaptionReconcileStateToken` + 瞬态失败签名 + hot-loop fuse；`CanonicalHeadingFrame` 单一集合合并语义态；渲染器 mutation 分类 `RENDERER_ONLY`。状态：已修复。规避：状态机须有熔断（PARKED 永不自唤醒）。

**CAP-03｜快照前题注权威门缺失（首开唤醒竞态）**
时间：2026-08-24（`7dd6e7a`）。表现：rehydrate-empty/手动/设置应用/文档打开四来源 refresh intent 未合并，错过唤醒竞态。修复：`CaptionHeadingAuthorityGate` 状态机（`NO_DOCUMENT`/`WAITING_*`/`READY`）；`PendingCaptionRefreshIntent` 合并为单一 intent；canonical frame COMMIT 为唯一释放权威；subscribe-first + emitCurrent catch-up。状态：已修复（AUTH-1..6 等）。规避：多来源意图合并为单一 intent。

**CAP-04｜题注与代码体间隙塌陷（margin 折叠）**
时间：2026-09-29（V5.12-R8 A）。表现：代码题注→代码主体间距塌陷为 15px。根因：caption `margin:6px 0` 与主题 `.md-fences{margin-top:15px}` 相邻折叠。修复：scoped `margin-bottom:0` + `pre.md-fences{margin-top:3px}`，effectiveGap≈3px（真机 3.0000171661376953px）。状态：已验证。规避：禁止改全局 `pre/code/.md-fences`。

**CAP-05｜Figure 诊断未走 Source-First（token 语义未贯通）**
时间：2026-09-29（V5.12-R8 B/C/F）。表现：`FIGURE_MISSING_NAME` 点击只高亮 path（应高亮完整 token）；Typora 把 `![](a.png)` 渲染为多文本节点，单节点匹配必然失败。修复：source-first + `findTokenNodeRange`（拼接文本节点后回映）；本地缺失改 warning 只高亮 destination。状态：EXECUTED_PARTIAL（见 CAP-06）。规避：禁止 `line.indexOf('![')` / 正则猜 token / 第二套 parser。

**CAP-06｜重复资源诊断定位（occurrence 身份丢失）**
时间：2026-09-29（V5.12-R5）。表现：文档含两个相同图片时，两条诊断都高亮第一个 token。根因：source-range identity 在 inline Range 构建前被丢弃，resolver 退化为 first-text-match（`FIRST_DIVERGENCE_CHECKPOINT=C`）。修复：`SourceOccurrenceIdentity`（documentKey+sourceRevision+resourceKind+canonicalDestination+sourceStart+sourceEnd+occurrenceIndex）；多匹配无可验证 nth 时禁止 commit（`AMBIGUOUS_DUPLICATE_INLINE_RANGE`）。状态：已验证（same.png occ0/occ1 双 PASS）；`dup.png` occ1 单击 `ONE_CLICK_VISUAL_FAILED:ZERO_PAINTED_RECT` 未闭环。规避：宁可明确失败也不静默高亮第一处。

**CAP-07｜题注权威在拖拽/编辑后漂移**
时间：2026-08-24（`8a655ea`）、2026-08-24（`7dd6e7a`）。表现：`HEADING-CANONICAL-BINDING-DRIFT`；题注帧漂移。修复：canonical frame 单一集合 + 绑定漂移诊断。状态：已修复。规避：题注绑定以 canonical identity 为权威。

---

### 1.7 公式编号与渲染（FM）

**FM-01｜公式上下文排序错误 / 原生编号插槽探测不完整**
时间：2026-08-18（记忆 M-01）。表现：公式在文档切换/交错顺序下编号错乱；原生编号插槽 `NOT_FOUND`/`AMBIGUOUS` 时仍渲染。根因：依赖原始 DOM 顺序，缺少活跃文档门，原生编号结构性探测不完整。修复：引入 blockOrdinal/intraBlockOrdinal 文档块锚点、workspace active document 门、原生编号探测扩展至父/祖父元素与 `::before`/`::after`、`NOT_FOUND`/`AMBIGUOUS` 时硬屏障阻断。状态：静态通过，运行时未完成。规避：原生编号探测须含父/祖父与伪元素。

**FM-02｜native slot NOT_FOUND 错误阻断 managed eligibility**
时间：2026-08-18（记忆 M-04/M-62）。表现：`MATHJAX-RERENDER-GATE decision=SKIP reason=NO_MANAGED_FORMULA`。根因：`nativeSlot=NOT_FOUND → formula excluded → managedFormulas.length=0 → GATE SKIP`；nativeSlot 被错误用作 eligibility 条件。修复：eligibility 改为 `isInkChapterMode && hostConnected && sameEditorRoot && desiredTagReady`；`nativeSlotRequiredForEligibility=false`。状态：静态 PASS。规避：native 槽状态仅用于诊断计数。

**FM-03｜语义事件批量处理崩溃（R54_3）**
时间：2026-08-18（记忆 M-11）。表现：`R54_3_EVENT_DRIVEN_REFRESH_RUNTIME_CRASH`；`snapshotBefore=null` 误报 `FORMULA_ADDED`。根因：`onSemanticEventBatch` 中全局 `refresh()` 导致跨域刷新崩溃。修复：新建 formula-event-domain.ts / object-context-target-contract.ts；`checkDispatchContextGate` 阻止未就绪 dispatch；`DEFER_BASELINE` 防误报；移除全局 refresh。状态：PARTIAL。规避：禁止全局 refresh，按域 dispatch。

**FM-04｜新插入公式拿不到 InkChapter 编号（baseline 硬编码 false）**
时间：2026-08-18（记忆 M-12）。根因：`connectObserver` 硬编码 `baselineSnapshotAvailable: false`，未使用已有的 `lastLiveSemanticSnapshot`。修复：`formula-semantic-baseline.ts` 统一管理 Baseline；`hydrateBaselineFromLiveSnapshot`；`consecutiveDeferCount` 防永久 `DEFER_BASELINE`。状态：静态通过。规避：避免永久 DEFER，设连续 DEFER 上限。

**FM-05｜公式调用所有者冲突（错误编号 11.2.1）**
时间：2026-08-19（记忆 M-16）。表现：5.3 公式显示错误编号；Promise 结算关联丢失。根因：唯一源匹配未优先于编辑/聚焦公式；canonical host identity 未统一；在 Promise object 阶段 consume/reject 关联。修复：`FORMULA-NATURAL-CALL-OWNER-AUTHORITY`（uniqueSourceMatch > callerHost > editSession > fallback）；`INITIAL OPEN OWNER CONFLICT BARRIER`；`CORRELATION EARLY-CONSUME BARRIER`（仅 `.then(MJX-CONTAINER)` 结算）；`FormulaCompositeVisualOwner`。状态：DEPLOYMENT READY。规避：仅在 `.then(MJX-CONTAINER)` 结算关联。

**FM-06｜结构公式操作无持久投影事务 / 依赖边界未传播**
时间：2026-08-19（记忆 M-18/M-24）。表现：`SEMANTIC_DEPENDENCY_FRONTIER_NOT_PROPAGATED`；公式插入/删除/重排后编号不更新；假 CLEAN。修复：`formula-dependency-frontier.ts`；后缀失效；标题依赖边界（H1→文档末、H2→章末、H3→节末）；有序交错边界重投影；假 CLEAN 防护；`await allSettled` 后 Final。状态：DEPLOYMENT READY。规避：结构操作必须先算依赖边界再重投影。

**FM-07｜managed 空公式被 Typora 原生 (1)(2)(3) 占据**
时间：2026-08-19（记忆 M-19）。表现：空公式不占 sequence，Typora 原生编号接管。根因：zero-source `tex2svg` 走 normal source hash matching 失败后回退 `NONE`；plan catch-up 后 identity=null。修复：`EmptyStructuralRenderReservation`；`FORMULA-ZERO-SOURCE-SAME-CALL-REAUTHORIZATION`；`PendingEmptyProjection` 自动 replay；`MANAGED_FORMULA_VISUAL_FORMAT_INVARIANT`。状态：部署就绪待真机。规避：禁止用 CSS 隐藏原生 tag 再叠 overlay、禁止等待输入。

**FM-08｜并行公式权威 / 无唯一 committed state machine**
时间：2026-08-19（记忆 M-20）。表现：`PARALLEL_FORMULA_AUTHORITIES_WITHOUT_ONE_COMMITTED_STATE_MACHINE`。修复：`formula-state-store.ts`（唯一 `FormulaStateStore`/`CommittedFormulaDocumentState`）+ `formula-operation-closure.ts`；86+14 测试；stableIdentity 仅来自 structural slot + operation lineage。状态：静态通过。规避：单一 committed state machine。

**FM-09｜R5.4.3.16 生产接线导致公式编号退化（回归）**
时间：2026-08-19（记忆 M-22）。表现：接线后公式编号变回原生。根因：改替换了原公式编号逻辑；`FormulaStateStore` 带独立简化编号逻辑接管了业务。修复：恢复原有工作流水线，`FormulaStateStore` 降为并行诊断层不接管业务。状态：已修复（需重启重加载）。规避：诊断层不得接管业务逻辑。

**FM-10｜`formulaVisibleProjectionForensic` 对 SVG `className` 调用 `.slice()` 抛 TypeError**
时间：2026-08-23（记忆 M-38）。表现：`PHASE_7R_2_FORENSIC_RUNTIME_EXCEPTION`；只显示 Typora 原生 (1)(2)(3)(4)，投影从未执行。根因：遍历 MathJax SVG DOM 时对 `SVGElement.className`（`SVGAnimatedString`）调用 `.slice()`。修复：`safeElementClassName/safeTagName/safeText/safeAttr`（优先 `getAttribute('class')`）；取证只读+不抛+不阻塞（内部 try/catch，`FORENSIC_ERROR_IGNORED`）；取证移至 reconcile 之后 best-effort。状态：tsc PASS（1545 tests）。规避：取证代码必须 fail-open，不抛错、不阻塞业务。

**FM-11｜canonical host 解析错误（mjx 成自身 host，重复业务目标）**
时间：2026-08-23（记忆 M-39）。表现：重复业务目标、编号错乱。根因：旧 `resolveCanonicalHost()` 因中间层 `div.md-rawblock-container.md-math-container.math-jax-postprocess` 不匹配 `MATH_HOST_SELECTOR` 而停在 mjx 自身。修复：业务选择器改 `FORMULA_LOGICAL_HOST_SELECTOR='.md-math-block'`；`classifyFormulaHost` 加 `REJECT_RENDERER_OUTPUT`；`detectNativeNumber` 跳过装饰节点、mjx-tag 标记 unsafe。状态：静态 PASS。规避：MJX/SVG 只作投影节点，禁入业务 target/ordinal。

**FM-12｜transient plan 错误依赖 rendererReady → 首帧全部 defer**
时间：2026-08-23（记忆 M-40）。表现：首帧 `RENDERER_NOT_READY`、`REVISION_MISMATCH`，`verifiedSemanticCount=0`。根因：transient plan 创建错误依赖 rendererReady（plan 必须在渲染器存在前 ready）。修复：`arbitrate()` 不再以 rendererReady 门控 plan（inkchapter+semanticReady+documentCoherent 即可）；rendererReady 仅用于 post-render commit/verify。状态：静态 PASS。规避：plan 先于 renderer ready。

**FM-13｜MathJax hook 安装期闭包冻结 documentKey/revision**
时间：2026-08-23（记忆 M-41/M-68）。表现：跨 revision/文档切换出现 `REVISION_MISMATCH`/`DOCUMENT_MISMATCH`。根因：安装期闭包冻结 documentKey/revision（服务每次 refresh 传新闭包，但 `ensureMathJaxRenderInputHook` 的 `hookInstalled` 守卫只保留第一个）。修复：`SINGLE STABLE WRAPPER` 只装一次；每次 `tex2svgPromise`/`tex2svg` 调用重新 `getLiveContext()`（`contextSource=LIVE_PROVIDER`）。状态：静态 PASS。规避：hook 用稳定 wrapper + live context provider。

**FM-14｜快照 revision 漂移被误判失效**
时间：2026-08-23（记忆 M-42）。表现：同 doc/sourceHash/rawNumber/authority 的相同 plan 因 revision 漂移被判无效。修复：`REVISION_DRIFT_SEMANTIC_EQUIVALENT_ACCEPTED`；`DOCUMENT_MISMATCH` 永不放宽；one-shot recovery 预算 MAX 1/signature。状态：静态 PASS。规避：语义等价时接受 revision drift，文档不匹配永不放宽。

**FM-15｜可见公式校验非精确（substring 假阳性 / 陈旧 commit）**
时间：2026-08-23（记忆 M-45）。表现：期望 `1-1` 可被观测 `1.1-1` 通过。根因：可见校验使用非精确/陈旧匹配证据。修复：`extractVisibleFormulaTagTokens` 精确 token 匹配；`semanticCommitted` 需 exact token===currentRawNumber 且 `lastCommittedSignature===currentPlannedSignature`。状态：静态 PASS。规避：可见验证严格相等，禁 `text.includes(rawNumber)`。

**FM-16｜CRLF 文档行偏移漂移致公式误分类 / Source-DOM mismatch**
时间：2026-08-19（记忆 M-15）、2026-08-21（记忆 M-33/M-66）。表现：Markdown 源 `$$...$$` 未被识别（MathJax 未调用）；CRLF 文档每行偏移漂移 1 字节。根因：`line.length + 1` 计偏移未统一换行符。修复：改用 `buildLineStartOffsets()` 统一处理换行符；新增 `formula-source-dom-validator.ts`（`scanMarkdownFormulaBlocks` 拒绝行内 `$$`；匹配优先 `sourceHash` 再 `normalizedSource`，禁 `formulaIndex`/DOM 顺序，只读）。状态：已解决（`sourceCount=DOMCount=2`）。规避：行偏移统一按换行符处理；同一陷阱在 R5.4.3.8 与 R60.1.1 两次出现。

---

### 1.8 段落排版 / Enter / 空块事务（EN）

**EN-01｜force-indent 在 Normal Enter 后丢失（R36）**
时间：2026-08-09（`2af2f06`）。表现：强制缩进在回车后消失。修复：内存 override 注册表、每次 refresh 前 rehydrate、临时→稳定锚点自动提升、200ms 防抖 sidecar 写入 + 文档切换 flush。状态：已修复（423 tests）。规避：状态需在内存注册 + DOM 重水合双保险。

**EN-02｜Normal Enter Trace 干扰分类器 / Backspace 无法移除缩进（r37）**
时间：2026-08-10（`6827d87`）。表现：trace 干扰 classifier/refresh；Backspace 无法移除缩进。修复：normal-enter-trace 默认关且显式 opt-in；`identifyNode` 对任意 Node 安全（WeakMap）；`safeTrace` fail-open log-once；Backspace `onBackspaceCommand` pre-delete 拦截、force-indent 强制 flush。状态：已修复（488 tests）。规避：诊断 trace 默认关且 fail-open。

**EN-03｜段落缩进语义/视觉未分离（r37-r43）**
时间：2026-08-10（`b7bf6f4`）。修复：语义/视觉分离（r39）、`NONE/PREFIX/EXACT_TOKEN` 候选抑制（r41）、可见文本归一化剥离 ZWSP（r42）、取证探针默认关 fail-open（r43）。状态：已修复（529 tests）。规避：语义与视觉分管道。

**EN-04｜Enter 竞态（r44-r47）**
时间：2026-08-10（`b26113f`）。表现：`indentShortcutEnabled` 在持久化 store 缺 `globalParagraphLayout` 时 undefined→false（r46）；输入/组合/本地投影覆盖 `FORCE_INDENT`（r47）；caret 位于字符间也触发（r45）。修复：单 owner Enter 事务（keydown 唯一提交者，beforeinput 仅抑制）；`EnterIndentTransaction` T0-T4 快照 + JSONL 竞态 trace；`isCaretAtTokenEnd()` 守卫。状态：已验证（19/19 真实 GUI）。规避：单一提交者 + 快照 + JSONL 追踪竞态。

**EN-05｜诊断 tx-obs 生命周期未分离 / 锚点碰撞（r47-r49）**
时间：2026-08-10（`d86d4e1`）。修复：分离 tx-obs 生命周期、原子 rehydrate 语义+视觉、锚点碰撞守卫（`heading-numbering-service.ts +614`）。状态：已修复。规避：语义与视觉原子提交。

**EN-06｜rehydrate 首候选泄漏 / 陈旧段落非原子提交（r53）**
时间：2026-08-10（`3d4257d`）。根因：first-candidate leak；sidecar 路径不真实。修复：两遍 rehydrate（`RESOLVE ALL → GROUP OWNERSHIP → DECIDE → APPLY SAFE WINNERS`）；sidecar 落 `<vault>/.typora/inkchapter/paragraph-layout/`。状态：已修复（631/631）。规避：分组归属后再决策，禁止先到先得。

**EN-07｜sidecar vault 上下文 / 跨 realm caret / DOM handoff（r54）**
时间：2026-08-10（`629eec3`）。修复：生产 vault root 注入、仅锚点变化时保存、`ownerDocument.createRange` realm 安全、`CaretWriteResult` 拆分、`OneShotParagraphReplacementHandoff`。状态：已修复（639/639）。规避：跨 realm 操作使用目标文档的 `createRange`。

**EN-08｜全局文本偏移无法唯一标识空段落 caret（r56）**
时间：2026-08-11（`aa49e79`）。根因：全局文本偏移无法唯一标识空段落 caret（prev-text-paragraph-end、current-empty-start、连续空段落共享同一 offset）。修复：`placeCaretAtParagraphLogicalStart`（realm-safe，`selectNodeContents+collapse`）；caret 成功需 `sameAsCommandParagraph && localOffset===0`；全局偏移降级为诊断。状态：已修复（推翻 R55 设计）。规避：caret 身份用段落局部偏移，不用全局文本偏移。

**EN-09｜PERSISTED→PERSISTED 文档切换作用域权威（R58.7）**
时间：2026-08-13（`8061c66`）。修复：DS-1..DS-8 测试 + A1 自动化 runner。状态：已修复。规避：文档切换须验证作用域权威。

**EN-10｜EmptySpecial 连续性 + 事务原子提交（P0）**
时间：2026-08-15（`2fff549`）。表现：EmptySpecial 空填充视觉光标投影异常。修复：Phase-B 硬门 + 可观测性 + JSONL 时间戳；失败事务原子提交/回滚。状态：已修复。规避：失败事务必须原子回滚。

**EN-11｜一次真实 Enter 出现两次 `SPLIT_1_TO_2`（文末 EOF，2026-10-18 已闭环）**
时间：2026-10-12（`ENTER-*` 系列证据，会话 `NENTER-1..3`、`runtime-sess-*`）。表现：文末一次 Enter 产生两次 `SPLIT_1_TO_2`，源码净增 +4 LF（多一整条空行）；C0 原生（插件禁用）+2 LF/1 split，C4 墨章 +4 LF/2 split。根因演进：初判"Typora 原生尾块重归一化、插件结构写入=0" → 后经宽域 tracer 与 provenance 审计推翻（`pluginStructuralWriteCount=4`，来自提交期 paint-layer 验收 dry-run 探针插入）→ 关闭探针后正文中部场景消失，但**文末场景仍存在**且新 trace 显示回声窗口内**无插件结构写入** → 归因修正为 `UNKNOWN`，怀疑 Enter keydown 事件链干预（使 Typora `pressReturn` 序列执行两次）。修复（进行中）：① 归因仪器修正（`firstFrames(4)`、`classifyWriteOrigin`、`truncated`）；② 回声窗口（真实 Enter 后 250ms）内禁止插件向 `#write` 做结构写入（`isContentDocumentWriteHoldActive`）；③ R2 生产默认彻底关闭 DOM 修改型验收探针（`blankRowAcceptanceDryRunEnabled=false`）；④ `SAME_ENTER_SCENE_IDEMPOTENT` 事务合并（仅保证诊断提交幂等）。状态：**已闭环**（构建 `B68D5041…`）：展示层由 `#write` 末尾改为**首子节点**（`insertBefore(layer, host.firstChild)`）后，16 次物理 Enter 全部 `ALLOW_NORMAL_ENTER`、`ENTER-DUPLICATE-SPLIT-AFTER-FINAL=0`、每次可见空行 +1；`EN11_LAYER_PLACEMENT_FIX=PASS` / `EN11_REAL_RUNTIME=PASS`。残余：未在同一会话执行 C0 配对（跨构建对照 + 用户目视确认）。规避：禁止用 debounce/coalesce/忽略第二个 Mutation batch 掩盖；禁止把 `+2 LF` 当原生正常；`recordCount=0` 不能推断"全 DOM 无写入"。

---

### 1.9 文档诊断 · 检测规则与口径（DG）

**DG-01｜空白 Markdown 仍产出严格 H1 等错误（空文档未短路）**
时间：2026-09-29（V5.12-R6）。表现：空白文档被识别为空却仍产生 STRICT H1 缺失/H1 首行/连续性等错误与警告。根因：缺少 terminal short-circuit。修复：`computeDocumentDiagnostics` 顶部短路 `isSemanticallyEmptyDocument` → 仅返回 `[DOCUMENT_EMPTY]` + 声明式 `nonLocatableNotice`。状态：已验证。规避：禁止在 UI 层隐藏诊断或以 ruleId 黑名单冒充。

**DG-02｜代码块空块专用实现（V6/V7/V8）不通用**
时间：2026-10-05（`ced138e`）。修复：`CODE_EMPTY_BLOCK` 并入通用 Code Diagnostic 管线，删除专用实现。状态：已修复。规避：诊断走统一管线，禁止为单规则写专用实现。

**DG-03｜诊断域混用（document 与 runtime 未分离）**
时间：2026-10-02（`6e1a3f2`）。表现：用户 Drawer 可能显示/统计 runtime 类问题。根因：缺单一域权威，组件各持黑白名单。修复：`diagnostic-domain-v1.ts`（`selectDocumentDiagnostics`/`selectRuntimeDiagnostics`/`countDocumentSeverities`）；`makeDiagnostic` 统一 stamp `domain:'document'`；规则域映射未注册即 null。状态：已验证（15/15；真机 RUNTIME_IDENTITY/STRUCTURE PASS）。规避：诊断分域，单一域权威。

**DG-04｜Hint 视觉语义缺失（info Hint 复用 Warning token）**
时间：2026-10-02（`4376a7a`）。表现：info Hint 复用 amber Warning token（看起来像 Warning）；document-level 诊断在 passive/active 都画 body 原因 chip。根因 A：活跃标题视觉把非 error 一律折入 Warning 类；根因 B：原因 chip 由 `buildHeadingLocateReason` 无 scope 决策构建。修复：`mergeHeadingMarkerSeverity` 单一路由；新增 `--ink-diagnostic-hint-*` 冷灰蓝 token；`shouldRenderReasonChip(diagnostic)`（按 presentation metadata，禁按 severity 隐藏）。状态：已验证（真机三色分离）。规避：严重级配色由 token 单一权威，不用折入式映射。

**DG-05｜诊断实时更新失效（内容指纹对数量失明）**
时间：2026-10-11（`eef4764`）。表现：3→5 个空行编辑产生相同指纹 → 提前 NOOP → 快照不发布，Drawer/计数/标签保持旧值。根因：`DocumentDiagnosticsAuthority.recompute` 指纹只含 `severity:code:targetIdentity`；`locateCommittedBlockGapInputs` 喂入点击时旧诊断；`hasDiagnosticGeometryToReconcile()` 不含 block-gap 带。修复：`diagnosticFactSuffix()` 把数量事实折入指纹；`liveDiagnosticFor(id)`/`rebindActiveVisualToLiveDiagnostic()`/`recommitActiveBlockGapVisual()`；`hasDiagnosticGeometryToReconcile()` 纳入 block-gap 带；`DOCUMENT-DIAGNOSTIC-BLANK-VISUAL-CONSISTENCY` 审计。状态：已修复（4376 pass）。规避：诊断指纹必须包含"事实后缀"（数量等），否则更新被 NOOP 吞掉。

**DG-06｜内部空行诊断以源码计数判决（应为可视空行数）**
时间：2026-10-11（`cb7241f`、`160ae53`、`b038d31`）。表现：1 个可视空行被误判；Drawer 旧"结构签名"只记 `detail.length`，2→4 同长度变化被误判为 `ACTIVE_PATCH`，Drawer 文字不刷新；标签显示"4 空行"而 Typora 只画 1 个可视空行。根因：同一处空行把四个应分离的计数（源码空行/可视空行行带/渲染行/片段）两两混用。修复：新增 `visibleBlankLineCount`（`countVisibleBlankLineBands`，重叠行合并、1px 容差）；`<=1` 不发布、`>=2` 发布；Active 标签改用可视数；Drawer 文案标注"源码中存在 N 个连续空行"；Drawer 更新拆 `ACTIVE_PATCH`/`CONTENT_UPDATE`/`STRUCTURAL_UPDATE`。状态：已修复（4408 pass）。规避：计数轴单一化，视觉层不得重算数量。

**DG-07｜Active 数量标签口径与规则/Drawer 不一致**
时间：2026-10-11（`b038d31`）。表现：gap1 源码 9 空行、渲染行数很少，标签显示"1 空行"却挂 warning，Drawer 写"9 个连续空行"。根因：Active 数量标签用渲染空段落数，规则与 Drawer 用源码空行数。修复：标签改用诊断自身源码计数 `actualBlankLines`；门禁收紧 `ACTIVE_LABEL==DIAGNOSTIC==DRAWER`；按完整 `diagnosticId` 多实例隔离回归。状态：已修复（4380 pass）。规避：同一诊断的数量在多视图必须同源。

**DG-08｜Source-Syntax 诊断 Source→DOM 投影未分离**
时间：2026-10-05（`00809e4`、`2be7d33`）。表现：源码与 DOM 位置/呈现未分离。修复：Source-Syntax Source→DOM 投影 + Location/Presentation/Visual 分离；三套共享 source authority 单一解析（每 source revision 各 ≤1 次）；代码围栏/公式块/Front Matter 内的 Markdown 不产生下游误报。状态：已修复。规避：源码级 hygiene 不走诊断 DOM。

**DG-09｜诊断能力矩阵缺口（Phase A–G 收口）**
时间：2026-10-04（`9728803`、`2319bc4`、`2d38028`、`5381aae`、`91041a1`、`4d2af93`、`02f190c` 等）。表现：能力矩阵存在缺口；内部空行策略口径不唯一；Target Group 展开成多行显示 1/N 徽标（`ACTIVE_TARGET_COUNT_NOT_ONE`）。修复：能力矩阵 + Gap Closure（Phase A–G）、空白警告呈现策略 V1、单一 `InternalBlankLinePolicy`、Target Group 单行 Drawer 收口。状态：已修复（部分 PARTIAL）。规避：规则清单改动后须重跑 `generate-capability-matrix.mjs`。

---

### 1.10 文档诊断 · 视觉几何与定位（DV）

**DV-01｜exact inline Range 走私有 viewport 渲染路径导致滚动漂移**
时间：2026-09-29（V5.12-R4）。表现：painted marker 显示 `deltaTop≈scrollWriteDistance`（约 12.8px 下移）；document-space 审计报 `documentLocalInlineRects=[]`。根因：私有 viewport 路径只在 `commit()` 度量一次，滚动后不重测。修复：`Range.getClientRects()`→逐可视行片段→单一 `viewportRectToDocumentLocalRect`→挂入同一 `.inkchapter-locate-document-layer`；commit 时释放 viewport 载体；`invalidateInlineGeometry()`/`remeasureInlineGeometry()`。状态：已验证（maxPositionDrift≤0.675px）。规避：坐标统一 document-local；禁第二套 helper、禁手动 ±scrollTop。

**DV-02｜Active 定位视觉来源混乱（竖线+横线+边框）**
时间：2026-09-29（V5.12-R7）。根因：`ACTIVE_LOCATE_LINE_SOURCE='MIXED'`（BORDER/PSEUDO_ELEMENT/KEYLINE 渐变/CHILD_ELEMENT/无 SVG）。修复：统一 FILL_ONLY（无竖线/横线/border/outline/keyline/角臂）。状态：已验证（真机 fillCount=2，线计数=0）。规避：禁 `opacity:0` 留 DOM 冒充删除。

**DV-03｜文末过量空行诊断无可绘制目标（EOF target 缺失）**
时间：2026-09-29（V5.13-R1）。表现：`document-end` 能 GO_BOTTOM 但 `targetKind=null/targetRect=null` → `fillCount=0` → `FAIL_VISUAL`。修复：合成 EOF document-space target。状态：已验证。规避：不用 native padding 冒充、不用 viewport 坐标。

**DV-04｜EOF 带左边界与正文文字列不对齐**
时间：2026-09-29（V5.13-R3）。根因：缺 document 级文字列锚点。修复：`DocumentLayoutAnchors`（优先级 `EDITOR_TEXT_COLUMN→TOP_LEVEL_PROSE→STABLE_CACHED_PROSE→CONTENT_LEFT_FALLBACK`）；`pickDocumentTextColumnLeft` + `isTextColumnCandidate`（禁由 `lastMeaningfulRect`/语义区/选中块推导）。状态：已验证。规避：深缩进块永不拖动锚点。

**DV-05｜EOF 视觉被压成固定提示条 / 计数少一行**
时间：2026-09-29（V5.13-R4）。根因：`computeEofPresentationHeight` 把 marker 压成固定 28~48px；painted carrier `Math.round` 成 302px 而 zone 302.4px → floor 计数少 1 行。修复：presentation band 即 excessive blank zone、废除固定上限、`≤1px` 漂移容差。状态：已验证。规避：禁用整行误删、禁固定上限映射。

**DV-06｜EOF 几何反推/宽泛过滤器/line-height 污染/Multi-H1 合并**
时间：2026-09-29（V5.13-R5）。根因（多因）：① EOF 高用 `extraTrailingBlankLineCount × lineHeight` 反推；② `isInkChapterOverlayNode`（`includes('inkchapter')`）过宽致真实 Typora 块全被跳过；③ line-height 探测命中文档首个 `<h1>`（43.2px 污染）；④ null baseline 反推出巨大 zone；Multi-H1 因 `collectHeadingMarkerGroups` 用诊断的 `stableIdentity`（恒为第一个多余 H1）致两组合并。修复：窄 `isInkChapterAccessoryNode` + `measureTrailingBlankGeometry` 实测、非空无基线 `FAIL_CLOSED`、marker identity 由目标自身派生。状态：已验证（8 项 gate 全 0）。规避：禁以 extra×猜测行高反推几何；禁宽泛 `includes` 过滤。

**DV-07｜Drawer 排序：源码偏移量与行号混用同一有序 key**
时间：2026-09-30（V5.14-R1 P9）。表现：`sourceStartOffset` 1200 排到 line 2 之前。根因：把源码偏移量与行号混入一个有序 key 不成立。修复：`sourceStartOffset` 仅作记录事实，统一排序单位 `sourceLine*1000+sourceColumn`；`DiagnosticTargetProjection` + 位置排序。状态：已验证（真机 3 条单调 PASS）。规避：排序键单位必须唯一。

**DV-08｜heading fill/chip 缺单一快照权威 + 编号翻转不失效几何**
时间：2026-09-30（V5.14-R1 P4/P5）。根因：P4 正文 fill 与 reason chip 无承载 `{stableHeadingIdentity, layoutEpoch}` 的单一 authority；P5 `headingNumberRect()` 在编号属性打上前恒返回 null，同事务 `numberRectIncluded` `false→true` 而旧 chip 几何从不失效。修复：`HeadingDiagnosticVisualSnapshot`，翻转时移除旧 chip 并重建一次。状态：已验证（`numberRectFlipRebuilt=true` 真机未达成，仅单测）。规避：快照仅在文档切换时清空。

**DV-09｜标题编号 band 与文本 band 混用（chip 被拖远 ~213px）**
时间：2026-09-30（V5.14-R2 P5-R2）。根因：① band 判定用 `overlap>0` 不安全（真机 0.8px 重叠把远右编号误判为 SUFFIX）；② `lastTextRect` 取"最右 fragment"（多行标题应避开最后一行）。修复：改为"重叠 ≥ 较小 rect 高度 50%" + `lastVisibleLineTextRect`。状态：已验证（8 项 gate=0）。规避：编号 gutter 与末行文本 band 不可混用。

**DV-10｜视觉闭合对账口径错误（假 FAIL / 假 PASS）**
时间：2026-09-30（V5.14-R2 P6）。根因：旧闭环比较 `expanded target count` vs `resolver admitted count`，从不看实际画出的 marker（resolver 未 admit 但 marker 存在=假 FAIL；admit 但未画=假 PASS）。修复：以真实 DOM passive marker 逐 target 对账（唯一 key）。状态：已验证（8 项 gate=0）。规避：禁以 resolver admitted 数代理真实视觉。

**DV-11｜`apply` 前无 settle 门导致瞬态错配帧进入 UI**
时间：2026-09-30（V5.14-R2 P7）。根因：旧时序 `compute→apply→post-verify→RETRY`；`cardinalityFail` 只作审计非提交门禁。修复：`evaluateOutlinePrecommitGate`，未 settle → `WAITING_OUTLINE_SETTLE` 且 `DOM_WRITE_COUNT=0`。状态：已验证（8 项 gate=0）。规避：禁"先 apply 再 verify"。

**DV-12｜业务根/locate layer 重建后 passive wrapper 变孤儿**
时间：2026-09-30（V5.14-R3 P10）。表现：取证 `passiveMarkersAfterLayerRebuild:0`，屏幕只剩 Active。根因：未校验 wrapper 挂载 + R9"active 时挂起 passive fill"错误策略。修复：孤儿重挂 + 删除挂起 + 双 authority 契约。状态：已验证（9 gate=0）。规避：`activeVisualTargetKey ∈ passiveVisualTargetKeys`。

**DV-13｜`stableHeadingIdentity` 相同被误当几何有效（标题缩短不重测）**
时间：2026-09-30（V5.14-R3 P11）。表现：标题缩短后 `fillWidth 220→220` 完全没重测。根因：缺内容指纹。修复：`HeadingVisualRevisionKey` + `computeHeadingContentFingerprint`，指纹变化→重测一次。状态：已验证（fillWidth 220→80）。规避：几何有效 ≠ 身份相同。

**DV-14｜active fill 复用 passive token 且更淡**
时间：2026-09-30（V5.14-R3 P12）。根因：active 复用 passive token 且 alpha 更低（7% vs 9%/10%），ratio 0.78。修复：独立 token 阶，ratio error 2.667 / warning 2.923（≥2.4）。状态：已验证。规避：active fill 只用 active token。

**DV-15｜定位提交顺序错误（Drawer 恢复早于 locate commit）**
时间：2026-09-29（V5.12-R9 / V5.13）。表现：真实 README.md 点击 `CODE_MISSING_NAME` 本已成功定位却被追溯判为 FAIL——Drawer 恢复发生在 locate commit 之前，插件 DOM 变更使 `drawerPresentationMode` 重切、面板相交判定使已提交定位转 FAIL。修复：强制顺序 `resolve→collapse→settle→remeasure→paint→verify→COMMIT LOCATE→restore drawer`；`LocateFinalGeometrySnapshot`；区分 `PANEL_OVERLAY_OCCLUSION`（非致命）与 `GEOMETRY_CLIPPED_BY_PANEL`（致命）。状态：已验证（24 项 gate 全 0）。规避：禁 restore 早于 locate commit。

**DV-16｜Active 代码块标记重复且不随滚动（viewport 帧残留 + Secondary 未重测）**
时间：2026-10-（`R02-R05` §12，`ROOT_ACTIVE_DUP_CARRIER`）。表现：激活 `CODE_MISSING_LANGUAGE` 后拖拽侧栏出现第二枚标记（viewport-fixed 不随滚动）；Secondary 几何陈旧（宽 800）。根因：`commitDiagnosticLocateVisual` 布局重测时重新挂载 pre-commit viewport 帧，且无 `releaseViewportCarrier()`；`reconcileLocateDocumentSpace` 只重投影 `primaryLocal`，从不重测 `secondaryLocal`。修复：布局变化后释放 viewport 帧（doc-space 载体为唯一可见所有者）；按同一 epoch 重投影 Secondary；新增 `locateViewportFrameLingeringAfterCommit` 门禁。状态：red→green 验证（`strayViewportFrames()` 1→0）；真机像素 PENDING。规避：`frameCount=1 / staleLocateFrameCount=0` 不能作为"无重复"证据。

**DV-17｜复合题注高亮拖拽后丢失（载体塌缩到代码主体）**
时间：2026-10-（`R02-R05` §13，`ROOT_COMPOUND_CAPTION_COVERAGE`）。表现：拖拽后载体由"题注∪主体"塌缩为代码主体，题注高亮丢失（h=206→181）。根因：`reconcileLocateDocumentSpace` 用 `frame.getAnchorElement()`（代码主体）重定位并硬编码 pad=2，而提交期载体是 `frame.getFrameElement()`（题注∪主体）。修复：提交时记录 `edgePad`（复合目标 top 为负=题注高度）与题注元素；reconcile 用同一关系 + LIVE 锚点重求导；新增 `captionCoveredByCarrier`/`carrierEdgePad`/`compoundCaptionUncoveredAfterReconcile`（增量判定）。状态：red→green（46px→≤4px）；真机 PENDING。规避：提交期与重投影期必须用同一载体关系。

**DV-18｜EOF 带右缘用 `#write` 边框盒致右溢 ~29.6px**
时间：2026-10-（`R02-R05` §11）。表现：尾带左缘用正文文本列左缘、右缘用 `#write` 边框盒右缘，右侧多伸出约 29.6px，左右不对称。根因：`computeSyntheticEofGeometry` 的 `right = content.right`；`measureSemanticContentColumnRect()` 取 `#write` 边框盒。修复：改取 `#write` 内容盒（边框盒水平减 border+padding 再裁剪）；EOF 尾带、块间空行带、EOF live 对照共用此一处权威。状态：已验证（新增回归用例，#write=[50,850]，尾带 [60,820] 宽 760）；像素 PENDING。规避：水平权威统一用内容盒，块间带与尾带共享单一权威。

---

### 1.11 活动文档 / 工作区 / 启动（AW）

**AW-01｜活动文档判定陈旧**
时间：2026-09-08（`c5c1d91`）。表现：No-Active V1 / Rendered-Visibility V2 / Close-Last-Tab Active-Leaf V3 系列。修复：`active leaf state.path` 最高权威；`ACTIVE/EMPTY/UNKNOWN` 纯决策；空硬否决陈旧 activeFile/documentKey；仅 UNKNOWN 走 legacy fallback；真实 `active-leaf:change` + `tab:toggle` 触发。状态：R1/R2 真机 PASS；R3 因 Typora 关最后标签即关窗挂起（环境阻塞）。规避：见 AW-02。

**AW-02｜空工作区 surface 权威错误 / 初始诊断竞态 / 真实双击**
时间：2026-09-08（`1acb345`）。根因：BUG-1 Empty surface 误用 stale 的 `#write`（`STALE_MARKDOWN_SURFACE_SELECTED_FOR_EMPTY`）；BUG-2 首开未主动 reconcile。修复：EMPTY 表面来自 active leaf view container（`isConnected` 且 `belongsToActiveLeaf`）；capture 阶段 dblclick + 真实事件收据 + 明确拒绝原因；单一 `reconcileActiveDocument` + `ActiveDocumentReadiness` 屏障（`INACTIVE`/`WAITING_*`/`READY`/`STALE`）。状态：部分真机 PASS；真实 OS 双击创建 `BLOCKED_BY_GUI_TOOLING`。规避：禁 document/body 全局 dblclick。

**AW-03｜Close-Last-Tab 空 leaf 未闭环**
时间：2026-09-08（`c5c1d91` V3）。表现：真实"关闭最后标签→应用内空 leaf"受环境阻塞（该 Typora 构建关最后标签即关窗）。修复：`activeLeaf.state.path` 权威 + `EXPLICIT EMPTY` 硬否决 stale `activeFile`。状态：PENDING（环境阻塞）。规避：不用 synthetic close 冒充。

**AW-04｜Problems 投影单链与启动快照 split-brain（BUG-A/B/C）**
时间：2026-09-08（`b848548`）。表现：V4 `EMPTY→ACTIVE` 呈现需重算、`suppressed→full` 需 auto replay、severity 须按 `data-severity` 而非位置映射；V5 启动恢复 split-brain（`PENDING_ACTIVE_LEAF`）、reconcile 在 producer NOOP 时仍需直接准入、ADMITTED/ALREADY_ADMITTED 消费去重。修复：`DiagnosticsSnapshot→deriveDocumentProblemsProjection→CurrentProblemsProjection` 单链；单一 `admitDiagnosticsSnapshot` 消费门（`docKey+epoch+revision+sourceRevision` 去重）。状态：STARTUP-RESTORE-1..5；真机首开 Generic 0E/3W 三态一致。规避：producer 与 consumer 准入分离，禁止混为一体。

**AW-05｜启动首开只显示"文档检测"（split-brain）**
时间：2026-09-30（Startup Snapshot Admission V5）。表现：Typora 启动已恢复文档但 Problems Control 只显示「文档检测」，须切文档再切回才出现。根因：Producer dedupe 与 Consumer admission 混为一体。修复：`admitDiagnosticsSnapshot` 消费准入 + `PENDING_ACTIVE_LEAF` + `STARTUP_ACTIVE_BARRIER`。状态：PARTIAL（invariant 名 + barrier 未落地；真机验收无记录）。规避：区分真 EMPTY 与 restore pending。

**AW-06｜诊断被动高亮跨文档泄漏 / 快照模式一致性**
时间：2026-09-14 前后（V5.12-R2/R3）。表现：`FAIL_STALE_DIAGNOSTIC_SNAPSHOT`（`SNAPSHOT_MODE_DIVERGED_FROM_EFFECTIVE`，初始加载瞬间 diagnostic snapshot 未建立 → mode `""≠"strict"`）在近两百个历史 audit 会话普遍出现；严格/宽松切换后 UI 保留旧快照（`revision=11/error=4/warning=9`）。根因：旧 `diagnosticsMode` 不能证明"已发布 snapshot 由何 mode 生成"→ 旧 CONTROL-SURFACE-INVARIANT 属 false PASS。修复：`effectiveMode`+`effectiveModeRevision` 纳入 snapshot dependency/revision/fingerprint/publish；硬性等式 `LATEST_EFFECTIVE_MODE==PUBLISHED_DIAGNOSTIC_SNAPSHOT_MODE`。状态：已修复（代码级）；`FAIL_STALE_DIAGNOSTIC_SNAPSHOT` 属非本轮引入、未修。规避：内容不变 + 模式变化 = 语义变化 = 必须重发快照。

---

### 1.12 设置页与 UI 视觉（UI）

**UI-01｜打开设置页误报未保存更改**
时间：2026-08-05（`0788d86`）。根因：`headingDraft != null` 被当 dirty，但 `renderCustomEditorCard` 在 preset=custom 时初始化它。修复：`isEditing` 仅当 `selectedFormatId` 设置时 true。状态：已修复。规避：dirty 判据须以真实编辑意图为门。

**UI-02｜设置页布局挤压 / 格式内容折叠 / 三标签合并**
时间：2026-08-05 ~ 08-07（`45c7ed2`、`9b4df84`、`3572c82`、`440e6a8`、`07292cc`）。表现：设置页布局拥挤；格式内容区折叠不合预期；三标签需合并为单层级配置页。修复：卡片化分区 + 紧凑间距；移除折叠；合并为单页 + 响应式 CSS grid；标题布局改 settings-matrix + document-preview。状态：已修复。规避：视觉改版后须人工验收（`SETTINGS_LAYOUT_VISUAL=PENDING_USER_MANUAL_CHECK`）。

**UI-03｜应用格式后未立即显示格式内容设置 / 全局默认格式无法独立应用**
时间：2026-08-07（`29eada6`、`d790291`）。修复：`applyPresetToScope` 同步 `selectedFormatRef`；移除 `isGlobalDefault` catch-all 分支。状态：已修复（90/90）。规避：应用后视图状态同步。

**UI-04｜主强调/被动高亮/标签几何在滚动与宽度变化下漂移（V3/V5.4/V5.6/V5.7）**
时间：2026-09-09（`a8838ce`）。表现：复杂块定位矩形、heading 全宽带、stale 帧；拖动/缩放后标记漂移。修复：单一 `.inkchapter-diagnostic-locate-frame` overlay（禁第二 overlay、禁 body-DOM 绘制）；heading 紧凑 2px severity 指示；inline 精确 severity mark；wash≤2%/`frameCount≤1`/stale=0；事件驱动重定位 + 生命周期清理。状态：+23 targeted tests；真机数值部分 PASS（24 次 reconcile 0 FAIL），像素 PENDING。规避：单一 overlay 载体，事件驱动，禁每帧重建。

**UI-05｜标签滚动条作用到错误 owner / 分隔线与主题层级不一致**
时间：2026-10-01（`442b5a2`、`0625911`、`8314751`）。修复：滚动条重定向到真实 owner + 修正 hover scope（V5/V5.1）；匹配侧栏权威 + 2px 内部内缩（V5.2/V5.3）；区域分隔线/滚动条精修（V1→V4.1）。状态：已修复。规避：选择器作用域精确到真实 owner。

**UI-06｜响应式导航/工具栏/诊断抽屉视觉未验收（Phase 2B/2C）**
时间：2026-09-06 ~ 09-07（`6b3cf21`、`48f6c5f`、`37c14f3`）。表现：esc listener 泄漏（已修）；`RESPONSIVE_NAV_VISUAL`/`RESPONSIVE_TOOLBAR_VISUAL`/`RESPONSIVE_DIAGNOSTICS_VISUAL`/`SETTINGS_LAYOUT_VISUAL`/`DARK_THEME_VISUAL` 全部 `PENDING_USER_MANUAL_CHECK`；UI Phase 2D+ 阻塞于 2C 视觉验收。状态：PENDING。规避：未执行/未验收不得写 PASS 占位。

---

### 1.13 部署 / 运行时身份（DP）

**DP-01｜"启动命令成功 ≠ Typora 已成功启动"（假闭环）**
时间：2026-08-11（R59，`runtime-verification.md`）。表现：历史上出现过假闭环。修复：严格 15 项验证（`all15Passed=true`）+ Gate0–5（任一 FAIL → HARD STOP）；禁止硬编码 `6. vault: test/vault`、禁止只信 `runtime-load.json` 自报 hash、禁止重复 project hash 当 runtime hash、禁止错误路径 `test\vault.typora`。状态：纪律固化。规避：真实 `Get-FileHash` + 真实 vault 证据。

**DP-02｜部署产物陈旧但无法报告（SHA 比较错误）**
时间：2026-10-02（`61d2206`）。见 LC-08。状态：已修复。规避：比较两个不同来源。

**DP-03｜运行时身份/结构校验缺失（RUNTIME-IDENTITY / STRUCTURE）**
时间：2026-10-02（`6e1a3f2`）。表现：缺运行时身份与结构门禁。修复：`RUNTIME-IDENTITY-FINAL`（15 项验证）+ 全局加载路径权威 + 单实例结构硬门禁（`toolbarCount=1`/`navigatorCount=1`/`drawerCount≤1`/settings root=1）。状态：真机 PASS。规避：结构单实例门禁防重复 mount/残留 listener。

**DP-04｜history 文档基线陈旧（README 与实际构建不一致）**
时间：当前（`README.zh-CN.md`）。表现：`README.zh-CN.md` 记录基线 `d8aca1f6…`（BuildId v26），与实际 archive 分支/v5.15 系列不一致。修复：标记为陈旧待同步（未修）。状态：待处理。规避：README 基线须与真实构建对齐。

---

### 1.14 文档 / 流程 / 审计工具类（TO）

**TO-01｜提示词体系膨胀与技术债**
时间：2026-10-05（`prompt-consolidation-record.md`）。表现：多轮 V1/V2/V3 修复同一缺陷的提示词；`PROMPT_TOTAL_COUNT=114`、`SUPERSEDED=27`、`REQUIREMENT_TO_ROADMAP=25`。修复：整合进正式模块/架构/运维文档；删除 114 个过时提示词；二次清理 19 个遗留提示词。状态：已清理。规避：一次性任务结论进正式文档，不另存任务正文。

**TO-02｜PROGRESS-ARCHIVE 整文件覆盖/截断风险**
时间：2026-10-09。根因：非 append-only。修复：append-only + sha256 校验 + 原子写（temp+rename）+ 写前校验。状态：已验证（ENTRY 单调、字节不变、哈希一致）。规避：归档文件 append-only，既有字节永不被改写。

**TO-03｜受跟踪回归目录内残留一次性 P0 提示词正文**
时间：2026-10-05 / 2026-10-11。表现：`test/vault/regression/r58/trae-p0-r58-7-strict-startup-fresh03-formal-clean-r0-gate.md` 内容是一次性提示词，但位于受保护回归目录。修复：受"不修改 test/fixtures"约束未删除；登记为 OPEN。状态：未解决（OPEN）。规避：若允许清理 fixtures 须按 Prompt 处理并登记。

**TO-04｜提示词正文误置 smoke 目录致 caption 边车成孤儿**
时间：2026-10-01。表现：两份提示词正文误置于 `test/vault/runtime/smoke/`，归位并删除后，对应运行期 caption 边车（`runtime_smoke_*.md.json`）成孤儿未清理。修复：已登记遗留。状态：未清理。规避：删除 fixture 时须同步清理派生边车。

**TO-05｜文档存储不受 Git 跟踪**
时间：长期。表现：`docs/` 不受 Git 跟踪，需外部快照（`_prompt-backups\`）。修复：纪律固化。状态：约束。规避：文档变更需外部快照。

---

## 2. 时间线索引（按月 → 条目编号）

- **2026-07-20 ~ 07-31**：HN-01、HN-02、HN-12、HN-13、HN-15、HN-17、HL-01、HL-02、OL-01、OL-02、BU-01。
- **2026-08-01 ~ 08-16**：HN-03、HN-04、HN-05、HN-06、HN-07、HN-08、HN-09、HN-11、HL-03、HL-04、HL-05、HL-06、HL-07、HL-08、HL-09、OL-03(前身)、OL-06、EN-01、EN-02、EN-03、EN-04、EN-05、EN-06、EN-07、EN-08、EN-09、EN-10、UI-01、UI-02、UI-03、LC-02、BU-12。
- **2026-08-17 ~ 08-26**：LC-06(前期)、OL-03、CA-01、CAP-01、CAP-02、CAP-03、CAP-07、FM-01、FM-02、FM-03、FM-04、FM-05、FM-06、FM-07、FM-08、FM-09、FM-16(前期)、HN-10、BU-04。
- **2026-09-06 ~ 09-14**：UI-04、UI-06、AW-01、AW-02、AW-03、AW-04、AW-06、OL-04、OL-05。
- **2026-09-28 ~ 10-04**：CAP-04、CAP-05、CAP-06、DG-01、DG-08、DG-09、DV-01~DV-15、AW-05、LC-09、DG-03、DG-04、DP-02、DP-03、BU-10。
- **2026-10-05 ~ 10-12**：DG-02、DG-05、DG-06、DG-07、DV-16、DV-17、DV-18、EN-11、LC-01、LC-03、BU-06、BU-13、BU-14、TO-01、TO-02、TO-03、TO-04、DP-04。

---

## 3. 同类问题规避方案总结（经验库）

> 从上述 112 条问题中提炼的**可复用规避经验**，按主题归类。

### 3.1 宿主（Typora）运行时不可靠项
1. `Node.DOCUMENT_POSITION_*` 在 Typora 打包运行时**解析为 `undefined`** → 一律使用本地字面量常量（1/2/4/8/16）。此陷阱在 `heading-numbering-service.ts` 与 `document-utility-overlay-host.ts` **两次**踩坑（HN/EN-11/记忆 M-46）。
2. `execCommand` 不可靠、`textContent=` 会破坏内联 `<span>` → 只定位含 token 的文本节点做子串替换。
3. `contenteditable` 会被 `frame.js` 在 focus/busy 路径重新置为 `true` → 只读软锁改用可逆的捕获阶段事件守卫。
4. Typora 编辑区不暴露给 Windows UI Automation；合成键盘/滚轮事件不可靠；行激活需 **trusted pointerdown** → 视觉/交互验收只能人工（`PENDING_USER_RUNTIME`）。
5. 对 SVG 元素 `className` 是 `SVGAnimatedString`，不可直接 `.slice()` → 统一 `safeElementClassName`（优先 `getAttribute('class')`）。

### 3.2 写入归因与取证
1. **包装栈在 `main.js` ≠ 插件是写入者** → 取"首个真实外部业务帧"归因（`typora://` = 原生；业务 `main.js` = 插件）。
2. 取证器必须**有界**（窗口内、条数上限、显式 `truncated`）、**fail-open**（不抛错、不阻塞业务）、**对测试环境解耦**（缺失证据目录即 no-op）。
3. 单一仪器结论必须**第二独立证据源交叉验证**；`recordCount=0` 不能推断"全 DOM 无写入"（覆盖有限）。
4. 时间接近 ≠ 因果；确认性结论须同一因果 token 闭环证明。

### 3.3 状态 / 竞态 / 原子性
1. 陈旧判定一律用**单调纪元**（`userIntentEpoch` / `headingStructureEpochValue` / `documentLayoutEpoch`），并丢弃 `STALE_*`。
2. 关键写入用**租约 + 世代校验**（`LiveOwnershipProof`、CAS-like rebind lease 先于身份变更）；失败即 `BLOCK`，不 `CREATE_NEW`。
3. 失败态**永不静默降级为成功**（`TIMEOUT_BLOCK` 不作成功回退）。
4. 幂等全局结构写返回 `IDEMPOTENT_NO_OP`（不触发模式切换/刷新）。
5. 陈旧异步回调一律 `DROP_STALE`；过期上下文设惰性纠正通道。
6. 热循环须有**熔断 + 状态机**（`PARKED` 永不自唤醒；同 token+失败签名连续 >2 次强制 PARK）。

### 3.4 坐标 / 几何 / 视觉
1. 坐标统一 **document-local**；单一 `viewportRectToDocumentLocalRect`；禁手动 `±scrollTop`、禁 `getBoundingClientRect` union、禁第二套 helper。
2. 单层 `pointer-events:none` 覆盖层，位于 0×0 文档层 → 不影响光标/选区/排版；**禁在正文/caret 列放竖条/边界线**；标签右对齐。
3. 视觉层**不得重算**诊断数量/语义；数量标签只用诊断自有事实。
4. 几何权威"**测量优先**"，禁固定 px 魔数偏移；禁 `extra × 猜测行高`反推；水平权威统一用 `#write` 内容盒。
5. 作用域过滤禁用宽泛 `includes('inkchapter')`（会误杀真实正文）→ 用窄命名空间判定。
6. 提交期与重投影期必须用**同一载体关系**（edgePad / caption cue 同帧重求导）；detached 引用须按同一语义身份重解析。
7. 视觉闭合对账必须比对**真实 DOM marker**，禁用 resolver admitted 数代理。

### 3.5 编号 / 语义权威
1. **物理层级（P）与样式槽（S）永不混用**；持久化一律用 S（slot），UI 显示 S→P；禁对存储值做 ±1 补丁；`levels[]` key 一律 slot 索引（ADR-003 / HN-05~HN-08）。
2. 编号 label 单一来源（引擎预计算），显示层不重算。
3. **成员匹配可按文本，身份匹配不可按文本**（outline 去重 / 标题 key 碰撞）。
4. 缓存键必须含 `documentKey`（+revision）；跨文档应用阻断。
5. 公式：MJX/SVG 只作投影节点，禁入业务 target/ordinal；stableIdentity 仅来自 structural slot + operation lineage；数学渲染 hook 用稳定 wrapper + live context provider；可见验证严格相等。

### 3.6 事件 / 性能 / 生命周期
1. 事件驱动 + rAF 合并；**禁轮询 / 禁 `setInterval` / 禁递归 `setTimeout` / 禁常驻全量 MutationObserver / 禁全文持续扫描**。
2. 编辑器布局失效统一由 `EDITOR_LAYOUT_INVALIDATION` 覆盖 Active+Passive。
3. 副作用必须是**可逆注册**（解锁/dispose 时移除），监听器/观察器不得残留。
4. 结构单实例门禁（toolbar/navigator/drawer/settings root = 1）。

### 3.7 构建 / 部署 / 验证纪律
1. 编译成功 ≠ 部署 ≠ 实际加载；三者须逐一核验（真实 `Get-FileHash` + `runtime-load.json`）。
2. SHA 比较必须**两个不同来源**（禁止同路径自比）。
3. 运行时产物与源码分离（`.gitignore`）。
4. 路径权威分层，禁互相代用；禁在非 vault 目录写 `.typora`。
5. 迁移/加载路径 fail-soft，异常不阻断插件主体。
6. 环境约束：`docs/` 不受 Git 跟踪；构建必须 `build:dev`(esbuild)；PS5 `Get-Content` 需 `-Encoding UTF8`；终端可能丢 `E:\NodeJS` PATH。

### 3.8 结论可信度与文档纪律
1. 静态测试（tsc/vitest）通过 **不等于** Runtime PASS；未执行/未验收项一律不得写 PASS 占位。
2 PASS 结论不可外推到未测场景（文末 Enter 即反例）。
3. 被推翻的旧结论必须**显式记录**（见 §5），且不得作为现行 authority。
4. 文档声明（如"不再保留提示词 md"）须与实际文件状态一致。

---

## 4. 未闭环 / 待验收项（截至 2026-10-19）

1. ~~**EN-11 文末（EOF）一次 Enter 重复拆分**~~ —— **2026-10-18 已闭环**（`B68D5041…`，16 次真实 Enter 0 次重复拆分、每次 +1 可见空行；展示层置 `#write` 首子节点）。残余：未在同一会话执行 C0 配对。
2. **CAP-06 `dup.png` occurrence 1 单击 `ONE_CLICK_VISUAL_FAILED:ZERO_PAINTED_RECT`** —— `EXECUTED_PARTIAL`。
3. **DV-05/DV-06 长尾部 EOF 首次点击 `presentationVisibleHeightRatio=0.0808` FAIL、需二次点击** —— 未闭环。
4. **AW-03 关闭最后标签→空 leaf** —— 环境阻塞（该构建关最后标签即关窗）。
5. **AW-02 真实 OS/GUI 双击创建 `.md`** —— `BLOCKED_BY_GUI_TOOLING`。
6. **AW-05 Startup Snapshot Admission V5 残差** —— 两条 invariant 名 + `STARTUP_ACTIVE_BARRIER` 未落地；真机验收无记录。
7. **LC-09 Document Utility Performance Closure V1** —— 无专属单测；stress Matrix A–H 未运行。
8. **CAP-05/CAP-06 Figure Fixture Resource V1** —— Runtime Acceptance A–H 未执行；`PIXEL_GATE` 未确认。
9. **DV 系列像素级目检门禁 `PIXEL_GATE`** —— `PENDING_USER_VISUAL_ACCEPTANCE` / `BLOCKED_BY_ENVIRONMENT`（多模块）。
10. **DV-16/DV-17/DV-18** —— 代码级已修，真机像素视觉待人工（`FINAL_DECISION=PENDING_USER_RUNTIME`）。
11. **UI-06 UI Phase 2C 视觉验收** —— 阻塞 Phase 2D+。
12. **`FAIL_STALE_DIAGNOSTIC_SNAPSHOT`** —— 非本轮引入、未修（近两百个历史审计会话普遍出现）。
13. **`drawerPersistenceGateDecision=FAIL`** —— 会话累计计数（首次触发 tx=1），此后恒 FAIL，语义未修。
14. **TO-03 受跟踪回归目录内残留一次性提示词** —— OPEN；**DP-04 README 基线陈旧** —— 待同步。

环境性盲区（非代码缺陷）：**BU-08 TRAE 沙箱阻止 Typora 真实运行时验收**（贯穿全程）。

---

## 5. 结论被推翻 / 修正记录（必须显式保留）

1. `ENTER-DUPLICATE-ROOT-CAUSE.md`「第二次 split = Typora 原生尾块重建，plugin=0」→ 被 `ENTER-EOF-ROOT-CAUSE.md` §4 以宽域 tracer（`pluginStructuralWriteCount=4`）+ provenance 审计推翻。
2. `ENTER-EOF-FIX-REPORT.md` R2「真实 Enter 不再出现第二次 split」→ 被 R3 文末复核推翻（仅对正文中部成立）。
3. `ENTER-EOF-RUNTIME-ACCEPTANCE.md` 同文件内 §3（PASS）→ §8（FAIL）翻转。
4. `ENTER-EOF-CONTROL-MATRIX.md` §6（分支 A 因果确认）→ §7（归因修正为 UNKNOWN）。
4.1 2026-10-18：EN-11 根因最终从「Enter 事件链干预 / UNKNOWN」修正为「展示层作为 `#write` 最后子节点改变 Typora 尾块再归一化」；有效 C4（`B68D5041…`）以 16 次真实 Enter、0 次重复拆分取代此前 `EN11_LAYER_PLACEMENT_FIX=NOT_TESTED` 与「非插件所致」推断。
5. `document-utilities.md` V5.8「离屏首次点击即完成」→ 被 Runtime 推翻，V5.9 接管。
6. V5.2「border/indicator 为主」→ 被 V5.3 + R7（FILL_ONLY）取代。
7. V5.12-R1（icon+rail）→ 被 R9（SOFT_TEXT_SURFACE + REASON_CHIP）取代并删除。
8. V5.12-R3 `ROOT_R2_8`（lease 延迟释放）→ 两类 lease 解耦取代。
9. `strict-loose-heading-structure.md` §8B.7.1：旧 `CONTROL-SURFACE-INVARIANT` 判定为 **false PASS**。
10. `outline-numbering.md`：旧 signature 把 collector 去重丢失误判为"Typora 没生成第二个 native item"，被 `FIRST_FAILING_LAYER=C` 推翻。
11. 记忆 M-22/M-36/M-37：R60.x 公式渲染介入 → 两次 `git reset --hard` 回滚（回滚本身即"结论/方案被推翻"的记录）。

---

## 6. 溯源索引

- **Git 提交**：全部编号可经 `git show <hash>` 复核；问题相关提交约 136 个，集中在 `main` 与 `archive/*` 分支。
- **项目文档**：`docs/roadmap/known-gaps-and-deferred-work.md`、`docs/diagnostics/*`、`docs/modules/*`、`docs/decisions/ADR-001~005`、`docs/operations/*`、`docs/archive/PROGRESS-ARCHIVE.md`、`docs/maintenance/*`、`runtime/evidence/ENTER-*.md`、`runtime/evidence/R02-R05-MANUAL-CHECKLIST.md`、`runtime/evidence/typora-freeze-20261009/EVIDENCE-NOTE.txt`、`CHANGELOG.md`。
- **记忆库**：`project_memory.md`、各日期 `topics.md`、`session_memory_*.jsonl`（`20260818`~`20261009`）。
- **代码/配置/日志**：`src/heading-numbering/heading-numbering-service.ts`、`src/document-utilities/*`（尤其 `enter-echo-write-trace.ts`、`document-utility-overlay-host.ts`）、`src/core/logger.ts`、`build.js`、`tsconfig.json`、`package.json`、`pnpm-workspace.yaml`、`test/vault/.typora/__plugin-logger.log`、`test/vault/.typora/inkchapter/audit/runtime-sess-*.log`（333 个）、`test/vault/.typora/inkchapter-*.json/jsonl`。

> 说明：审计日志中 **不存在** 未捕获 JS 异常（`TypeError/ReferenceError/Uncaught` 命中 0）；日志中数以万计的 `FAIL`/`error` 是插件自有的诊断严重度与几何/视觉门禁判定（如空文档负例），非运行时崩溃。

---

## 7. 全项目审计台账 PA-01…PA-26（2026-10-27 收口，唯一口径）

来源：`runtime/evidence/project-audit-20261027/`（10 份证据文件）+ `runtime/evidence/formula-latency-closure-20261027/AUDIT_RECONCILIATION.md`。
本台账取代此前“26 项 / 已修 9 项”的粗略统计口径。

| 分类 | 条目 | 状态 | 代表结论 |
|---|---|---|---|
| P1（8 项） | PA-01–PA-08 | FIXED | 锁定编辑守卫（`document-edit-guard.ts`）、`~~~` 围栏识别、MathJax render-input hook 还原（`mathjax-render-input-hook.ts`）、`tsconfig` strict 收敛等 |
| P2（9 项） | PA-10–PA-16 已修；PA-09 仍为 candidate | FIXED / CANDIDATE | 公式正确性四项（见 [modules/formula-numbering.md](../modules/formula-numbering.md) §14）、纯 caret 帧不触发全文诊断 |
| P2 开放 | PA-17 / PA-18 | OPEN | PA-17 部署链无新鲜度门禁（第三方可覆盖 `plugins.json` / 残留旧产物）；PA-18 `^2.7.7` 依赖声明与 `minCoreVersion 2.9.0` 不一致 |
| P3（8 项） | PA-19–PA-26 | OPEN | 静默 `catch` 198 处、setext H1 语义、CI 不跑测试、`KNOWN_EMPTY` 语义缺口等 |

方法学结论（写入 [modules/runtime-audit-and-identity.md](../modules/runtime-audit-and-identity.md) §15 一并生效）：

- 每个条目必须给出 `FIRST_DIVERGENCE_STAGE` + `root_cause` + `test_before` / `test_after`，只允许“失败先行 → 最小修复”的顺序。
- `TEST_DRIVER_FAILURE`（驱动失败）与 `PRODUCT_FAILURE`（产品缺陷）必须分开，禁止把驱动失败计为产品通过或产品失败。
- `dist == deploy` 不等于 `loaded`；验收必须绑定 `loadedSHA` 回执。
