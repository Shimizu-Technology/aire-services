# AIRE Ops Web — AGENTS.md

## Project
AIRE Services Ops frontend (React + TypeScript + Tailwind).

## Tech Stack
- React 19, TypeScript, Tailwind v4, Vite
- Clerk auth (for manager/admin roles)
- Deployed on Netlify

## Key Features (Phase 1 MVP)
- **iPad PIN kiosk** — shared device clock in/out (no Clerk login, kiosk token + bcrypt PIN)
- **Employee dashboard** — view own shifts, time entries, schedule
- **Manager dashboard** — approve time entries, manage schedules, who's working
- **Payroll admin** — export CSV, lock pay periods

## Color Palette (AIRE Brand Direction)
- Navy blue primary (`#1e3a5f`) — aviation / professional
- White / light gray backgrounds
- Clean, modern, community-forward feel
- No emojis in UI — SVGs only (lucide-react preferred)

## Important Rules
- **No emojis in UI** — use SVGs/icons only
- **Tailwind v4** — use new syntax
- **No tables in mobile views** — use card lists

## Repo Structure
```
src/
  components/
    auth/              # ProtectedRoute, ClerkProtectedContent
    layouts/           # PublicLayout, AdminLayout, Header, Footer
    time-tracking/     # WhosWorking, ClockInOutCard, ApprovalQueue
    ui/                # Skeleton, FadeIn, MotionComponents
  contexts/            # AuthContext
  lib/                 # api.ts, dateUtils.ts
  pages/
    aire/              # Public marketing pages + Kiosk
    admin/             # Dashboard, TimeTracking, Schedule, Users
  providers/           # PostHogProvider
  test/                # Vitest setup
```

## Ticket Prefix: AIR

## What Was Kept from Cornerstone
- Time entry components and hooks
- Schedule/calendar views
- User management
- Clerk auth integration
- Dashboard layout
