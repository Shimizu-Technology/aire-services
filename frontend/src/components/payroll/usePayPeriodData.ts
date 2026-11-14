import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  api,
  type PayrollBatchDetail,
  type PayrollBatchPayload,
  type PayrollCarryoverQueue,
  type PayrollCutoffResponse,
} from '../../lib/api'
import { attentionApi, type AttentionResponse, type PayrollConnectionStatus } from '../../lib/api/attention'
import { payrollPeriodApi, type PayrollPeriodResponse, type PayrollPeriodsResponse } from '../../lib/api/payrollPeriod'
import { currentPayPeriod, payPeriodContaining, type PayPeriod } from '../../lib/payPeriods'
import { isLockedState } from '../../lib/payrollTerms'
import { startVisibilityAwarePolling } from '../../lib/visibilityPolling'

const REFRESH_MS = 60_000
const CLOCK_TICK_MS = 30_000

type Result<T> = { data?: T; error?: string; status?: number; code?: string }

export interface PeriodBlock<T> {
  data: T | null
  /** The last request failed; `data` keeps the last good answer for the same key. */
  error: string | null
  loadedAt: Date | null
  reload: () => Promise<void>
}

/** How a block should be drawn, as on Today. */
export function blockLoad<T>(block: PeriodBlock<T>): 'loading' | 'error' | 'ready' | 'stale' {
  if (block.data) return block.error ? 'stale' : 'ready'
  return block.error ? 'error' : 'loading'
}

/**
 * One request per `key`. A new key starts empty, so one period's answer never
 * shows under another; a reload of the same key keeps the last good answer.
 * A null key loads nothing.
 */
function useBlock<T>(key: string | null, fetcher: () => Promise<Result<T>>): PeriodBlock<T> {
  const [state, setState] = useState<{ key: string | null; data: T | null; error: string | null; loadedAt: Date | null }>(
    { key: null, data: null, error: null, loadedAt: null },
  )
  const generation = useRef(0)

  const reload = useCallback(async () => {
    if (key === null) return
    const id = ++generation.current
    let result: Result<T>
    try {
      result = await fetcher()
    } catch {
      result = { error: 'Network error' }
    }
    if (id !== generation.current) return
    setState(previous => {
      const same = previous.key === key
      return result.data !== undefined && result.data !== null
        ? { key, data: result.data, error: null, loadedAt: new Date() }
        : { key, data: same ? previous.data : null, error: result.error || 'Something went wrong', loadedAt: same ? previous.loadedAt : null }
    })
  }, [key, fetcher])

  useEffect(() => {
    let active = true
    queueMicrotask(() => { if (active) void reload() })
    return () => {
      active = false
      generation.current += 1
    }
  }, [reload])

  const current = state.key === key
  return { data: current ? state.data : null, error: current ? state.error : null, loadedAt: current ? state.loadedAt : null, reload }
}

/** The show answer, or `period: null` when nothing is published for that start. */
export type PeriodShow = PayrollPeriodResponse | { period: null; previous_start_date: null; next_start_date: null }

const NOT_PUBLISHED: PeriodShow = { period: null, previous_start_date: null, next_start_date: null }

export interface PayPeriodData {
  periods: PeriodBlock<PayrollPeriodsResponse>
  /** The displayed period, or `period: null` when Cornerstone Payroll hasn't published it. */
  show: PeriodBlock<PeriodShow>
  /** The dates on screen: the requested or current period, else the semimonthly dates around today. */
  range: PayPeriod | null
  /** This is the period AIRE locks next, not an earlier one. */
  isCurrent: boolean
  attention: PeriodBlock<AttentionResponse>
  cutoff: PeriodBlock<PayrollCutoffResponse>
  connection: PeriodBlock<PayrollConnectionStatus>
  /** What would go to payroll if it locked now (open periods). */
  preview: PeriodBlock<PayrollBatchPayload>
  /** What went to payroll (locked periods with a batch). */
  batch: PeriodBlock<PayrollBatchDetail>
  carryovers: PeriodBlock<PayrollCarryoverQueue>
  /** The server's clock, so a wrong device clock doesn't change the countdown. */
  now: Date
  refresh: () => Promise<void>
}

