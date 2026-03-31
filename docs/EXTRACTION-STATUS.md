# AIRE Services — Extraction Status

## Status
Initial scaffold + first port pass completed.

## What has been done
### Scaffold
- Created standalone repo folder: `~/work/aire-services`
- Seeded backend/frontend scaffold from `aire-ops-api`
- Added AIRE-specific planning docs

### Backend ported from validated prototype
- `User` kiosk PIN logic
- `TimeEntry` + `clock_source`
- `TimeCategory`, `Schedule`, `TimeEntryBreak`, `TimePeriodLock`, `AuditLog`, `Setting`
- `TimeClockService`
- `AireKioskService`
- `AireKioskToken`
- auth/base/time-related controllers
- admin user/time category/time lock controllers
- AIRE kiosk controller
- kiosk/time-tracking migrations
- kiosk specs
- Rack::Attack config
- routes file copied as donor baseline

### Frontend ported from validated prototype
- `AireHome`, `AirePrograms`, `AireTeam`, `AireContact`, `AireKiosk`
- `ClockInOutCard`
- `WhosWorking`
- admin `Users`, `TimeTracking`, `Schedule`, `Dashboard`
- `api.ts`
- simplified AIRE-focused `App.tsx`

## Important note
This is a **first extraction pass**, not a finished clean standalone app yet.

The codebase still needs:
- removal of leftover non-AIRE domain files from the scaffold
- route pruning on the backend
- layout/branding cleanup for AIRE
- dependency/config verification
- install/build/test pass inside the new repo

## Next steps
1. Prune non-AIRE backend/frontend files from `aire-services`
2. Reduce routes to AIRE-only public/admin/api surfaces
3. Verify/install backend and frontend dependencies in the new repo
4. Run build/test checks in `aire-services`
5. Start rebuilding public pages around AIRE branding/content
