# 文件树 ↔ Windows 资源管理器拖拽 R2 — 复制完整性证据

日期：2026-10-20
证据类型：**真实文件系统自动化**（不是真实 OS 拖拽）
结论：源文件从未被移动/删除；所有成功复制均为 `fs.copyFile`，源/目标 SHA256 一致。

## 1. 服务级真实复制证据

测试：`src/file-transfer/file-copy-service.test.ts`

```
[EVIDENCE][COPY] {
  "source": "...\\ink-file-copy-DnQgmK\\sources\\a.md",
  "destination": "...\\ink-file-copy-DnQgmK\\vault\\docs\\a.md",
  "sourceHashBefore": "6ea8f5fb9ae99984ed3bd9008ac53c45336bd588eaa214966e67d57913fe1c68",
  "sourceHashAfter":  "6ea8f5fb9ae99984ed3bd9008ac53c45336bd588eaa214966e67d57913fe1c68",
  "destinationHash":  "6ea8f5fb9ae99984ed3bd9008ac53c45336bd588eaa214966e67d57913fe1c68",
  "sourceStillExists": true,
  "bytes": 15
}
```

判定：

- 源存在：`true`
- 源 SHA 前后一致：`true`
- 目标 SHA 与源一致：`true`
- 复制方式：`fs.promises.copyFile`（无 `rename` / `unlink` / `move`）

## 2. DOM 拖放端到端证据（jsdom → 策略 → 真实 fs）

测试：`src/file-transfer/file-tree-drop.integration.test.ts`

```
[EVIDENCE][E2E-DROP] {
  "source": "...\\ink-drop-e2e-tUO3OO\\sources\\note.md",
  "destination": "...\\ink-drop-e2e-tUO3OO\\vault\\docs\\note.md",
  "sourceHashBefore": "950b748a5e1dc31a43100f23bf39513c56416d0d46d5598295ce35a6f7c02659",
  "sourceHashAfter":  "950b748a5e1dc31a43100f23bf39513c56416d0d46d5598295ce35a6f7c02659",
  "destinationHash":  "950b748a5e1dc31a43100f23bf39513c56416d0d46d5598295ce35a6f7c02659",
  "sourceStillExists": true,
  "destinationExists": true,
  "nativeMoveHandlerRan": false
}
```

判定：

- 真实目标文件已创建：`true`
- 源文件仍存在：`true`
- 源/目标 SHA 一致：`true`
- 模拟的原生移动 handler 未执行：`true`

> 注意：`nativeMoveHandlerRan=false` 只证明事件层被阻断；真实 Typora 原生 `copyOrMoveFiles` 的阻断仍需人工 D01 验证。

## 3. 边界样本（真实 fs）

| 样本 | 结果 |
|---|---|
| 0 字节 `empty.md` | PASS，目标 0 字节，SHA `E3B0C442...` |
| `中文 名称（空格）.md` | PASS，文件名与字节一致 |
| `crlf.md`（`\r\n`） | PASS，SHA `4AD3EF64...` |
| `Note.md` 与 `note.md` 同名大小写冲突 | PASS，生成 `note (2).md`，原目标不变 |
| 父级 junction 指向 vault 外 | PASS 拒绝，`DESTINATION_OUTSIDE_VAULT` / `detail=REALPATH`，目标未写入 |
| 源文件符号链接 | PASS 拒绝，`SOURCE_SYMLINK_REJECTED` |
| 目标目录符号链接 | PASS 拒绝，`DESTINATION_SYMLINK_REJECTED` |
| 目标越界 / 不存在 / 非目录 | PASS 拒绝，未产生目标文件 |
| 批量中一个源缺失 | PASS，其余文件继续复制，源缺失项失败 |

## 4. 人工测试夹具的基线 SHA256

源目录：`C:\Users\MSIPC\AppData\Local\Temp\inkchapter-drag-r2\sources`

