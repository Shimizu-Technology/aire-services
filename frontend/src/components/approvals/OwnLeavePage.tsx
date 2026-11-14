import { useCallback } from 'react'
import { useAuthContext } from '../../contexts/AuthContext'
import { api, type LeaveRequest } from '../../lib/api'
import LeaveRequestsPanel from '../time-tracking/LeaveRequestsPanel'

/** The existing form/list, fed only the viewer's requests and without review actions. */
export default function OwnLeavePage() {
  const { currentUser } = useAuthContext()
  const viewerId = currentUser?.id
  const requestSource = useCallback<typeof api.getLeaveRequests>(
    async (_status, page = 1, perPage = 25) => {
      const own: LeaveRequest[] = []
      // Approvers' index is team-wide. Read every page before filtering and
      // paginating locally so their own older requests cannot disappear.
      for (let sourcePage = 1; ; sourcePage++) {
        const response = await api.getLeaveRequests(undefined, sourcePage, 100)
        if (!response.data) return response
        own.push(...response.data.leave_requests.filter(request => request.user.id === viewerId))
        if (sourcePage >= response.data.pagination.total_pages) break
      }
      return {
        data: {
          leave_requests: own.slice((page - 1) * perPage, page * perPage),
          pagination: {
            current_page: page,
            per_page: perPage,
            total_count: own.length,
            total_pages: Math.max(1, Math.ceil(own.length / perPage)),
          },
        },
      }
    },
    [viewerId],
  )

  if (!currentUser) return <p>Loading your leave…</p>
  return (
    <LeaveRequestsPanel
      canApproveLeave={false}
      canRequestLeave={currentUser.time_tracking_enabled === true}
      currentUserId={viewerId}
      requestSource={requestSource}
    />
  )
}
