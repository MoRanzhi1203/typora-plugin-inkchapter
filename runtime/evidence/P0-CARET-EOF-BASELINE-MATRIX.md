# P0-CARET-EOF-BASELINE-MATRIX

> 轮次：`sess-p0-caret-eof-full-closure`（2026-10-12）｜证据分级：PROVEN / NOT_RUN / PENDING_USER_MANUAL

## 1. 构建 / 部署身份（PROVEN）

| 项 | 值 |
|---|---|
| 本轮基线（修复前）dist/main.js | `430FC94709D506DEF66E57E82E1C349516AF26C2C6BF7A07DB3393E103CC8A4E` |
| 本轮修复后 dist/main.js | `3A165610E9C56F78EE7FA2CEBCF9FEEDAAB69D37A6FA27B0D59CBFB039ADDE10` |
| 本轮修复后 dist/style.css | `2B782DBD1D5172F8A36C204D247926541A6B70E18B00D234BE458490FD6AB414` |
| 部署 test vault main.js | `3A165610…`（`DEPLOY_HASH_MAIN_MATCH=True`） |
| 部署 test vault style.css | `2B782DBD…`（`DEPLOY_HASH_CSS_MATCH=True`） |
| 全局生产（未覆盖） | `DE62CB1A7489E219EF88D4BA0E2431D57506FAAE3D7E2A1433606FD2639A339E` |
| 运行实例已加载（`test/vault/.typora/inkchapter-runtime-load.json`） | `430FC947…`（`loadedAt=2026-10-12T11:04:43.641Z`） |
| 三方核对 | `BUILD==DEPLOY=3A165610` ✅；`LOADED=430FC947` ❌（陈旧，需重启 Typora） |

## 2. 锁定 fixture（PROVEN；未修改任何用户 Markdown）

| 文档 | bytes | LF | sha256 |
|---|---|---|---|
| `test/vault/Document-Diagnostics-Code-Integrity-Test.md` | 1057 | 56 | `8B7AADC4175F29B44D2D3E07242D2331F4122DD143FE35FCBD5370BB33D17CC7` |
| `test/vault/runtime/Document-Diagnostics-Trailing-Blank-3.md` | 39 | 6 | `E0817FC7E2E833D0405E35F3DCE7FA89D5BF2F80FDEBB5D04D237C43D22FA1D4` |
| `test/vault/runtime/Document-Diagnostics-Trailing-Blank-2.md` | 38 | 5 | `7B5626288ED3F20781D09E9F305FD3F27DF6A1F458713F4816EB4CA0D1420D48` |
| `test/vault/runtime/Document-Diagnostics-Trailing-Blank-1.md` | 37 | 4 | `3B500767FCDE98F76F5B454B36C663C35D3BE7BBF2C5DCE8D1E02110D8C77437` |
| `test/vault/runtime/Document-Diagnostics-Trailing-Blank-0.md` | 36 | 3 | `2BC667DD3F4B0208DDD3A033D41EE977BCBC2F056D09E8C68644B674CCCBE027` |

> 注：`Trailing-Blank-{0,1,2,3}` 的**源码 LF 数**（3/4/5/6）与 WYSIWYG **可见空段落数**不同 —— 这正是「源码数 ≠ 可见数」必须分离计数的实证（源码 LF 含最后一行终止换行）。

## 3. C0 / C4 同条件对照（NOT_RUN）

Typora **未运行**（`Get-Process Typora` 为空），且项目硬约束**禁止自行启动/重启/关闭 Typora**。因此本轮**未执行**：

- **C0 原生基线**（vault 内禁用墨章，无插件审计会话）：1 次真实文末 Enter 的 `contentDelta` / `terminalNewlineCount` / `renderedBlankRows` / 1 次 vs 2 次 `SPLIT_1_TO_2` / 最终 Markdown 哈希。
- **C4 墨章全启用**：同 Typora 版本、相同源文本哈希、相同末尾空段落、相同初始光标逻辑位置。

配对条件（已记录，供人工执行）：同 Typora 版本；相同源文本 SHA（见 §2）；相同末尾空段落；相同初始光标逻辑位置；每 case 唯一可信 Enter（受信任键盘事件）。保存后比较 **实际 Markdown 文本哈希**。

- `ENTER_CONTENT_SEMANTICS_MATCH_C0 = NOT_RUN`（不得硬编码 LF +1）。
- 二次 `SPLIT_1_TO_2` 是否造成**额外最终逻辑段落/序列化差异** = NOT_RUN。

## 4. 结论

- 静态/部署：`BUILD=PASS`、`DEPLOY_SHA=PASS`、`ARCHIVE_VERIFY=PASS`。
- 运行时身份：`RUNTIME_IDENTITY=FAIL`（已加载 ≠ 部署；需重启 Typora 加载 `3A165610…`）。
- C0/C4 因果闭环：**NOT_RUN** → 唯一必需人工动作：**重启 Typora 载入新构建后**，对 `Document-Diagnostics-Trailing-Blank-3.md` 执行 C0/C4 配对 Enter。
