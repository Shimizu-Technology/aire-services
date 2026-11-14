import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, type PayrollCutoffResponse, type WorkerStatus } from '../../lib/api'
import { attentionApi, type AttentionResponse, type PayrollConnectionStatus } from '../../lib/api/attention'
import { startVisibilityAwarePolling } from '../../lib/visibilityPolling'

const REFRESH_MS = 60_000
const CLOCK_TICK_MS = 30_000
// A tab return fires both visibilitychange and focus; refresh once.
const FOCUS_REFRESH_GAP_MS = 5_000

export interface Block<T> {
  data: T | null
  /** Set when the last request failed. `data` keeps the last good response. */
  error: string | null
  loading: boolean
  loadedAt: Date | null
}

type Result<T> = { data?: T; error?: string }

const fetchCutoff = () => api.getPayrollCutoff()
const fetchWorkers = () => api.getWhosWorking()

/** How a block should be drawn: nothing yet, failed with nothing to show, fine, or showing an older answer. */
export type BlockLoad = 'loading' | 'error' | 'ready' | 'stale'

export function loadOf<T>(block: Block<T>, enabled = true): BlockLoad {
  if (!enabled) return 'ready'
  if (block.data) return block.error ? 'stale' : 'ready'
  return block.error ? 'error' : 'loading'
}

/**
 * One request that fails on its own, so a broken block never blanks the page.
 * Calls while a request is running share it and queue a single follow-up, so a
 * retry or a reload after a save never overlaps a poll.
 */
function useBlock<T>(fetcher: () => Promise<Result<T>>, enabled: boolean) {
  const [state, setState] = useState<Block<T>>({ data: null, error: null, loading: enabled, loadedAt: null })
  const running = useRef<Promise<void> | null>(null)
  const queued = useRef(false)

  const once = useCallback(async () => {
    let result: Result<T>
    try {
      result = await fetcher()
    } catch {
      result = { error: 'Network error' }
    }
    setState(previous => result.data
      ? { data: result.data, error: null, loading: false, loadedAt: new Date() }
      : { ...previous, error: result.error || 'Something went wrong', loading: false })
  }, [fetcher])

  const load = useCallback(() => {
    if (!enabled) return Promise.resolve()
    if (running.current) {
      queued.current = true
      return running.current
    }
    const run = async () => {
      do {
        queued.current = false
        await once()
      } while (queued.current)
    }
    const current = run().finally(() => { running.current = null })
    running.current = current
    return current
  }, [enabled, once])

  return [state, load] as const
}

export interface TodayDataOptions {
  /** Lock time and connection health need `manage_payroll`. */
  payroll: boolean
  /** Who's working needs `manage_team_time`. */
  team: boolean
  /** The connection card shows on desktop only, so phones skip its request. */
  connection: boolean
}

export interface TodayData {
  attention: Block<AttentionResponse>
  cutoff: Block<PayrollCutoffResponse>
  workers: Block<{ workers: WorkerStatus[] }>
  connection: Block<PayrollConnectionStatus>
  /** The server's clock, so a wrong device clock doesn't change the countdown. */
  now: Date
  retry: { attention: () => void; cutoff: () => void; workers: () => void; connection: () => void }
}

/**
 * Loads every Today block on mount, when the tab or window comes back into
 * focus, and every 60 seconds while the page is visible.
 */
export function useTodayData({ payroll, team, connection: wantsConnection }: TodayDataOptions): TodayData {
  const [attention, loadAttention] = useBlock(attentionApi.attention, true)
  const [cutoff, loadCutoff] = useBlock(fetchCutoff, payroll)
  const [workers, loadWorkers] = useBlock(fetchWorkers, team)
  const [connection, loadConnection] = useBlock(attentionApi.connection, payroll && wantsConnection)

  const refreshAll = useCallback(
    () => Promise.all([loadAttention(), loadCutoff(), loadWorkers(), loadConnection()]).then(() => undefined),
    [loadAttention, loadCutoff, loadWorkers, loadConnection],
  )

  const inFlight = useRef(false)
  const lastRun = useRef(0)
  useEffect(() => {
    const run = async () => {
      if (inFlight.current) return
      inFlight.current = true
      lastRun.current = Date.now()
      try { await refreshAll() } finally { inFlight.current = false }
    }
    void run()
    const stop = startVisibilityAwarePolling(run, REFRESH_MS)
    const onFocus = () => {
      if (document.visibilityState !== 'hidden' && Date.now() - lastRun.current >= FOCUS_REFRESH_GAP_MS) void run()
    }
    window.addEventListener('focus', onFocus)
    return () => {
      stop()
      window.removeEventListener('focus', onFocus)
    }
  }, [refreshAll])

  // Count down from the server's clock, as the cutoff notice does.
  const serverNow = Date.parse(cutoff.data?.cutoff?.now ?? '')
  const offset = Number.isFinite(serverNow) && cutoff.loadedAt ? serverNow - cutoff.loadedAt.getTime() : 0
  const [clock, setClock] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), CLOCK_TICK_MS)
    return () => window.clearInterval(timer)
  }, [])
  // Each answer is a fresh reading too, so the countdown never lags a refresh.
  const loadedAt = attention.loadedAt ?? cutoff.loadedAt
  const reading = loadedAt ? Math.max(clock, loadedAt.getTime()) : clock
  const now = useMemo(() => new Date(reading + offset), [reading, offset])

  const retry = useMemo(
    () => ({
      attention: () => void loadAttention(),
      cutoff: () => void loadCutoff(),
      workers: () => void loadWorkers(),
      connection: () => void loadConnection(),
    }),
    [loadAttention, loadCutoff, loadWorkers, loadConnection],
  )

  return { attention, cutoff, workers, connection, now, retry }
}
