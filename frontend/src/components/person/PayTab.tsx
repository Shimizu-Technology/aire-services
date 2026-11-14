import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ChevronDown, Send } from 'lucide-react'
import { api, type AdminUser } from '../../lib/api'
import { peopleApi, type PayPeriodState } from '../../lib/api/people'
import { employeeEvidenceApi, type EmployeeEvidence, type EvidencePeriod } from '../../lib/employeeEvidenceApi'
import { formatPayPeriod } from '../../lib/payPeriods'
import { HANDOFF_STATE_LABELS, PERSON_TOTAL_LABELS, isLockedState, showsNotMatched } from '../../lib/payrollTerms'
import { payStubsApi, type PayStubDate } from '../../lib/payStubsApi'
import { formatHours } from '../../lib/timecards'
import { monthDay } from '../today/format'
import { Button, EmptyState, ErrorState, StatusPill, Switch } from '../ui'
import { Skeleton } from '../ui/Skeleton'
import { PeriodEvidence } from './PeriodEvidence'
import { firstName } from './personFormat'

type Loadable<T> = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; value: T }

const PERIOD_PAGE = '12'
const RECENT_PAYCHECKS = 6

interface PayTabProps {
  user: AdminUser
  today: string
  /** Null while unknown; true when "On for everyone" is on. */
  myPayForEveryone: boolean | null
  /** Owners and admins (manage_my_pay_access). */
  canManageMyPay: boolean
  /** Shows "Preview their My Pay" (owners and admins on the preview allowlist). */
  previewHref: string | null
  onSendStub?: () => void
  onUserChange: (user: AdminUser) => void
}

interface PeriodRow {
  evidence: EvidencePeriod
  state: PayPeriodState | null
}

/** "Open", "Paid Nov 10", or nothing for a past period AIRE has no state for. */
function stateText(row: PeriodRow, today: string) {
  const state = row.state
  if (!state) return row.evidence.end_date >= today ? HANDOFF_STATE_LABELS.open : null
  if (state.handoff_state === 'paid') return `${HANDOFF_STATE_LABELS.paid} ${monthDay(state.pay_date)}`
  // Periods from before scheduled locking only say whether AIRE froze them.
  if (state.handoff_state === 'before_locking') return state.status === 'finalized' ? HANDOFF_STATE_LABELS.locked : null
  return HANDOFF_STATE_LABELS[state.handoff_state]
}

function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={title}>
      <div className="mb-2 flex min-h-11 items-center justify-between gap-3">
        <h2 className="text-body font-semibold text-ink">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}

const card = 'rounded-card border border-line bg-surface'

