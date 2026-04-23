# AIRE Services — Rollout Review and Implementation Plan (2026-04-23)

## Purpose
This document captures:
- the office-manager meeting notes and requested changes
- the current implementation state in AIRE
- where AIRE differs from the Cornerstone Tax reference app
- the recommended implementation order before staff rollout

This is the working planning document for the next build phase.

---

## Executive summary
AIRE is close enough to real operations that the next phase should be treated as a rollout-hardening phase, not a prototype phase.

The main issue is not visual polish. The main issue is that the operations workflow is still missing several behaviors that matter for real time approval and staff administration:
- unscheduled clock time is not yet routed into pending approval the way the business now wants
- user management is still too shallow for real admin operations
- kiosk PIN setup is still too admin-driven
- the approval queue is not yet the primary place to review and edit entries
- reviewer routing for CFI vs admin/maintenance does not exist yet
- public-site content and inquiry handling still reflect an older discovery-flight-led direction

The right next move is to document the rollout phase as three workstreams:
- ops core
- user onboarding/admin management
- public site refresh

The highest-priority workstream is `ops core`.

---

## Inputs used for this review

### Meeting notes
Requested changes from the office-manager conversation:
- better user editing, not just categories
- self-service account/PIN setup for staff where possible
- unscheduled time should require approval, similar to Cornerstone Tax
- approval queue should allow editing in place and ideally support approve-all
- reviewers need a way to filter by employee grouping, especially CFI vs admin/maintenance
- contact/inquiry subjects and notification email destination should be admin-configurable
- public site content needs to shift away from discovery-flight emphasis
- admin styling still needs polish, especially the sidebar and banner/content presentation

### Additional content inputs
Flyers/screenshots indicate new public-facing content priorities:
- Guam aerial tours
- video packages
- new banner/content treatment
- discovery-flight messaging is no longer the primary public sales direction

Important note:
- the flyers include handwritten price adjustments, so pricing should be treated as content to confirm before final public publication

---

## Current state review

## 1) User management
### Current state
- Admins can add users, remove users, resend invites, reset kiosk PINs, change role, and assign work categories.
- Work categories are edited in a dedicated modal.
- There is no full edit flow for staff profile data.

### Missing
- no edit flow for first name / last name / email
- no unified edit modal for profile + role + categories + kiosk/access behavior
- no reviewer/grouping field for approval routing
- no clear admin UX for managing who belongs to CFI vs admin/maintenance review buckets

### Recommendation
Replace the current fragmented user actions with a real user edit modal or panel that supports:
- first name
- last name
- email
- role
- approval/reviewer grouping
- time categories
- kiosk access / PIN status actions

Important design decision:
- do **not** reuse time categories as reviewer routing
- add a dedicated user-level field such as `approval_group`

Recommended initial values:
- `cfi`
- `ops_maintenance`

If needed later, this can expand without breaking reporting or payroll semantics.

---

## 2) PIN onboarding
### Current state
- PIN creation/reset is currently initiated by an admin.
- Admin reset returns the PIN directly and the current UI uses prompt/alert-driven handling.
- This is functional, but it is not a strong rollout UX.

### Desired behavior
- staff with email accounts should be able to sign in normally
- on first authenticated sign-in, if they do not yet have a kiosk PIN, they should be prompted to create one
- admin should still have a manual reset/create fallback for exceptions

### Recommendation
Build self-service PIN setup as the default flow and keep admin reset as a support tool.

This will reduce:
- admin overhead
- PIN distribution friction
- operational confusion during rollout

---

## 3) Unscheduled time and approval workflow
### Current AIRE behavior
- corrected clock-out times are sent to pending approval
- regular clock-in / clock-out behavior does **not** currently push unscheduled clock time into pending approval
- manual entries already participate in approval behavior

### Cornerstone Tax reference behavior
Cornerstone marks unscheduled clock sessions for approval:
- unscheduled clock-in is annotated
- on normal clock-out, that unscheduled session becomes pending approval

