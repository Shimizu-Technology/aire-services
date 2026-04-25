# AIRE Services — Rollout Review and Implementation Plan (2026-04-23)

## Purpose
This document captures:
- the office-manager meeting notes and requested changes
- the current implementation state in AIRE
- where AIRE differs from the Cornerstone Tax reference app
- the recommended implementation order before staff rollout

This is the working planning document for the next build phase.

Current status note:
- Validated against the current `main` branch on 2026-04-24.
- `Phases 1` through `4` are already implemented on `main`.
- The active remaining work is the public-site direction shift plus final admin-shell polish.

---

## Executive summary
AIRE is close enough to real operations that the next phase should be treated as a rollout-hardening phase, not a prototype phase.

The operational base is materially further along than the original review snapshot:
- unscheduled non-admin clock time now routes into pending approval
- reviewer routing exists via `approval_group`
- the approval queue supports filtering, edit-in-place entry access, notes, and bulk approve for the visible set
- user management now has create/edit flows, approval-group assignment, activation controls, and PIN tools
- self-service kiosk PIN setup exists for authenticated staff on first sign-in
- admin-configurable contact recipients and inquiry topics are already wired through to the public form

The remaining rollout work is now concentrated in two areas:
- public-site information architecture and copy still reflect the older discovery-flight-led direction
- admin-shell polish still needs a final pass after workflow decisions are locked

The right next move is to document the rollout phase as three workstreams:
- ops core
- user onboarding/admin management
- public site refresh

The highest-priority workstream is `ops core`.

---

## Inputs used for this review

## Confirmed follow-up decisions (2026-04-24)
- Keep the current admin exemption for unscheduled pending approval.
- Group filters are enough for now; "assigned to me" stays future scope.
- `approval_group` should evolve from the current hardcoded enum into an admin-configurable list so the office can rename/add groups later.
- We should extend admin user editing for activated Clerk-managed users by using Clerk's backend API with `CLERK_SECRET_KEY`, rather than treating that as a permanent product limitation.
- The public site should emphasize:
  - pilot training / becoming a pilot
  - Guam aerial tours
  - video packages
- Discovery flights are no longer the lead public offer and should be de-emphasized or removed from the primary IA.
- Confirmed public aerial-tour pricing:
  - Bay Tour: `$275`
  - Island Tour: `$395`
  - Sunset Tour: `$345`
- Confirmed standard video-package pricing:
  - Bay: `$79`
  - Sunset: `$89`
  - Island: `$99`
- Confirmed all-inclusive video-package pricing:
  - Bay: `$129`
  - Sunset: `$139`
  - Island: `$149`
- Local residents and military members should not show a public numeric discount; the site should say to contact AIRE for discounted-rate details.
- Tour/video disclaimers from the flyers should be carried onto the site.

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
- Admins can add users, remove users, resend invites, reset kiosk PINs, activate/deactivate users, change role, assign approval groups, and assign work categories.
- User management now includes unified create/edit modals for role, approval routing, category assignment, and kiosk status context.
- Kiosk-only users can be edited for local profile fields, and pending invite email addresses can be corrected before activation.

### Missing
- activated Clerk users still do not support admin-side name/email edits from this form
- there is still no separate kiosk-enabled toggle beyond PIN rotation and account active state
- if the office manager expects admins to directly correct active Clerk profile data, that remains a future integration decision

### Recommendation
Keep the current unified user edit flow and only extend it if the business truly needs admin-managed edits for activated Clerk identities.

Important design decision already implemented:
- do **not** reuse time categories as reviewer routing
- use the dedicated user-level `approval_group` field

Recommended initial values:
- `cfi`
- `ops_maintenance`

If needed later, this can expand without breaking reporting or payroll semantics.

---

## 2) PIN onboarding
### Current state
- Authenticated staff who do not yet have a kiosk PIN are now forced through a self-service PIN setup flow on first sign-in.
- Admin reset/create remains available as a support tool.
- The old prompt/alert-only handling is no longer the primary path.

### Desired behavior
- staff with email accounts should be able to sign in normally
- on first authenticated sign-in, if they do not yet have a kiosk PIN, they should be prompted to create one
- admin should still have a manual reset/create fallback for exceptions

### Recommendation
Keep self-service PIN setup as the default flow and admin reset as the exception path.

This will reduce:
- admin overhead
- PIN distribution friction
- operational confusion during rollout

---

## 3) Unscheduled time and approval workflow
### Current AIRE behavior
- corrected clock-out times are sent to pending approval
- regular unscheduled non-admin clock sessions now move into pending approval on clock-out
- manual entries already participate in approval behavior
- admins are currently exempt from unscheduled pending behavior

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
The core rule is already implemented in AIRE:
- completed unscheduled time entries become `pending`
- scheduled time entries remain standard
- corrected or edited entries remain `pending`

Current encoded rule:
- non-admin unscheduled entries require approval
- admins are exempt

Only revisit this if operations explicitly wants admin unscheduled time reviewed too.

---

## 4) Approval queue and approval operations
### Current state
- AIRE has a pending approvals surface
- admins can approve, deny, add notes, open entry editing directly from approval cards, and bulk-approve the visible filtered set
- approval filters now support All / CFI / Ops-Maintenance / Unassigned

### Gap
The main queue concern is largely resolved.

