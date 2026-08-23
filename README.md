# AIRE Services

Standalone product for AIRE Services Guam.

## Product shape
- Public marketing website
- Private admin/ops side
- Kiosk + mobile time tracking
- Attendance visibility
- Payroll-oriented summaries/export

## Status
Initial standalone foundation has been built and pushed.
See:
- `docs/PROJECT-STATUS-2026-03-31.md`
- `docs/FINAL-PR-SUMMARY.md`
- `docs/PUSH-AND-PR-CHECKLIST.md`

## Payroll integration contract

`GET /api/v1/payroll/time_summary` implements Cornerstone Payroll's normative [Time Summary v1 contract](https://github.com/Shimizu-Technology/cornerstone-payroll/blob/main/docs/TIME_TRACKING_V1_CONTRACT.md). AIRE emits `schema_version: "1.0"`, the exact requested range, and one daily row per included employee per requested calendar date. Days without countable time are explicit zero-hour rows so Payroll can reject partial-workweek exports before calculating overtime.

## Source of truth for extraction/planning
- `docs/PROJECT-OVERVIEW.md`
- `docs/PORTING-CHECKLIST.md`
- `docs/ROUTE-AND-DOMAIN-PLAN.md`
- `docs/PRUNE-PASS.md`
- `../cornerstone-tax/docs/AIRE-PORT-MAP.md`
