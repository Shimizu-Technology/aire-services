# Gate 0: Frontend Dependency Closeout

**Date:** August 23, 2026  
**Scope:** AIRE portion of Payroll Gate 0 item G0-22  
**Status:** Implemented and locally verified; deployment verification remains required after merge

## Why this is part of Gate 0

AIRE supplies approved time to Cornerstone Payroll and handles staff-facing workforce data. Its frontend lockfile resolved 20 known vulnerabilities: 1 low, 11 moderate, 7 high, and 1 critical. The affected graph included Vitest, React Router, Vite, Babel, DOMPurify, PostHog/OpenTelemetry, PostCSS, protobufjs, and supporting build packages.

Known critical and high advisories are incompatible with the trust baseline for a production workforce product, even when some affected packages are development tooling. The lockfile is part of the reproducible build and must resolve to reviewed versions.

## Implemented boundary

- Refreshed the lockfile using compatible package versions; no forced major-version upgrade was required.
- Reduced the npm audit result from 20 known vulnerabilities to zero at the low threshold.
- Preserved application source, APIs, database behavior, payroll integration semantics, and product permissions.
- Reinstalled from the resulting lockfile and reran lint, unit, build, and audit gates.

## Local verification

```bash
cd frontend
npm ci
npm run lint
npm test
npm run build
npm audit --audit-level=low
npx playwright test --project=public --project=public-mobile
```

Result on August 23, 2026:

- ESLint: clean
- Vitest: 14 files, 29 tests passed
- TypeScript and Vite production build: passed
- npm audit at low threshold: 0 vulnerabilities
- Playwright public production-build suite: 44 tests passed across desktop and mobile projects
- lockfile diff check: clean

The same production build was served locally and inspected with computer use. The AIRE public homepage rendered its current aviation-services content, `/kiosk` rendered the shared staff time-clock surface without entering a PIN, and `/admin` failed closed with the expected authentication-configuration message when the Clerk key was intentionally absent. The localhost kiosk identifies its unlock as a development convenience, so this check proves rendering only; it does not claim to verify the production kiosk unlock policy.

The authenticated Playwright projects require `TEST_USER_EMAIL` and `TEST_USER_PASSWORD`; those credentials were not present in this worktree, so their results are not included above. Authenticated production verification remains an explicit deployment-closeout requirement below.

The Settings tests render an external OpenStreetMap iframe. Happy DOM reports an abort while tearing down that external page, but all assertions pass. This is existing test-harness noise, not an ignored failure or an application fetch performed by the production bundle. A future test-harness cleanup can replace the iframe with an explicit test double.

## Deployment closeout

Merge completion closes the code change only. Operational closure requires the `main` deploy to succeed and a verifier to confirm:

1. public AIRE pages load;
2. signed-out admin and staff routes still require Clerk;
3. kiosk access and an authenticated clock-in surface render normally;
4. the production console has no dependency-refresh regression;
5. the deployed asset belongs to the merged commit.

Record the commit, production URL, timestamp, and verifier with the release evidence. A Greptile score and deploy preview do not replace production verification.

## Non-goals

This change does not add multitenancy, turn leave requests into a PTO accrual engine, calculate payroll, merge AIRE with Cornerstone Tax, or separate the workforce UI from AIRE's public marketing site. Those decisions remain in the cross-product strategy and Gate plan maintained in Cornerstone Payroll.
