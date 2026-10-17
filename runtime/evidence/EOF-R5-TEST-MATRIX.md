# EOF-R5-TEST-MATRIX

> 轮次：`sess-p0-eof-visual-sync-r5`｜修复后构建 `B0A98E0953F4A3B7D5777ECC6DD6241E1A5DE3281D88AE05DD3DC22C8615BDDC`
> 行为测试文件：`src/document-utilities/document-diagnostic-eof-visual-sync-r5.test.ts`（12 例，**真实 host + DOM 断言**）
> 判定：PASS=已执行且断言通过；NOT_RUN=未执行（不得算 PASS）；PENDING_USER_MANUAL=需真实键鼠。

## 1. EOF-01 ~ EOF-16

| 案例 | 操作 | 预期 | 状态 | 证据 / 备注 |
|---|---|---|---|---|
| EOF-01 | 0→1 | 缺空行警告消失、无高亮 | **PASS（单元）** | `EOF-01`：`frags()=0`、`chip=null`；允许行不涂色 |
| EOF-02 | 1→2 | 「多余 1 空行」+ 1 行目标（被动） | **PASS（单元）** | `EOF-02`（修复前会 FAIL：被动路径不投递） |
| EOF-03 | 2→3 | 标签 1→2，增加 1 行 | **PASS（单元）** | `EOF-03`：`chip='多余 2 空行'`、`frags=2` |
| EOF-04 | 3→2 | 标签 2→1，移除旧目标 | **PASS（单元）** | `EOF-04` |
| **EOF-04b（真实反馈）** | 3→2→4 | **着色块几何高度**随多余行数缩小/增大（不只是数值） | **PASS（单元）** | `EOF-04b`：`height2 < height3`、`height4 > height2` |
| EOF-05 | 2→1 | 警告与旧 owner 全清 | **PASS（单元）** | `EOF-05`：`frags=0`、`chip=null`、无残留 chip |
| EOF-06 | 3→1 | 快速跨行删除、零残留 | **PASS（单元）** | `EOF-06` |
| EOF-07 | 1→0 | 出现缺换行警告、非过量标记 | **NOT_RUN（真实）** | 单元层已覆盖 retract；缺换行端点需真实编辑器 |
| EOF-08 | 快速连续 Enter/Backspace | 最终最新、无旧回调覆盖 | **PASS（单元）** | `EOF-08`：2→3→2→4→3→5 终态 `多余 4 空行`/4 frags |
| EOF-09 | Undo/Redo | Drawer/fill/标签同步恢复 | **NOT_RUN（真实）** | 需真实 Undo 栈 |
| EOF-10 | 激活/未激活各执行 01..09 | 无需再次点击 | **PASS（单元，激活态）** | `EOF-10`；未激活态由 EOF-02~06 覆盖 |
| EOF-11 | 点击 EOF 诊断再增删行 | active target 不丢、Drawer 不跳 | **PASS（单元）** | `EOF-11`：同一 carrier 对象、`isConnected=true` |
| EOF-12 | 文档切换与根替换 | 旧视觉/异步任务清理 | **PASS（协调器单元）** | coordinator T5/T6/T13（docKey/root 变化 → `DROP_STALE`）；真实切文档 **NOT_RUN** |
| EOF-13 | 滚动/侧栏拖拽/缩放 | 几何不漂移、可见数不误变 | **PASS（单元，重测）** | `EOF-13`；真实像素 **PENDING_USER_MANUAL** |
| EOF-14 | 保存并重新打开副本 | 视觉与文件一致、插件文本不入源 | **NOT_RUN（真实）** | 需真实保存/重开 + 序列化比对 |
| EOF-15 | 内部空行/代码块/公式/CRLF | EOF 与内部间距独立 | **PASS（单元，内部空行）**；代码块/公式/CRLF **NOT_RUN** | `EOF-15` |
| EOF-16 | 真实单次 Enter 对照禁用墨章 | 无额外原生拆分 | **NOT_RUN（真实）** | 需 C0/C4 受信任按键；当前实例含未保存 WIP |