| 文件 | 字节 | SHA256 |
|---|---:|---|
| `D01-single.md` | 18 | `75C9FB6C8B192904B94E24F191772F6917136DFCB0559CFC8F96F1E55917D2CD` |
| `D04-batch-a.md` | 19 | `80381751B913FC545CB60865E86207BF1B94AE6D9A240AAFE247173B03CF49A2` |
| `D04-batch-b.markdown` | 19 | `05C43E2B27C68C638CECD6E7106CE8F35D04C90465FE027B2080690706A57295` |
| `D05-conflict.md` | 15 | `BE60390DD684E7D12529A5EAFBD34897F139EEFFDFCEDF3094CEB4C5F6174579` |
| `中文 空格.md` | 21 | `4AE27530129B7FE37B90168B0754BF94D1E9A9B2C8F80F5EC628902BDBD4EFA7` |
| `case-note.md` | 18 | `516EA8D7A58EC7CCA3EEA99CBD01FD9A8F285CA051611F93A75FB090D486123A` |
| `D06-ignored.txt` | 18 | `37D44512025E81CF0AEC48E55AE358748C64F922D04E8F1AE5696889E3E610CC` |
| `empty.md` | 0 | `E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855` |
| `crlf.md` | 14 | `4AD3EF64DFB83F7A8F789BCE6F30CC1F8D18491B14DB4C875309B150D2A7D213` |

预置目标：

| 文件 | 字节 | SHA256 |
|---|---:|---|
| `...\file-tree-drag-r2\conflict\D05-conflict.md` | 21 | `F9B558C961353B7154C066E73C34406678581A2FE9902FF0BF000CC4CAB9EE63` |
| `...\file-tree-drag-r2\conflict\case-note.MD` | 18 | `9FF8A032597F9FB31E368D053A454C282A1AA6D018843881E6BD7C76FF6F9AD6` |

## 5. 人工验收后可用的核对命令

```powershell
# 源与目标逐字节对比
$src = "$env:TEMP\inkchapter-drag-r2\sources\D01-single.md"
$dst = "D:\TyporaPluginProjects\typora-plugin-inkchapter\test\vault\墨章插件测试\file-tree-drag-r2\root\D01-single.md"
(Get-FileHash $src -Algorithm SHA256).Hash
(Get-FileHash $dst -Algorithm SHA256).Hash
Test-Path $src
(Get-Item $src).Length
(Get-Item $dst).Length

# 同名冲突
Get-ChildItem "D:\TyporaPluginProjects\typora-plugin-inkchapter\test\vault\墨章插件测试\file-tree-drag-r2\conflict" |
  Select-Object Name,Length
```

只有源/目标 SHA 一致、源仍存在、目标真实存在时，人工项才可记为 PASS。

## 6. 运行时（真实 Typora 渲染器）证据

候选构建 `DD4F6646...` 已真实加载到测试 vault。以下证据来自真实渲染器，不是 jsdom。

### 6.1 合成 drop（集成证据，非 OS 拖拽）

在真实 `#file-library-tree` 的 `root` 节点上派发合成 drop（`DataTransfer.files[0].path` 指向临时源文件）：

| 项目 | 值 |
|---|---|
| 目标目录 | `test\vault\墨章插件测试\file-tree-drag-r2\root` |
| 观察到文件 | `D01-single.md`（创建 17:43:34）、`D01-single (2).md`（创建 17:44:23）；至少一次由合成 drop 驱动，不能把两个副本全部归因于合成事件 |
| 源文件 | `%TEMP%\inkchapter-drag-r2\sources\D01-single.md` |
| 源 SHA | `75C9FB6C8B192904B94E24F191772F6917136DFCB0559CFC8F96F1E55917D2CD` |
| 目标 SHA | 两个目标均为 `75C9FB6C8B192904B94E24F191772F6917136DFCB0559CFC8F96F1E55917D2CD` |
| 源存在 | true |
| 原生移动 handler | 被捕获阶段阻断（合成 drop 的 `defaultPrevented=true`） |

验证后已清理 `root` 下这两个测试副本，保留 SHA 证据；`root` 当前为空，便于人工 D01 重新执行。

### 6.2 真实拖出复制观察

| 项目 | 值 |
|---|---|
| 源文件 | `test\vault\Figure-Standalone-Block-Invariant-Test.md` |
| 目标 | `%TEMP%\inkchapter-drag-r2\sources\Figure-Standalone-Block-Invariant-Test.md` |
| 源存在 | true |
| 目标存在 | true |
| 源 SHA | `52BB2189232F1B736AC645EF969874F5ECF3AF88C8457B6B408D2A1FA3720CE7` |
| 目标 SHA | `52BB2189232F1B736AC645EF969874F5ECF3AF88C8457B6B408D2A1FA3720CE7` |
| 长度 | 1328 / 1328 |
| 目标创建时间 | 2026-10-20 17:49:15 |
| 结论 | 真实 OS 拖出产生了副本，源未被移动/删除；完整 D09/D10 收据仍需人工复验 |

