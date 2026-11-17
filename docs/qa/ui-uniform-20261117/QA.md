# Lead-commit validation: 5151561b — November 17, 2026

**Tested SHA: `5151561b762d4f37fea9d93f3ec9247a38b85296`. No application code changed in this QA pass. Acceptance FAILED: 60 checks passed, 54 failed out of 114.** This section supersedes the earlier acceptance below. The reported failures are left for the lead as requested.

Same temporary local synthetic API/auth fixtures and T3 Chromium environment as the prior round. All 19 routes loaded at each of six dimensions. Root font-size was reset on every navigation. No production, database, real email or external writes. No automated gate rerun requested or performed for this documentation-only pass; earlier gates below belong to 0626487, not this SHA.

## Matrix

P = all required assertions passed. Fail includes disallowed truncation at text sizes below 150%, actual container text overflow, or any word split. At 150% and above, intentional bottom-tab ellipsis is allowed and excluded from the failure decision.

| Route | 320/100 | 390/100 | 1280/100 | 390/125 | 390/150 | 320/200 |
| --- | --- | --- | --- | --- | --- | --- |
| `/admin` | Fail | Pass | Pass | Fail | Pass | Fail |
| `/admin/timecards` | Fail | Pass | Pass | Fail | Pass | Fail |
| `/admin/approvals?classic=1` | Fail | Pass | Pass | Fail | Fail | Fail |
| `/admin/approvals` | Fail | Pass | Pass | Fail | Pass | Fail |
| `/admin/payroll?qaState=locked` | Fail | Pass | Pass | Fail | Pass | Fail |
| `/admin/users/7?tab=pay` | Fail | Pass | Pass | Fail | Pass | Fail |
| `/admin/reports` | Fail | Pass | Pass | Fail | Pass | Fail |
| `/kiosk?qaState=nonmanager&qaRole=employee` | Pass | Pass | Pass | Pass | Pass | Fail |
| `/kiosk` | Pass | Pass | Pass | Pass | Pass | Fail |
| `/admin/payroll-link?token=fixture` | Fail | Pass | Pass | Fail | Pass | Fail |
| `/admin/pay-stubs?tab=links` | Fail | Pass | Pass | Fail | Pass | Fail |
| `/admin/settings/time-clock` | Fail | Pass | Pass | Fail | Pass | Fail |
| `/admin/settings/departments` | Fail | Pass | Pass | Fail | Pass | Fail |
| `/admin/users` | Fail | Pass | Pass | Fail | Pass | Fail |
| `/admin/payroll/records` | Fail | Pass | Pass | Fail | Pass | Fail |
| `/admin/users/7?tab=time` | Fail | Pass | Pass | Fail | Pass | Fail |
| `/admin/schedule` | Fail | Pass | Pass | Fail | Pass | Fail |
| `/admin?qaState=team` | Fail | Pass | Pass | Fail | Pass | Fail |
| `/admin/website/contact?qaState=categories` | Fail | Pass | Pass | Fail | Pass | Fail |

[Complete raw measurements, CSS classes, word rects and executable check expressions](lead-5151561-layout-results.json).

## Bottom tabs

All labels occupy exactly one line in all 10 targeted cases. **320/100 fails** because Approvals and Timecards ellipsize. Subpixel Range measurements: Approvals needs 57.84px in 57.60px; Timecards needs 61.08px in 57.60px. Integer scrollWidth alone misses the slight Approvals truncation; the crop confirms it. 360/100, 375/100, 390/100 and 430/100 show full labels. At 150%, ellipses are allowed: Approvals and Timecards truncate at every width; Payroll also truncates at 320. No mid-word wrapping in the tab labels. Main matrix additionally detects Timecards truncation at 390/125, below the allowed 150% threshold.

| Width | Text | Lines | Ellipsized labels (box/text width) |
| --- | --- | --- | --- |
| 320 | 100% | All one line | Approvals (57.60/57.84px), Timecards (57.60/61.08px) |
| 320 | 150% | All one line | Approvals (54.41/86.75px), Timecards (54.40/91.61px), Payroll (54.40/57.90px) |
| 360 | 100% | All one line | None |
| 360 | 150% | All one line | Approvals (62.41/86.75px), Timecards (62.40/91.61px) |
| 375 | 100% | All one line | None |
| 375 | 150% | All one line | Approvals (65.41/86.75px), Timecards (65.40/91.61px) |
| 390 | 100% | All one line | None |
| 390 | 150% | All one line | Approvals (68.41/86.75px), Timecards (68.40/91.61px) |
| 430 | 100% | All one line | None |
| 430 | 150% | All one line | Approvals (76.41/86.75px), Timecards (76.40/91.61px) |

