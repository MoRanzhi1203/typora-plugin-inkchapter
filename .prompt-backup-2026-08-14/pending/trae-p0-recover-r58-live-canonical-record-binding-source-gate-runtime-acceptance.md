# Trae P0 — Recover and Implement R58 Live Canonical Record Binding Before R60

> Project: `typora-plugin-inkchapter`
>
> Priority: **P0**
>
> Purpose: **Recover the missing R58 business implementation, block temporary/live canonical records from heuristic rehydrate, complete source/runtime acceptance, then explicitly unlock R60 forensic work.**
>
> Status on entry: **R60 is blocked by `R58_SOURCE_NOT_PRESENT`.**
>
> This task is **not** a Build ID rename task and **not** an R60 instrumentation task.

---

## 0. Current forensic conclusion

The latest R60 source gate found all of the following missing:

```text
CANONICAL-RECORD-COMMIT
CANONICAL-RECORD-BACKSPACE
LIVE-BINDING-RESOLUTION
MATCH-LIVE-BINDING
LiveParagraphRecordBinding
```

Current source effectively contains:

- R57:
  - Selection Resolver
  - Verify-First Caret
  - Runtime ID
  - Handoff Freshness
  - Backspace Unified
  - Canonical Record Sidecar
- R59 infrastructure:
  - Build ID / Runtime Banner
  - deploy / restart / verify scripts
  - REHYDRATE-WRITE-AUDIT
- Missing:
  - **R58 core business logic**

The presence of a Build ID such as:

```text
inkchapter-live-canonical-record-binding-r58-d7k3m
```

does **not** prove R58 exists.

The source implementation must be verified independently of version strings.

---

# 1. Task objective

Implement the missing R58 behavior in the actual production code path.

R58 must establish a stable relationship:

```text
live Typora paragraph/block
        ↓
LiveParagraphRecordBinding
        ↓
canonical sidecar record
```

and ensure that:

1. normal commit uses or creates the correct canonical record;
2. Backspace / merge mutations reuse the same canonical lineage;
3. rehydrate prefers exact live binding over text/structural heuristics;
4. a temporary/live record cannot fall back into generic heuristic rehydrate and be re-claimed as if it were historical data;
5. the implementation emits deterministic diagnostic traces proving which path was used;
6. R60 remains blocked until all R58 source and runtime acceptance gates pass.

---

# 2. Non-negotiable constraints

## 2.1 Do not fake R58 through version metadata

Forbidden as a completion criterion:

- only changing `INKCHAPTER_BUILD_ID`;
- only changing runtime banner text;
- only adding trace strings with no execution path;
- only adding comments/interfaces without wiring them into production code;
- only modifying tests so they pass without implementing runtime behavior;
- only adding R60 forensic logs around the old R57 heuristic path.

R58 is complete only when the actual runtime behavior is changed.

---

## 2.2 Preserve existing working behavior

Do not regress:

- R57 Selection Resolver;
- Verify-First Caret behavior;
- Runtime ID behavior;
- Handoff Freshness;
- Backspace Unified;
- Canonical Record Sidecar;
- existing R59 deployment / verification infrastructure;
- existing sidebar outline numbering and heading-numbering behavior unrelated to this bug.

Minimize the modification surface.

---

## 2.3 Evidence before conclusion

Every important conclusion must include evidence from:

- source path;
- function/method name;
- relevant branch/condition;
- trace output;
- build artifact;
- deployed artifact;
- runtime verification.

Do not report “fixed” based only on successful compilation.

---

# 3. Step 1 — Locate the authoritative R58 specification

Search the repository for:

```text
trae-p0-fix-live-canonical-record-binding-and-block-temporary-record-heuristic-rehydrate-r58.md
```

Expected location may be similar to:

```text
docs/prompts/pending/
docs/prompts/
```

If found:

1. read it completely;
2. extract all normative behavior requirements;
3. compare those requirements with the current source;
4. use the specification as the primary behavioral contract;
5. use this recovery prompt as the execution/acceptance wrapper.

If multiple R58 documents exist, identify which is newest and authoritative by content, not filename alone.

If the exact file is absent, do **not** stop merely because the prompt file is missing. Continue from the behavioral contract defined in this document and the existing R57/R59 architecture.

---

# 4. Step 2 — Map the current canonical-record pipeline

Before editing code, identify the concrete production functions for all of the following:

```text
A. paragraph/block creation
B. canonical record creation/upsert
C. canonical sidecar persistence
D. normal typing/input commit
E. Backspace/delete/merge handling
F. runtime paragraph identity generation
G. rehydrate candidate collection
H. rehydrate candidate scoring/matching
I. heuristic fallback
J. temporary/live record lifecycle
```

