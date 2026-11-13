import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { SlidersHorizontal } from 'lucide-react'
import { api, type ApprovalGroupOption, type LeaveRequest, type PayrollCutoffResponse, type TimeCategory, type UserSummary, type WorkerStatus } from '../../lib/api'
import { payStubsApi, type PayStubRequest } from '../../lib/payStubsApi'
import { approvalSelection, exclusionCopy, isOrdinary, pendingParams, rememberDepartment, rememberedDepartment, type ApprovalSelection } from '../../lib/approvalsFilters'
import type { ReviewEntry } from '../../lib/api/approvals'
import { useAuthContext } from '../../contexts/AuthContext'
import { useCapabilities } from '../../lib/useCapabilities'
import { useOnlineStatus } from '../../lib/useOnlineStatus'
import { formatPayPeriod } from '../../lib/payPeriods'
import { Button, EmptyState, ErrorState, OfflineBanner, PageHeader, SegmentedControl, SelectionBar, TabChips, useConfirm, useUnsavedChanges } from '../../components/ui'
import { useApprovalsQuery } from '../../components/approvals/useApprovalsQuery'
import { useReviewBatch } from '../../components/approvals/useReviewBatch'
import OrdinaryGroups from '../../components/approvals/OrdinaryGroups'
import NeedsLookList from '../../components/approvals/NeedsLookList'
import ReviewSheet from '../../components/approvals/ReviewSheet'
import ApproveAllDialog from '../../components/approvals/ApproveAllDialog'
import FiltersSheet from '../../components/approvals/FiltersSheet'
import LeaveRequestsList from '../../components/approvals/LeaveRequestsList'
import StubRequestsList from '../../components/approvals/StubRequestsList'
const Classic = lazy(() => import('./TimeTracking'))
type Kind = 'time' | 'leave' | 'stubs'
const EMPTY: ReviewEntry[] = []

