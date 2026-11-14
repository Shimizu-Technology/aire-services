# Payroll numbers agree — 2026-11-14

Base: origin/main `ceb079f`. Implementation branch: `fix/payroll-numbers-agree`.

AIRE owns time and approvals; Cornerstone owns payroll runs and payment. Owners/admins prepare payroll from Today, the hours report and its downloads; managers inspect person/timecard totals. Sources: README product boundary, `Payroll::BatchBuilder#target_for`, `AffectedOvertimeReview.approval_valid?`, the Nov 14 usability audit B1/B2/M9 and Nov 11 design glossary §5 / exclusions §7. PR #194 remains held and untouched.

The shared approval gate counts approved regular hours even when overtime waits. Overtime requires a valid approval for the current weekly allocation, including the existing legacy-approval compatibility check. Pending time/chronology holds wait in full; denied time/overtime is neither approved nor waiting. Raw worked-hour ledgers remain separate from approval totals. Frozen settlement batches retain their existing routing, prior-paid adjustment and receipt rules.

CSV compatibility: searched AIRE and Cornerstone read-only. Cornerstone's `TimecardImportsController#parse_csv` reads `Regular Hours` and `Total Hours` (but expects `Employee Name` / `OT Hours`, unlike this report). Preserve existing headers/order and append explicit approval/waiting fields. No changes to ReportExport capture, checksums, source snapshots or frozen batch exports.

Required agent-executed affected-flow QA: shared approved-shift/pending-OT fixture agrees across batch eligibility, Today and report; CSV/PDF exclude waiting OT from approved totals and distinguish it; row Complete requires no waiting work; frozen exports/capture protections unchanged; Today and Settings use one connection vocabulary, with recent confirmed delivery required for Connected. Browser: synthetic audit seed, owner/admin at 1280 and 390, compare Today/report/download/DB; inspect PDF layout. No production DB, external payroll requests or real mail. Native phone hardware and real Clerk/Cornerstone delivery are out of scope.

Execution results will be recorded below with tested commits, gates and limitations.
