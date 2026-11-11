# GUI 验收脚本与步骤（真实 Typora）

> 当前 Typora 已真实加载新 build `17E64A2…`（`inkchapter-runtime-load.json` 03:14:50，
> `initializationCount=1`），DevTools 窗口已打开。用户已提供收起态证据：
> dpr 1.25、YELLOW、10 warnings、0 DOM 行、tabs/panel 0×0。请用**新脚本**复采 A–E，
> 重点验证三态判定与多目标。
>
> 没有远程调试端口 **不等于** GUI 不可测试：Typora 自带 DevTools（`Shift+F12` 或
> `视图 → 开发者工具`），脚本为只读，不点击、不写入。

## 1. 准备

1. 启动 `D:\Typora\Typora.exe`。
2. 打开 `test/vault/Document-Diagnostics-Code-Integrity-Test.md`。
3. 确认 `视图 → 源代码模式` **不勾选**、`打字机模式` **不勾选**。
4. 打开 `视图 → 开发者工具`（`Shift+F12`）。
5. 在 Console 中粘贴 `docs/diagnostics/GUI_ACCEPTANCE_DEVTOOLS.js` 全文并回车。

脚本只读：`querySelector` / `getBoundingClientRect` / `getComputedStyle`，无点击、无 DOM 写入。

## 2. 采证矩阵（三态判定）

脚本输出 `PASS / FAIL / NOT_APPLICABLE`，**收起状态不能判等宽/几何 PASS**。

| 运行 | 操作 | 期望 |
|---|---|---|
| A 收起态 | 打开文档，等 1s，执行脚本 | `visibility.expanded=false`；`statusSemantics.dataset.status=YELLOW`；`warningCount=10`；`square.computed.background-color=rgb(212, 154, 38)`；`square` 15×15；`toolbar.tabWidth.verdict=NOT_APPLICABLE`（禁止 `tabWidthsEqual=true`）；`toolbar.geometry.overall.verdict=NOT_APPLICABLE`；`diagnostics.domRowCount=0` 但 `instanceCounts.warning=10`，`rowCoverage.reason=COLLAPSED_DOES_NOT_MEAN_ZERO_DIAGNOSTICS`；`collapsedHitTest.verdict=PASS` |
| B 展开态 | 单击状态方块，等过渡结束，执行脚本 | `visibility.expanded=true`；`tabs/panel` 可见；`toolbar.tabWidth.verdict=PASS`，`delta<=1`；`geometry.overall.verdict=PASS`；`row-vs-panel` 的 left/right/width 差值均 ≤1；`diagnostics.projectedRowCount` 与 `domRowCount` 一致 |
| C 多目标 | 打开 `test/vault/墨章插件测试/07-重复标题与特殊标题测试.md`（只读打开，不修改），展开后执行 | `multiTarget.verdict=PASS`，`groups[].rowCount=2`，`instanceCounts.warning=1`，即“1 项警告、2 个目标、2 条展示行” |
| D 锁定态 | 双击状态方块，执行脚本 | `dataset.locked='1'`；`lockFrame` 四边宽度 >0、非透明；`content.lockedDocumentClass=true`；方块颜色仍为 YELLOW/RED（锁不覆盖严重度） |
| E 主题 / DPI | 明/暗主题、100%/150% 缩放重复 A/B | 颜色仍为当前状态色；`dpi.devicePixelRatio=1.25` 时几何 CSS px 仍应稳定；差值容差 1px |

## 3. 关键字段与判定

- `toolbar.tabWidth`：仅 `expanded && tabs 可见 && 3 个 tab 宽度>0 && settle` 时可判 PASS；
  收起 → `NOT_APPLICABLE`；展开但隐藏/零宽 → `FAIL`；未稳定 → `NOT_APPLICABLE`。
- `toolbar.geometry.pairs`：`row-vs-panel`、`layout-vs-row`、`layout-vs-panel`，
  每项输出 `left/right/width` 实际差值；|差值| ≤1 为 PASS。
- `diagnostics.instanceCounts`：来自状态方块的规范化诊断**事件**计数。
- `diagnostics.projectedRowCount`：展开且面板可见时的**展示行**；收起为 `null`，不是 0 项诊断。
- `diagnostics.domRowCount` / `domBySeverity`：当前 DOM 行；收起 0 行只表示未渲染。
- `diagnostics.multiTarget`：按 `data-diagnostic-id` 分组；同 id 2 行且 warning 事件 1 → PASS。
- `collapsedHitTest`：收起时在 `#write` 三个点做 `elementsFromPoint`；命中
  `[data-inkchapter-ui-root="document-utilities"]` 即 FAIL（不可见面板拦截正文）。
- `content.maxWidthComparison`：`max-width` 是上限，不等于实际 `width`；该字段恒为
  `NOT_APPLICABLE`，不因 860 vs 537.6 改布局。
- `content.writeYNegative` / `bodyRectHeightZero`：仅记录，不作为布局失败。

### 状态色（源码权威）

| `dataset.status` | 颜色 | 含义 |
|---|---|---|
| `GREEN` | `#2f986d` | 0/0/0 且结构已验证 |
| `YELLOW` | `#d49a26` | 有 warning（结构未验证也不灰） |
| `RED` | `#d24d57` | 有 error |
| `HINT` | `#66869f` | 只有 hint |
| `GRAY` | `#929aa4` | 无文档/检测关闭/检测中/无投影/未验证且 0 |

锁定只改外框与 tooltip，不覆盖检测颜色。

## 4. 记录要求

- 每次运行保存 JSON：`gui-acceptance-<run>.json`。
- 截图包含：状态方块、三标签、`#write`、窗口标题。
- A 的验收重点是“10 warning 事件 vs 0 DOM 行”不被误读为 0 诊断。
- B/C 的验收重点是 `tabWidth.verdict`、`geometry.overall.verdict`、`multiTarget.verdict`。
- 若 `presence.toolbarRoot=false`，记录 `location.bodyClass`、Console 错误、`inkchapter-runtime-load.json`；不要重复点击/启动。

## 5. 脚本自测

```bash
node node_modules/vitest/vitest.mjs run src/document-utilities/gui-acceptance-probe-v1.test.ts
```

覆盖：收起、展开、隐藏标签、三个零宽标签、列宽 >1px、筛选视图、多目标 1 事件 2 行、
收起透明层命中、`max-width 860 vs 537.6`、`bodyRect.height=0`、`#write` y 负值。

## 5. 失败诊断顺序

1. Console 是否有 `[InkChapter]` 初始化错误；
2. `inkchapter-runtime-load.json` 的 `mainJsSha256` 是否等于当前 `dist/main.js` 的 `17E64A2…`；
3. `document.body` 是否有 `inkchapter-*` 类；`.inkchapter-doc-toolbar-ui` 是否存在；
4. 若插件未加载：检查 `test/vault/.typora/plugins.json` 是否 `"ranzhi.inkchapter": true`；
5. 若已加载但无工具条：记录 `inkchapter-runtime-load.json` 的 `initializationCount` 与 `loadedAt`，不要伪造。

## 6. 当前状态

- 脚本：`docs/diagnostics/GUI_ACCEPTANCE_DEVTOOLS.js`
- 新构建 SHA：`17E64A21388DDE062A0F0E529AD508DB76BE759F6FD36610F27AC6238B9F5762`
- 旧运行 SHA：`3AFA056A7DAE8D841459CB679D10ED1FDABEB8D2A37EC2FB58A8E8318E6921CD`
- 本会话已关闭旧 Typora，且 `Start-Process`/`cmd start` 均无法重启；需人工启动。
