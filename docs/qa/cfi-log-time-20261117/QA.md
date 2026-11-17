# Instructor Log time verification

November 17, 2026 (Guam). Base: `origin/main` at `afb49c0`. Tested implementation:
`7af0cd66a1fbba3bbc01047691db8829385e6301`. The evidence commit changes only this
record and screenshots. Worktree: `~/work/aire-cfi-log-time`; branch: `fix/cfi-log-time`.

AIRE owns employee time, approvals and auditable hours exports; Cornerstone owns
payroll processing (root README). The lead verified that instructors normally add
individual flights after working them. The November 17 product decision retains
Clock in/out for everyone and makes Log time equally discoverable. Acceptance:
all assigned work remains available for either action; repeat logging preserves
the day/work and clears times/note; manual time still waits for approval; existing
clock, overlap, stale-response and offline behavior stays intact.

The change is frontend only. Clock has a visible Log time card; Hours has one
primary Log time button. New entries use Start/End and the student/aircraft/lesson
note prompt. Existing-entry Ask for a fix keeps its labels and behavior.

## Browser acceptance

Agent executed, local Chromium 143.0.7499.4, Playwright 1.57.0, at 390×900 and
1280×900. Rails ran in test mode on 3466 with a branch-specific local PostgreSQL
QA database; Vite ran on 5466. A temporary Vite transform supplied synthetic
employees and Rails test-token authentication. Its Clerk stub avoided external
sign-in. Those adapters were removed before the implementation commit. Shared
preview reported `available: false`, so Playwright controlled the local browser.
No production, deployment, external payroll or email actions were performed.

Fixtures: pure CFI (Flight Hours, Ground Instruction, Solo); mixed employee
(Flight Hours, Admin Duties); clock-only employee (Admin Duties). These describe
assigned work, not restrictions: all three retain both actions.

| Required scenario | 390 px | 1280 px | Observed result |
| --- | --- | --- | --- |
| Both actions remain discoverable, all assigned clock choices retained | Passed, all 3 fixtures | Passed, all 3 fixtures | Instructor sees all 3 flight chips and Clock in; Log time card is visible. Single-category employee keeps the existing automatic selection. |
| Log two entries via Log another | Passed, all 3 fixtures | Passed, all 3 fixtures | Two successful real API saves each run. Same day/work retained; times/note cleared. CFI/mixed log Flight Hours; clock-only logs Admin Duties. |
| Verify saved time in Hours | Passed, all 3 fixtures | Passed, all 3 fixtures | Both rows show Waiting for approval. Save responses confirm manual entries with pending approval. Primary Log time button visible. |
| Clock in/out remains usable | Passed, all 3 fixtures | Passed, all 3 fixtures | Real app clock-in and clock-out requests succeed, including Flight Hours. Clock in again appears after stopping. |

Four acceptance scenarios passed across six fixture/viewport runs: 12 manual
entries and 6 clock sessions. No application failures or horizontal overflow
observed. The clock fixture alone was moved back two minutes after starting it,
to satisfy the existing one-minute minimum without waiting in real time. The
clock-out journey and saved result still used the UI and real API.

An initial harness assumption expected a category picker for the one-category
employee. Existing WorkChips intentionally hides that picker. The harness was
corrected and the full matrix rerun with fresh fixtures; no application change
was needed. These are resized Chromium checks, not physical-phone, native
keyboard or mobile Safari acceptance. WebKit cannot start on this headless mini.

Screenshots: `{cfi,mixed,clock}-clock-{390,1280}.png` show both actions;
`*-saved-*.png` show Log another/Done; `*-hours-*.png` show persisted pending time.

## Automated gates

| Check | Result |
| --- | --- |
| Full Vitest, `npm test -- --maxWorkers=2` | 153 files, 1,911 tests passed |
| ESLint, `npm run lint` | Passed |
| TypeScript, `npx tsc -b` | Passed |
| Build, `npm run build` with matching production build flags | Passed; local compilation only |
| Full RSpec on restored, unchanged backend | 2,380 examples, zero failures; one existing opt-in review-batch benchmark pending |
| RuboCop | 652 files, zero offenses |
| Brakeman 8.1.0 | Zero errors, zero security warnings |
| Advisory Impeccable 4.6.0 on changed UI files | No findings |

New regression tests cover the Clock action, supervisor-owned categories,
Start/End, repeat logging with retained context and cleared break/note, Done, and
unknown saves never offering Log another. Existing tests cover overlap refusal,
offline state, stale corrections, category reloads and fix requests.

RSpec used the machine's pixi libvips via `DYLD_FALLBACK_LIBRARY_PATH` and the
Ruby interpreter directly; an `/usr/bin/env` executable wrapper drops that
library path on this Mac. Tests used the dedicated `aire_cfi_log_time_test` DB.

Cleanup: all managed browser contexts/browser processes closed, Rails/Vite
processes stopped by exact lifecycle ownership, and temporary auth/config files
removed. Lifecycle session `manual-20261117-171927-77842-9f11` reports no active
owned resources. Both branch-specific databases are dropped before handoff;
shared PostgreSQL remains available. The branch/worktree and PR are intentionally
retained for the lead to review and merge. Nothing was deployed.
