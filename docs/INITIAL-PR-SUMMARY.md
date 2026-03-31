# AIRE Services — Initial PR Summary

## Summary
This PR creates the first standalone `aire-services` product foundation by extracting the validated AIRE ops prototype out of `cornerstone-tax` and rebuilding the public marketing site around AIRE’s real content.

## What this PR establishes

### Standalone product structure
- separate `aire-services` repo/app scaffold
- public routes for the marketing site
- private admin/ops side for internal workflows
- route/domain planning docs for continued development

### Backend ops foundation
- kiosk PIN support on users
- source-aware time entries (`kiosk`, `mobile`, `admin`, `legacy`)
- extracted time clock service
- AIRE kiosk endpoints
- admin kiosk PIN reset support
- AIRE-focused route surface instead of Cornerstone-specific domain routes

### Frontend ops foundation
- kiosk page
- admin dashboard shell
- team-only users management page
- time tracking and reporting surface
- schedule page
- attendance visibility components

### Public site rebuild
- modernized Home page
- Programs page
- Team page
- Contact page
- Discovery Flight page
- Careers page
- real public AIRE logo and imagery pulled from live site assets
- stronger CTA / trust / FAQ structure

### Inquiry flow
- public contact form wiring
- AIRE-branded contact mailer

## Verification run so far
### Standalone frontend
- `npm install`
- `npm run build`

### Standalone backend
- `bundle install`
- `bundle exec rails zeitwerk:check`
- `bundle exec rails db:create db:migrate RAILS_ENV=test`
- `bundle exec rspec spec/models/user_kiosk_spec.rb spec/requests/aire_kiosk_spec.rb`

## Important notes
- This is the first major extraction pass, not the final polish pass.
- Some scaffold leftovers were removed, but more cleanup may still be appropriate in future PRs.
- Authenticated admin browser QA still depends on a real Clerk session.

## Recommended review focus
1. Is the standalone product shape correct?
2. Is the extracted backend/time-tracking foundation appropriate for AIRE?
3. Does the public-site direction feel right for AIRE’s brand and goals?
4. What should be prioritized next: richer design polish, admin QA, or scheduling/reporting expansion?