### Business requirement
The requested behavior is:
- if someone clocks in/out without a schedule, that time should go to pending approval
- this should apply regardless of whether the source is kiosk, manual, or normal staff-side clock flow
- admins may or may not be exempt, but that must be decided explicitly

### Recommendation
Port the Cornerstone unscheduled-approval rule into AIRE, but implement it deliberately for AIRE’s workflow instead of blindly cloning it.

Proposed rule:
- completed unscheduled time entries become `pending`
- scheduled time entries remain standard
- corrected or edited entries remain `pending`

Decision still needed:
- should admins be exempt from unscheduled pending behavior, or should all unscheduled time require review?

Current recommendation:
- start with everyone non-admin requiring approval
- allow explicit admin override behavior where needed

---

## 4) Approval queue and approval operations
### Current state
- AIRE has a pending approvals surface
- admins can approve, deny, and add notes
- editing a time entry still happens lower in the time-tracking page / calendar flow rather than directly in the approval queue

### Gap
This means the approval queue is not yet the true operational review surface.

For real usage, the office manager’s concern is valid:
- reviewers should not need to bounce between the pending queue and a separate edit area just to fix an entry

### Recommendation
Make the approval queue the main review surface by adding:
- edit entry action directly from approval cards
- approval note support
- deny action
- approve action
- optional bulk approve for visible entries

Stretch but valuable:
- bulk deny is probably unnecessary initially
- approve-all should be filter-aware, not global

Recommended rule:
- only allow bulk approve on the currently filtered dataset
- require explicit confirmation before bulk approval

---

## 5) Reviewer routing and filtering
### Business requirement
The office manager described a split review workflow:
- one reviewer handles CFI hours
- another reviewer handles admin/maintenance hours

### Current state
- AIRE does not yet have a separate reviewer grouping model
- work categories exist, but they describe labor type, not approval ownership

### Recommendation
Add a dedicated employee grouping field for approval filtering.

Suggested implementation:
- `approval_group` enum on users
- values:
  - `cfi`
  - `ops_maintenance`

Then add approval filters such as:
- All pending
- CFI
- Ops / Maintenance
- Assigned to me (optional later)

This is a cleaner long-term design than trying to infer reviewer ownership from time categories.

---

## 6) Contact form and inquiry configurability
### Current state
- backend support already exists for configurable contact notification email recipients
- frontend admin UI does not yet expose that capability
- inquiry topics/subjects on the public contact page are still hardcoded

### Requested direction
- the inquiry destination should send to whatever email(s) are configured on the admin side
- inquiry reasons/topics should be configurable rather than hardcoded

### Recommendation
Add a contact settings area to admin that supports:
- notification recipient email list
- inquiry subject/topic options

Public contact page should then fetch and render those options instead of embedding them directly in code.

This gives AIRE a usable non-technical content/operations control point without requiring a larger CMS build.

---

## 7) Public site direction shift
### Current state
The public site is still structured around:
- flight training
- programs
- discovery flight

This matched the earlier build phase, but it no longer appears to match current business priorities.

### Requested direction
The latest inputs suggest the public site needs to shift toward:
- aerial tours
- video packages
- updated banners/content blocks
- removal or heavy de-emphasis of discovery-flight-specific messaging

### Recommendation
Treat this as an information architecture and content refresh, not just a copy edit.

Likely changes:
- remove or replace `Discovery Flight` from primary navigation
- update homepage hero and major CTA destinations
- revise programs/services structure to reflect tours and media packages
- update contact page CTAs and inquiry taxonomy
- incorporate the new banner/flyer content into the visual system

Important content note:
- public pricing should not be changed from flyer photos alone without explicit confirmation because the flyers contain handwritten revisions

---

## 8) Admin styling and shell polish
### Current state
- admin side is cleaner than the extracted donor app
- layout is usable, but still rigid
- sidebar is fixed-width on desktop and only collapses on mobile
- some admin presentation details still feel transitional rather than rollout-ready

