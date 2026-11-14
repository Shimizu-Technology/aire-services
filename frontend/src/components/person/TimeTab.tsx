import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { AdminUser, TimeCategory } from '../../lib/api'
import { timecardsApi } from '../../lib/api/timecards'
import { linkedId, linkedTimePeriod } from '../../lib/employeeWorkspace'
import { currentPayPeriod, formatPayPeriod, payPeriodContaining, type PayPeriod } from '../../lib/payPeriods'
import { formatHours } from '../../lib/timecards'
import { LogMissedTimeSheet, type MissedTimePerson } from '../timecards/LogMissedTimeSheet'
import { TimecardView } from '../timecards/TimecardView'
import { ErrorState, useToast } from '../ui'
import { departments, firstName, personName } from './personFormat'

// Links into the Time tab that only mean something on arrival.
const ARRIVAL_PARAMS = ['entry', 'start_date', 'end_date', 'range', 'cursor', 'detail_cursor']

interface TimeTabProps {
  user: AdminUser
  today: string
}

type LinkCheck = { entryId: number; period: PayPeriod | null; note: string | null }

/**
 * The person's timecard (the Timecards person view). The URL holds the pay
 * period. A linked shift (`?entry=`, as Cornerstone Payroll's evidence link
 * sends it) is highlighted and scrolled to, on its own period when the link
 * doesn't name one.
 */
export function TimeTab({ user, today }: TimeTabProps) {
  const [searchParams, setSearchParams] = useSearchParams()
  const toast = useToast()
  const entryId = linkedId(searchParams.get('entry'))
  const asked = linkedTimePeriod(searchParams)
  const [check, setCheck] = useState<LinkCheck | null>(null)
  const linkCheck = entryId && check?.entryId === entryId ? check : null
  // Until the linked shift's period is known, a link without a period waits for it.
  const resolving = Boolean(entryId && !asked && !linkCheck)
  const period = useMemo(
    () => asked ?? linkCheck?.period ?? currentPayPeriod(),
    // Rebuild only when the dates change, so the timecard doesn't reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [asked?.start, linkCheck?.period?.start],
  )

  const [categories, setCategories] = useState<TimeCategory[] | null>(null)
  const [categoriesError, setCategoriesError] = useState<string | null>(null)
  const [categoriesRetry, setCategoriesRetry] = useState(0)
  const [lockAt, setLockAt] = useState<{ start: string; at: string } | null>(null)
  const [logOpen, setLogOpen] = useState(false)
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    let cancelled = false
    void timecardsApi.categories().then((response) => {
      if (cancelled) return
      if (response.data) { setCategories(response.data.time_categories); setCategoriesError(null) } else setCategoriesError(response.error ?? 'Unknown error')
    })
    return () => { cancelled = true }
  }, [categoriesRetry])

  useEffect(() => {
    let cancelled = false
    void timecardsApi.cutoff().then((response) => {
      const cutoff = response.data?.cutoff
      if (!cancelled && cutoff?.period && cutoff.cutoff_at) setLockAt({ start: cutoff.period.start_date, at: cutoff.cutoff_at })
    })
    return () => { cancelled = true }
  }, [])

  // Check the linked shift: whose it is and which period it's in.
  useEffect(() => {
    if (!entryId) return
    let cancelled = false
    void timecardsApi.entry(entryId).then((response) => {
      if (cancelled) return
      const entry = response.data?.time_entry
      if (!entry) {
        setCheck({ entryId, period: null, note: "We couldn't open the linked shift. It may have been deleted." })
      } else if (entry.user.id !== user.id) {
        setCheck({ entryId, period: null, note: "The linked shift belongs to someone else, so it isn't on this timecard." })
      } else {
        const own = payPeriodContaining(entry.work_date)
        setCheck({ entryId, period: own, note: null })
      }
    })
    return () => { cancelled = true }
  }, [entryId, user.id])

  const changePeriod = useCallback((next: PayPeriod) => setSearchParams((current) => {
    const params = new URLSearchParams(current)
    ARRIVAL_PARAMS.forEach(key => params.delete(key))
    params.set('period', next.start)
    return params
  }), [setSearchParams])

  const name = personName(user)
  const first = firstName(user)
  const person = {
    id: user.id,
    name,
    firstName: first,
    meta: departments(user) || undefined,
    employmentStatus: user.employment_status,
    terminationEffectiveOn: user.termination_effective_on,
  }
  const missedTimePerson: MissedTimePerson = { id: user.id, name, firstName: first, meta: person.meta, timeCategoryIds: user.time_category_ids ?? [] }
  const categoriesBlocked = categoriesError
    ? "Work categories didn't load. Try again above the timecard."
    : categories === null ? 'Loading work categories…' : null
  const lock = lockAt && lockAt.start === period.start ? lockAt.at : null
  // The linked shift sits in another period than the one the link asked for.
  const elsewhere = linkCheck?.period && asked && linkCheck.period.start !== asked.start ? linkCheck.period : null

  if (!user.time_tracking_enabled) {
    return <p className="rounded-card border border-line bg-surface px-4 py-3 text-body-sm text-ink-muted">{first} doesn't track time, so there's no timecard.</p>
  }

  return (
    <div className="space-y-4">
      {categoriesError && (
        <ErrorState
          title="Couldn't load work categories."
          description="The timecard still shows; fixing a clock-out or logging time waits for them."
          onRetry={() => setCategoriesRetry(value => value + 1)}
        />
      )}
      {linkCheck?.note && <p role="status" className="rounded-card border border-line bg-surface-muted px-4 py-3 text-body-sm text-ink">{linkCheck.note}</p>}
      {elsewhere && (
        <p role="status" className="rounded-card border border-line bg-surface-muted px-4 py-3 text-body-sm text-ink">
          The linked shift is in {formatPayPeriod(elsewhere)}.{' '}
          <button
            type="button"
            onClick={() => setSearchParams((current) => { const params = new URLSearchParams(current); params.set('period', elsewhere.start); return params })}
            className="font-semibold text-primary underline"
          >
            Show {formatPayPeriod(elsewhere)}
          </button>
        </p>
      )}
      {resolving ? (
        <p role="status" aria-busy="true" className="rounded-card border border-line bg-surface px-4 py-3 text-body-sm text-ink-muted">Finding the linked shift…</p>
      ) : (
        <TimecardView
          key={user.id}
          person={person}
          period={period}
          onPeriodChange={changePeriod}
          categories={categories ?? []}
          blockedReason={categoriesBlocked}
          logMissedTimeBlockedReason={categoriesBlocked}
          pauseRefresh={logOpen}
          focusEntryId={linkCheck?.note ? null : entryId}
          lockAt={lock}
          refreshKey={revision}
          onLogMissedTime={() => setLogOpen(true)}
          hidePerson
          today={today}
        />
      )}
      <LogMissedTimeSheet
        open={logOpen}
        onClose={() => setLogOpen(false)}
        people={[missedTimePerson]}
        categories={categories ?? []}
        prefill={{ personId: user.id }}
        today={today}
        onSaved={(who, hours) => {
          setLogOpen(false)
          toast.show({ message: `Added ${formatHours(hours)} for ${who.firstName}. It's waiting in Approvals.` })
          setRevision(value => value + 1)
        }}
        onUncertain={() => setRevision(value => value + 1)}
        blockedReason={categoriesBlocked}
      />
    </div>
  )
}
