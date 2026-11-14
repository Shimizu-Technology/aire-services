import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  CalendarPlus,
  ClipboardCheck,
  Clock,
  Hourglass,
  KeyRound,
  Landmark,
  Send,
  Tag,
  TriangleAlert,
} from 'lucide-react'
import { peopleApi } from '../../lib/api/people'
import type {
  AttentionItemData,
  ClockAttentionItem,
  OvertimeAttentionItem,
  PayrollProblemAttentionItem,
} from '../../lib/api/attention'
import { ADMIN_PATHS } from '../../lib/adminRoutes'
import { AttentionItem, Button, Sheet, buttonClasses, useConfirm, useToast, type AttentionTone } from '../ui'
import {
  dayLabel,
  dayTimeLabel,
  hoursLabel,
  leaveKind,
  monthDay,
  periodLabel,
  plural,
  timeLabel,
} from './format'
import { approvalsHref, missingCategoryHref, openClockHref, payrollHref } from './links'

const actionClasses = buttonClasses({ variant: 'secondary', size: 'sm' })

function ActionLink({ to, children }: { to: string; children: string }) {
  return <Link to={to} className={actionClasses}>{children}</Link>
}

function overtimeMeta(item: OvertimeAttentionItem) {
  const names = item.people.slice(0, 2).map(person => person.full_name)
  const more = item.people.length - names.length
  const weeks = [...new Set(item.people.flatMap(person => person.week_starts))].sort()
  const when = weeks.length === 1 ? `week of ${monthDay(weeks[0])}` : weeks.length > 1 ? `${weeks.length} weeks` : null
  return [`${names.join(', ')}${more > 0 ? ` +${more}` : ''}`, when].filter(Boolean).join(' · ')
}

function problemRow(item: PayrollProblemAttentionItem): { text: ReactNode; meta?: string; tone: AttentionTone } {
  const range = item.period ? periodLabel(item.period) : 'this pay period'
  const change = item.change
  switch (item.problem) {
    case 'lock_failed':
      return { tone: 'bad', text: <><b>The lock failed</b> for {range}</>, meta: "AIRE couldn't lock these hours, so Payroll doesn't have them yet" }
    case 'lock_overdue':
      return { tone: 'bad', text: <><b>The lock is overdue</b> for {range}</>, meta: 'The lock time passed and the hours are not locked yet' }
    case 'lock_change_pending':
      return {
        tone: 'info',
        text: <><b>{change?.action === 'lock_now' ? 'Lock now' : 'A lock time change'}</b> is waiting on Cornerstone Payroll</>,
        meta: change?.requested_by_name ? `Asked by ${change.requested_by_name} · ${dayTimeLabel(change.requested_at)}` : undefined,
      }
    case 'lock_change_refused':
      return { tone: 'bad', text: <><b>Cornerstone Payroll refused</b> the lock time change</>, meta: change?.error ?? undefined }
    case 'lock_change_expired':
      return { tone: 'bad', text: <><b>A lock time change expired</b> before it arrived</>, meta: 'The lock time stays as it was' }
    default:
      return { tone: 'bad', text: <><b>Payroll connection paused</b></> }
  }
}

function clockRow(item: ClockAttentionItem) {
  const hours = hoursLabel(item.hours_so_far)
  if (item.type === 'open_clock_earlier_day') {
    return {
      tone: 'bad' as const,
      icon: <Clock />,
      text: <><b>{item.user.full_name}</b> still clocked in</>,
      meta: `Since ${item.clock_in_at ? dayTimeLabel(item.clock_in_at) : dayLabel(item.work_date)} · ${hours}`,
      action: <ActionLink to={openClockHref(item)}>Fix clock-out</ActionLink>,
    }
  }
  return {
    tone: 'warn' as const,
    icon: <Hourglass />,
    text: <><b>{item.user.full_name}</b> on the clock {hours}</>,
    meta: [item.clock_in_at && `Since ${timeLabel(item.clock_in_at)}`, item.time_category?.name].filter(Boolean).join(' · '),
    action: <ActionLink to={openClockHref(item)}>Check</ActionLink>,
  }
}

interface ResetResult {
  name: string
  pin: string
}

export interface AttentionListProps {
  items: AttentionItemData[]
  /** Called after a PIN reset so the list can drop the row. */
  onChanged: () => void
}

/**
 * Today's one list of what needs a person, in the API's order: payroll
 * blockers first, then requests. Every row has one action that opens the
 * page where the work is done; Reset PIN is the one that finishes in place.
 * Stay mounted when the list empties: the new PIN is still on screen.
 */
