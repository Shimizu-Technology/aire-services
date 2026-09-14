# Cornerstone payroll cockpit API

This API lets Cornerstone Payroll show AIRE's payroll-relevant time data and perform a small set of AIRE-owned actions without exposing unrelated AIRE administration.

## Authentication and authorization

Every request requires `X-Payroll-Shared-Secret`. Read endpoints run as the trusted Cornerstone integration and are recorded in AIRE's audit log.

Commands also require a personal AIRE administrator identity. The normal path is a durable account link: Cornerstone sends `X-Cornerstone-Actor-Id`, and AIRE resolves it to the administrator who approved the connection. AIRE checks the linked user's current administrator role, active status, and personal sign-in access on every command. The connection has no timer-based expiration. It stops immediately when either side disconnects it or the AIRE account loses access.

Cornerstone starts the link with `POST /api/v1/payroll/account_link_sessions`. The request requires the shared secret and includes the Cornerstone actor ID, actor email, and a secure Cornerstone return URL. AIRE returns a 10-minute, single-use authorization URL. The operator signs in to AIRE, reviews both account identities and the allowed payroll actions, and confirms the link. Cornerstone can then check or revoke the link with `GET` or `DELETE /api/v1/payroll/account_links/:external_actor_id`.

The former `X-Aire-Delegation-Token` path remains available during migration. Those grants retain their configured capability and expiration checks. New setup should use account linking; operators no longer need to generate, copy, store, or renew personal tokens.

Every command body requires:

- `command_id`: a new UUID used for idempotency;
- `expected_version`: the version returned by the latest read;
- `reason`: the operator's explanation.

An exact retry returns the stored status, sets `command.replayed` to `true`, and returns the minimal immutable `command_result` without executing the action again. The caller then refreshes the normal read endpoint if it needs current resource data. This avoids presenting later edits as though they were the original command result. The receipt retains only target IDs, versions, outcome state, and request checksum—not employee names, email addresses, notes, reasons, or timecard payloads. Reusing a command ID for different input or submitting a stale version returns `409 Conflict`. Successful command receipts and audit events are append-only.

Approval and denial commands return `200 OK` when first accepted and on an exact replay. A due finalization request returns `202 Accepted`, including on replay. Missing authentication returns `401 Unauthorized`; a missing or inactive account link, an invalid legacy delegation, or an ineligible AIRE account returns `403 Forbidden`; a stale version or reused command ID with different input returns `409 Conflict`; and malformed input or an action that is not currently allowed returns `422 Unprocessable Entity`.

## Read endpoints

- `GET /api/v1/payroll/cockpit/employees`
- `GET /api/v1/payroll/cockpit/periods/:external_pay_period_id`
- `GET /api/v1/payroll/cockpit/time_entries?external_pay_period_id=...`
- `GET /api/v1/payroll/cockpit/exceptions?external_pay_period_id=...`
- `GET /api/v1/payroll/cockpit/settlement_cases?external_pay_period_id=...`

Employee and time-entry results are paginated with `page` and `per_page`. The employee limit is 100 rows per page; the time-entry limit is 250. The payload intentionally omits phone numbers, kiosk credentials, location data, public-site fields, and unrelated operational records.

The exceptions endpoint paginates time exceptions with `page` and `per_page`, and leave exceptions independently with `leave_page` and `leave_per_page`, so advancing one queue never hides rows in the other.

The period overview includes readiness totals, finalized-batch identity and checksum, batch processing history, and carryover counts. Readiness is evaluated at the published cutoff—not from an entry's current approval state—and a finalized period is read from its persisted immutable rows and exclusions. Time submitted or approved after cutoff remains visible as held for a later payroll. Entry rows preserve the AIRE view of punches, breaks, work category, capture source, manual/ordinary state, approvals, missing punches, cutoff disposition, included hours, exclusion reasons, and the entry-to-payment lifecycle.

The settlement-case endpoint is the durable work queue for time that was not included at cutoff or changed afterward. Each case retains the source-entry version, original batch and reason, hours, responsible AIRE-admin role, action due date, named regular or supplemental destination, and append-only event timeline. A regular destination points to a published AIRE calendar period. A supplemental destination points to an explicit Cornerstone run ID. When no future period has been published, the case remains visibly open with a decision due date; publishing the next regular period assigns eligible carryovers automatically.

## Command endpoints

### Approve or deny time

`POST /api/v1/payroll/cockpit/time_entries/:id/approval`

Add `decision: approve` or `decision: deny`. A denial requires a meaningful reason. Manual time remains pending until this separate command succeeds, even when an administrator originally entered it.

### Trigger or retry a due cutoff

`POST /api/v1/payroll/cockpit/periods/:external_pay_period_id/finalize`

The endpoint refuses early finalization. At or after the published cutoff, it invokes the same locked, idempotent finalizer used by AIRE's scheduled job. A failed attempt remains visible with its retry state; an already-finalized period returns the same immutable batch. AIRE also refuses to automatically finalize an older period after a later batch exists, because doing so could pull later corrections backward. That failure is non-retryable and requires operator review.

### Correct time or resolve a missing punch

`POST /api/v1/payroll/cockpit/time_entries/:id/correction`

The command accepts corrected `work_date`, `start_time`, `end_time`, `time_category_id`, `description`, and complete `breaks` rows. It is applied by AIRE under the delegated administrator's identity. A correction never becomes immediately payable: AIRE clears the old approval, records before/after evidence, and requires a separate approval command. Resolving an open clock with an end time completes the entry and follows the same approval rule.

### Route a held-time case

`POST /api/v1/payroll/cockpit/settlement_cases/:id/route`

Use `destination_kind: regular` with a published future `target_external_pay_period_id`, or `destination_kind: supplemental` with a named Cornerstone run and `action_due_on`. `not_payable` is an explicit reviewed disposition, not an inference from a denial. Routing changes use the case's version and create an append-only event.

### Acknowledge a supplemental case

`POST /api/v1/payroll/cockpit/settlement_cases/:id/acknowledge`

The supported event types are `imported`, `committed`, `payment_prepared`, `payment_issued`, `payment_failed`, `payment_voided`, `payment_returned`, and `settled`. AIRE accepts them only for supplemental cases and in that order; failed, voided, or returned payments may return to `payment_prepared` for a new attempt. Event timestamps cannot move backward. Regular cases use the existing batch-entry lifecycle instead, so there is one processing history per payment. These are exact lifecycle facts: `payment_issued` does not mean cleared or settled. Metadata may retain the Cornerstone payroll item and physical-check reference so the time entry can be traced to its payment instrument.

## System boundary

AIRE owns source time, approvals, corrections, cutoff batches, and settlement-case routing history. Cornerstone owns payroll calculation, pay items, physical checks, liabilities, filings, and the final payment record. The case API links those records without allowing either application to edit the other application's authoritative tables.
