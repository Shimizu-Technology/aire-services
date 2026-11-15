# Admin and manager QA fixes — November 15, 2026

AIRE Ops is AIRE's Rails/React timekeeping app for staff, supervisors and payroll administrators. Cornerstone owns payroll calculations and payments. This record covers PR #207, branch `fix/qa-admin-manager`, including the implementation review after `2ad4c8e`. The first-round record remains in that commit; the decisions and results below supersede it.

Acceptance owner: agent. Scope: the lead's review findings and affected journeys, using synthetic local data only. No merge, production access, real email, Cornerstone call, review comment or additional agent was authorized or performed.

## Final decisions and fixes

| Review item | Implementation |
| --- | --- |
| B1 — coarse-pointer cascade | Removed the unlayered global anchor/button rules. Specific small buttons, links, role chips and report controls use coarse-pointer utilities. Block/hidden utilities retain their layout; large buttons retain 48px height. |
| M1 — historical draft protections | Removed `20261115060000_release_draft_report_protections.rb`, its migration spec and structure version entry. No code depends on the migration. Existing protections remain; the draft-download rule applies going forward. |
| M2 — worked hours | Use the same countable-plus-waiting ledger as Timecards, excluding denied shifts and respecting category, source and entry-method filters. Approval-status filters do not change these control totals. CSV, both PDF formats and screen identify worked hours as approved plus waiting; PDF disclosure explains filters and denied-time exclusion. Regression cases cover denied time and category/source/method filtering. |
| M3 — payment warnings | Failed, cancelled, voided and evidence-needed payment states precede the waiting label. The live-report notice stays outside More detail. Positive payment warnings open More detail automatically. |
| Minor 1 — time-summary contract | `payroll_time_summary` retains its previous readiness and protection behavior, including when time is waiting. Only hours-report downloads get the new draft rule. Model coverage exercises both paths and preserves an earlier protection. |
| Minor 2 — manager privacy | Callers without `view_activity` receive no request context, IP, user agent or actor email. Nested email/request metadata is removed and email strings are redacted. List/detail specs cover both surfaces; the UI accepts the omitted fields. |
| Minor 3 — Today periods | The row uses the current card's count/hours. Earlier waiting time appears separately with period-specific Review links. Denied shifts with pending overtime are excluded from attention and the inbox badge. One waiting-row load supplies totals and earlier-period grouping. |
| Minor 4 — Not saved | Only refused create/update/delete events get the tag. Refused downloads do not; the sentence no longer repeats “not saved:”. |
| Minor 5 — source | Removed “in AIRE Ops” and the admin source label. Kiosk and Phone remain meaningful source labels. |
| Minor 6 — employment preview | Restored singular consequences and guarded invalid/five-digit dates before formatting or confirmation. |
| Minor 7 — Everyone | Select the latest full week inside the period when the current week does not fit. Nov 15 selects Nov 8–14; a past period ending Saturday retains its final full week. |
| Minor 8 — tab name | The tab's accessible name is “Approvals, 12 waiting”; the icon count stays decorative. |

The original PR's correction-reason recovery, scoped manager history, old-period notice, ended-person search, settings explanations, Guam batch CSV timestamps and grouped-entry readability remain implemented. This round retested affected behavior; it does not claim a new full-app audit.

## Environment and fixtures

- Node 24, Ruby 3.3.4, local PostgreSQL; API 3445, application Vite 5445, read-only `origin/main` frontend snapshot on 5446.
- Comparison source: `origin/main` at `8a961a267799c6e38be244808645c639dbb7e755`. Current comparison source is this commit's application changes on `2ad4c8e`.
- Test DB: `aire_fixadm_test`. Browser DB: `aire_fixadm_qa_test`, restored from the supplied synthetic dump, then extended with owned review fixtures.
- Roundtwo Review (`376`): category `399` has 8 approved, 8 denied and 2 pending November hours; category `400` has 4 approved hours. October has 6 waiting hours and a separate denied shift with pending overtime. A synthetic processing event fails one payment; a local attestation supplies the proof-needed warning.
- DB, CSV, PDF and screen reconcile category `399` to **10.00 worked**, **8.00 approved**, **2.00 waiting**. Unfiltered non-denied November time is 14.00h.
- Clerk is stubbed. My Pay comparison uses two local mocked statement responses so no provider is contacted. Other checked journeys use the local API. Mail and payroll dispatch are blocked; no worker runs.
- Chromium: 390×844 with touch/coarse input and 1280×900 with mouse input. Pointer media queries are asserted on every matrix page. Screenshots use viewport capture because full-page capture with this older browser/harness can reset input emulation.

