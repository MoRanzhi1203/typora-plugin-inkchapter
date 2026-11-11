# 诊断排序 / UI / Quick Fix 任务账本（Trae 本轮）

> 分支：`feature/diagnostics-trae-ui-quick-fix`（基于 `fix/code-diagnostic-marker-visibility-anchor-trae`）
> 未合并 main、未推送远端。
> 状态：`TODO` / `IN_PROGRESS` / `PASS` / `FAIL` / `BLOCKED` / `NEEDS_MANUAL`

## G0 — 基线审计

| 项 | 状态 | 证据 |
|---|---|---|
| 只读审计 git / package scripts / docs / GUI 证据 | PASS | `git status --short`（仅 4 个未跟踪任务书）、`git log -n 8`、`package.json` scripts |
| 建立安全工作分支 | PASS | `feature/diagnostics-trae-ui-quick-fix`（未合并、未推送） |
| 编辑器模型 / 撤销语义取证 | PASS | `D:\Typora\resources\appsrc\window\frame.js` 的 `reloadContent` 实现：`undo.register` + `reload` 命令 |
| 定位既有模块 | PASS | overlay host / hub model+controller / fix v1 / caption service / editGuard / style.scss |

## S1 — 排序、筛选、计数

| 项 | 状态 | 证据 |
|---|---|---|
| 默认按源码位置升序（host 既有投影排序） | PASS | `sortProjectionsByDocumentPosition`；`document-diagnostic-drawer-order-v514-r1.ts` |
| 视图次级排序（文档顺序 / 严重程度 / 规则类型） | PASS | `sortDiagnosticItems`；面板新增排序菜单；`document-hub-model-order-v1.test.ts` |
| 严重程度排序内部仍按文档顺序（稳定排序） | PASS | 同上测试 |
| 过滤只缩小视图、不改计数 | PASS | `filterDiagnosticItems` + 既有 quick filter 测试 |
| 事件数 / 行数 / 多目标 1:N 分离 | PASS | `rowCount` 与 `status.*Count` 分离；order 测试 |
| 选中跟随诊断 ID，快照变化清空 | PASS | `update()` 按 ID 清理；`is-selected` / `aria-current` |
| 点击行定位不被修复按钮劫持 | PASS | 行=div[role=button]；修复按钮 stopPropagation |

## U1 — 面板 UI

| 项 | 状态 | 证据 |
|---|---|---|
| 收起 15px 色块 / 32px 热区 / 无白壳 | PASS | 既有 CSS（本轮未回退） |
| header 与 content 同一宽度权威 / 360px | PASS | 既有 layout 测试 |
| 行布局：6px 点 / 标题 12.5px / 40px 行号 / 44px 操作 | PASS | `style.scss` + hub controller 测试 |
| 行内「修复 / 处理」入口（锁定/忙碌禁用） | PASS | `buildDiagnosticRow`；按钮 title 说明原因 |
| 第二行「N 项可自动修复 + 一键修复」 | PASS | `buildFixAllLine`；N 来自真实 AUTO_SAFE 计划 |
| 无第四标签、无二级抽屉 | PASS | 复用 `检测｜图片｜锁定`；修复面板在检测页内 |
| 深/浅色 token 复用 | PASS | `--ink-doc-*`；未新增覆盖正文主题的规则 |
| prefers-reduced-motion | PASS | 新增 `.inkchapter-doc-expand__diag-fix` 参与减弱动效 |

## M1 — 正文标记

| 项 | 状态 | 证据 |
|---|---|---|
| 内部空行标记不再整行黄色填充 | PASS | `.inkchapter-block-gap-fragments` 改为 transparent + 2px 左轨；逐行碎片填充被作用域覆盖 |
| 诊断信息不删除（规则/身份/计数/定位不变） | PASS | 只改 CSS 呈现；DOM 类与 owner token 未改 |
| 代码块诊断标记归属与可见性 | PASS | 上一轮修复保留：`preCodeMarker`/z-index/identity 逻辑未改；相关回归测试保留 |
| 标记不遮挡代码/复制/语言/折叠 | PASS | 既有回归测试（本轮未改）+ 边轨在 gap 区域左侧 |

## F0 — 修复引擎

