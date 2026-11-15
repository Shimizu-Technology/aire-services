# Admin and manager QA fixes — November 15, 2026

Implementation starts from `origin/main` at `2781e01` in the isolated `fix/qa-admin-manager` worktree. AIRE Ops is the Rails/React timekeeping app for AIRE staff, supervisors, and payroll administrators; Cornerstone owns payroll calculations and payments (README product boundary). This task covers the twelve admin/manager findings supplied by the lead. Employee/kiosk work and approval denial are excluded and owned by the other worker.

Acceptance: execute the supplied affected journeys at 1280 and 390 with synthetic local data; preserve complete-export and payroll-batch correction requirements; never send mail or contact Cornerstone. Managers currently edit all team shifts (`TimeEntry#editable_by?`); history must apply that policy and restrict results to the requested shift. Global history and exports remain administrator-only.

Local environment: Node 24, Ruby 3.3.4; API 3445 and Vite 5445. `aire_fixadm_test` is the automated-test DB; `aire_fixadm_qa_test` restores the supplied synthetic dump. External harness: `/Users/agent/work/qa-fixadm`, with Clerk stub and blocked mail/payroll dispatch. Browser resizing tests responsive web behavior; real mobile Safari is not available on this host.

The lifecycle helper failed with `Invalid machine profile: schema_version must be 1`; exact runtime identities and baseline are recorded manually in the external harness. The read-only shared-context check also failed because its configuration path points to the unavailable MacBook Brain Dump. Relevant installed guidance was read directly. No shared service is stopped; `agent-postgres` stays running.

## Decisions and implementation notes

- A waiting shift count is the number of distinct source entries with pending time or pending overtime, counted once even if both need review. Waiting hours use `Payroll::ApprovalHours`, excluding approved regular hours from waiting overtime shifts.
- Draft downloads retain their snapshot and checksum but do not protect entries. Existing incorrectly protected drafts are released by a bounded migration with a five-second local lock timeout. Complete exports and finalized payroll batches retain their protections.
- Worked hours include all completed time in the selected staff/date scope, including waiting regular time. Approved columns remain separate.
- PINs currently accept 4–8 digits in the server and UI. The inline explanation preserves that rule, rather than changing it to the finding's 4–6 digits.

## Verification ledger

Results are being recorded in the external harness; final gate and browser results will be appended here before PR creation.

## Final changes

| Finding | Result |
| --- | --- |
| 1. Waiting totals | The attention row separates live waiting time from waiting overtime; a source shift is counted once even when both need review. A regression spec documents this definition. |
| 2. Corrections after exports | Draft exports never protect shifts. The migration releases historical draft protections without rewriting their snapshots/checksums. Complete exports and payroll batches retain protection. Save-and-history keeps its reason prompt open, focuses the inline field, and confirms “Shift saved.” Export IDs are under Details; server copy identifies the actual protection. |
| 3. Activity | Refused edits show Not saved and name the attempted change. Lock requests and pay-stub deliveries/downloads have plain sentences. Recorded old/new values are described. Read-only payroll previews no longer generate activity. The application source reads “in AIRE Ops.” |
| 4. Reports | Date inputs and all nine selects have accessible names. Legacy panels are collapsed under More detail, use lock wording, and link to the pay period. Waiting people show “Some time still waiting.” |
| 5. Manager history | Managers can list/read only a TimeEntry history permitted by the model edit policy. Global history, other subject types, mismatched detail records, and exports remain forbidden. The return link reopens the shift. |
| 6. Old lock notice | Waiting hours in an old locked period use a compact status and Review link. Upcoming-lock context appears only when that old period has no waiting shifts. |
| 7. Touch targets | Shared button/link styling enforces touch sizing; filters retain 44px coarse-pointer targets. Break presets and Add break are at least 44px, with the 1h preset also 44px wide. |
| 8. End employment | Zero consequences are collapsed, dates are readable, and confirm actions stay outside the scrolling content. |
| 9. Team search | An ended match gets a count and Show ended action that preserves the search. |
| 10. Settings | Pay-period update and delivery receipt are distinguished; reminder and confirmation copy uses lock/role words. Coordinates/radius hide while enforcement is off. A short PIN has an inline 4–8 digit explanation matching existing server behavior. |
| 11. Files | Batch CSV timestamps are labeled Guam/ChST and include +10:00. Hours CSV worked time includes waiting regular time. PDF employee summaries include Time waiting and use the configured department label. |
| 12. Consistency | Navigation names include visible badge text; shift buttons derive names from their visible content. People-picker names/hours wrap. Everyone avoids an almost-outside final-Sunday week. Grouped entry counts use 14px text with sufficient contrast. |

