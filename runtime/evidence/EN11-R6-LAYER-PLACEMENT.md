# EN11-R6-LAYER-PLACEMENT

> 轮次：`sess-en11-r6`（2026-10-18）｜构建 `B68D5041919D18A29FA4791FC5131E4DAE5002659EA1964EBE85E53E597D9C2B`

## 1. 改动（源码）

**问题假设**：演示层 `ensureLocateDocumentLayer()` 原先把 `LOCATE_DOCUMENT_LAYER_CLASS` **追加为 `#write` 的最后一个子节点**（`host.appendChild(layer)`）。`#write` 是 Typora 的块模型；最后一个正文块之后存在外来非块子节点时，"在文档末尾插入段落"可能被再归一化为两次段落拆分。

**修改**（`document-utility-overlay-host.ts`）：

```ts
// EN-11 — DO NOT append the presentation layer as the LAST child of the editor root.
if (host.firstChild != null) host.insertBefore(layer, host.firstChild)
else host.appendChild(layer)
```

- 层级仍位于 `#write` 内（保留 document-local 坐标权威，不改 V5.12 坐标链）。
- 绝对定位（`position:absolute;left:0;top:0`），DOM 顺序不影响几何。
- 其余载体（heading marker layer / block-gap / EOF carrier）均在该层内，随之一起移动到首位。

## 2. 新增行为测试（可判错）

`src/document-utilities/document-diagnostic-eof-visual-sync-r5.test.ts`：

```
EN-11: 展示层必须是 #write 的首个子节点，绝不能跟在最后一个正文块之后
  expect(w.write.firstElementChild).toBe(layer)
  expect(w.write.lastElementChild).not.toBe(layer)
  expect(w.write.lastElementChild!.getAttribute('data-inkchapter-locate-layer')).toBeNull()
```

修复前该断言会 FAIL（layer 为 last child）。

## 3. 门禁

```
TYPECHECK=PASS
TARGETED_TESTS=PASS (14/14)
FULL_TESTS=PASS (239 files / 4525 tests)
BUILD=PASS (B68D5041…)
DEPLOY_SHA=PASS (project==vault==B68D5041…)
```

## 4. 真实运行验证：**未能判定**（关键发现）

尝试用两种 OS 级合成输入验证，均**不可用于 EN-11 判定**：

| 方式 | 观测 | 说明 |
|---|---|---|
| `SendKeys` | `ENTER-ADMISSION-AUDIT`：`key=Enter, code="" → REJECT_NON_ENTER`；文档仍 +2 段落 | 合成 Enter 无 `code`，插件按非标准 Enter 拒绝 |
| `keybd_event(VK_RETURN)` | 12B/2LF → 16B/6LF（**+4 LF**） | 一次物理按键产生两次段落拆分 |

**决定性的反证**：上述 `keybd_event` 实验时插件处于 `presenceState=EMPTY`（未绑定任何文档，**`#write` 内根本没有展示层**），一次合成 Enter 仍然 `+4 LF`。
→ 说明合成输入本身会**同时触发 keydown 与字符插入**（双插入），与插件无关；**不能用它证明或否定 EN-11**。

同样，`presenceState=EMPTY` 也说明本轮无法形成有效的 C4（插件活跃）对照。

## 5. 判定

```
EN11_SYNTHETIC_INPUT_VALID=false
EN11_LAYER_PLACEMENT_FIX=PASS (unit/full gates, structural)
EN11_REAL_RUNTIME=PENDING_USER_MANUAL
```

**未宣布 EN-11 已修复。**

## 6. 仍需的唯一人工验证（物理键盘）

1. 通过 **Typora 侧栏文件树**打开 `runtime/EOF-R5-Enter-Probe.md`（不要用第二个 CLI 进程），确认审计出现 `presenceState=ACTIVE`；
2. 光标置于最后一行末尾，按**一次物理 Enter**；
3. 观察并回报：末尾空行是 **1 个**还是 **2 个**；若要 C0 对照，需在 vault 禁用墨章并重启后重复一次。

