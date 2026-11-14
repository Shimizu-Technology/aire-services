# PR 10: Settings sub-pages handoff

Implementation owner: Codex on the Mac mini. Receiving owner: the lead Claude thread on the MacBook. Review, browser acceptance, merge and deployment remain with the lead. This is a draft PR; no deployment or real email was attempted.

## Verified context and acceptance

Started from clean `origin/main` at `4da0922` (PR #184), on `feat/settings-subpages` in `/Users/agent/work/aire-services`. This checkout is dedicated to this task. Source context: the supplied PR 10 brief, existing Settings implementation, settings catalog, settings controller/model, and `docs/ATTENTION_CONNECTION_PERIODS_API.md`.

AIRE Ops lets owners/admins configure staff time tracking, approval policy, schedules and pay-stub access, and connects locked time to Cornerstone Payroll. The existing `manage_settings` route/API gates remain. New settings pages stage changes until their single save bar is used, save changed keys, and guard navigation. Schedule requirement cannot be enabled without schedules. Reminder recipients normalize with `Setting.normalize_emails`, validate on the server, can be cleared, and receive a before/after audit row. The schedule requirement gets a boolean before/after audit row.

## Implementation

- Settings overview reads actual settings, category count and payroll connection state; seven new sub-page routes plus existing Roles & access.
- Shared `SettingsPage` implements time-clock, approval, pay-stub, kiosk and schedule forms; per-page key definitions live in `settingsPages.ts`.
- Departments/work stage department/category changes behind one save bar. Existing API endpoints require multiple writes, so the page reports possible partial saves. Newly created IDs survive a later failure to avoid duplicate creation on retry. This flow especially needs recovery QA.
- Time-clock retains address autocomplete, place selection, current-location lookup, coordinate editing and map preview.
- Pay-stub recipient updates use the existing separate pay-stub API, within the page save action; a later settings failure can leave recipients saved.
- Payroll connection uses the existing read-only connection endpoint and Reconnect link.
- Old hashes redirect, including contact to Website. Website contact cards remain in the legacy `Settings.tsx` implementation; its old settings-only JSX remains unreachable through app routes. That deliberate retention avoids an unrelated rewrite of the contact editor in this wave.
- Website contact phone input accepts formatted numbers and normalizes its saved link value; Button label replaces CTA, with an Advanced disclosure for search-engine information.
- New HTTP calls live in `lib/api/settings.ts`; `api.ts` only exports the existing `fetchApi` helper.
- Fixture regenerated through `SettingsCatalog.as_json` in standalone Ruby, using the existing fixture's role metadata because Rails dependencies are unavailable. Lead should run the canonical fixture-generation spec to verify equality.

## Automated gates

- `npm ci`: passed (Node 26.13.0).
- `npx tsc -b --noEmit`: passed.
- `npm run lint`: passed.
- `NODE_OPTIONS=--no-experimental-webstorage npm test`: 936 passed, 90 files passed. Includes 27 added tests: changed-key saves, navigation Keep editing/Discard, schedule dependency UI, malformed recipients, seven anchor redirects. Node 26's experimental native localStorage otherwise breaks existing suites; first unmodified run was 816 passed / 93 failed. Happy DOM emits disabled iframe-load diagnostics; tests pass.
- `DEPLOYMENT_ENV=production VITE_DEPLOYMENT_ENV=production npm run build`: passed. These flags satisfy the local build guard; no publish command ran. Plain build without explicit flags fails by design.
- Impeccable 4.6.0 advisory: `[]` findings on final changed UI paths.
- Ruby syntax checks: controller and catalog passed.
- Backend RSpec/RuboCop/Brakeman: not_run. Mini has Ruby 3.3.12 vs `.ruby-version` 3.3.4, no Postgres command/server and no isolated bundle installed. `bundle check` reports missing dependencies. No packages/databases installed.
- ASUS full-suite attempt: blocked immediately by `ci@127.0.0.1: Permission denied (publickey)`. No retry loop.
- Independent review: pending, owned by lead.

## Required browser acceptance: 0 passed, 0 failed, 12 not_run

Local Rails/Postgres app cannot run on this host. Lead executes with test fixtures and suppressed/fake email only:

1. Admin, 1280px: save time-clock fields and verify persisted settings and Activity.
2. Admin, 1280px: save Approvals, cancel/accept auto-approve confirmation and verify audits.
3. Admin, 1280px: department/work create, edit, deactivate, delete and failure recovery; check assignments cannot be removed while in use.
4. Admin, 1280px: pay-stub switches and recipient changes, including a failed second request.
5. Admin, 1280px: kiosk request setting and persisted result.
6. Admin, 1280px: connected/paused payroll connection, link details and Reconnect destination.
7. Admin, 1280px: schedules confirmation and saved state.
8. Reminder chips: add/remove/clear, malformed rejection, duplicate normalization; inspect `Setting.payroll_cutoff_reminder_emails` and before/after Activity.
9. Owner, 390px and real phone keyboard: schedule dependency, unsafe stored-state banner and Turn off Require one-tap fix.
10. Owner, 390px and real phone keyboard: unsaved bar reachability, discard, navigation Keep editing/Discard, retained draft after error.
11. `/admin/settings#use-schedules` opens Schedules.
12. `/admin/settings#time-approvals` opens Approvals.

Also verify formatted phone entry, Advanced disclosure and actual saved public contact output. No production data, real notification email or deploy is authorized for this implementation worker.

## Delivery and resources

No migration expected. Lead deploys frontend with Netlify CLI after acceptance and merge; backend deployment is needed for the new API behavior. Do not ship frontend independently of the backend allowlist/catalog changes.

No local development server, browser tab, simulator, emulator, container or database was started. No shared services were modified. Checkout and branch remain for lead review; no resource handoff is needed.
