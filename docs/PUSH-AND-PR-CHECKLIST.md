# AIRE Services — Push and PR Checklist

## Before push
- [ ] Confirm `git status` is clean
- [ ] Confirm frontend build passes
- [ ] Confirm backend zeitwerk check passes
- [ ] Confirm focused kiosk specs pass

## Create remote
Example:
```bash
cd ~/work/aire-services
gh repo create Shimizu-Technology/aire-services --private --source=. --remote=origin --push
```

If the repo already exists:
```bash
cd ~/work/aire-services
git remote add origin git@github.com:Shimizu-Technology/aire-services.git
git push -u origin main
```

## Open first PR
If using a feature branch later:
```bash
git checkout -b feature/initial-aire-services-foundation
git push -u origin feature/initial-aire-services-foundation
gh pr create --title "Initial standalone AIRE Services foundation" --body-file docs/FINAL-PR-SUMMARY.md
```

## Review checklist
- [ ] Public pages render cleanly on desktop + mobile
- [ ] Contact form works against correct backend URL
- [ ] Kiosk route loads
- [ ] Admin routes require auth as expected
- [ ] Team-only user management wording looks right
- [ ] Time tracking/report wording looks AIRE-appropriate

## After PR opens
- [ ] Add screenshots to PR if helpful
- [ ] Run authenticated manual QA
- [ ] Decide next PR focus: admin QA, richer visuals, or deeper domain cleanup
