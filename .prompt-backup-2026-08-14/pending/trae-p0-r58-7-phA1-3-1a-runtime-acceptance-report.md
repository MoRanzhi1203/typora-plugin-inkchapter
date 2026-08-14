# R58.7 Phase A.1.3.1a — Runtime Acceptance 测试报告

> Build ID: `inkchapter-r58-7-phA1-3-1a-scope-authority-k9m4v`
>
> 测试日期: ________
>
> 测试人: ________
>
> 测试环境: Typora (PID: ____) | Untitled | EPHEMERAL mode

---

## 1. 启动验证

| 项目 | 预期值 | 实测值 | PASS? |
|------|--------|--------|-------|
| old process exited | yes | | |
| new PID | non-zero | | |
| StartTime | after restart | | |
| MainWindowHandle | != 0 | | |
| MainWindowTitle | non-empty | | |
| target vault | test\vault | | |
| plugin main SHA | `________` | | |
| project dist SHA | `________` | | |
| shaMatch | true | | |
| style SHA | `________` | | |
| Build ID | `inkchapter-r58-7-phA1-3-1a-scope-authority-k9m4v` | | |
| initializationCount | 1 | | |

---

## 2. Test Sequence

操作步骤（在 Untitled 中执行）：

```
1. 输入 `。。` + Enter     (Enter #1)
2. 输入 `。。` + Enter     (Enter #2)
3. 在已有缩进行按 Enter   (Split #1)
4. 输入 `。。` + Enter     (Enter #3)
5. Backspace 缩进行       (Backspace #1)
6. 输入 `。。` + Enter     (Enter #4)
7. 在已有缩进行按 Enter   (Split #2)
8. 输入 `。。` + Enter     (Enter #5)
9. 在已有缩进行按 Enter   (Split #3)
10. Backspace 缩进行      (Backspace #2)
```

**执行次数记录**:

| 操作 | 预期 | 执行 | 成功 | 失败原因 |
|------|------|------|------|---------|
| `。。+Enter` | 5 | | | |
| Split | 3 | | | |
| Backspace | 2 | | | |

---

## 3. Mandatory Trace — Scope Identity

### 3.1 RUNTIME-SCOPE-SNAPSHOT

| # | Transaction | scopeId | persistenceKey | mode | sessionId | editorInstanceId | PASS? |
|---|-------------|---------|----------------|------|-----------|------------------|-------|
| 1 | | | | | | | |
| 2 | | | | | | | |
| 3 | | | | | | | |
| 4 | | | | | | | |
| 5 | | | | | | | |

**判定**: 每个 transaction 可追踪 scopeId 非空 → PASS / FAIL

---

### 3.2 RECORD-LIFECYCLE

| # | event | recordId | scopeId | persistenceKey | state | documentKey=""? | PASS? |
|---|-------|----------|---------|----------------|-------|-----------------|-------|
| 1 | REGISTER_CURRENT | | | | | YES / NO | |
| 2 | REGISTER_CURRENT | | | | | YES / NO | |
| 3 | AWAIT_TRANSFER | | | | | YES / NO | |
| 4 | TRANSFER | | | | | YES / NO | |
| 5 | REGISTER_CURRENT | | | | | YES / NO | |
| 6 | REGISTER_CURRENT | | | | | YES / NO | |
| 7 | AWAIT_TRANSFER | | | | | YES / NO | |
| 8 | TRANSFER | | | | | YES / NO | |
| 9 | REGISTER_CURRENT | | | | | YES / NO | |
| 10 | AWAIT_TRANSFER | | | | | YES / NO | |
| 11 | TRANSFER | | | | | YES / NO | |

**判定**:
- ALL CURRENT_* scopeId non-empty → PASS / FAIL
- documentKey="" as runtime namespace count = 0 → PASS / FAIL

---

### 3.3 LIVE-REPLACEMENT-TICKET

| # | ticketId | recordId | scopeId | source | PASS? |
|---|----------|----------|---------|--------|-------|
| 1 | | | | | |
| 2 | | | | | |
| 3 | | | | | |

**判定**: ALL tickets scopeId non-empty → PASS / FAIL

---

### 3.4 CARET-EXPECTATION-CREATE

| # | expectationId | scopeId | reason | intentEpoch | expectedRuntimeId | PASS? |
|---|---------------|---------|--------|-------------|-------------------|-------|
| 1 | | | | | | |
| 2 | | | | | | |
| 3 | | | | | | |

**判定**: ALL expectations scopeId non-empty → PASS / FAIL

---

### 3.5 HANDOFF-CREATE

| # | handoffId | scopeId | intentEpoch | canonicalRecordId | PASS? |
|---|-----------|---------|-------------|-------------------|-------|
| 1 | | | | | |
| 2 | | | | | |
| 3 | | | | | |

**判定**: ALL handoffs scopeId non-empty → PASS / FAIL

