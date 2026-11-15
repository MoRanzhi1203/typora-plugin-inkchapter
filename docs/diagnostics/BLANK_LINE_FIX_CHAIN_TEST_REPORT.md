# 空行修复链路专项测试报告

| 项目 | 值 |
|---|---|
| 报告日期 | 2026-11-15 |
| 分支 | `feature/diagnostics-trae-ui-quick-fix` |
| 代码基线 | `496046f`（R07）、`2308144`（R06） |
| 测试环境 | Windows / Typora 1.6.7 / Node 24 / Vitest 4.1.10 |
| 生产构建 | `28300EB0F8F2E41A59680CF9349F95F9000A4EC219A10F72E5909FD96A073F80`（`loadSource=vault`） |
| 结论 | **通过**：专项 24 个测试文件 / 411 个用例全绿；真实 Typora Runtime 验收 11 步 / 41 条断言全部 PASS；全量 357 个测试文件 / 6198 个用例通过 |

---

## 1. 报告范围

覆盖「多余空行」从**检测 → 诊断发布 → 面板展示 → 修复计划 → 编辑器写回 → 重新检测 → UI/标记刷新 → 撤销/重做**的完整链路。

不覆盖：与本链路无关的标题编号、图片上传、文件拖放等模块（它们由各自测试承担）。

---

## 2. 被测链路与权威

| 环节 | 代码权威 | 说明 |
|---|---|---|
| 空行识别 | `src/document-utilities/document-diagnostic-internal-blank-lines-v1.ts` | 唯一的源码块间隙分析器；空行 run 阈值 `passMaxBlankLines=1 / warningThreshold=2` |
| 块对允许值 | `src/document-utilities/document-diagnostic-blank-adjacency-policy-v1.ts` | 正文↔正文最多 1 额外渲染空行，其余 0 |
| 文首/文末 | `document-diagnostic-leading-blank-lines-v1.ts`、`document-diagnostics.ts` | 文首 0、文末恰好 1 个换行 |
| 诊断发布 | `document-diagnostics.ts` + `document-diagnostics-authority.ts` | 快照为唯一事实来源，行号由源码行映射 |
| 修复计划 | `src/document-utilities/document-diagnostic-fix-v1.ts`、`document-diagnostic-fix-v2.ts` | 纯函数：只产出补丁，不写编辑器 |
| 编排/写回 | `src/document-utilities/document-diagnostic-fix-controller.ts` | 计划 → 预览/直写 → 校验 → 重新检测 → 结果分类 |
| 编辑器事务 | `src/main.ts`（`File.reloadContent`） | 一次写回 = 一条撤销记录 |
| 验收入口 | `src/document-utilities/document-diagnostic-acceptance-harness-v1.ts`、`src/runtime/blank-line-acceptance-runner.ts`、`scripts/run-blank-line-acceptance.mjs` | 仅测试 vault 启用，调用与面板相同的业务入口 |

---

## 3. 测试分层与统计

命令：

```powershell
pnpm vitest run --reporter=json --outputFile=runtime/vitest-blank-chain.json `
  src/document-utilities/document-diagnostic-blank-*.test.ts `
  src/document-utilities/document-diagnostic-internal-blank-*.test.ts `
  src/document-utilities/document-diagnostic-leading-blank-lines-v1.test.ts `
  src/document-utilities/document-diagnostic-trailing-blank-fixtures.test.ts `
  src/document-utilities/document-diagnostic-fix-*.test.ts `
  src/document-utilities/document-diagnostic-acceptance-harness-v1.test.ts `
  src/document-utilities/blank-space-warning-presentation.test.ts `
  src/runtime/blank-line-acceptance-runner.test.ts
```

| 层级 | 测试文件数 | 用例数 | 结果 |
|---|---:|---:|---|
| L1 规则与检测（源码分析、阈值、矩阵、文首/文末、渲染行） | 16 | 272 | 272 PASS |
| L2 标记与发布（空行标记文案/数量、标记布局） | 2 | 43 | 43 PASS |
| L3 修复计划（fix-v1 / fix-v2 / 面板状态） | 3 | 56 | 56 PASS |
| L4 控制器集成（真实 `DiagnosticFixController` + 可变缓冲区） | 1 | 18 | 18 PASS |
| L5 验收入口（harness 编排 + 运行时驱动门禁） | 2 | 22 | 22 PASS |
| **合计** | **24** | **411** | **411 PASS / 0 FAIL** |

### 3.1 按文件明细

