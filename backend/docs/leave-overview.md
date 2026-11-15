# Leave overview (audit M1)

AIRE managers need to arrange coverage and recover from a wrong leave decision. The Leave chip now keeps Waiting, Approved and Past decisions together, with a weekly absence roster and a reversible decision flow. This stacks on approvals inbox PR #186; it does not add a Today section.

## Rules verified in the code

- `LeaveRequest` represents whole calendar days, including both endpoints. It has no part-day hours or paid-leave balance. Pending and approved requests for the same person cannot overlap.
- `LeaveRequestsController` originally allowed owners, admins and managers to list and decide company-wide requests. Employees could list their own requests and cancel a pending request. Department tabs in `Approvals.tsx` are display filters. This feature preserves those authorization rules, including the prohibition on self-review.
- Leave approval does not write time entries or feed payroll hours, reports, locks or exports. No leave mailer, notification callback or delivery job exists. Therefore payroll-lock/paid-leave refusal and corrected employee emails are not applicable to this implementation. Do not treat the `paid_time_off` label as paid payroll hours.
- New correction endpoints require the current integer `version`. The employee lock precedes the request lock, matching approvals and overlap validation. A concurrent change returns 409; invalid transitions, expired Undo, missing reasons and overlap conflicts return 422. Initial approval/decline accept versions from the inbox while retaining compatibility with existing clients.
- Undo returns approved or declined leave to pending only when the latest decision event is an initial approval/decline, for the same deciding person and strictly before 15 minutes. A correction never offers or permits Undo; use another Change decision. Corrections keep reasons in manager/admin audit history and preserve the employee-facing note. Undo clears the note set by the initial decision it undoes. Inactive or terminated employees cannot have leave moved to approved or waiting. Other approvers use Change decision. A correction needs a different status and a trimmed reason of 1–500 characters. Status, reviewer and audit event save in one transaction; failed auditing rolls back the decision.
- History retains initial decisions, corrections, reasons, actors and timestamps, including a decision returned to pending. Legacy approved/declined requests without audit events remain visible. Current/upcoming approved leave and the Monday–Sunday roster use Guam dates and the current person/department filter. Past decisions are newest first and load one page by default with Show more. Approved leave is date-filtered on the server and shown soonest first.

## Acceptance and review status

QA is agent-executed on synthetic local data, with Chromium at 390px and 1280px as Mindy and Chels. The required journeys are approve → retained row → reload → Undo → pending with two leave audit events; decline → history; expired Undo → reasoned correction; current and next-week roster; old links; employee denial. Screenshots, database assertions and gate logs are retained in `/Users/agent/work/qa-leave/` on the Mac mini.

The lead confirmed company-wide manager leave authorization. Departments are display filters; the department-denial gate is N/A. This PR remains draft on `feat/approvals-inbox` for lead integration and must not be merged by the implementation worker.

No production data, real Clerk login, email transport, Cornerstone integration, physical phone, WebKit or Safari was tested. All external mail/payroll transports and non-loopback HTTP are blocked in the QA harness. Native mobile behavior and delivery are outside this evidence. The full suite's optional 250-shift benchmark remains pending. No GitHub review or merge was performed by the implementation worker.