At 320/200 the restored badge position also exceeds its own tab: Approvals link clientWidth 51px / scrollWidth 70px. This is separate from allowed label ellipsis and appears on every staff route.

## Mid-word breaks

Range client rects were collected for each Unicode letter/number word (apostrophes remain within a word), across rendered buttons, role buttons/tabs, links (including links styled as buttons), headings, rounded spans, status roles and badge classes. Text nodes are deduplicated; hidden/screen-reader and decorative SVG text are excluded. Hyphens separate words. Across the matrix: **23,014 word inspections; 111 word-split occurrences in 16 cases**. Single oversized words may explain the browser behavior, but are still reported under the requested strict assertion.

| Route | Width/text | Words split across line tops |
| --- | --- | --- |
| `/admin/approvals?classic=1` | 320/100% | Unscheduled |
| `/admin/approvals?classic=1` | 390/150% | Unscheduled |
| `/admin/timecards` | 320/200% | waiting |
| `/admin/approvals?classic=1` | 320/200% | Approvals, Unscheduled, clock |
| `/admin/payroll?qaState=locked` | 320/200% | Clocked, earlier, periods, Cornerstone |
| `/admin/users/7?tab=pay` | 320/200% | Joaquin, Mendiola, Taitano, Guerrero, Active, Personal |
| `/admin/reports` | 320/200% | progress, payroll |
| `/kiosk?qaState=nonmanager&qaRole=employee` | 320/200% | Manager, admin, launch, required |
| `/kiosk` | 320/200% | CLR |
| `/admin/payroll-link?token=fixture` | 320/200% | Connect, Cornerstone, Payroll |
| `/admin/settings/departments` | 320/200% | Departments |
| `/admin/users` | 320/200% | clock, Alexandria |
| `/admin/payroll/records` | 320/200% | records |
| `/admin/users/7?tab=time` | 320/200% | Joaquin, Mendiola, Taitano, Guerrero, Active, Personal |
| `/admin/schedule` | 320/200% | current |
| `/admin/website/contact?qaState=categories` | 320/200% | Off, Schedules |

Example: classic Approvals at 320/100, “Unscheduled” inside the reason pill has rects at y=2057 and y=2072 (widths 37.21px and 41.25px), confirming an internal word break. Seven repeated employee rows show it. At 390/150 the same word breaks in seven rows.

## Overflow and clipped text

Same per-container scrollWidth threshold (>2px) and text Range checks as the prior round. Intentional horizontal table/filter scrollers are separately recorded, not treated as page overflow. Text rects extending outside a non-scrolling container remain failures, even when an ancestor hides them. Ellipsis is explicitly classified using the owner’s size exception above. The raw check retains its previous cap of 60 issue entries per case; Reports and classic Approvals at 320/200 hit that cap, so their counts are lower bounds.

Page overflow occurs only at 320/200: Payroll records **+179px**, team dashboard **+28px**, legacy Settings **+21px**. Every other case has zero page overflow, which does not imply no local clipping.

Selected precise element measurements below use clientWidth→scrollWidth. Raw JSON includes every recorded element’s CSS selector classes and text, and every split word’s line coordinates.

