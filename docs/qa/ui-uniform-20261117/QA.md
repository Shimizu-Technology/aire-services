# Staff control consistency QA — November 17, 2026

Implementation tested: `cea6bba145ee75ef5f0b0982d22f6d6aa068b6c3`, based on `88244be`. The evidence commit changes documentation and images only. Worktree: `~/work/aire-ui-uniform`; branch: `fix/ui-uniform-controls`.

AIRE is the single-employer workforce app for AIRE Services Guam. Staff clock time and request leave; managers review time and leave; owners/admins manage access, pay periods and payroll handoff. AIRE owns hours and approvals; Cornerstone owns payroll calculations and payments. Sources: root README, frontend/AGENTS.md, existing page tests and UI kit. This pass keeps AIRE’s navy palette, wording, routes, permissions and request handlers. Operational screens stay still; no new motion.

## Acceptance and environment

Agent-executed layout audit using the shared T3 Chromium browser, local Vite on 127.0.0.1:5187. Five required dimensions: 320×844, 390×844, 1280×844; 390×844 with root font-size 125% and 150%. Normal root size is 16px; enlarged sizes are 20px and 24px. Device pixel ratio is 2. These emulate enlarged web text, not all Safari page-zoom behavior.

Required checks: labels remain on one line inside chips, action buttons and status badges; page scroll width does not exceed viewport width; adjacent actions align; filter rows retain whole chips and scroll; phone row actions sit below text; controls retain at least 44px targets. Multi-line record-selection cards and explanatory text are content, not single-line action captions. Existing help icons have 44px pseudo-element hit areas.

Synthetic fixtures: 37 people, repeated long names including “Joaquin Mendiola-Taitano De Leon Guerrero”, three departments, seven waiting timecards, seven approvals (ordinary and needs-look), four leave requests, three pay-stub requests, nine Today attention states, published open/paid pay periods, settings catalog and an empty Activity history. Local middleware serves fixture JSON; a temporary Vite transform supplies synthetic auth context with actual role capabilities. Those adapters live outside application source and are not committed or built. No backend database, production endpoint, real email, payroll service or deploy was used.

WebKit cannot launch on this headless Mac mini. Physical iPhone Safari, native text settings and touch/keyboard behavior on hardware are **not run**. The resized Chromium checks do not establish those results.

## Results by route and dimension

30 layout cases passed, 0 failed, 0 blocked; 150 required dimension checks passed. The matrix covers loaded page controls, including below-fold controls. It is a visual acceptance audit, not a claim that every business transaction was executed. Raw measurements are in [layout-results.json](layout-results.json).

| Page / fixture route | 320 | 390 | 390 / 125% | 390 / 150% | 1280 |
| --- | --- | --- | --- | --- | --- |
| `/admin` | Pass | Pass | Pass | Pass | Pass |
| `/admin/approvals` | Pass | Pass | Pass | Pass | Pass |
| `/admin/approvals?classic=1` | Pass | Pass | Pass | Pass | Pass |
| `/admin/timecards` | Pass | Pass | Pass | Pass | Pass |
| `/admin/payroll` | Pass | Pass | Pass | Pass | Pass |
| `/admin/pay-stubs` | Pass | Pass | Pass | Pass | Pass |
| `/admin/approvals?kind=leave` | Pass | Pass | Pass | Pass | Pass |
| `/admin/users` | Pass | Pass | Pass | Pass | Pass |
| `/admin/users/7` | Pass | Pass | Pass | Pass | Pass |
| `/admin/settings` | Pass | Pass | Pass | Pass | Pass |
| `/admin/settings/time-clock` | Pass | Pass | Pass | Pass | Pass |
| `/admin/settings/approvals` | Pass | Pass | Pass | Pass | Pass |
| `/admin/settings/pay-stubs` | Pass | Pass | Pass | Pass | Pass |
| `/admin/settings/kiosk` | Pass | Pass | Pass | Pass | Pass |
| `/admin/settings/schedules` | Pass | Pass | Pass | Pass | Pass |
| `/admin/settings/departments` | Pass | Pass | Pass | Pass | Pass |
| `/admin/settings/payroll-connection` | Pass | Pass | Pass | Pass | Pass |
| `/admin/activity` | Pass | Pass | Pass | Pass | Pass |
| `/admin/my-time?qaRole=employee` | Pass | Pass | Pass | Pass | Pass |
| `/admin/my-hours?qaRole=employee` | Pass | Pass | Pass | Pass | Pass |
| `/admin/leave?qaRole=employee` | Pass | Pass | Pass | Pass | Pass |
| `/kiosk` | Pass | Pass | Pass | Pass | Pass |
| `/admin/users/7?tab=time` | Pass | Pass | Pass | Pass | Pass |
| `/admin/users/7?tab=access` | Pass | Pass | Pass | Pass | Pass |
| `/admin/payroll/periods/2026-11-01` | Pass | Pass | Pass | Pass | Pass |
| `/admin/settings/roles` | Pass | Pass | Pass | Pass | Pass |
| `/admin/users/7?tab=pay` | Pass | Pass | Pass | Pass | Pass |
| `/admin/users/7?tab=employment` | Pass | Pass | Pass | Pass | Pass |
| `/admin/timecards?user_id=7&period=2026-11-01` | Pass | Pass | Pass | Pass | Pass |
| `/admin/approvals?qaRole=manager` | Pass | Pass | Pass | Pass | Pass |