> 该观察由 OS 级自动化鼠标输入产生，不是合成 `DragEvent`。但完整 D01–D12 真实 GUI 验收仍为 PENDING_USER_MANUAL。

### 6.3 真实拖入副本（OS 级自动化鼠标输入）

测试 vault 根目录观察到以下真实拖入副本（输入来源：Win32 `mouse_event`，非合成 `DragEvent`）：

| 目标文件（已移动到 evidence/os-drag-artifacts） | 长度 | 创建时间 | SHA256 |
|---|---:|---|---|
| `os-dragin-中文 空格.md` | 21 | 2026-10-20 17:49:27 | `4AE27530129B7FE37B90168B0754BF94D1E9A9B2C8F80F5EC628902BDBD4EFA7` |
| `os-dragin-中文 空格 (2).md` | 21 | 2026-10-20 17:49:31 | `4AE27530129B7FE37B90168B0754BF94D1E9A9B2C8F80F5EC628902BDBD4EFA7` |
| `os-dragin-empty.md` | 0 | 2026-10-20 17:57:50 | `E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855` |

对应源文件（`%TEMP%\inkchapter-drag-r2\sources`）：

| 源文件 | 长度 | SHA256 | 源是否仍存在 |
|---|---:|---|---|
| `中文 空格.md` | 21 | `4AE27530129B7FE37B90168B0754BF94D1E9A9B2C8F80F5EC628902BDBD4EFA7` | true |
| `empty.md` | 0 | `E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855` | true |

判定：

- 真实 OS 拖入（根目录）产生副本：**是**
- 同名冲突生成 `中文 空格 (2).md`：**是**（原目标未被覆盖）
- 中文/空格文件名：**是**
- 0 字节 Markdown：**是**
- 源文件未被移动/删除/覆盖：**是**
- 目标文件已移动到 `runtime/evidence/.../os-drag-artifacts/`，测试 vault 根目录已清理

> 输入来源为 OS 级自动化鼠标，不是人工鼠标；完整人工 D01–D12 收据仍为 PENDING_USER_MANUAL。该组证据足以证明真实运行时复制路径、冲突命名与源文件保留。

## 7. 真实 OS 鼠标拖拽复制证据（2026-10-20 19:00–19:29）

证据分级：**OS** = Win32 `SendInput` 真实鼠标；**DOM** = 真实渲染器 DevTools 读数（仅测量/核验，无合成 Drop）；**SVC** = 真实 fs 服务测试。

### 7.1 拖入（Explorer → 文件树）

| 目标文件 | 字节 | 创建时间 | SHA256 | 源仍存在 |
|---|---:|---|---|---|
| `root\D01-single.md` | 18 | 18:59:37 | `75C9FB6C8B192904B94E24F191772F6917136DFCB0559CFC8F96F1E55917D2CD` | 是 |
| `conflict\D05-conflict (2).md` | 15 | 19:04:25 | `BE60390DD684E7D12529A5EAFBD34897F139EEFFDFCEDF3094CEB4C5F6174579` | 是 |
| `conflict\crlf.md` | 14 | 19:06:21 | `4AD3EF64DFB83F7A8F789BCE6F30CC1F8D18491B14DB4C875309B150D2A7D213` | 是 |
| `conflict\case-note (2).md` | 18 | 19:06:21 | `516EA8D7A58EC7CCA3EEA99CBD01FD9A8F285CA051611F93A75FB090D486123A` | 是 |
| `internal\D04-batch-a.md` 等 3 份 | 19 | 19:12–19:14 | `80381751B913FC545CB60865E86207BF1B94AE6D9A240AAFE247173B03CF49A2` | 是 |
| `expanded\D04-batch-a.md`（窗口 700px 宽时） | 19 | 19:15:15 | `80381751B913FC545CB60865E86207BF1B94AE6D9A240AAFE247173B03CF49A2` | 是 |
| `root\D01-single.md` + `root\crlf.md`（修复后回归，一次 drop 2 个） | 18 / 14 | 19:26:24 | `75C9FB6C...` / `4AD3EF...` | 是 |
| `unexpanded\empty.md`（0 字节） | 0 | 19:26:58 | `E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855` | 是 |

未覆盖与冲突：