| 项 | 状态 | 证据 |
|---|---|---|
| `DiagnosticFixRegistry` 能力矩阵 | PASS | `describeFixCapability` / `listFixCapabilities` |
| `FixPlanner`（V2） | PASS | `planDiagnosticFixV2` / `planFixesForRuleV2` / `planAllAutoFixesV2` |
| `ConflictResolver` | PASS | `selectNonConflictingPlans` + `PATCH_CONFLICT` |
| `FixPreview`（真实 Markdown 局部 diff） | PASS | `document-diagnostic-fix-panel.ts` + `buildFixPreview` |
| `TyporaEditTransactionAdapter` | PASS | `createEditorFixTransactionAdapter` + main.ts 真实 `File.reloadContent` |
| `FixPostVerifier` | PASS | `classifyFixOutcome`（VERIFIED_FIXED / CHANGED_BUT_PERSISTS / STALE / FAILED） |
| 确认前零修改 | PASS | controller 测试 |
| 回读校验与过期拒绝 | PASS | adapter 测试 + controller stale-doc 测试 |

## F1 — 空行 / 文末空行真实修复

| 项 | 状态 | 证据 |
|---|---|---|
| 逐项修复（真实 diff + 确认 + 写回） | PASS | controller 测试 |
| 同类修复（同规则、冲突跳过） | PASS | fix-v2 同类测试；行内「同类」入口（仅同规则 >1 项时出现）+ hub 测试 |
| 一键修复可处理项（AUTO_SAFE 实时计数） | PASS | `computeAutoFixableCount`（真实计划） |
| 修复后重算与如实反馈 | PASS | `classifyFixOutcome` + 持久诊断测试 |
| 结构序列化未验证时拒绝整篇写回 | PASS | `readFixSource()` + `isSourceVerified`；controller 测试（降级拒绝） |
| 撤销 | NEEDS_MANUAL | 静态证据：`reload` 命令进入 undo 栈；需真实 Typora 按键验证 |

## F2 — 交互式逐项修复

| 项 | 状态 | 证据 |
|---|---|---|
| 代码语言（输入 → 只改围栏 → 重算） | PASS | fix-v2 / controller 测试 |
| 代码块名称（现有题注服务） | PASS（单测）/ NEEDS_MANUAL（真实 UI） | `setCaptionName('code')` 路由 + targetIdentity 校验 |
| 表格名称（现有题注服务） | PASS（单测）/ NEEDS_MANUAL（真实 UI） | 同上 |
| 图片名称（只改 alt） | PASS | fix-v2 测试 |
| 空值/非法值拒绝 | PASS | panel + fix-v2 测试 |
| 无修复器的规则不出现空按钮 | PASS | `UNAVAILABLE` 不渲染操作按钮 |

## F3 — 行级 UX

| 项 | 状态 | 证据 |
|---|---|---|
| 定位 / 修复分离，无双跳转 | PASS | stopPropagation + 行定位保留 |
| 预览显示 Before/After 与行号 | PASS | panel 测试 |
| Esc 关闭 / 键盘确认 / 焦点进入输入框 | PASS | panel + hub Esc 优先级 |
| 成功/失败/跳过反馈 | PASS | `formatFixOutcome` + toast |
| 锁定禁用正文修改 | PASS | controller `isLocked` 二次校验 |

## L1 — 生命周期 / 并发

| 项 | 状态 | 证据 |
|---|---|---|
| 文档切换取消待确认计划 | PASS | `bindDocument()` → `controller.cancel()` |
| 锁定时取消待确认计划 | PASS | `toggleLock()` |
| 重复提交幂等 | PASS | `busy` 守卫 + controller 测试 |
| dispose 清理 | PASS | `host.dispose()` → `controller.cancel()` |
| 批量后一次重算 | PASS | 单次 transaction + 单次 `recompute`（+ 有界重试） |

## T1-T3 — 测试与真实 GUI

| 项 | 状态 | 证据 |
|---|---|---|
| 新增定向测试（fix v2 / panel / controller / order / hub row+sort） | PASS | 50 个新增用例（fix v2 17 / panel 6 / controller 10 / order 6 / hub F3 4 / hub sort 2 / CSS 契约更新） |
| TypeScript | PASS | `npx tsc --noEmit -p tsconfig.json`（exit 0） |
| 全量 Vitest | PASS | `343 test files / 5960 tests` 全部通过；随后仅新增 2 个排序 UI 用例，`document-hub-controller.test.ts` 单独 40/40 通过 |
| build | PASS | `pnpm build`（verify:archive + tsc + esbuild prod） |
| 隐私 / docs 校验 | PASS | `PRIVACY_GATE=PASS`；`docs:verify RESULT=PASS` |
| 部署测试 vault | PASS | `test/vault/.typora/plugins/dist` 与 `dist/` 同 SHA |
| 真实 Typora GUI（排序/筛选、逐项/同类/一键、撤销、锁定、切换、标记、DPI/主题） | NEEDS_MANUAL | 见下节阻塞证据与步骤 |