| 文件 | 用例 |
|---|---:|
| `document-diagnostic-rendered-blank-row.test.ts` | 48 |
| `document-diagnostic-internal-blank-lines-v1.test.ts` | 43 |
| `document-diagnostic-fix-v1.test.ts` | 32 |
| `document-diagnostic-blank-region-unified-v1.test.ts` | 30 |
| `document-diagnostic-blank-marker-v1.test.ts` | 29 |
| `document-diagnostic-rendered-blank-row-r7.test.ts` | 22 |
| `document-diagnostic-blank-gap-r8f.test.ts` | 14 |
| `document-diagnostic-blank-marker-layout-v1.test.ts` | 14 |
| `blank-space-warning-presentation.test.ts` | 14 |
| `document-diagnostic-internal-blank-split-v1.test.ts` | 12 |
| `document-diagnostic-internal-blank-live-update-v1.test.ts` | 12 |
| `document-diagnostic-trailing-blank-fixtures.test.ts` | 12 |
| `document-diagnostic-internal-blank-incremental-v1.test.ts` | 11 |
| `document-diagnostic-fix-v2.test.ts` | 17 |
| `document-diagnostic-fix-controller.test.ts` | 18 |
| `document-diagnostic-acceptance-harness-v1.test.ts` | 17 |
| `document-diagnostic-internal-blank-visible-decision-v1.test.ts` | 18 |
| `document-diagnostic-leading-blank-lines-v1.test.ts` | 9 |
| `document-diagnostic-blank-adjacency-policy-v1.test.ts` | 8 |
| `document-diagnostic-eof-blank-row-band-v1.test.ts` | 8 |
| `document-diagnostic-fix-panel.test.ts` | 7 |
| `document-diagnostic-blank-row-r8.test.ts` | 6 |
| `document-diagnostic-blank-row-acceptance-hold-v1.test.ts` | 5 |
| `blank-line-acceptance-runner.test.ts` | 5 |

---

## 4. 关键场景矩阵

### 4.1 L1 — 规则与检测

| 场景 | 期望 | 结果 |
|---|---|---|
| 正文→正文 4 个空行 | 发布 1 条 `EXCESSIVE_INTERNAL_BLANK_LINES` | PASS |
| 正文→正文 1 个结构分隔空行 | 不发布（不算多余空行） | PASS |
| 正文/标题/图片/代码/公式/表格/列表/引用两两组合 | 按空行矩阵判定（额外渲染空行 0/1） | PASS |
| 文首空行 | `DOCUMENT_LEADING_BLANK_LINES_EXCESSIVE` | PASS |
| 文末 2+ 额外空行 | `DOCUMENT_TRAILING_BLANK_LINES_EXCESSIVE` | PASS |
| 文末缺换行 | `DOCUMENT_TERMINAL_NEWLINE_MISSING`（与上条互斥） | PASS |
| 代码围栏/公式块/HTML/Front Matter 内部空行 | 不视作块间隙 | PASS |
| 同一 run 只发布 1 条（不按空行数爆炸） | 1 gap → 1 diagnostic | PASS |
| 编辑后空行消失/重现 | 诊断自动增删（增量检测） | PASS |
| 大文档渲染行计数 | 与源码计数一致，不猜测 | PASS |

### 4.2 L2 — 标记与发布

| 场景 | 期望 | 结果 |
|---|---|---|
| 标记文案 | `多余 N 空行`，N = 可视空行 − 结构分隔 − 块对允许值 | PASS |
| 标记不遮挡光标 | 左移/上移/隐藏 三态 | PASS |
| 文末标记 | 仅在可绘制时显示，不越过最后有效块 | PASS |
| 发布门禁 | 不满足几何/结构条件时不发布（不伪造 PASS） | PASS |

### 4.3 L3 — 修复计划（纯函数）

| 场景 | 期望 | 结果 |
|---|---|---|
| 目标区间正常 | 只删除多余空行，保留 1 个结构分隔行 | PASS |
| 目标行不是空行 | `INVALID_FACT`，零补丁 | PASS |
| 区间越界/首部空行 | `PATCH_OUT_OF_BOUNDS` / `NOT_APPLICABLE` | PASS |
| 已无稳定身份（历史诊断） | 按旧块身份对定位；失败 → `TARGET_NOT_FOUND` | PASS |
| 旧位置仍为空、但同类区间存在多个 | `AMBIGUOUS_TARGET`，零补丁 | PASS |
| 目标已被删除 | `TARGET_NOT_FOUND`，零补丁 | PASS |
| 唯一可确认目标 | 允许安全修复 | PASS |
| 文首/文末专项 | 删除文首空行 / 补齐末尾换行 | PASS |
| 补丁冲突 | `selectNonConflictingPlans` 跳过冲突项 | PASS |

