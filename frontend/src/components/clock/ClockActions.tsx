import type { ReactNode } from 'react'

export function ClockActions({ children, inline = false }: { children: ReactNode; inline?: boolean }) {
  return (
    <div className={inline ? "space-y-3" : "fixed inset-x-4 bottom-[calc(3.75rem+env(safe-area-inset-bottom,0px))] z-(--z-sticky) mx-auto max-w-2xl space-y-2 rounded-card border border-line bg-surface p-3 shadow-raised lg:static lg:max-w-none"}>
      {children}
    </div>
  )
}