## Final automated gates

| Gate | Result |
| --- | --- |
| `npx tsc -b` | Passed |
| `npx eslint .` | Passed |
| Full `npx vitest run` | **1,535 passed / 129 files** |
| RuboCop | **628 files, zero offenses** |
| Full RSpec | **2,204 examples, zero failures, one pending** |
| Brakeman | **Zero warnings** |
| Impeccable advisory | No findings on the six changed UI paths scanned |

The pending RSpec case is the opt-in 250-shift review/undo benchmark. Tests ran against local databases only. Frontend gates include the last full-week and invalid-year regression cases; the backend gate includes the final inbox/attention scope and time-summary exception.

## Agent-executed browser acceptance

The before/after matrix has **80/80 passing assertions**. The acceptance harness has **31/31 passing assertions** across the cases below. These are assertions, not separate user journeys. Both viewport/input dimensions are required except Everyone, which is a desktop-only view.

| Case | 390 touch | 1280 mouse | Observed result and evidence |
| --- | --- | --- | --- |
| B1 — employee/admin layout | Passed | Passed | My Time/Clock, My Pay, My Hours, kiosk, Roles & access, Today, Approvals and Pay period compared to main. Pay-period and paycheck cards remain block layout; no horizontal overflow; hidden role link stays hidden on phones. `round2-{main,after}-*.png`. |
| B1 — control sizes | Passed | Passed | Actual shared small/large Button components: small ≥44px on touch, ≥36px with mouse; large ≥48px. `round2-shared-button-sizes-*.png`. |
| M2 — filtered worked hours | Passed | Passed | Category-filtered screen shows 10.00h. CSV and consolidated PDF downloaded through the 1280 UI and independently reconciled with DB rows. PDF table is 8.00 approved + 2.00 waiting, 10.00 worked. `round2-filtered.*`, `round2-reconciliation.json`. |
| M3 — failed payment plus waiting | Passed | Passed | Employee badge says Payment needs attention instead of Some time still waiting; both warning counts are visible in opened detail; live notice is outside it. `round2-payment-warnings-*.png`. |
| Manager history privacy | Passed | Passed | List payload has no request context or email; event detail renders without missing-field errors. `round2-manager-history.json`, `round2-manager-history-*.png`. |
| Today current/earlier periods | Passed | Passed | Row/card: 35 current waiting shifts, 243.01h waiting time and 10.68h waiting overtime. Separate line shows 6.0h from October 16–31 with a period-specific Review action. Denied pending-OT shift adds no waiting. `round2-today-earlier-*.png`. |
| Activity tags/source | Passed | Passed | Exactly one Not saved tag for the refused edit, none for refused download; no repeated sentence or admin source suffix. `round2-activity-tags-*.png`. |
| End preview | Passed | Passed | A real local open link produces “1 open pay stub link revoked.” A five-digit year leaves the preview usable and confirmation disabled. `round2-end-{singular,invalid-year}-*.png`. |
| Everyone | Not applicable | Passed | Defaults to Nov 8–14 for Nov 1–15 on Nov 15. `round2-everyone-full-week-1280.png`. |

An early matrix run reset employee login to admin, and an early screenshot mode reset touch emulation. Those harness errors were corrected before the final 80-assertion matrix. Detail-panel probes were corrected to wait for rendering and to support both modal and desktop-region layouts; retained screenshots showed the panels rendering. PDF text reconciliation accounts for table headings wrapping across extraction lines. These were harness issues, not additional application fixes.

Evidence directory: `/Users/agent/work/qa-fixadm/`. Final logs use `round2-*`; screenshots are in `shots/round2-*`. The desktop report was also inspected with T3 Preview before the touch matrix. Real Clerk, provider transport, WebKit, physical mobile Safari and production behavior are not tested.

## Resource disposition

The lifecycle helper reports `Invalid machine profile: schema_version must be 1`; the read-only shared-context checker also fails because `~/.config/shimizu-technology/agent-context.json` is missing. Applicable synced guidance was read directly. Exact ownership, process start signatures and the baseline are recorded manually in `round2-owned-resources.txt` and `round2-resource-baseline.txt`.

Final cleanup is recorded in `round2-resource-cleanup.txt`: task-owned API/Vite processes, browser contexts and Preview tab closed; `aire_fixadm_*` databases dropped. `agent-postgres` remains running. Worktree and harness retained. No runtime resources are handed off. PR is held for the lead; no merge or deployment was performed.
