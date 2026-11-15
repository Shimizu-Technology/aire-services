An employee's requested time correction could be denied only by denying the whole shift, removing hours they actually worked. A kiosk unlock also left the manager signed in on the shared tablet. This fixes both paths in main's classic approvals and kiosk, with employee-facing corrections from the full QA ledger.

**Findings**

| Finding | Change |
|---|---|
| F1 | Save the first pre-edit values and exact breaks in JSONB, not audit prose. Classic approvals offers “Reject change, keep original time” with the original range, version guard and required reason. Restore and approve the original worked time; recalculate overtime for separate review. Audit and invalidate exports. Employee sees the restored range and manager's reason. “Deny whole shift” remains separate. |
| F2 | End Clerk sign-in after unlock, including the QA stub; remove every kiosk workspace/site link. Fresh manager PIN required to lock. Revoke the device session on the server and audit both unlock/lock with actor, time and device. Sign in again to unlock. |
| F3 | Never silently infer tomorrow from an earlier time. Earlier-stop form accepts a time after clock-in on its Guam date, before now, within 12 hours. Explain inline that overnight/longer corrections need a manager. Show the clock-in date and weekday for shifts continuing from an earlier day. |
| F4 | Split pending regular time and projected overtime through `Payroll::ApprovalHours`. Summary, rows and week sheet use those API quantities; waiting hours stay additive. Update employment-preview assertion to the same split. |
| F5 | Only show “Manager's note” with a human review actor. System approval notes are hidden from the employee sheet. |
| F6 | Kiosk confirmation says “less than a minute”. Deferred kiosk earlier-stop correction: needs a narrowly scoped employee-token correction endpoint, not manager API access. |
| F7 | Corrected historical hours show their date, not “today”; clear time validation errors when input changes. |
| F8 | Future-day refusal names the problem before other validation; retain the input maximum. |
| F9 | Undo cancellation restores the same row within one minute, under employee/request locks and overlap validation, preserving its queue timestamp; no duplicate request. Add weekdays and review actor. |
| F10 | Lockout message identifies the person's PIN and the Guam retry time. |
| F11 | Shift detail uses a query parameter so browser Back closes it and preserves My Hours/period. |
| F12 | Access denied uses h1, sentence case, “Open Clock”, no public-site link for staff; unknown admin routes have an in-app not-found page. |
| F13 | Raise remaining employee workspace/tab, My Pay and kiosk small text to 14px. |
| F14 | Identify pending fixes as “Requested fix”; describe overnight portions plainly; kiosk timer keeps the original session clock-in across work switches. Deferred hours on kiosk success: current success text retained. |
| F15 | Deferred automatic removal of sub-minute shifts: deleting logged work needs a deliberate recovery policy, including work-switch segments; no silent data loss added here. |
| F16 | Untouched as requested. |

**Kiosk security design**

The 12-hour device token has its own signing purpose and references a revocable `kiosk_device_sessions` row. The employee's PIN token uses a different signing purpose and lasts ten minutes; kiosk operations require both and still check active/access-enabled users. Neither token is accepted as Clerk bearer authentication at manager/admin endpoints. A manager proves their PIN afresh to lock; the endpoint shares the PIN verification IP throttle. Lock revokes the row, so replaying the old device token fails. Unlock then requires a new manager sign-in, and the browser immediately signs that manager out while retaining only the device token. There is no kiosk exit/workspace link; navigating directly to a workspace requires sign-in. Existing kiosk device tokens lacking a device row stop working and must be unlocked again. Existing signed-in kiosk pages also sign out on mount.

**Reject-change API for the future inbox (#186)**

`POST /api/v1/time_entries/:id/reject_change` with `{ "expected_version": <entry.version>, "note": "reason" }`, using ordinary authenticated approver access. It checks capability and the same approver/self-review rules as ordinary approval, locks the employee then entry, requires a pending saved employee change, and returns `{ time_entry: ... }`. Missing/stale version returns 409 `stale_entry`; invalid state or missing reason returns 422; forbidden reviewer returns 403. The entry payload adds `original_employee_change` (original range/hours only) and `rejected_employee_change` (manager, note, timestamp).

The first employee edit stores a server-only snapshot of source times, date, category, description, hours, break minutes, review fields and exact break intervals. Repeated pending employee edits keep it. Approval, denial or a manager correction ends that pending snapshot. Rejecting restores the original work and explicitly approves it because the manager just verified that work occurred; overtime approvals are cleared/recomputed to avoid approving stale allocations. It records `time_entry.change_rejected` and invalidates payroll exports, without altering immutable finalized payroll snapshots. Historical edits predating this migration have no trustworthy saved snapshot; no audit-text reconstruction or production data repair is attempted.

The additive migration uses `SET LOCAL lock_timeout = '5s'`; nullable time-entry fields and a new session table allow old code to keep serving during migration. Deploy API before the updated frontend.

**Validation**

- Node 24, Ruby 3.3.4, local `aire_fixemp_*` databases only.
- TypeScript and ESLint pass; full Vitest: **129 files, 1,533 tests pass**.
- Full RSpec: **2,204 examples, zero failures, one opt-in benchmark pending**.
- RuboCop: **634 files, no offenses**. Brakeman: **zero warnings**.
- Impeccable advisory scan of changed main UI files: `[]`.
- Request/component/service coverage: token isolation, PIN lock/revocation, stale/reason checks, server-only first-edit snapshots retained across repeated edits, exact break restoration, original-time employee explanation, projected overtime and same-row leave Undo.

**Browser QA** — synthetic tester fixture copied to `~/work/qa-fixemp`, API :3443 / Vite :5443; bundled Chromium touch, phone 390×844 and tablets 820×1180 / 1180×820. Mail and Cornerstone are blocked/faked. Screenshots `~/work/qa-fixemp/shots/FIX-*`, scripts and final logs retained there.

| Journey | Result / saved outcome |
|---|---|
| E5 approve + keep original, phone | Pass. Friday 10.5h approved with OT; Saturday restored from 7h to original 6.33h, approved, separate OT waiting; employee sees original range and Roke's reason. |
| E11 security, both touch tablets | Pass. Manager removed from browser; employee verifies with device token only; employee PIN cannot lock; manager PIN revokes access; replay and manager API refused; no workspace links; lock/unlock actor/device audits checked. |
| E4 earlier stop, phone | Pass. Rosa's 2 PM before 3:05 PM clock-in refused without saving; Grace's Saturday 5:30 PM saves 4h pending, with historical date and cleared validation. |
| E7 summary vs DB, phone | Pass. 100.33h countable → 100.3h display; 94h approved + 6.33h OT waiting → 6.3h. Rows, week sheet and Clock agree. |
| Notes / Back | Pass. System note hidden; rejected-change reason visible; browser Back closes sheet while keeping My Hours. |
| Minor spot checks | Same-row leave Undo and timestamp preserved; future-day inline refusal; Access denied h1 and Clock link; in-app admin not-found. Additional kiosk duration/PIN and break checks recorded in QA ledger. |

Safari/WebKit and real phone/tablet hardware were not run (Mac mini cannot start WebKit). Real Clerk sign-out delivery is not exercised by the fixture; the code calls Clerk's real `signOut`, and the stand-in removes its identity and follows the same redirect. No merge, GitHub review or comment was performed. Worktree and harness retained; owned runtime/database cleanup recorded in the QA ledger. Lifecycle helper/profile and shared-context configuration errors were recorded; exact resources were tracked manually.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