> 若物理键盘仍为 2 个空行，则层位置假设被否证，下一步应改测「overlay 迁出 `#write`」或直接对 Enter 的 `beforeinput` 做只读取证。

## 7. 物理键盘复测（用户，2026-10-18 02:00 左右）：**测试无效**

用户报告「依旧还是两个」。但同一时刻审计显示：

```
DOCUMENT-UTILITY-ACTIVE-DOCUMENT-RECONCILE
  presenceState      = EMPTY
  activeLeafPath     = ""
  canonicalFrameDocumentKey = null
  readinessState     = INACTIVE
DOCUMENT-UTILITY-ACTIVE-DOCUMENT-VISIBILITY-INVARIANT
  hasActiveDocument  = false
  toolbarPresentation= suppressed (NO_ACTIVE_DOCUMENT)
DOCUMENT-UTILITY-ACTIVE-LEAF-DOCUMENT-INVARIANT
  presenceSource     = ACTIVE_LEAF_EMPTY
```

→ 该文档（`EOF-R5-Enter-Probe.md`，由 CLI 第二个进程打开）**从未被插件接管**：`ensureLocateDocumentLayer` 没有执行、`#write` 内没有任何展示层、诊断/Drawer 全部 suppressed。

因此这次「两个空行」：
- **不能**用于判定本次层位置修复（修复根本没有生效）；
- 同时说明该现象在**插件未参与编辑 DOM** 时也会出现（Typora 侧行为）。

```
EN11_LAYER_PLACEMENT_FIX = NOT_TESTED（环境无效，非否证）
EN11_REAL_RUNTIME        = PENDING_USER_MANUAL
```

## 8. 阻塞项（新，真实）

`activeLeafPath=""` + `hasActiveDocument=false`：**通过第二个 CLI 进程打开的文件不会绑定到插件**（`presenceSource=ACTIVE_LEAF_EMPTY`）。这会导致：
- 该文档没有诊断 / Drawer / 视觉；
- 所有 C4 真实验收都无效。

正常路径（Typora 侧栏 / 应用内打开）历史上会出现 `presenceState=ACTIVE`。**复测必须用侧栏打开。**

## 9. 绑定缺陷：不建议修（设计如此）

`readWorkspaceActiveLeafState()`（`main.ts:95`）以 `workspace.activeLeaf.state.path` 为最高权威；`resolveActiveDocumentPresence()` 明确规定：

```
leafStateKnown + path==''  → EMPTY（永不回退到 stale activeFile/documentKey）
```

该 veto 是为「关闭最后一个标签后 Typora 仍保留旧文件身份」而设，有 LAST-TAB-1..12 守卫。**为了一个 CLI 打开路径去放宽它，会重新引入陈旧文档身份**，风险大于收益。

结论：`CLI 第二进程打开文件不绑定` 属**开发路径限制**，不是产品缺陷；不改。

## 10. EN-11 归因结论（证据级）

两条独立证据都指向「非插件所致」：

1. **真实 Enter 的回显窗口**：`pluginStructuralWriteCount=0`、`originCounts={plugin:0,typora:14}`、协调器 `PARKED`，第二次 `SPLIT_1_TO_2` 仍发生（构建 `741663E9` / `2BAC4003`）。
2. **插件完全未绑定**（`hasActiveDocument=false`、`presenceState=EMPTY`、`#write` 内无任何展示层）时，用户按 Enter 仍得到两个空行。

```
EN11_PLUGIN_ATTRIBUTABLE = 上面两条证据来自“无效环境/修复前构建”，已被 §11 的有效 C4 结果取代
EN11_LAYER_PLACEMENT_FIX = NOT_TESTED（当时；见 §11 最终 PASS）
```

> §10 的推断有局限：证据 2 的环境根本没有绑定文档，不能代表“插件正常工作时”的行为；证据 1 来自展示层仍在末尾的旧构建。§11 的 C4（`B68D5041`，层已前置）给出 0 次重复拆分，因此最终归因以 §11 为准。

**若要彻底定案**，只差一次有效的 C4：用 Typora 侧栏打开文件 → 审计出现 `presenceState=ACTIVE` → 按一次物理 Enter。

