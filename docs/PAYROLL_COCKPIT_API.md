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
- `GET /api/v1/payroll/cockpit/manual_review?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD`

### Reported payment evidence index

`GET /api/v1/payroll/cockpit/payment_attestations` returns the canonical `integration` descriptor on every successful page, including an empty period. Existing date, employee, status and pagination filters remain in force. This read also requires the connected administrator identity; legacy grants require `settlement_case_management`.

The canonical integration profile deliberately initializes one durable installation UUID on first use using a unique-key insert. A legacy unpinned, authorized first read may perform that setup; subsequent reads retain the saved UUID. This is installation bootstrap, not financial reconciliation or identity replacement. An invalid saved UUID is never silently replaced.

For this index, an invalid saved identity returns HTTP 503 with `error_code: payroll_source_identity_invalid` and `review_required: true`, without a descriptor or reported-payment data. Service-secret rejection remains 401; an unpinned request denied by its delegated capability remains 403. A valid saved identity that differs from the supplied source pin remains 409. Restore or deliberately coordinate installation-identity rotation through the existing operational process; this endpoint does neither. Other endpoints retain their existing error contracts.

Employee and time-entry results are paginated with `page` and `per_page`. The employee limit is 100 rows per page; the time-entry limit is 250. The payload intentionally omits phone numbers, kiosk credentials, location data, public-site fields, and unrelated operational records.

The exceptions endpoint paginates time exceptions with `page` and `per_page`, and leave exceptions independently with `leave_page` and `leave_per_page`, so advancing one queue never hides rows in the other.

The period overview includes readiness totals, finalized-batch identity and checksum, batch processing history, and carryover counts. Readiness is evaluated at the published cutoff—not from an entry's current approval state—and a finalized period is read from its persisted immutable rows and exclusions. Time submitted or approved after cutoff remains visible as held for a later payroll. Entry rows preserve the AIRE view of punches, breaks, work category, capture source, manual/ordinary state, approvals, missing punches, cutoff disposition, included hours, exclusion reasons, and the entry-to-payment lifecycle.

The settlement-case endpoint is the durable work queue for time that was not included at cutoff or changed afterward. Each case retains the source-entry version, original batch and reason, hours, responsible AIRE-admin role, action due date, named regular or supplemental destination, and append-only event timeline. A regular destination points to a published AIRE calendar period. A supplemental destination points to an explicit Cornerstone run ID. When no future period has been published, the case remains visibly open with a decision due date; publishing the next regular period assigns eligible carryovers automatically.

The manual-review endpoint is a read-only bridge for an operator who must process an existing Cornerstone pay period before an AIRE calendar was published. It evaluates the requested dates at the current time using the same Batch v2 eligibility and carryover rules as finalization, then returns employee regular and overtime hours, eligible carryover, exclusions, issues, and totals. It does not create or finalize a batch, lock time, change approvals, or mark anything paid. Cornerstone uses it only to compare AIRE's live payable hours with manually entered payroll hours.

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

## Cancel a manually linked payment (`payment_cancellation_v1`)

`POST /api/v1/payroll/cockpit/manual_allocations/:id/cancel_payment`

This command requires the shared secret, an eligible delegated actor with settlement-management access, the usual command ID/version/reason, an offset-bearing `occurred_at`, `cancellation_evidence_reference`, and the original `payment_method`, `payment_reference` and `payment_effective_on`. An issued allocation requires its exact saved payment date; an unissued committed allocation may omit the date.

An issued allocation returns to committed; a committed allocation remains committed with a new version and a cancellation record. Both retain their source-hour claim. The command clears active payment fields and appends the original instrument tuple and cancellation evidence to immutable history. It also reopens only settled supplemental cases for the same source identity when remaining issued coverage falls below the case hours and the previous settlement demonstrably depended on the cancelled manual component. Exact component evidence may span pay periods; the existing case target stays unchanged. Older automatic closures require verified final and cancelled issue events recorded before closure. This includes an earlier partial component even when a later component closed the case; independently settled cases stay unchanged. New manual settlements retain every issued component ID and instrument tuple. Case reopening uses the audit recording time and retains the physical cancellation time in metadata.

Both initial acceptance and an exact retry return the original committed acknowledgement/version, even after replacement issuance, plus `command.id` naming the request UUID and the source integration descriptor. Cancellation command metadata retains a bounded immutable `manual_allocation` proof: allocation/source IDs and versions, employee UUID, work date, regular/overtime/total hours, external period/item, committed status and `cancelled_payment` with its native event ID/type, physical timestamp, original instrument/date and cancellation evidence. The response adds the reason from that exact append-only cancellation event; names, history and free text are not duplicated into the command receipt. A stale version or changed command payload returns `409`. An original instrument cannot be issued again after cancellation. The replacement uses a fresh command ID and method/reference tuple. The case-level `payment_cancelled` event is derived from manual allocation evidence; replacement resumes through the allocation’s `issue` command rather than the standalone supplemental acknowledgement API. Existing `void` behavior remains separate: it releases an unissued payroll allocation and continues refusing issued allocations.

