import { useMemo, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ChevronDown, Send } from 'lucide-react'
import type { AdminUser } from '../../lib/api'
import { peopleApi, type PayPeriodState } from '../../lib/api/people'
import { employeeEvidenceApi, type EmployeeEvidence, type EvidencePeriod } from '../../lib/employeeEvidenceApi'
import { formatPayPeriod } from '../../lib/payPeriods'
import { HANDOFF_STATE_LABELS, PERSON_TOTAL_LABELS, isLockedState, showsNotMatched } from '../../lib/payrollTerms'
import { payStubsApi } from '../../lib/payStubsApi'
import { formatHours } from '../../lib/timecards'
import { monthDay } from '../today/format'
import { Button, EmptyState, ErrorState, StatusPill, Switch } from '../ui'
import { Skeleton } from '../ui/Skeleton'
import { PeriodEvidence } from './PeriodEvidence'
import { firstName } from './personFormat'
import { useLoadable } from './useLoadable'
import { EditError } from './EditError'

const PERIOD_PAGE = '12'
const RECENT_PAYCHECKS = 6

interface PayTabProps {
  user: AdminUser
  today: string
  /** Null while unknown; true when "On for everyone" is on. */
  myPayForEveryone: boolean | null
  /** Why "On for everyone" couldn't be read; the switch waits for it. */
  myPayError: string | null
  onRetryMyPay: () => void
  /** Owners and admins (manage_my_pay_access). */
  canManageMyPay: boolean
  /** Shows "Preview their My Pay" (owners and admins on the preview allowlist). */
  previewHref: string | null
  onSendStub?: () => void
  onUserChange: (user: AdminUser) => void
}

/** "Open", "Paid Nov 10", or nothing for a past period AIRE never published. */
function stateText(period: EvidencePeriod, state: PayPeriodState | null, today: string) {
  if (!state) return period.end_date >= today ? HANDOFF_STATE_LABELS.open : null
  if (state.handoff_state === 'paid') return `${HANDOFF_STATE_LABELS.paid} ${monthDay(state.pay_date)}`
  // Periods from before scheduled locking only say whether AIRE froze them.
  if (state.handoff_state === 'before_locking') return state.status === 'finalized' ? HANDOFF_STATE_LABELS.locked : null
  return HANDOFF_STATE_LABELS[state.handoff_state]
}

function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={title}>
      <div className="mb-2 flex min-h-11 flex-wrap items-center justify-between gap-x-3">
        <h2 className="text-body font-semibold text-ink">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}

const card = 'rounded-card border border-line bg-surface'