- 预置 `conflict\D05-conflict.md` 保持 21 B、SHA `F9B558C961353B7154C066E73C34406678581A2FE9902FF0BF000CC4CAB9EE63`、mtime 17:15:57，未被覆盖。
- 预置 `conflict\case-note.MD` 保持 18 B、SHA `9FF8A032597F9FB31E368D053A454C282A1AA6D018843881E6BD7C76FF6F9AD6`（大小写同名冲突被重命名为 `case-note (2).md`）。
- `D06-ignored.txt` 真实拖入被拒：`failedCount=1`，vault 内不存在任何 `.txt` 副本。
- 适配器计数与文件一一对应（D01→1；D05→2；批量 drop→+1；宽度回归→+1），未出现重复处理。

### 7.2 拖出（文件树 → Explorer，源保留）

| 目标副本 | 字节 | 创建时间 | SHA256 | 源仍存在 |
|---|---:|---|---|---|
| `%TEMP%\...\sources\D05-conflict (2).md`（跨盘 D:→C:） | 15 | 19:05:19 | `BE60390DD684E7D12529A5EAFBD34897F139EEFFDFCEDF3094CEB4C5F6174579` | 是 |
| `%TEMP%\...\sources\internal-b.md`（跨盘 D:→C:） | 18 | 19:26:42 | `6D112941267C3F262C493FFEE23D05A7609E1634D8FFB5481D3712BB7CD8847E` | 是 |
| `...\file-tree-drag-r2\expanded\D01-single.md`（同盘 D:→D:） | 18 | 19:28:49 | `75C9FB6C8B192904B94E24F191772F6917136DFCB0559CFC8F96F1E55917D2CD` | 是 |

归档副本（`os-drag-artifacts/`）：

| 文件 | 字节 | SHA256 |
|---|---:|---|
| `os-dragin-D01-single.md` | 18 | `75C9FB6C8B192904B94E24F191772F6917136DFCB0559CFC8F96F1E55917D2CD` |
| `os-dragin-D05-conflict-2.md` | 15 | `BE60390DD684E7D12529A5EAFBD34897F139EEFFDFCEDF3094CEB4C5F6174579` |
| `os-dragout-internal-b.md` | 18 | `6D112941267C3F262C493FFEE23D05A7609E1634D8FFB5481D3712BB7CD8847E` |
| `os-dragout-same-volume-D01-single.md` | 18 | `75C9FB6C8B192904B94E24F191772F6917136DFCB0559CFC8F96F1E55917D2CD` |

### 7.3 D07 修复前后对比（真实 OS 内部拖放）

| 阶段 | 结果 | 适配器 |
|---|---|---|
| 修复前（`DD4F...`） | `internal-a.md` 拖到 `root` 后，源与目标同时存在（复制） | `externalDropCount` +1 |
| 修复后（`420B9E4C...`） | `internal-a.md` 从 `internal` 消失并出现在 `root`（原生移动） | `externalDropCount` 不变（0） |

> 验证后已将 `internal-a.md` 移回 `internal`、删除测试副本，夹具恢复基线；上述真实复制件均已归档到 `os-drag-artifacts/`。

### 7.4 D06 拒绝路径（真实 OS，2026-10-24 04:03–04:04）

