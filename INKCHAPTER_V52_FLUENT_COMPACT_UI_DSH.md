# InkChapter V5.2 — Fluent Compact UI Refinement (DSH Execution Specification)

> Project: `D:\TyporaPluginProjects\typora-plugin-inkchapter`  
> Working branch: `feature/document-status-image-batch` (verify actual branch and HEAD first)  
> Deliverable: a complete implementation, tests, real-GUI evidence where possible, and a truthful closure report.  
> This is a **UI/UX refinement**, not a rewrite of diagnostics, image transfer, locking, Typora, or the underlying framework.

## 0. Execution contract — read completely before touching code

You are the DSH development agent operating in the local InkChapter repository. **Execute**, do not merely discuss the design. Audit the live DOM/CSS, implement, run focused checks, fix real failures, rerun the entire validation suite, inspect actual Typora screenshots where possible, update durable documentation, and report exact evidence. Work continuously through the phases in this document without asking for permission for routine code edits, while obeying security boundaries and avoiding infinite no-progress loops.

**Primary direction:** Use **Microsoft Fluent 2 as the single dominant visual language**, borrow only the **three-segment selection interaction** from Ant Design Segmented and the **compact problem-list semantics** from JetBrains Problems / IntelliJ IDEA. **Do not combine the default CSS of three different frameworks. Do not introduce React, Fluent React or Ant Design packages** solely for this toolbar. Implement the resulting *InkChapter Fluent Compact* preset with existing TypeScript/DOM/SCSS code and native theme integration.

**Do not** upgrade Typora; modify Typora installation files, the community plugin framework, the global native image-insertion settings, or unrelated project code; alter Markdown test fixtures or user documents merely to pass tests; store/publish PATs or absolute personal paths; silently create `./assets`, `${filename}.assets`, gallery folders, or duplicate image folders from read-only UI actions; weaken or delete failing tests in place of fixing root causes; claim screenshots, real click interaction, or transfer success without corresponding evidence. Avoid new heavy dependencies and new observers/polling loops. Respect the current user's unrelated uncommitted edits. Never merge into `main` or push automatically unless existing project instructions explicitly authorize pushing for this exact task; prefer a focused commit on the active feature branch after successful checks.

Read relevant existing project docs first (`docs/modules/document-hub-and-image-batch.md`, README/index, styling conventions, CHANGELOG, prompt lifecycle). Do not proliferate permanent one-off prompt copies; archive per project policy after extracting durable facts.

## 1. Visual reference priority and historical evidence

The following references identify **design ideas**, not byte-exact UI or an instruction to install libraries:

1. Microsoft Fluent 2, `https://fluent2.microsoft.design/`: dominant neutral surfaces, legible typography, consistent spacing, restrained focus/hover states, theme-aware semantic tokens, compact toolbar composition.
2. Ant Design Segmented, `https://ant.design/components/segmented-cn/`: three equal-width segments with clear selected state; adapt the interaction to existing DOM, preserving keyboard access.
3. JetBrains Problems, `https://www.jetbrains.com/help/idea/problems-tool-window.html`: severity, location, selection, readable compact diagnostics, direct locate.
4. VS Code layout reference, `https://code.visualstudio.com/docs/configure/custom-layout`: guidance for long lists and viewport constraints, **not** a request to create a new docked pane.

**Repository history to inspect (read source/diffs, never blindly revert):**

- `23677ea`: V5.2 expandable status-square, tabs and single content area.
- `a64754f`: diagnostic copy normalization, sort/filter, restrained selected state and compact list styling.
- `4b203ef`: remove redundant per-card detail/expand widgets; row click locates.
- `d3c0f14`: diagnostic severity authority and one-row target-group semantics.
- `32e2db28d`: subtle workspace separators and theme-aware `color-mix`, avoiding layout-shifting borders.
- Existing current commits including `9b3f517` and later changes: discover true HEAD from `git log`; do not assume historic commit is today's working tree.

