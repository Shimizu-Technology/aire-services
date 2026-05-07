# AIRE Services Frontend (React + Vite)

## Setup

```bash
npm install
```

## Environment Variables

Create a `.env.local` file:

```bash
VITE_CLERK_PUBLISHABLE_KEY=pk_test_xxxxx
VITE_API_URL=http://localhost:3100
VITE_GOOGLE_MAPS_BROWSER_KEY=AIza...
```

**Note:** If `VITE_CLERK_PUBLISHABLE_KEY` is not set, the app runs without authentication (dev mode only — production will log an error).

Public business contact defaults are centralized in `src/lib/businessInfo.ts`. Admins can update the live website phone, email, and address from the admin dashboard under Settings → Contact settings.

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

## Key Files

- `src/main.tsx` - App entry with Clerk provider
- `src/contexts/AuthContext.tsx` - Authentication context
- `src/components/auth/` - Protected route components
- `src/lib/api.ts` - API client with auth token handling
- `src/pages/aire/` - Public marketing pages + kiosk
- `src/pages/admin/` - Admin dashboard pages
