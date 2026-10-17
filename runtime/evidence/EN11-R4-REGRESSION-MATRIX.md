# EN11-R4-REGRESSION-MATRIX

> 轮次：`sess-p0-en11-r4`（2026-10-12）｜未执行项一律 `NOT_RUN`/`PENDING_USER_*`，不得判 PASS。

## T — 协调器单元/集成（真实行为，非源码字符串搜索）

| case | 状态 | 证据 |
|---|---|---|
| T01 非 hold 同步绘制 | **PASS** | `presentation-paint-coordinator.test.ts` T1 |
| T02 hold 时只驻留不写 `#write` | **PASS** | T2 |
| T03 同域 10 次 latest-wins | **PASS** | T3（3 次合并；语义等价 10 次） |
| T04 多域各留一个 | **PASS** | T4 |
| T05 release 后一次绘制 | **PASS** | T2/T12 |
| T06 文档切换 DROP_STALE | **PASS** | T5 |
| T07 同 `DIV#write` 但 root 对象更换必须丢弃 | **PASS（R4 新增）** | T13 |
| T08 同文档 revision 上升 → 记 REDERIVED 并按 live 绘制 | **PASS（R4 新增）** | T14 |
| T09 layout epoch 变化重测 | **PASS（R4 新增，与 T08 同路径）** | T14 |
| T10 dispose/inactive 取消 | **PASS** | T9 |
| T11 抛错不阻断编辑、可记录 | **PASS** | T8 |
| T12 **hold 超预算仍不得 paint** | **PASS（R4 红→绿）** | T10 |
| T13 重新收到稳定信号后恢复 | **PASS（R4 红→绿）** | T12 |
| T14 连续 Enter 3/10 次不排队爆炸 | **PASS（有界合并）** | T3/T4 + `MAX_HELD_FRAMES` |
| T15 数量和 Drawer 同源 | NOT_RUN | 需真实运行（DF-05/06/07 已由既有测试覆盖静态） |
| T16 警告展示内容不进入编辑树 | **PASS（静态）** | caret-isolation 单测 + `data-inkchapter-presentation` |
| T17 复合代码题注不塌缩 | NOT_RUN | 需真实交互 |
| T18 主题/窗口变化不残留旧层 | NOT_RUN | 需真实交互 |

## E — 真实编辑

E01–E10：**全部 NOT_RUN / PENDING_USER_MANUAL**（需受信任键入；C0 另需重启切插件）。
唯一相关真实样本：R3 构建的 1 次普通 Enter（见 `EN11-R4-CAUSAL-EXPERIMENTS.md` §1）——属 **HISTORICAL（非本轮 build）**。

## K — 光标与展示隔离

K01–K09：**NOT_RUN / PENDING_USER_MANUAL**（需真实键鼠；本会话无 Selection 采样）。

## V — 诊断与布局

V01–V12：**NOT_RUN / PENDING_USER_VISUAL**（需真实交互/像素）。

## P — 工程门禁

| case | 状态 | 证据 |
|---|---|---|
| P01 WIP/fixture 前后 SHA | **PASS** | `EN11-R4-WIP-IDENTITY.md` §1–3 |
| P02 无旧会话 PASS 污染 | **PASS（R4 加固）** | 脚本新增 ADMISSION 门 + `*_NOT_ADMITTED`；`EN11_ECHO_WINDOW_GATE` 无 Enter 恒 `NOT_RUN` |
| P03 `pnpm exec tsc --noEmit` | **PASS** | TSC_EXIT=0 |
| P04 targeted tests | **PASS** | 20/20（coordinator 15 + hold 5） |
| P05 full tests | **PASS** | 238 files / 4511 tests |
| P06 `pnpm run build:dev` | **PASS** | 含 `ARCHIVE VERIFY=PASS` + 前置 tsc |
| P07 SHA 三方一致 | **PASS** | build==deploy==loaded==`2BAC4003…` |
| P08 PID/HWND/vault/source/init | **PASS** | 17680 / 7933094 / vault / init=1 |
| P09 审计队列零丢失 | **PASS（静态/单元）** | caret 审计覆盖门禁（`AUDITS_DROPPED=0`）；真实采样 NOT_RUN |
| P10 archive append-only verify | **PASS** | ENTRY_COUNT=11，verify PASS |
| P11 全局插件不覆盖 / 原生侧栏不替换 | **PASS** | global=`DE62CB1A…`；`ribbonInjected=false` |
| P12 宿主真实手工验收 | **PENDING_USER_MANUAL** | 需人工操作 |

## 汇总

```
TYPECHECK=PASS
TARGETED_TESTS=PASS (tested=20)
FULL_TESTS=PASS (files=238 tests=4511)
BUILD=PASS
DEPLOY_SHA=PASS
RUNTIME_IDENTITY=PASS
```
E/K/V 真实回归全部未执行 → `FINAL_DECISION=PENDING_USER_MANUAL`。