/** My Pay, paychecks and pay periods for one person, in the glossary's words. */
export function PayTab({ user, today, myPayForEveryone, canManageMyPay, previewHref, onSendStub, onUserChange }: PayTabProps) {
  const [searchParams] = useSearchParams()
  const first = firstName(user)
  const [saving, setSaving] = useState(false)
  const [myPayError, setMyPayError] = useState<string | null>(null)
  const [paychecks, setPaychecks] = useState<Loadable<PayStubDate[]>>({ status: 'loading' })
  const [evidence, setEvidence] = useState<Loadable<{ identity: Pick<EmployeeEvidence, 'employee' | 'integration'>; periods: EvidencePeriod[]; next: string | null }>>({ status: 'loading' })
  const [states, setStates] = useState<{ periods: PayPeriodState[] | null; error: string | null }>({ periods: null, error: null })
  const [cursor, setCursor] = useState('')
  const [loadingMore, setLoadingMore] = useState(false)
  const [retry, setRetry] = useState({ paychecks: 0, periods: 0 })
  // A link naming a period (?tab=pay&period=…) opens its technical details.
  const linkedPeriod = searchParams.get('period')
  const linkedEntry = searchParams.get('entry')
  const [open, setOpen] = useState<Set<string>>(() => new Set(linkedPeriod ? [linkedPeriod] : []))
  const sourceUserUuid = searchParams.get('source_user_uuid') || ''
  const sourceInstanceId = searchParams.get('source_instance_id') || ''

  useEffect(() => {
    if (!onSendStub) return
    const controller = new AbortController()
    setPaychecks({ status: 'loading' })
    payStubsApi.statements(user.id, controller.signal)
      .then((result) => setPaychecks({ status: 'ready', value: result.statements }))
      .catch((reason) => { if (!controller.signal.aborted) setPaychecks({ status: 'error', message: reason instanceof Error ? reason.message : "Couldn't load paychecks." }) })
    return () => controller.abort()
  }, [user.id, onSendStub, retry.paychecks])

  useEffect(() => {
    let cancelled = false
    void peopleApi.payPeriods().then((response) => {
      if (!cancelled) setStates(response.data ? { periods: response.data.periods, error: null } : { periods: null, error: response.error ?? "Couldn't load pay period status." })
    })
    return () => { cancelled = true }
  }, [retry.periods])

  useEffect(() => {
    const controller = new AbortController()
    if (!cursor) setEvidence({ status: 'loading' })
    const filter = new URLSearchParams({ per_page: PERIOD_PAGE })
    if (cursor) filter.set('cursor', cursor)
    employeeEvidenceApi.periods(String(user.id), filter, controller.signal).then((result) => {
      if (result.employee.id !== String(user.id)) throw new Error('Employee evidence identity does not match this record.')
      if ((sourceUserUuid && result.employee.payroll_integration_id !== sourceUserUuid) || (sourceInstanceId && result.integration.source_instance_id !== sourceInstanceId)) {
        throw new Error('This saved employee link no longer matches the source installation or employee. Return to payroll and refresh the connection evidence.')
      }
      setEvidence((previous) => ({
        status: 'ready',
        value: {
          identity: { employee: result.employee, integration: result.integration },
          periods: cursor && previous.status === 'ready' ? [...previous.value.periods, ...result.periods] : result.periods,
          next: result.pagination.next_cursor,
        },
      }))
    }).catch((reason) => { if (!controller.signal.aborted) setEvidence({ status: 'error', message: reason instanceof Error ? reason.message : "Couldn't load pay periods." }) })
      .finally(() => { if (!controller.signal.aborted) setLoadingMore(false) })
    return () => controller.abort()
  }, [user.id, cursor, sourceUserUuid, sourceInstanceId, retry.periods])

  const rows: PeriodRow[] = useMemo(() => {
    if (evidence.status !== 'ready') return []
    const byStart = new Map((states.periods ?? []).map(period => [period.start_date, period]))
    return evidence.value.periods.map(period => ({ evidence: period, state: byStart.get(period.start_date) ?? null }))
  }, [evidence, states.periods])

  const toggleMyPay = async (enabled: boolean) => {
    setSaving(true)
    setMyPayError(null)
    const response = await api.setUserMyPay(user.id, enabled)
    setSaving(false)
    if (response.data) onUserChange({ ...user, my_pay_enabled: response.data.my_pay_enabled })
    else setMyPayError(response.error || `My Pay wasn't changed for ${first}. Try again.`)
  }

  const toggleDetails = (id: string) => setOpen((previous) => {
    const next = new Set(previous)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  const shiftHref = (period: EvidencePeriod) => (entryId: string) => `?${new URLSearchParams({ tab: 'time', period: period.start_date, entry: entryId })}`
  const sortedPaychecks = paychecks.status === 'ready'
    ? [...paychecks.value].sort((a, b) => (b.pay_date ?? '').localeCompare(a.pay_date ?? '')).slice(0, RECENT_PAYCHECKS)
    : []

  return (
    <div className="max-w-[55rem] space-y-6">
      {canManageMyPay && (
        <Section title="My Pay">
          <div className={`${card} px-4 py-2`}>
            {myPayForEveryone ? (
              <p className="py-2 text-body-sm text-ink">My Pay is on for everyone, so {first} can see their own paychecks. Change it on Team.</p>
            ) : (
              <Switch
                label="My Pay"
                description={user.my_pay_enabled ? `${first} sees their own paychecks.` : `${first} can't see paychecks in AIRE.`}
                checked={Boolean(user.my_pay_enabled)}
                onChange={(checked) => void toggleMyPay(checked)}
                busy={saving}
                disabled={!user.is_active || myPayForEveryone === null}
              />
            )}
          </div>
          {myPayError && <p role="alert" className="mt-2 text-body-sm text-danger">{myPayError}</p>}
        </Section>
      )}

      {onSendStub && (
        <Section
          title="Paychecks"
          action={(
            <div className="flex items-center gap-1">
              {previewHref && <Link to={previewHref} className="inline-flex min-h-11 items-center px-2 text-body-sm font-semibold text-primary hover:underline">Preview their My Pay</Link>}
              <Button variant="secondary" size="sm" icon={<Send className="size-4" />} onClick={onSendStub}>Send stub</Button>
            </div>
          )}
        >
          {paychecks.status === 'loading' ? (
            <Skeleton height={96} className="w-full" />
          ) : paychecks.status === 'error' ? (
            <ErrorState title="Couldn't load paychecks." description={paychecks.message} onRetry={() => setRetry(value => ({ ...value, paychecks: value.paychecks + 1 }))} />
          ) : sortedPaychecks.length === 0 ? (
            <EmptyState title="No paychecks yet." description={`Cornerstone Payroll hasn't sent any pay dates for ${first}.`} />
          ) : (
            <ul className={`${card} divide-y divide-line text-body-sm`}>
              {sortedPaychecks.map(stub => (
                <li key={stub.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <span className="font-semibold text-ink">{stub.pay_date ? `Paid ${monthDay(stub.pay_date)}` : 'Pay date not recorded'}</span>
                  <span className="text-right text-ink-muted">
                    {stub.period_start && stub.period_end ? formatPayPeriod({ start: stub.period_start, end: stub.period_end }) : ''}
                    {stub.voided && <StatusPill tone="off" className="ml-2">Voided</StatusPill>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}

      <Section title="Pay periods">
        {states.error && (
          <p role="status" className="mb-2 text-body-sm text-ink-muted">
            Couldn't load where each period is in payroll, so only hours show.{' '}
            <button type="button" className="font-semibold text-primary underline" onClick={() => setRetry(value => ({ ...value, periods: value.periods + 1 }))}>Try again</button>
          </p>
        )}
        {evidence.status === 'loading' ? (
          <div aria-busy="true" aria-label="Loading pay periods" className={`${card} space-y-2 p-4`}>
            {Array.from({ length: 3 }, (_, index) => <Skeleton key={index} height={40} className="w-full" />)}
          </div>
        ) : evidence.status === 'error' ? (
          <ErrorState title="Couldn't load pay periods." description={evidence.message} onRetry={() => setRetry(value => ({ ...value, periods: value.periods + 1 }))} />
        ) : rows.length === 0 ? (
          <EmptyState title="No pay periods yet." description={`${first} has no recorded hours.`} />
        ) : (
          <ul className={`${card} divide-y divide-line`}>
            {rows.map((row) => {
              const { evidence: period, state } = row
              const locked = isLockedState(state?.handoff_state, state?.status)
              const notMatched = showsNotMatched({ state: state?.handoff_state, status: state?.status, payDate: state?.pay_date, today })
                && period.summary.needs_reconciliation_hours > 0
              const words = [
                stateText(row, today),
                `${formatHours(period.summary.eligible_hours)} approved`,
                period.summary.pending_hours > 0 ? `${formatHours(period.summary.pending_hours)} waiting` : null,
              ].filter(Boolean).join(' · ')
              const expanded = open.has(period.id)
              return (
                <li key={period.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <div className="min-w-0 flex-1">
                      <h3 className="text-body-sm font-semibold text-ink">{formatPayPeriod({ start: period.start_date, end: period.end_date })}</h3>
                      <p className="text-body-sm text-ink-muted">{words}</p>
                    </div>
                    {notMatched && <StatusPill tone="needs-fix">{PERSON_TOTAL_LABELS.notMatched} · {formatHours(period.summary.needs_reconciliation_hours)}</StatusPill>}
                    {locked && (
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-expanded={expanded}
                        onClick={() => toggleDetails(period.id)}
                        icon={<ChevronDown className={`size-4 ${expanded ? '' : '-rotate-90'}`} />}
                      >
                        Technical details
                      </Button>
                    )}
                  </div>
                  {locked && expanded && evidence.status === 'ready' && (
                    <div className="mt-3 border-t border-line pt-3">
                      <PeriodEvidence
                        userId={user.id}
                        period={period}
                        identity={evidence.value.identity}
                        showNotMatched={notMatched}
                        focusEntryId={linkedPeriod === period.id ? linkedEntry : null}
                        shiftHref={shiftHref(period)}
                      />
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
        {evidence.status === 'ready' && evidence.value.next && (
          <Button
            variant="secondary"
            className="mt-3"
            loading={loadingMore}
            onClick={() => { setLoadingMore(true); setCursor(evidence.value.next ?? '') }}
          >
            Older pay periods
          </Button>
        )}
      </Section>
    </div>
  )
}