`/admin/leave` redirects supervisors to Approvals’ Leave tab; employees retain their own Leave page. Person pages use Overview, Time, Pay, Access and Employment. `qaRole` is interpreted only by the temporary fixture adapter, not by application code.

Additional interaction checks at 390: selected CFI in Timecards, opened a person and verified filter/person/period URL context; opened an Approvals Review sheet and dismissed it with Escape; entered a six-digit synthetic Kiosk PIN and reached the verified employee work selector. No approval, clock or email write was submitted. Existing Vitest interaction tests cover saved outcomes and error handling.

## Before/after evidence

The “before” captures use source from base `88244be`, served by a temporary Vite source loader against the same fixtures. “After” captures use the tested implementation. These are viewport images at 390×844, DPR 2.

| Page | Normal text | 150% text |
| --- | --- | --- |
| Today, before | [PNG](before-today-390-100.png) | [PNG](before-today-390-150.png) |
| Today, after | [PNG](after-today-390-100.png) | [PNG](after-today-390-150.png) |
| Timecards, before | [PNG](before-timecards-390-100.png) | [PNG](before-timecards-390-150.png) |
| Timecards, after | [PNG](after-timecards-390-100.png) | [PNG](after-timecards-390-150.png) |

Initial failures retained here: Timecards’ first chip squeezed/wrapped; Today’s buttons had unequal widths and row actions squeezed text; classic Approvals had wrapped reason badges and short department chips. The 150% pass also exposed page overflow from Pay stubs’ handled-request caption, the Settings Kiosk link, Departments input rows and the Kiosk PIN placeholder. All were repaired and the full matrix repeated. Early fixture-only blank screens from incomplete Payroll/Activity/Pay-tab responses were corrected before acceptance; they were not counted as passes.

## Engineering gates

| Gate | Result |
| --- | --- |
| `npm ci --no-audit --no-fund` | Passed; Node 22.23.5 |
| Full Vitest, `npm test -- --reporter=dot --maxWorkers=2` | 153 files, 1,912 tests passed |
| `npm run lint` | Passed |
| `npx tsc -b --noEmit` | Passed |
| `DEPLOYMENT_ENV=production VITE_DEPLOYMENT_ENV=production npm run build` | Passed; local compilation only |
| Impeccable 4.6.0 advisory detect | No findings in staff components/pages and Kiosk |
| `git diff --check` | Passed |

Only kit geometry assertions changed: chip/segment fixed heights and Button’s pointer-independent minimum. No snapshots or behavioral assertions were removed. Existing React act warnings are non-failing.

## Scope and residuals

Kit: Button/buttonClasses; common chipClasses for FilterChip, TabChips and classic department filters; SegmentedControl; Tabs; StatusPill; AttentionItem; ListRow; PageHeader; selection/unsaved bars. Phone row actions use full-width placement below content. Long employment action text stays one line with ellipsis; its complete label remains accessible.

Page/component integration: Today’s paired actions; Timecards’ chip scroller; legacy classic controls, time/leave editors, reports, payroll records, pay-stub sender, People, Settings, Activity and Kiosk. Legacy boxed buttons now use buttonClasses where applicable; specialized controls retain their selected-state behavior. Kiosk retains its dark palette and larger primary clock target. The handled-request time qualifier is adjacent supporting text while the complete original label remains its accessible name.

No deployment or production verification was requested or performed. The PR must remain unmerged. Physical Safari remains the platform limitation above. Empty Activity history and an empty paycheck list do not cover populated event detail or external paycheck rendering. Schedule/public-website editing and external My Pay transactions were outside the named browser matrix; their touched controls received source audit and the full automated suite.

Shared-guidance setup check failed because this host lacks `~/.config/shimizu-technology/agent-context.json`. Relevant canonical guidance was read directly from `~/Shared-Guidance`. Lifecycle ownership was recorded in session `manual-20261117-182345-83241-2a51`.

Resource cleanup status is recorded in the final completion note.
