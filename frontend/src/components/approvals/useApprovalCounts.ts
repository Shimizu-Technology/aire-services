import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { api } from '../../lib/api'
import { startVisibilityAwarePolling } from '../../lib/visibilityPolling'

/** The shell always counts the default department, with no inbox filters. */
export function useApprovalCounts(enabled: boolean, department: string) {
  const [counts, setCounts] = useState<{
    department: string
    count: number | null
    total: number | null
  }>({ department, count: null, total: null })
  const generation = useRef(0)
  const location = useLocation()
  const refreshApprovalCount = useCallback(async () => {
    if (!enabled) return
    const request = ++generation.current
    const read = (scope: string) =>
      api.getPendingApprovals({
        page: 1,
        per_page: 1,
        ...(scope !== 'all' ? { approval_group: scope } : {}),
      })
    const [own, all] = await Promise.allSettled([
      read(department),
      department === 'all' ? Promise.resolve(null) : read('all'),
    ])
    if (request !== generation.current) return
    const ownData = own.status === 'fulfilled' ? own.value.data : undefined
    const allData =
      department === 'all'
        ? ownData
        : all.status === 'fulfilled'
          ? all.value?.data
          : undefined
    setCounts((previous) => ({
      department,
      count:
        ownData?.count ??
        ownData?.summary?.entry_count ??
        (previous.department === department ? previous.count : null),
      total: allData?.count ?? allData?.summary?.entry_count ?? previous.total,
    }))
  }, [enabled, department])

  useEffect(() => {
    void refreshApprovalCount()
    const stop = startVisibilityAwarePolling(refreshApprovalCount, 60_000)
    return () => {
      ++generation.current
      stop()
    }
  }, [refreshApprovalCount, location.pathname])

  return {
    approvalCount: enabled && counts.department === department ? counts.count : null,
    allApprovalCount: enabled ? counts.total : null,
    refreshApprovalCount,
  }
}