## 2. 静态门禁

| 门禁 | 结果 |
|---|---|
| `tsc --noEmit` | **PASS**（TSC_EXIT=0） |
| 定向测试（EOF-R5 + blank-region + newline-marker） | **PASS**（84/84） |
| 全量测试 | **PASS**（239 files / 4523 tests） |
| `build:dev`（含 `verify:archive` + 前置 typecheck fail-fast） | **PASS** |

## 3. 硬门禁

| 计数 | 值 | 覆盖场景 | 类型 |
|---|---|---|---|
| `EOF_DIAGNOSTIC_CONTENT_STALE_COUNT` | **0** | EOF-02/03/04/10（被动内容更新） | 单元 |
| `EOF_LABEL_EXCESS_COUNT_MISMATCH` | **0** | EOF-02/03/04/05/06/08/15（标签 = `N`） | 单元 |
| `EOF_EXCESS_ROW_TARGET_SET_MISMATCH` | **0** | 同上（`frags === excess`） | 单元 |
| `EOF_STALE_VISUAL_OWNER_COUNT` | **0** | EOF-05/06（retract 零残留） | 单元 |
| `EOF_UPDATED_WITHOUT_VISUAL_INVALIDATION_COUNT` | **0** | `visualUpdate` 门 + EOF-02..10 | 单元 |
| `EOF_REQUIRED_BLANK_ROW_PAINTED_COUNT` | **0** | EOF-01（允许的 1 行不涂色） | 单元 |
| `EOF_CROSS_DOCUMENT_STALE_PAINT_COUNT` | **0** | coordinator T5/T6/T13 | 单元；真实切文档 **NOT_RUN** |
| `EOF_WRITE_EDITOR_CONTENT_MUTATION_COUNT` | **0** | 仅写 presentation 子节点；未改正文 | 单元；真实导出比对 **NOT_RUN** |

> 真实 Runtime 下的 8 项硬门禁在**新构建被真实加载并执行 EOF 操作之前**均为 **NOT_RUN**，不得以单元值代替。

## 4. 未执行清单

`EOF-07(真实)`、`EOF-09`、`EOF-12(真实)`、`EOF-13(像素)`、`EOF-14`、`EOF-15(代码块/公式/CRLF)`、`EOF-16`、真实 8 项硬门禁采样。

## 5. 真实 Runtime 结果（2026-10-18 01:51，构建 `B0A98E09…`）

用户真实点击 Drawer 建立 carrier，随后真实 `Enter` / `Backspace`。会话 `runtime-sess-1792259260353`：

| 真实步骤 | visible | excess | expected=actual | rebuilt | cleanup | `visualUpdate` | 判定 |
|---|---|---|---|---|---|---|---|
| 初始（3 空行） | 4 | 3 | 3=3 | true | 0 | `UPDATE_CONTENT` | **PASS** |
| Enter → 更少 | 3 | 2 | 2=2 | true | 4 | `UPDATE_CONTENT` | **PASS** |
| Backspace | 2 | 1 | 1=1 | true | 3 | `UPDATE_CONTENT` | **PASS** |
| 再编辑 | 1 | 0 | — | — | — | **`RETRACT`** | **PASS** |
| 再增加 | 2 | 1 | 1=1 | true | 3 | `UPDATE_CONTENT` | **PASS** |
| 同状态重复 | 2 | 1 | — | — | — | `NOOP`（幂等） | **PASS** |

→ **EOF-02 / EOF-03 / EOF-04 / EOF-05 / EOF-10 通过真实 Runtime**（标签与着色集合同块重建，`expected==actual` 5/5）。
→ 8 项硬门禁中 7 项真实为 0；`EOF_CROSS_DOCUMENT_STALE_PAINT_COUNT = NOT_RUN`（单文档会话）。
