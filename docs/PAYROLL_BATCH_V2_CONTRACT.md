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

The list endpoint discovers finalized batches by their exact nominal dates. The detail endpoint returns the immutable payload plus an `export` envelope containing the stable batch ID, readiness state, cutoff timestamps, checksum algorithm, and checksum scope.

The processing-events endpoint is the append-only acknowledgement channel back from Cornerstone Payroll. It accepts an idempotent `event_id`, a status (`imported`, `committed`, `payment_issued`, or `payment_failed`), `occurred_at`, `external_system`, an optional external pay-period ID, and non-authoritative metadata. These events never change the finalized batch payload or checksum. `imported` means the hours were added to a Cornerstone draft; it does not mean payroll was committed or payment was issued.

## Integrity and idempotency

`schema_version` is `"2.0"`. `export.checksum_algorithm` is `"SHA-256"`, and `export.checksum_scope` is `"payload_without_export"`.

To verify a payload:

1. Save `export.checksum`, then remove the top-level `export` object.
2. Recursively convert object keys to strings and sort them lexicographically. Preserve array order.
3. Normalize decimal values to the JSON float representation emitted by AIRE. AIRE converts Ruby decimal values to a float first, so `8.00`, `8.0`, and a JSON-decoded `8.0` all canonicalize as `8.0`; integer counts and cent amounts remain integers.
4. Serialize the result as compact JSON and compute its SHA-256 hexadecimal digest. Do not otherwise round or reformat received numbers.
5. Reject the payload if the digest differs from `export.checksum`.

Cornerstone must treat `export.batch_id` as the idempotency key. Importing the same batch ID and checksum again returns the existing import. The same batch ID with a different checksum is an integrity failure and must never overwrite an earlier import.

## Required consumer behavior

- Import only `readiness_status: "finalized"` payloads with source `aire_services` and schema `2.0`.
- Preserve the original payload, batch ID, checksum, cutoff, mappings, importing actor, and apply result for audit.
- Reject missing employee, category, or wage mappings instead of guessing.
- Validate that AIRE's `original_week_start` matches the employer's configured legal workweek. Treat AIRE's regular/overtime split as locked source evidence; if Payroll's validation conflicts, stop for review rather than silently rewriting the batch.
- Keep exclusions visible but never pay them from that batch. Only a later positive carryover or correction line makes excluded time payable.
- After applying a batch, post an `imported` processing event. After the containing payroll is irreversibly committed, post a separate `committed` event. Use payment statuses only when the payment lifecycle itself supplies that evidence.
- Require explicit review before applying negative corrections.
- Apply each adjustment exactly once. Do not infer payment from the original entry's current state after the cutoff.

## Immutability

Finalized batches, entries, and exclusions are append-only at both the Rails model and PostgreSQL trigger layers. Removing a finalizing user may null the relational foreign key, but the actor snapshot remains in the immutable payload. Time entries remain editable; later changes settle as future correction lines and never mutate an earlier batch.