## 构建与部署 SHA

- `dist/main.js`：`F670BBA79060AA2B7FE5CF599C74CB54AAD34F336B3CB6E731D7C6BD38EE364E`
- `dist/style.css`：`EE6C96793F458E0D8E509571152811E17278BA01CADFD0667E65B8D7DAF90F0C`
- 测试 vault 部署文件 SHA 与上述一致。
- **runtime-load SHA 未采集**：运行中的 Typora（PID 43292）启动于 21:51，早于本轮构建；
  加载的仍是旧 bundle，因此不能声称新 bundle 已在运行时生效。

## 已知阻塞 / 待人工验收

1. **GUI 自动化不可用（有证据）**
   - Typora 进程存在：PID 43292，标题 `Document-Diagnostics-Code-Integrity-Test.md• - Typora`
     （`•` = 有未保存修改）。
   - DevTools 窗口存在，但 CDP 端口不可用：`Test-NetConnection 127.0.0.1:9222` → `False`。
   - Computer Use 的 UI Automation 树只暴露窗口/菜单栏，不暴露 `#write` 或插件面板 DOM，
     无法取得真实 `getBoundingClientRect` / computed style，也无法安全点击 15px 状态方块。
   - 因文档有未保存修改且禁止修改用户 Markdown，本轮**未**执行 `Ctrl+R` / 重启来加载新 bundle，
     以免丢失用户内容。
2. **撤销**：`File.reloadContent(markdown, {})` 在 `frame.js` 中执行
   `undo.register` + `reload` 命令；真实 `Ctrl+Z` 需在 Typora 中验证。
3. **题注名称**：`CODE_MISSING_NAME` / `TABLE_MISSING_NAME` 写入题注服务（不改 Markdown），
   无法用 Markdown 撤销恢复；UI 已明确说明。
4. 本轮未伪造任何 GUI 截图；以上均为可复现的取证结果。

## 人工验收步骤（最小集）

1. 在 Typora 中保存当前文档 → 关闭并重新打开 Typora（或至少重载窗口），确认插件从
   `test/vault/.typora/plugins/dist` 加载新 bundle（DevTools 中 `File.editor` 存在即可）。
2. 打开 `test/vault/Document-Diagnostics-Code-Integrity-Test.md`。
3. 右上角单击 15px 方块展开 → 检查：
   - 顶部 `错误/警告/提示` 计数与列表一致；
   - 排序菜单：文档顺序 / 严重程度 / 规则类型，切换后计数不变；
   - 筛选菜单只缩小视图；
   - 行内「修复」「同类」入口在锁定/忙碌时禁用。
4. 点任一「连续空行过多」→ 预览出现 Before/After → 确认 → 正文空行被压缩为 1 个；
   诊断消失；`Ctrl+Z` 一次恢复。
5. 同规则 ≥2 项时点「同类」→ 预览含多处 hunk → 确认 → 一次写回 → 一次 `Ctrl+Z`。
6. 点「一键修复可处理项」→ 预览 → 确认 → 报告 `已修复 N 项（Ctrl+Z 可撤销）`。
7. 代码块缺语言：点「处理」→ 输入 `ts` → 预览 → 确认 → 围栏变为 ```ts，代码正文不变。
8. 代码块/表格缺名：点「处理」→ 输入名称 → 预览（metadata-only）→ 确认 → 题注出现名称；
   Markdown 正文不变。
9. 锁定文档后重复步骤 4–8：应拒绝并提示；快速切换文档时预览应自动取消。
10. 观察正文空行标记：现在为 2px 左侧边轨 + 右侧计数，而不是整块黄色横幅；代码块诊断标记
    仍在对应代码块上，不遮挡语言/复制/折叠。
11. 100% / 125% / 150% DPI、浅/深色主题、窗口由小到大、侧栏拖拽：三标签与内容区左右边界
    偏差 ≤1 CSS px，无遮挡、无窗口级滚动条。
