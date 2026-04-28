import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../../lib/api'
import type { LeaveRequest, PaginationMeta } from '../../lib/api'

const LEAVE_TYPE_OPTIONS: Array<{ value: LeaveRequest['leave_type']; label: string }> = [
  { value: 'paid_time_off', label: 'Paid time off' },
  { value: 'sick', label: 'Sick leave' },
  { value: 'unpaid', label: 'Unpaid leave' },
  { value: 'bereavement', label: 'Bereavement' },
  { value: 'other', label: 'Other' },
]

const STATUS_STYLES: Record<LeaveRequest['status'], string> = {
  pending: 'border-amber-200 bg-amber-50 text-amber-700',
  approved: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  declined: 'border-rose-200 bg-rose-50 text-rose-700',
  cancelled: 'border-slate-200 bg-slate-100 text-slate-600',
}

function formatDate(value: string) {
  return new Date(`${value}T00:00:00`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function requestOwnerName(request: LeaveRequest) {
  return request.user.full_name || request.user.display_name || request.user.email.split('@')[0]
}

interface LeaveRequestsPanelProps {
  isAdmin: boolean
}

export default function LeaveRequestsPanel({ isAdmin }: LeaveRequestsPanelProps) {
  const [requests, setRequests] = useState<LeaveRequest[]>([])
  const [pagination, setPagination] = useState<PaginationMeta | null>(null)
  const [pendingPagination, setPendingPagination] = useState<PaginationMeta | null>(null)
  const [reviewedRequests, setReviewedRequests] = useState<LeaveRequest[]>([])
  const [reviewedPagination, setReviewedPagination] = useState<PaginationMeta | null>(null)
  const [page, setPage] = useState(1)
  const [reviewedPage, setReviewedPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionLoadingId, setActionLoadingId] = useState<number | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [reviewNotes, setReviewNotes] = useState<Record<number, string>>({})
  const latestLoadRequestId = useRef(0)
  const [formData, setFormData] = useState({
    leave_type: 'paid_time_off' as LeaveRequest['leave_type'],
    start_date: '',
    end_date: '',
    reason: '',
  })

  const loadRequests = useCallback(async (targetPage: number, targetReviewedPage: number) => {
    const requestId = ++latestLoadRequestId.current

    if (isAdmin) {
      const [pendingResult, reviewedResult] = await Promise.all([
        api.getLeaveRequests('pending', targetPage),
        api.getLeaveRequests('reviewed', targetReviewedPage),
      ])

      if (requestId !== latestLoadRequestId.current) return false

      if (pendingResult.error || !pendingResult.data || reviewedResult.error || !reviewedResult.data) {
        setError(pendingResult.error || reviewedResult.error || 'Failed to load leave requests.')
        setLoading(false)
        return false
      }

      setError(null)
      setRequests(pendingResult.data.leave_requests)
      setPagination(pendingResult.data.pagination)
      setPendingPagination(pendingResult.data.pagination)
      setReviewedRequests(reviewedResult.data.leave_requests)
      setReviewedPagination(reviewedResult.data.pagination)
      setLoading(false)
      return true
    }

    const result = await api.getLeaveRequests(undefined, targetPage)
    if (requestId !== latestLoadRequestId.current) return false

    if (result.error || !result.data) {
      setError(result.error || 'Failed to load leave requests.')
      setLoading(false)
      return false
    }

    setError(null)
    setRequests(result.data.leave_requests)
    setPagination(result.data.pagination)
    setPendingPagination(null)
    setReviewedRequests([])
    setReviewedPagination(null)
    setLoading(false)
    return true
  }, [isAdmin])

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadRequests(page, reviewedPage)
    }, 0)

    return () => {
      window.clearTimeout(timeoutId)
      latestLoadRequestId.current += 1
    }
  }, [loadRequests, page, reviewedPage])

  const historyRequests = useMemo(
    () => (isAdmin ? reviewedRequests : requests.filter((request) => request.status !== 'pending')),
    [isAdmin, requests, reviewedRequests],
  )

  const submitRequest = async (event: React.FormEvent) => {
    event.preventDefault()
    setSubmitting(true)
    setError(null)

    const result = await api.createLeaveRequest({
      leave_type: formData.leave_type,
      start_date: formData.start_date,
      end_date: formData.end_date,
      reason: formData.reason.trim() || undefined,
    })

    if (result.error) {
      setError(result.error)
      setSubmitting(false)
      return
    }

    setFormData({
      leave_type: 'paid_time_off',
      start_date: '',
      end_date: '',
      reason: '',
    })

    if (page === 1) {
      setLoading(true)
      await loadRequests(1, reviewedPage)
    } else {
      setLoading(true)
      setPage(1)
    }

    setSubmitting(false)
  }

  const runReviewAction = useCallback(async (request: LeaveRequest, action: 'approve' | 'decline' | 'cancel') => {
    setActionLoadingId(request.id)
    setError(null)

    const reviewNote = reviewNotes[request.id]?.trim()
    const result = await (
      action === 'approve'
        ? api.approveLeaveRequest(request.id, reviewNote || undefined)
        : action === 'decline'
          ? api.declineLeaveRequest(request.id, reviewNote || undefined)
          : api.cancelLeaveRequest(request.id)
    )

    if (result.error) {
      setError(result.error)
      setActionLoadingId(null)
      return
    }

    setReviewNotes((current) => {
      const next = { ...current }
      delete next[request.id]
      return next
    })
    setLoading(true)
    await loadRequests(page, reviewedPage)
    setActionLoadingId(null)
  }, [loadRequests, page, reviewNotes, reviewedPage])

  const changePage = useCallback((nextPage: number) => {
    setLoading(true)
    setPage(nextPage)
  }, [])

  const changeReviewedPage = useCallback((nextPage: number) => {
    setLoading(true)
    setReviewedPage(nextPage)
  }, [])

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 className="text-lg font-semibold text-slate-900">Leave requests</h2>
          <p className="mt-1 text-sm text-slate-500">
            Submit time-off requests here so approvals stay in the app instead of getting lost in chat or email.
          </p>
        </div>
        <form onSubmit={submitRequest} className="space-y-4 px-5 py-5">
          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
          )}
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">Leave type</label>
              <select
                value={formData.leave_type}
                onChange={(event) => setFormData((current) => ({ ...current, leave_type: event.target.value as LeaveRequest['leave_type'] }))}
                className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-100"
              >
                {LEAVE_TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">Start date</label>
              <input
                type="date"
                required
                value={formData.start_date}
                onChange={(event) => setFormData((current) => ({ ...current, start_date: event.target.value }))}
                className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-100"
              />
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">End date</label>
              <input
                type="date"
                required
                value={formData.end_date}
                min={formData.start_date || undefined}
                onChange={(event) => setFormData((current) => ({ ...current, end_date: event.target.value }))}
                className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-100"
              />
            </div>
            <div className="flex items-end">
              <button
                type="submit"
                disabled={submitting}
                className="w-full rounded-xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
              >
                {submitting ? 'Submitting…' : 'Submit request'}
              </button>
            </div>
          </div>
          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">Notes</label>
            <textarea
              rows={3}
              value={formData.reason}
              onChange={(event) => setFormData((current) => ({ ...current, reason: event.target.value }))}
              placeholder="Optional details for the approver."
              className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-100"
            />
          </div>
        </form>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-4">
          <h3 className="text-lg font-semibold text-slate-900">
            {isAdmin ? `Pending approvals${pendingPagination ? ` (${pendingPagination.total_count})` : ''}` : 'My requests'}
          </h3>
        </div>
        {loading ? (
          <div className="px-5 py-10 text-sm text-slate-500">Loading leave requests…</div>
        ) : (
          <div className="space-y-4 px-5 py-5">
            {requests.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                No leave requests to show yet.
              </div>
            ) : (
              requests.map((request) => (
                <article key={request.id} className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h4 className="text-base font-semibold text-slate-900">
                          {LEAVE_TYPE_OPTIONS.find((option) => option.value === request.leave_type)?.label ?? request.leave_type}
                        </h4>
                        <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.12em] ${STATUS_STYLES[request.status]}`}>
                          {request.status}
                        </span>
                      </div>
                      <p className="mt-2 text-sm text-slate-600">
                        {formatDate(request.start_date)} to {formatDate(request.end_date)} • {request.total_days} day{request.total_days === 1 ? '' : 's'}
                      </p>
                      {isAdmin && (
                        <p className="mt-1 text-sm text-slate-500">Requested by {requestOwnerName(request)}</p>
                      )}
                      {request.reason && (
                        <p className="mt-3 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">{request.reason}</p>
                      )}
                      {request.review_note && request.status !== 'pending' && (
                        <p className="mt-3 text-sm text-slate-500">
                          Review note: <span className="text-slate-700">{request.review_note}</span>
                        </p>
                      )}
                    </div>
                    {request.reviewed_by && request.status !== 'pending' && (
                      <div className="text-sm text-slate-500">
                        Reviewed by {request.reviewed_by.full_name}
                      </div>
                    )}
                  </div>

                  {isAdmin && request.status === 'pending' && (
                    <div className="mt-4 space-y-3 border-t border-slate-200 pt-4">
                      <textarea
                        rows={2}
                        value={reviewNotes[request.id] || ''}
                        onChange={(event) => setReviewNotes((current) => ({ ...current, [request.id]: event.target.value }))}
                        placeholder="Optional note for the employee."
                        className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-100"
                      />
                      <div className="flex flex-wrap gap-3">
                        <button
                          type="button"
                          disabled={actionLoadingId === request.id}
                          onClick={() => void runReviewAction(request, 'approve')}
                          className="rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-50"
                        >
                          {actionLoadingId === request.id ? 'Saving…' : 'Approve'}
                        </button>
                        <button
                          type="button"
                          disabled={actionLoadingId === request.id}
                          onClick={() => void runReviewAction(request, 'decline')}
                          className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm font-semibold text-rose-700 transition hover:bg-rose-100 disabled:opacity-50"
                        >
                          Decline
                        </button>
                      </div>
                    </div>
                  )}

                  {!isAdmin && request.status === 'pending' && (
                    <div className="mt-4 border-t border-slate-200 pt-4">
                      <button
                        type="button"
                        disabled={actionLoadingId === request.id}
                        onClick={() => void runReviewAction(request, 'cancel')}
                        className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 disabled:opacity-50"
                      >
                        {actionLoadingId === request.id ? 'Saving…' : 'Cancel request'}
                      </button>
                    </div>
                  )}
                </article>
              ))
            )}
            {pagination && pagination.total_pages > 1 && (
              <div className="flex items-center justify-between border-t border-slate-200 pt-4 text-sm text-slate-500">
                <span>
                  Page {pagination.current_page} of {pagination.total_pages}
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={pagination.current_page <= 1}
                    onClick={() => changePage(Math.max(1, pagination.current_page - 1))}
                    className="rounded-xl border border-slate-300 bg-white px-3 py-2 font-semibold text-slate-700 transition hover:bg-slate-100 disabled:opacity-50"
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    disabled={pagination.current_page >= pagination.total_pages}
                    onClick={() => changePage(Math.min(pagination.total_pages, pagination.current_page + 1))}
                    className="rounded-xl border border-slate-300 bg-white px-3 py-2 font-semibold text-slate-700 transition hover:bg-slate-100 disabled:opacity-50"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      {isAdmin && (historyRequests.length > 0 || (reviewedPagination?.total_count ?? 0) > 0) && (
        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-5 py-4">
            <h3 className="text-lg font-semibold text-slate-900">Reviewed requests</h3>
          </div>
          <div className="space-y-4 px-5 py-5">
            {historyRequests.map((request) => (
              <article key={request.id} className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="text-base font-semibold text-slate-900">{requestOwnerName(request)}</h4>
                      <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.12em] ${STATUS_STYLES[request.status]}`}>
                        {request.status}
                      </span>
                    </div>
                    <p className="mt-2 text-sm text-slate-600">
                      {formatDate(request.start_date)} to {formatDate(request.end_date)} • {request.total_days} day{request.total_days === 1 ? '' : 's'}
                    </p>
                  </div>
                  <div className="text-sm text-slate-500">
                    {request.reviewed_by ? `Reviewed by ${request.reviewed_by.full_name}` : 'Awaiting review'}
                  </div>
                </div>
              </article>
            ))}
            {reviewedPagination && reviewedPagination.total_pages > 1 && (
              <div className="flex items-center justify-between border-t border-slate-200 pt-4 text-sm text-slate-500">
                <span>
                  Page {reviewedPagination.current_page} of {reviewedPagination.total_pages}
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={reviewedPagination.current_page <= 1}
                    onClick={() => changeReviewedPage(Math.max(1, reviewedPagination.current_page - 1))}
                    className="rounded-xl border border-slate-300 bg-white px-3 py-2 font-semibold text-slate-700 transition hover:bg-slate-100 disabled:opacity-50"
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    disabled={reviewedPagination.current_page >= reviewedPagination.total_pages}
                    onClick={() => changeReviewedPage(Math.min(reviewedPagination.total_pages, reviewedPagination.current_page + 1))}
                    className="rounded-xl border border-slate-300 bg-white px-3 py-2 font-semibold text-slate-700 transition hover:bg-slate-100 disabled:opacity-50"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  )
}
