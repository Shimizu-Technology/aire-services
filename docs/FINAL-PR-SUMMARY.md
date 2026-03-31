# AIRE Services — Final PR Summary

## Overview
This repo establishes the first standalone version of **AIRE Services Guam** as a combined:
- modern public-facing marketing site
- internal admin/ops system
- kiosk + mobile time-tracking foundation

It extracts the validated AIRE prototype work out of `cornerstone-tax` and reshapes it into a dedicated product.

## What’s included

### Standalone app foundation
- separate `aire-services` repo scaffold
- repo planning + extraction docs
- AIRE-specific public/admin route structure
- cleaner standalone product direction instead of a feature hidden in Cornerstone Tax

### Backend ops foundation
- kiosk PIN support on users
- source-aware time entries (`kiosk`, `mobile`, `admin`, `legacy`)
- extracted time clock service
- AIRE kiosk endpoints
- admin kiosk PIN reset support
- schedules, categories, time period locks, and users endpoints retained for ops workflows
- public contact endpoint retained for the marketing site

### Frontend/admin foundation
- kiosk page
- admin dashboard shell
- team-only users management page
- time tracking and reporting surface
- attendance visibility components
- schedule page

### Public site rebuild
- Home page rebuilt with stronger CTA structure and trust framing
- Programs page rebuilt around AIRE’s public training content
- Team page rebuilt around public instructor roster
- Discovery Flight page added as a dedicated conversion path
- Careers page added using AIRE’s current hiring content
- Contact page rebuilt and wired to the backend
- real public AIRE logo and imagery pulled from live site assets

### Contact flow
- public inquiry form posts to backend contact endpoint
- contact mailer rebranded for AIRE Services Guam

## Cleanup completed
- pruned non-AIRE backend scaffold surfaces (tax/client/portal/payroll-checklist/operations leftovers)
- pruned obvious frontend scaffold leftovers
- cleaned up donor-app naming on the admin side so it reads as AIRE Ops

## Verification run
### Backend
- `bundle install`
- `bundle exec rails zeitwerk:check`
- `bundle exec rails db:create db:migrate RAILS_ENV=test`
- `bundle exec rspec spec/models/user_kiosk_spec.rb spec/requests/aire_kiosk_spec.rb`

### Frontend
- `npm install`
- `npm run build`

### Browser/manual
- browser-ran standalone public site locally
- captured screenshots for Home / Discovery Flight / Careers
- verified standalone contact endpoint directly
- fixed standalone frontend API default from port `3000` to `3100`
- fixed header alignment / mobile presentation issue

## Commit history
1. `Initialize standalone AIRE Services app scaffold`
2. `Port AIRE time tracking and kiosk backend foundation`
3. `Build AIRE public site and admin frontend foundation`
4. `Prune non-AIRE backend scaffold surfaces`
5. `Prune frontend scaffold leftovers`

## Recommended next steps
1. Create remote repo and push `aire-services`
2. Open first PR with this summary
3. Run authenticated manual QA on admin surfaces with real Clerk session
4. Continue iterative polish on visuals and admin workflows
5. Decide whether to further simplify backend domain models in a later cleanup PR
