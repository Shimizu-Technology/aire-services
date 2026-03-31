# AIRE Services — Initial Commit Plan

## Goal
Break the first standalone AIRE repo history into clean, reviewable chunks.

## Recommended commit grouping

### Commit 1 — scaffold + repo planning
**Title:** `Initialize standalone AIRE Services app scaffold`

Include:
- repo-level `.gitignore`
- `README.md`
- planning/docs that define project direction:
  - `docs/PROJECT-OVERVIEW.md`
  - `docs/PORTING-CHECKLIST.md`
  - `docs/ROUTE-AND-DOMAIN-PLAN.md`
  - `docs/EXTRACTION-STATUS.md`
  - `planning/EXTRACTION-NOTES.md`

### Commit 2 — backend ops foundation extraction
**Title:** `Port AIRE time tracking and kiosk backend foundation`

Include:
- backend models/services/controllers relevant to AIRE ops
- migrations for kiosk fields + clock source + category rates
- routes pruning to AIRE-only API surface
- Rack::Attack config
- backend specs
- backend Gemfile/Gemfile.lock updates

### Commit 3 — frontend ops/admin foundation
**Title:** `Port AIRE admin and kiosk frontend foundation`

Include:
- `frontend/src/lib/api.ts`
- `frontend/src/App.tsx`
- admin layouts
- admin pages
- time-tracking components
- kiosk page
- auth/layout glue needed for ops side

### Commit 4 — public site rebuild
**Title:** `Rebuild AIRE public marketing site`

Include:
- `AireHome.tsx`
- `AirePrograms.tsx`
- `AireTeam.tsx`
- `AireContact.tsx`
- `AireDiscoveryFlight.tsx`
- `AireCareers.tsx`
- header/footer/index.css public theme updates
- real AIRE public assets in `frontend/public/assets/aire`

### Commit 5 — contact flow + final polish
**Title:** `Add public inquiry flow and polish AIRE branding`

Include:
- contact mailer branding updates
- contact form wiring
- home trust/FAQ sections
- admin wording cleanup
- final docs:
  - `docs/DESIGN-AND-CONTACT-PASS.md`
  - `docs/PUBLIC-SITE-REBUILD-STATUS.md`
  - `docs/POLISH-PASS-2.md`
  - `docs/POLISH-PASS-3.md`

## Notes
If Leon prefers fewer commits, commits 4 and 5 can be squashed together.

If speed matters more than history purity, the first PR could also reasonably be 3 commits:
1. scaffold/docs
2. backend + frontend ops extraction
3. public site + contact + polish