Produce a compact implementation map:

```text
behavior
→ source file
→ function/class
→ current identity source
→ mutation target
→ current fallback
```

Do not edit until this map is complete enough to identify where R58 belongs.

---

# 5. Step 3 — Implement LiveParagraphRecordBinding

Introduce a real binding model equivalent in purpose to:

```ts
interface LiveParagraphRecordBinding {
  // identity of the currently live Typora paragraph/block
  runtimeId: string;

  // canonical sidecar record identity
  canonicalRecordId: string;

  // document identity / scope
  documentId?: string;

  // optional structural identity only when already trusted
  headingPath?: string;
  blockPath?: string;

  // lifecycle markers
  createdAt?: number;
  updatedAt?: number;

  // whether the record originated from the current live editing session
  live: boolean;

  // whether the record is still provisional and must not enter generic heuristic matching
  temporary: boolean;
}
```

Exact field names may differ to match the current codebase.

Requirements:

1. the binding must connect a **live runtime paragraph identity** to a **canonical record identity**;
2. binding lookup must be deterministic;
3. binding must be document-scoped;
4. bindings must not leak across documents/vaults;
5. stale bindings must be invalidated when the underlying paragraph identity is no longer valid;
6. no text-content-only key may serve as the primary binding identity.

Prefer existing runtime IDs / sidecar IDs over inventing a parallel identity system.

---

# 6. Step 4 — Canonical record commit path

On normal paragraph commit/upsert:

1. resolve current live paragraph identity;
2. check for an existing valid live canonical binding;
3. if bound:
   - update the bound canonical record;
   - do not create a duplicate;
4. if not bound:
   - create/upsert the correct canonical record;
   - create and store the live binding immediately;
5. persist all necessary canonical sidecar state;
6. ensure subsequent mutations reuse the same canonical lineage.

Add an execution trace named exactly:

```text
CANONICAL-RECORD-COMMIT
```

The trace must carry enough structured fields to prove identity, for example:

```text
runtimeId
canonicalRecordId
documentId
temporary
live
operation=create|update|reuse
bindingSource=existing|created
```

Do not log full document contents unless already allowed by existing diagnostic conventions.

---

# 7. Step 5 — Backspace / merge must reuse canonical lineage

Backspace, delete, merge, paragraph collapse, or equivalent mutation must not perform an unrelated heuristic re-identification of the canonical record if a valid live binding exists.

Required behavior:

```text
current live paragraph
        ↓
resolve live binding
        ↓
bound canonical record
        ↓
apply canonical mutation
```

Add a trace named exactly:

```text
CANONICAL-RECORD-BACKSPACE
```

Include enough fields to prove:

```text
runtimeId
canonicalRecordId
documentId
operation
bindingHit=true|false
fallbackReason
```

If there is a fallback path, it must be explicit and observable.

Do not silently fall from a failed live binding into a broad heuristic.

---

# 8. Step 6 — Implement live binding resolution

Create or extend a resolver whose behavior is equivalent to:

```text
resolve live paragraph
→ locate exact live binding
→ validate document scope
→ validate canonical record still exists
→ validate binding freshness
→ return canonical record identity
```

Add a trace named exactly:

```text
LIVE-BINDING-RESOLUTION
```

Required outcome categories should distinguish at least:

```text
hit
miss
stale
document-mismatch
canonical-record-missing
invalid-runtime-id
```

The resolver must be used by the actual production commit/backspace/rehydrate paths, not only by tests.

---

# 9. Step 7 — Rehydrate precedence

Change rehydrate candidate matching so the preferred order is conceptually:

```text
1. exact live binding
2. exact trusted canonical identity
3. exact persisted runtime/sidecar identity when valid
4. safe structural fallback
5. text/structure heuristic as last resort
```

When an exact live binding is selected, emit:

```text
MATCH-LIVE-BINDING
```

The trace must include:

```text
runtimeId
canonicalRecordId
documentId
candidateCount
selectedStrategy=live-binding
```

Do not allow generic heuristic scoring to outrank a valid exact live binding.

---

# 10. Step 8 — Block temporary/live records from generic heuristic rehydrate

This is a mandatory R58 safety gate.

A canonical record that is both:

```text
temporary/provisional
AND
live/current-session
```

must **not** participate as an ordinary candidate in generic heuristic rehydrate.

Equivalent behavioral rule:

```ts
if (record.temporary && record.live) {
  // exclude from generic heuristic candidate pool
}
```

Adapt to existing lifecycle fields if the project uses different names.

The important invariant is:

