# AIRE Services — Prune Pass

## Goal
Reduce the initial extraction footprint so the standalone repo reflects AIRE’s actual product shape instead of donor-app leftovers.

## What was removed
### Backend controllers removed
- payroll import / payroll checklist endpoints
- service task / service type endpoints
- workflow stage / workflow event endpoints
- client/contact/client-operation endpoints
- intake / documents / tax return endpoints
- operation cycle / template / task endpoints
- portal namespace endpoints
- schedule time preset endpoints
- audit log endpoint

### Backend services removed
- operation cycle generation services
- intake import/services
- payroll checklist/reconciliation services
- notification and S3 helper services not needed for current AIRE scope

### Backend tasks/specs removed
- daily task / operations / users rake tasks not relevant to AIRE v1
- operation/payroll/client-related specs not relevant to the standalone AIRE foundation

## What remains intentionally
- timekeeping core
- kiosk auth/token flow
- AIRE kiosk endpoints
- schedules, categories, users, time period locks
- contact endpoint
- focused kiosk specs

## Verification
- `bundle exec rails zeitwerk:check`
- `bundle exec rspec spec/models/user_kiosk_spec.rb spec/requests/aire_kiosk_spec.rb`

## Note
This was a targeted prune pass focused on obviously unused controller/service/spec surfaces.
A deeper domain-model simplification pass can happen later once the standalone product shape stabilizes further.