First distinguish actual present CSS, components and code from the historical ideas described above. Capture the exact style/DOM culprit before proposing a fix.

## 2. Nonnegotiable user decisions (do not reinterpret)

**Geometry:** On expansion the **entire header**, including the 32px square hit region, and the **content surface underneath** must have **exactly the same overall width** and **both left and right edges aligned**. Right-edge-only alignment does not satisfy the requirement. Header and panel must share a width/position authority, not separate `right`/`width` calculations. The status square must be counted inside the header width, never appended outside it.

**States:** Collapsed = only a colored square, no permanent surrounding white rounded box, drop shadow or expanded-width hit interception. Expanded = horizontal header containing `检测 / 图片 / 锁定` and the status square, one content area directly below. Default tab = `检测`, **directly show problem list**: no intermediate summary page, `详情` button, or `返回` navigation. No two overlapping popovers/drawers. UI exists outside serializable `#write`.

**Meaningful behavior:** single click toggles expansion; double click toggles **real** document locking without accidentally running single-click actions; lock tab can also lock/unlock and works for keyboard access; clicking diagnostics uses the existing precise locate transaction; image buttons use established preview → explicit confirmation → authorized execution services; all tabs read **the active document**, with stale async snapshots excluded. Preserve the long/short-document navigator behavior: show only when truly vertically scrollable, hide on short/no active document.

**Visual quality:** visual refinement, *not* another pass of uniformly shrinking text and padding. Main text must remain legible; avoid beige/dirty yellow overall tone, multiple gray card layers, large white button shells, oversized shadow, blue clickable-looking description text, duplicated warnings, excessive warning pills, overly dense metadata, or per-row loud borders.

## 3. G0 — repository baseline and audit

1. `git status --short --branch`, `git log -n 15 --oneline`, check current branch, detached HEAD, uncommitted work, recent changes, project scripts, available GUI/automation environment. Do not overwrite user changes.
2. Record build/test baseline and current deployed plugin identity where possible. Do not confuse a successful build with actual Typora deployment.
3. Inspect current `src/document-utilities/document-hub-controller.ts`, `document-hub-model.ts`, `document-status-indicator.ts`, `document-utility-overlay-host.ts`, `src/style.scss` and related tests; inspect image batch service integration and lock guard.
4. Enumerate all relevant current/legacy SCSS selectors and mounted DOM nodes: `.inkchapter-doc-toolbar-ui`, `.inkchapter-doc-status`, `.inkchapter-doc-expand`, `.inkchapter-doc-expand__tabs`, `.inkchapter-doc-expand__panel`, `.inkchapter-doc-expand__list`, old `.inkchapter-doc-hub`, `.inkchapter-doc-drawer`, `.inkchapter-problems-control` and lock compatibility nodes, if present.
5. Check effective cascade: selector specificity, duplicate rules, theme variables, inherited `background`, `border`, `outline`, `box-shadow`, `padding`, `box-sizing`, `transform`, positioning and `z-index`; inspect current **computed styles**, not SCSS text alone. Never hide a leaked legacy element with yet another `!important` without root-cause correction.
6. Keep a short baseline note on existing screenshot problems: current square looks undersized and right-edge isolated; top three tabs and square feel disconnected; current list is dense and too gray; warning count/filters compete for attention; line numbers need stable alignment. Contrast current browser screenshot with post-change results.

## 4. A1 — one shared layout authority, true top/bottom equal width

Implement/reuse one overlay root and one expanded layout container controlling both header and content width. Prefer a stable max width around **360 CSS px**; investigate **348–368px** using real screenshots, rather than hardcoding per-tab width. Keep `box-sizing: border-box`, `min-width:0`, consistent outer margins, and viewport-aware width such as `min(var(--ink-panel-width), calc(100vw - 2 * var(--ink-edge-margin)))`; if the viewport is narrow, reduce both together. Do not treat screenshot scale as CSS pixels.