## Pay late hours: immutable supplemental snapshot

Both `GET` and `POST /api/v1/payroll/cockpit/periods/:external_pay_period_id/late_hours` require the shared secret and a connected AIRE administrator. Legacy grants require `settlement_case_management`, including for GET. The path identifies the **origin regular calendar period**, not the adjustment destination.

GET returns:

```json
{
  "period_version": 2,
  "cases": [{
    "id": "<case public UUID>",
    "version": 1,
    "employee": {
      "payroll_integration_id": "<source staff UUID>",
      "source_user_id": "42",
      "name": "Example Worker",
      "email": "worker@example.test"
    },
    "reason": "Approved after the original payroll cutoff",
    "adjustments": [{
      "source_time_entry_id": "123",
      "source_time_entry_version": 2,
      "line_key": "category:3|user:42|date:2026-10-01",
      "source_kind": "carryover",
      "original_work_date": "2026-10-01",
      "original_week_start": "2026-09-27",
      "source_category_id": "3",
      "category": {"id": 3, "key": "operations", "name": "Operations"},
      "total_hours": 4,
      "regular_hours": 4,
      "overtime_hours": 0
    }],
    "total_hours": 4,
    "regular_hours": 4,
    "overtime_hours": 0
  }]
}
```

The adjustment lines use the existing batch-v2 serialization. Cases are limited to open, unassigned cases from the origin batch. A source must still be fully payable in the live BatchBuilder context, with positive lines, matching staff identity and original work date, and a resolved category. Any included batch, any effective prior `PayrollBatchEntry` for that entry, active manual allocation, pending payment attestation, other active destination, held approval, denial or chronology hold excludes it. Any due, unfinalized regular cutoff that overlaps current or frozen source dates, or targets the source case, must be finalized and reconciled first. This supplemental fence includes denied, open-clock and pending zero-pay frozen states because their delayed evaluation could otherwise reverse a later claim. The shared guard retains its existing positive-row rule for manual reservations. GET returns an empty case list for a calendar without a finalized origin. Case versions also change when the underlying unassigned source entry is edited or approved; the case's original source version remains unchanged.

POST accepts:

```json
{
  "command_id": "<new UUID>",
  "expected_version": 2,
  "reason": "Pay approved late hours in a separate adjustment",
  "target_external_pay_period_id": "901",
  "pay_date": "2026-10-25",
  "cases": [{"id": "<case public UUID>", "version": 1}]
}
```

`expected_version` is GET's `period_version`. Each case version is the exact integer from GET. Select 1–250 distinct cases. The target is the new Payroll adjustment's positive integer ID encoded as a string. AIRE does not verify Payroll's run type remotely; Payroll owns destination creation and must bind it to this command. `pay_date` uses `YYYY-MM-DD`.

The command takes BatchFinalizer's transaction advisory lock and SHARE locks on time entries, breaks and revisions before locking the origin and selected cases. It revalidates every selection and writes the immutable batch, rows, supplemental routes, included/in-payroll transitions, audit and durable command receipt in one transaction. Any ineligible selection rejects the whole request with `409`. Malformed input returns `422`; stale period/case versions and reused target/command conflicts return `409`.

Success and exact replay both return `201`:

```json
{
  "payroll_batch": {"schema_version": "2.0", "purpose": "supplemental", "target_external_pay_period_id": "901", "...": "full batch-v2 export"},
  "command": {"id": "<request UUID>", "replayed": false}
}
```

This command is an exception to the ordinary minimal `command_result` response: it returns the full original `payroll_batch` snapshot on every exact retry while the claim remains accepted. Retired commands return `409` even on original-command replay. The append-only receipt stores the immutable batch ID and original export envelope; replay combines that envelope with the immutable batch payload. It does not recompute today's payroll source, export capabilities or integration identity. Changing the payload, actor, expected version or target while reusing the command ID conflicts. A different command cannot create another supplemental snapshot for the same target.

The batch payload adds `purpose: "supplemental"`, `target_external_pay_period_id`, `pay_date`, `origin_external_pay_period_id` and `origin_payroll_batch_id`. The checksum covers these fields. Employee `source_user_uuid` and `source_user_id` equal GET's `employee.payroll_integration_id` and `employee.source_user_id`. All selected entry dates are exported, including an overnight line on the day after the origin's nominal end. Batch `start_date`/`end_date` remain the origin's nominal dates. Lines retain the live builder's identities, source versions, category, payable date and Sunday workweek; their source kind is `carryover`. Rates and compensation remain Payroll-owned. No negative or partial-entry rows are admitted.

