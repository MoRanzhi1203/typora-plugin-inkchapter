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