Suggested conceptual layout; adapt to real DOM rather than introducing duplicate roots:

```text
inkchapter-doc-toolbar-ui (one root; anchor calculated once)
└─ expandable-layout (one width authority when expanded)
   ├─ toolbar-header (100% width; grid: tabs 1fr | square hot area 32px)
   │  ├─ tabs (3 equal, accessible segments)
   │  └─ square button (transparent 32px area; visual square centered)
   └─ toolbar-content (100% width; same left/right edges)
      └─ active tab only
```

**Hard geometry tests after transitions settle:** abs(header.left-content.left) <= **1 CSS px**, abs(header.right-content.right) <= **1 CSS px**, abs(header.width-content.width) <= **1 CSS px**; no horizontal shift when switching to image or lock; fit within viewport; no overlap with native menu/tabbar. Header and content must share *both* left and right boundaries. Include status-button width in total. Use a single right inset of approximately **12–16px** for the entire component. An additional **8px inward adjustment** may be considered from current screenshot, but **move the whole anchored component**, not just the square, to preserve equal width.

**Collapsed:** root hit box only near square, no remaining invisible 360px rectangle with `pointer-events` capturing editor clicks; expanded width must not resize or reflow Typora editor/Markdown. Position stays stable on scroll, sidebar drag, window resize, display scaling and theme changes. Keep exactly one effective host/root; dispose events cleanly.

## 5. U1 — Fluent Compact header and status square

- Increase *visual* status square from roughly 12px to **14–15 CSS px** (start at 15, compare at 14); about **3px corner radius**. Do not enlarge past 16px without screenshot evidence. Keep **32x32 CSS px transparent click region**, keyboard focus via subtle separate focus ring. No white button shell, permanent shadow, filled large square background or chunky outline. Square centered in fixed-width rightmost header cell, with deliberate space to the header's right edge.
- Color is **semantic**, not decorative. Candidate *light-theme starting tokens* (adjust after contrast measurement): success `#2E9869`, warning `#D49320`, error `#D55050`, unknown `#89919B`, hint `#637F96`. Avoid confusing hint/unknown with success or changing severity semantics. Deep/dark theme requires its own adjusted tokens, not reuse all hex literals.
- Locked = separate **thin, neutral 1–1.5px outline** around square, not recoloring severity. Focus ring separate from lock outline. No extra lock badge text always displayed.
- Header around **34–36px** tall. Three tabs share remaining width equally with consistent 12–13px text, coherent hit areas, vertically centered. Fluent restrained selected state (slightly stronger text and faint surface), Ant Design Segmented-like single selected segment, **without importing Ant Design**. Avoid a visually oversized segmented gray pill and nested rounded button stacks. Hover/focus/pressed/disabled clearly distinct.
- Maintain optional reduced-motion behavior; short 160–180ms left expansion and restrained 80–120ms content changes; avoid height jump and animated scaling of text. Double-click arbitration must not lead to flicker; validate keyboard Tab/Enter/Space, Esc, outside click and pointer movements.

## 6. U2 — one subtle visual language and tokens

Define *locally scoped* `--ink-doc-*` design tokens for dimensions, Fluent-style surfaces, typography, border, hover, selected and severity colors. Make them resolve from Typora theme variables where possible, provide light/dark fallbacks, and avoid overwriting `#write` or application-global rules.

Candidate light-theme palette only as a comparison baseline:

| Token | Candidate | Intended use |
|---|---|---|
| surface | `#FAFAF9` | compact panel |
| hairline | `#E7E9EC` | quiet border/separator |
| primary text | `#293241` | titles, actions |
| secondary text | `#737D89` | explanations and location |
| selection | `#E9EEF4` | subtle selected row |
| warning | `#D49320` | diagnostic marker and square |
| error | `#D55050` | semantic severity |
| success | `#2E9869` | healthy state |
| hint | `#637F96` | hint/info |