> A record just created by the current live editing session must not be rediscovered by broad text/structure heuristics and re-owned/upserted as if it were an unrelated historical candidate.

Add a diagnostic reason such as:

```text
TEMPORARY-LIVE-HEURISTIC-BLOCK
```

or an equivalent structured reason inside existing rehydrate audit output.

Do not turn this into a permanent ban on rehydrating valid persisted records. The exclusion applies specifically to the unsafe temporary/live state.

---

# 11. Step 9 — Candidate provenance

For every selected rehydrate candidate, ensure the logs make clear **why** it won.

At minimum distinguish:

```text
MATCH-LIVE-BINDING
MATCH-CANONICAL-ID
MATCH-RUNTIME-ID
MATCH-STRUCTURAL
MATCH-HEURISTIC
NO-MATCH
```

If existing R59 `REHYDRATE-WRITE-AUDIT` already provides provenance fields, extend/reuse it rather than creating a disconnected duplicate system.

This R58 change should provide enough provenance for later R60 forensic work, but do **not** expand into the full R60 forensic scope yet.

---

# 12. Step 10 — Source gate

After implementation, run repository-wide source searches.

All of these must be present in executable production paths:

```text
LiveParagraphRecordBinding
CANONICAL-RECORD-COMMIT
CANONICAL-RECORD-BACKSPACE
LIVE-BINDING-RESOLUTION
MATCH-LIVE-BINDING
```

Also verify the temporary/live heuristic block exists.

A simple string match is not sufficient.

For every required token, report:

```text
token
source file
function/class
call site
production path? yes/no
```

If any required item is only in:

- docs;
- tests;
- comments;
- dead code;
- unused helpers;

the gate fails.

Failure result:

```text
HARD STOP — R58_SOURCE_GATE_FAILED
```

Do not proceed to R60.

---

# 13. Step 11 — Tests

Add or update focused tests covering at least:

## Case A — Commit establishes binding

```text
new live paragraph
→ canonical record created/upserted
→ live binding created
→ CANONICAL-RECORD-COMMIT
```

Expected:

- one canonical lineage;
- no duplicate record.

---

## Case B — Repeated commit reuses record

```text
same live paragraph
→ second commit
```

Expected:

- same canonicalRecordId;
- binding reused;
- no heuristic duplicate.

---

## Case C — Backspace reuses bound record

```text
bound paragraph
→ Backspace / merge
```

Expected:

- `CANONICAL-RECORD-BACKSPACE`;
- same canonical lineage;
- no broad heuristic when binding is valid.

---

## Case D — Live-binding rehydrate

```text
valid live binding
+ several heuristic candidates
```

Expected:

```text
MATCH-LIVE-BINDING
```

and the bound canonical record wins.

---

## Case E — Temporary/live heuristic block

```text
temporary=true
live=true
```

Expected:

- candidate excluded from generic heuristic pool;
- explicit block reason;
- no heuristic self-rematch.

---

## Case F — Persisted non-live record remains eligible

Verify the safety gate does not break legitimate historical rehydrate.

---

## Case G — Stale binding

Expected:

- stale binding rejected;
- reason logged;
- only safe fallback may run.

---

# 14. Step 12 — Build

Run the project's authoritative build command.

Record:

```text
build command
exit code
artifact path
artifact size
artifact mtime
SHA256
INKCHAPTER_BUILD_ID
```

Build success alone is **not** acceptance.

If the build ID is changed, use a new unique identifier for this actual implementation, not the old nominal R58 identifier.

Example naming style only:

```text
inkchapter-live-canonical-record-binding-r58-recovered-<unique>
```

Do not copy this example literally if the project has a standard naming convention.

---

# 15. Step 13 — Deploy

Deploy using the project's authoritative deployment process.

After deployment, compare the built artifact and deployed artifact.

Required evidence:

```text
build artifact SHA256
deployed artifact SHA256
equal? true
```

If not equal:

```text
HARD STOP — DEPLOY_ARTIFACT_MISMATCH
```

---

# 16. Step 14 — Restart Typora and verify the real process state

Do **not** equate a successful launch/restart command with a successfully running Typora instance.

After restart, explicitly verify all of the following:

```text
1. Typora process exists
2. Typora main window handle exists
3. main window title is captured
4. expected target vault/document scope is open
5. deployed artifact SHA256 matches the built artifact
6. runtime plugin build identifier equals the newly built R58 identifier
```

If only the launch command succeeded but process/window/runtime evidence is not yet confirmed, report exactly:

```text
启动命令已发出，但尚未确认成功
```

Do not say “Typora 已成功启动” until the above evidence is verified.

If the wrong vault or stale runtime build is loaded:

