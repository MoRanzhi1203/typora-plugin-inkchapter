# B2/B3 阻塞解除专项审计（2026-11-10）

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

### 4.2 已实现 Provider（模块级，未接运行时预热）

`src/image-management/image-evidence-provider.ts`：

- `warm(path)`：异步调用现有 `sha256File` + 512 字节 header + `sniffImageFormat`；并发去重；失败缓存为 `ERROR`，不重复打 IO。
- `getSync(path)`：纯内存快照，无文件 IO、无哈希；未预热/失败返回 `null`（UNKNOWN）。
- `invalidate(path?)`；无上传/下载能力。
- 7 tests：预热前 UNKNOWN、缓存复用、并发去重、force 重算、ERROR 不重试、未知格式 null、invalidate。
- 尚未接入诊断 rule/DOM 预热；诊断仍用扩展名级 `FIGURE_IMAGE_FORMAT_UNSUPPORTED`，不把模块存在写成字节级规则已上线。

### 4.3 结论

- 可复用 `sniffImageFormat` 做**未来异步预取**；不能把 async 索引硬塞进同步诊断。
- 现有 `FIGURE_IMAGE_FORMAT_UNSUPPORTED` 仍只做“显式非图片扩展名”保守判断，不冒充字节级格式检测。
- 若要字节级/重复内容规则：需要异步 `ImageEvidenceProvider`（预热缓存 + 诊断读取缓存值），并明确“未预热 = UNKNOWN”。

## 5. 真实 Typora GUI 审计

- 运行实例：Typora 1.6.7，主进程 PID 39608，窗口标题 `Document-Diagnostics-Code-Integrity-Test.md - Typora`。
- 启动命令只有文档路径，**没有 `--remote-debugging-port`**；监听端口查询无结果，无法通过 CDP 连接。
- 渲染进程带 `--user-data-dir=C:\Users\MSIPC\AppData\Roaming\Typora`；测试 vault 配置指向 `test/vault/.typora/plugins`，但当前窗口未渲染墨章工具条。
- 已尝试隔离 profile 启动第二实例，Typora 单实例行为未产生新窗口；不反复尝试。
- 本轮为验证新构建，复制 `dist/main.js`（SHA `3578B8A…`）到 test vault 并关闭旧 Typora；随后 `Start-Process`/`cmd start` 启动均立即退出（exit 0/1/9），无法在本会话重新启动 GUI。当前 Typora 已关闭，需人工重新打开。
- 旧实例的 `inkchapter-runtime-load.json` 证明它运行的是旧构建 `3AFA056A…`，不是当前 `3578B8A…`；工具条未渲染的根因仍需新实例/DevTools 复核。
- 结论：GUI 证据只能人工采证；不得把 Vitest/jsdom 写成真实 GUI 通过。

## 6. 本轮实施清单

| 项 | 状态 | 证据 |
|---|---|---|
| 跨文件 anchor 三态接口 | 已实现（未接 provider） | 9 tests |
| 表格对齐独立诊断 | 已实现 | 3 tests + 定向 36 tests |
| 结构化引用 parser | 已实现（未启用规则） | 5 tests；拒绝显示编号 |
| 图片异步证据 Provider | 已实现（未接运行时） | 7 tests；复用 sha256File/sniffImageFormat |
| 图片字节级格式/重复内容 | 未实施（异步 provider 未接诊断） | 见 §4 |
| GUI | BLOCKED / NEEDS_MANUAL | 旧 build 3AFA；新 build 3578 已复制；Typora 无法在本会话重启 |

## 7. 需要人工决定

1. 确认 `captionId` 跨文件持久化位置，并人工实测 `inkchapter-ref:` 在 Typora 的显示/点击/导出行为（当前 parser 已实现，规则未启用）。
2. 提供 Typora heading id 的 canonical 生成接口（或接受 GitHub slug 作为权威）。
3. 批准并接线异步 `ImageEvidenceProvider` 的运行时预热（格式 + SHA-256 + 尺寸）；当前仅模块级实现，无诊断规则消费。
4. 人工启动 Typora（当前实例已在采证中关闭，本会话 `Start-Process` 均退出），加载 test vault 新 build 后完成 GUI 采证（B1-07/B3-04）。
