# TRAE P0 — Complete Repair of R58 Canonical Record Identity Lifecycle

> Project: `D:\TyporaPluginProjects\typora-plugin-inkchapter`
>
> Priority: **P0**
>
> Purpose: **Actually repair the canonical record lifecycle end-to-end. Do not declare success from source strings, unit tests, build success, deploy success, or startup verification alone.**
>
> Current authoritative status: **R58 NOT FIXED / R60 BLOCKED**
>
> This task replaces any earlier premature `R60 UNLOCKED` conclusion.

---

# 0. Truth contract

The current runtime log has already proven a real production failure.

Observed correct Backspace case:

```text
runtimeId=P-RUNTIME-9

operationReason=BACKSPACE_UPDATE

recordIdFromElementBinding=indent-1786387379131-6
recordIdFromLiveBinding=indent-1786387379131-6

decision=UPDATE_EXISTING

recordCountBefore=7
recordCountAfter=7

sameRecord=true
appendOccurred=false
```

Observed failing Backspace case:

```text
runtimeId=P-RUNTIME-11

operationReason=BACKSPACE_UPDATE

recordIdFromElementBinding=null
recordIdFromLiveBinding=null
recordIdFromAnchor=null
recordIdFromOrdinal=null

recordCountBefore=7

decision=CREATE_NEW
selectedRecordId=indent-1786387389536-7

recordCountAfter=8

BACKSPACE_DUPLICATE_RECORD_BUG=true
BACKSPACE-RECORD-COUNT-INVARIANT-VIOLATION

sameRecord=false
appendOccurred=true
```

The log also shows repeated ambiguous ownership:

```text
candidateRecordIds=[indent-1786387370338-3,indent-1786387379131-6]
candidateModes=[force-indent,force-flush]
decision=BLOCK
reason=multi-owner
```

and a real single-dot target being force-indent rehydrated in at least one trace:

```text
target=...:。:
candidateCount=1
decision=APPLY
winner=indent-1786387368754-2
mode=force-indent
```

Therefore:

```text
R58 runtime acceptance = FAIL
R60 = BLOCKED
```

Do not overwrite this status until every acceptance gate in this document passes.

---

# 1. Forbidden completion shortcuts

The following are **never** sufficient to say "fixed":

```text
search token FOUND

TypeScript 0 errors

unit tests pass

build pass

deploy pass

SHA256 match

Typora process exists

window handle exists

runtime build ID matches

instrumentation logs exist

one successful Backspace case

one successful Enter case
```

A final claim of `FIXED` is forbidden unless:

```text
all required runtime scenarios were actually performed
and
all required invariants were observed in the real Typora runtime
and
no hard-stop trace occurred
```

If GUI/runtime interaction cannot be executed by the current environment:

```text
do not fake it
do not infer it
do not mark it PASS
```

Report:

```text
R58 NOT FIXED — RUNTIME ACCEPTANCE INCOMPLETE
```

---

# 2. Current root problem to repair

This is not only a "Backspace branch bug".

The system currently lacks a fully closed identity lifecycle:

```text
Enter canonical creation
        ↓
live element/runtime binding
        ↓
DOM replacement / paragraph rebuild / handoff
        ↓
replacement element must inherit SAME canonicalRecordId
        ↓
Backspace must update SAME record
        ↓
temporary → stable promotion must retain SAME record
        ↓
rehydrate must project SAME record only to its proven owner
        ↓
save/reload must recover the same logical ownership
```

The failure occurs when this chain breaks.

The exact runtime evidence already proves:

```text
P-RUNTIME-11

no element→record binding
no live binding
anchor resolution did not match

BACKSPACE_UPDATE
fell through to CREATE_NEW
```

This fallback is invalid.

---

# 3. Phase A — Inspect current source before modification

Locate the current production implementations of:

