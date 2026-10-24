# Payroll Batch v2 contract

**Owner:** AIRE Services

**Status:** Normative for importing finalized AIRE cutoffs into Cornerstone Payroll

## Purpose and authority

AIRE owns punches, work dates, approvals, categories, exclusions, and the immutable cutoff ledger. Cornerstone Payroll owns employee and wage mapping, compensation rates, legal-workweek validation, payroll calculation, taxes, checks, liabilities, and the decision to apply a batch. AIRE does not export compensation or pay rates.

A batch contains settlement deltas rather than a mutable restatement of a date range. A current entry is positive work included at the cutoff. A carryover is work from an earlier period that became payable after a prior cutoff. A correction may be positive or negative and reverses or replaces work already included in an earlier batch. Consumers must not discard adjustments because their original work date is outside the new pay period.

## Transport

The source accepts either `X-Payroll-Shared-Secret` or `X-Shared-Secret`.

```text
GET /api/v1/payroll/batches?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD
GET /api/v1/payroll/batches/{batch_id}
POST /api/v1/payroll/batches/{batch_id}/processing_events
```

The list endpoint discovers finalized batches by their exact nominal dates. The detail endpoint returns the immutable payload plus an `export` envelope containing the stable batch ID, readiness state, cutoff timestamps, checksum algorithm, checksum scope, and the source installation's `integration` identity. The integration identity contains the `shimizu_time_payroll` protocol and version, stable source instance UUID, source type, and supported capabilities. Consumers that have pinned an instance UUID must reject a missing or changed identity.

The processing-events endpoint is the append-only acknowledgement channel back from Cornerstone Payroll. A batch event accepts an idempotent `event_id`, a status (`imported`, `committed`, `payment_issued`, or `payment_failed`), `occurred_at`, `external_system`, an optional external pay-period ID, and non-authoritative metadata.

An entry event uses the same endpoint and adds `source_time_entry_id`. It may also include `source_user_uuid`, `external_payroll_item_id`, `payment_method`, and `payment_reference`. Entry statuses are `imported`, `committed`, `payment_prepared`, `payment_issued`, `payment_failed`, `payment_voided`, and `payment_cancelled` (conditional on `payment_cancellation_v1`). Printing a paper check means `payment_prepared`; it is not paid until an operator confirms delivery with `payment_issued`. Legacy consumers record `payment_voided` after a prepared or issued payment is voided. Consumers using `payment_cancellation_v1` must use the delivery-only cancellation contract below when committed payroll remains owed. These events never change the finalized batch payload or checksum.

`imported` means the hours were added to a Cornerstone draft. It does not mean payroll was committed or payment was issued.

