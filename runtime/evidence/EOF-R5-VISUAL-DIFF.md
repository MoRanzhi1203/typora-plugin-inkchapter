# EOF-R5-VISUAL-DIFF

> 轮次：`sess-p0-eof-visual-sync-r5`｜修复前构建 `2BAC4003…` → 修复后构建 `B0A98E0953F4A3B7D5777ECC6DD6241E1A5DE3281D88AE05DD3DC22C8615BDDC`

## 1. 身份与指纹（新增）

| 维度 | 字段 | 覆盖 |
|---|---|---|
| 诊断身份 | `diagnosticId` / `targetIdentity` | 规则与语义位置（稳定，不承载计数） |
| **内容指纹** | `contentFingerprint` | `documentKey + rule + mode + visibleBlankCount + excessCount + detail` |
| **几何指纹** | `geometryFingerprint` | `editorRootIdentity(WeakMap 单调) + sourceRevision + layoutEpoch + trailingRowCount` |
| 发布判定 | `diagnosticDiff` | 身份/集合：`NONE` / `REMOVE`（**不再**表示内容未变） |
| **视觉判定** | `visualUpdate` | `UPDATE_CONTENT` / `UPDATE_GEOMETRY` / `RETRACT` / `NOOP` |

`diagnosticDiff=NONE` **不再**阻止视觉更新；视觉只消费 `visualUpdate`。

## 2. old / new 片段目标（真实行为）

| 场景 | old | new | 标签 | 覆盖行 |
|---|---|---|---|---|
| 2→3 | 1 frag | 2 frags | `多余 1 空行` → `多余 2 空行` | 移除旧的 1 行目标，重建 2 行 |
| 3→2 | 2 frags | 1 frag | `多余 2 空行` → `多余 1 空行` | 清理过期 1 行 |
| 2→1 | 1 frag + chip | 0 | chip 删除 | 全清（允许行不涂色） |
| 3→1 | 2 frags + chip | 0 | chip 删除 | 零残留 |
| 1→2 | 0 | 1 frag + chip | `多余 1 空行` | 被动路径重新建立 |
| 0→1 | 0 | 0 | 无 | 允许行 **不** 涂色 |

## 3. owner / 清理语义

- 清理仅作用于 **本 owner** 的 `inkchapter-block-gap-fragment` 与 `inkchapter-blank-run-count` 子节点（`clearEofExcessFragments`），**不删除** carrier 盒子，不影响其它规则/其它 owner。
- 原子替换：先清理旧集合，再从**实时 DOM 行**重建（`paintDocEndExcessRows`）。
- 删除诊断（`publish=false`）→ `EOF_TAIL_RETRACT`：label + fill 同提交清理。

## 4. 旧片段残留风险处置

- `lastEofFragmentSetSignature` 在 retract 时置 `null`，防止“同签名跳过重建”。
- `geo.rect == null` **不再**无条件清空；仅 `liveExcessRows === 0` 时清理。
- 几何不可测（`excessVisibleRows == null`）→ 保留当前视觉，不误判为 0 行。

## 5. 与其它链路的关系（未改动）

- Drawer：仍由 snapshot/Drawer 渲染读取同一 `eofPublishedDetail`；本轮不强制重挂载、不重置滚动。
- 计数源：Drawer / 标签 / 着色均读同一 `renderedVisibleBlankCount - 1`。
- 原生 Enter / `。。+Enter` / 原生侧栏：未改动。