```text
LiveParagraphRecordBinding
live binding registry/maps
element → record binding map
runtimeId generation
Enter commit transaction
activeOneShotHandoff
handoff replacement resolution
applyParagraphIndentOverrideToSidecar
Backspace reverse handler
temporary record promotion
resolveParagraphOverrideRehydratePlan
applyParagraphRehydratePlan
anchor repair
sidecar write scheduling
document/vault switching cleanup
```

Output a concrete current-state map:

```text
behavior
file
function
identity input
record identity source
mutation target
fallback behavior
```

Do not rely on the previous Trae summary if current source differs.

---

# 4. Phase B — Define one canonical identity owner

A logical paragraph override must have one stable identity:

```ts
CanonicalRecordId
```

The canonical record ID must be the ownership identity.

The following are supporting/transient identities only:

```text
HTMLElement
runtimeId
paragraph ordinal
anchor
textHash
current Selection
DOM position
```

Never allow paragraph ordinal or text content to become the primary ownership identity during a live editing transaction.

---

# 5. Phase C — Transaction must retain canonicalRecordId

Extend the actual Enter/command transaction structure so that after canonical commit it retains:

```text
txn.canonicalRecordId
txn.commandRuntimeId
txn.commandElement
txn.documentKey
```

After:

```text
CANONICAL-RECORD-COMMIT
```

the transaction must know exactly which record was created/reused.

Required invariant:

```text
txn.canonicalRecordId != null
```

before the Enter transaction is considered canonical-successful.

Do not reconstruct this identity later from text/ordinal.

---

# 6. Phase D — Handoff must transfer canonical ownership

The active one-shot handoff must carry canonical ownership, not semantic state alone.

It must contain or be able to resolve:

```text
handoffId
documentKey
canonicalRecordId
previousRuntimeId
previousElement
semantic
generation
```

When Typora replaces/rebuilds the paragraph element:

```text
old element/runtime
        ↓
HANDOFF replacement resolution
        ↓
new element/runtime
```

perform an explicit ownership transfer:

```text
same canonicalRecordId
old runtimeId → new runtimeId
old HTMLElement → new HTMLElement
generation + 1
```

Implement one authoritative function with purpose equivalent to:

```ts
transferCanonicalBinding({
  documentKey,
  canonicalRecordId,
  fromElement,
  fromRuntimeId,
  toElement,
  toRuntimeId,
  reason: 'HANDOFF_REPLACE' | 'DOM_REBUILD'
})
```

It must:

1. validate document scope;
2. verify canonical record exists;
3. bind new element to same record ID;
4. bind new runtime ID to same record ID;
5. mark old binding stale/inactive rather than leaving two live owners;
6. update generation;
7. emit deterministic trace;
8. never create a canonical record.

Required trace:

```text
CANONICAL-BINDING-TRANSFER
```

Fields:

```text
documentKey
canonicalRecordId
fromRuntimeId
toRuntimeId
fromConnected
toConnected
generationBefore
generationAfter
reason
oldBindingInvalidated
newBindingEstablished
recordCountBefore
recordCountAfter
```

Required invariant:

```text
recordCountAfter === recordCountBefore
```

---

# 7. Phase E — A record may have only one live owner

Introduce a strict invariant for the current document:

```text
one canonicalRecordId
→ at most one active live paragraph owner
```

and:

```text
one live paragraph/runtime owner
→ at most one canonicalRecordId
```

If a transfer would produce:

```text
two live elements → same canonical record
```

or:

```text
one live element → two canonical records
```

do not silently continue.

Emit:

```text
LIVE-BINDING-COLLISION
```

and block the mutation.

Do not solve collisions by picking the first array item.

---

# 8. Phase F — Backspace UPDATE may never CREATE_NEW

This is a hard business invariant.

For:

```text
operationReason=BACKSPACE_UPDATE
```

allowed decisions are only:

```text
UPDATE_EXISTING
BLOCK
```

Forbidden:

```text
CREATE_NEW
```

Change the sidecar upsert API so that its operation semantics are explicit.

Do not use one generic "upsert anything" function that silently appends for every caller.

Preferred shape:

```ts
type CanonicalMutationIntent =
  | { kind: 'ENTER_CREATE_OR_REUSE'; ... }
  | { kind: 'BACKSPACE_UPDATE_EXISTING'; canonicalRecordId?: string; ... }
  | { kind: 'UI_UPDATE_EXISTING'; canonicalRecordId?: string; ... }
  | { kind: 'PROMOTE_EXISTING'; canonicalRecordId: string; ... }
```

For `BACKSPACE_UPDATE_EXISTING`:

```text
trusted identity found
→ UPDATE_EXISTING

trusted identity absent
→ BLOCK
```

Never:

```text
trusted identity absent
→ CREATE_NEW
```

---

# 9. Phase G — Resolve Backspace identity before semantic mutation

The current sequence must not mutate semantic first and discover canonical failure afterward.

For Backspace reverse:

```text
1. identify paragraph
2. resolve canonicalRecordId using trusted live ownership
3. verify record exists
4. verify record belongs to current document
5. verify there is no binding collision
6. only then commit force-flush semantic + canonical update
```

If identity is unresolved:

```text
consume/block the plugin command safely
do not append a record
do not claim successful Backspace reverse
```

Emit:

```text
BACKSPACE-CANONICAL-BLOCK
```

with exact reason:

```text
NO_ELEMENT_BINDING
NO_LIVE_BINDING
STALE_BINDING
DOCUMENT_MISMATCH
RECORD_MISSING
COLLISION
```

The priority is to prevent canonical corruption.

---

# 10. Phase H — Trusted Backspace identity sources

For active live Backspace, trusted sources are:

```text
1. exact element → canonicalRecordId
2. exact runtimeId → canonicalRecordId
3. active transaction/handoff canonicalRecordId proven to own the replacement
```

Do not use as a trusted Backspace ownership source:

```text
text-only match
ordinal-only match
broad structural heuristic
nearest paragraph
first matching anchor
single candidate by accident
```

Anchor may be used only as additional validation, not as the sole ownership proof for a live Backspace mutation.

---

# 11. Phase I — Temporary/live records must not enter generic heuristic matching

Build a definitive set/map for current live canonical ownership.

For every canonical record:

```text
isLiveBound(recordId)
```

must be resolvable independently of whether the persistent record schema has a `live` field.

If:

```text
record.temporary === true
and
isLiveBound(record.id) === true
```

then generic heuristic candidate generation must skip that record.

Only an exact live-binding path may produce a candidate.

Required trace:

```text
TEMPORARY-LIVE-HEURISTIC-BLOCK
```

Fields:

```text
recordId
documentKey
runtimeId
temporary
liveBound
heuristicSkipped=true
```

A temporary/live record must never simultaneously produce:

```text
MATCH-LIVE-BINDING candidate
+
generic anchor/text/ordinal candidate
```

for the same rehydrate plan.

---

# 12. Phase J — Candidate deduplication by record and target

Before grouping rehydrate candidates, normalize/dedupe.

For one:

```text
(recordId, targetParagraph)
```

retain only the strongest proven strategy.

Example precedence:

```text
LIVE_BINDING
> CANONICAL_ID
> TRUSTED_RUNTIME_ID
> SAFE_STRUCTURAL
> HEURISTIC
```

Do not allow the same canonical record to enter the same target group twice through different resolver paths.

Trace:

```text
REHYDRATE-CANDIDATE-DEDUPE
```

with:

```text
recordId
targetRuntimeId
strategiesBefore
strategyKept
duplicatesRemoved
```

---

# 13. Phase K — Prevent one live record from owning changing unrelated targets

The runtime log shows a live-bound record such as:

```text
indent-1786387370338-3
```

being observed at changing target ordinals.

Ordinal changes alone can be valid after DOM edits.

But the record must follow the bound live element/runtime identity, not jump to a different logical paragraph because an anchor heuristic also matches.

For a live-bound record:

```text
exact live owner exists
→ only that owner is eligible
→ all other heuristic target candidates for that record are suppressed
```

