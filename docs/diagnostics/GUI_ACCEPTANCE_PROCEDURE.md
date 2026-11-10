# GUI 验收脚本与步骤（真实 Typora）

> 本轮 Typora 旧实例运行的是旧 build `3AFA056A…`，集成后的新 build `17E64A2…` 已复制到
> `test/vault/.typora/plugins/dist/main.js`。请**人工启动 Typora**（不是本会话的
> `Start-Process`），打开测试文档后按下列步骤采证。
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

## 2. 采证矩阵

| 运行 | 操作 | 期望 |
|---|---|---|
| A 收起态 | 打开文档，等 1s，执行脚本 | `presence.toolbarRoot=true`；`visibility.toolbarRoot=true`；`statusSemantics.dataset.status=YELLOW`；`warningCount>0`；`square.computed.background-color=rgb(212, 154, 38)`；`layoutRect.width≈40`；`tabs` 不可见 |
| B 展开态 | 单击状态方块（不是双击），执行脚本 | `layoutRect.width≈360`；`tabs` 可见；3 个 `tab` 宽度差 ≤1px；`panelRect` 可见；`diagnostics.total` 与 `dataset` 计数一致 |
| C 锁定态 | 双击状态方块，执行脚本 | `dataset.locked='1'`；`lockFrame` 四边非透明、宽度 >0；`content.lockedDocumentClass=true`；方块颜色仍为 YELLOW/RED（锁不覆盖严重度） |
| D 主题 | 切换明/暗主题，重复 A/B | 方块颜色仍等于 `#d49a26`（YELLOW）或对应状态色；文字/边框可读 |
| E DPI | 系统缩放 100% / 150%，重复 A/B | `dpi.devicePixelRatio` 对应 1/1.5；`layoutRect.width` 稳定为 40/360（允许 1px 误差） |

## 3. 状态方块语义（源码权威）

`document-status-indicator.ts`：

| `dataset.status` | 颜色 | 含义 |
|---|---|---|
| `GREEN` | `#2f986d` | 已检测，0/0/0 且结构已验证 |
| `YELLOW` | `#d49a26` | 有 warning（即使结构未验证也不灰） |
| `RED` | `#d24d57` | 有 error |
| `HINT` | `#66869f` | 只有 hint |
| `GRAY` | `#929aa4` | 无文档/检测关闭/检测中/无投影/未验证且 0 |

锁定只改外框与 tooltip，**不覆盖**检测颜色。

## 4. 记录要求

- 每次运行把返回 JSON 原样保存为 `gui-acceptance-<run>.json`。
- 截图需包含：状态方块、三标签、`#write` 内容区、窗口标题。
- 若是 `YELLOW`，记录 `warningCount`、`diagnostics.rows` 中对应 warning 行。
- 若 `presence.toolbarRoot=false`，先记录 `location.bodyClass`、`console` 错误、`inkchapter-runtime-load.json` 的 `mainJsSha256`；不要重复点击/启动。

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
