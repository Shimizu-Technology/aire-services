# Instructor Log time verification

November 17, 2026 (Guam). Base: `origin/main` at `afb49c0`. Latest browser-tested implementation:
`4307c436f1d4799f356827ef7c836567c886b4e9`. Original full-gate implementation:
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

## Final browser pass at 4307c436: overnight acceptance failed

Agent executed on November 17, 2026 (Guam), Chromium 143.0.7499.4 / Playwright
1.57.0 at 390×900 and 1280×900, with fresh pure-CFI and clock-only fixtures.
No application code changed. The non-default Clock chip was Solo.

| Requested check | 390 px | 1280 px | Result |
| --- | --- | --- | --- |
| Chosen Clock chip preselects Work | Passed | Passed | Solo stayed selected in Log time. A separate delayed real-category response also filled Work after the sheet opened. |
| Save 22:00–01:30 overnight time | Failed | Failed | Form displayed 3.5h and Ends the next day; API refused with HTTP 422, End time must be after start time. Nothing saved. |
| Saved overnight summary says next day | Blocked | Blocked | Cannot reach a saved overnight summary through the real API. |
| Summary receives keyboard focus after a successful daytime save | Passed | Passed | Actual active element was the Sent for approval status, with Solo, day, range and 1.0h. |
| Log another focuses Start and clears times without a premature next-day hint | Passed | Passed | Start was the active element; date/Solo retained; both times blank. Hint also absent after entering Start alone. |
| Second daytime flight then Done; Hours pending with no stray toast | Passed | Passed | Both Solo entries pending. Also added a third entry directly from Hours to exercise its own callback; no duplicate added-time toast appeared after Done. |
| Clock-only Clock in/out sanity | Passed | Passed | Admin Duties clock-in and clock-out succeeded at both widths. |

The overnight refusal is a real application acceptance blocker. Reproduction:
Clock → Solo → Log time → Nov 13 (390) or Nov 14 (1280) → 22:00–01:30 →
Add 3.5h for approval. `POST /api/v1/time_entries` returns
`{"error":"End time must be after start time"}`. Read-only source inspection
finds the existing manual-time validator at `backend/app/models/time_entry.rb:275`
rejecting an end wall-clock time at or before start; the controller normalizes
both HH:MM fields to the same date at
`backend/app/controllers/api/v1/time_entries_controller.rb:923`. No fix attempted.

After recording each refusal, changed that form to 08:00–09:00 to continue the
independent acceptance checks, then logged 10:00–11:00 through Log another.
A third 12:00–13:00 entry was added directly from Hours. Six manual/pending
entries and two clock sessions succeeded; two overnight writes were refused.
The clock-only fixture alone was moved back two minutes after clock-in to pass
the existing minimum duration. Keyboard focus was asserted against the actual
active DOM element, not inferred from screenshots. The visible chip label was
used after the initial harness tried to click its covered, visually hidden radio;
that locator correction did not change the app or any saved data.

Refreshed `cfi-clock-*`, `cfi-saved-*` and `cfi-hours-*`. Current saved screenshots
show the successful daytime fallback, not an overnight save. Added
`cfi-overnight-form-*`, `cfi-overnight-refused-*` and `cfi-log-another-*` for both
widths. Clock-only screenshots remain from the earlier pass; its final clock
sanity was interaction-tested without replacing those images. Earlier mixed
and full-gate results below remain historical, not retests of this SHA.

Local test-mode Rails/Vite used ports 3466/5466 and the dedicated
`aire_cfi_log_time_qa` database, with the same temporary test-auth adapter.
All browser contexts/processes and servers closed; temporary config removed;
QA database dropped. Lifecycle `manual-20261117-175042-81123-035a` reports no
active owned resources. No production, deployment or email actions. Physical
phone and mobile Safari were not run. The full automated gates were not repeated
for this evidence-only update. The lead must resolve or explicitly disposition
the overnight blocker before treating the requested final acceptance as passed.

## Earlier browser recheck after the lead’s polish

Tested `e77fee42f9ed85246f4d90217b56395163a88aa7` on November 17, 2026 (Guam).
Agent reran the local Playwright/Chromium harness at 390×900 and 1280×900 with
fresh pure-CFI and clock-only fixtures. The CFI logged Flight Hours; the
clock-only employee logged its assigned Admin Duties. No application code changed
in this evidence update.

| Required recheck | Pure CFI, 390 / 1280 | Clock-only, 390 / 1280 |
| --- | --- | --- |
| Clock in and secondary Log time visible; buttons do not overlap | Passed / Passed | Passed / Passed |
| First save shows Sent for approval, work, day, start–end and hours | Passed / Passed | Passed / Passed |
| Log another keeps day/work, clears times/note, and saves a second entry | Passed / Passed | Passed / Passed |
| Both manual entries show Waiting for approval in Hours | Passed / Passed | Passed / Passed |

All four fixture/viewport runs passed: eight real manual entries saved with
pending approval. Both first and second save summaries were asserted against the
selected work, date, time range and 1.0h duration. The saved screenshots show the
second entry. No horizontal overflow or application defects were observed.
Clock-in/out mutations and the full automated gates were not repeated in this
focused recheck; their earlier results below remain historical coverage.

Replaced the Clock, saved-sheet and Hours screenshots for `cfi` and `clock` at
both widths. The mixed-fixture screenshots still document the original run.
The two 390-pixel Hours captures are byte-identical to their prior versions.
Local Rails/Vite used ports 3466/5466 and a fresh `aire_cfi_log_time_qa` database.
The temporary Vite auth adapter and Clerk stub supplied local test identities;
no external auth, production data, deployment or email was used. All browser
contexts/processes and servers were closed, the temporary Vite config removed,
and the QA database dropped. Lifecycle session
`manual-20261117-174401-80562-25f6` reports no active owned resources. Shared
PostgreSQL remains available. Physical-phone and mobile Safari coverage remain
not run on this headless mini.

## Original browser acceptance at 7af0cd6

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

## Original automated gates at 7af0cd6

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