If the exact live owner no longer exists:

```text
mark binding stale
do not immediately release the record into generic heuristic matching if it is temporary/current-session
```

It must go through controlled recovery/transfer.

---

# 14. Phase L — Single-dot safety

The real log contains a target whose visible text includes:

```text
。
```

and a force-indent rehydrate APPLY.

That must be treated as a P0 failure until proven safe.

Add complete candidate provenance:

```text
REHYDRATE-CANDIDATE
```

Fields:

```text
planId
recordId
recordMode
recordTemporary
recordLiveBound
recordBoundRuntimeId

targetRuntimeId
targetOrdinal
targetTextRaw
targetTextVisible
targetSemanticBefore

matchStrategy
matchEvidence
confidence
candidateAccepted
```

Before apply:

```text
REHYDRATE-APPLY
```

Fields:

```text
planId
recordId
targetRuntimeId
targetOrdinal
targetTextVisible
semanticBefore
semanticAfter
matchStrategy
```

Hard stop:

```text
targetTextVisible === "。"
and
semanticBefore === "auto"
and
recordMode !== "auto"
and
matchStrategy is not exact proven live ownership
```

Emit:

```text
SINGLE-DOT-WRONG-APPLY
```

and block apply.

Do not "fix" this by special-casing punctuation alone.

The real fix is identity proof.

---

# 15. Phase M — Multi-owner groups must disappear for clean live state

Two-Pass blocking is a useful safety net, but repeated:

```text
decision=BLOCK
reason=multi-owner
```

means upstream ownership is still inconsistent.

Do not declare the system fixed merely because Two-Pass blocks the corruption.

For a clean test run after repair:

```text
LIVE-BINDING-COLLISION = 0
unexpected multi-owner groups involving current-session live records = 0
```

Historical persisted ambiguity may be blocked, but must be separately classified.

---

# 16. Phase N — Temporary → stable promotion must keep the same record ID

When an empty/temporary live paragraph receives real text:

```text
temporary=true
→ temporary=false
```

must be an update of the same canonical record.

Required:

```text
recordId before === recordId after
recordCount unchanged
live binding retained
anchor updated once from trusted live owner
```

Trace:

```text
CANONICAL-RECORD-PROMOTION
```

Fields:

```text
recordId
runtimeId
temporaryBefore
temporaryAfter
anchorBefore
anchorAfter
recordCountBefore
recordCountAfter
```

No append is allowed.

---

# 17. Phase O — Stop anchor-repair write storms

Current runtime repeatedly reports:

```text
REHYDRATE-WRITE-AUDIT
dirty=true
reason=anchor-repair
writeScheduled=true
```

across repeated refreshes.

Audit this path.

Anchor repair must be idempotent.

Implement a normalized equality check:

```text
normalized old anchor == normalized new anchor
→ dirty=false
→ no write scheduled
```

Only a materially changed, trusted owner may repair its canonical anchor.

Rehydrate projection must not mutate canonical state on every refresh.

Required invariant after state settles:

```text
N consecutive no-edit refreshes
→ REHYDRATE-WRITE-AUDIT dirty=false
→ scheduled canonical writes=0
```

Use at least 5 consecutive refresh cycles for the acceptance test.

---

# 18. Phase P — Separate projection from canonical mutation

Rehydrate should primarily be:

```text
canonical state → runtime semantic/visual projection
```

It must not casually become:

```text
runtime layout → canonical identity rewrite
```

Separate:

```text
apply projection
```

from:

```text
repair canonical metadata
```

Canonical metadata repair is allowed only when:

```text
identity is exact/proven
and
change is materially necessary
and
record identity is unchanged
```

Emit:

```text
REHYDRATE-CANONICAL-MUTATION
```

for any canonical mutation caused during rehydrate.

For ordinary settled refresh:

```text
count = 0
```

---

# 19. Phase Q — Document switch cleanup

On document switch:

