# AIRE Ops Web — AGENTS.md

## Project
AIRE Services Ops frontend (React + TypeScript + Tailwind). Forked from cornerstone-tax frontend.

## Tech Stack
- React 19, TypeScript, Tailwind v4, Vite
- Clerk auth (for manager/admin roles)
- Deployed on Netlify
- Singapore region preferred

## Key Features (Phase 1 MVP)
- **iPad PIN kiosk** — shared device clock in/out (no Clerk login, static API token + bcrypt PIN)
- **Employee dashboard** — view own shifts, time entries, schedule
- **Manager dashboard** — approve time entries, manage schedules, who's working
- **Payroll admin** — export CSV, lock pay periods, audit log

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
  components/        # Shared UI components
  pages/
    kiosk/           # iPad PIN kiosk screens (no auth)
    employee/        # Employee-facing views
    manager/         # Manager views (Clerk-protected)
    admin/           # Payroll admin views (Clerk-protected)
    public/          # Public marketing pages (TODO: replace with AIRE website)
  hooks/
  lib/
  types/
```

## Ticket Prefix: AIR

## What Was Kept from Cornerstone
- Time entry components and hooks
- Schedule/calendar views
- User management
- Clerk auth integration
- Dashboard layout

## What Needs to Be Built (New for AIRE)
- `/kiosk` — PIN-based clock in/out (no Clerk)
- iPad PWA manifest + Safari Guided Access setup
- AIRE-specific branding/colors throughout

## What to Remove (Phase 2)
- Tax return / client portal pages
- Intake form components
- Billing/invoice UI
- Cornerstone-specific public pages (About, Home → replace with AIRE versions)
