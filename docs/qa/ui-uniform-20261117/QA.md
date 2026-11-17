# Final review-round QA — November 17, 2026

Application source tested: `0626487`. PR #215 is held, unmerged. The previous initial-pass acceptance missed states found by lead review; this round supersedes it. Historical raw measurements and before screenshots remain available.

Agent-executed T3 Chromium against actual React pages with temporary local synthetic auth/API middleware. Fixtures include 37 people, long names, seven pending timecards, original employee changes, locked OT flags, accounting lifecycle states, active pay-stub links and settings tables. No production, database, real email, deployment or external payroll transaction.

Controls now use minimum heights, max-width bounds and wrapping as a last resort. Shared fine-pointer compact sizes remain 36px for small buttons/chips/icons and 32px for segments; coarse targets remain >=44px. Adjacent actions stretch together. Status labels wrap tightly; original-time rejection uses a detail layout.

## Final page matrix

**114 checks passed**, 19 routes at **320/100%, 390/100%, 1280/100%, 390/125%, 390/150%, 320/200%** root text. Every page loaded with zero page overflow and no detected clipped text. Per-container scrollWidth checks also inspect actual text ranges. Intentional chip/table scrollers are reported separately; decorative SVG/pseudo hit areas are distinguished from text clipping.

| Route | All six dimensions |
| --- | --- |
| `/admin` | Pass |
| `/admin/timecards` | Pass |
| `/admin/approvals?classic=1` | Pass |
| `/admin/approvals` | Pass |
| `/admin/payroll?qaState=locked` | Pass |
| `/admin/users/7?tab=pay` | Pass |
| `/admin/reports` | Pass |
| `/kiosk?qaState=nonmanager&qaRole=employee` | Pass |
| `/kiosk` | Pass |
| `/admin/payroll-link?token=fixture` | Pass |
| `/admin/pay-stubs?tab=links` | Pass |
| `/admin/settings/time-clock` | Pass |
| `/admin/settings/departments` | Pass |
| `/admin/users` | Pass |
| `/admin/payroll/records` | Pass |
| `/admin/users/7?tab=time` | Pass |
| `/admin/schedule` | Pass |
| `/admin?qaState=team` | Pass |
| `/admin/website/contact?qaState=categories` | Pass |

[Raw final scans and interaction results](round1-layout-results.json).

## Targeted states

- Classic Approvals original-time rejection at 375/768/1280: complete label/date/time visible, one phone column, desktop order preserved.
- Reports Hours by Employee at 1280/1440: readable lifecycle labels, compact OT pill, secondary presets.
- Kiosk non-manager and normal states: matrix passed, including 320/200%. Verified fixture PIN and opened request form at 320/200%; no request sent.
- Locked payroll long two-part “12.5h OT held back at the lock · 3.3h from earlier periods” flag fits at 390/200%. Person Pay passes 320/200%.
- Approvals live toast at 390/150% stays above 186px selection bar; main reserves 210px. Summary is readable.
- Unsaved settings at 320/200%: measured 359px bar and 391px content padding; Discard works, no save.
- People create step-two footer, Schedule add-shift footer and pay-stub revoke confirmation fit at 320/200%. No final create/send/save/revoke.
- Expanded Who’s working at 320/200% fits long names and stacked statistics; no clock changes.
- Legacy Settings category table scrolls to right edge inside its scroller at 320/200%. Mobile cards deferred per owner scope.
- Today/Timecards after captures refreshed at 390 normal/150%. Timecards chevron is a separate right-edge sibling centered on the row; badge/content alone can move below.

## Evidence

Before captures use base 88244be with matching fixtures.

| Page | Before normal | After normal | Before 150% | After 150% |
| --- | --- | --- | --- | --- |
| Today | [PNG](before-today-390-100.png) | [PNG](after-today-390-100.png) | [PNG](before-today-390-150.png) | [PNG](after-today-390-150.png) |
| Timecards | [PNG](before-timecards-390-100.png) | [PNG](after-timecards-390-100.png) | [PNG](before-timecards-390-150.png) | [PNG](after-timecards-390-150.png) |

Additional captures: [original time 375](round1-original-time-375.png), [768](round1-original-time-768.png), [1280](round1-original-time-1280.png); [Reports 1280](round1-reports-1280.png), [1440](round1-reports-1440.png); [selection/toast](round1-selection-toast-390-150.png); [Kiosk request](round1-kiosk-request-320-200.png); [People footer](round1-person-create-footer-320-200.png); [Schedule footer](round1-schedule-footer-320-200.png); [long flag](round1-long-payroll-flag-390-200.png); [Settings table](round1-settings-table-320-200.png).

## Gates and limitations

Full Vitest **153 files / 1,914 tests passed**. Lint, TypeScript, production-config frontend build and diff whitespace check passed. Advisory Impeccable scan: zero findings. Regression checks cover detailed buttons, compact sizes, measured bar cleanup and toast offset.

Root scaling approximates larger text. Physical iPhone Safari, native iOS settings and WebKit were not run: WebKit cannot launch on this headless mini. Resized Chromium uses fine pointer; coarse target CSS was inspected. This does not establish physical-device acceptance.

Task-owned server/browser cleanup is recorded in lifecycle session `manual-20261117-190411-87983-f0f3` before handback. No database/runtime handoff; branch/worktree/PR remain held. Shared-guidance freshness setup is incomplete (missing agent-context.json); canonical guidance was read directly from Shared-Guidance.