---

### 3.6 HANDOFF-CLOSE (如有)

| # | handoffId | scopeId | reason | PASS? |
|---|-----------|---------|--------|-------|
| 1 | | | | |

---

### 3.7 CANONICAL-BINDING-TRANSFER

| # | canonicalRecordId | scopeId | fromRuntimeId | toRuntimeId | generation delta | reason | PASS? |
|---|-------------------|---------|---------------|-------------|-----------------|--------|-------|
| 1 | | | | | | | |
| 2 | | | | | | | |
| 3 | | | | | | | |

**判定**: ALL transfers scopeId non-empty → PASS / FAIL

---

## 4. CANONICAL-SCOPE-MISMATCH

| # | recordId | recordScopeId | operationScopeId | operation | decision | state/reCount/generation unchanged? | PASS? |
|---|----------|---------------|------------------|-----------|----------|-------------------------------------|-------|
| -- | -- | -- | -- | -- | -- | -- | -- |

> 正常 EPHEMERAL runtime 中预期 CANONICAL-SCOPE-MISMATCH count = 0。
> 主动构造失败路径测试记录在 Section 8。

---

## 5. Scope Authorization 汇总

| 子系统 | scopeId 结构存在 | scope authorization 接入 | 跨 scope 阻断 | PASS? |
|--------|-----------------|-------------------------|--------------|-------|
| CanonicalRuntimeMeta | YES | assertCanonicalScope | BLOCK | |
| markAwaitingTransfer | YES | assertCanonicalScope | BLOCK | |
| transferCanonicalBinding | YES | assertCanonicalScope | BLOCK | |
| retireRecord | YES | assertCanonicalScope | BLOCK | |
| promoteExistingByRecordId | YES | assertCanonicalScope | BLOCK | |
| validateMutation | YES | assertCanonicalScope | BLOCK | |
| LiveReplacementTicket | YES | markAwait/transfer | CLOSE | |
| CaretExpectation | YES | restore guard (SCOPE_CHANGED) | CLOSE | |
| OneShotHandoff | YES | resolve guard (SCOPE_CHANGED) | CLOSE | |

---

## 6. Regression Gate

| 检查项 | 预期 | 实测 | PASS? |
|--------|------|------|-------|
| `。。+Enter` | 5/5 成功 | | |
| Split | 5/5 成功 | | |
| Selection/Caret verify | PASS | | |
| SIDECAR-WRITE-SKIP | mode=EPHEMERAL, reason=PERSISTENCE_NOT_READY | | |
| SINGLE-DOT-CURRENT-LIVE | decision=INFO | | |
| SINGLE_DOT_SEMANTIC_VIOLATION CURRENT_LIVE | false positive count = 0 | | |
| Special Command regression | 无 | | |
| Sidecar suppression regression | 无 | | |

---

## 7. Guard Order Verification

### CaretExpectation

```
scope mismatch → SCOPE_CHANGED → else if intentEpoch superseded → SUPERSEDED
```

| 验证点 | 通过? | 说明 |
|--------|-------|------|
| scope mismatch 关闭 CARET-EXPECTATION-CLOSE reason=SCOPE_CHANGED | | |
| scope mismatch 前 restoreAttempted=false | | |
| CARET-EXPECTATION-CLOSE trace 含 scopeId | | |

### Handoff

| 验证点 | 通过? | 说明 |
|--------|-------|------|
| scope mismatch 关闭 HANDOFF-CLOSE reason=SCOPE_CHANGED | | |
| HANDOFF-CLOSE trace 含 scopeId | | |

---

## 8. Failure-Path Acceptance (主动构造)

> 以下需人为构造 S1 record + S2 operation，验证 BLOCK。

| 操作 | recordScopeId | operationScopeId | 预期 | 实测 decision | state unchanged? | count unchanged? | PASS? |
|------|---------------|------------------|------|---------------|------------------|------------------|-------|
| TRANSFER → cross-scope | S1 | S2 | BLOCK | | | | |
| REUSE → cross-scope | S1 | S2 | BLOCK | | | | |
| AWAIT → cross-scope | S1 | S2 | BLOCK | | | | |
| CARET RESTORE → cross-scope | S1 | S2 | SCOPE_CHANGED | | | | |
| HANDOFF RESOLVE → cross-scope | S1 | S2 | SCOPE_CHANGED | | | | |

---

## 9. Final Verdict

```
[ ] R58.7 PHASE A.1.3.1a PASS — RUNTIME SCOPE AUTHORITY CLOSED
[ ] R58.7 PHASE A.1.3.1a NOT FIXED — R60 BLOCKED
```

问题记录:

```

```

---

## 10. Raw Console Logs (粘贴关键片段)

```
<!-- 粘贴 Typora DevTools Console 中 [InkChapter] 开头的关键日志 -->
```
