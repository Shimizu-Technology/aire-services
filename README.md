# AIRE Services

Standalone product for AIRE Services Guam.

## Product shape
- Public marketing website
- Private admin/ops side
- Kiosk + mobile time tracking
- Attendance visibility
- Payroll-oriented summaries/export

## Product boundary

AIRE is currently a single-employer workforce/timekeeping application for AIRE Services Guam. It owns punches, schedules, work categories, approvals, leave requests, and auditable hours exports. It does **not** calculate payroll taxes, gross-to-net pay, checks, or payroll liabilities; Cornerstone Payroll remains authoritative for those results.

The current schema is not a shared multi-customer SaaS tenancy model. Commercializing the workforce capability for multiple employers requires tenant-scoped ownership and authorization (or isolated per-customer deployments as a deliberate interim model), not only a branding change.

## Status
Initial standalone foundation has been built and pushed.
See:
- `docs/PROJECT-STATUS-2026-03-31.md`
- `docs/FINAL-PR-SUMMARY.md`
- `docs/PUSH-AND-PR-CHECKLIST.md`
- `docs/GATE_0_FRONTEND_DEPENDENCY_CLOSEOUT_2026-08-23.md`

## Payroll integration contract

`GET /api/v1/payroll/time_summary` implements Cornerstone Payroll's normative [Time Summary v1 contract](https://github.com/Shimizu-Technology/cornerstone-payroll/blob/main/docs/TIME_TRACKING_V1_CONTRACT.md). AIRE emits `schema_version: "1.0"`, the exact requested range, and one daily row per included employee per requested calendar date. Days without countable time are explicit zero-hour rows so Payroll can reject partial-workweek exports before calculating overtime.

Finalized payroll cutoffs use AIRE's [Payroll Batch v2 contract](docs/PAYROLL_BATCH_V2_CONTRACT.md). A batch is an immutable settlement ledger: payable hours are frozen at one cutoff instant, unresolved work remains traceable, and later approvals or corrections become explicit adjustments in a future batch. Cornerstone Payroll should import by batch ID and verify the canonical SHA-256 checksum before applying it.

## Source of truth for extraction/planning
- `docs/PROJECT-OVERVIEW.md`
- `docs/PORTING-CHECKLIST.md`
- `docs/ROUTE-AND-DOMAIN-PLAN.md`
- `docs/PRUNE-PASS.md`
- `../cornerstone-tax/docs/AIRE-PORT-MAP.md`