1. live element bindings from old document must be invalidated;
2. runtimeId bindings from old document must not resolve in new document;
3. handoff/transaction ownership must be cleared;
4. canonical records remain document-scoped;
5. no binding leakage is allowed.

Trace:

```text
CANONICAL-BINDING-DOCUMENT-SWITCH
```

with counts before/after cleanup.

Hard stop:

```text
binding from document A resolves in document B
```

---

# 20. Phase R — Physical sidecar persistence is a separate gate

Current runtime shows:

```text
SIDECAR-DISABLED
vaultRoot unknown
write blocked
```

Do not use this as an excuse for in-memory identity corruption.

First make all in-memory runtime gates pass.

Only after that, inspect the actual application/vault services and resolve the real vault root without TEMP fallback.

Required:

```text
vaultRoot = D:\TyporaPluginProjects\typora-plugin-inkchapter\test\vault
```

for the test vault.

Do not infer the root from an unsafe arbitrary parent path if an authoritative vault API exists.

Add/retain:

```text
SIDECAR-ACTUAL-LOAD
SIDECAR-ACTUAL-WRITE
```

and prove load/write use the same storage identity.

Then test:

```text
save
close document
reopen
restart Typora
reopen
```

and confirm the same canonical semantics are restored without duplicates.

If persistence is intentionally still disabled by an earlier frozen phase, report:

```text
PERSISTENCE GATE NOT EXECUTED
```

and do **not** claim end-to-end persistence fixed.

---

# 21. Phase S — SyntaxError attribution

The runtime also shows:

```text
SyntaxError: Unexpected token ')'
```

before InkChapter `onload START`.

Do not modify paragraph business logic merely to silence this.

Identify source attribution.

Allowed final classifications:

```text
INKCHAPTER_OWNED
EXTERNAL_TO_INKCHAPTER
UNRESOLVED
```

If `UNRESOLVED`, say so.

Do not claim "all runtime errors clean" while it remains unresolved.

---

# 22. Required source-level tests

Add focused tests for the actual new invariants.

At minimum:

## T1 — Enter stores canonical ID in transaction

```text
Enter commit
→ one canonical record
→ txn.canonicalRecordId equals created/reused record
```

## T2 — Handoff transfer

```text
old element/runtime bound to R
→ replacement element/runtime
→ transfer
→ new element/runtime bound to R
→ old live owner invalidated
→ record count unchanged
```

## T3 — Backspace exact live binding

```text
bound paragraph
→ Backspace
→ UPDATE_EXISTING
→ same record ID
→ count unchanged
```

## T4 — Backspace missing binding

```text
BACKSPACE_UPDATE
+ no trusted identity
→ BLOCK
→ CREATE_NEW impossible
→ count unchanged
```

## T5 — Backspace after DOM replacement

```text
Enter
→ replacement/handoff
→ Backspace
→ same canonical record
```

This test is mandatory and must reproduce the failure class of `P-RUNTIME-11`.

## T6 — live binding collision

Must block.

## T7 — temporary/live heuristic exclusion

Must produce no generic candidate.

## T8 — candidate dedupe

One record/target pair may have one winner candidate only.

## T9 — single-dot not owned

An unbound new `。` paragraph must remain `auto`.

## T10 — promotion

Temporary to stable keeps record ID.

## T11 — anchor repair idempotence

Second identical repair produces no dirty/write.

## T12 — document switch isolation

Old bindings cannot resolve in new document.

## T13 — persisted non-live historical record

Still eligible through safe persisted matching when persistence is enabled.

---

# 23. Build gate

Run:

```powershell
pnpm exec tsc --noEmit
pnpm test
pnpm run build:dev
```

Record full exit status and test count.

But never equate this with runtime acceptance.

Use a new unique build marker only after actual source changes exist.

---

# 24. Deploy gate

Use only the authoritative deployment script.

Record:

```text
project dist/main.js SHA256
runtime dist/main.js SHA256
match

project dist/style.css SHA256
runtime dist/style.css SHA256
match

build ID
```

