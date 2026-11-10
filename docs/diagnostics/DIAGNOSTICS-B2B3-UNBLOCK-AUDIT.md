# B2/B3 阻塞解除专项审计（2026-11-10）

## 0. 构建 SHA 相同的原因（先审计）

- 基线 `76e6420` 时，三个新模块只有 `*.test.ts` 引用；`build.js` 的唯一入口是
  `src/main.ts`，esbuild `bundle:true` + `minify:true` 会把无运行时引用的模块
  tree-shake 掉。
- `build.js` 每次先 `fs.rm('./dist', {recursive:true})`，所以**不是缓存**；相同 SHA
  是因为**入口依赖图没有变化**，与构建错误无关。
- 集成后 `src/main.ts` 已 import `image-evidence-runtime/provider`，重新构建：
  - SHA 从 `3578B8A…` 变为 **`17E64A2…`**；
  - 体积 `2,681,334` → `2,711,425`；
  - bundle 中存在 `BYTE_SNIFF_UNKNOWN`、`IMAGE_EVIDENCE_READY`；
  - `inkchapter-ref:` / `document-cross-file-anchor` 仍不在 bundle（仍仅测试引用）→
    分别为 MODULE_PASS，不是 INTEGRATION_PASS。


> 基线：`main` = `0e4197a6e31969191bfc9c07f967b1275674990c`（已核对 `git rev-parse HEAD`）。
> 本轮分支：`feature/diagnostics-b2d-alignment-crossfile-anchor`。
> 不重跑已完成的 B1/B2/B3；只处理有**新证据/新方案/实际修改**的项。

## 1. 标题 canonical ID / slug / 跨文件链接

### 1.1 审计结果

- 仓库内**没有** slugify / heading-id 生成器；只有 canonical heading 的 `stableIdentity`（内部身份）与运行态 `element.id`（Typora 生成）。
- `stableIdentity` 由 canonical frame 生成，不出现在 Markdown、也不是 Typora 的 URL fragment；不能直接当跨文件 anchor。
- 现有链接检查只做**文件存在性**（`linkTargetMissing` → `fs.existsSync` 缓存），不解析 `#fragment`。
- Typora 1.6.7 的标题 DOM id 由其编辑器在 renderer 内生成，源码层没有可复用的 slug authority；未找到可安全调用的公开接口。
- 因此：**文件存在 + 无 canonical anchor authority 时，只能返回 UNKNOWN，不能返回 MISSING。**

### 1.2 已实现接口

`src/document-utilities/document-cross-file-anchor-v1.ts`：

```ts
resolveCrossFileAnchor({
  baseDir, destination,
  fileExists, readFile, canonicalAnchors?
}): {
  verdict: 'EXISTS' | 'MISSING' | 'UNKNOWN'
  reason: 'ANCHOR_FOUND' | 'ANCHOR_NOT_FOUND' |
          'NO_CANONICAL_ANCHOR_AUTHORITY' | 'TARGET_FILE_MISSING' |
          'TARGET_FILE_UNREADABLE' | 'NOT_A_CROSS_FILE_ANCHOR'
  target, resolvedPath
}
```

决策表：

| 条件 | 结果 |
|---|---|
| 同文件 `#a`、URL、绝对路径、空 anchor | UNKNOWN / NOT_A_CROSS_FILE_ANCHOR |
| 目标文件不存在 | UNKNOWN / TARGET_FILE_MISSING（让文件缺失规则拥有根因） |
| 文件不可读 / 无 baseDir | UNKNOWN |
| 无 canonicalAnchors provider | UNKNOWN / NO_CANONICAL_ANCHOR_AUTHORITY |
| provider 返回 null | UNKNOWN |
| provider 返回 `[]`（明确“无 anchor”） | MISSING |
| provider 明确枚举且不含 anchor | MISSING |
| provider 枚举含 anchor | EXISTS |