/** My Pay, paychecks and pay periods for one person, in the glossary's words. */
export function PayTab({ user, today, myPayForEveryone, myPayError, onRetryMyPay, canManageMyPay, previewHref, onSendStub, onUserChange }: PayTabProps) {
  const [searchParams] = useSearchParams()
  const first = firstName(user)
  const [saving, setSaving] = useState(false)
  const [conflict, setConflict] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [retry, setRetry] = useState({ paychecks: 0, periods: 0 })
  const [older, setOlder] = useState<{ key: string; periods: EvidencePeriod[]; next: string | null; loading: boolean; error: string | null } | null>(null)
  // A link naming a period (?tab=pay&period=…) opens its technical details.
  const linkedPeriod = searchParams.get('period')
  const linkedEntry = searchParams.get('entry')
  const [open, setOpen] = useState<Set<string>>(() => new Set(linkedPeriod ? [linkedPeriod] : []))

  const paychecks = useLoadable(
    onSendStub ? `${user.id}:${retry.paychecks}` : null,
    async (signal) => (await payStubsApi.statements(user.id, signal)).statements,
    "Couldn't load paychecks.",
  )
  const loadPeriods = async (cursor: string, signal?: AbortSignal) => {
    const filter = new URLSearchParams({ per_page: PERIOD_PAGE })
    if (cursor) filter.set('cursor', cursor)
    const result = await employeeEvidenceApi.periods(String(user.id), filter, signal)
    // Saved links' source identity is checked once, by the person page, before any tab shows.
    if (result.employee.id !== String(user.id)) throw new Error('Employee evidence identity does not match this record.')
    return result
  }
  const firstPageKey = `${user.id}:${retry.periods}`
  const evidence = useLoadable(firstPageKey, async (signal) => {
    const result = await loadPeriods('', signal)
    return { identity: { employee: result.employee, integration: result.integration }, periods: result.periods, next: result.pagination.next_cursor }
  }, "Couldn't load pay periods.")
  const more = older?.key === firstPageKey ? older : null
  const nextCursor = more ? more.next : evidence.status === 'ready' ? evidence.value.next : null

  const loadOlder = async () => {
    if (!nextCursor) return
    const key = firstPageKey
    setOlder({ key, periods: more?.periods ?? [], next: nextCursor, loading: true, error: null })
    try {
      const result = await loadPeriods(nextCursor)
      setOlder({ key, periods: [...(more?.periods ?? []), ...result.periods], next: result.pagination.next_cursor, loading: false, error: null })
    } catch (reason) {
      setOlder({ key, periods: more?.periods ?? [], next: nextCursor, loading: false, error: reason instanceof Error ? reason.message : "Couldn't load older pay periods." })
    }
  }

  const periods = useMemo(
    () => (evidence.status === 'ready' ? [...evidence.value.periods, ...(more?.periods ?? [])] : []),
    [evidence, more],
  )

  const toggleMyPay = async (enabled: boolean) => {
    if (saving || conflict) return
    setSaving(true)
    setSaveError(null)
    const response = await peopleApi.setMyPay(user.id, enabled, user.admin_edit_version ?? 0)
    setSaving(false)
    if (response.data) onUserChange({ ...user, my_pay_enabled: response.data.my_pay_enabled, admin_edit_version: response.data.admin_edit_version })
    else {
      setSaveError(response.error || `My Pay wasn't changed for ${first}. Try again.`)
      if (response.status === 409) setConflict(true)
    }
  }

  const reloadPerson = async () => {
    setSaving(true)
    const response = await peopleApi.person(user.id)
    setSaving(false)
    if (response.data) {
      onUserChange(response.data.user)
      setConflict(false)
      setSaveError(null)
    }
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
          {myPayError && (
            <ErrorState
              className="mb-2"
              title="Couldn't load the My Pay settings."
              description="Whether My Pay is on for everyone is unknown until they load."
              onRetry={onRetryMyPay}
            />
          )}
          <div className={`${card} px-4 py-2`}>
            {myPayForEveryone ? (
              <p className="py-2 text-body-sm text-ink">My Pay is on for everyone, so {first} can see their own paychecks. Change it on Team.</p>
            ) : (
              <Switch
                label="My Pay"
                description={myPayError
                  ? "Can't be changed until the My Pay settings load."
                  : user.my_pay_enabled ? `${first} sees their own paychecks.` : `${first} can't see paychecks in AIRE.`}
                checked={Boolean(user.my_pay_enabled)}
                onChange={(checked) => void toggleMyPay(checked)}
                busy={saving}
                disabled={conflict || !user.is_active || myPayForEveryone === null}
              />
            )}
          </div>
          <EditError error={saveError || ''} conflict={conflict} busy={saving} onReload={() => void reloadPerson()} />
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
        {evidence.status === 'loading' ? (
          <div aria-busy="true" aria-label="Loading pay periods" className={`${card} space-y-2 p-4`}>
            {Array.from({ length: 3 }, (_, index) => <Skeleton key={index} height={40} className="w-full" />)}
          </div>
        ) : evidence.status === 'error' ? (
          <ErrorState title="Couldn't load pay periods." description={evidence.message} onRetry={() => setRetry(value => ({ ...value, periods: value.periods + 1 }))} />
        ) : periods.length === 0 ? (
          <EmptyState title="No pay periods yet." description={`${first} has no recorded hours.`} />
        ) : (
          <ul className={`${card} divide-y divide-line`}>
            {periods.map((period) => (
              <PayPeriodRow
                key={period.id}
                userId={user.id}
                period={period}
                today={today}
                identity={evidence.status === 'ready' ? evidence.value.identity : null}
                expanded={open.has(period.id)}
                onToggle={() => toggleDetails(period.id)}
                focusEntryId={linkedPeriod === period.id ? linkedEntry : null}
                shiftHref={shiftHref(period)}
              />
            ))}
          </ul>
        )}
        {more?.error && <p role="alert" className="mt-3 text-body-sm text-danger">{more.error}</p>}
        {evidence.status === 'ready' && nextCursor && (
          <Button
            variant="secondary"
            className="mt-3"
            loading={more?.loading}
            onClick={() => void loadOlder()}
          >
            Older pay periods
          </Button>
        )}
      </Section>
    </div>
  )
}