An identical `event_id` replay returns HTTP `200` and must match the original batch, status, timestamp instant (to the database's stored precision), external system, external pay-period ID, and metadata. Entry-event replays must also match `source_time_entry_id`, `source_user_uuid`, `external_payroll_item_id`, `payment_method`, and `payment_reference`. Reusing an `event_id` with different event data returns HTTP `409` with `Event ID already belongs to a different processing event`; the original event remains unchanged.

## Integrity and idempotency

`schema_version` is `"2.0"`. `export.checksum_algorithm` is `"SHA-256"`, and `export.checksum_scope` is `"payload_without_export"`.

To verify a payload:

1. Save `export.checksum`, then remove the top-level `export` object. The transport-level `export.integration` identity is deliberately outside the immutable payroll payload and its checksum.
2. Recursively convert object keys to strings and sort them lexicographically. Preserve array order.
3. Normalize decimal values to the JSON float representation emitted by AIRE. AIRE converts Ruby decimal values to a float first, so `8.00`, `8.0`, and a JSON-decoded `8.0` all canonicalize as `8.0`; integer counts and cent amounts remain integers.
4. Serialize the result as compact JSON and compute its SHA-256 hexadecimal digest. Do not otherwise round or reformat received numbers.
5. Reject the payload if the digest differs from `export.checksum`.

Cornerstone must treat `export.batch_id` as the idempotency key. Importing the same batch ID and checksum again returns the existing import. The same batch ID with a different checksum is an integrity failure and must never overwrite an earlier import.

## Required consumer behavior

- Import only `readiness_status: "finalized"` payloads with source `aire_services` and schema `2.0`.
- Preserve the original payload, batch ID, checksum, cutoff, mappings, importing actor, and apply result for audit.
- Prefer `source_user_uuid` for a saved employee mapping when it is present. Continue accepting `source_user_id` for batches finalized before UUIDs were introduced. Email and name are review suggestions only; they are never cross-system identity keys.
- Preserve each `source_time_entry_id` and `line_key` allocation so Cornerstone can acknowledge individual entries without relying on employee-level totals.
- Reject missing employee, category, or wage mappings instead of guessing.
- Validate that AIRE's `original_week_start` matches the employer's configured legal workweek. Treat AIRE's regular/overtime split as locked source evidence; if Payroll's validation conflicts, stop for review rather than silently rewriting the batch.
- Keep exclusions visible but never pay them from that batch. Only a later positive carryover or correction line makes excluded time payable.
- After applying a batch, post an `imported` processing event. After the containing payroll is irreversibly committed, post a separate `committed` event. Use payment statuses only when the payment lifecycle itself supplies that evidence.
- Require explicit review before applying negative corrections.
- Apply each adjustment exactly once. Do not infer payment from the original entry's current state after the cutoff.

## Immutability

Finalized batches, entries, and exclusions are append-only at both the Rails model and PostgreSQL trigger layers. Removing a finalizing user may null the relational foreign key, but the actor snapshot remains in the immutable payload. Time entries remain editable; later changes settle as future correction lines and never mutate an earlier batch.

## Delivery-only cancellation (`payment_cancellation_v1`)

A producer advertising `payment_cancellation_v1` accepts `payment_cancelled` on an exact v2 payable line. This cancels one payment instrument while preserving the committed payroll obligation and reserved source hours. It contributes zero issued hours and committed coverage. Existing `payment_voided` receipts keep their legacy meaning. Once any direct, manual or settlement cancellation history exists, the cancellation migration refuses rollback explicitly before changing constraints or evidence; deploy a compatible forward fix instead of reverting to an application that cannot interpret those records.

The receipt must include the frozen line, hours and employee UUID; the same external system, pay period and payroll item; the original payment method/reference; and `metadata.cancelled_payment_event_id` naming the current exact `payment_prepared` or `payment_issued` receipt. `payment_effective_on` may be sent at the top level or in metadata; conflicting values fail validation. New receipts retain the transported date in metadata and echo it in the acknowledgement. A known predecessor date must match cancellation. An older predecessor without a retained date stays explicitly unknown: cancellation may report its original date, but the source records `metadata.original_payment_effective_on_known: false` and `metadata.original_payment_effective_on: null` without changing the predecessor. For a known date these fields report `true` and the retained predecessor date. `metadata.cancellation_evidence_reference` is a nonblank string of at most 200 characters. Cancellation timestamps require an explicit UTC offset, cannot precede the original receipt and cannot be in the future.

An exact event replay returns the original full acknowledgement, including event/line/employee identity, period/item, exact hours, instrument, reported payment date, physical timestamp and cancellation metadata. Older ordinary saved event retries whose date transport was ignored retain their unknown date and immutable history; the newly permitted top-level date alone does not invalidate that replay. A new cancellation of a stale instrument fails with `409`. Cancellation records remain append-only and suppress delayed prepared/issued receipts for the original instrument. A replacement uses a different payment method/reference tuple, exact frozen identity and a timestamp at or after cancellation. It becomes issued only after its own exact issuance receipt. Consumers must hold unsupported cancellation operations for review and preserve causal delivery order: original acknowledgement, cancellation acknowledgement, then replacement issuance.


## Guam interval allocation (new batches)

New batches record `allocation_contract_version: "guam_intervals_v1"`. AIRE splits completed worked intervals into payable Guam dates before allocating the 40-hour Sunday–Saturday week. Unpaid breaks are intersected with each interval; allocation retains elapsed seconds before reconciling rounded components to the approved entry total. The source entry keeps its nominal work date and ID.

A single source entry can therefore have multiple adjustments, each identified by its retained `source_time_entry_id` **and** `line_key`. The existing dimension form remains `category:<id>|user:<id>|date:<payable-date>`; `original_work_date` and `original_week_start` describe that payable portion. Payroll must import the supplied regular/OT values unchanged and acknowledge each exact line using receipt contract `2.0` and its own line key, source kind and signed components. No Payroll schema or recalculation change is required for the existing multiple-dimension contract. Never collapse these lines to a source-entry-only key.

Old payloads, checksums, line dates/keys and issued receipts remain immutable. An old allocation which would change under this contract is held for explicit current review, then corrected through signed deltas against the retained dimensions. Pending replacement overtime retains prior exported classification until approval, so a negative REG leg cannot temporarily reverse wages without its authorized OT replacement.

Break-only inserts, updates and deletes now append DB-clock source revisions containing the observed break intervals and advance the source version. The migration observes current breaks at upgrade time; it never assigns that chronology to earlier cutoffs. Missing historical chronology, unplaced aggregate overnight breaks, and inconsistent intervals produce an explicit allocation hold. Holds cover both connected weeks; `allocation_review_count` and exclusion `allocation_review_reason` explain the hold. Correct and approve the punches/breaks before retrying.

Manual payment matching currently reserves one nominal date per entry. New overnight entries with multiple payable dates must settle through their exact scheduled batch lines; manual matching fails closed rather than assigning all hours to one date. This does not change #137's reservation/release protocol.

Deployment: the additive migration adds entry allocation evidence and batch contract versions, installs break capture, and appends observations of existing entries under a source-table lock with a five-second lock timeout. It is irreversible because the chronology is append-only. Deploy while connected actions are held; retry a lock-timeout failure. Existing finalized batches are read directly and are never regenerated by this upgrade.


### Review recomputation and paid-hour capacity

Weekly capacity and interval totals use the entry's approved, two-decimal paid hours. Exact elapsed/break seconds determine each payable segment's proportion; segment seconds are scaled to the paid total before weekly allocation. This avoids manufacturing overtime from elapsed seconds already removed by the source's paid-hours rounding, or exporting more than 40 paid regular hours.

Source mutations acquire employee locks in ascending ID order before entry locks. Recalculation queries only old/new affected weeks, beginning one day earlier for overnight starts; a bridging candidate also loads its adjacent week for accurate comparison. Distant date moves use separate week ranges, never the intervening history. Break replacement is one outer correction: nested source/break callbacks share one before snapshot and one final comparison.

Allocation signatures are lazily initialized. An existing nil signature and legacy contract are compared against the legacy allocator, including for unexported live work. Changed OT invalidates old review; unchanged legacy approvals remain intact. Modern entries use their recorded exact signature. An unrelated modern note/OT-decision save skips recomputation; legacy entries cannot take that shortcut until transition evidence exists. There is no eager historical backfill, no signature-based rewrite of exported lines, and no reset of unchanged sibling review evidence. Legacy positive OT with no explicit review status remains pending and excluded until approved. An exact OT approval records the current contract and current allocation signature in the employee-locked transaction, and rejects unresolved chronology. The exporter also rejects mismatched legacy/current OT evidence even before a source mutation. Bulk approval and multi-break correction share one bounded before/after reconciliation. Unrelated later edits do not authorize sweeping old weeks.


The chronology migration sets its5-second lock timeout before any ALTER TABLE. Its all-row observation write has a60-second statement budget; exceeding either budget rolls back the complete migration. Before rollout, rehearse on a representative copy and record duration, row count, WAL/replication impact and available maintenance headroom. No production-size timing is certified by the small synthetic acceptance fixture; do not raise the budget on a live blocked deploy without a new rehearsal. Long readers on either payroll_batches or time_entries are covered by the acquisition regression.