Any mismatch:

```text
HARD STOP — DEPLOY_ARTIFACT_MISMATCH
```

---

# 25. Strict Typora startup verification

After restart verify:

```text
old process exited
new PID
new StartTime
MainWindowHandle != 0
MainWindowTitle nonempty
target vault verified
target test document verified
runtime main.js path verified
main.js SHA256 verified
style.css SHA256 verified
runtime build marker verified
initializationCount = 1
```

If any required item is not verified:

```text
启动命令已发出，但尚未确认成功
```

Never say startup verification passed with missing items.

---

# 26. Clean runtime test setup

Do not validate against a polluted session.

Before each acceptance run:

1. close Typora completely;
2. confirm old process exited;
3. restart with the new build;
4. open only the designated test vault;
5. open a known test document;
6. clear only test-run transient state through supported test setup;
7. do not manually edit internal maps from DevTools to manufacture a pass.

If persistence is enabled, backup the test document sidecar before clearing test data.

---

# 27. Runtime acceptance — R1 Enter lineage

Perform at least 3 independent runs.

Each:

```text
fresh paragraph
→ type exact trigger sequence
→ Enter commit
```

Required:

```text
CANONICAL-RECORD-COMMIT
canonicalRecordId != null
duplicateAppendDetected=false
one record created/reused
live binding established
```

3/3 required.

---

# 28. Runtime acceptance — R2 Replacement transfer

Force/observe the real Typora DOM replacement/handoff lifecycle.

Required trace:

```text
CANONICAL-BINDING-TRANSFER
```

and:

```text
same canonicalRecordId
old binding invalidated
new binding established
recordCount unchanged
```

3/3 required.

If no replacement is observed, the scenario is not tested.

Do not mark PASS.

---

# 29. Runtime acceptance — R3 Backspace after replacement

This is the primary regression.

Sequence:

```text
Enter commit
→ wait for actual replacement/handoff
→ place caret at logical start
→ Backspace reverse
```

Required:

```text
operationReason=BACKSPACE_UPDATE
decision=UPDATE_EXISTING

recordIdFromElementBinding or recordIdFromLiveBinding or proven handoff recordId = expected canonicalRecordId

recordCountBefore === recordCountAfter

CANONICAL-RECORD-BACKSPACE
sameRecord=true
appendOccurred=false
```

Forbidden:

```text
BACKSPACE-DUPLICATE-RECORD-BUG
BACKSPACE-RECORD-COUNT-INVARIANT-VIOLATION
decision=CREATE_NEW
```

Run **10 consecutive clean repetitions**.

Required:

```text
10/10
```

One failure = R58 NOT FIXED.

---

# 30. Runtime acceptance — R4 Temporary/live rehydrate

Create temporary live records and trigger refresh/rebuild.

Required:

```text
TEMPORARY-LIVE-HEURISTIC-BLOCK
```

for any generic heuristic path considered.

Exact live-binding projection is allowed.

Forbidden:

```text
temporary live record
→ generic heuristic candidate accepted
```

Run 5 repetitions.

---

# 31. Runtime acceptance — R5 Single dot

Run 5 clean cases:

```text
new unbound paragraph
→ type only `。`
→ trigger normal refresh/rebuild conditions
```

Required every time:

```text
textVisible="。"
semantic remains auto
computed style follows default auto behavior
no FORCE_INDENT/FORCE_FLUSH rehydrate unless exact ownership is proven
```

Forbidden:

```text
SINGLE-DOT-WRONG-APPLY
```

5/5 required.

---

# 32. Runtime acceptance — R6 Promotion

Create a temporary committed paragraph, then type stable content.

Required:

```text
temporary true → false
same recordId
record count unchanged
binding retained
```

5/5 required.

---

# 33. Runtime acceptance — R7 Settled refresh idempotence

After no edits:

trigger/observe at least 5 refresh cycles.

Required:

```text
no canonical mutation
no anchor-repair write storm
dirty=false
writeScheduled=false
```

