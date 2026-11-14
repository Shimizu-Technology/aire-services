import { useCallback, useEffect, useRef, useState } from 'react'
import type { PendingApprovalsParams } from '../../lib/api'
import {
  approvalsApi,
  type ApprovalsResponse,
  type ReviewEntry,
} from '../../lib/api/approvals'
import { startVisibilityAwarePolling } from '../../lib/visibilityPolling'

export function useApprovalsQuery(
  params: PendingApprovalsParams,
  paused: boolean | ((rows: ReviewEntry[]) => boolean),
  onReloaded?: (rows: ReviewEntry[]) => void,
) {
  const key = JSON.stringify(params)
  const [result, setResult] = useState<{
    key: string
    data?: ApprovalsResponse
    error?: string
    at?: Date
  }>({ key: '' })
  const [loading, setLoading] = useState(true)
  const [slow, setSlow] = useState(false)
  const [showSkeleton, setShowSkeleton] = useState(false)
  const generation = useRef(0)
  const inFlight = useRef<{
    key: string
    promise: Promise<void>
    controller: AbortController
  } | null>(null)
  const reload = useCallback(() => {
    if (inFlight.current?.key === key) return inFlight.current.promise
    const id = ++generation.current
    const controller = new AbortController()
    const promise = (async () => {
      await Promise.resolve()
      if (id !== generation.current) return
      setLoading(true)
      let timer: ReturnType<typeof setTimeout> | undefined
      let cancel = () => {}
      const deadline = new Promise<{ error: string }>((resolve) => {
        cancel = () => resolve({ error: 'Approvals request cancelled.' })
        controller.signal.addEventListener('abort', cancel, { once: true })
        timer = setTimeout(() => {
          resolve({ error: 'Approvals took too long. Try again.' })
          controller.abort()
        }, 30_000)
      })
      let response: Awaited<ReturnType<typeof approvalsApi.pending>>
      try {
        response = await Promise.race([
          approvalsApi.pending(JSON.parse(key), controller.signal),
          deadline,
        ])
      } catch {
        response = { error: "Couldn't load approvals." }
      } finally {
        clearTimeout(timer)
        controller.signal.removeEventListener('abort', cancel)
      }
      if (id !== generation.current) return
      setResult((current) =>
        response.data
          ? { key, data: response.data, at: new Date() }
          : {
              ...(current.key === key ? current : { key }),
              error: response.error || "Couldn't load approvals.",
            },
      )
      if (response.data) onReloaded?.(response.data.pending_entries)
      setLoading(false)
    })().finally(() => {
      if (inFlight.current?.controller === controller) inFlight.current = null
    })
    inFlight.current = { key, promise, controller }
    return promise
  }, [key, onReloaded])
  useEffect(() => {
    const counter = generation
    const flight = inFlight
    let active = true
    queueMicrotask(() => {
      if (active) void reload()
    })
    return () => {
      active = false
      counter.current++
      if (flight.current?.key === key) {
        flight.current.controller.abort()
        flight.current = null
      }
    }
  }, [key, reload])
  const pollingPaused =
    typeof paused === 'function'
      ? paused(result.key === key ? (result.data?.pending_entries ?? []) : [])
      : paused
  useEffect(() => {
    if (pollingPaused) return
    const onFocus = () => {
      return navigator.onLine ? reload() : undefined
    }
    window.addEventListener('focus', onFocus)
    const stop = startVisibilityAwarePolling(onFocus, 60_000)
    return () => {
      stop()
      window.removeEventListener('focus', onFocus)
    }
  }, [pollingPaused, reload])
  useEffect(() => {
    if (!loading) return
    const skeleton = window.setTimeout(() => setShowSkeleton(true), 300)
    const timer = window.setTimeout(() => setSlow(true), 8000)
    return () => {
      clearTimeout(skeleton)
      clearTimeout(timer)
      setShowSkeleton(false)
      setSlow(false)
    }
  }, [loading])
  const current = result.key === key
  return {
    data: current ? result.data : undefined,
    error: current ? result.error : undefined,
    loadedAt: current ? result.at : undefined,
    loading,
    slow,
    showSkeleton,
    reload,
  }
}
