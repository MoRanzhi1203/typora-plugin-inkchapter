# EN11-R4-WIP-IDENTITY

> 轮次：`sess-p0-en11-r4`（2026-10-12）｜只读快照；未改动用户文件、未 commit。

## 1. 代码库 / WIP

- 分支 `archive/document-diagnostics-copy-sort-ui-v1`｜HEAD `35b294998d54f24f84019fad2f6371db55920dcb`。
- WIP（全部保留）：`package.json`、`src/document-utilities/document-diagnostic-caret-isolation-v1.{ts,test.ts}`、`src/document-utilities/document-utility-overlay-host.ts`、`src/document-utilities/enter-echo-write-trace.ts`、`src/document-utilities/document-diagnostic-blank-row-acceptance-hold-v1.test.ts`、`src/heading-numbering/heading-numbering-service.ts`、`scripts/verify-p0-caret-eof-postrestart.ps1`(新)、`src/core/build-pipeline-fail-fast.test.ts`(新)、`src/document-utilities/presentation-paint-coordinator.{ts,test.ts}`(新)。
- 未执行 `git reset --hard` / `git clean` / 强制结束 Typora / `git commit`；全局生产插件未覆盖。

## 2. 构建 / 部署 / 加载身份（独立取值）

| 层 | 值 |
|---|---|
| 历史参考（R3 候选） | `741663E93C20E992422CAF28B911976DD25DF203890CDE184DF2CF35644CEB56` |
| 本轮 BUILD `dist/main.js` | `2BAC40036D3676193884FA6A96D0C2C95D012FC5DD85CA8D75F14702B3BB5758` |
| `dist/style.css` | `2B782DBD1D5172F8A36C204D247926541A6B70E18B00D234BE458490FD6AB414` |
| 部署 TEST_VAULT main.js | `2BAC4003…`（`DEPLOY_HASH_MAIN_MATCH=True`） |
| 真实加载 `inkchapter-runtime-load.json` | `mainJsSha256=2BAC4003…`、`loadSource=vault`、`initializationCount=1`、`loadedAt=2026-10-12T13:02:24.212Z` |
| 进程 | PID `17680`｜HWND `7933094`｜Responding=True（CIM 分离式启动） |
| 全局生产 | `DE62CB1A…`（未覆盖） |

**RUNTIME_IDENTITY=PASS**（BUILD==DEPLOY==LOADED）。

## 3. fixture（未修改）

| 文档 | bytes | LF | sha256 |
|---|---|---|---|
| `test/vault/runtime/Document-Diagnostics-Trailing-Blank-3.md` | 39 | 6 | `E0817FC7E2E833D0405E35F3DCE7FA89D5BF2F80FDEBB5D04D237C43D22FA1D4` |
| `test/vault/Document-Diagnostics-Code-Integrity-Test.md` | 1057 | 56 | `8B7AADC4175F29B44D2D3E07242D2331F4122DD143FE35FCBD5370BB33D17CC7` |

## 4. R3 证据报告存在性

`runtime/evidence/EN11-R3-{IDENTITY-AND-WIP,CAUSAL-TIMELINE,C0-C4-B-C-D-MATRIX,PATCH-AND-TESTS,FINAL-ACCEPTANCE}.md` 与 `runtime/evidence/P0-EN11-ENTER-DUPLICATE-SPLIT.md` 均 **EXISTS**（未覆盖历史）。

## 5. 结论

```
WIP_GATE=PASS
RUNTIME_IDENTITY=PASS（2BAC4003…, source=vault, init=1, PID 17680）
```
