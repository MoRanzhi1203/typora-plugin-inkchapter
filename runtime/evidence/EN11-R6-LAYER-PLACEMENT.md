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