Any repeated unnecessary anchor mutation means not fixed.

---

# 34. Runtime acceptance — R8 Document switch

Switch:

```text
doc A → doc B → doc A
```

Required:

```text
no cross-document binding
no record ownership leakage
no duplicate append
```

3 cycles required.

---

# 35. Runtime acceptance — R9 Save/reopen persistence

Only when the physical sidecar persistence gate is enabled and verified.

Test:

```text
save
close
reopen
restart
reopen
```

Required:

```text
same logical paragraph semantics restored
no duplicate canonical records
no stale live binding reused across process lifetime
```

If not executed:

```text
END-TO-END PERSISTENCE = NOT VERIFIED
```

---

# 36. Runtime hard-stop list

Any occurrence of the following immediately fails the build acceptance:

```text
BACKSPACE-DUPLICATE-RECORD-BUG
BACKSPACE-RECORD-COUNT-INVARIANT-VIOLATION
LIVE-BINDING-COLLISION
BUG-LIVE-RECORD-ENTERED-HEURISTIC
SINGLE-DOT-WRONG-APPLY
cross-document binding
BACKSPACE_UPDATE decision=CREATE_NEW
unexpected recordCount increase during update/promotion/transfer
```

Do not continue and then average the failures away.

---

# 37. No premature R60

R60 remains blocked until every mandatory R58 runtime gate passes.

Source-token presence does not unlock R60.

The only allowed unlock condition is:

```text
R58_COMPLETE_RUNTIME_ACCEPTANCE = PASS
```

Then and only then:

```text
R60 UNLOCKED
```

---

# 38. Final verdict vocabulary

The final report must use exactly one of:

```text
R58 FIXED — R60 UNLOCKED
```

or:

```text
R58 NOT FIXED — R60 BLOCKED
```

There is no "mostly fixed", "source fixed", or "runtime pass" shortcut as the final verdict.

If some phases pass but any required gate fails, verdict remains:

```text
R58 NOT FIXED — R60 BLOCKED
```

---

# 39. Required final report

Output:

```text
## 1. Current Ground Truth
## 2. Exact Root Cause
## 3. Files Changed
## 4. Canonical Identity Ownership Design
## 5. Enter Transaction Canonical ID
## 6. Handoff / DOM Replacement Binding Transfer
## 7. Backspace No-Create Invariant
## 8. Temporary/Live Heuristic Exclusion
## 9. Rehydrate Candidate Deduplication
## 10. Single-Dot Ownership Safety
## 11. Temporary→Stable Promotion
## 12. Anchor Repair Idempotence
## 13. Document Switch Isolation
## 14. Physical Sidecar Persistence
## 15. SyntaxError Attribution
## 16. Typecheck
## 17. Unit Tests
## 18. Build Evidence
## 19. Deploy SHA256 Evidence
## 20. Typora Strict Startup Verification
## 21. R1 Enter Runtime Results
## 22. R2 Replacement Runtime Results
## 23. R3 Backspace-after-Replacement 10/10 Results
## 24. R4 Temporary/Live Runtime Results
## 25. R5 Single-Dot 5/5 Results
## 26. R6 Promotion 5/5 Results
## 27. R7 Refresh Idempotence Results
## 28. R8 Document Switch Results
## 29. R9 Save/Reopen Results
## 30. Hard-Stop Trace Count
## 31. Remaining Known Issues
## 32. Final Verdict
```

The final verdict must be evidence-based.

---

# 40. Execution behavior

Work directly against the real repository.

Do not stop at analysis when a safe source fix is possible.

Do not ask for confirmation for ordinary multi-file edits.

Do not use Git commit/push.

Use `git diff` / `git status` only for reporting.

Do not fabricate GUI results.

Do not fabricate SHA256 values.

Do not fabricate PID/window/vault verification.

Do not fabricate runtime traces.

Do not mark an unexecuted scenario PASS.

The task is complete only when the real Typora runtime proves it.
