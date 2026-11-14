# Payroll numbers agree — 2026-11-14

Base: origin/main `ceb079f`. Implementation branch: `fix/payroll-numbers-agree`.

AIRE owns time and approvals; Cornerstone owns payroll runs and payment. Owners/admins prepare payroll from Today, the hours report and its downloads; managers inspect person/timecard totals. Sources: README product boundary, `Payroll::BatchBuilder#target_for`, `AffectedOvertimeReview.approval_valid?`, the Nov 14 usability audit B1/B2/M9 and Nov 11 design glossary §5 / exclusions §7. PR #194 remains held and untouched.

The shared approval gate counts approved regular hours even when overtime waits. Overtime requires a valid approval for the current weekly allocation, including the existing legacy-approval compatibility check. Pending time is split by valid payable intervals; unplaceable chronology holds stay on the source date; denied time/overtime is neither approved nor waiting. Raw worked-hour ledgers remain separate from approval totals. Frozen settlement batches retain their existing routing, prior-paid adjustment and receipt rules.

CSV contract: the lead verified that Cornerstone does not import this AIRE summary file. The first approval columns now say **Approved regular hours**, **Approved overtime hours**, and **Approved for payroll**; the duplicate approved column is removed. Waiting columns remain, and **Worked hours** follows the selected status filters. Frozen batch headers and ReportExport snapshot/protection code remain unchanged.

Required agent-executed affected-flow QA: shared approved-shift/pending-OT fixture agrees across batch eligibility, Today and report; CSV/PDF exclude waiting OT from approved totals and distinguish it; row Complete requires no waiting work; frozen exports/capture protections unchanged; Today and Settings use one connection vocabulary, with the latest lock delivered and no undelivered events required for Connected. Browser: synthetic audit seed, owner/admin at 1280 and 390, compare Today/report/download/DB; inspect PDF layout. No production DB, external payroll requests or real mail. Native phone hardware and real Clerk/Cornerstone delivery are out of scope.

Execution results will be recorded below with tested commits, gates and limitations.

## Initial implementation evidence (before independent-review follow-up)

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

Initial tested implementation: `b8f144090ed5484f23a3d48120700bfccf114223`. The newer review follow-up below supersedes the initial connection rule and CSV header decision.

- Local: TypeScript and lint passed; RuboCop inspected 639 files with no offenses; Brakeman reported zero warnings/errors; the final affected-backend run passed 199 examples. Relevant frontend retests passed (50 report/settings examples, 43 Today/precision examples, plus the person/timecard/employee subsets). Impeccable's advisory result was `[]`.
- Hosted complete gates: TypeScript, lint, Vitest (122 files / 1,383 tests), build, RuboCop, full RSpec (2,177 examples, zero failures, one existing pending example), Brakeman and dependency audit passed. Local full suites were not started above the user's load threshold.
- The earlier hosted run found four timesheet PDF failures; corrected column widths and both PDF controller variants were retested. A local reset attempt also failed without clearing existing fixture data; that invalid run was stopped and superseded by the clean 199-example run. PostgreSQL 16 tools then restored the verified synthetic fixture backup, and the independent SQL totals were rechecked unchanged.
- CodeRabbit's success-labelled check is rate-limited, **not a completed review**. No reviews are recorded. The lead's independent review and browser acceptance remain outstanding.
- No API/Vite servers or browser tabs were started. No task-owned runtime resource remains running. The held branch/worktree, external harness/evidence, and synthetic QA database are retained for the lead's viewport checks; shared machine services were left untouched.


## Independent-review follow-up — 2026-11-15

The lead's Claude Opus high review on the mini found no blocker in overlapping approval/batch rules and confirmed the BatchBuilder extraction was behavior-neutral. The following decisions were implemented in separate pushed checkpoints:

| Item | Checkpoint | Verification |
| --- | --- | --- |
| M1: latest locked period delivered + no undelivered events; receipt age is context only; restore Last heard from | `30f7f98` | 9 connection request examples and 44 frontend examples |
| M2: exclude effective frozen batch history unless an active settlement case reopens it | `7df077b` | 28 person-editing examples, including a paid 2025 week with nil/none OT flags |
| M3: explicit approval headers, filtered Worked hours, period-facts note, Filtered — filename/title prefix | `8b57b70` | Request specs for header order/uniqueness, worked hours under denied filter, filename and PDF title/note |
| m1: Complete depends on actual waiting hours + open clocks; all Draft exports require acknowledgement | `d23f592` | Zero-OT stale flag / no-ack Complete, rejected unacknowledged Draft, acknowledged Draft |
| m2: summary_only aggregates scalar totals without days/weeks/categories/breakdowns or entry serialization | `a7b7825` | Full-vs-summary scalar equality plus explicit no-detail-builder expectations |
| m3: split valid pending overnight shifts | `8dc5e1f` | 100 affected examples; 2h/6h period split checked across report, Today, entry API quantities and employee evidence |
| m5: document batch-only holds and routing | `c8aad88` | Comment-only; legacy allocation review, payment attestations, replacement-pending skip listed |
| m6: denied overtime is a number even without an allocation | `c848d38` | 81 evidence examples, including the missing-allocation regression |
| m7: no zero-approved-OT action pill | `a6d4be7` | 48 report UI examples, including waiting-only OT |