/**
 * Everything the pay period page reads. `requestedStart` is a period's first
 * day from the URL, or null for the current period. Light reads refresh on
 * focus and every minute; the preview, batch and carried hours on focus.
 */
export function usePayPeriodData(requestedStart: string | null): PayPeriodData {
  const periods = useBlock('periods', useCallback(() => payrollPeriodApi.periods(), []))
  const currentStart = periods.data ? periods.data.current_start_date : undefined
  // Wait for the index before falling back to today's dates.
  const start = requestedStart ?? (currentStart === undefined ? null : currentStart ?? currentPayPeriod().start)
  const isCurrent = start !== null && (requestedStart === null || requestedStart === currentStart)

  const fetchShow = useCallback(async (): Promise<Result<PeriodShow>> => {
    if (!start) return { error: 'No pay period' }
    const result = await payrollPeriodApi.period(start)
    if (result.status === 404 && result.code === 'not_published') return { data: NOT_PUBLISHED }
    return result
  }, [start])
  const show = useBlock(start ? `show:${start}` : null, fetchShow)

  const period = show.data?.period ?? null
  const range = start ? (period ? { start: period.start_date, end: period.end_date } : payPeriodContaining(start)) : null
  const locked = Boolean(period && isLockedState(period.handoff_state, period.status))
  // Unpublished dates still preview: they feed the manual tools.
  const wantsPreview = show.data !== null && !locked
  const batchId = locked ? period?.payroll_batch_id ?? null : null

  const attention = useBlock(isCurrent && !locked ? 'attention' : null, useCallback(() => attentionApi.attention(), []))
  const cutoff = useBlock(isCurrent ? 'cutoff' : null, useCallback(() => api.getPayrollCutoff(), []))
  const connection = useBlock('connection', useCallback(() => attentionApi.connection(), []))
  const preview = useBlock(
    wantsPreview && range ? `preview:${range.start}:${range.end}` : null,
    useCallback(() => (range ? api.previewPayrollBatch(range.start, range.end) : Promise.resolve({ error: 'No pay period' })),
      // eslint-disable-next-line react-hooks/exhaustive-deps -- the dates name the request
      [range?.start, range?.end]),
  )
  const batch = useBlock(batchId ? `batch:${batchId}` : null, useCallback(() => api.getPayrollBatch(batchId ?? ''), [batchId]))
  const carryovers = useBlock(locked ? 'carryovers' : null, useCallback(() => api.getPayrollCarryovers(), []))

  const p = periods.reload, sh = show.reload, at = attention.reload, cu = cutoff.reload, co = connection.reload
  const pr = preview.reload, ba = batch.reload, ca = carryovers.reload
  const refreshLight = useCallback(() => Promise.all([p(), sh(), at(), cu(), co()]).then(() => undefined), [p, sh, at, cu, co])
  const refresh = useCallback(
    () => Promise.all([refreshLight(), pr(), ba(), ca()]).then(() => undefined),
    [refreshLight, pr, ba, ca],
  )

  const refreshRef = useRef({ refresh, refreshLight })
  useEffect(() => { refreshRef.current = { refresh, refreshLight } }, [refresh, refreshLight])
  useEffect(() => {
    let lastFull = Date.now()
    const stop = startVisibilityAwarePolling(() => refreshRef.current.refreshLight(), REFRESH_MS)
    const onFocus = () => {
      // A tab return fires focus and visibilitychange together; refresh once.
      if (document.visibilityState === 'hidden' || Date.now() - lastFull < 5_000) return
      lastFull = Date.now()
      void refreshRef.current.refresh()
    }
    window.addEventListener('focus', onFocus)
    return () => {
      stop()
      window.removeEventListener('focus', onFocus)
    }
  }, [])

  // Count down from the server's clock, as Today and the lock control do.
  const serverNow = Date.parse(cutoff.data?.cutoff?.now ?? '')
  const offset = Number.isFinite(serverNow) && cutoff.loadedAt ? serverNow - cutoff.loadedAt.getTime() : 0
  const [clock, setClock] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), CLOCK_TICK_MS)
    return () => window.clearInterval(timer)
  }, [])
  const now = useMemo(() => new Date(clock + offset), [clock, offset])

  return { periods, show, range, isCurrent, attention, cutoff, connection, preview, batch, carryovers, now, refresh }
}
