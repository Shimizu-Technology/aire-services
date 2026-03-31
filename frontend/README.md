# Cornerstone Frontend (React + Vite)

## Setup

```bash
npm install
```

## Environment Variables

Create a `.env` file (copy from `.env.example`):

```bash
VITE_CLERK_PUBLISHABLE_KEY=pk_test_xxxxx
VITE_API_URL=http://localhost:3000
```

**Note:** If `VITE_CLERK_PUBLISHABLE_KEY` is not set, the app runs without authentication (dev mode).

## Run Development Server

```bash
npm run dev  # Runs on port 5173
```

## Build for Production

```bash
npm run build
```

## Testing

```bash
# Unit tests (Vitest)
npm test                # Run once
npm run test:watch      # Watch mode

# E2E tests (Playwright)
npm run test:e2e        # Run all E2E tests
npm run test:e2e:headed # See browser during tests
npm run test:e2e:ui     # Visual test runner
```

**E2E Test Prerequisites:**
1. Create test user in Clerk with "Bypass Client Trust" enabled
2. Add credentials to `.env` (gitignored):
   ```
   TEST_USER_EMAIL=test-admin@yourcompany.com
   TEST_USER_PASSWORD=your-password
   ```

See `/docs/TESTING_GUIDE.md` for full documentation.

## Key Files

- `src/main.tsx` - App entry with Clerk provider
- `src/contexts/AuthContext.tsx` - Authentication context
- `src/components/auth/` - Protected route components
- `src/lib/api.ts` - API client with auth token handling
- `src/pages/intake/IntakeForm.tsx` - Client intake form
- `src/pages/admin/` - Admin dashboard pages