测试：`document-cross-file-anchor-v1.test.ts` 9 例，覆盖 percent 编码、同文件/URL/绝对路径、文件缺失、不可读、无权威、空枚举、命中。

### 1.4 Typora DOM heading authority（新增）

`src/document-utilities/document-heading-dom-anchor-v1.ts` 只读取 Typora 实际生成的
`#write h1..h6[id]`：

- `READY`：返回 DOM 顺序的真实 id；
- `UNKNOWN`：root 缺失/断开、重复 id；
- 无 heading 但 root 已连接 → `READY` 空列表；
- 提供 `isSameDocumentPath`，只有目标文件 == 当前活动文件时才可使用该 DOM 权威；
- 6 tests（真实 id、无 id、重复、detached、空、路径大小写）。
- 仍未接入跨文件规则：目标文件不在 DOM 时没有权威 → UNKNOWN。

### 1.3 未接线原因

运行时尚未提供 `canonicalAnchors` provider，因为 Typora 目标文件的 heading id 无法从 Markdown 源可靠重建；如果强行用 GitHub slug 猜测，会把合法链接误报为 MISSING。当前规则保持 DEFERRED；接口已就绪，等待下方“需要人工决定”的 anchor authority。

## 2. 图 / 表 / 公式结构化引用方案

### 2.1 现状

- 题注注册表 `CaptionRegistry` 有稳定 `captionId`；DOM 题注带 `data-inkchapter-caption-id`，owner 带 `data-inkchapter-caption-target-key`。
- 对象编号由 `object-numbering-engine` / caption plan 计算 effective number；图/表/公式的可见编号可重建。
- 没有引用语法解析器：现有 Markdown 中的“图 1-1”只是正文文字，不是可校验引用。
- `captionId` 是持久记录 ID，但**不写入 Markdown 源**；跨文件无法仅从 source 重建。

### 2.2 建议语法（待产品确认，未实现为规则）

保留普通 Markdown 链接，新增插件保留的 fragment 前缀：

```md
[图 1-1](<其他文档.md#inkchapter-ref:figure:cap_ab12>)
[表 2-3](#inkchapter-ref:table:cap_cd34)
[公式 (3-1)](<方法.md#inkchapter-ref:formula:cap_ef56>)
```

- `inkchapter-ref:` 后的 `figure|table|formula` 是对象种类，`cap_*` 是 `CaptionRegistry.captionId`。
- 普通 `#heading` 链接完全不受影响；Typora 仍按普通链接处理（找不到 DOM id 时不跳转，但不会破坏 Markdown）。
- 插件可为题注 DOM 增加 `id="inkchapter-ref:figure:cap_ab12"`（或等价映射），使点击可滚动；**只增 DOM 属性，不改正文**。
- 显示编号仍由 numbering engine 计算；引用文本里的“图 1-1”是用户可读文字，不由插件改写；诊断只校验 fragment 指向的 `captionId` 是否存在。
- 跨文件解析：目标文件的 `CaptionRegistry` 记录可持久化（现有 registry 已有 documentKey），因此可返回 EXISTS/MISSING；目标文件未加载/未索引时返回 UNKNOWN。
- 迁移：旧文纯文字引用不报错；只有带 `inkchapter-ref:` 的链接参与校验；不强制迁移。

### 2.3 已实现（parser only，未启用规则）

`src/document-utilities/document-object-reference-v1.ts` 已实现：

```ts
parseObjectReference('#inkchapter-ref:figure:cap_ab12')
→ { ok: true, reference: { kind: 'figure', captionId: 'cap_ab12', fragment } }
```

- 只接受 `figure|table|formula` + `cap_*`；`figure:1` 明确返回 `DISPLAY_NUMBER_NOT_IDENTITY`；
- 普通 `#heading`、空 fragment、非保留前缀返回 `NOT_OBJECT_REFERENCE`；
- 测试 5 例（含跨文件、percent 编码、非法 kind/id、显示编号、构建器）。
- 仍**不产出诊断、不改 Markdown、不解析 caption registry**；等产品确认持久化位置后再接。