Final runtime implementation checkpoint: `042d09cbee077ce4207df4f12d5a0cde736ba03d` (gate expectation/type/comment cleanup). Local gates passed: tsc, lint, full Vitest **1,384 tests**, build with the repository's explicit production build flags, RuboCop **639 files / zero offenses**, targeted RSpec **197 examples / zero failures**, Brakeman **zero warnings/errors**. Impeccable's advisory result was `[]`. Full local RSpec was not run because the 1-minute load remained above 60. CI passed on `042d09c`: all frontend/backend jobs, including full RSpec **2,184 examples / zero failures / one pending** (Backend CI run `43605824261`). No servers were started because load remained above 40. Browser acceptance at 1280 and 390 remains required before merge and is handed to the lead/Mac mini if the MacBook stays busy.

Fresh controller/download QA after restoring the synthetic fixture: Today/report/CSV still agree at **1,590.28h approved**, **241.01h time waiting**, **10.68h OT waiting**. Default status-filtered Worked hours is **1,600.96h**. Draft download without acknowledgement returned 422; acknowledgement allowed the download. Both default and pending-filtered PDF summary pages were rendered and visually checked: the period-facts note is one line, and the filtered title is visible. The CSV has no header-note convention, so its first row remains the header. Current evidence is under `/Users/leonshimizu/Desktop/ShimizuTechnology/output/aire-payroll-numbers-review-20261115/`; the synthetic fixture and backup are preserved. No production database, real email, worker or live Cornerstone delivery was used.

### Accepted residuals and next action

- **m4:** a live batch preview without a calendar period can include the Oct 31 portion of an overnight shift when the nominal report starts Nov 1. Batch scope/routing is unchanged.
- Employees may see amounts move between approved/waiting and adjacent periods: these are intended corrections to whole-shift approval and overnight allocation.
- The My Hours headline sums approved plus waiting; denied overtime leaves that headline while the shift remains in history.
- Invalid/unplaceable overnight chronology remains held on the source date until reviewed; only valid payable intervals are split.

The lead must finish browser QA and review the follow-ups before merge. Deploy Render before Netlify. PR #194 remains untouched; after rebasing it must use the new approval quantities, current connection helper and summary_only's empty detail collections.


## Browser attempt — 2026-11-15, 00:46–00:49 ChST

The lead reviewed `a83fa836bfdef867debe85c1f58f79d385be521a` and accepted the follow-ups. Agent-executed browser QA started on that exact head at load **17.14**, after restoring the verified synthetic fixture into `aire_payroll_numbers_qa_test`. API 3433 used the external mail-blocking `qa.ru`; no worker or outbound delivery. Vite 5433 used the external Clerk fixture (Chels, synthetic admin 261). The external Vite config required `--configLoader native`; the initial default/runner import-resolution failures were harness startup failures, before UI acceptance testing.

At **1280×900**, Today visibly showed **1,590.28h Approved for payroll**, **241.01h Time waiting for approval**, and **10.68h Overtime waiting for approval** for Nov 1–15. The delivery-problem card said **Hours haven't reached Cornerstone Payroll yet**, **1 update for Payroll hasn't arrived**, and explained that no receipt is confirmed and AIRE keeps retrying. These desktop subchecks passed. [Today screenshot](payroll-numbers-agree/1280-today.png).

After clicking Reports, load jumped to **134.94 at 00:48:33**. QA paused immediately under the lead's >60 mid-run rule. Reports was still loading at the last observation; this is not classified as an application failure. No additional acceptance actions or mobile checks ran.

Counts use the six requested acceptance scenarios, each requiring both viewports: **0 passed, 0 failed, 6 blocked**. Partial desktop subchecks do not pass a whole scenario.

| Scenario | 1280×900 result | 390×844 result | Acceptance |
| --- | --- | --- | --- |
| Today/report/downloaded CSV/PDF show the same three amounts | Today passed; report/download comparisons not completed | Not run | Blocked by load |
| Jared shows Draft | Not run | Not run | Blocked by load |
| New CSV headers and filtered filename/PDF title, including PayrollRuns link | Not run | Not run | Blocked by load |
| Plain Today/Settings connection copy, including Last heard from | Today passed; Settings not run | Not run | Blocked by load |
| End employment excludes old paid overtime | Not run | Not run | Blocked by load |
| Old Time Tracking has no 0.00 OT button | Not run | Not run | Blocked by load |