```text
HARD STOP — WRONG_RUNTIME_TARGET
```

---

# 17. Step 15 — Runtime acceptance scenarios

Use representative Typora documents and reproduce the real editing flow.

At minimum verify:

## Runtime Scenario 1 — normal typing

```text
open document
→ type in paragraph
→ commit
```

Must observe:

```text
CANONICAL-RECORD-COMMIT
LIVE-BINDING-RESOLUTION
```

and confirm canonical lineage.

---

## Runtime Scenario 2 — Backspace / merge

```text
edit bound paragraph
→ Backspace / merge
```

Must observe:

```text
CANONICAL-RECORD-BACKSPACE
```

with the expected canonicalRecordId.

---

## Runtime Scenario 3 — rehydrate

Trigger the real rehydrate lifecycle.

When a valid live binding exists, must observe:

```text
MATCH-LIVE-BINDING
```

The selected candidate must be the bound canonical record.

---

## Runtime Scenario 4 — temporary/live heuristic safety

Produce or identify a temporary/live record and trigger a rehydrate situation that previously allowed unsafe heuristic re-matching.

Expected:

```text
temporary/live record
→ excluded from generic heuristic candidate set
→ no accidental canonical duplicate/upsert
```

Capture the corresponding block/provenance trace.

---

# 18. Step 16 — Regression verification

Verify no regressions in at least:

```text
heading numbering
sidebar outline numbering
selection/current-range behavior
global default/current-option behavior
canonical sidecar persistence
Backspace unified behavior
document reload
Typora restart
switching between test documents
```

Do not expand scope to unrelated UI redesign.

---

# 19. R58 acceptance gate

R58 may be declared complete only if **all** are true:

```text
[ ] LiveParagraphRecordBinding exists in production code
[ ] commit path creates/reuses live binding
[ ] CANONICAL-RECORD-COMMIT observed
[ ] Backspace/merge uses bound canonical lineage
[ ] CANONICAL-RECORD-BACKSPACE observed
[ ] LIVE-BINDING-RESOLUTION observed
[ ] rehydrate prefers valid live binding
[ ] MATCH-LIVE-BINDING observed
[ ] temporary/live records are blocked from generic heuristic matching
[ ] focused tests pass
[ ] full required build passes
[ ] build/deploy SHA256 match
[ ] real Typora process verified
[ ] main window handle verified
[ ] window title verified
[ ] target vault/document verified
[ ] runtime build ID verified
[ ] runtime scenarios pass
[ ] no critical regressions found
```

Any unchecked item means R58 is not accepted.

---

# 20. R60 unlock rule

Only after the R58 acceptance gate passes may the previous R60 prompt be resumed:

```text
trae-forensic-r60-trace-canonical-record-upsert-and-rehydrate-candidate-provenance.md
```

Before starting R60, rerun its source gate.

Expected result:

```text
CANONICAL-RECORD-COMMIT         → FOUND
CANONICAL-RECORD-BACKSPACE      → FOUND
LIVE-BINDING-RESOLUTION         → FOUND
MATCH-LIVE-BINDING              → FOUND
LiveParagraphRecordBinding      → FOUND
```

If any are missing:

```text
HARD STOP — R58_SOURCE_NOT_PRESENT
```

Do not bypass this gate.

---

# 21. Required final report

At the end of execution, output a report using exactly these sections:

```text
## 1. Root Cause
## 2. R58 Spec Located
## 3. Source Pipeline Map
## 4. Files Changed
## 5. LiveParagraphRecordBinding Implementation
## 6. Commit Path
## 7. Backspace / Merge Path
## 8. Rehydrate Precedence
## 9. Temporary/Live Heuristic Block
## 10. Source Gate
## 11. Tests
## 12. Build Evidence
## 13. Deploy Evidence
## 14. Typora Real Startup Verification
## 15. Runtime Trace Evidence
## 16. Regression Results
## 17. R58 Acceptance Gate
## 18. R60 Unlock Decision
```

For `## 18. R60 Unlock Decision`, output exactly one of:

```text
R60 UNLOCKED
```

or:

```text
R60 BLOCKED
```

If blocked, list the failed gate(s).

---

# 22. Execution policy

Work directly against the repository.

Do not stop after analysis if the source can be safely modified.

Do not ask for confirmation merely because the task spans multiple files.

Prefer minimal, auditable changes.

When an unexpected architecture mismatch appears:

1. inspect the actual source;
2. adapt the implementation to the real architecture;
3. preserve the behavioral invariants defined above;
4. document the deviation in the final report.

The final criterion is runtime behavior and verifiable evidence, not nominal version labels.