### Recommendation
This work matters, but it is secondary to the operations workflow changes.

The admin polish pass should include:
- collapsible desktop sidebar
- tighter header/sidebar spacing
- cleaner status badge alignment
- stronger emphasis on the action-heavy areas of time tracking
- better use of banners/cards where appropriate

This should happen after ops-core behavior is stabilized so the UI polish reflects the final workflow rather than the current transitional one.

---

## Comparison with Cornerstone Tax
Cornerstone Tax is a useful reference, but it should be treated as a pattern library, not a source of truth.

### What is worth porting
- unscheduled clock sessions flowing into pending approval
- approval queue prominence as an operational review surface
- the general mental model that manual or irregular time should be reviewed before counting

### What should not be copied blindly
- exact approval queue limitations
- any assumptions tied to tax-office operations rather than AIRE operations
- reviewer ownership inferred from categories

Cornerstone helps answer:
- how should pending time feel operationally?

It does **not** fully answer:
- how should AIRE split CFI vs admin/maintenance review?
- how should staff self-serve account and PIN setup?
- how should AIRE’s public site reflect tours/media/training priorities?

---

## Recommended implementation workstreams

## Workstream 1: Ops core
This should be first.

Includes:
- unscheduled clock time -> pending approval behavior
- explicit admin exception/override rule
- approval-group model for users
- approval queue filters by group
- edit-from-approval flow
- approve-all for filtered entries

Why first:
- this is the highest-risk area for payroll/process confusion
- it affects real operations immediately
- it is the most important rollout blocker

---

## Workstream 2: User onboarding and admin management
This should be second.

Includes:
- real user edit modal/panel
- profile field editing
- approval-group assignment in user management
- self-service PIN setup on first sign-in
- admin fallback PIN reset/create flow

Why second:
- this reduces admin friction during rollout
- it depends partly on finalizing approval-group design from workstream 1

---

## Workstream 3: Public site refresh
This should be third unless leadership wants site changes accelerated for marketing reasons.

Includes:
- contact settings UI
- configurable inquiry topics
- public contact page update
- remove/de-emphasize discovery flight
- add tours/video-package content
- update banners and general site messaging

Why third:
- important, but less operationally risky than time approval and staff onboarding
- better to refresh the public IA once the office-side product behavior is settled

---

## Recommended implementation order inside the workstreams

## Phase 1
- define approval-group model
- implement unscheduled clock-entry pending logic
- expose pending filters by approval group

## Phase 2
- add edit-from-approval capability
- add approve-all for current filtered view
- finalize approval workflow UX

## Phase 3
- add full user edit modal/panel
- add approval-group management on users
- add self-service PIN creation on first login

## Phase 4
- add admin contact settings UI
- add configurable inquiry topics
- connect public contact form to those settings

## Phase 5
- rebuild public-site IA/copy around current AIRE offerings
- replace discovery-led messaging with current tours/media/training positioning
- complete admin-shell polish pass

---

## Product decisions still needed before implementation
These are the main decisions to confirm as we implement:

1. Should admins be exempt from unscheduled pending approval?
2. What exact label should be used for the second approval group?
   - `ops_maintenance`
   - `admin_maintenance`
   - something else
3. Should approvers only filter by group, or should entries be explicitly assigned to a reviewer?
4. Should self-service PIN setup be mandatory before the user can continue into the app?
5. Which public nav/service structure should replace `Discovery Flight`?
6. Which flyer prices are final and approved for publication?

These should be resolved early, but none of them blocks documenting the work or starting the first backend workflow changes.

---

## Recommended immediate next step
Start with `Workstream 1: Ops core`.

The first coding slice should be:
- add the approval-group field to users
- implement unscheduled clock entries becoming pending
- wire pending-approval filtering around that grouping

That will establish the correct operational backbone before UI polish or public-site refresh.