export function AttentionList({ items, onChanged }: AttentionListProps) {
  const toast = useToast()
  const [confirm, confirmDialog] = useConfirm()
  const [resetting, setResetting] = useState<number | null>(null)
  const [result, setResult] = useState<ResetResult | null>(null)

  const resetPin = async (id: number, name: string) => {
    const confirmed = await confirm({
      title: `Reset ${name}'s kiosk PIN?`,
      description: 'Their old PIN stops working right away.',
      confirmLabel: 'Reset PIN',
      tone: 'danger',
    })
    if (!confirmed) return
    setResetting(id)
    try {
      const loaded = await peopleApi.person(id)
      if (!loaded.data) throw new Error(loaded.error || "Couldn't load person")
      const response = await peopleApi.resetPin(id, loaded.data.user.admin_edit_version ?? 0)
      if (response.data) {
        setResult({ name, pin: response.data.kiosk_pin })
        onChanged()
      } else {
        toast.show({ message: response.error || `Couldn't reset ${name}'s PIN.`, tone: 'danger' })
      }
    } catch {
      toast.show({ message: `Couldn't reset ${name}'s PIN.`, tone: 'danger' })
    } finally {
      setResetting(null)
    }
  }

  const row = (item: AttentionItemData): ReactNode => {
    switch (item.type) {
      case 'open_clock_earlier_day':
      case 'long_clock_today': {
        const { tone, icon, text, meta, action } = clockRow(item)
        return <AttentionItem key={item.key} tone={tone} icon={icon} meta={meta} action={action}>{text}</AttentionItem>
      }
      case 'approvals_waiting': {
        const meta = [
          hoursLabel(item.total_hours),
          item.by_kind.added > 0 && `${item.by_kind.added} added by hand`,
          item.oldest_work_date && `oldest ${dayLabel(item.oldest_work_date)}`,
        ].filter(Boolean).join(' · ')
        return (
          <AttentionItem key={item.key} tone="warn" icon={<ClipboardCheck />} meta={meta} action={<ActionLink to={approvalsHref()}>Review</ActionLink>}>
            <b>{plural(item.count, 'shift')}</b> waiting for approval
          </AttentionItem>
        )
      }
      case 'overtime_waiting': {
        const only = item.people.length === 1 ? item.people[0].id : undefined
        return (
          <AttentionItem
            key={item.key}
            tone="warn"
            icon={<TriangleAlert />}
            meta={overtimeMeta(item)}
            action={<ActionLink to={approvalsHref({ kind: 'overtime', user_id: only })}>Review</ActionLink>}
          >
            {item.hours === null
              ? <>Overtime on <b>{plural(item.count, 'shift')}</b> waiting</>
              : <><b>{hoursLabel(item.hours)} overtime</b> waiting</>}
          </AttentionItem>
        )
      }
      case 'missing_category':
        return (
          <AttentionItem
            key={item.key}
            tone="bad"
            icon={<Tag />}
            meta={`${periodLabel(item.period)} · the lock needs a category on every shift`}
            action={<ActionLink to={missingCategoryHref(item.entry_ids[0])}>Fix</ActionLink>}
          >
            <b>{plural(item.count, 'shift')}</b> with no work category
          </AttentionItem>
        )
      case 'payroll_problem': {
        const { tone, text, meta } = problemRow(item)
        return (
          <AttentionItem key={item.key} tone={tone} icon={<Landmark />} meta={meta} action={<ActionLink to={payrollHref(item.period)}>See details</ActionLink>}>
            {text}
          </AttentionItem>
        )
      }
      case 'leave_waiting': {
        const next = item.next
        return (
          <AttentionItem
            key={item.key}
            tone="info"
            icon={<CalendarPlus />}
            meta={[`Next: ${next.user.full_name}`, leaveKind(next.leave_type), next.start_date && dayLabel(next.start_date)].filter(Boolean).join(', ')}
            action={<ActionLink to={ADMIN_PATHS.leave}>Review</ActionLink>}
          >
            <b>{plural(item.count, 'leave request')}</b> waiting
          </AttentionItem>
        )
      }
      case 'kiosk_pin_locked':
        return (
          <AttentionItem
            key={item.key}
            tone="info"
            icon={<KeyRound />}
            meta={`Too many wrong tries · unlocks ${timeLabel(item.locked_until)}`}
            action={
              <Button
                variant="secondary"
                size="sm"
                loading={resetting === item.user.id}
                disabled={resetting !== null}
                onClick={() => void resetPin(item.user.id, item.user.full_name)}
                aria-label={`Reset PIN for ${item.user.full_name}`}
              >
                Reset PIN
              </Button>
            }
          >
            <b>{item.user.full_name}</b> kiosk PIN locked
          </AttentionItem>
        )
      case 'pay_stub_requests':
        return (
          <AttentionItem
            key={item.key}
            tone="info"
            icon={<Send />}
            meta={item.oldest_requested_at ? `Oldest ${dayLabel(item.oldest_requested_at.slice(0, 10))}` : undefined}
            action={<ActionLink to={ADMIN_PATHS.payStubs}>Open</ActionLink>}
          >
            <b>{plural(item.count, 'pay stub request')}</b> from the kiosk
          </AttentionItem>
        )
    }
  }

  return (
    <>
      {items.length > 0 && (
        <ul className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
          {items.map(row)}
        </ul>
      )}
      <Sheet
        open={result !== null}
        onClose={() => setResult(null)}
        title={`New kiosk PIN for ${result?.name ?? ''}`}
        description="Share it privately. The old PIN no longer works."
        footer={<Button onClick={() => setResult(null)}>Done</Button>}
      >
        <p className="text-center text-heading font-semibold tracking-[0.3em] tabular-nums text-ink">
          <span className="sr-only">New PIN: </span>
          {result?.pin}
        </p>
      </Sheet>
      {confirmDialog}
    </>
  )
}