The external plan's additional employee/person evidence journeys also remain unrun in the browser; frozen export protection retains the passing regression-spec evidence. Native mobile behavior and real Clerk/Cornerstone delivery are out of scope.

Cleanup completed: exact claimed Puma PID 97611 and Vite PID 98874 terminated, preview tab `tab_34_e60e53fc-08fc-48e4-b927-3d2799347d0a` closed and released, lifecycle reports no active owned resources. The local QA database was dropped after verifying no remaining connections; an explicit catalog query confirms it is absent. Shared PostgreSQL and other borrowed services remain untouched. The verified fixture backup and external harness/evidence are retained for the next attempt. No merge or deployment.


## Mac mini acceptance and final presentation fixes — 2026-11-15

The lead reports browser QA on `a2e19fb` passed **all seven checks at both 1280 and 390** on the Mac mini. Screen, downloaded CSV/PDF and the independent database calculation agree at **1,590.28 / 241.01 / 10.68**; the Filtered — prefix works. This supersedes the earlier load-blocked MacBook attempt for that head. It is lead-executed evidence; the implementation agent did not operate the mini.

Four presentation findings were fixed in separate pushed checkpoints:

| Finding | Checkpoint | Result |
| --- | --- | --- |
| PDF category readiness sounded payroll-ready while approval waited | `d1bb519` | Banner says Draft, names waiting shifts/OT and says only approved hours are included. Empty selections explicitly say no included entries match. Ready requires no actual waiting/open clocks and complete category checks. |
| Report row/page and PDF row status differed from CSV | `8deb41d` | Review status is Complete or Draft - needs review under the CSV's same ready + approval_complete rule. Report banner also says Draft for waiting hours/open clocks. Payroll lifecycle remains a separate status. |
| Settings home tile exposed raw Delivery problem | `90d5d0d` | Tile uses payrollConnectionCopy's title, like Today and connection details. |
| Employee table cut off Payroll/Review at 1280 | `0525ad8` | Eight fixed-width columns with wrapping headers/cells, half the horizontal cell padding, a dedicated waiting column, and no 980px minimum. Staff type, Entries and Breaks move into employee metadata; work categories remain in row detail. Mobile card markup/layout stays unchanged apart from the requested draft wording. |

Comparison with `origin/main` (`ceb079f`): main already has an 11-column table with `min-w-[980px]` and horizontal scrolling. The PR had not added table columns, but its longer approved headers and waiting text increased the intrinsic width. The new desktop layout removes that width constraint and prioritizes the payroll/approval facts. Runtime verification is still needed to establish the actual rendered result.

Acceptance for the final presentation patch: default and zero-included/pending PDFs say Draft; Jared's page/PDF row says Draft; Settings home/detail/Today titles match; all eight desktop columns (including both waiting figures and Payroll) are visible at 1280 with no sideways scroll; the employee drawer still exposes work categories/entries. Local focused tests passed: 52 report frontend tests, 20 Settings/helper tests, 29 final targeted request examples (including frozen bytes/capture protection). Final gate results are recorded below.

MacBook load was **75.49** at the start of these fixes, **71.24** after layout edits, then **1,023.24** during gates. No server/tab was started: the required <40 condition for a 1280 render was not met. **The lead must recheck the new presentation at 1280 on the mini before merge**, including default/pending PDFs, Jared's row and the Settings home tile. Prior browser acceptance does not cover this patch. No payroll calculation, frozen download, ReportExport capture, migration or held PR194 branch change.

The test-only QA database was recreated for RSpec and dropped after the passing request suite, with no remaining connections. External fixture backups/harness remain available. No API/Vite server, tab, worker, real email or production database connection was used in this final patch.


Final presentation gates on runtime implementation `0525ad8`: **tsc, lint, full Vitest (122 files / 1,388 tests, maxWorkers=4), build, RuboCop (639 files / no offenses), targeted RSpec (29 examples / zero failures)** all passed. Impeccable advisory: `[]`. Evidence logs are retained outside Git in `/Users/leonshimizu/Desktop/ShimizuTechnology/output/aire-payroll-numbers-polish-20261115/`. No full local RSpec was added for this presentation-only patch; CI runs the full suite. The final ledger commit changes documentation only. Lifecycle cleanup/status reports no active owned resources; local QA DB absence is verified. PR remains draft and held for the lead; no merge/deployment.
