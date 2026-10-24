# Installation payroll lock rollout

AIRE's payroll calendar belongs to the installation. Configure its cutoff activation once; it has no company foreign key.

After applying migrations `20261024080000` and `20261024090000`, and before enabling new calendar publication, run with the deployment's configured Rails environment:

```sh
bin/rails payroll:configure_lock_rollout STARTS_ON=2026-10-16 ACTOR='operator identity' REASON='Approved October manual and scheduled lock rollout'
```

The equivalent seed API is:

```ruby
PayrollLockRollout.configure!(
  starts_on: '2026-10-16',
  actor: 'Synthetic rollout acceptance',
  reason: 'Approved October rollout fixture'
)
```

The immutable singleton stores the boundary, operator identity, reason and timestamps. Creation also records `payroll_lock_rollout.configured` in the audit log, in the same transaction. The date must be the first or sixteenth of a month. Repeating the same date returns the existing configuration; changing it fails. Database triggers reject updates, deletion and truncation. This setting does not unlock frozen evidence.

New calendar publication fails closed without configuration. Send `lock_mode: 'manual' | 'scheduled'` and `cutoff_enforcement_starts_on: '2026-10-16'`; AIRE validates both against its own installation configuration. Older callers may omit these fields: AIRE derives and freezes them for each new calendar from its period start. October 1–15 is manual; October 16–31 and later are scheduled. Published mode and activation cannot drift, including through direct SQL updates. Request checksums retain legacy replay compatibility; new derived values are also recorded in the publication revision and audit.

Manual calendars may first publish after their nominal cutoff. The nominal `cutoff_at`, date policy and existing cutoff trigger remain intact. The delegated cockpit Lock command requires the existing authenticated payroll-finalization capability, command ID, expected version and reason. It snapshots revision-ledger state at the database clock instant after obtaining the source ledger lock, including the frozen weekly overtime policy. Finalized rows, exclusions, settlement origin, audit and outbox are committed together. Repeating the command returns the same batch. The database also requires a persisted batch actor and an explicit manual-lock batch audit with the reason before a manual calendar can enter finalized state. This blocks an older scheduler from committing its nil-actor nominal-cutoff transaction during a mixed deployment. Scheduler calls and pending-cutoff claim fences skip manual calendars; a failed manual lock requires another explicit Lock action.

Finalized manual period JSON includes `locked_at`, equal to the frozen batch cutoff with six fractional digits. Its nominal `cutoff_at` remains unchanged. Manual batch payload, export metadata, discovery and outbox cutoff timestamps preserve that same microsecond instant. Settlement reconciliation uses the frozen batch cutoff so work included between nominal cutoff and Lock is not mislabeled as late. Later paid-time claims still subtract frozen evidence.

Scheduled calendars keep the existing cutoff instant, delayed-worker revision snapshot, due fences and retry behavior. `next_scheduled_cutoff_at` is installation-wide on the calendar index and every calendar response. It selects the earliest unfinalized enforced scheduled calendar, including a delayed due calendar. It is null when none exists.

Migration preserves every existing calendar's stored scheduled mode and all frozen batches, revisions, checksums and outbox payloads. After configuration, unfinalized legacy calendars before activation are excluded from automatic due selection, direct scheduler finalization, pending claim fences and next-cutoff discovery. They are not silently converted to new manual publications. Review any such row before rollout; the immutable cutoff trigger still applies. Already-finalized historical calendars remain readable and retain their frozen settlement protections. Unlinked historical manual-processing workflows remain available outside published calendar ranges.

Deployment sequence: pause publication and cutoff execution, migrate, inspect existing unfinalized pre-activation calendars, configure the singleton, verify the paired Payroll source has the same boundary, then resume. No production data changes or remote deployment are part of this implementation. Parent owns paired connected UI acceptance and release approval.