interface PayPeriodRowProps {
  userId: number
  period: EvidencePeriod
  today: string
  identity: Pick<EmployeeEvidence, 'employee' | 'integration'> | null
  expanded: boolean
  onToggle: () => void
  focusEntryId: string | null
  shiftHref: (entryId: string) => string
}

/**
 * One pay period's hours and where it is in payroll. Each row looks up its
 * own period, so an old locked period still shows its problems; while the
 * status is unknown the row says so instead of looking fine.
 */
function PayPeriodRow({ userId, period, today, identity, expanded, onToggle, focusEntryId, shiftHref }: PayPeriodRowProps) {
  const [retry, setRetry] = useState(0)
  const lookup = useLoadable(`${period.start_date}:${retry}`, () => peopleApi.payPeriod(period.start_date), "Couldn't load this period's payroll status.")
  const state = lookup.status === 'ready' ? lookup.value : null
  const locked = isLockedState(state?.handoff_state, state?.status)
  const notMatched = showsNotMatched({ state: state?.handoff_state, status: state?.status, payDate: state?.pay_date, today })
    && period.summary.needs_reconciliation_hours > 0
  const words = [
    lookup.status === 'ready' ? stateText(period, state, today) : null,
    `${formatHours(period.summary.eligible_hours)} approved`,
    period.summary.pending_hours > 0 ? `${formatHours(period.summary.pending_hours)} waiting` : null,
  ].filter(Boolean).join(' · ')

  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <div className="min-w-0 flex-1 basis-48">
          <h3 className="text-body-sm font-semibold text-ink">{formatPayPeriod({ start: period.start_date, end: period.end_date })}</h3>
          <p className="text-body-sm text-ink-muted">{words}</p>
          {lookup.status === 'loading' && <p aria-busy="true" className="text-body-sm text-ink-subtle">Checking payroll status…</p>}
          {lookup.status === 'error' && (
            <p role="alert" className="text-body-sm text-danger">
              Couldn't load this period's payroll status.{' '}
              <button type="button" className="font-semibold underline" onClick={() => setRetry(value => value + 1)}>Try again</button>
            </p>
          )}
        </div>
        {notMatched && <StatusPill tone="needs-fix">{PERSON_TOTAL_LABELS.notMatched} · {formatHours(period.summary.needs_reconciliation_hours)}</StatusPill>}
        {locked && (
          <Button
            variant="ghost"
            size="sm"
            aria-expanded={expanded}
            onClick={onToggle}
            icon={<ChevronDown className={`size-4 ${expanded ? '' : '-rotate-90'}`} />}
          >
            Technical details
          </Button>
        )}
      </div>
      {locked && expanded && identity && (
        <div className="mt-3 border-t border-line pt-3">
          <PeriodEvidence
            userId={userId}
            period={period}
            identity={identity}
            showNotMatched={notMatched}
            focusEntryId={focusEntryId}
            shiftHref={shiftHref}
          />
        </div>
      )}
    </li>
  )
}