### 2.4 仍需决定

- 是否接受该 fragment 约定（会进入用户可见 URL）。
- `captionId` 的跨文件持久化位置（项目侧 registry 文件 vs 文档 sidecar）。
- 引用文本是否需要自动同步 effective number；若需要，必须定义“用户手写文字 vs 插件生成文字”的边界，避免改正文。

## 3. 表格对齐：存在真实独立缺陷

### 3.1 审计

`document-source-syntax-authority.ts` 的表格识别使用：

```ts
const TABLE_DELIMITER_RE = /^\s*\|?[\s:|-]+\|?\s*$/
```

它只检查字符集合，不校验每个分隔单元格的 GFM 对齐语法。因此：

```md
| A | B |
| :: | --- |
| 1 | 2 |
```

会被识别成表格，但 `::` 不是合法对齐标记；这不是“表头/数据行列数”或“块结构”错误，而是独立的 delimiter cell 语法缺陷。

### 3.2 已实现

- `TABLE_ALIGNMENT_INVALID`（warning，source-range）。
- `analyzeTableAlignment()` 对每个已识别表格拆分 delimiter 行，逐单元格校验 `^\s*:?-+:?\s*$`；每个表格只报第一个非法单元格。
- fenced code 内的伪表格被 `isRangeProtected` 排除。
- 测试 3 例：`::` 触发；`:---`/`---:`/`:---:`/`---` 不触发；fence 内不触发。

## 4. 图片管理可复用能力

### 4.1 审计

- `image-asset-index.ts` 有 `sha256File(filePath): Promise<{sha256,sizeBytes}>`、`ImageAssetIndex.findBySha256()`、`findByLocalPath()`、`mimeType`、`width/height`（当前入库多为 null）。
- `sniffImageFormat(bytes)` 在 `image-download-service.ts`，可识别 png/jpg/gif/bmp/webp/avif/svg。
- 但 `sha256File` 是**异步**，诊断 compute 是同步；不能在渲染线程同步等待 Promise。
- `ImageAssetIndex` 需要服务实例与索引路径，诊断 authority 没有该依赖；资源索引也不是每个本地图片都必然有条目。

### 4.2 已实现运行时链路（源码 + 单测，未做真实 GUI）

- `image-evidence-provider.ts`：异步 `warm(path)`（sha256File + 512B header + sniff），
  `getSync(path)` 纯内存快照；并发去重、失败缓存、无上传/下载；7 tests。
- `image-evidence-runtime.ts`：**文档身份隔离**。`setDocument(docKey)`、`warm(paths)`、
  `get(path)`（只返回当前文档路径集合内）、`invalidatePath`、`invalidateDocument`；5 tests。
- `main.ts`：
  - `prewarmImageEvidenceForActiveDocument()` 在 `edit`、`active-leaf:change`、首次 mount
    事件触发；只扫描本地图片扩展名，异步 warm，不阻塞；
  - evidence 就绪后调用 `requestDiagnosticsRefresh('IMAGE_EVIDENCE_READY')`（rAF/宿主合并）；
  - `getImageEvidenceForDestination(destination)` 是**同步**、docKey 校验后的快照读取；
  - `rewriteInsertedReference` 改写图片目标时 `invalidatePath` 旧/新路径。
- 诊断消费：
  - `DocumentDiagnosticsInput.imageEvidenceByDestination`；
  - `emitB2SourceDiagnostics` 优先使用字节证据：`format=null` → `FIGURE_IMAGE_FORMAT_UNSUPPORTED`（`BYTE_SNIFF_UNKNOWN`）；
  - 有字节证据时不再回退扩展名；无证据时才走现有扩展名规则。
