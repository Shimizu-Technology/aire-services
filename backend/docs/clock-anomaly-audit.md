# Clock anomaly audit and legacy compatibility

Before releasing the precise-edit / forgotten-clock fix, an authorized operator must run the deployed task against production using read-only database credentials and retain its output in a private location:

```sh
RAILS_ENV=production bin/rails time_entries:audit_clock_anomalies > clock-anomalies.jsonl
```

This is a required **read-only release step**, not a migration. No production run was performed during implementation. The task prevents Active Record writes and makes no repairs, approvals, exports or provider calls. Existing approved/exported/paid source rows retain their recorded hours and status on unrelated saves. Any correction requires separate administrator review and the existing payroll correction process.

The output contains one JSON object per matching clock entry, with source id, user id/name, work date, actual punches, saved hours, break minutes, actual elapsed span, net elapsed hours, signed saved-minus-net discrepancy, approval status, payroll lifecycle/payment status, settlement quantities and export ids/states/protection flags. Empty output means no matching rows. Export history includes stale exports. Payment state uses the same receipt/manual-allocation/attestation lifecycle resolver as the application; missing evidence is not proof that no external payment occurred.

An entry matches when its elapsed span is **at least 24 hours**, or its saved hours differ from `elapsed hours - break_minutes / 60` by **at least one hour** in either direction. Completed entries use actual clock-in/out timestamps. Open clocks use one fixed report observation time and are flagged only for the long span; no saved-hours discrepancy is inferred before clock-out. Manual entries and records without a clock-in timestamp are excluded. Thresholds apply before rounding displayed values to six decimal places. Negative net spans remain visible, including impossible break totals.

These are investigation candidates, not payable-hour recommendations. Corrected nominal endpoints can intentionally differ from actual punches, and a long forgotten clock does not prove that the employee worked the elapsed interval. The task does not auto-repair or auto-pay anything.

## TimeEntry mutation audit

Audited `update!`, `save!`, `update_columns`, `update_all`, ordinary `update`/`save`, and explicit `calculate_hours_from_times` calls under `app/services`, `app/jobs`, and `app/controllers` for this follow-up.

| Path | Writes and policy |
| --- | --- |
| `TimeEntriesController#create/update` | Creates/saves source data; real time/category changes and all employee self-edits return to review. Admin note-only edits retain approval. A second `update!` may recompute overtime metadata without recalculating unchanged time. |
| `TimeClockService` clock-in/out, break start/end, category switch, stale closure | Creates/updates actual time or live status. Time calculation holds closed spans >=24h at zero hours/pending. Category switch closes the old session and creates the next. |
| `TimeClockService` approve/deny entry and overtime | Explicit entry/overtime approvals check the long-clock guard under lock. Denials update review metadata. Model validation additionally blocks transitions into approved, including direct callers, while allowing saves of historical approved sources. |
| `TimeEntryReviewCorrection` | Saves explicit administrator closure/time corrections or denied-entry resubmission. Closure must span less than 24h; review transitions remain intentional. |
| `Payroll::TimeEntryCorrection` | Saves corrections with its existing unconditional return-to-review policy. Its explicit calculator call now respects dirty time fields, so a description-only correction retains legacy hours/punches while intentionally returning pending. |
| Jobs | No direct TimeEntry saves found. Settlement capture job reads sources and creates separate case/event records. |
| Payroll receipts, settlement coordinator, revision ledger and outbox | Processing receipts, cases, revisions and domain events use separate models. No direct TimeEntry mutation found. Source snapshots remain unchanged. |

No TimeEntry `update_columns`/`update_all` bypass was found in the audited production paths. Regression fixtures deliberately use `update_columns` to reproduce already-persisted legacy history. Ordinary metadata/category saves and explicit calculator calls leave historical approved sources unchanged; actual time edits still trigger the hold. The model transition validation does not authorize a fresh approval through service paths that reject held entries.