### 4.4 L4 — 控制器集成

| 场景 | 期望 | 结果 |
|---|---|---|
| 单项修复（面板「修复」同一入口） | 一次写回；`VERIFIED_FIXED` 由复检决定 | PASS |
| 一键修复 | 规划一次、写回一次；全部安全项处理 | PASS |
| 文档切换/锁定/重复提交 | 取消或拒绝，不写入 | PASS |
| 写回基准变化 | `STALE_SOURCE`，不盲写 | PASS |
| 读回不一致 | `READBACK_MISMATCH`，不报告成功 | PASS |
| 过期诊断（id 仍在快照、目标身份失效） | 最多一次重检 + 安全重绑定 | PASS |
| 开始前 id 已消失（列表已刷新） | 重检一次；rule/all 用当前结果继续；无法确认则刷新 + 提示，不写 | PASS |
| 多个同类目标 | 只重检一次、零写入、有通知 | PASS |
| 计划复用 | 源码与快照修订号一致时不重复解析；否则重新计划 | PASS |

### 4.5 L5 — 验收入口

| 场景 | 期望 | 结果 |
|---|---|---|
| 非测试 vault | 不启用 | PASS |
| 非验收文档 | 不启用（即使存在运行令牌） | PASS |
| 无运行令牌 | 不启用（生产默认） | PASS |
| 同一令牌已执行 | 不重复执行 | PASS |
| 编辑器桥无 Undo/Redo | 写 `UNEXECUTED`，绝不伪造 PASS | PASS |
| 报告写入 | 固定路径；失败不崩溃 | PASS |

---

## 5. 真实 Typora Runtime 验收

- 命令：`pnpm run accept:blank`
- 夹具：`test/vault/runtime/acceptance/Blank-Line-R06-Runtime-Acceptance.template.md`（每次运行复制为工作文档，结束后无条件还原）
- 报告：`test/vault/runtime/acceptance/acceptance-last-run.json`
- 令牌：`r06-1794715840537`；耗时 2026-11-15T04:10:52Z → 04:10:56Z
- **结果：PASS，`failures = []`，41 条断言全部通过**

### 5.1 步骤级证据（真实编辑器缓冲区）

| 步骤 | 行数 | 空行诊断 | 文末换行 | 空行 run |
|---|---|---|---|---|
| baseline | 62→62 | 7→7 | 4 | `[1,1,4,1,4,1,4,1]` |
| single-fix（内部空行） | 62→59 | 7→6 | **4** | `[1,1,1,1,4,1,4,1]` |
| undo-single | 59→62 | 6→7 | 4 | 还原 |
| redo-single | 62→59 | 6→6 | 4 | 再应用 |
| reset-baseline | 59→62 | 7→7 | 4 | 还原 |
| stale-after-insert（上方插入段落后修复原目标） | 64→61 | 7→6 | 4 | 只压缩目标区间 |
| stale-missing（目标已删除） | 59→59 | 6→6 | 4 | 不写入 |
| fix-all | 62→41 | 7→0 | 1 | `[1,1,1,1,1,1,1,1]` |
| undo-all | 41→62 | 0→7 | 4 | 还原 |
| redo-all | 62→41 | 0→0 | 1 | 再应用 |
| restore-baseline | 41→62 | 0→7 | 4 | 还原 |

### 5.2 断言分组（41/41 PASS）

| 分组 | 断言 |
|---|---|
| 基线 | `baseline.ready`、`baseline.markdown`、`baseline.blank-count`、`baseline.undo-stack` |
| 单项修复 | `single.settled`、`single.changed`、`single.target-removed`、`single.one-gap-only`、`single.only-target-region`、`single.eof-untouched` |
| UI 联动 | `ui.diagnostics-updated`、`ui.counts-updated`、`ui.auto-fixable-updated`、`ui.markers-synced`、`ui.line-numbers-updated` |
| 撤销/重做 | `undo.api`、`undo.restores-baseline`、`redo.api`、`redo.reapplies-fix`、`all-undo.*`、`all-redo.*` |
| 过期诊断 | `stale-insert.applied/target-identifiable/settled/precise/restored`、`stale-missing.applied/no-write/list-refreshed/restored` |
| 一键修复 | `all.settled`、`all.changed`、`all.no-blank-diagnostics` |
| 一键后 UI | `ui.all-list-cleared`、`ui.all-counts-cleared`、`ui.all-auto-fixable-zero`、`ui.all-markers-cleared` |
| 复位 | `restore.baseline` |

