# Leave decline names — 2026-11-15

Follow-up to N10 in the combined AIRE regression ledger (`~/work/qa-regr-adm/LEDGER.md`, integration 9ac1e91). #202 starts at 0ebc724, based on feat/approvals-inbox. AIRE admins and managers need to distinguish waiting requests when navigating a list of buttons.

Decline buttons now name the person and date range using the same person fallback and date formatter as the leave row. The existing decline-reason test opens the button by its full accessible name.

## Validation

- TypeScript and ESLint passed.
- Full Vitest: 145 files, 1,695 tests passed.
- RuboCop: 642 files, no offenses.
- Full RSpec: 2,280 examples, zero failures, one pending benchmark (opt-in).
- Brakeman: no warnings.
- Impeccable advisory scan: no findings.

Agent-executed Chromium at 1280×800 and 390×844 on the copied synthetic regression fixture. All five waiting Decline buttons name their person and dates. Ana Rivera's button opens Ana's decline dialog. No horizontal overflow. Evidence: `~/work/qa-fix194b/shots/fix-leave-*.png`, `fix-decline-dialog-390.png`, and `db/fix202-browser.json`. No decline was submitted in the browser; the automated test covers the saved reason. No real email or Cornerstone calls. WebKit and physical phones were not run.

The fixture was migrated with #202 before the passing browser checks; it needed the leave-version migration after running #194. Final RSpec used an empty schema-loaded local database after the first seeded-database run failed on seed contamination. Ports were 3446/5447 because #207 owned 5446. Task-owned servers, databases and preview tab cleaned; shared Postgres and #207 resources preserved. Lifecycle helper rejected the installed machine profile, so exact resources were tracked manually.

The named fix-pr202 worktree uses local branch fix/fullqa-pr202 because feat/leave-overview is checked out elsewhere. It was fast-forwarded to the requested PR head, and the fix was pushed explicitly to feat/leave-overview. The other worktree was untouched. No merge or GitHub review/comment was performed.