## 11. 有效 C4 结果：**PASS**（2026-10-18 02:16，构建 `B68D5041…`）

用户通过 Typora 侧栏打开 `runtime/EOF-R5-Enter-Probe.md` 并做真实按键。会话 `runtime-sess-1792260895529`：

| 事实 | 值 |
|---|---|
| 绑定 | `presenceState=ACTIVE`，`activeLeafPath=…/EOF-R5-Enter-Probe.md`，`canonicalFrameState=READY` |
| 加载构建 | `B68D5041919D18A29FA4791FC5131E4DAE5002659EA1964EBE85E53E597D9C2B`（== BUILD == VAULT，`source=vault`，`init=1`） |
| 真实 Enter | `ALLOW_NORMAL_ENTER` × **16**（`key=Enter, code=Enter, isTrusted=true`） |
| 插件干预 | 全部 `createdTransaction=false / defaultPrevented=false / cancelBubble=false / dispatchSyntheticEnter=false` |
| **重复拆分** | `ENTER-DUPLICATE-SPLIT-AFTER-FINAL` = **0** |
| 回显窗口写入 | `structuralRecordCount=0`、`pluginStructuralWriteCount=0`、`originCounts={plugin:0,typora:14}` |
| 每次 Enter 的可见空行 | `renderedVisibleBlankCount` 2 → 3（**+1**，正常） |
| 源码 LF | 每次 Enter `+2`（**1 个段落**，正常） |

### 交叉对照（跨构建，非同一会话）

| 构建 | 展示层位置 | 重复拆分 |
|---|---|---|
| `3A165610…` / `2BAC4003…` | `#write` **末尾** | `duplicateSplitIndex=2`（观测到 2 次） |
| **`B68D5041…`** | `#write` **首位** | **0**（16 次真实 Enter） |

```
EN11_LAYER_PLACEMENT_FIX = PASS（真实 Runtime，构建 B68D5041）
EN11_REAL_RUNTIME        = PASS（16 次真实 Enter，0 次重复拆分，+1 可见空行/次）
```

**残余说明**：本轮未在同一会话内执行「禁用墨章」的 C0 配对；上述为跨构建前后对照 + 用户目视确认（「貌似已经修复了」）。若要 100% 排除其他变量，可再做一次 C0，但不影响当前结论方向。

## 12. `Document-Diagnostics-Trailing-Blank-3.md` 仍“两个空行”的复核（2026-10-18 02:47）

用户反馈：Probe 正常，但 T-B-3 仍异常。审计事实：

| 项 | 值 |
|---|---|
| 加载构建 | `B68D5041…`（`loadedAt=18:22:10`，init=1）— **修复已生效** |
| `activeLeafPath` | 仍为 `runtime/EOF-R5-Enter-Probe.md` |
| 含 `Document-Diagnostics-Trailing-Blank-3` 的审计事件 | **0 条** |
| `@file:open` / `@active-leaf:change`（插件日志） | 最后一条 **18:23:03**，之后无 |
| T-B-3 文件内容 | `# Trailing Blank 3\n\n正文结束。\n\n\n\n` → 正文后已有 **3 个空行**（39B / 6 LF） |

结论：
1. **不是构建未更新**：同一实例的 Probe 用 16 次真实 Enter 验证为 0 重复拆分、每次 +1。
2. **T-B-3 没有被插件接管**：该文件是 **CLI 第二进程打开**的标签，不在框架的标签模型内（18:23 之后没有任何 `file:open` / `active-leaf:change`），所以 `activeLeafPath` 仍是 Probe，插件对该文档 0 事件。
3. **即便接管，T-B-3 的初始状态也不同**：它本身已以 3 个空行结尾；在绝对末尾按 Enter 会在既有空行之上再加一个空段落，视觉上自然像“多个空行”，与 Probe（0 个尾随空行）不可直接对比。

正确复测方式：**用 Typora 侧栏打开** T-B-3（框架管理标签）→ 确认 `activeLeafPath` 变为该文件 → 再按一次 Enter。