Use the normal exact-line receipt endpoint on the returned batch ID. Supplemental exact-line receipt responses include `replayed: false` on creation and `replayed: true` on exact retry. A retained receipt replays its stored event even if a later validated correction changed the current owner; a new stale-owner event or changed payload under the same event ID still conflicts. Canceled-claim fencing takes precedence over receipt replay. Initial supplemental receipts require contract `2.0`, the named target run, `external_system: "cornerstone_payroll"`, source staff UUID and Payroll item identity. Issuance additionally requires the payment method and reference. Aggregate batch receipts and legacy case acknowledgements cannot report this snapshot paid. After an exact financial void, `/obligation_events` accepts only an immutable `payroll_obligation_correction_v1` chain rooted in the original target. The validated current successor sends later exact financial callbacks through `/obligation_events` using the saved binding, with `metadata: {}` allowed and without repeating the typed correction command. Both creation and replay require the endpoint selected by that saved binding; `/processing_events` remains for unbound original receipts. Old or arbitrary new owners and wrong-endpoint requests are refused. Every split line needs matching issued evidence from its current validated owner before case completion derives `paid`; commit and payment preparation remain unpaid. The old route endpoint refuses included/in-payroll cases and sources reserved in manual payroll.

Regular batch listing, overlap/publication guards and builder watermarks ignore supplemental snapshots. Ledger balances and receipt views include effective exact rows so subsequent ordinary payroll cannot pay them again. Canceled, never-applied claims retain their frozen payload and rows but cease to represent wages.

Deploy migration `20261024050000_allow_supplemental_payroll_batches` before enabling the command. It changes the date-range unique index to cover regular batches and adds a unique supplemental target index. Existing payloads/checksums are unchanged. Once supplemental batches exist, rollback refuses to discard their immutable evidence; roll forward instead.


### Recover or retire a saved late-hours operation

These additive commands require the shared secret and the **current caller's** active connected actor grant with `settlement_case_management`. A different authorized accountant can recover a saved operation after its creator loses access. Original create-command replay remains actor-bound; recovery does not impersonate its creator.

POST `/api/v1/payroll/cockpit/periods/:origin/late_hours/:source_command_id/recover`:

```json
{
  "command_id": "<fresh recovery UUID>",
  "expected_version": 2,
  "reason": "Reviewed the saved operation and its named adjustment",
  "target_external_pay_period_id": "901"
}
```

`source_command_id` is the original create UUID. `origin` and the positive integer target string must match that original claim. `expected_version` is the origin's current GET `period_version`. A recovery command UUID must differ from the original UUID. Recovery returns `200` with one of:

```json
{"status":"claimed","payroll_batch":{"...":"original immutable export snapshot"},"command":{"id":"<recovery UUID>","replayed":false}}
{"status":"no_claim","command":{"id":"<recovery UUID>","replayed":false}}
{"status":"canceled","command":{"id":"<recovery UUID>","replayed":false}}
```

`claimed` uses the original batch payload and saved export envelope, including its original installation identity. If no original receipt or competing destination binding exists, `no_claim` is an append-only terminal fence for **both** the original command and named target. The fence is committed under the finalizer advisory lock before returning. A delayed original POST, original replay, or new command on that retired target is refused. A new selection must use a new original command **and new adjustment target**. Bare GET absence is never authority to abandon an operation.

POST `/api/v1/payroll/cockpit/periods/:origin/late_hours/:source_command_id/cancel` uses the same fields plus:

```json
{
  "expected_batch_id": "<exact supplemental batch public ID>",
  "confirm_unapplied": true
}
```

The caller must first lock its local operation and adjustment, confirm there are no local items/imports/applied changes, and obtain an explicit reviewed reason. AIRE also requires the original source/origin/target tuple and expected batch, every original case still exclusively in that batch, and **no remote batch/line processing receipt, financial correction, case payment evidence, active manual allocation, pending attestation or other effective owner**. Imported or committed evidence refuses cancellation even without issuance. The response is `200` with `status: "canceled"` and the new command receipt.

Cancellation appends an immutable retirement record, reopens the cases as unassigned with explicit-routing audit, and excludes canceled rows from the live economic ledger. It preserves the original batch, checksum, rows, command receipts and all audit evidence. Exact receipt recording shares the same advisory lock: either the receipt wins and cancellation conflicts, or cancellation wins and all delayed callbacks conflict. Batch detail returns `410` for canceled claims. Recovery of a canceled claim returns `canceled`, including replay of an earlier recovery command; it never offers its snapshot for application again.

Both commands use durable actor-bound command receipts. Exact retries replay their command, while the terminal fence remains authoritative. Malformed confirmation/UUID/target/reason is `422`; stale versions, mismatched command/origin/target/batch and unsafe cancellation are `409`. Recovery/cancellation audits retain the current caller and original actor reference.

Deploy `20261024070000_create_payroll_late_hours_retirements` with this endpoint behavior before enabling the consumer's recovery/cancellation controls. The new append-only table has unique command/target fences and PostgreSQL mutation/truncate protection. Roll forward; its evidence is intentionally irreversible. No existing immutable batch or row is rewritten.
