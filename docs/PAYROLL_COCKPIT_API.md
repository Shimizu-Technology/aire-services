# Cornerstone payroll cockpit API

This API lets Cornerstone Payroll show AIRE's payroll-relevant time data and perform a small set of AIRE-owned actions without exposing unrelated AIRE administration.

## Authentication and authorization

Every request requires `X-Payroll-Shared-Secret`. Read endpoints run as the trusted Cornerstone integration and are recorded in AIRE's audit log.

Commands also require an `X-Aire-Delegation-Token` issued by AIRE. The raw token is shown once when the grant is created; AIRE stores only its SHA-256 digest and a short non-secret hint. Each grant expires after 90 days by default, may never last longer than one year, names its allowed capabilities (`time_approval` and/or `payroll_finalization`), and is bound to one AIRE user. AIRE checks the grant, expiration, current user status, personal access, and current administrator role on every command. A request header cannot grant or elevate an AIRE role.

Until the AIRE settings screen for grant rotation is added, provision a grant from an authenticated Rails console with `PayrollIntegrationGrant.issue!`. Copy `issued_token` directly into Cornerstone's secret store; it becomes unavailable after the record is reloaded. Revoke access by setting the grant's `active` field to `false`. Never place the raw token in logs, source control, or ordinary settings payloads.

Every command body requires:

- `command_id`: a new UUID used for idempotency;
- `expected_version`: the version returned by the latest read;
- `reason`: the operator's explanation.

An exact retry returns the stored status, sets `command.replayed` to `true`, and returns the minimal immutable `command_result` without executing the action again. The caller then refreshes the normal read endpoint if it needs current resource data. This avoids presenting later edits as though they were the original command result. The receipt retains only target IDs, versions, outcome state, and request checksum—not employee names, email addresses, notes, reasons, or timecard payloads. Reusing a command ID for different input or submitting a stale version returns `409 Conflict`. Successful command receipts and audit events are append-only.

Approval and denial commands return `200 OK` when first accepted and on an exact replay. A due finalization request returns `202 Accepted`, including on replay. Missing authentication returns `401 Unauthorized`; an invalid, expired, inactive, or insufficiently scoped delegation returns `403 Forbidden`; a stale version or reused command ID with different input returns `409 Conflict`; and malformed input or an action that is not currently allowed returns `422 Unprocessable Entity`.

## Read endpoints

- `GET /api/v1/payroll/cockpit/employees`
- `GET /api/v1/payroll/cockpit/periods/:external_pay_period_id`
- `GET /api/v1/payroll/cockpit/time_entries?external_pay_period_id=...`
- `GET /api/v1/payroll/cockpit/exceptions?external_pay_period_id=...`

Employee and time-entry results are paginated with `page` and `per_page`. The employee limit is 100 rows per page; the time-entry limit is 250. The payload intentionally omits phone numbers, kiosk credentials, location data, public-site fields, and unrelated operational records.

The exceptions endpoint paginates time exceptions with `page` and `per_page`, and leave exceptions independently with `leave_page` and `leave_per_page`, so advancing one queue never hides rows in the other.

The period overview includes readiness totals, finalized-batch identity and checksum, batch processing history, and carryover counts. Readiness is evaluated at the published cutoff—not from an entry's current approval state—and a finalized period is read from its persisted immutable rows and exclusions. Time submitted or approved after cutoff remains visible as held for a later payroll. Entry rows preserve the AIRE view of punches, breaks, work category, capture source, manual/ordinary state, approvals, missing punches, cutoff disposition, included hours, exclusion reasons, and the entry-to-payment lifecycle.

## Command endpoints

### Approve or deny time

`POST /api/v1/payroll/cockpit/time_entries/:id/approval`

Add `decision: approve` or `decision: deny`. A denial requires a meaningful reason. Manual time remains pending until this separate command succeeds, even when an administrator originally entered it.

### Trigger or retry a due cutoff

`POST /api/v1/payroll/cockpit/periods/:external_pay_period_id/finalize`

The endpoint refuses early finalization. At or after the published cutoff, it invokes the same locked, idempotent finalizer used by AIRE's scheduled job. A failed attempt remains visible with its retry state; an already-finalized period returns the same immutable batch.

## Deliberate boundary

Time corrections, missing-punch resolution, and named regular-versus-supplemental carryover cases need the case model planned for Phase 3.4. They are visible in this read contract where AIRE already has facts, but this phase does not disguise direct row edits as a complete correction workflow.