export default function Approvals() {
  const [query] = useSearchParams()
  return query.get('classic') === '1' ? <Suspense fallback={<p>Loading approvals…</p>}><Classic section="approvals" /></Suspense> : <ApprovalsInbox />
}
function ApprovalsInbox() {
  const { currentUser } = useAuthContext()
  const capabilities = useCapabilities()
  const online = useOnlineStatus()
  const [query, setQuery] = useSearchParams()
  const department = query.get('dept') || rememberedDepartment(currentUser?.id)
  const kind: Kind = query.get('kind') === 'leave' ? 'leave' : query.get('kind') === 'stubs' && capabilities.send_pay_statements ? 'stubs' : 'time'
  const groupBy = query.get('group') === 'day' ? 'day' : 'person'
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [review, setReview] = useState<ReviewEntry | null>(null)
  const [reviewDirty, setReviewDirty] = useState(false)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [confirmation, setConfirmation] = useState<{ snapshot: ApprovalSelection; all: boolean } | null>(null)
  const [people, setPeople] = useState<UserSummary[]>([])
  const [groups, setGroups] = useState<ApprovalGroupOption[]>([])
  const [categories, setCategories] = useState<TimeCategory[]>([])
  const [workers, setWorkers] = useState<WorkerStatus[]>([])
  const [cutoff, setCutoff] = useState<PayrollCutoffResponse | null>(null)
  const [leave, setLeave] = useState<LeaveRequest[]>([])
  const [stubs, setStubs] = useState<PayStubRequest[]>([])
  const [extrasError, setExtrasError] = useState<{ leave?: string; stubs?: string; workers?: string }>({})
  const [extrasLoading, setExtrasLoading] = useState(true)
  const [confirm, confirmDialog] = useConfirm()
  const changing = useRef(false)
  const params = useMemo(() => pendingParams(query, department), [query, department])
  const inbox = useApprovalsQuery(params, Boolean(selected.size || review || confirmation))
  const batches = useReviewBatch(inbox.reload)
  const entries = inbox.data?.pending_entries ?? EMPTY
  const ordinary = entries.filter(isOrdinary)
  const needsLook = entries.filter(entry => !isOrdinary(entry))
  const selectedRows = ordinary.filter(entry => selected.has(entry.id))
  const selection = selectedRows.length ? approvalSelection(selectedRows) : null
  const unsaved = useUnsavedChanges({ dirty: selected.size > 0 || reviewDirty, what: 'Approvals', onSave: () => {}, onDiscard: () => { setSelected(new Set()); setReviewDirty(false) } })

  const loadExtras = useCallback(async () => {
    setExtrasLoading(true)
    const loadLeave = async () => {
      const rows: LeaveRequest[] = []
      for (let page = 1; ; page++) {
        const response = await api.getLeaveRequests('pending', page, 100)
        if (!response.data) throw new Error(response.error || "Couldn't load leave requests.")
        rows.push(...response.data.leave_requests)
        if (page >= response.data.pagination.total_pages) return rows
      }
    }
    const [leaveResult, stubResult, workerResult] = await Promise.allSettled([loadLeave(), capabilities.send_pay_statements ? payStubsApi.requests('open') : Promise.resolve({ requests: [] }), api.getWhosWorking()])
    const errors: typeof extrasError = {}
    if (leaveResult.status === 'fulfilled') setLeave(leaveResult.value); else errors.leave = String(leaveResult.reason)
    if (stubResult.status === 'fulfilled') setStubs(stubResult.value.requests); else errors.stubs = "Couldn't load pay stub requests."
    if (workerResult.status === 'fulfilled' && workerResult.value.data) setWorkers(workerResult.value.data.workers); else errors.workers = "Couldn't check open clocks."
    setExtrasError(errors); setExtrasLoading(false)
  }, [capabilities.send_pay_statements])
  useEffect(() => {
    void loadExtras()
    let active = true
    void Promise.all([api.getUsers(), api.getTimeCategories(), api.getPayrollCutoff()]).then(([users, cats, period]) => {
      if (!active) return
      if (users.data) { setPeople(users.data.users); setGroups(users.data.approval_groups ?? []) }
      if (cats.data) setCategories(cats.data.time_categories)
      if (period.data) setCutoff(period.data)
    })
    return () => { active = false }
  }, [loadExtras])
  const changeQuery = async (next: URLSearchParams) => {
    if (changing.current || batches.busy) return
    changing.current = true
    try {
      if ((selected.size || reviewDirty) && !(await confirm({ title: 'Clear your selection?', description: 'Changing this view clears the selected shifts and unsaved review note.', confirmLabel: 'Clear and continue', cancelLabel: 'Keep reviewing' }))) return
      setSelected(new Set()); setReview(null); setReviewDirty(false); setConfirmation(null); setQuery(next); rememberDepartment(currentUser?.id, next.get('dept') || department)
    } finally { changing.current = false }
  }
  const updateQuery = (key: string, value: string) => { const next = new URLSearchParams(query); next.set(key, value); void changeQuery(next) }
  const approveSnapshot = async (snapshot: ApprovalSelection) => {
    const complete = await batches.approve(snapshot.items, inbox.data?.review_summary.batch_limit ?? 0,
      `Approved ${snapshot.rows.length} shifts${snapshot.people.length === 1 ? ` for ${snapshot.people[0].name}` : ''}`)
    setSelected(new Set()); setConfirmation(null)
    return complete
  }
  const requestSelection = (forceConfirm = false) => {
    if (!selection || batches.busy || !online) return
    if (forceConfirm || selection.people.length > 1) setConfirmation({ snapshot: selection, all: false })
    else void approveSnapshot(selection)
  }
  const toggleSelected = (rows: ReviewEntry[], checked: boolean) => {
    setSelected(current => { const next = new Set(current); rows.forEach(row => { if (checked) next.add(row.id); else next.delete(row.id) }); return next })
  }
  const closeReview = async (saved = false) => {
    if (batches.busy) return
    if (!saved && reviewDirty && !(await confirm({ title: 'Discard this note?', confirmLabel: 'Discard note', cancelLabel: 'Keep reviewing' }))) return
    setReviewDirty(false); setReview(null)
  }
  const disabled = batches.busy || !online || inbox.loading || Boolean(inbox.error)
  const disabledReason = !online ? 'Reconnect to approve' : inbox.loading ? 'Wait for approvals to finish loading' : inbox.error ? 'Reload approvals before saving' : undefined
  const viewerGroups = people.find(person => person.id === currentUser?.id)?.approval_group_keys ?? (currentUser?.approval_group ? [currentUser.approval_group] : [])
  const attention = workers.filter(worker => worker.open_since_work_date && worker.open_entry_id && (!viewerGroups.length || people.some(person => person.id === worker.user.id && person.approval_group_keys?.some(key => viewerGroups.includes(key)))))
  const lockAt = cutoff?.cutoff.cutoff_at
  const lockCopy = lockAt ? `They'll go to payroll at the ${new Intl.DateTimeFormat('en-US', { timeZone: 'Pacific/Guam', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(lockAt))} lock.` : undefined
  const departmentOptions = groups.length ? groups.map(group => ({ value: group.key, label: group.label })) : [{ value: 'cfi', label: 'CFI' }, { value: 'ops', label: 'Ops/Maint' }]
  const periodLabel = cutoff?.cutoff.period ? formatPayPeriod({ start: cutoff.cutoff.period.start_date, end: cutoff.cutoff.period.end_date }) : ''
  const filterCount = ['period', 'date', 'start_date', 'end_date', 'through_date', 'since_date', 'user_id', 'time_category_id', 'approval_type', 'entry_method', 'clock_source'].filter(key => query.has(key)).length
  return <div className="space-y-3 pb-6" onKeyDown={event => {
    if (event.shiftKey && event.key.toLowerCase() === 'a' && !event.altKey && !event.ctrlKey && !event.metaKey && !(event.target as HTMLElement).closest('input,textarea,select,[aria-modal="true"]')) { event.preventDefault(); requestSelection(true) }
  }}>
    <PageHeader title="Approvals" description={`${inbox.data?.count ?? '…'} waiting${periodLabel ? ` · ${periodLabel}` : ''}${lockAt ? ` locks ${new Intl.DateTimeFormat('en-US', { timeZone: 'Pacific/Guam', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(lockAt))}` : ''}`} />
    <OfflineBanner loadedAt={inbox.loadedAt} />
    <TabChips label="What's waiting" value={kind} controls="approvals-panel" items={[{ value: 'time', label: 'Time', count: inbox.data?.count }, { value: 'leave', label: 'Leave', count: leave.length }, ...(capabilities.send_pay_statements && stubs.length ? [{ value: 'stubs' as const, label: 'Pay stubs', count: stubs.length }] : [])]} onChange={value => updateQuery('kind', value)} />
    <div className="flex items-center gap-1"><div className="min-w-0 flex-1"><TabChips label="Department" value={department} items={[...departmentOptions, { value: 'all', label: 'Everyone' }]} onChange={value => { const next = new URLSearchParams(query); next.set('dept', value); void changeQuery(next) }} /></div><Button variant="ghost" aria-label={`Filters${filterCount ? ` (${filterCount})` : ''}`} onClick={() => setFiltersOpen(true)}><SlidersHorizontal className="size-4" aria-hidden="true" /><span className="hidden sm:inline">Filters</span>{filterCount > 0 && <span>{filterCount}</span>}</Button></div>
    {attention.map(worker => <div key={worker.user.id} className="rounded-card border border-amber-200 bg-amber-50 px-4 py-3 text-body-sm"><strong>{worker.user.full_name}</strong> is still clocked in from {worker.open_since_work_date}{worker.clock_in_at ? `, ${new Intl.DateTimeFormat('en-US', { timeZone: 'Pacific/Guam', hour: 'numeric', minute: '2-digit' }).format(new Date(worker.clock_in_at))}` : ''}. <Link className="inline-flex min-h-11 items-center font-semibold underline" to={`/admin/timecards?entry_id=${worker.open_entry_id}&date=${worker.open_since_work_date}&user_id=${worker.user.id}`}>Fix clock-out</Link></div>)}
    {extrasError.workers && <ErrorState title={extrasError.workers} onRetry={() => { void loadExtras() }} />}
    {batches.notice && <p role="status" className="rounded-card border border-amber-200 bg-amber-50 p-3 text-body-sm">{batches.notice}</p>}
    {batches.undoBatches.length > 0 && <div className="flex flex-wrap items-center gap-2 text-body-sm"><span>Recent approvals · Undo is available for 15 minutes</span><Button variant="ghost" disabled={batches.busy || !online} title={!online ? 'Reconnect to undo' : undefined} onClick={() => { void batches.undo(batches.undoBatches) }}>Undo recent approvals</Button></div>}
    <div id="approvals-panel" role="tabpanel" className="space-y-4">
      {kind === 'time' && <>
        {inbox.error && <ErrorState title="Couldn't load approvals." description={inbox.error} onRetry={() => { void inbox.reload() }} />}
        {inbox.showSkeleton && <div aria-label="Loading approvals" className="space-y-2">{[1, 2, 3].map(row => <div key={row} className="h-14 animate-pulse rounded-card bg-slate-100 motion-reduce:animate-none" />)}</div>}
        {inbox.slow && <ErrorState title="Still loading…" onRetry={() => { void inbox.reload() }} />}
        {!inbox.error && <>
          <NeedsLookList rows={needsLook} onReview={setReview} viewerId={currentUser?.id} />
          {ordinary.length > 0 ? <section className="space-y-3"><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-body font-semibold">Ordinary shifts · {ordinary.length} · {ordinary.reduce((sum, row) => sum + row.hours, 0).toFixed(1)}h</h2><Button variant="ghost" disabled={disabled || !inbox.data?.review_summary.complete} title={disabledReason || (!inbox.data?.review_summary.complete ? 'Narrow the filters to load a complete list' : undefined)} onClick={() => setConfirmation({ snapshot: approvalSelection(ordinary), all: true })}>Approve all {ordinary.length}</Button></div>
            <SegmentedControl label="Group shifts" options={[{ value: 'person', label: 'By person' }, { value: 'day', label: 'By day' }]} value={groupBy} onChange={value => updateQuery('group', value)} />
            <p className="text-body-sm text-ink-muted">Phone or kiosk clock-ins, no edits, no overtime, under the shift limit</p>
            <OrdinaryGroups rows={ordinary} groupBy={groupBy} selected={selected} onSelect={toggleSelected} disabled={disabled} disabledReason={disabledReason} onApprove={rows => { void approveSnapshot(approvalSelection(rows)) }} />
          </section> : !inbox.loading && (needsLook.length ? <EmptyState title={`No ordinary shifts. ${needsLook.length} need a look above.`} /> : <EmptyState title="All caught up." description={`Nothing is waiting for approval${department !== 'all' ? ` in ${departmentOptions.find(item => item.value === department)?.label || department}` : ''}.`} action={department !== 'all' ? <Button variant="secondary" onClick={() => updateQuery('dept', 'all')}>See everyone</Button> : undefined} />)}
          {inbox.data && !inbox.data.review_summary.complete && <p className="text-body-sm text-ink-muted">Showing {entries.length} of {inbox.data.count} shifts. Narrow the filters to approve all.</p>}
        </>}
      </>}
      {kind === 'leave' && (extrasError.leave ? <ErrorState title="Couldn't load leave requests." onRetry={() => { void loadExtras() }} /> : extrasLoading ? <p>Loading leave requests…</p> : <LeaveRequestsList requests={leave} viewerId={currentUser?.id} onChanged={loadExtras} />)}
      {kind === 'stubs' && (extrasError.stubs ? <ErrorState title={extrasError.stubs} onRetry={() => { void loadExtras() }} /> : <StubRequestsList requests={stubs} canChooseRecipient={capabilities.preview_pay} onChanged={loadExtras} />)}
    </div>
    <p className="hidden text-body-sm text-ink-subtle lg:block">↑↓ or j/k move · Space selects · Enter opens · Esc clears · Shift+A reviews selected approvals</p>
    <SelectionBar count={selectedRows.length} noun={['shift', 'shifts']} label="Selected shifts" summary={selection ? `${selection.people.length} people · ${selection.hours.toFixed(1)}h` : undefined} onClear={() => setSelected(new Set())} actions={<Button disabled={disabled} title={disabledReason} onClick={() => requestSelection()}>Approve {selectedRows.length}</Button>} />
    <ApproveAllDialog selection={confirmation?.snapshot ?? null} ordinary={confirmation?.all} exclusions={exclusionCopy(needsLook)} lockCopy={lockCopy} busy={batches.busy} onCancel={() => setConfirmation(null)} onConfirm={() => { if (confirmation && !disabled) void approveSnapshot(confirmation.snapshot) }} />
    {filtersOpen && <FiltersSheet query={query} categories={categories} people={people.map(person => ({ id: person.id, name: person.full_name }))} onClose={() => setFiltersOpen(false)} onApply={next => { setFiltersOpen(false); void changeQuery(next) }} />}
    {review && <ReviewSheet key={review.id} entry={review} categories={categories} busy={batches.busy} onDirty={setReviewDirty} onClose={saved => { void closeReview(saved) }} onReload={inbox.reload} onApprove={(items, label) => batches.approve(items, 31, label, 'reviewed')} />}
    {unsaved.guard}{confirmDialog}
  </div>
}