| Route | Width/text | Representative failing containers |
| --- | --- | --- |
| `/admin/approvals?classic=1` | 320/100% | div “Alexandria 5 Santos-De Leon Guerrero UNSCHEDULED CLOCK”: 61→69px; div “Alexandria 6 Santos-De Leon Guerrero UNSCHEDULED CLOCK ”: 61→69px; div “Alexandria 6 Santos-De Leon Guerrero UNSCHEDULED CLOCK”: 61→69px |
| `/admin/approvals?classic=1` | 390/125% | div “FILTERED PENDING 7 56.00h awaiting review OLDEST — Defa”: 318→353px |
| `/admin/approvals?classic=1` | 390/150% | div “Alexandria 5 Santos-De Leon Guerrero UNSCHEDULED CLOCK”: 75→104px; div “Alexandria 6 Santos-De Leon Guerrero UNSCHEDULED CLOCK ”: 75→104px; div “Alexandria 6 Santos-De Leon Guerrero UNSCHEDULED CLOCK”: 75→104px |
| `/admin` | 320/200% | li “Approvals 7”: 51→70px; a “Approvals 7”: 51→70px |
| `/admin/timecards` | 320/200% | li “Approvals 7”: 51→70px; a “Approvals 7”: 51→70px |
| `/admin/approvals?classic=1` | 320/200% | div “Alexandria 5 Santos-De Leon Guerrero UNSCHEDULED CLOCK ”: 70→139px; div “Alexandria 5 Santos-De Leon Guerrero UNSCHEDULED CLOCK ”: 70→139px; div “Alexandria 5 Santos-De Leon Guerrero UNSCHEDULED CLOCK ”: 70→139px |
| `/admin/approvals` | 320/200% | button “Approve 1”: 108→112px; li “Approvals 7”: 51→70px; a “Approvals 7”: 51→70px |
| `/admin/payroll?qaState=locked` | 320/200% | p “Connected to Cornerstone Payroll”: 198→204px; li “Approvals 7”: 51→70px; a “Approvals 7”: 51→70px |
| `/admin/users/7?tab=pay` | 320/200% | li “Approvals 7”: 51→70px; a “Approvals 7”: 51→70px |
| `/admin/reports` | 320/200% | span “Alexandria 27 Santos-De Leon Guerrero ACTIVE Administra”: 190→369px; button “Alexandria 28 Santos-De Leon Guerrero ACTIVE Administra”: 254→401px; span “Alexandria 28 Santos-De Leon Guerrero ACTIVE Administra”: 190→369px |
| `/kiosk` | 320/200% | div “CURRENT EMPLOYEE Waiting for PIN Verify a PIN to get st”: 174→221px; div “CURRENT EMPLOYEE Waiting for PIN”: 172→220px; div “CURRENT EMPLOYEE Waiting for PIN”: 92→180px |
| `/admin/payroll-link?token=fixture` | 320/200% | button “Connect and return to Cornerstone”: 142→157px; li “Approvals 7”: 51→70px; a “Approvals 7”: 51→70px |
| `/admin/pay-stubs?tab=links` | 320/200% | li “Approvals 7”: 51→70px; a “Approvals 7”: 51→70px |
| `/admin/settings/time-clock` | 320/200% | li “Approvals 7”: 51→70px; a “Approvals 7”: 51→70px |
| `/admin/settings/departments` | 320/200% | li “Approvals 7”: 51→70px; a “Approvals 7”: 51→70px |
| `/admin/users` | 320/200% | li “Approvals 7”: 51→70px; a “Approvals 7”: 51→70px |
| `/admin/payroll/records` | 320/200% | div “Oct 16, 2026–Oct 31, 2026 AIRE-PAY-20261031-OCT Account”: 174→426px; li “Approvals 7”: 51→70px; a “Approvals 7”: 51→70px |
| `/admin/users/7?tab=time` | 320/200% | li “Approvals 7”: 51→70px; a “Approvals 7”: 51→70px |
| `/admin/schedule` | 320/200% | li “Approvals 7”: 51→70px; a “Approvals 7”: 51→70px |
| `/admin?qaState=team` | 320/200% | a “Hours Reports Inspect live hour summaries, working expo”: 172→219px; li “Approvals 7”: 51→70px; a “Approvals 7”: 51→70px |
| `/admin/website/contact?qaState=categories` | 320/200% | div “Time categories”: 174→188px; li “Approvals 7”: 51→70px; a “Approvals 7”: 51→70px |

## Refreshed evidence

| Page | 375/100 | 390/150 |
| --- | --- | --- |
| Today | [PNG](lead-today-375-100.png) | [PNG](lead-today-390-150.png) |
| Timecards | [PNG](lead-timecards-375-100.png) | [PNG](lead-timecards-390-150.png) |
| Approvals | [PNG](lead-approvals-375-100.png) | [PNG](lead-approvals-390-150.png) |

Tab-bar crops: [320/100](lead-tabbar-320-100.png), [390/150](lead-tabbar-390-150.png). Earlier screenshots below are historical.

Physical iPhone Safari/WebKit remain not run on this headless mini. Resized Chromium/root text scaling is an approximation. Lifecycle session `manual-20261117-203450-92835-0216`: task-owned fixture server/browser cleaned before handback, no runtime handoff. PR remains unmerged.

---

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
