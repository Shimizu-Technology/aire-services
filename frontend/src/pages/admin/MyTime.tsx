import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { useAuthContext } from '../../contexts/AuthContext'
import type { ClockStatus, TimeCategory, TimeEntry } from '../../lib/api'
import { myTimeApi } from '../../lib/api/myTime'
import { outcomeUnknown } from '../../lib/api/timecards'
import {
  chooseLastCategory,
  clockInRefusal,
  clockStatusLine,
  displayPeriodTotals,
  clockTime,
  needsClockOutConfirm,
  OFFLINE_CLOCK,
  OFFLINE_IDLE,
  periodTotals,
  requestLocation,
  stoppedAt,
  workedMilliseconds,
} from '../../lib/myTime'
import { formatElapsed } from '../../lib/formatElapsed'
import { guamClock, guamDate } from '../../lib/timecards'
import { currentPayPeriod } from '../../lib/payPeriods'
import { ADMIN_PATHS, timeSectionHref } from '../../lib/adminRoutes'
import { useCapabilities } from '../../lib/useCapabilities'
import { useOnlineStatus } from '../../lib/useOnlineStatus'
import { startVisibilityAwarePolling } from '../../lib/visibilityPolling'
import { WorkChips } from '../../components/clock/WorkChips'
import { ClockActions } from '../../components/clock/ClockActions'
import {
  Button,
  ErrorState,
  Field,
  Input,
  LiveTimer,
  PageHeader,
  Sheet,
  useToast,
} from '../../components/ui'

type Action = 'in' | 'out' | 'break' | 'resume' | 'switch'
type ClockSheet = 'location' | 'out' | 'switch' | 'override' | 'stopped'

const LOST_REPLY = "We couldn't confirm your last tap."

