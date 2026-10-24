# Staff payroll cutoff reminders

Requires the lock rollout (#143) and migration `20261025010000`. Deploy the migration before the API/frontend. This adds acknowledgement records only; it changes no time entry, approval, payroll calculation, freeze or outbound delivery behavior.

`Payroll::CutoffPresenter` selects the earliest unfinalized enforced scheduled period when due or within 24 hours. Otherwise it keeps the most recently finalized scheduled cutoff visible until the next warning window. Manual periods and preactivation periods never enter discovery. It uses the stored publication's `cutoff_at`, never a reconstructed date rule. The initial scheduled cutoff is November 7, 2026, 17:00 Pacific/Guam.

- Staff: authenticated `GET /api/v1/payroll_cutoff`, `POST /api/v1/payroll_cutoff/acknowledge`.
- Kiosk: `POST /api/v1/aire/kiosk/cutoff` requires the authorized kiosk access token. Acknowledgement also requires the employee token issued after PIN verification. No personal identity is included in the cutoff response. Verify and completed clock responses include the same safe presenter plus that employee's acknowledgement boolean.
- Cutoff fields: period ID/start/end, publication ID, version, server now, absolute ISO cutoff, seconds remaining, Pacific/Guam, stage. No integration secret or payroll totals. Responses use `Cache-Control: no-store`.
- Stages are `none` (>24h/no scheduled calendar), `24h` (inclusive), `4h` (inclusive), `finalizing` (cutoff reached without a finalized batch), `passed` (finalized). Failed/delayed finalization remains `finalizing`.
- Acknowledgements have a database unique key over authenticated user, period, publication, version and stage. Requests for an obsolete publication/stage receive 409. No clock or approval command runs on acknowledgement.

The shared kiosk banner cannot be dismissed globally. A kiosk dialog opens only from a successful PIN verification or completed clock action, never from background polling while an action is underway. Logout/timeout removes the employee's displayed notice. Staff see dialogs at 24h and 4h; dismissing leaves the banner and saves acknowledgement across devices. A failed acknowledgement closes locally and explains that it may recur elsewhere.

Visible polling runs every minute, plus focus, visibility return and successful clock actions. The browser uses server time for Guam today/tomorrow copy; it never announces a ticking countdown. A safe, nonpersonal cutoff snapshot is retained in session storage for offline reloads. Cached/failed-refresh data has a stale indicator and only the last known absolute time. It cannot open a new personal dialog until revalidated. No email/push is sent.

Limits: in-app reminders reach staff only when they open the app/kiosk. Acknowledgement is not evidence of approved hours or payroll readiness. Admins still need to brief staff who do not visit during the window. Physical-device, VoiceOver/TalkBack and production-clone acceptance remain separate from headless viewport/accessibility-tree checks.