Use theme-aware tokens and check readable WCAG-style contrast for ordinary 12–13px text and controls. Do not reduce contrast to obtain an elegant-looking screenshot. Avoid large filled status badges; colors mostly stay in tiny dots/square. Keep **one quiet content surface**, at most a **1px subtle border**, radius about **6px**, optional barely perceptible shadow only if needed to distinguish overlay from editor; collapsed square has no container shadow. No repeated nested card backgrounds. Consistent 4px spacing grid: 4–6px header-panel gap, ~10–12px content padding, ~8px section gap, item padding around 7–9px vertical (tune empirically).

## 7. U3 — diagnostics: compact but legible, no unnecessary states

- Expanded default `检测` tab shows the **actual list immediately**; do not restore summary→details→back. Do not duplicate the title `文档检测` if `检测` is already selected, unless empirical accessibility needs require an offscreen label.
- Header inside content: one meaningful current summary (`11 项警告` for warning-only; mixed severities display all nonzero severities correctly), filter icon/popup and compact accessible refresh icon. No row of four cramped count buttons by default. All severities including zero may still be selected in the filter popup, and an empty filtered result must explicitly say it has no matches (not that scan succeeded).
- Diagnostic list: **two-level text hierarchy**. Primary line severity dot (5–7px), 12–13px legible title, **stable right-aligned 36–42px location cell**; secondary explanation at most two lines, 11.5–12px, left aligned under title and not under dot. Titles may ellipsize only when necessary; accessible full wording must remain available. Use `minmax(0,1fr) auto` grid; avoid long text colliding with line numbers. No repeated `警告` prefix on every row, giant warning badges or individual card boxes. Rows are easy to hover/click and show low-saturation active state. Preserve full keyboard action, screen reader labels and high-contrast focused outline.
- Default order **true document position**; reuse `sortProjectionsByDocumentPosition`, `flattenDiagnosticsToProjections`, diagnostic copy authority and existing host functions instead of reordering derived strings. Group by type is **optional and disabled by default**, never coalesce underlying diagnostic IDs, occurrences or target-group semantics. Do not replace actual diagnostics with the example screenshot items.
- Clicking a row retains the existing `locateDiagnostic` transaction and active visual behavior, closes panel at the correct stage, never calls the old drawer accidentally or breaks document scrolling. All diagnostic counts come from the existing canonical snapshot. Rescanning must be real, with failure surfaced rather than presenting fabricated successful counts.
- Make list scroll **inside panel**, max height derived from available viewport rather than fixed 260px; keep summary/header visible, prevent body-scroll theft, restore reasonable list scroll when appropriate; preserve selected row on snapshot updates when identity remains valid. If document switches, discard stale IDs and asynchronous results.

## 8. U4 — image tab as a small command surface, not settings page

Keep same width as diagnostics regardless of content and switch without horizontal jump. Use compact hierarchy:

1. Current document image scope label (`全局默认` / folder / this document), effective Typora insertion behavior and auto-sync **only when relevant and true**.
2. One concise image usage/pending summary, with a meaningful zero-image empty state (`当前文档无图片`) instead of six zero-count rows.
3. Two equal-width primary row actions: `上传全部` / `下载全部` (disable with reason when inapplicable); second row/low-emphasis actions `检查并补齐双链` and `当前文档设置`.
4. Detailed credentials, caching, profile configuration, six native insertion modes, inherited field overrides remain in **full settings**, not in cramped toolbar.

Maintain global → explicit folder → current Markdown scope semantics, *no* scope mutation simply to display the panel, Typora six native insertion modes untouched, no misreporting an actual native mode as a GitHub plugin preference, no unauthorized directories created while scanning/opening/switching tabs. Upload/download/check actions must call established image batch preview → explicit user confirmation → dedup service; exact result kinds, failure distinction, lock guards and default no Markdown rewrite remain unchanged. Network/PAT-required GUI actions may be `BLOCKED` and must not be fabricated.

## 9. U5 — lock tab compact single-row layout