Remaining stretch items:
- "assigned to me" reviewer filtering is still optional future work
- bulk deny is still unnecessary unless operations proves it needs it

### Recommendation
Keep the approval queue as the main review surface and avoid reopening a second editing workflow unless there is a specific UX gap.

Current implemented rule:
- bulk approve only applies to the currently visible filtered dataset
- confirmation is required before bulk approval

---

## 5) Reviewer routing and filtering
### Business requirement
The office manager described a split review workflow:
- one reviewer handles CFI hours
- another reviewer handles admin/maintenance hours

### Current state
- AIRE now has a dedicated reviewer grouping model on users
- work categories remain separate from approval ownership, which is the correct design

### Recommendation
Keep using the dedicated employee grouping field for approval filtering, but plan one more iteration so the list is admin-configurable instead of permanently code-defined.

Implemented model:
- `approval_group` enum on users
- values:
  - `cfi`
  - `ops_maintenance`

Implemented filters:
- All pending
- CFI
- Ops / Maintenance
- Unassigned
- Assigned to me (optional later)

This is a cleaner long-term design than trying to infer reviewer ownership from time categories.

Confirmed follow-up change:
- replace the hardcoded `User::APPROVAL_GROUPS` list with admin-managed approval-group settings
- preserve the current default values as the initial seed:
  - `cfi`
  - `ops_maintenance`
- keep filtering group-based rather than reviewer-assignment-based for this rollout

---

## 6) Contact form and inquiry configurability
### Current state
- backend support exists for configurable contact notification email recipients
- frontend admin UI now exposes those settings
- public contact inquiry topics now load from backend-managed settings, with local defaults as fallback

### Requested direction
- the inquiry destination should send to whatever email(s) are configured on the admin side
- inquiry reasons/topics should be configurable rather than hardcoded

### Recommendation
This operational/settings slice is complete enough for rollout.

Admin now supports:
- notification recipient email list
- inquiry subject/topic options

Public contact now fetches and renders those options instead of hardcoding them as the primary source.

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
Status: complete on `main`.

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
Status: mostly complete on `main`, but reopened for two final admin capabilities.

Includes:
- real user edit modal/panel
- approval-group assignment in user management
- self-service PIN setup on first sign-in
- admin fallback PIN reset/create flow
- limited profile editing based on identity source
- admin-configurable approval groups
- admin editing of activated Clerk-managed user profile fields through Clerk backend API

Why second:
- this reduces admin friction during rollout
- it depends partly on finalizing approval-group design from workstream 1

---

## Workstream 3: Public site refresh
Status: partially complete; contact/settings plumbing is done, IA/copy shift remains.

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
Status: complete.
- defined approval-group model
- implemented unscheduled clock-entry pending logic
- exposed pending filters by approval group

## Phase 2
Status: complete.
- added edit-from-approval capability
- added approve-all for current filtered view
- finalized the approval queue as the main review surface

## Phase 3
Status: largely complete, with one follow-up completion pass still desired.
- added the main user edit modal/panel
- added approval-group management on users
- added self-service PIN creation on first login
- kept admin fallback PIN reset/create flow
- remaining limitation: active Clerk-managed profile data is still not editable from this admin form
- remaining enhancement: approval-group options are still code-defined rather than admin-configurable

## Phase 4
Status: complete.
- added admin contact settings UI
- added configurable inquiry topics
- connected the public contact form to those settings

## Phase 5
Status: active remaining phase.
- rebuild public-site IA/copy around current AIRE offerings
- replace discovery-led messaging with current tours/media/training positioning
- complete admin-shell polish pass

Current interpretation:
- phases 1 through 4 are already merged
- the remaining focus has shifted from workflow plumbing to public positioning, navigation, content confirmation, and final admin presentation polish

---

## Product decisions still needed before implementation
Most earlier decisions are now confirmed. The remaining product work is implementation, not discovery.

Items now decided:
1. Keep the current admin exemption for unscheduled pending approval.
2. Group-based filtering is enough for this rollout.
3. Approval groups should become admin-configurable.
4. We should extend admin edits for activated Clerk-managed users.
5. Public site direction should shift to training + tours + video packages.
6. Public pricing is confirmed from the follow-up notes above.

Open content/detail checks that still need implementation care:
1. What exact admin UX should manage approval groups in Settings or Users?
2. Should discovery flights remain as a secondary page or be removed from primary nav entirely?
3. Which tour/video images are approved for the final public page treatment?
4. How much flyer disclaimer copy should appear inline on cards versus in a shared note section?

---

## Recommended immediate next step
Start with a final `Workstream 2` completion pass, then do `Workstream 3`, then finish admin polish.

The next coding slices should be:

1. User/admin completion:
- make approval groups admin-configurable
- add Clerk-backed admin edits for activated Clerk-managed users
- keep the current admin exemption and group-filter model unchanged

2. Public site refresh:
- replace discovery-flight-first homepage and nav emphasis
- map the flyers into approved tours/video-package content blocks
- update contact/home/program CTAs to the new business direction
- publish the confirmed tours and video-package pricing
- add the local/military "contact us for discounted rates" language
- add the flyer disclaimer language in an appropriate public-facing note area

After that:
- do the collapsible desktop sidebar and final admin spacing/presentation cleanup

The operational backbone is already in place; the remaining work is positioning, content accuracy, and final rollout polish.
