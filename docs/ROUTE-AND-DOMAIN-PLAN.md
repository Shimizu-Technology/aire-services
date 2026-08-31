# AIRE Services — Route and Domain Plan

## Public routes
- /
- /programs
- /team
- /discovery-flight
- /contact
- /careers
- /kiosk

## Admin routes
- /admin
- /admin/time
- /admin/payroll
- /admin/activity
- /admin/users
- /admin/schedule

`/admin/time` and `/admin/payroll` share the admin-facing Time & Payroll workspace navigation. Payroll remains a separate admin-only route because it finalizes immutable cutoff batches, while Hours Reports remain live and may be exported as drafts.

## Core domain models
- User
- TimeEntry
- TimeEntryBreak
- TimeCategory
- Schedule
- AuditLog

## Likely later
- PayrollExport
- CorrectionRequest
- ShiftTemplate
