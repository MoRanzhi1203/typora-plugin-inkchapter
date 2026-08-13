# R58 A1 Matrix Automation Runner

External black-box automation for the R58.7 A1 fresh-canonical ×10 gate.
This runner never touches plugin business source, never synthesizes DOM events,
and never calls plugin internals. All input goes through the real Windows input
layer (`user32!SendInput`), and console capture goes through Chromium DevTools
Protocol (CDP).

## Layout

```
scripts/r58-matrix/
  run-r58-a1-matrix.ps1      orchestrator (DryRun / Smoke / A1)
  r58-process-verifier.ps1   Typora process discovery / close / start / wait / SHA
  r58-input-injector.ps1     user32 SendInput real-keyboard injection
  r58-console-collector.ps1  PowerShell wrapper for the Node CDP collector
  r58-cdp-collector.js       Node.js CDP Runtime.consoleAPICalled / exceptionThrown collector
  r58-trial-evaluator.ps1    console-log parser → PASS/FAIL/INVALID verdict
  README.md                  this file
```

## CLI

```powershell
.\scripts\r58-matrix\run-r58-a1-matrix.ps1 -Mode DryRun
.\scripts\r58-matrix\run-r58-a1-matrix.ps1 -Mode Smoke
.\scripts\r58-matrix\run-r58-a1-matrix.ps1 -Mode A1 -StartFreshNumber 6 -TrialCount 10
```

Optional: `-OutputDir artifacts\r58-a1`, `-FailFast $true`, `-DebugPort 9222`.

## Input injection

- No AutoHotkey detected on this machine → uses **PowerShell + `user32!SendInput`**.
- The runner focuses the Typora main window via `SetForegroundWindow`, then sends
  the physical **Period** key (`VK_OEM_PERIOD`) and **Enter** (`VK_RETURN`).
- The Chinese fullwidth period `。` (U+3002) is **not** injected as Unicode. It is
  produced by the active Chinese IME when the physical Period key is pressed, which
  yields the renderer evidence `key=Process code=Period isTrusted=true` plus the
  `compositionstart → beforeinput(insertCompositionText) → input → compositionend`
  chain and `IME-EVENT-ORDER`.

## Why isTrusted=true

`SendInput` injects at the OS input queue level, which is indistinguishable from a
physical keyboard for the renderer. Browser/Electron mark such events `isTrusted=true`.
DOM `dispatchEvent(new KeyboardEvent(...))` would be `isTrusted=false`, which is
explicitly forbidden and is not used here.

## Console capture

- Typora is started with `--remote-debugging-port=9222 --remote-allow-origins=*`.
- `r58-cdp-collector.js` (Node ≥ 21) fetches `/json/list`, attaches to the renderer
  page target, sends `Runtime.enable`, and streams `Runtime.consoleAPICalled` /
  `Runtime.exceptionThrown` lines into `trial-XX-console.log`.
- The collector is started **before** Typora so the plugin-load baseline
  (`SIDECAR-ACTUAL-LOAD exists=false recordCount=0`) is captured.

## Trial flow (Smoke / A1)

1. record old PID → close Typora → verify old PID gone + count=0
2. verify fixture `sidecarExists=false recordCount=0` (else `FIXTURE_NOT_FRESH`)
3. start CDP collector
4. start Typora on the fixture with remote debugging
5. verify strict startup (new PID / HWND / title / runtime-load / SHA)
6. inject `。。 Enter Enter 。` (exactly 2 Enters)
7. wait ≥ 2.5 s
8. stop collector → evaluate console → write `trial-XX-verdict.json`

## Verdict criteria (must ALL hold)

- trusted input: `key=Process code=Period isTrusted=true` + IME chain
- `POST-TEXT-INPUT-ARM count=1` + `superseded=true`
- `COMMIT+50/150/300/500/1000/2200` all `logicalOffset=1 visibleText=。 insideEditor=true`
- `caretRestore=0 caretRepair=0 pluginSelectionWrite=0`
- `POST-TEXT-INPUT-COMPLETE` once, `activeObservationAfterComplete=none`, `pendingCallbackCountAfterComplete=0`
- canonical four `overall=true` + `AWAITING-TRANSFER-LEAK awaitingCount=0`
- `Process/Period → REJECT_NON_ENTER`

## Fail-fast

A1 stops on the first non-PASS trial and preserves the console/runtime/verdict
artifacts for that trial. It never deletes a sidecar or re-runs a fixture.

## Artifacts

Written under `artifacts/r58-a1/`:

```
trial-XX-console.log  trial-XX-runtime.json  trial-XX-verdict.json
a1-summary.json       a1-summary.md
dryrun-report.json    smoke-summary.json
```
