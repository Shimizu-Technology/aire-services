# Attention, payroll connection and pay period endpoints

Three read-only endpoints for the AIRE Ops revamp (PLAN.md PR 3). Today (PR 5) and the pay period page (PR 7) use them. None of them change payroll data. All three send `Cache-Control: no-store`, and all times are ISO 8601 in Guam time (`+10:00`).

| Endpoint | Who | Purpose |
| --- | --- | --- |
| `GET /api/v1/attention` | owner, admin, manager (`manage_team_time`) | Today's "Needs attention" list in one request |
| `GET /api/v1/payroll_connection` | owner, admin (`manage_payroll`) | Health of the Cornerstone Payroll connection |
| `GET /api/v1/payroll_periods`, `GET /api/v1/payroll_periods/:start_date` | owner, admin (`manage_payroll`) | Published pay periods and their hand-off state |

Employees get 403. A request with no sign-in gets 401.

## `GET /api/v1/attention`

Code: `AttentionQuery`.

```json
{
  "generated_at": "2026-11-11T00:20:00+10:00",
  "time_zone": "Pacific/Guam",
  "today": "2026-11-11",
  "sections": { "team_time": true, "approvals": true, "payroll": true, "leave": true, "kiosk_pins": true, "pay_stub_requests": true },
  "count": 6,
  "items": [ { "key": "open_clock_earlier_day:812", "type": "open_clock_earlier_day", "tone": "needs_fix", "...": "..." } ],
  "approvals": { "count": 31, "total_hours": 276.06, "oldest_work_date": "2026-11-06",
                 "by_kind": { "time": 30, "overtime": 1, "added": 1, "clocked": 30 } },
  "period": { "published": true, "start_date": "2026-11-01", "end_date": "2026-11-15", "pay_date": "2026-11-25",
              "cutoff_at": "2026-11-18T17:00:00+10:00", "handoff_state": "open", "label": "Open", "label_provisional": true,
              "people": 30, "approved_hours": 1005.0, "waiting_hours": 276.06, "waiting_count": 31, "hours_source": "live" },
  "connected_payroll": { "mode": "enabled", "enabled": true, "message": null }
}
```

`items` is in a fixed order, and each type appears only when it has something in it:

| Order | `type` | `tone` | Shown to | Fields |
| --- | --- | --- | --- | --- |
| 1 | `open_clock_earlier_day` (one per entry, oldest first) | `needs_fix` | `manage_team_time` | `entry_id`, `user`, `work_date`, `clock_in_at`, `status`, `hours_so_far`, `time_category` |
| 2 | `long_clock_today` (over 12h, longest first) | `waiting` | `manage_team_time` | same as above |
| 3 | `approvals_waiting` | `waiting` | `approve_time` | the `approvals` block |
| 4 | `overtime_waiting` | `waiting` | `approve_time` | `count`, `hours`, `hours_complete`, `unprojected_count`, `people[]` (`hours`, `entry_count`, `week_starts`) |
| 5 | `missing_category` | `needs_fix` | `manage_team_time` | `count`, `entry_ids` (first 20), `period` |
| 6 | `payroll_problem` (one per problem) | `needs_fix`, or `info` for a pending change | `manage_payroll` | `problem` plus details |
| 7 | `leave_waiting` | `waiting` | `approve_leave` | `count`, `next` (the earliest-starting request) |
| 8 | `kiosk_pin_locked` (one per person) | `info` | `unlock_kiosk` | `user`, `locked_until` |
| 9 | `pay_stub_requests` | `waiting` | `send_pay_statements` | `count`, `oldest_requested_at` |

`count` is the number of items. Managers get every section except payroll problems.