Keep same panel width; content height may shrink naturally without changing header geometry. Single horizontal row: lock icon + `编辑中`/`已锁定` text and one `锁定`/`解锁` button at right. Optional brief secondary explanation only if user testing justifies it, not a padded empty card. Both button and square double-click call one real edit guard (`editGuard.lock()/unlock()`) with accurate state/async error handling. Verify keyboard, paste, cut, drop and typing are blocked while locked and recover on unlock. Document switching cannot show prior document lock state.

## 10. U6 — implementation cleanup, performance and compatibility

- Avoid creating another independent panel or resurrecting the historic legacy drawer path. One active content container, one status button, three tab triggers. Audit old hidden compatibility nodes: keep only if production callers truly depend on them; migrate tests to public behavior and remove provably dead code. Do not remove shared code used elsewhere.
- Consolidate overlapping CSS selectors and stale V5.1/V5.2 declarations. Do not solve SCSS specificity clashes by stacking more `!important`. Match computed styles and source; test light/dark theme. Only styles/structural DOM necessary for panel change; no editor content/numbering/diagnostic model modifications.
- Guarantee overlay UI outside `#write` and no writes to Markdown text on panel open, filter, rescan or tab switch. No observers/polling added for layout if current event-driven geometry path works. Do not degrade the right-bottom navigator: truly scrollable long document -> visible; short/no active MD -> hidden, with long→short→long and rapid tab switching regression tests.
- Active-document epoch/token guards if asynchronous image or diagnostic results can land after a document switch. Do not swallow errors in a way that makes the UI show successful fake information; presentation exceptions must never terminate the navigator or diagnostics layout pipeline.

## 11. T1 — automated acceptance matrix (add/update tests, preserve others)

**DOM and geometry**: single root and content region, no duplicated active popover, equal width and **both** edges within 1 CSS px after expansion and tab changes; in headless jsdom use geometry stubs rigorously and distinguish structural CSS tests from actual rendered pixels. Assert collapsed transparent 32px hit region and no large invisible pointer interceptor; square size 14–15px; status includes locked separate outline; layout stays inside viewport and avoids the editor/menu/tab bar.

**Interaction**: single/double click arbitration, no double invocation or open flicker, keyboard focus/Enter/Space/Escape/outside click, 3 equal tabs, content switch no horizontal jump, document switch closes/drops stale state, no leaked listeners, reduced-motion and dark theme token contract.

**Diagnostics**: direct list, no summary/details/back, counts across errors/warnings/hints and zero states, filter popup including zero results, list sorted by real document position, target group one row, duplicate occurrence identities, card full wording accessible, row click precise locate and active state, real refresh, scroll container and overflow.

**Image**: zero-image empty view and disabled actions, true scope display, two equal-width actions, batch authorization preview/cancel/execute, dedup result categories and no silent document rewrite, zero unintended `assets`/`${filename}.assets` creation, no credential output.

**Lock and navigator**: actual edit guard, lock transition failure handling, no stale state; short→long→short→long, rapid multi-tab changes, window resize and sidebar drag, actual scrollability eligibility.

Run focused test files after each change and re-run impacted suites before full regression. Do not replace old assertions with less stringent ones merely to match changed appearance; update tests only for explicitly removed intermediate UI behavior while preserving business invariants.

## 12. T2 — real Typora GUI validation (not optional to attempt)

Use the existing Typora test vault and automated or manual GUI capability, without modifying Typora installation. Capture screenshots **before and after** at equivalent document, scroll position, window size, theme and DPI. Inspect 100%, 125%, 150% scales where available; light and dark themes; sidebar narrow/wide and drag; small/large windows; long/short docs; rapid tab switching. Record which conditions are genuinely exercised.

At minimum capture and assess:

- collapsed bare square; focus state; locked outline, warnings/red/green/gray states where a legitimate fixture supports them;
- expanded header and panel precisely **same width, same left and right edges**; capture measured DOM bounding rectangles and CSS pixel deltas (if runtime DOM access available); at 125% DPI do not mistake screen coordinates for CSS coordinates;
- 14px vs 15px square and the subtle inward reposition; pick based on screenshot, not assumed visual success;
- Fluent-ish header and segmented selection, readable list title/explanation/location, hover/focus, real filter and refresh, scroll area, empty list;
- image and lock tabs staying same width; no shadowed giant white outer square or gray nesting; no overlay body content inserted into Markdown;
- actual single click expand/collapse, double click lock, row click locate, external click close and Tab keyboard behavior;
- no negative effect on right-bottom navigator, tab bar, scrollbars, Typora menus and editor text width.

If CDP is unavailable or synthetic clicks cannot hit under 125% DPI: **do not mark real interaction PASS**. Try reliable alternative GUI evidence when permitted; otherwise mark precise cases `NEEDS_MANUAL` and supply exact reproducible manual checklist with screenshots paths. Visual pixel checks are not proven by jsdom unit tests. No pretend to have tested GitHub network transfers when credentials/network are unavailable.

## 13. R1 — repeated execution until objectively complete

Use the following loop within this DSH task, no arbitrary token-saving shortcut:

```text
AUDIT -> IMPLEMENT -> FOCUSED_TEST -> ANALYZE_FAILURE -> ROOT_CAUSE_FIX
      -> FOCUSED_RETEST -> FULL_REGRESSION -> GUI_VISUAL_QA
      -> if a new actionable failure is found, return to ANALYZE_FAILURE.
```

For each failure record reproduction, actual root cause, correction, regression test and evidence. Do not use endless blind retries: if a failure is blocked by unavailable real Typora automation or credentials, explain the concrete blocker and preserve honest `NEEDS_MANUAL`/`BLOCKED`, while finishing every other automatable task in this same run. Avoid asking routine confirmation. Respect branch/scope and do not modify unrelated work to force all-green.

At minimum run commands supported by the repository:

```powershell
pnpm run typecheck
pnpm run build
node scripts/verify-image-privacy.mjs --all
pnpm run docs:verify
```

Run the full Vitest suite with the project's actual package scripts and selected tests; confirm scripts before assuming invocations. Run any existing boot/deployment gate appropriate for the project. Collect total passing/failing **actual** counts, and report exact command failures without making up a green result.

## 14. Delivery format — end-of-run report

Write a concise Chinese final report with:

1. Git baseline, final branch, commit, clean/dirty working tree and whether anything was pushed/merged (never imply a push that did not happen).
2. Historical design sources inspected and **what was actually reused**. Dominant Fluent visual language, other references as behavioral patterns only.
3. Before/after screenshots (actual accessible local paths) and specific visual deltas: square size and inset; panel background/border/shadow; typography and list density; segmented selected state.
4. Header/content measured `left/right/width` for expanded detection, image and lock: CSS px differences, tests at available DPI/theme/window states. Explicitly report **both-edge alignment**. Never substitute right-edge-only for equal width.
5. Business and interaction verification for diagnostics locate, image authorization/dedup/zero-disk-write, real lock, navigator, document switch, editor content integrity.
6. Modified source/tests/docs files, removed obsolete selectors/listeners, any justified compatibility nodes remaining.
7. Focused test count, full Vitest totals, typecheck, build, privacy gate, docs verification and deployment evidence.
8. Separate `PASS` / `FAIL` / `NEEDS_MANUAL` / `BLOCKED` GUI matrix, with precise manual steps and no fabricated PASS.
9. Remaining objective gaps, if any, and where to find durable design documentation.

**Acceptance summary:** A mature, subdued *InkChapter Fluent Compact* toolbar that looks native to Typora, with a slightly larger semantic square located comfortably inside the right edge; unified 360px-ish expanded header and content with **both boundaries equal**, balanced segmented tabs, legible quiet diagnostic list, compact image commands, one-line lock control; zero legacy overlapping overlays; no changes to Markdown content or existing business semantics.
