# Leave overview (audit M1)

AIRE managers need to arrange coverage and recover from a wrong leave decision. The Leave chip now keeps Waiting, Approved and Past decisions together, with a weekly absence roster and a reversible decision flow. This stacks on approvals inbox PR #186; it does not add a Today section.

## Rules verified in the code

- `LeaveRequest` represents whole calendar days, including both endpoints. It has no part-day hours or paid-leave balance. Pending and approved requests for the same person cannot overlap.
- `LeaveRequestsController` originally allowed owners, admins and managers to list and decide company-wide requests. Employees could list their own requests and cancel a pending request. Department tabs in `Approvals.tsx` are display filters. This feature preserves those authorization rules, including the prohibition on self-review.
- Leave approval does not write time entries or feed payroll hours, reports, locks or exports. No leave mailer, notification callback or delivery job exists. Therefore payroll-lock/paid-leave refusal and corrected employee emails are not applicable to this implementation. Do not treat the `paid_time_off` label as paid payroll hours.
- New correction endpoints require the current integer `version`. The employee lock precedes the request lock, matching approvals and overlap validation. A concurrent change returns 409; invalid transitions, expired Undo, missing reasons and overlap conflicts return 422. Initial approval/decline accept versions from the inbox while retaining compatibility with existing clients.
- Undo returns approved or declined leave to pending, only for the deciding person and strictly before 15 minutes. Other approvers use Change decision. A correction needs a different status and a trimmed reason of 1–500 characters. Status, reviewer and audit event save in one transaction; failed auditing rolls back the decision.
- History retains initial decisions, corrections, reasons, actors and timestamps, including a decision returned to pending. Legacy approved/declined requests without audit events remain visible. Current/upcoming approved leave and the Monday–Sunday roster use Guam dates and the current person/department filter. Past decisions are newest first.

## Acceptance and review status

QA is agent-executed on synthetic local data, with Chromium at 390px and 1280px as Mindy and Chels. The required journeys are approve → retained row → reload → Undo → pending with two leave audit events; decline → history; expired Undo → reasoned correction; current and next-week roster; old links; employee denial. Screenshots, database assertions and gate logs are retained in `/Users/agent/work/qa-leave/` on the Mac mini.

One requested gate remains a policy question: managers currently have company-wide authorization, so there is no department permission boundary to deny. Department display filtering is verified, but this is not proof of department authorization. The lead must confirm whether manager leave permissions should be narrowed before calling that acceptance gate complete. This PR remains draft and must not be merged as fully accepted while that decision is unresolved.

No production data, real Clerk login, email transport, Cornerstone integration, physical phone, WebKit or Safari was tested. All external mail/payroll transports and non-loopback HTTP are blocked in the QA harness. Native mobile behavior and delivery are outside this evidence. The full suite's optional 250-shift benchmark remains pending. No GitHub review or merge was performed by the implementation worker.