**Rules:**
- **Earlier-day clocks** are open clock entries whose Guam work date is before today, the same rule as Who's working. A clock started at 11:50 PM is flagged at midnight. `hours_so_far` is the time since clock-in less breaks.
- **Approvals counts** use the same scope as the Approvals badge: `pending_approvals` with no filters, where time or overtime is waiting. `count`, `total_hours`, `oldest_work_date` and `by_kind` equal `summary.entry_count`, `total_hours`, `oldest_work_date`, `pending_time_entry_count`, `pending_overtime_count`, `manual_count` and `clock_count`. `attention_spec.rb` checks this for each supervisor role. `by_kind.added` counts manual (added) entries. The `ordinary` and `needs_look` split comes from the PR 2 classifier (#179) and isn't here yet.
- **Overtime** `count`, and each person's `entry_count` and `week_starts`, come from one aggregate query, so `count` always equals `approvals.by_kind.overtime`. Hours use the inbox's weekly projection (`AffectedOvertimeReview.projected_allocations_for`), which loads every shift in each affected week. To keep Today fast with a long backlog, the projection runs for whole people, oldest waiting first, up to 100 entries (`AttentionQuery::PROJECTED_OVERTIME_LIMIT`). People past that get `hours: null`. If anyone does, the item's `hours` is `null` too, `hours_complete` is `false`, and `unprojected_count` says how many entries have no hours. People are sorted by hours, most first; people without hours come last.
- **Missing category** follows the batch builder's rule. It counts completed, non-denied shifts in the current period that have no category, unless the person has exactly one active category to fall back on.
- **Payroll problems** (`problem`):
  - `connection_paused`
  - `lock_failed` or `lock_overdue`, from `CutoffPresenter.attention`
  - `lock_change_pending`, `lock_change_refused` or `lock_change_expired`, from `LockControl.state[:pending_change]`. The change details are in `change`.
- **Period** is the earliest scheduled period that isn't locked yet. Without one, it falls back to the published period containing today. If nothing is published, it's the semimonthly dates around today, with `published: false`. A shift with overtime waiting counts as waiting in full, so approved and waiting hours never overlap. The waiting numbers equal `pending_approvals` filtered to the period's dates.

## `GET /api/v1/payroll_connection`

Code: `Payroll::ConnectionStatus`.

```json
{
  "mode": "enabled", "enabled": true, "message": null,
  "state": "connected",
  "last_publication": { "external_pay_period_id": "…", "start_date": "2026-11-01", "end_date": "2026-11-15",
                        "schedule_version": 2, "publication_id": "…", "published_at": "2026-11-11T19:05:00+10:00" },
  "last_delivery": { "event_id": "…", "event_type": "payroll_batch.finalized", "occurred_at": "…", "delivered_at": "…",
                     "period": { "external_pay_period_id": "…", "start_date": "2026-10-16", "end_date": "2026-10-31" } },
  "undelivered": { "count": 0, "failed_count": 0, "stuck_count": 0, "events": [] },
  "account_link": { "aire_user": { "id": 2, "full_name": "Chels …" }, "payroll_user_email": "…",
                    "linked_at": "2026-10-05T10:00:00+10:00", "connected": true },
  "active_link_count": 1
}
```

- **`state`** is `paused` when `ConnectedPayrollMode` is paused. Otherwise it's `delivery_problem` when any event is failed or stuck, and `connected` if not.
- **`last_publication`** is the newest `PayrollCalendarPeriodRevision`. AIRE writes a revision only for a publication it accepted. Refused publications reach the lock card through `lock_change`.
- **`undelivered.events`** lists the oldest 20 problem events. `failed_count` and `stuck_count` count all of them, not just the listed ones. An event is `failed` when Cornerstone refused it or couldn't be reached; retries continue. It's `stuck` when it's still pending 10 minutes after it was created. An event that's still sending isn't listed, but it counts in `count`. `last_error` is cut to 300 characters.
- **`account_link`** is the newest active link: the AIRE admin who approved it, the Cornerstone account email, and when.

## `GET /api/v1/payroll_periods` and `/:start_date`

Code: `Payroll::PeriodHandoffState`.

The index returns `{ periods: [...], current_start_date, labels, connected_payroll }`, newest first. `limit` defaults to 12 and is clamped to 1–48. A `limit` that isn't a whole number (for example `limit[]=12` or `limit=twelve`) gets 422.

The show route takes the period's first day (`2026-11-01`). It returns `{ period, previous_start_date, next_start_date, labels, connected_payroll }`.
- A start date that isn't the 1st or the 16th gets 422.
- A date with no published period gets 404 with `code: "not_published"`.

Each period:

```json
{
  "id": 7, "external_pay_period_id": "…", "start_date": "2026-11-01", "end_date": "2026-11-15", "pay_date": "2026-11-25",
  "cutoff_at": "2026-11-18T17:00:00+10:00", "lock_mode": "scheduled", "status": "scheduled", "cutoff_state": "upcoming",
  "cutoff_source": "policy", "override": null, "lock_change": null,
  "handoff_state": "open", "label": "Open", "label_provisional": true,
  "steps": [ { "key": "open", "label": "Open", "state": "current" }, { "key": "locked", "label": "Locked for payroll", "state": "upcoming" } ],
  "locked_at": null, "payroll_batch_id": null, "delivery": null, "payroll_status": null,
  "people": 30, "approved_hours": 1005.0, "waiting_hours": 276.06, "waiting_count": 31, "hours_source": "live"
}
```

### How `handoff_state` is derived

1. **`before_locking`**: the period isn't under a scheduled lock. That's either `lock_mode: "manual"` or a start date before the lock rollout (`scheduled_lock_enforced?` is false).
2. **`open`**: the period isn't `finalized`, or it has no batch.
   - A period whose lock failed stays `open` with `status: "failed"` and `cutoff_state: "attention_required"`.
   - A period whose lock time has passed but hasn't locked yet stays `open` with `cutoff_state: "due"`.
3. If the period is finalized with a batch, the state comes from the batch's processing status (`PayrollBatch#processing_summary`, which includes per-line events):
   - no events: **`locked`**
   - `imported`: **`received`**
   - `payment_issued`: **`paid`**
   - anything else: **`in_run`**. That covers `committed`, `payment_prepared` and partial statuses, and also `payment_failed`, `payment_voided` and `payment_cancelled`. `payroll_status` is `{ status, occurred_at }`; `status` says which, so payment problems stay visible. `occurred_at` is in Guam time like every other time here.

A locked period that Payroll hasn't received stays `locked`. `delivery` shows the outbox event for it: `pending`, `failed` or `delivered`, plus `stuck`, attempts, and the last response status and error.

Lock control follows #170/#173:
- **`override`** has the same fields as `lock_control.override`, plus `policy_cutoff_at`.
- **`lock_change`** equals `lock_control.pending_change` (`pending`, `rejected` or `expired`), for the period the lock control acts on.

**Hours:** open periods use live entries (`hours_source: "live"`), with the same rules as attention's `period`. Locked periods use the frozen batch summary (`hours_source: "locked"`): `people`, `locked_hours`, `locked_regular_hours` and `locked_overtime_hours`.

### Labels

`label` uses the plain words from the glossary draft (DESIGN.md §5). Chels hasn't confirmed them, so every period has `label_provisional: true`, and `labels` carries `{ provisional: true, note, states }`.

| `handoff_state` | `label` |
| --- | --- |
| `open` | Open |
| `locked` | Locked for payroll |
| `received` | Received by Payroll |
| `in_run` | In a payroll run |
| `paid` | Paid |
| `before_locking` | Before locking |

To change a word, edit `Payroll::PeriodHandoffState::LABELS`.
