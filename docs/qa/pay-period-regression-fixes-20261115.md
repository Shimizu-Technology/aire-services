# Pay period regression fixes — 2026-11-15

AIRE Ops is used by AIRE's Guam staff; Chels manages payroll. This affected-flow follow-up uses the supplied combined-regression ledger (`~/work/qa-regr-adm/LEDGER.md`, integration commit `9ac1e91`) and refreshes #194 from `3bacf1e`. It covers N1, N8 and N9 only. Other findings belong to separate work.

Pending time now includes both regular and projected overtime quantities in the live Pay period preview. Pending-overtime exclusions still count only their overtime quantity. A request spec creates six pending eight-hour shifts in one week, confirms projected overtime exists, and checks all 48 hours remain waiting.

Payroll records uses lock wording. History includes an Open Pay period link when the batch has a published calendar period; the API supplies its actual start date. Mid-period query links explain the containing period. Mid-period route links redirect there with the same explanation.

## Validation

- TypeScript build and ESLint: passed.
- Full Vitest: 133 files, 1,653 tests passed. One earlier run crossed a minute boundary in the existing PayrollLockControl test (9:15 vs 9:16); full rerun passed.
- RuboCop: 635 files, no offenses.
- Full RSpec: 2,231 examples, zero failures, one existing pending example.
- Brakeman: no warnings.
- Impeccable advisory scan of changed UI: no findings.

Agent-executed Chromium at 1280×800 and 390×844, using the copied synthetic regression fixture and guarded Clerk/mail/Cornerstone stand-ins. Ethan is 16.3h waiting in the Pay period view and person page, matching Reports' 16.33h. Total waiting is 251.7h, matching checklist 241.0h + 10.7h; carried-in 6.0h remains separate. Records shows lock wording and links for both October periods. Nov 5 query link explains Nov 1–15; Oct 20 route link redirects to Oct 16–31 with an explanation. No horizontal overflow on these pages. Screenshots and browser text: `~/work/qa-fix194b/shots/fix-*` and `db/fix194-*.json`.

API port 3446, Vite 5447: requested 5446 was borrowed by #207 and left untouched. Initial RSpec databases had app seeds from db:prepare; final runs use empty schema-loaded databases. WebKit, physical phones, real Clerk, real email and real Cornerstone were not run.

Task-owned servers, browser tab and databases were cleaned; shared Postgres remains running. The lifecycle helper rejected the installed machine profile (`schema_version must be 1`); exact PIDs and baseline were tracked manually. The shared-guidance check also reports a missing `~/.config/shimizu-technology/agent-context.json`; canonical synced skills were read directly.

No merge or GitHub review/comment was performed, as requested. This report records local acceptance, not independent PR review or deployment verification.
