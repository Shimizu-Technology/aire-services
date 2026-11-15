# Admin QA polish — November 15, 2026

AIRE Ops serves Guam flight-school staff; Chels administers payroll. This task addresses the admin regression ledger's N2, N4–N7 and the employee/manager ledger's Payroll records contrast finding N14, plus the requested cleanup. It starts at integration commit `fcfaca9` on `qa/integration-20261115c`. The separate staff polish work is excluded.

Sources: local `~/work/qa-regr-adm/LEDGER.md`, `~/work/qa-regr-em/LEDGER.md`, their synthetic harness, the integration code, and the CI workflows. Agent-executed acceptance requires the employment preview to match stored pending time; paused copy to avoid a countdown; touch controls to reach 44px; full names to wrap without breaking words; Payroll records to pass axe; and own-leave reads to contain only the viewer's records.

## Changes and existing integration fixes

| Item | Result | Verification |
| --- | --- | --- |
| N2 employment preview | Integration already makes pending time wait in full through `Payroll::ApprovalHours`. Added the exact two-shift, past-40h regression spec; no competing hours calculation. | Request spec and DB-backed preview: 2 shifts, 16.33h time, 0h overtime. |
| N4 paused Today | A future scheduled lock stays on hold while paused; Today includes the Pay period explanation. | Formatter/card tests; 390 and 1280 browser checks. |
| N5 Reports | Local `pointer-coarse:min-h-11` utilities on presets, dates and selects. | All 16 filter controls measure 44px with a coarse pointer at 390. |
| N6 Roles links | Readable “Note N” links have 44×44px minimum targets and wrap. | All 13 visible markers measure 44×44px; following a link reaches its note. |
| N7 Timecards header | Removed name truncation; normal whitespace and word breaking. | Complete Joaquin Mendiola-Taitano De Leon Guerrero name at 390 and 1024, no horizontal clipping. |
| N14 Payroll records | Darkened the three muted slate-400 labels to slate-500. | Zero axe violations at 390 and 1280. |
| Node pin | Root `.nvmrc` selects Node 22, matching Frontend CI; frontend manifest and lock metadata allow `>=22 <25`. | Clean `npm ci`, types, lint, full tests and CI-equivalent production build on Node 22.23.5. |
| My Leave | `scope=mine` selects `current_user.leave_requests` before filtering, counting and pagination, including for supervisors. The client requests that scope and retains its own-person guard. | Request specs cover supervisor scoping, pagination, forged user ID and employee isolation; browser network checks for employee 264 and manager 262 return only their own data and no team-user list. |
| Activity sentences | Already unified on this integration head. `activitySentences.ts` handles both field-change pairs and PR 4's before/after snapshots through `describeEvent` and shared `summarizeChanges`. `ActivityHistory` has one import. Scoped approval history calls `AuditLogPresenter`, the same server presenter used for Activity summaries; it is a separate safe-data projection, not a second frontend sentence formatter. | Existing sentence, Activity, scoped history and presenter tests retained. No redundant formatter introduced. |
| designBaseline | Already exact on this integration head: the tests use `count !== allowed`, not an upper bound. All current counts match: 65 sub-12px occurrences across 10 files and 5 admin overlays/bars across 4 files. There is no separate legacy-colour allowance in this test to lower. | All four baseline tests pass unchanged. Lowering any current allowance without changing unrelated legacy code would produce a false failure. |
| Zero overtime observation | The classifier deliberately considers projected overtime with pending time included; payable overtime/status uses approved time. A pending shift can therefore have an Overtime exception with `overtime_status=none` in normal use. It is not safe to dismiss this combination as fixture-only. The integration already avoids treating pending time as waiting overtime; this change also omits zero-hour numeric overtime lines in grouped rows and uses “No overtime waiting on this shift” in the review detail. | Row/detail tests and browser Approvals check; 14 pending fixture rows have the projected-overtime/none combination, with no `0.0h overtime to review` text. |

## Local gates

- `npm ci`: passed on Node 22.
- `npx tsc -b`: passed.
- `npx eslint .`: passed.
- Full `npx vitest run`: 150 files, 1,867 tests passed, including designBaseline.
- Production build with Frontend CI's `DEPLOYMENT_ENV=production VITE_DEPLOYMENT_ENV=production`: passed.
- RuboCop: 650 files, no offenses.
- Full RSpec: 2,329 examples, zero failures, one pending opt-in review-batch benchmark.
- Brakeman: 61 controllers, 50 models, zero errors and zero security warnings.
- Impeccable advisory scan of changed UI paths: `[]`.

## Browser acceptance

Implementation tested: `b4250de` (same source as the final evidence-only commit). Chromium 143 headless shell / Playwright 1.57; test-only Clerk stand-in, synthetic fixture, API 3452 and Vite 5452. All 13 required dimension checks passed, plus the Approvals observation check.

| Journey | Dimensions | Result |
| --- | --- | --- |
| Employment preview, pending count/hours checked against DB | 390 touch, 1280 | Passed; 2 shifts / 16.33h; cancelled without ending employment. |
| Today paused explanation, no countdown | 390 touch, 1280 | Passed. |
| Reports filter touch targets | 390 touch/coarse | Passed; 16 controls, each 44px tall. |
| Roles note target sizes and navigation | 390 touch | Passed; 13 markers and note navigation. |
| Timecards long person header | 390 touch, 1024 | Passed; 3 wrapped lines, normal word breaking, no clipped width. |
| Payroll records axe | 390 touch, 1280 | Passed; no violations. |
| My Leave network isolation | Employee 264 and manager 262 at 390 touch | Passed; each response contains only the viewer; `scope=mine`, no team-user read. |
| Approvals projected overtime | 390 touch | Passed; no zero-hour overtime-to-review line. |

Evidence is retained locally in `~/work/qa-poladm/`: `db/qa-results.json`, `db/overtime.json`, `logs/`, `scripts/`, `harness/` and `shots/`. Screenshots cover every required dimension. The evidence records describe checks, not a claim of comprehensive application coverage.

The first RSpec attempt used `db:prepare`, which seeded two users and reference data and caused 12 fixture-isolation failures. The dedicated RSpec DB was recreated using schema load without seeds and the full suite rerun. The browser harness initially lost touch emulation after a full-page screenshot; a probe reproduced the reset (`maxTouchPoints` 1→0), and final checks restore touch emulation before each case. The first production build without deployment flags was refused by the existing build guard; the CI-equivalent invocation passed.

No production access, real Clerk sign-in, email or Cornerstone calls. Mail and payroll dispatch are blocked; provider clients are local fakes. WebKit/Safari and physical devices were not run on this Mac mini. No migrations or production configuration changes.

The installed lifecycle helper could not begin because the local protection profile is absent (`Invalid machine profile: schema_version must be 1`). A manual baseline and exact process records are in `baseline.txt` and `owned-resources.txt`; cleanup is recorded in the local ledger. Shared Postgres remains running. This task leaves the draft PR, branch and clean worktree for integration, without merging or posting reviews/comments.
