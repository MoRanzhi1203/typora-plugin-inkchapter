# EN11-R3-IDENTITY-AND-WIP

> 轮次：`sess-p0-en11-causal-closure-r3`（2026-10-12）｜只读身份/WIP 快照，未改动用户文件。

## 1. 代码库

- 分支：`archive/document-diagnostics-copy-sort-ui-v1`｜HEAD：`35b294998d54f24f84019fad2f6371db55920dcb`。
- 未提交 WIP（全部保留，未 commit、未 reset、未 clean）：
  - `M package.json`（build fail-fast：build:dev/build 前置 typecheck）
  - `M src/document-utilities/document-diagnostic-caret-isolation-v1.ts` / `.test.ts`
  - `M src/document-utilities/document-utility-overlay-host.ts`
  - `M src/document-utilities/enter-echo-write-trace.ts`
  - `M src/document-utilities/document-diagnostic-blank-row-acceptance-hold-v1.test.ts`
  - `M src/heading-numbering/heading-numbering-service.ts`
  - `?? src/core/build-pipeline-fail-fast.test.ts`
  - `?? scripts/verify-p0-caret-eof-postrestart.ps1`
  - 本轮新增：`?? src/document-utilities/presentation-paint-coordinator.ts` / `.test.ts`
- 未执行任何 `git reset --hard` / `git clean` / 强制结束 Typora / Git 提交。

## 2. 构建 / 部署 / 加载身份（来自不同来源，禁止 SHA 自比）

| 层 | 值 |
|---|---|
| 旧候选（本轮修复前） | `9146A7B07386448BA0E88CBC19624C31DD56E58B8D72D4B099A39AA367D3E9F1` |
| 本轮新构建 BUILD `dist/main.js` | `741663E93C20E992422CAF28B911976DD25DF203890CDE184DF2CF35644CEB56` |
| 本轮新构建 `dist/style.css` | `2B782DBD1D5172F8A36C204D247926541A6B70E18B00D234BE458490FD6AB414` |
| 部署 TEST_VAULT `test/vault/.typora/plugins/dist/main.js` | `741663E9…`（`DEPLOY_HASH_MAIN_MATCH=True`） |
| **真实加载** `test/vault/.typora/inkchapter-runtime-load.json` | `mainJsSha256=741663E9…`，`loadSource=vault`，`initializationCount=1`，`loadedAt=2026-10-12T12:40:27.266Z` |
| 进程 | PID `44588`｜HWND `13703080`｜Responding=True（启动方式：`Win32_Process.Create` 分离式，避免终端 job 回收） |
| 全局生产插件（未覆盖） | `DE62CB1A7489E219EF88D4BA0E2431D57506FAAE3D7E2A1433606FD2639A339E` |

**RUNTIME_IDENTITY = PASS**（BUILD == DEPLOY == LOADED，三方独立取值）。

## 3. 锁定 fixture（未修改）

| 文档 | bytes | LF | sha256 |
|---|---|---|---|
| `test/vault/runtime/Document-Diagnostics-Trailing-Blank-3.md` | 39 | 6 | `E0817FC7E2E833D0405E35F3DCE7FA89D5BF2F80FDEBB5D04D237C43D22FA1D4` |
| `test/vault/Document-Diagnostics-Code-Integrity-Test.md` | 1057 | 56 | `8B7AADC4175F29B44D2D3E07242D2331F4122DD143FE35FCBD5370BB33D17CC7` |

无 `•`（未保存）文档被强制关闭；用户 Markdown 与配置未被本脚本修改。

## 4. 历史证据报告存在性

- `runtime/evidence/P0-EN11-ENTER-DUPLICATE-SPLIT.md`：EXISTS（上一轮）。
- `runtime/evidence/ENTER-EOF-ROOT-CAUSE.md`、`ENTER-EOF-FIX-REPORT.md`、`ENTER-EOF-RUNTIME-ACCEPTANCE.md`、`ENTER-EOF-CONTROL-MATRIX.md`、`ENTER-EOF-IDENTITY-MATRIX.md`、`ENTER-EOF-STRUCTURAL-WRITES.md`、`ENTER-DUPLICATE-ROOT-CAUSE.md`、`ENTER-DUPLICATE-FIX-REPORT.md`、`ENTER-DUPLICATE-RUNTIME-MATRIX.md`：EXISTS。
- 本轮产出：本文 + `EN11-R3-CAUSAL-TIMELINE.md` / `EN11-R3-C0-C4-B-C-D-MATRIX.md` / `EN11-R3-PATCH-AND-TESTS.md` / `EN11-R3-FINAL-ACCEPTANCE.md`（均为新增，不覆盖历史源证据）。

## 5. 结论（本文件）

```
RUNTIME_IDENTITY=PASS
WIP_PRESERVED=YES
GIT_COMMIT=NONE
```
