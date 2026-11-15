# Rehearsal follow-up verification

Initial base: `origin/main` at `b0542bf`; rebased onto dependency-update head `e02a24a`. Tested implementation commit: `a6002d69ced5ae42945305f9288e637ae93617ba`; the following evidence commit changes only this ledger and screenshots. Worktree: `~/work/fix-rehearsal-followups`; branch: `fix/rehearsal-followups-20261116`. No migrations, production access, external payroll requests, or email delivery.

AIRE owns punches, time/leave approvals and frozen payroll hours. Cornerstone owns payroll processing and import. Sources: root README; `docs/PAYROLL_CALENDAR_CONTRACT.md`; `Payroll::LockControl`, `Payroll::ApprovalHours`, `Payroll::CarryoverQueue`; Approvals and pay-period page tests. Acceptance: honest uncertain outcomes; manager dates from the next published lock; accurate open-clock, waiting-hours and import wording; expiring and restorable Undo; current-filter and current-entry race protection.

Agent-executed affected-flow QA, November 16 (Guam), local Chromium at 390×844 and 1280×900. The manager header desktop capture is 1280×800. Screenshots use device pixel ratio 2. Local API on 3454, Vite on 5454; isolated synthetic PostgreSQL database. A temporary development auth adapter selected synthetic users and their real capabilities, using Rails test tokens; it was removed before commit. A temporary test-only transport stub raised `Net::ReadTimeout` after a short delay; no request went to Cornerstone. The lock fixture was subsequently published/finalized locally, and its outbox delivery marked delivered without sending it. All ten screenshots were refreshed after the dependency rebase. That repeat used a Vite transform and Rack wrapper outside the repository; only its final timeout scenario advanced the server clock to Dec 1 to make Nov 16–30 eligible for Lock now. Source files and production authentication were unchanged.

| Required journey | Result | Evidence |
| --- | --- | --- |
| Manager sees the upcoming published lock date | Passed at both widths; header and scope counts rendered together | `manager-inbox-390.png`, `manager-inbox-1280.png`; lock-copy tests cover confirm and past dates |
| Admin receives an honest Lock now timeout and does not duplicate a request | Passed at both widths; second press refused with “may still be processing”; audit outcome deferred, period initially unchanged | `lock-timeout-390.png`, `lock-timeout-1280.png`; request/client specs |
| Next period retains earlier-day clocks after previous period locks | Passed at both widths; Nov 16–30 checklist lists both synthetic people, matching Today | `next-period-checklist-390.png`, `next-period-checklist-1280.png`; model regression test |
| Locked hours distinguish delivery from human import; open carried shifts have no numeric zero-hour label | Passed at both widths; two open carried rows say “Still clocked in” and “Needs a clock-out”; delivered handoff explains import | `handoff-carried-390.png`, `handoff-carried-1280.png`; rendering and queue specs |
| Leave Just decided excludes expired decisions | Passed at both widths; current approval retained, Sep 8 expired decision excluded; history still available | `leave-just-decided-390.png`, `leave-just-decided-1280.png`; expiry/history tests |
| Recent approvals survives leaving and returning | Passed; manager approved a synthetic shift and its Undo row survived a full navigation to Timecards and back | Session-storage regression test additionally covers viewer separation and expiry |
| Approval/Undo count consistency | Passed: current-period approval and Undo moved the header and scope hint 4→3→4 together. Undo on a locked historical shift was correctly refused without changing counts. | Browser interaction plus inbox tests |
| Classic deferred denial; superseded editor reloads | Passed automated interaction tests; denial resolves after filter change; two reload responses resolve in reverse order after changing source shift | `ApprovalQueue.test.tsx`, `EditTimeEntryModal.test.tsx` |

Scope difference behind 44 versus 46: payroll's `approval_waiting_count` selects shifts with **positive waiting hours**, using period segments. The pending inbox also includes unfinished clocks (stored as zero hours), and may include zero-hour or differently dated whole-shift work. The checklist now names its finished-hours scope and explains that Approvals also includes open clocks. Payroll quantities retain their existing calculation.

No horizontal overflow was observed at 390 px. Existing touch styles provide 44 px coarse-pointer buttons/tabs; the new reload control is at least 44 px. These are resized Chromium checks, not physical-phone or native keyboard testing. WebKit/mobile Safari were not run on this headless mini. Real Cornerstone acceptance/import and production deployment were outside scope.

Final gate on `a6002d69ced5ae42945305f9288e637ae93617ba`, including `e02a24a` dependencies:

| Check | Result |
| --- | --- |
| Frontend `npm ci` | Passed, Node 22.23.5 |
| `npx tsc -b` | Passed |
| `npm run lint` | Passed |
| `npm test -- --reporter=dot --maxWorkers=2` | 153 files, 1,906 tests passed |
| Backend `bundle exec rubocop` | 652 files, zero offenses |
| `bundle exec rspec` | 2,377 examples, zero failures, one existing opt-in performance benchmark pending (`REVIEW_BATCH_BENCHMARK=1`) |
| `bundle exec brakeman --no-pager` | Brakeman 8.1.0: zero errors, zero security warnings |
| Advisory Impeccable scan | No findings in the changed UI paths scanned |

The lock-dialog test now freezes Date instead of automatically advancing it: slow suite execution could otherwise move the rounded minimum from 9:15 to 9:16. Tests that exercise elapsed time still advance it explicitly. For backend reproduction, use a fresh branch-named database and `RAILS_ENV=test bundle exec rails db:create db:schema:load`; `db:prepare` also seeds development records and invalidates empty-database fixture assumptions.

Cleanup verified: task-owned servers on 3454/5454 stopped, all three created preview tabs closed, synthetic session keys removed, and the three task scratch databases dropped. No owned runtime was handed off. The shared `agent-postgres` service remains available. The worktree and branch are intentionally retained for the lead.

Machine setup issue: lifecycle automation could not initialize because its local profile lacked `schema_version: 1`; the shared-context read-only check also found no local `agent-context.json`. Relevant canonical guidance was read directly from `~/Shared-Guidance`. Exact resource ownership and cleanup were tracked and verified manually; no shared service or other account was changed.
