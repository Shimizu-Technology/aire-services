import type { ReactNode } from 'react'

// On short screens (a phone at 200% zoom) the panel joins the page instead
// of floating over the work choices.
export function ClockActions({ children, inline = false, kiosk = false }: { children: ReactNode; inline?: boolean; kiosk?: boolean }) {
  return (
    <div className={kiosk ? "fixed inset-x-4 bottom-0 z-(--z-sticky) mx-auto max-w-2xl space-y-3 rounded-t-2xl border border-slate-700 bg-slate-950 p-3 pb-[calc(.75rem+env(safe-area-inset-bottom,0px))] shadow-raised lg:static lg:max-w-none lg:rounded-2xl" : inline ? "space-y-3" : "fixed inset-x-4 bottom-[calc(3.75rem+env(safe-area-inset-bottom,0px))] z-(--z-sticky) mx-auto max-w-2xl space-y-2 rounded-card border border-line bg-surface p-3 shadow-raised lg:static lg:max-w-none [@media(max-height:500px)]:static [@media(max-height:500px)]:shadow-none"}>
      {children}
    </div>
  )
}