- 未做：真实 Typora 中验证预热时序/UI 刷新；无自动上传/下载。

### 4.3 结论

- 可复用 `sniffImageFormat` 做异步预取；同步诊断只读缓存，不等待 Promise。
- 现有 `FIGURE_IMAGE_FORMAT_UNSUPPORTED` 现在有字节级优先路径；未预热仍是扩展名级。
- 字节级/重复内容规则的“真实运行时验收”仍待 GUI/真实文档证据。

## 5. 真实 Typora GUI 审计

- 运行实例：Typora 1.6.7，主进程 PID 39608，窗口标题 `Document-Diagnostics-Code-Integrity-Test.md - Typora`。
- 当前构建：`17E64A2…`（集成图片证据运行时后）；已复制到 test vault。
- 只读采证：`GUI_ACCEPTANCE_DEVTOOLS.js`（Console 粘贴，无点击/写入），步骤见 `GUI_ACCEPTANCE_PROCEDURE.md`。
- 启动命令只有文档路径，**没有 `--remote-debugging-port`**；监听端口查询无结果，无法通过 CDP 连接。
- 渲染进程带 `--user-data-dir=C:\Users\MSIPC\AppData\Roaming\Typora`；测试 vault 配置指向 `test/vault/.typora/plugins`，但当前窗口未渲染墨章工具条。
- 已尝试隔离 profile 启动第二实例，Typora 单实例行为未产生新窗口；不反复尝试。
- 本轮为验证新构建，先复制 `3578B8A…`，随后集成图片证据运行时并重建为 `17E64A2…`，再次复制到 test vault；关闭旧 Typora 后 `Start-Process`/`cmd start` 均立即退出（exit 0/1/9），无法在本会话重新启动 GUI。当前 Typora 已关闭，需人工重新打开。
- 旧实例的 `inkchapter-runtime-load.json` 证明它运行的是旧构建 `3AFA056A…`，不是当前 `17E64A2…`；工具条未渲染的根因仍需新实例/DevTools 复核。
- 结论：GUI 证据只能人工采证；不得把 Vitest/jsdom 写成真实 GUI 通过。

## 6. 本轮实施清单

| 项 | 状态 | 证据 |
|---|---|---|
| 跨文件 anchor 三态接口 | 已实现（未接 provider） | 9 tests |
| Typora DOM heading authority | 已实现（仅活动文档，未接规则） | 6 tests；重复/断开 → UNKNOWN |
| 表格对齐独立诊断 | 已实现 | 3 tests + 定向 36 tests |
| 结构化引用 parser | 已实现（未启用规则） | 5 tests；拒绝显示编号 |
| 图片异步证据 Provider + Runtime | 已接入源码（未 GUI 验收） | 7 + 5 + 2 tests；文档隔离/失效/字节优先 |
| 图片字节级/重复内容规则 | PARTIAL（仅格式） | 字节证据优先；重复内容未做 |
| GUI 验收脚本 | 已提供 | `GUI_ACCEPTANCE_DEVTOOLS.js` + `GUI_ACCEPTANCE_PROCEDURE.md`（只读 DevTools） |
| GUI 实际采证 | BLOCKED / NEEDS_MANUAL | 旧 build 3AFA；集成 build 17E64A2 已复制；本会话无法重启 Typora |

## 7. 需要人工决定

1. 确认 `captionId` 跨文件持久化位置，并人工实测 `inkchapter-ref:` 在 Typora 的显示/点击/导出行为（当前 parser 已实现，规则未启用）。
2. 提供 Typora 目标文件的 heading DOM 权威（跨文件只有在目标文件也打开/可索引时才能 READY）。
3. 人工启动 Typora，按 `GUI_ACCEPTANCE_PROCEDURE.md` 运行只读脚本，完成 A–E 采证。
4. 若要重复图片内容规则，需批准内容哈希的同文档/跨文档重复语义（当前只做单图格式）。