### 5.3 关键结论

1. **修改范围精确**：单项修复后真实缓冲区与「只应用该诊断补丁」的纯计划结果**逐字节一致**；内部空行修复前后文末换行均为 4，未发生全文规范化。
2. **过期诊断安全**：编辑后仍能精确修复同一逻辑目标；目标被删除时零写入，只刷新检测列表。
3. **UI 同步**：列表、错误/警告/提示总数、可自动修复数量、存活诊断行号随快照刷新；一键修复后空行条目与可修复数量归零。
4. **撤销/重做**：撤销恢复修复前**完整文本**，重做恢复修复结果；底层为 Typora 自身 `reload` 撤销命令（一次写回 = 一条撤销记录）。
5. **空行矩阵**：修复后块间只剩 1 个 Markdown 结构分隔空行，文末恰好 1 个换行。

---

## 6. 静态检查与全量回归

| 检查 | 命令 | 结果 |
|---|---|---|
| 类型检查 | `pnpm tsc --noEmit` | PASS（0 error） |
| 文档校验 | `pnpm run docs:verify` | PASS（断链 0 / 缺失路径 0） |
| 生产构建 | `pnpm run build` | PASS |
| 全量测试 | `pnpm vitest run` | **357 个测试文件 / 6198 个用例全通过** |

> 说明：曾出现一次 4 个失败的全量结果，原因是同时运行了两个全量测试任务（临时目录/jsdom 争用）。单独重跑为 0 失败，已用 JSON 报告复核。

---

## 7. 未覆盖项与风险

| 项 | 状态 | 说明 |
|---|---|---|
| 真实鼠标点击检测面板「修复 / 一键修复」 | 未覆盖（环境限制） | Typora 1.6.7 无 UIA 树、CDP 无页面目标、前台焦点被抢占；现有证据来自与面板**同一业务入口**的 Runtime 调用 |
| 物理 `Ctrl+Z` / `Ctrl+Y` 按键 | 未覆盖 | 用 Typora 自身 undo/redo 命令入口验证语义 |
| 空行标记的视觉出现/消失 | 部分覆盖 | 验收夹具 `blankMarkerCount = 0`，只能证明"不残留" |
| 像素级视觉门禁 | 未覆盖 | 需人工目检 |
| ≥2000 行大文档的修复耗时 | 未覆盖 | 检测性能另有专项记录 |

---

## 8. 复现方式

```powershell
# 1. 专项单元/集成测试
pnpm vitest run src/document-utilities/document-diagnostic-blank-adjacency-policy-v1.test.ts `
  src/document-utilities/document-diagnostic-internal-blank-lines-v1.test.ts `
  src/document-utilities/document-diagnostic-fix-v1.test.ts `
  src/document-utilities/document-diagnostic-fix-v2.test.ts `
  src/document-utilities/document-diagnostic-fix-controller.test.ts `
  src/document-utilities/document-diagnostic-acceptance-harness-v1.test.ts `
  src/runtime/blank-line-acceptance-runner.test.ts

# 2. 类型检查 + 生产构建
pnpm tsc --noEmit
pnpm run build

# 3. 部署到隔离测试 vault
powershell -ExecutionPolicy Bypass -File scripts/deploy-test-vault.ps1

# 4. 真实 Typora 运行时验收（独占运行，避免并发）
pnpm run accept:blank

# 5. 查看报告
Get-Content test/vault/runtime/acceptance/acceptance-last-run.json -Raw
```

> 注意：第 4 步需要 Typora 未运行旧构建；若超时，脚本会打印当前运行插件 SHA，重启 Typora 后重试。
> 不要同时运行两个 `vitest run`，会因临时资源争用产生假失败。

---

## 附：相关文档

- 运行时验收说明与证据：[BLANK_LINE_R06_RUNTIME_ACCEPTANCE.md](BLANK_LINE_R06_RUNTIME_ACCEPTANCE.md)
- 诊断规则全量清单：[DOCUMENT_DIAGNOSTICS_FULL_INVENTORY.md](DOCUMENT_DIAGNOSTICS_FULL_INVENTORY.md)
- 已知缺口：[known-gaps-and-deferred-work.md](../roadmap/known-gaps-and-deferred-work.md)
- 功能总览：[INKCHAPTER-FEATURE-GUIDE.md](../INKCHAPTER-FEATURE-GUIDE.md)
