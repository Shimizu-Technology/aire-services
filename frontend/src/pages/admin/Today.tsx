import { useEffect } from 'react'
import { CircleCheck } from 'lucide-react'
import PayrollCutoffNotice from '../../components/time-tracking/PayrollCutoffNotice'
import { AttentionList } from '../../components/today/AttentionList'
import { ConnectionCard, PausedBanner } from '../../components/today/ConnectionCard'
import { longDay } from '../../components/today/format'
import { OnTheClock } from '../../components/today/OnTheClock'
import { PayPeriodCard } from '../../components/today/PayPeriodCard'
import { StaleNote } from '../../components/today/StaleNote'
import { useTodayData, type Block } from '../../components/today/useTodayData'
import { EmptyState, ErrorState, OfflineBanner, PageHeader } from '../../components/ui'
import { Skeleton } from '../../components/ui/Skeleton'
import { useCapabilities } from '../../lib/useCapabilities'
import { useMediaQuery } from '../../lib/useMediaQuery'

const DESKTOP = '(min-width: 1024px)'

function loadOf<T>(block: Block<T>, enabled = true) {
  if (!enabled || block.data) return 'ready'
  return block.error ? 'error' : 'loading'
}

/**
 * Today (/admin): what owners and admins need to look at right now. One pay
 * period card, one attention list and who is on the clock. Each block loads
 * and fails on its own, and everything refreshes on focus and every minute.
 */
export default function Today() {
  const capabilities = useCapabilities()
  const desktop = useMediaQuery(DESKTOP)
  const { attention, cutoff, workers, connection, now, retry } = useTodayData({
    payroll: capabilities.manage_payroll,
    team: capabilities.manage_team_time,
    connection: desktop,
  })

  useEffect(() => { document.title = 'Today | AIRE Ops' }, [])

  const items = attention.data?.items ?? []
  const paused = attention.data?.connected_payroll.enabled === false
    || connection.data?.state === 'paused'
    || cutoff.data?.connected_payroll?.enabled === false
    || items.some(item => item.type === 'payroll_problem' && item.problem === 'connection_paused')
  // A paused connection is the banner above the page, not a row in the list.
  const rows = items.filter(item => !(item.type === 'payroll_problem' && item.problem === 'connection_paused'))
  const attentionLoad = loadOf(attention)

  return (
    <div className="space-y-4">
      <PayrollCutoffNotice />
      <OfflineBanner loadedAt={attention.loadedAt} />
      <PageHeader title="Today" description={longDay(now)} />
      {paused && <PausedBanner />}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        <div className="min-w-0 space-y-6">
          <PayPeriodCard
            period={attention.data?.period ?? null}
            periodLoad={loadOf(attention)}
            lock={cutoff.data?.lock_control ?? null}
            lockLoad={loadOf(cutoff, capabilities.manage_payroll)}
            now={now}
            onRetryPeriod={retry.attention}
            onRetryLock={retry.cutoff}
          />

          <section aria-labelledby="today-attention" className="space-y-2">
            <h2 id="today-attention" className="text-body font-semibold text-ink">
              Needs attention
              {attentionLoad === 'ready' && rows.length > 0 && <span className="text-ink-muted tabular-nums"> · {rows.length}</span>}
            </h2>
            {attention.data && attention.error && (
              <StaleNote what="the list" loadedAt={attention.loadedAt} onRetry={retry.attention} />
            )}
            {attentionLoad === 'loading' && <Skeleton className="h-40 w-full" />}
            {attentionLoad === 'error' && (
              <ErrorState title="Couldn't load what needs attention." description={attention.error} onRetry={retry.attention} />
            )}
            {attentionLoad === 'ready' && <AttentionList items={rows} onChanged={retry.attention} />}
            {attentionLoad === 'ready' && rows.length === 0 && (
              <EmptyState
                icon={<CircleCheck />}
                title="Nothing needs you right now"
                description="Approvals, clock-outs, leave and PINs are all clear."
              />
            )}
          </section>
        </div>

        <aside className="min-w-0 space-y-6">
          <div className="space-y-2">
            {workers.data && workers.error && (
              <StaleNote what="who is on the clock" loadedAt={workers.loadedAt} onRetry={retry.workers} />
            )}
            {loadOf(workers, capabilities.manage_team_time) === 'loading' && <Skeleton className="h-28 w-full" />}
            {loadOf(workers, capabilities.manage_team_time) === 'error' && (
              <ErrorState title="Couldn't load who is on the clock." onRetry={retry.workers} />
            )}
            {workers.data && <OnTheClock workers={workers.data.workers} now={now} loadedAt={workers.loadedAt} />}
          </div>
          {desktop && capabilities.manage_payroll && (
            <ConnectionCard connection={connection.data} load={loadOf(connection)} now={now} onRetry={retry.connection} />
          )}
        </aside>
      </div>
    </div>
  )
}
