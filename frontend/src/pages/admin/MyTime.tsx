import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { useAuthContext } from '../../contexts/AuthContext'
import type { ClockStatus, TimeCategory, TimeEntry } from '../../lib/api'
import { myTimeApi } from '../../lib/api/myTime'
import { outcomeUnknown } from '../../lib/api/timecards'
import {
  chooseLastCategory,
  clockTime,
  needsClockOutConfirm,
  OFFLINE_CLOCK,
  periodTotals,
  requestLocation,
  workedMilliseconds,
} from '../../lib/myTime'
import { formatElapsed } from '../../lib/formatElapsed'
import { currentPayPeriod } from '../../lib/payPeriods'
import { useOnlineStatus } from '../../lib/useOnlineStatus'
import { startVisibilityAwarePolling } from '../../lib/visibilityPolling'
import { WorkChips } from '../../components/clock/WorkChips'
import { ClockActions } from '../../components/clock/ClockActions'
import { Button, ErrorState, LiveTimer, PageHeader, Sheet } from '../../components/ui'

type Action = 'in' | 'out' | 'break' | 'resume' | 'switch'

export default function MyTime() {
  const { currentUser } = useAuthContext()
  const viewerId = currentUser?.id
  const online = useOnlineStatus()
  const [status, setStatus] = useState<ClockStatus | null>(null)
  const [categories, setCategories] = useState<TimeCategory[]>([])
  const [entries, setEntries] = useState<TimeEntry[]>([])
  const [summaryLoaded, setSummaryLoaded] = useState(false)
  const [choice, setChoice] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [mustRefresh, setMustRefresh] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [sheet, setSheet] = useState<'location' | 'out' | 'switch' | null>(null)
  const [lastOut, setLastOut] = useState<TimeEntry | null>(null)
  // Serializes taps before React has had a chance to disable the controls.
  const inFlight = useRef(false)
  const storageKey = `aire-last-work-${viewerId}`
  const period = currentPayPeriod()

  const readStatus = useCallback(async () => {
    const result = await myTimeApi.status()
    if (!result.data) return null
    setStatus(result.data)
    setMustRefresh(false)
    return result.data
  }, [])

  const load = useCallback(async () => {
    const [result, categoryResult, shifts] = await Promise.all([
      myTimeApi.status(),
      myTimeApi.categories(),
      viewerId
        ? myTimeApi.entries(viewerId, currentPayPeriod())
        : Promise.resolve(null),
    ])
    if (result.data) setStatus(result.data)
    else setError(result.error || "Couldn't check your clock. Try again.")
    if (categoryResult.data) {
      const available = categoryResult.data.time_categories
      setCategories(available)
      let saved: number | null = null
      try {
        saved = Number(localStorage.getItem(storageKey)) || null
      } catch {
        /* Storage is optional. */
      }
      setChoice(chooseLastCategory(available, shifts?.data ?? [], saved))
    }
    if (shifts?.data) {
      setEntries(shifts.data)
      setSummaryLoaded(true)
    }
  }, [viewerId, storageKey])

  useEffect(() => {
    void load()
  }, [load])
  useEffect(
    () =>
      startVisibilityAwarePolling(async () => {
        if (!inFlight.current) await readStatus()
      }, 60_000),
    [readStatus],
  )

  const punch = async (action: Action) => {
    if (inFlight.current || !online || mustRefresh) return
    inFlight.current = true
    setBusy(true)
    setError(null)
    setNotice(null)
    setSheet(null)
    try {
      const location =
        action === 'in' && status?.clock_in_location_required
          ? await requestLocation()
          : undefined
      // Going offline during the location prompt must not send a queued punch.
      if (!navigator.onLine) {
        setError(
          action === 'in'
            ? OFFLINE_CLOCK
            : 'No connection. Nothing was sent. Reconnect and try again.',
        )
        return
      }
      const result =
        action === 'in'
          ? await myTimeApi.clockIn(choice!, location)
          : action === 'out'
            ? await myTimeApi.clockOut()
            : action === 'break'
              ? await myTimeApi.startBreak()
              : action === 'resume'
                ? await myTimeApi.endBreak()
                : await myTimeApi.switchWork(choice!)
      if (!result.data) {
        if (outcomeUnknown(result)) {
          setMustRefresh(true)
          const fresh = await readStatus()
          setNotice(
            fresh
              ? `The reply was lost. The server says: ${fresh.clocked_in ? (fresh.active_break ? 'On break' : 'On the clock') : 'Off the clock'}. Check this status before your next action.`
              : "We couldn't confirm what happened. Check your clock status before trying again.",
          )
        } else {
          setError(result.error || 'Nothing was saved. Try again.')
        }
        return
      }
      if ((action === 'in' || action === 'switch') && choice) {
        try {
          localStorage.setItem(storageKey, String(choice))
        } catch {
          /* Optional. */
        }
      }
      if (action === 'out') setLastOut(result.data.time_entry)
      if (action === 'in') setLastOut(null)
      // A successful write is followed by the authoritative status read. If
      // that read fails, keep all punches locked until status is known.
      setMustRefresh(true)
      const fresh = await readStatus()
      if (!fresh)
        setNotice('Your action was saved. Check your clock status to continue.')
      if (viewerId) {
        const shifts = await myTimeApi.entries(viewerId, currentPayPeriod())
        if (shifts.data) setEntries(shifts.data)
        else setSummaryLoaded(false)
      }
      window.dispatchEvent(new Event('aire:clock-action'))
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : 'Could not complete your action.',
      )
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  const clockIn = () => {
    let explained = false
    try {
      explained = localStorage.getItem('aire-location-explained') === 'true'
    } catch {
      /* Explain again. */
    }
    if (status?.clock_in_location_required && !explained) setSheet('location')
    else void punch('in')
  }
  const clockOut = () => {
    const since = status?.session?.original_clock_in_at ?? status?.clock_in_at
    if (since && needsClockOutConfirm(since)) setSheet('out')
    else void punch('out')
  }
  const blocked = busy || !online || mustRefresh
  const totals = periodTotals(entries, period)
  const since = status?.session?.original_clock_in_at ?? status?.clock_in_at
  const recordedBreak =
    !!status?.breaks.length ||
    entries.some(
      (entry) =>
        entry.breaks.length > 0 &&
        entry.clock_in_at &&
        since &&
        Date.parse(entry.clock_in_at) >= Date.parse(since),
    )
  const timerStart = status ? new Date(Date.now() - workedMilliseconds(status)) : null
  const lastOutDate = lastOut?.clock_out_at
  const todayHours = entries
    .filter((entry) => entry.work_date === lastOut?.work_date)
    .reduce((sum, entry) => sum + entry.hours, 0)

  return (
    <div className="mx-auto max-w-2xl space-y-5 pb-32 lg:pb-0">
      <PageHeader title="Clock" />
      <p className="text-body-sm text-ink-muted">
        {new Intl.DateTimeFormat('en-US', {
          timeZone: 'Pacific/Guam',
          weekday: 'long',
          month: 'long',
          day: 'numeric',
        }).format(new Date())}
      </p>
      {!online && (
        <p
          role="status"
          className="rounded-card bg-amber-50 p-4 text-body-sm text-amber-900"
        >
          {OFFLINE_CLOCK}
        </p>
      )}
      {error && (
        <p
          role="alert"
          className="rounded-card bg-danger-soft p-4 text-body-sm text-danger"
        >
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="rounded-card bg-sky-50 p-4 text-body-sm text-ink">
          {notice}
        </p>
      )}
      {mustRefresh && (
        <Button
          variant="secondary"
          disabled={!online || busy}
          onClick={async () => {
            setBusy(true)
            const fresh = await readStatus()
            setNotice(
              fresh
                ? `The server says: ${fresh.clocked_in ? (fresh.active_break ? 'On break' : 'On the clock') : 'Off the clock'}.`
                : "Couldn't check your status. Reconnect and try again.",
            )
            setBusy(false)
          }}
        >
          Check clock status
        </Button>
      )}
      {!status ? (
        error ? (
          <ErrorState title="Couldn't load your clock." onRetry={load} />
        ) : (
          <p role="status">Checking your clock…</p>
        )
      ) : !status.time_tracking_enabled ? (
        <p>Clocking in isn't turned on for you. Ask Chels.</p>
      ) : (
        <>
          <section
            className={`space-y-5 rounded-card border p-5 ${status.clocked_in ? 'border-emerald-200 bg-emerald-50' : 'border-line bg-surface'}`}
          >
            <h2 className="text-title font-semibold text-ink">
              {status.clocked_in
                ? `${status.active_break ? 'On break' : 'On the clock'} · ${status.time_category?.name ?? 'Work'}`
                : 'Off the clock'}
            </h2>
            {status.clocked_in && timerStart ? (
              <>
                <LiveTimer
                  key={`${status.entry_id}:${status.active_break}`}
                  since={
                    status.active_break_started_at && status.active_break
                      ? status.active_break_started_at
                      : timerStart
                  }
                  label={
                    status.active_break
                      ? 'Time on break'
                      : `On the clock since ${since ? clockTime(since) : ''}`
                  }
                  className="block text-5xl font-semibold tracking-tight text-emerald-950"
                />
                <p className="text-body-sm text-ink-muted">
                  Since {since ? clockTime(since) : '—'} ·{' '}
                  {recordedBreak ||
                  (status.session?.total_break_minutes ?? status.break_minutes) > 0
                    ? `${status.session?.total_break_minutes ?? status.break_minutes}m of breaks`
                    : status.active_break
                      ? 'break in progress'
                      : 'no breaks yet'}
                </p>
                {!status.active_break && (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="secondary"
                      disabled={blocked}
                      onClick={() => void punch('break')}
                    >
                      Start break
                    </Button>
                    {categories.length > 1 && (
                      <Button
                        variant="secondary"
                        disabled={blocked}
                        onClick={() => {
                          setChoice(null)
                          setSheet('switch')
                        }}
                      >
                        Switch work
                      </Button>
                    )}
                  </div>
                )}
              </>
            ) : (
              <>
                {lastOutDate ? (
                  <p role="status" className="text-body text-ink">
                    Clocked out at {clockTime(lastOutDate)} ·{' '}
                    {formatElapsed(todayHours * 3_600_000, 'short')} today ·{' '}
                    {lastOut?.approval_status === 'approved'
                      ? 'approved'
                      : 'waiting for approval'}
                  </p>
                ) : (
                  <p className="text-body text-ink-muted">
                    Ready to start
                    {currentUser?.first_name ? `, ${currentUser.first_name}` : ''}?
                  </p>
                )}
                <WorkChips
                  categories={categories}
                  value={choice}
                  onChange={setChoice}
                  disabled={blocked}
                />
                {categories.length === 0 && (
                  <p>Ask Chels to set up your work types before you clock in.</p>
                )}
                {!status.can_clock_in && categories.length > 0 && (
                  <p className="text-body-sm text-ink-muted">
                    {status.clock_in_blocked_reason === 'too_early'
                      ? `Your shift starts soon. Try again in ${status.minutes_until ?? 'a few'} minutes.`
                      : 'You cannot clock in right now. Ask Chels to check your schedule or access.'}
                  </p>
                )}
              </>
            )}
          </section>
          <ClockActions>
            <Button
              fullWidth
              variant={lastOut && !status.clocked_in ? 'secondary' : 'primary'}
              className="min-h-14"
              loading={busy}
              icon={<Loader2 className="invisible size-4" />}
              disabled={
                blocked || (!status.clocked_in && (!choice || !status.can_clock_in))
              }
              onClick={
                status.clocked_in
                  ? status.active_break
                    ? () => void punch('resume')
                    : clockOut
                  : clockIn
              }
            >
              {status.clocked_in
                ? status.active_break
                  ? 'End break'
                  : 'Clock out'
                : lastOut
                  ? 'Clock in again'
                  : 'Clock in'}
            </Button>
            {status.active_break && (
              <Button
                fullWidth
                variant="secondary"
                disabled={blocked}
                onClick={clockOut}
              >
                Clock out
              </Button>
            )}
            {!status.clocked_in && status.clock_in_location_required && (
              <p className="text-center text-caption text-ink-muted">
                AIRE checks you're at the airport when you clock in
              </p>
            )}
          </ClockActions>
        </>
      )}
      <Link
        to="/admin/my-hours"
        className="block space-y-2 rounded-card border border-line bg-surface p-5 text-body text-ink focus-visible:outline-2 focus-visible:outline-primary"
      >
        <p className="font-semibold">
          This pay period {summaryLoaded && `· ${totals.total.toFixed(1)}h`}
        </p>
        <p className="text-body-sm text-ink-muted">
          {summaryLoaded
            ? `${totals.approved.toFixed(1)}h approved · ${totals.waiting.toFixed(1)}h waiting for approval`
            : 'Open My Hours to check your time.'}
        </p>
        <p className="font-semibold text-primary">My Hours →</p>
      </Link>
      <Sheet
        open={sheet === 'location'}
        onClose={() => setSheet(null)}
        title="Your location at clock-in"
        footer={
          <Button
            fullWidth
            onClick={() => {
              try {
                localStorage.setItem('aire-location-explained', 'true')
              } catch {
                /* Optional. */
              }
              void punch('in')
            }}
          >
            Continue to location
          </Button>
        }
      >
        <p>
          AIRE checks you're at the airport when you clock in. Your browser will ask to
          share your location. We only request it when you clock in.
        </p>
      </Sheet>
      <Sheet
        open={sheet === 'out'}
        onClose={() => setSheet(null)}
        title={`Clock out at ${clockTime(new Date())}?`}
        footer={
          <Button fullWidth disabled={blocked} onClick={() => void punch('out')}>
            Clock out
          </Button>
        }
      >
        <p>
          Worked {status ? formatElapsed(workedMilliseconds(status), 'short') : '—'}.
          Check that this is when you stopped working.
        </p>
      </Sheet>
      <Sheet
        open={sheet === 'switch'}
        onClose={() => setSheet(null)}
        title="Switch work"
        footer={
          <Button
            fullWidth
            disabled={blocked || !choice || choice === status?.time_category?.id}
            onClick={() => void punch('switch')}
          >
            Switch work
          </Button>
        }
      >
        <WorkChips
          categories={categories}
          value={choice}
          onChange={setChoice}
          disabled={blocked}
        />
      </Sheet>
    </div>
  )
}
