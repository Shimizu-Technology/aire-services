# AIRE Services — Project Status (2026-03-31)

## Current status
AIRE Services has been spun out into its own standalone repository and now has a strong first foundation for both:
- the **public marketing website**
- the **private admin/ops side**

GitHub repo:
- https://github.com/Shimizu-Technology/aire-services

This project started as a prototype inside `cornerstone-tax`, but that prototype has now been extracted into a dedicated AIRE codebase.

---

## What has been completed

### 1) Research and planning
Completed research on AIRE’s current site and public web footprint, including:
- current website content and structure
- programs/training info
- team/instructor names
- contact details
- hiring page content
- outside references (news/social/directory)

This research lives in the Prime workspace memory folder and informed the standalone site rebuild.

### 2) Standalone repo created and pushed
A new standalone repo was created and pushed:
- `Shimizu-Technology/aire-services`

The local repo now has clean git history and multiple structured commits rather than one large blob.

### 3) Public site foundation rebuilt
The standalone public site now includes:
- Home page
- Programs page
- Team page
- Discovery Flight page
- Careers page
- Contact page

What was improved:
- stronger structure and CTA flow
- cleaner IA than the old Wix site
- trust/credibility framing
- FAQ layer
- better alignment with a modern branded experience

### 4) Real public assets added
Pulled real public AIRE assets from the current site where possible, including:
- logo
- hero imagery
- careers imagery

### 5) Contact flow added
The standalone site has a wired public contact form that posts to the backend contact endpoint.
The contact mailer was rebranded for AIRE Services Guam.

### 6) Admin/ops foundation extracted
The standalone app includes the core AIRE operations foundation:
- kiosk PIN support
- kiosk clock in/out flow foundation
- source-aware time entries (`kiosk`, `mobile`, `admin`, `legacy`)
- time categories and rates
- schedules
- attendance visibility
- payroll-style reporting direction
- admin kiosk PIN reset support

### 7) Admin-side cleanup started
The admin side was cleaned up to be more AIRE-specific.
Examples:
- Users page is now team-focused rather than client-portal oriented
- Time Tracking wording was shifted away from tax/client baggage
- AIRE Ops naming is used instead of Cornerstone naming in key places

### 8) Repo cleanup completed
The repo has already gone through cleanup/prune passes to remove obvious donor-app baggage from the first extraction.
Both backend and frontend prune passes were committed.

---

## Current commit history
As of this status note, the repo contains these major local+remote commits:
1. `Initialize standalone AIRE Services app scaffold`
2. `Port AIRE time tracking and kiosk backend foundation`
3. `Build AIRE public site and admin frontend foundation`
4. `Prune non-AIRE backend scaffold surfaces`
5. `Prune frontend scaffold leftovers`
6. `Add standalone repo handoff and PR docs`

These commits establish the first real standalone AIRE product foundation.

---

## Verification already completed
### Backend
Completed during development:
- bundle install
- zeitwerk check
- focused kiosk specs
- standalone test DB setup

### Frontend
Completed during development:
- npm install
- multiple successful production builds

### Browser/manual
Completed during development:
- standalone public site browser run
- screenshot capture for Home / Discovery Flight / Careers
- mobile/header presentation check and header alignment fix
- contact endpoint verification

---

## What still needs to be done

### High priority
#### 1) Authenticated admin QA
Need to test the standalone app with a real authenticated session for:
- `/admin/users`
- `/admin/time`
- kiosk/admin/mobile flows inside the standalone AIRE app

#### 2) Deployment planning and setup
Need to decide and implement:
- hosting target(s)
- environment variables
- domain setup
- deployment pipeline
- production contact mail configuration

#### 3) Public-site polish with more approved assets/content
Still recommended:
- more real AIRE images
- team headshots/bios if available
- more premium design polish
- optional testimonials/social proof improvements
- optional map/location treatment

### Medium priority
#### 4) Deeper backend domain cleanup
The repo has already been pruned significantly, but a later cleanup pass may still simplify domain/model leftovers further now that AIRE is fully standalone.

#### 5) Admin/reporting refinement
The admin foundation is present, but can still be improved with:
- better dashboard presentation
- reporting polish
- schedule UX refinement
- correction/approval flow refinement if needed

---

## Recommended next sequence
1. Run real authenticated QA in `aire-services`
2. Set up deployment and environment config
3. Continue public-site polish with real approved assets/content
4. Refine admin/reporting flows
5. Do deeper backend simplification only after the product shape stabilizes further

---

## Important framing
AIRE is no longer a “maybe” experiment.
It is now being treated as a real standalone product with:
- public marketing site
- admin/ops side
- digitized time tracking foundation

The old `cornerstone-tax` AIRE branch should now be considered:
- prototype/proof-of-work
- code donor
- workflow validator

The real forward path is now the standalone repo.

---

## Short summary
### Done
- standalone repo created and pushed
- public site rebuilt into first strong version
- contact flow added
- ops/admin foundation extracted
- repo history cleaned and documented

### Next
- authenticated admin QA
- deployment setup
- final content/asset polish
- admin/reporting refinement
