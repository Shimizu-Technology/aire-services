import { useCallback, useEffect, useRef, useState } from 'react'
import type { PendingApprovalsParams } from '../../lib/api'
import { approvalsApi, type ApprovalsResponse } from '../../lib/api/approvals'
import { startVisibilityAwarePolling } from '../../lib/visibilityPolling'

export function useApprovalsQuery(params: PendingApprovalsParams, paused: boolean) {
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
  const reload = useCallback(async () => {
    const id = ++generation.current
    await Promise.resolve()
    if (id !== generation.current) return
    setLoading(true)
    const response = await approvalsApi.pending(JSON.parse(key))
    if (id !== generation.current) return
    setResult(current =>
      response.data
        ? { key, data: response.data, at: new Date() }
        : { ...current, key, error: response.error || "Couldn't load approvals." },
    )
    setLoading(false)
  }, [key])
  useEffect(() => {
    const counter = generation
    let active = true
    queueMicrotask(() => {
      if (active) void reload()
    })
    return () => {
      active = false
      counter.current++
    }
  }, [reload])
  useEffect(() => {
    if (paused) return
    const onFocus = () => {
      if (navigator.onLine) void reload()
    }
    window.addEventListener('focus', onFocus)
    const stop = startVisibilityAwarePolling(onFocus, 60_000)
    return () => {
      stop()
      window.removeEventListener('focus', onFocus)
    }
  }, [paused, reload])
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
    loadedAt: result.at,
    loading,
    slow,
    showSkeleton,
    reload,
  }
}
