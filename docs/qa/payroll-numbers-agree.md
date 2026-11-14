# Payroll numbers agree — 2026-11-14

Base: origin/main `ceb079f`. Implementation branch: `fix/payroll-numbers-agree`.

AIRE owns time and approvals; Cornerstone owns payroll runs and payment. Owners/admins prepare payroll from Today, the hours report and its downloads; managers inspect person/timecard totals. Sources: README product boundary, `Payroll::BatchBuilder#target_for`, `AffectedOvertimeReview.approval_valid?`, the Nov 14 usability audit B1/B2/M9 and Nov 11 design glossary §5 / exclusions §7. PR #194 remains held and untouched.

The shared approval gate counts approved regular hours even when overtime waits. Overtime requires a valid approval for the current weekly allocation, including the existing legacy-approval compatibility check. Pending time/chronology holds wait in full; denied time/overtime is neither approved nor waiting. Raw worked-hour ledgers remain separate from approval totals. Frozen settlement batches retain their existing routing, prior-paid adjustment and receipt rules.

CSV compatibility: searched AIRE and Cornerstone read-only. Cornerstone's `TimecardImportsController#parse_csv` reads `Regular Hours` and `Total Hours` (but expects `Employee Name` / `OT Hours`, unlike this report). Preserve existing headers/order and append explicit approval/waiting fields. No changes to ReportExport capture, checksums, source snapshots or frozen batch exports.

Required agent-executed affected-flow QA: shared approved-shift/pending-OT fixture agrees across batch eligibility, Today and report; CSV/PDF exclude waiting OT from approved totals and distinguish it; row Complete requires no waiting work; frozen exports/capture protections unchanged; Today and Settings use one connection vocabulary, with recent confirmed delivery required for Connected. Browser: synthetic audit seed, owner/admin at 1280 and 390, compare Today/report/download/DB; inspect PDF layout. No production DB, external payroll requests or real mail. Native phone hardware and real Clerk/Cornerstone delivery are out of scope.

Execution results will be recorded below with tested commits, gates and limitations.

## Executed evidence

Agent-executed API/download QA used the external audit seed in the local test database, plus one valid Ethan Nov 6 OT approval (3.5h). This is the seed before the audit's later walkthrough actions; it does not claim to reproduce the later 1,715.13h REG snapshot. RSpec advanced the sequences, so the audit's source IDs resolve by synthetic name/date in the saved SQL.

| Case | Result | Evidence |
| --- | --- | --- |
| Today / default approved-only report / CSV agree | Passed via real controller requests, with identical period and filters | Approved 1,590.28h = 1,586.78h REG + 3.50h OT; time waiting 241.01h; OT waiting 10.68h |
| Independent database calculation agrees | Passed | `db-evidence.sql` / `db-evidence.txt`: Sunday-week SQL windows, independent of ApprovalHours |
| Pending OT is excluded from payroll-ready figures | Passed | Jared CSV: REG/total 75.27h, approved OT 0, waiting OT 3.42h, `Draft - needs review` |
| PDF contents and layout | Passed for summary page, Jared detail, and single-employee timesheet | `payroll-page1.png`, `payroll-jared.png`, `employee-page1.png`; extracted all report text, did not visually inspect all 27 pages |
| Frozen exports and capture protection | Passed in regression request specs | Frozen CSV header/bytes and batch attributes stay fixed after live exports; ReportExport snapshot retains raw worked hours and its checksum |
| Connection vocabulary | Passed component/helper tests and API fixture | Existing `delivery_problem`, no successful receipt; Today/Settings share the helper. Paused, no receipt, recent receipt, old receipt and future timestamp cases covered |
| Termination preview | Passed focused request spec | Pending time is counted once; after time approval, its overtime becomes separate waiting OT |
| 1280 and 390 browser journeys | **Blocked / not run** | Machine load rose above 900, exceeding the user's <40 server threshold. API checks and PDF rendering do not substitute for browser acceptance |

Evidence directory (outside Git): `/Users/leonshimizu/Desktop/ShimizuTechnology/output/aire-payroll-numbers-20261114/`. The fixture is synthetic. Outbound mail was blocked, no worker ran, and no production database was accessed.

Approval-status and OT-status filters narrow the worked ledger; the new approval control totals retain all statuses so waiting time remains visible in the default approved-only view. Staff/date/category/source filters apply to both. Raw detailed CSV and the legacy v1 worked-time integration retain their existing contracts. The approvals inbox's whole-shift / projected-review quantities are not the payroll eligibility total. ReportExport's existing category-readiness semantics remain unchanged; `approval_complete` controls the person-row status independently.

## Remaining release acceptance

Run the browser plan in the external `QA-PLAN.md` at 1280x900 and 390x844 when load is below 40. Reconcile the three displayed amounts, exercise downloads, and compare Today / Settings connection wording. Native hardware, real Clerk and live Cornerstone delivery are outside this fixture's coverage. The PR remains held for the lead; no merge or deployment was performed. Render must deploy before Netlify; no migration is required.

## Engineering gates and review

Tested implementation: `b8f144090ed5484f23a3d48120700bfccf114223` (subsequent commits only record this ledger).

- Local: TypeScript and lint passed; RuboCop inspected 639 files with no offenses; Brakeman reported zero warnings/errors; the final affected-backend run passed 199 examples. Relevant frontend retests passed (50 report/settings examples, 43 Today/precision examples, plus the person/timecard/employee subsets). Impeccable's advisory result was `[]`.
- Hosted complete gates: TypeScript, lint, Vitest (122 files / 1,383 tests), build, RuboCop, full RSpec (2,177 examples, zero failures, one existing pending example), Brakeman and dependency audit passed. Local full suites were not started above the user's load threshold.
- The earlier hosted run found four timesheet PDF failures; corrected column widths and both PDF controller variants were retested. A local reset attempt also failed without clearing existing fixture data; that invalid run was stopped and superseded by the clean 199-example run. PostgreSQL 16 tools then restored the verified synthetic fixture backup, and the independent SQL totals were rechecked unchanged.
- CodeRabbit's success-labelled check is rate-limited, **not a completed review**. No reviews are recorded. The lead's independent review and browser acceptance remain outstanding.
- No API/Vite servers or browser tabs were started. No task-owned runtime resource remains running. The held branch/worktree, external harness/evidence, and synthetic QA database are retained for the lead's viewport checks; shared machine services were left untouched.
