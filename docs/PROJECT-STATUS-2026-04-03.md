# AIRE Services — Project Status (2026-04-03)

## Executive summary
AIRE Services is now in a **serious pre-rollout state** rather than a prototype state.

The repo has moved through:
- donor-app extraction and cleanup
- public-site rebuild and polish
- admin/reporting refinement
- contact-form operationalization
- time-tracking/payroll fit-gap implementation for next pay period

If the latest `main` includes the merged fit-gap PRs, the project is now at the point where the **highest-value next step is authenticated QA and real workflow validation**, not more speculative feature work.

Repo:
- https://github.com/Shimizu-Technology/aire-services

---

## What is done

### 1) Standalone product extraction
The app is no longer a hidden donor feature from Cornerstone Tax.

Completed:
- standalone `aire-services` repo established
- obvious donor residue removed from backend/frontend
- donor-era branding scrubbed from public assets, manifest, robots, sitemap, emails, and admin surface wording
- repo history and scope clarified through structured PRs/docs

Result:
- AIRE now has a dedicated codebase with its own public/admin identity

---

### 2) Public site rebuilt and polished
The public site now has a much stronger first version.

Public routes currently in scope:
- `/`
- `/programs`
- `/team`
- `/discovery-flight`
- `/contact`
- `/careers`
- `/kiosk`

Completed public-facing work:
- home page restructure and CTA improvements
- programs page aligned to AIRE’s real public offerings
- team page aligned to public instructor roster
- discovery flight page positioned as the main conversion path
- careers page included
- contact page rebuilt and wired to backend
- footer/social/contact consistency pass
- favicon/app-icon polish
- SEO/PWA pass
- public copy aligned more closely to AIRE’s actual live footprint and social presence

Known public channels now reflected in the app:
- Instagram: `https://www.instagram.com/aire.services/`
- Facebook: `https://www.facebook.com/AireServicesGuam/`

Result:
- public side is no longer placeholder/demo quality
- it is in a realistic stakeholder-review state

---

### 3) Admin/reporting refinement
The admin side is materially better than the extracted foundation.

Completed:
- improved dashboard snapshot/action-center experience
- clearer reports entry and reporting workflow
- schedule page staffing summaries and filtering
- users/access management refinement
- better admin shell/polish

Result:
- admin feels more like a real ops tool and less like a scaffold

---

### 4) Contact form operationalization
The contact form is backend-connected and operational.

Current behavior:
- frontend contact form posts to backend
- backend sends notification email(s)
- admin can now configure **notification recipients** from the admin side
- multiple recipient emails are supported

Important note:
- contact inquiries are currently **email-delivered**, not stored in a DB-backed admin inbox

Result:
- operationally usable for inbound leads/inquiries
- not yet a CRM/inbox product

---

### 5) Time tracking / payroll fit-gap implementation
This is the biggest area of recent progress.

The latest implementation now supports:

#### Roles / staff access
- practical role model remains:
  - `admin`
  - `employee`
- no separate `cfi` role was added because employee + pay/category config is the simpler fit

#### Kiosk / code handling
- admins can set/reset each employee’s kiosk PIN/code

#### Schedule policy
- schedule requirement for clock-in is now **configurable**
- it is no longer hardcoded forever-on

#### Time categories / rate handling
- category-based work types are supported
- this matches AIRE’s real CFI-style work reasonably well:
  - Flight Instruction / Flight Hours
  - Ground School / Ground Instruction
  - Admin Duties

#### Employee pay overrides
- per-employee pay-rate overrides layered on top of category defaults
- this allows different employees to have different rates for the same category when needed

#### Reporting / payroll-ish calculations
- reports now use effective rate logic instead of only category defaults
- reporting/payroll summaries were tightened to avoid misleading grouping

#### Historical rate protection
- time entries now snapshot the effective rate so historical entries do not drift when rates change later
- this was the last major payroll-confidence gap and is now addressed for future data

#### Staff/admin/mobile use
- employees and admins can use the staff/admin side for time actions
- mobile use for staff/CFI-like employees is viable through the admin time-tracking surface
- non-admin staff no longer see certain dead-end admin-only nav actions

Result:
- time tracking is much closer to real next-pay-period readiness

---

## Important implementation caveats

### 1) Historical rate snapshotting only protects from rollout forward
Historical rate snapshotting now exists, but:
- existing old completed entries were backfilled at migration time using then-current effective rates
- if older history had already drifted before the migration, that original truth cannot be reconstructed automatically

### 2) Contact inquiries are still email-only
There is still no admin inbox/history for website inquiries.

### 3) Full real-world QA still needs to happen
We have code-level confidence, but the highest-value next step is still real authenticated QA.

---

## PR / implementation arc completed in this phase
This phase included work equivalent to:
- donor residue cleanup and standalone hardening
- SEO/PWA/public polish
- favicon/app-icon work
- admin/reporting refinement
- contact notification settings + public social polish
- full time-tracking/payroll fit-gap implementation
- historical rate snapshotting

If you are resuming later, treat the repo as having already gone through the major “make it real” build phase.

---

## What should happen next

### Highest priority: authenticated QA
Do a real workflow validation pass with actual accounts and realistic data.

Recommended QA checklist:

#### Admin flow
- create staff user
- set/reset kiosk PIN
- configure contact notification emails
- configure schedule-required policy on/off
- create/edit/archive time categories and rates
- configure employee pay overrides
- create schedules
- review reports/pay summaries

#### Employee / CFI-like flow
- sign into admin side on phone
- clock in / break / clock out
- use multiple categories correctly
- verify schedule-required behavior when on/off
- verify rate calculations appear correctly in reports

#### Kiosk flow
- verify PIN login
- verify category selection
- verify normal clock in/out
- verify behavior with optional vs required schedule policy

#### Contact flow
- submit inquiry
- verify configured recipients actually receive email

### Next likely feature after QA
If something still feels missing after real usage, the most likely next build target is:
- **contact submissions inbox/history**, or
- deeper payroll export/report workflow polish

---

## Recommended next-session starting point
When reopening AIRE work, read these in order:
1. `docs/PROJECT-STATUS-2026-04-03.md` ← this file
2. `docs/PROJECT-OVERVIEW.md`
3. current open/merged PR history on GitHub
4. then run the authenticated QA plan above

---

## Plain-English state
AIRE is no longer “we should probably build this someday.”

It is now:
- a rebuilt public site
- a usable admin/ops system
- a configured contact-notification flow
- a substantially more realistic time-tracking/payroll-aware app

The project is now in the phase where **testing the real workflows matters more than inventing more features**.
