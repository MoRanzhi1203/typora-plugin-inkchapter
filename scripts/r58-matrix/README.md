# R58 Matrix Automation (external black-box)

Two automation runners share the primitives in this directory.

## Final Reduced Matrix Runner (current)

```
run-r58-final-matrix.ps1 -Mode DryRun      # read-only preflight (no input)
run-r58-final-matrix.ps1 -Mode InputSmoke  # disposable trusted-IME proof
run-r58-final-matrix.ps1 -Mode Full        # reset → strict startup → A1×3/A2/A3/B1×2 → summary
```

Files:

```
run-r58-final-matrix.ps1    orchestrator (DryRun / InputSmoke / Full)
fixture-manager.ps1         fixture reset / detection / B1 seed fixtures
process-control.ps1         Typora process / SHA / runtime-load (wraps r58-process-verifier.ps1)
window-input.ps1            user32 SendInput real-keyboard injection (wraps r58-input-injector.ps1)
document-switch-driver.ps1  same-session file-open (Typora single-instance forward)
trial-parser.js             deterministic verdict parser (no AI judgment)
report-writer.js            final-summary.md / final-summary.json
scenarios.json              trial mapping + frozen build/SHA provenance
r58-cdp-collector.js        Node CDP console collector (Runtime.consoleAPICalled)
```

Trial mapping:

```
A1-01..A1-03 → r58-caret-a1-fresh-01..03.md   (。。 Enter Enter 。)
A2-01        → r58-caret-a1-fresh-04.md        (ordinary paragraph + Enter + 。)
A3-01        → r58-caret-a1-fresh-05.md        (。。 Enter Enter, no text)
B1-01/B1-02  → r58-b1-historical-01/02.md      (seeded sidecar, physical load)
```

## Input layer

- No AutoHotkey on this machine → **PowerShell + `user32!SendInput`**.
- `SetForegroundWindow` → confirm `GetForegroundWindow() == target` → send physical
  `VK_OEM_PERIOD` (Period) / `VK_RETURN` (Enter).
- The Chinese fullwidth period `。` (U+3002) is produced by the active IME on the
  physical Period key, yielding `key=Process code=Period isTrusted=true` + a real
  `compositionstart → beforeinput(insertCompositionText) → input → compositionend`
  chain. DOM `dispatchEvent` / `Runtime.evaluate` / `document.execCommand` are
  forbidden and unused.

## Console capture

- Typora started with `--remote-debugging-port=9222 --remote-allow-origins=*`.
- `r58-cdp-collector.js` attaches via CDP, streams `Runtime.consoleAPICalled` /
  `Runtime.exceptionThrown` to `trial-XX.log`.
- The collector is started **before** Typora/doc-switch so the baseline/transition
  (`SIDECAR-ACTUAL-LOAD`, `DOCUMENT-CONTEXT-TRANSITION`) is captured.

## Verdict

- `trial-parser.js` is deterministic: it only regex-checks the mandatory markers,
  emits a structured JSON (verdict / failedChecks / counters), never relies on
  human or AI fuzzy judgment.
- Fail-fast: any real business assertion failure stops the matrix and preserves
  the Typora process / fixture / sidecar / console / runtime-load / metadata under
  `artifacts/r58-final/`.

## Legacy A1×10 runner (superseded)

`run-r58-a1-matrix.ps1 -Mode {DryRun|Smoke|A1}` (with `r58-*` helpers) implements
the earlier A1×10 automation attempt. Kept for reference; use the Final runner for
the Reduced Matrix.
