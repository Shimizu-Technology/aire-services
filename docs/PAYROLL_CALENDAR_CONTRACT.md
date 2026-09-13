# AIRE payroll calendar and cutoff contract

**Schema version:** `1.0`  
**Timezone:** `Pacific/Guam`  
**Schedule owner:** Cornerstone Payroll  
**Time and cutoff owner:** AIRE Services

This contract lets Cornerstone publish AIRE's operator-facing payroll schedule while keeping the actual cutoff dependable inside AIRE. AIRE does not need Cornerstone to be online when a cutoff occurs.

## Regular-period policy

- Regular periods are semimonthly: the 1st–15th and the 16th–last day of the month.
- The cutoff occurs seven calendar days before the pay date in `Pacific/Guam`.
- Cornerstone supplies the exact cutoff time with an explicit UTC offset. This leaves the time-of-day and any approved holiday/weekend handling configurable without weakening the T-7 rule.
- A published period cannot overlap another period.
- A period may be revised only before its current cutoff. Revisions are sequential and their history is append-only.
- The database independently enforces the Guam T-7 date, non-overlap, and post-cutoff schedule lock.

## Authentication

All endpoints require `X-Shared-Secret` or `X-Payroll-Shared-Secret`. AIRE fails closed with `503 Service Unavailable` when its expected secret is not configured.

## Publish or revise a period

`PUT /api/v1/payroll/calendar_periods/:external_pay_period_id`

```json
{
  "schema_version": "1.0",
  "start_date": "2026-10-01",
  "end_date": "2026-10-15",
  "pay_date": "2026-10-25",
  "cutoff_at": "2026-10-18T17:00:00+10:00",
  "time_zone": "Pacific/Guam",
  "cutoff_days_before": 7,
  "schedule_version": 1,
  "publication_id": "f17a0aeb-cf06-45af-83c9-f0460bbc92be"
}
```

The first publication must use version `1`. Each revision must use the next version and a new UUID `publication_id`. Repeating the same publication ID and content is idempotent. Reusing an ID for different content, publishing a stale version, overlapping another period, or changing a period at or after cutoff returns `409 Conflict`.

## Read the calendar

- `GET /api/v1/payroll/calendar_periods` returns up to 100 periods, newest first.
- `GET /api/v1/payroll/calendar_periods/:external_pay_period_id` returns the current period and its retained revision history.

The current record includes `status`, `cutoff_state`, finalization attempts, retry timing, the AIRE batch ID after finalization, and a safe error when attention is required.

## Autonomous cutoff

AIRE checks due periods every minute through its durable production job queue. The finalizer locks the calendar row and the time ledger, then creates one immutable Batch v2 snapshot using the scheduled cutoff instant—even when the worker resumes after an outage.

At cutoff:

- completed `clock` entries, including kiosk, mobile, and legacy clock sources, are eligible without a second approval;
- manual entries and manually corrected entries require explicit approval;
- entries created or approved after cutoff, open clocks, pending or denied approvals, and unresolved overtime are retained with a reason;
- missing work categories remain visible in the immutable source batch and block downstream processing until reviewed;
- negative correction rows are retained in the source batch and marked as requiring review before downstream payroll processing; and
- one durable `payroll_batch.finalized` outbox event is created in the same transaction.

Repeating the cutoff worker does not create another batch or event.

The scheduler processes due periods from oldest to newest. If a later batch already exists, AIRE does not automatically backfill an older period: it marks the older calendar period as needing attention without scheduling another automatic retry. This protects the settlement ledger from pulling work or corrections from a later cutoff into an earlier batch.

Every immutable exclusion creates a settlement case in the same transaction. Eligible late or unapproved work is assigned to the next published regular period. If that period is not published yet, the case stays open under the AIRE-admin role with an action due date. An administrator working through Cornerstone can reroute it to a named supplemental run when the payment deadline requires earlier handling.

## AIRE-to-Cornerstone event delivery

AIRE posts pending events to `CORNERSTONE_PAYROLL_EVENTS_URL` with:

- `X-Shared-Secret` for service authentication;
- `Idempotency-Key` equal to the event UUID; and
- a JSON payload containing the calendar identity, schedule version, immutable batch ID, checksum, totals, and issue counts.

Only a `2xx` response marks delivery complete. Configuration, network, and non-`2xx` failures keep the immutable event and retry with bounded exponential backoff. Production requires an HTTPS destination. The receiving Cornerstone endpoint must treat the event UUID idempotently and fetch the authoritative batch through the existing Batch v2 API.

## Production runtime

Production defaults to Solid Queue inside Puma for the current single-server deployment. A dedicated worker may override this later, but at least one scheduler and worker must remain active. The operational health check should alert on:

- a period still unfinalized after cutoff;
- a period with `status: failed`;
- an outbox event whose delivery remains failed; and
- a missing or stopped Solid Queue process.

After five failed attempts by default, AIRE also reports each repeated calendar-finalization or outbox-delivery failure through Rails' production error reporter. Set `PAYROLL_RETRY_ALERT_THRESHOLD` to change that threshold.
