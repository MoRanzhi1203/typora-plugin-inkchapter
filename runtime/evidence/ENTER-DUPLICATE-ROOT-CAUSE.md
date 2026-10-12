# ENTER-DUPLICATE-ROOT-CAUSE

任务：文末一次 Enter 出现两次 `SPLIT_1_TO_2`。本文给出真实 Runtime 证据、归属结论、以及被排除的假设。

## 1. 时间线（真实 Runtime）

| 来源 | 时间 | 事件 |
|---|---|---|
| `app-1791790437618.log` | 07:33:43.331 | `ENTER-DUPLICATE-SPLIT-AFTER-FINAL` `duplicateSplitIndex=2` `windowMs=99` |
| 同上 | 07:33:43.338 | `ENTER-ECHO-DOM-WRITE-TRACE` `recordCount=14` |
| `test/vault/.typora/inkchapter-enter-echo-trace.json` | 07:33:43.332 | 14 条调用栈（`NENTER-1-1791790423196`） |
| 上一轮 `B0478F8B…` | 22:03:47.048 / .121 | 首次 `SPLIT_1_TO_2` → `NORMAL-ENTER-FINAL` → **第二次** `SPLIT_1_TO_2`（`windowMs=73`） |

真实 SHA：`9297F6CC0178833E0C16C02598265CE5BFA91EDDBB33BB0841CC084452185021`（与上传日志加载值一致）。

## 2. 归属结论（已由纠正后真实轨迹**确证**）

纠正后的真实轨迹（`test/vault/.typora/inkchapter-enter-echo-trace.json`，15:47:18）：

```
txn=NENTER-2-1791791237938  duplicateSplitIndex=2  windowMs=70
recordCount=14   truncated=false
structuralRecordCount=0        ← 无任何结构写入（appendChild/insertBefore/removeChild/replaceChild）
pluginStructuralWriteCount=0   ← 无任何「插件来源」的结构写入
endBlockRenormalization=true   ← 批次含 P.md-end-block
origin: plugin=0  typora=14  unknown=0
kinds: attr:setAttribute×8  attr:removeAttribute×6   （全部为属性写入）
```

**结论（定案）**：第二次 `SPLIT_1_TO_2` = **Typora 自身对尾块 `P.md-end-block` 的重建（原生中间态）**。插件在该窗口内**没有发起任何结构写入，也没有任何插件来源的写入**（14/14 为 Typora 来源、且全为属性类）。→ **不是插件 DOM 写入诱发的。**

对照上一版（未修正归因）的 14 条同一数据，修正后 `plugin=0 / typora=14`，证明此前「插件写入」的判断是**仪器自身帧误归因**造成的假象。

### 归属算法修正（§B2）
`firstFrames(4)` 丢弃 `firstFrames` / `noteEnterEchoWrite` / wrapper 三层自身帧，取**首个真实外部业务帧**；`classifyWriteOrigin()` 含 `typora://` ⇒ `typora`，业务 `main.js` ⇒ `plugin`，否则 `unknown`；`struct:` 与 `attr:` 分类归档。

14 条记录**全部**是 **对 `P.md-end-block.md-p`（Typora 尾块）的 `setAttribute` / `removeAttribute`**，且**调用方为 Typora 自身**：

```
… HTMLParagraphElement.a [as setAttribute]   ← tracer wrapper（main.js）
  ← Function.L [as find]        (typora://…/frame.js:29:37359)
  ← F.fn.init.find              (typora://…/frame.js:29:54671)
  ← Editor.refocus              (typora://…/frame.js:1:450253)
  ← a.exeCommand / i.brushNode  (typora://…/frame.js)
或
  ← w.breakOn                   (typora://…/frame.js:1:43692)
  ← Editor.pressReturn          (typora://…/frame.js:1:502747)
  ← HTMLDivElement.<anonymous>  (typora://…/frame.js:1:469967)
或
  ← Editor.refocus → Editor.pressReturn (…:1:503679) → HTMLDivElement.<anonymous> (…:1:471560)
```

**关键观察**：同一次 Enter 内出现 **两条不同的 `Editor.pressReturn` 路径**（`w.breakOn` @502747 与 `Editor.refocus` @503679）以及 **两个不同的 `HTMLDivElement` 处理函数**（@469967 与 @471560）→ **Typora 自身的尾块重建序列被执行了两次**，这正是第二次 `SPLIT_1_TO_2`。

**结构写入记录数 = 0**：`appendChild / insertBefore / removeChild / replaceChild` **一条都没有**。属性写入**不能**作为结构性第二次拆分的直接调用栈证据（§0 明确）。

### 归属算法修正（§B2）
此前 `stackIsPluginOwned` 会命中 **tracer 自身帧**（也在 `main.js`），把 Typora 的写入误判为插件写入。已改为：
- `firstFrames(4)` —— 丢弃 `firstFrames` / `noteEnterEchoWrite` / wrapper 三层自身帧，取**首个真实外部业务帧**；
- `classifyWriteOrigin(stack)` —— 含 `typora://` 帧 ⇒ `typora`；含 `main.js` 业务帧 ⇒ `plugin`；否则 `unknown`；
- 记录 `origin`，并把 `struct:` 与 `attr:` 分类归档（属性写入永不冒充结构证据）。

## 3. 首次真正产生错误的源头

`P.md-end-block` 是 Typora **始终存在的尾部 end block**。在文末按 Enter 时，Typora 自己的 `Editor.pressReturn` 会重建该尾块；MutationObserver 随后看到第二次 `SPLIT_1_TO_2` —— 这是 **Typora 原生的中间态**，不是第二次用户 Enter。

## 4. 被排除的假设

| 假设 | 结论 | 证据 |
|---|---|---|
| 插件延迟段落样式写在回声窗口内诱发 | **排除** | `ENTER-ECHO-STYLE-WRITE-DEFERRED` 已生效（22:03:47.086），重复拆分仍出现（22:03:47.121） |
| 插件把 overlay 层插入 `#write` 诱发 | **排除（该 Enter）** | 手埋点 `write:WRITE.appendChild(layer)` 等 4 处 `recordCount=0` |
| 插件做结构写入（插入/删除节点） | **本次未观测到** | 宽域追踪器结构记录数 0 |
| `recordCount=0` ⇒ 全 DOM 无写入 / 一定原生 | **不得如此推断**（覆盖有限） | tracer 仅覆盖 `Node/Element` mutation 方法 |

## 5. 覆盖与未知（coverage / unknown）

- **已覆盖**：`Node.appendChild/insertBefore/removeChild/replaceChild`、`Element.setAttribute/removeAttribute/insertAdjacentElement/remove`；仅测试文档、单次 Enter、250ms 有界窗口（上限 24 条，满额 `truncated=true`）。
- **未覆盖**：`innerHTML/outerHTML` 写入、`Range` 操作、Typora editor 内部非方法路径（如直接操作内部模型）。
- 因此「结构记录 0」只说明**这些方法的路径**未发生插件结构写入，**不能**推断为「原生确定」。