export default function MyTime() {
  const { currentUser } = useAuthContext()
  const viewerId = currentUser?.id
  // Supervisors clock their own time here too, with a schedule override.
  const supervisor = useCapabilities().manage_team_time
  const toast = useToast()
  const online = useOnlineStatus()
  const [status, setStatus] = useState<ClockStatus | null>(null)
  const [categories, setCategories] = useState<TimeCategory[]>([])
  const [categoryState, setCategoryState] = useState<
    'loading' | 'ready' | 'error'
  >('loading')
  const [statusError, setStatusError] = useState<string | null>(null)
  const [switchChoice, setSwitchChoice] = useState<number | null>(null)
  const [entries, setEntries] = useState<TimeEntry[]>([])
  const [summaryLoaded, setSummaryLoaded] = useState(false)
  const [choice, setChoice] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [mustRefresh, setMustRefresh] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [sheet, setSheet] = useState<ClockSheet | null>(null)
  // A supervisor's override waits here while the location sheet is open.
  const [pendingOverride, setPendingOverride] = useState(false)
  const [stopTime, setStopTime] = useState('')
  const [stopError, setStopError] = useState<string | null>(null)
  const [lastOut, setLastOut] = useState<TimeEntry | null>(null)
  // Serializes taps before React has had a chance to disable the controls.
  const inFlight = useRef(false)
  const statusGeneration = useRef(0)
  const summaryGeneration = useRef(0)
  const workChoiceTouched = useRef(false)
  const unconfirmed = useRef(false)
  const hasConfirmedStatus = useRef(false)
  // The last tap's reply was lost, so the recovered status is worth saying.
  const lostReply = useRef(false)
  const storageKey = `aire-last-work-${viewerId}`
  const period = currentPayPeriod()

  const refreshSummary = useCallback(async () => {
    if (!viewerId) return
    const generation = ++summaryGeneration.current
    const shifts = await myTimeApi.entries(viewerId, currentPayPeriod())
    if (generation !== summaryGeneration.current) return
    if (shifts.data) {
      setEntries(shifts.data)
      setSummaryLoaded(true)
    } else setSummaryLoaded(false)
  }, [viewerId])

  const readStatus = useCallback(async () => {
    const generation = ++statusGeneration.current
    const result = await myTimeApi.status()
    if (generation !== statusGeneration.current) return null
    if (!result.data) {
      if (!hasConfirmedStatus.current)
        setStatusError("Couldn't check your clock. Try again.")
      return null
    }
    hasConfirmedStatus.current = true
    setStatus(result.data)
    if (result.data.clocked_in && result.data.time_category) {
      workChoiceTouched.current = true
      setChoice(result.data.time_category.id)
    }
    setMustRefresh(false)
    setStatusError(null)
    if (unconfirmed.current) {
      void refreshSummary()
      window.dispatchEvent(new Event('aire:clock-action'))
    }
    unconfirmed.current = false
    return result.data
  }, [refreshSummary])

  const load = useCallback(() => {
    const summaryRequest = ++summaryGeneration.current
    let saved: number | null = null
    try {
      saved = Number(localStorage.getItem(storageKey)) || null
    } catch {
      /* Storage is optional. */
    }
    const categoryRead =
      supervisor && viewerId
        ? myTimeApi.ownCategories(viewerId)
        : myTimeApi.categories()
    void readStatus()
    void categoryRead.then((result) => {
      if (!result.data) {
        setCategoryState('error')
        return
      }
      const available = result.data.time_categories
      setCategories(available)
      setCategoryState('ready')
      if (!workChoiceTouched.current) {
        setChoice(chooseLastCategory(available, [], saved))
      }
    })
    if (!viewerId) return
    // This optional read can finish later without holding up clock actions.
    void myTimeApi
      .entries(viewerId, currentPayPeriod())
      .then(async (shifts) => {
        if (summaryRequest !== summaryGeneration.current || !shifts.data) return
        setEntries(shifts.data)
        setSummaryLoaded(true)
        const result = await categoryRead
        if (summaryRequest !== summaryGeneration.current) return
        if (result.data && !workChoiceTouched.current) {
          setChoice(
            chooseLastCategory(result.data.time_categories, shifts.data, saved),
          )
        }
      })
  }, [viewerId, storageKey, readStatus, supervisor])

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

  const markUnconfirmed = () => {
    unconfirmed.current = true
    setMustRefresh(true)
  }

  const retryCategories = async () => {
    setCategoryState('loading')
    const result =
      supervisor && viewerId
        ? await myTimeApi.ownCategories(viewerId)
        : await myTimeApi.categories()
    if (!result.data) {
      setCategoryState('error')
      return
    }
    const available = result.data.time_categories
    setCategories(available)
    setCategoryState('ready')
    let saved: number | null = null
    try {
      saved = Number(localStorage.getItem(storageKey)) || null
    } catch {
      /* Optional. */
    }
    setChoice((current) =>
      available.some((category) => category.id === current)
        ? current
        : chooseLastCategory(available, entries, saved),
    )
  }

  /** Resolves to the saved shift, or null when nothing was confirmed. */
  const punch = async (
    action: Action,
    { override = false }: { override?: boolean } = {},
  ): Promise<TimeEntry | null> => {
    if (inFlight.current || !online || mustRefresh) return null
    inFlight.current = true
    lostReply.current = false
    workChoiceTouched.current = true
    ++statusGeneration.current
    ++summaryGeneration.current
    setBusy(true)
    setError(null)
    setNotice(null)
    setSheet(null)
    let sent = false
    try {
      const location =
        action === 'in' && status?.clock_in_location_required
          ? await requestLocation()
          : undefined
      if (!navigator.onLine) {
        setError(
          action === 'in'
            ? OFFLINE_CLOCK
            : 'No connection. Nothing was sent. Reconnect and try again.',
        )
        return null
      }
      const categoryId = action === 'switch' ? switchChoice : choice
      sent = true
      const result =
        action === 'in'
          ? override
            ? await myTimeApi.clockIn(categoryId!, location, true)
            : await myTimeApi.clockIn(categoryId!, location)
          : action === 'out'
            ? await myTimeApi.clockOut()
            : action === 'break'
              ? await myTimeApi.startBreak()
              : action === 'resume'
                ? await myTimeApi.endBreak()
                : await myTimeApi.switchWork(categoryId!)
      if (!result.data) {
        if (outcomeUnknown(result)) {
          lostReply.current = true
          markUnconfirmed()
          const fresh = await readStatus()
          setNotice(
            fresh
              ? `${LOST_REPLY} ${clockStatusLine(fresh)}`
              : "We couldn't confirm what happened. Try again to check your status.",
          )
        } else {
          // A kiosk or another phone may have changed the clock since our read.
          // A real refusal is safe to retry once that status refresh finishes.
          const refusal = result.error || 'Nothing was saved. Try again.'
          setError(
            action === 'in'
              ? clockInRefusal(refusal, status?.clock_in_location_name)
              : refusal,
          )
          markUnconfirmed()
          await readStatus()
        }
        return null
      }
      if ((action === 'in' || action === 'switch') && categoryId) {
        setChoice(categoryId)
        try {
          localStorage.setItem(storageKey, String(categoryId))
        } catch {
          /* Optional. */
        }
      }
      if (action === 'out') setLastOut(result.data.time_entry)
      if (action === 'in') setLastOut(null)
      markUnconfirmed()
      const fresh = await readStatus()
      if (!fresh)
        setNotice(
          'Your action was saved. Try again to check your clock status.',
        )
      else if (action === 'switch')
        toast.show({
          message: `Switched to ${fresh.time_category?.name ?? 'your new work'}.`,
        })
      return result.data.time_entry
    } catch (failure) {
      if (sent) {
        lostReply.current = true
        markUnconfirmed()
        await readStatus()
      }
      setError(
        failure instanceof Error
          ? failure.message
          : 'Could not complete your action.',
      )
      return null
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  const clockIn = (override = false) => {
    let explained = false
    try {
      explained = localStorage.getItem('aire-location-explained') === 'true'
    } catch {
      /* Explain again. */
    }
    if (status?.clock_in_location_required && !explained) {
      setPendingOverride(override)
      setSheet('location')
    } else void punch('in', { override })
  }

  // "I stopped earlier…": clock out now, then send the real stop time as a
  // fix on that shift, the same request as Hours → the shift → Ask for a fix.
  const stopEarlier = async (event: FormEvent) => {
    event.preventDefault()
    const segmentStart = status?.clock_in_at
    const stop = segmentStart ? stoppedAt(segmentStart, stopTime) : null
    if (!segmentStart || !stop) {
      setStopError(
        segmentStart
          ? `Pick a time after you clocked in at ${clockTime(segmentStart)} and before now.`
          : 'Enter the time you stopped working.',
      )
      return
    }
    setStopError(null)
    const entry = await punch('out')
    if (!entry) return
    inFlight.current = true
    setBusy(true)
    const label = clockTime(stop)
    const fixed = await myTimeApi.askForFix(
      entry,
      {
        start_time: entry.start_time ?? '',
        end_time: guamClock(stop),
        break_minutes: entry.break_minutes ?? null,
        time_category_id: entry.time_category?.id ?? 0,
        description: entry.description ?? '',
      },
      `Stopped working at ${label} and forgot to clock out.`,
    )
    inFlight.current = false
    setBusy(false)
    if (fixed.data) {
      setLastOut(fixed.data.time_entry)
      void refreshSummary()
      toast.show({
        message: `Clocked out. Your fix to ${label} was sent for approval.`,
      })
    } else
      setError(
        outcomeUnknown(fixed)
          ? `You're clocked out, but we couldn't confirm your fix to ${label} was sent. Check My Hours before sending it again.`
          : `You're clocked out, but your fix to ${label} wasn't sent. ${fixed.error ?? ''} Open My Hours, tap the shift and choose Ask for a fix.`,
      )
  }
  const clockOut = () => {
    const since = status?.session?.original_clock_in_at ?? status?.clock_in_at
    if (since && needsClockOutConfirm(since)) setSheet('out')
    else void punch('out')
  }
  const blocked = busy || !online || mustRefresh
  const totals = displayPeriodTotals(entries, period)
  const since = status?.session?.original_clock_in_at ?? status?.clock_in_at
  const worked = status ? workedMilliseconds(status) : 0
  const longShift =
    !!since && (Date.now() - Date.parse(since)) / 3_600_000 > 12
  const blockedReason = status?.clock_in_blocked_reason
  const canOverride =
    !!status &&
    !status.clocked_in &&
    !status.can_clock_in &&
    !!status.can_override_clock &&
    (blockedReason === 'too_early' || blockedReason === 'shift_ended')
  const hoursHref = supervisor
    ? timeSectionHref('entries', { user_id: String(viewerId ?? '') })
    : ADMIN_PATHS.myHours
  const recordedBreak =
    !!status?.breaks.length ||
    entries.some(
      (entry) =>
        entry.breaks.length > 0 &&
        entry.clock_in_at &&
        since &&
        Date.parse(entry.clock_in_at) >= Date.parse(since),
    )
  const timerStart = status
    ? new Date(Date.now() - workedMilliseconds(status))
    : null
  const lastOutDate = lastOut?.clock_out_at
  const today = guamDate(lastOutDate ?? new Date())
  const todayHours = periodTotals(entries, { start: today, end: today }).total

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
          {OFFLINE_IDLE}
        </p>
      )}
      {statusError && (
        <p role="alert" className="text-body-sm text-danger">
          {statusError}
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
        <p
          role="status"
          className="rounded-card bg-sky-50 p-4 text-body-sm text-ink"
        >
          {notice}
        </p>
      )}
      {mustRefresh && (
        <Button
          variant="secondary"
          disabled={!online || busy}
          onClick={async () => {
            inFlight.current = true
            setBusy(true)
            const fresh = await readStatus()
            setNotice(
              !fresh
                ? "Couldn't check your status. Reconnect and try again."
                : lostReply.current
                  ? `${LOST_REPLY} ${clockStatusLine(fresh)}`
                  : null,
            )
            setBusy(false)
            inFlight.current = false
          }}
        >
          Try again
        </Button>
      )}
      {!status ? (
        statusError ? (
          <ErrorState title="Couldn't load your clock." onRetry={load} />
        ) : (
          <p role="status">Checking your clock…</p>
        )
      ) : mustRefresh ? (
        <>
          <section className="space-y-3 rounded-card border border-line bg-surface p-5">
            <h2 className="text-title font-semibold text-ink">
              Status not confirmed
            </h2>
            <p role="status">Checking your clock…</p>
          </section>
          <ClockActions>
            <Button fullWidth className="min-h-14" disabled loading={busy}>
              {status.clocked_in ? 'Clock out' : 'Clock in'}
            </Button>
          </ClockActions>
        </>
      ) : !status.time_tracking_enabled ? (
        <p>Clocking in isn't turned on for you. Ask Chels.</p>
      ) : (
        <>
          <section
            className={`space-y-5 rounded-card border p-5 ${status.active_break ? 'border-amber-300 bg-amber-50' : status.clocked_in ? 'border-emerald-200 bg-emerald-50' : 'border-line bg-surface'}`}
          >
            <h2 className="text-title font-semibold text-ink">
              {status.clocked_in
                ? `${status.active_break ? 'On break' : 'On the clock'} · ${status.time_category?.name ?? 'Work'}`
                : 'Off the clock'}
            </h2>
            {status.clocked_in && timerStart ? (
              <>
                <div>
                  <p
                    aria-hidden="true"
                    className={`text-body-sm font-semibold ${status.active_break ? 'text-amber-900' : 'text-emerald-900'}`}
                  >
                    {status.active_break ? 'On break' : 'Worked'}
                  </p>
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
                    className={`block text-5xl font-semibold tracking-tight ${status.active_break ? 'text-amber-950' : 'text-emerald-950'}`}
                  />
                </div>
                <p className="text-body-sm text-ink-muted">
                  {status.active_break && status.active_break_started_at
                    ? `Break started ${clockTime(status.active_break_started_at)} · on the clock since ${since ? clockTime(since) : '—'}`
                    : `Since ${since ? clockTime(since) : '—'} · ${
                        recordedBreak ||
                        (status.session?.total_break_minutes ??
                          status.break_minutes) > 0
                          ? `${status.session?.total_break_minutes ?? status.break_minutes}m of breaks`
                          : 'no breaks yet'
                      }`}
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
                          setSwitchChoice(status.time_category?.id ?? choice)
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
                    {currentUser?.first_name
                      ? `, ${currentUser.first_name}`
                      : ''}
                    ?
                  </p>
                )}
                {categoryState === 'error' && (
                  <div role="alert" className="space-y-2">
                    <p>Couldn't load your work types.</p>
                    <Button
                      variant="secondary"
                      onClick={() => void retryCategories()}
                    >
                      Try again
                    </Button>
                  </div>
                )}
                {categoryState === 'loading' && (
                  <p role="status">Loading your work types…</p>
                )}
                <WorkChips
                  categories={categories}
                  value={choice}
                  onChange={(id) => {
                    workChoiceTouched.current = true
                    setChoice(id)
                  }}
                  disabled={blocked}
                />
                {categoryState === 'ready' && categories.length === 0 && (
                  <p>
                    Ask Chels to set up your work types before you clock in.
                  </p>
                )}
                {!status.can_clock_in && categories.length > 0 && (
                  <p className="text-body-sm text-ink-muted">
                    {blockedReason === 'too_early'
                      ? canOverride
                        ? `Your shift starts in ${status.minutes_until ?? 'a few'} minutes.`
                        : `Your shift starts soon. Try again in ${status.minutes_until ?? 'a few'} minutes.`
                      : blockedReason === 'shift_ended' && canOverride
                        ? 'Your scheduled shift has ended.'
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
                blocked ||
                (!status.clocked_in &&
                  (categoryState !== 'ready' ||
                    !choice ||
                    !status.can_clock_in))
              }
              onClick={
                status.clocked_in
                  ? status.active_break
                    ? () => void punch('resume')
                    : clockOut
                  : () => clockIn()
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
            {canOverride && (
              <Button
                fullWidth
                variant="secondary"
                disabled={blocked || categoryState !== 'ready' || !choice}
                onClick={() => setSheet('override')}
              >
                Clock in anyway
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
        to={hoursHref}
        className="block space-y-2 rounded-card border border-line bg-surface p-5 text-body text-ink focus-visible:outline-2 focus-visible:outline-primary"
      >
        <p className="font-semibold">
          This pay period {summaryLoaded && `· ${totals.total.toFixed(1)}h`}
        </p>
        <p className="text-body-sm text-ink-muted">
          {summaryLoaded
            ? totals.complete ? `${totals.approved.toFixed(1)}h Approved for payroll · ${totals.timeWaiting.toFixed(1)}h Time waiting for approval · ${totals.overtimeWaiting.toFixed(1)}h Overtime waiting for approval` : 'Approval totals unavailable'
            : supervisor
              ? 'Open Timecards to check your time.'
              : 'Open My Hours to check your time.'}
        </p>
        <p className="font-semibold text-primary">
          {supervisor ? 'My hours in Timecards →' : 'My Hours →'}
        </p>
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
              void punch('in', { override: pendingOverride })
            }}
          >
            Share location and clock in
          </Button>
        }
      >
        <p>
          AIRE checks you're at the airport when you clock in. Your browser will
          ask to share your location. We only request it when you clock in.
        </p>
      </Sheet>
      <Sheet
        open={sheet === 'out'}
        onClose={() => setSheet(null)}
        title={`Clock out at ${clockTime(new Date())}?`}
        footer={
          <div className="space-y-2">
            <Button
              fullWidth
              disabled={blocked}
              onClick={() => void punch('out')}
            >
              Clock out
            </Button>
            {longShift && (
              <Button
                fullWidth
                variant="secondary"
                disabled={blocked}
                onClick={() => {
                  setStopTime('')
                  setStopError(null)
                  setSheet('stopped')
                }}
              >
                I stopped earlier…
              </Button>
            )}
            <Button fullWidth variant="ghost" onClick={() => setSheet(null)}>
              Keep working
            </Button>
          </div>
        }
      >
        <p>
          {worked < 60_000
            ? "You've worked less than a minute."
            : `Worked ${formatElapsed(worked, 'short')}.`}{' '}
          Check that this is when you stopped working.
        </p>
      </Sheet>
      <Sheet
        open={sheet === 'stopped'}
        onClose={() => setSheet(null)}
        title="When did you stop working?"
        description="We'll clock you out now and send this time to your manager as a fix."
        footer={
          <Button
            fullWidth
            type="submit"
            form="stopped-earlier"
            loading={busy}
            disabled={blocked}
          >
            Clock out and send fix
          </Button>
        }
      >
        <form
          id="stopped-earlier"
          noValidate
          onSubmit={(event) => void stopEarlier(event)}
          className="space-y-3"
        >
          <Field label="I stopped working at" required error={stopError}>
            <Input
              type="time"
              enterKeyHint="done"
              value={stopTime}
              onChange={(event) => setStopTime(event.target.value)}
            />
          </Field>
          {status?.clock_in_at && (
            <p className="text-body-sm text-ink-muted">
              You clocked in at {clockTime(status.clock_in_at)}.
            </p>
          )}
        </form>
      </Sheet>
      <Sheet
        open={sheet === 'override'}
        onClose={() => setSheet(null)}
        title="Clock in anyway?"
        footer={
          <div className="space-y-2">
            <Button
              fullWidth
              disabled={blocked}
              onClick={() => {
                setSheet(null)
                clockIn(true)
              }}
            >
              Clock in anyway
            </Button>
            <Button fullWidth variant="ghost" onClick={() => setSheet(null)}>
              Cancel
            </Button>
          </div>
        }
      >
        <p>
          {blockedReason === 'too_early'
            ? `Your shift hasn't started yet. It starts in ${status?.minutes_until ?? 'a few'} minutes.`
            : 'Your scheduled shift has already ended.'}{' '}
          As a supervisor you can still clock in. The time waits for approval
          like any other.
        </p>
      </Sheet>
      <Sheet
        open={sheet === 'switch'}
        onClose={() => setSheet(null)}
        title="Switch work"
        footer={
          <Button
            fullWidth
            disabled={
              blocked ||
              !switchChoice ||
              switchChoice === status?.time_category?.id
            }
            onClick={() => void punch('switch')}
          >
            Switch work
          </Button>
        }
      >
        <WorkChips
          categories={categories}
          value={switchChoice}
          onChange={setSwitchChoice}
          disabled={blocked}
        />
      </Sheet>
    </div>
  )
}