## Automated gates

Application code tested: `fda9555` (the final documentation commit only adds this record).

| Gate | Result |
| --- | --- |
| `npx tsc -b` | Passed |
| `npx eslint .` | Passed |
| Full Vitest | 1,531 passed across 129 files |
| RuboCop | 630 files, zero offenses |
| Full RSpec | 2,203 examples, zero failures, one pending |
| Brakeman | Zero warnings |
| Impeccable advisory | No findings on the scanned report, activity, and edit-sheet paths |

The pending RSpec example is the opt-in 250-shift review/undo benchmark (`REVIEW_BATCH_BENCHMARK=1`), not a failed acceptance scenario.

## Browser QA

Agent executed in Chromium. The main harness has 30 passing assertions across desktop and coarse-pointer phone contexts, the history/old-lock harness has 12, and complete-export editing has 10. These are assertions across the scenarios below, not 52 distinct user journeys.

| Scenario | Desktop 1280 | Phone 390 | Saved outcome/evidence |
| --- | --- | --- | --- |
| Today/attention/Reports totals | Passed | Passed | Initial fixture: 241.01h time, 10.68h overtime. After deliberate edits: 257.34h time, 10.68h overtime; card, row and report agree. |
| Draft download then edit | Server regression plus browser download | Passed | Draft stored with protection false; Daniel’s clock-out changed from 15:39 to 15:30 without a reason. |
| Complete export / save and history | Passed | Passed | Reasonless changes stay unsaved; focused inline prompt remains visible. Retry saves, opens history, and marks the complete export stale. |
| Failed activity and application source | Passed | Passed | Not saved tag, named employee/change, and “in AIRE Ops” shown. |
| Reports accessibility | Zero axe violations | Zero axe violations | 46/42 passing axe rules in final Chromium runs; no horizontal overflow at 390. |
| Manager shift history and return | Roke and Mindy passed | Roke and Mindy passed | Global, other-subject, and missing-shift requests each 403. Scoped history and return-to-edit work. Backend also tests a model-policy refusal. |
| Old-period status | Passed, 60px | Passed, 84px | October fixture has exactly one waiting shift. The QA server explicitly selects it because the restored rollout normally excludes October. This verifies rendering/counting, not publication-selection policy. |
| Touch sizing | Passed | Passed with coarse pointer | Downloads 44px; break presets 44×44; Add break 44px high. |
| End preview | Passed | Passed | Desktop action ends at y=736 of 800; phone action ends at y=828 of 844. Zero consequences are hidden. |
| Team ended-person recovery | Passed | Passed | Daniel ended in the synthetic DB; Show ended finds him and retains the search. |
| Settings | Passed | Passed | Location fields hidden when off; lock recipients and role confirmation; short PIN explanation. Confirmation was cancelled, with no setting saved. |
| CSV/PDF | Passed | Responsive controls passed | Ethan CSV: 99.83h worked versus 83.50h approved. PDF extraction verifies department CFI and Time waiting. Batch CSV header was downloaded through the UI; a populated synthetic endpoint export verifies `2026-11-14T17:00:00+10:00`. |
| Everyone | Passed | Desktop-only view | Defaults to Nov 1–7 inside Nov 1–15. Grouped “2 entries” measures 14px and 11.50:1 contrast against white. |

Evidence lives in `/Users/agent/work/qa-fixadm`: `shots/`, browser-result JSON/logs, gate logs, CSVs, extracted PDF text, and the adapted harness. The first browser checks used T3 Preview; remaining checks used the supplied Chromium harness after Preview timed out around an unsaved-settings browser dialog. The Preview tab and all harness browsers were closed.

Limits: local Clerk stub only; no real Clerk authentication, email delivery, Cornerstone calls, production data, WebKit, or physical mobile Safari. The synthetic October selection override is confined to the external harness. Two experimental CSV fixtures exposed missing fixture metadata; these were not application findings. The final CSV row evidence uses the authenticated export endpoint and full request specs.

## Disposition

Held for the lead: no merge or GitHub reviews/comments were posted. The main clone checkout and the employee/kiosk worker’s worktree were preserved. No production deployment was performed.

Owned Puma and Vite were stopped, task browser contexts and the Preview tab closed, and both task databases dropped. Ports 3445/5445 have no listeners and no `aire_fixadm_*` databases remain. The shared `agent-postgres` server remains running. The worktree and external harness are retained. No runtime handoff remains.
