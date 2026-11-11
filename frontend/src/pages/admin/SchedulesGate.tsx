import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { CalendarOff } from 'lucide-react'
import { buttonClasses } from '../../components/ui'
import { useCapabilities } from '../../lib/useCapabilities'
import { useSchedulesEnabled } from '../../lib/useSchedulesEnabled'

/** The Schedule page while "Use schedules" is off: a short note instead of an empty calendar. */
export default function SchedulesGate({ children }: { children: ReactNode }) {
  const schedulesEnabled = useSchedulesEnabled()
  const capabilities = useCapabilities()
  if (schedulesEnabled) return <>{children}</>

  return (
    <section aria-labelledby="schedules-off-title" className="mx-auto mt-6 max-w-lg rounded-card border border-line bg-surface p-6 text-center shadow-sm sm:p-8">
      <span className="mx-auto inline-flex size-12 items-center justify-center rounded-full bg-slate-100 text-ink-muted">
        <CalendarOff aria-hidden="true" className="size-6" strokeWidth={1.8} />
      </span>
      <h1 id="schedules-off-title" className="mt-4 text-title font-semibold text-ink">Schedules are turned off</h1>
      <p className="mt-2 text-body-sm text-ink-muted">
        AIRE isn’t planning shifts in the app right now, so there’s nothing to show here. Clocking in works as usual.
      </p>
      {capabilities.manage_settings ? (
        <Link to="/admin/settings#use-schedules" className={buttonClasses({ variant: 'secondary', className: 'mt-5' })}>
          Turn on schedules in Settings
        </Link>
      ) : (
        <p className="mt-3 text-body-sm text-ink-muted">An owner or admin can turn schedules on in Settings.</p>
      )}
    </section>
  )
}
