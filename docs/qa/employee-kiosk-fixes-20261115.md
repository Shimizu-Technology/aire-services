An employee's requested time correction could be denied only by denying the whole shift, removing hours they actually worked. A kiosk unlock also left the manager signed in on the shared tablet. This fixes both paths in main's classic approvals and kiosk, with employee-facing corrections from the full QA ledger.

**Findings**

| Finding | Change |
|---|---|
| F1 | Save the first pre-edit values and exact breaks in JSONB, not audit prose. Classic approvals offers “Reject change, keep original time” with the original range, version guard and required reason. Restore the original worked time and its saved approval state; a pending original remains pending. Recalculate overtime for separate review. Only clock shifts have an original; hand-added time keeps normal approve/deny. Audit and invalidate exports. Employee sees the restored range and manager's reason. “Deny whole shift” remains separate. |
| F2 | End Clerk sign-in after unlock, including the QA stub; remove every kiosk workspace/site link. Fresh manager PIN required to lock. Browser-wide kiosk state routes other pages back to the kiosk while active. Revoke the device session on the server and audit unlock/lock/failures with actor, time and device. Administrators can lock every kiosk from Settings → Kiosk. Sign in again to unlock a locked kiosk. |
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

`POST /api/v1/time_entries/:id/reject_change` with `{ "expected_version": <entry.version>, "note": "reason" }`, using ordinary authenticated approver access. It checks capability and the same approver/self-review rules as ordinary approval, locks the employee then entry, requires a pending saved employee change, and returns `{ time_entry: ... }`. Missing/stale version returns 409 `stale_entry`; invalid state or missing reason returns 422; forbidden reviewer returns 403. The entry payload adds `original_employee_change` (clock shifts only: a server-formatted, dated Guam `formatted_range`, range timestamps and hours) and `rejected_employee_change` (manager, note, timestamp).

The first employee edit stores a server-only snapshot of source times, date, category, description, hours, break minutes, review fields and exact break intervals. Repeated pending employee edits keep it. Approval, denial or a manager correction to payroll inputs ends that pending snapshot; description-only manager edits preserve it. Rejecting restores the original work and its own approval state (denied, approved or pending); overtime approvals are cleared/recomputed to avoid approving stale allocations. If the original is a missing/24h+ clock-out or has invalid hours, the request returns 422 and leaves the employee fix intact. Employee edits cannot reopen denied shifts; the employee sheet refers them to a manager. Reject records `time_entry.change_rejected`, records ordinary review and settlement-case approval events if approval state changes, and invalidates payroll exports, without altering immutable finalized payroll snapshots. Historical edits predating this migration have no trustworthy saved snapshot; no audit-text reconstruction or production data repair is attempted.

The additive migration uses `SET LOCAL lock_timeout = '5s'`; nullable time-entry fields and a new session table allow old code to keep serving during migration. Deploy API before the updated frontend.

**Review corrections — 2026-11-15**

| Finding | Final behavior |
| --- | --- |
| B1 | Reject restores denied/approved/pending exactly, including the prior reviewer and note. Pending originals require a separate approval. Employees cannot edit denied shifts back into the queue; only a manager can explicitly resubmit them for review. |
| M1 | Only clock shifts capture an original and offer reject. The server formats the original Guam date and range, including both dates for overnight punches. Hand-added shifts keep normal approve/deny. |
| M2 | Invalid or 24h+ original punches return the requested plain 422. The transaction preserves the employee's corrected times, hours, breaks and snapshot. |
| M3 | Browser-wide device state prevents a one-tap sign-in path while active, including other tabs/pages. Supervisor lock requires the manager PIN; a locked kiosk may offer sign-in to unlock. |
| Minor 1 | Lock PIN failures use the verification audit/failure-counter path and the existing shared IP throttle. Unknown guesses are audited and IP-throttled; recognized invalid accounts accrue the existing account PIN lockout. |
| Minor 2 | Settings → Kiosk has an administrator-only, audited Lock all kiosks action. It revokes every active device session. |
| Minor 3 | Restored approval-state changes write review and settlement-case events. The reject audit sentence names the employee, dated original work and rejected change. |
| Minor 4 | Reject and single approve explicitly acquire employee before entry. Deadlocks and lock timeouts return 409 payroll_busy. |
| Minor 5 | Snapshot punch, approval and break timestamps use iso8601(6), preserving microseconds through JSONB. |
| Minor 6 | A manager's description-only edit preserves the pending snapshot; payroll-input changes or review decisions clear it. |
| Minor 7 | A 401 on Lock clears the device state and shows the locked screen. Failed sign-out revokes the new session; network failure retries sign-out, retains the device reference and blocks staff use until recovered. |
| Minor 8 | Sheet Close consumes its own history entry. Back closes the sheet, then the next Back leaves My Hours; direct links close with replace. Period changes are one navigation. |
| Minor 9 | Cancel returns server_time and undo_until. Undo uses the remaining server window, conservatively accounting for transit time, and expires even when the toast is focused, hovered or hidden. |

**Tablet setup for Leon:** sign out of Google in the tablet browser, or use a guest profile. Do not save manager passwords there. Clerk sign-out ends the app session; the tablet browser must also be configured as a shared device.

**Deploy:** keep migration `20261115040000_add_employee_change_and_kiosk_sessions.rb` with reversible up/down and `SET LOCAL lock_timeout = '5s'`. Deploy the API before the frontend. Existing kiosks lock once at deploy and need a manager to unlock them again. No production data repair, email or Cornerstone call is part of this change.

**Review-correction QA:** synthetic local `aire_fix206_qa` and empty-schema `aire_fix206_spec`; Node 22.23.5, Ruby 3.3.12 and an isolated bundle. T3 shared browser at 390×844, 820×1180 and 1180×820, with synthetic touch-pointer events. Denied restoration, no reject for hand-added time, missing-original refusal, dated original ranges, manager sign-out/PIN lock/failure audit, Lock all kiosks and My Hours Back/Close all passed with DB checks. Revoked-token 401 cleanup also passed. Screenshots and the detailed ledger are under `output/aire-full-qa-20261115/fix206/` outside the repository. Native touch media, real hardware, Safari, Google OAuth and real Clerk delivery were not exercised.

**Final local gate:** TypeScript build and ESLint pass; full Vitest **130 files / 1,542 tests passed**; full RSpec **2,224 examples / zero failures / one opt-in benchmark pending**; RuboCop **634 files / no offenses**; Brakeman **zero warnings and zero errors**; Impeccable advisory **[]**. Focused backend correction/security/audit checks: **42 examples passed**. No merge or GitHub reviews/comments were performed. Task-owned API/Vite processes and the browser tab were cleaned; shared infrastructure and other sessions' resources were preserved.