源夹具：`%TEMP%\inkchapter-drag-r2\d06\`（保留以便复现）

| 拖入对象 | 类型 | 运行通知（OCR 实测） | vault 是否产生副本 | 源状态 |
|---|---|---|---|---|
| `folder-source`（含 `inside.md` 26 B） | 普通目录 | `墨章：已复制 0 个文件到「root」`；`墨章：folder-source：源路径不是普通文件` | 否（递归检索无 `folder-source` / `inside.md`） | 目录与 `inside.md` 完整（26 B，mtime 04:01:35） |
| `junction-dir` → `folder-source` | 目录 junction（LinkType=Junction） | `墨章：已复制 0 个文件到「root」`；`墨章：junction-dir：不支持符号链接` | 否 | junction 仍存在，Target 不变 |

说明：

- 真实**文件**符号链接创建需要管理员权限（`New-Item -ItemType SymbolicLink` 返回“此操作需要管理员权限”），因此改用目录 junction。
- Node `lstat` 对 junction 同样返回 `isSymbolicLink()=true`，运行时命中的是 `SOURCE_SYMLINK_REJECTED` 分支，与单测断言一致。
- 两次拖入均由真实 OS 鼠标完成；适配器拦截并拒绝，Typora 原生“移动”未执行（源目录/junction 均未消失）。

### 7.5 D09 桌面拖出 / D11 未保存副本 / ACL 拒写（真实 OS，2026-10-24 04:2x）

| 项目 | 结果 | SHA / 证据 |
|---|---|---|
| D09 桌面文件夹 | `internal-b.md` → `D:\MSIPC\Desktop\近代史作业\internal-b.md`，18 B | `6D112941267C3F262C493FFEE23D05A7609E1634D8FFB5481D3712BB7CD8847E`；源保留；副本已删除 |
| D09 桌面根（2026-10-24 06:0x 复测） | `Generic-Locator-Runtime-Test.md` → `D:\MSIPC\Desktop\Generic-Locator-Runtime-Test.md`，398 B | `7F4E6B3BDE8759856888CC0A6494646E138890AD48FA8AD33EFD55442BA5D893`；kdesk64（PID 14956）接收落点；源保留；副本已删除 |
| D11 未保存拖出（磁盘副本） | `internal-a.md`（未保存）→ `out-d11\internal-a.md`，18 B | `B90773886B5ADE73FC3EEA626E95304B6EEABE75DF6E693C9541F87EE190E32B`（磁盘版本）；磁盘文件 mtime 17:15:57 未变；文档保持未保存 |
| D11 未保存告警（修复后） | 脏文档拖出 → `modified:true / warning:WARN` | `editedAt=2026-10-23T21:29:17.709Z` vs `fileMtime=2026-10-23T21:17:01.030Z`；OCR 捕获“墨章：当前文档有未保存修改…请先保存（Ctrl+S）”；`Ctrl+S` 后 `fileMtime=21:29:42.226Z`、干净文档均 `warning:NONE`；审计 `runtime-sess-1792790938027.log` |
| ACL 拒写（2026-10-24 06:2x 复测） | `acl-target` 仅 `RX`；直接写入被拒；真实拖入 `D05-conflict.md` 后目录为空 | 源 `D05-conflict.md` 18 B 保留；截图 OCR：“已复制 0 个文件到「acl-target」，1 个失败”“D05-conflict.md：复制失败 (EPERM)”；`acl-target` 已恢复 ACL 并删除 |

说明：D11 的磁盘版本复制语义已证实（副本 SHA 等于磁盘文件而非修改缓冲区）。告警修复后已在真实 OS 拖拽中经审计日志与截图 OCR 双双取证，判定机制为“`#write` 内编辑事件时间戳 vs 文件 mtime（`> mtime + 1s`）”，因为 Typora 1.6.7 的 `hasMidified` 运行时恒为 false。最终构建 `CB60457608E65901A037105B3712EA2771938F036AA7BDD5900220AE6150D63E`。

### 7.6 D12 真正重叠（2026-10-24 06:4x，修复后）

| 项目 | 结果 | 证据 |
|---|---|---|
| 首拖：1148 个 `.md` 批量导入 | 复制进行中 | 多选后真实拖入 vault 根；落点后 0.4 s 已复制 21 个，随后 291、1148；审计 `started, sourcesCount=1148`；测试后全部删除 |
| 第二拖：复制未完成时拖入 `D05-conflict.md` | 命中 busy 分支，未产生副本 | 审计 `INKCHAPTER-FILE-DRAG-IN-DROP`：`{"phase":"busy","processing":true,"sourcesCount":1,"targetDirectory":null}`（`runtime-sess-1792794717701.log`，22:45:48.172Z）；`D05-conflict.md` 未出现在 vault 根 |
| busy 提示 | 代码路径已执行 | 同一分支调用 `Notice.info('墨章：上一批文件仍在导入，请稍候')`；本轮以审计作为确定性证据，通知为瞬时 UI |

说明：本卷对大文件复制存在近似块克隆的快速路径（3 GB/8 GB 单文件亚秒级完成），无法以单文件制造 busy 窗口；改用 1148 文件批次拉长复制时间，并以真实 OS 拖拽触发重叠。修复内容见 `OS-DRAG-RUNTIME-MATRIX.md` §2.2：`internalDragActive` 残留会让 `dragover` 不再 `preventDefault`，`drop` 根本不触发；现已增加 mouseup / 失焦 / visibilitychange 兜底与 15 s TTL，并新增拖入决策审计。



