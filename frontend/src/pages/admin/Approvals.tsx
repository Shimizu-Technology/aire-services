import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  api,
  type ApprovalGroupOption,
  type LeaveRequest,
  type PayrollCutoffResponse,
  type TimeCategory,
  type UserSummary,
  type WorkerStatus,
} from '../../lib/api'
import { payStubsApi, type PayStubRequest } from '../../lib/payStubsApi'
import {
  approvalSelection,
  exclusionCopy,
  isOrdinary,
  pendingParams,
  rememberDepartment,
  rememberedDepartment,
  type ApprovalSelection,
} from '../../lib/approvalsFilters'
import type { ReviewEntry, ReviewItem } from '../../lib/api/approvals'
import { useAuthContext } from '../../contexts/AuthContext'
import { useCapabilities } from '../../lib/useCapabilities'
import { useOnlineStatus } from '../../lib/useOnlineStatus'
import { approvalLockCopy } from '../../components/approvals/approvalLockCopy'
import {
  Button,
  ErrorState,
  SelectionBar,
  useConfirm,
  useUnsavedChanges,
  useToast,
} from '../../components/ui'
import { useApprovalsQuery } from '../../components/approvals/useApprovalsQuery'
import { useReviewBatch } from '../../components/approvals/useReviewBatch'
import ApprovalsHeader, { type ApprovalKind } from '../../components/approvals/ApprovalsHeader'
import ApprovalsAttention from '../../components/approvals/ApprovalsAttention'
import ApprovalsTimePanel from '../../components/approvals/ApprovalsTimePanel'
import RecentApprovals from '../../components/approvals/RecentApprovals'
import ReviewSheet from '../../components/approvals/ReviewSheet'
import ApproveAllDialog from '../../components/approvals/ApproveAllDialog'
import FiltersSheet from '../../components/approvals/FiltersSheet'
import LeaveRequestsList from '../../components/approvals/LeaveRequestsList'
import StubRequestsList from '../../components/approvals/StubRequestsList'

const Classic = lazy(() => import('./TimeTracking'))
const EMPTY: ReviewEntry[] = []
const FILTER_KEYS = [
  'period',
  'date',
  'start_date',
  'end_date',
  'through_date',
  'since_date',
  'user_id',
  'time_category_id',
  'approval_type',
  'entry_method',
  'clock_source',
]

interface ExtrasError {
  leave?: string
  stubs?: string
  workers?: string
}

async function loadPendingLeave() {
  const rows: LeaveRequest[] = []
  for (let page = 1; ; page++) {
    const response = await api.getLeaveRequests('pending', page, 100)
    if (!response.data) throw new Error(response.error || "Couldn't load leave requests.")
    rows.push(...response.data.leave_requests)
    if (page >= response.data.pagination.total_pages) return rows
  }
}

export default function Approvals() {
  const [query] = useSearchParams()
  if (query.get('classic') === '1') {
    return (
      <Suspense fallback={<p>Loading approvals…</p>}>
        <Classic section="approvals" />
      </Suspense>
    )
  }
  return <ApprovalsInbox />
}

function ApprovalsInbox() {
  const { currentUser } = useAuthContext()
  const capabilities = useCapabilities()
  const online = useOnlineStatus()
  const [query, setQuery] = useSearchParams()
  const requestedDepartment = query.get('dept') || rememberedDepartment(currentUser?.id)
  const groupBy = query.get('group') === 'day' ? 'day' : 'person'
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [review, setReview] = useState<ReviewEntry | null>(null)
  const [reviewDirty, setReviewDirty] = useState(false)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [confirmation, setConfirmation] = useState<{
    snapshot: ApprovalSelection
    all: boolean
  } | null>(null)
  const [people, setPeople] = useState<UserSummary[]>([])
  const [groups, setGroups] = useState<ApprovalGroupOption[]>([])
  const [peopleLoading, setPeopleLoading] = useState(true)
  const [peopleError, setPeopleError] = useState('')
  const department =
    !peopleLoading &&
    !peopleError &&
    requestedDepartment !== 'all' &&
    !groups.some(group => group.key === requestedDepartment)
      ? 'all'
      : requestedDepartment
  const [categories, setCategories] = useState<TimeCategory[]>([])
  const [workers, setWorkers] = useState<WorkerStatus[]>([])
  const [cutoff, setCutoff] = useState<PayrollCutoffResponse | null>(null)
  const [leave, setLeave] = useState<LeaveRequest[]>([])
  const [stubs, setStubs] = useState<PayStubRequest[]>([])
  const [extrasError, setExtrasError] = useState<ExtrasError>({})
  const [extrasLoading, setExtrasLoading] = useState(true)
  const [confirm, confirmDialog] = useConfirm()
  const toast = useToast()
  const changing = useRef(false)
  const params = useMemo(() => pendingParams(query, department), [query, department])
  const pruneSelection = useCallback((rows: ReviewEntry[]) => {
    const ordinaryIds = new Set(rows.filter(isOrdinary).map(row => row.id))
    setSelected(current => {
      const retained = new Set([...current].filter(id => ordinaryIds.has(id)))
      return retained.size === current.size ? current : retained
    })
  }, [])
  const inbox = useApprovalsQuery(
    params,
    rows => {
      const selectedRows = rows.filter(isOrdinary).filter(row => selected.has(row.id))
      return Boolean(selectedRows.length || review || confirmation)
    },
    pruneSelection,
  )
  const removeApprovedSelection = useCallback((ids: number[]) => {
    setSelected(current => new Set([...current].filter(id => !ids.includes(id))))
  }, [])
  const batches = useReviewBatch(inbox.reload, removeApprovedSelection)
  const entries = inbox.data?.pending_entries ?? EMPTY
  const ordinary = entries.filter(isOrdinary)
  const needsLook = entries.filter(entry => !isOrdinary(entry))
  const selectedRows = ordinary.filter(entry => selected.has(entry.id))
  const selection = selectedRows.length ? approvalSelection(selectedRows) : null

  const clearSelection = () => setSelected(new Set())
  const discardChanges = () => {
    clearSelection()
    setReviewDirty(false)
  }
  const unsaved = useUnsavedChanges({
    dirty: selectedRows.length > 0 || reviewDirty,
    what: 'Approvals',
    onSave: () => {},
    onDiscard: discardChanges,
  })

  const loadExtras = useCallback(async () => {
    setExtrasLoading(true)
    const [leaveResult, stubResult, workerResult] = await Promise.allSettled([
      loadPendingLeave(),
      capabilities.send_pay_statements
        ? payStubsApi.requests('open')
        : Promise.resolve({ requests: [] }),
      api.getWhosWorking(),
    ])
    const errors: ExtrasError = {}
    if (leaveResult.status === 'fulfilled') setLeave(leaveResult.value)
    else errors.leave = String(leaveResult.reason)
    if (stubResult.status === 'fulfilled') setStubs(stubResult.value.requests)
    else errors.stubs = "Couldn't load pay stub requests."
    if (workerResult.status === 'fulfilled' && workerResult.value.data) {
      setWorkers(workerResult.value.data.workers)
    } else {
      errors.workers = "Couldn't check open clocks."
    }
    setExtrasError(errors)
    setExtrasLoading(false)
  }, [capabilities.send_pay_statements])

  const loadPeople = useCallback(async () => {
    setPeopleLoading(true)
    setPeopleError('')
    try {
      const response = await api.getUsers()
      if (!response.data) {
        setPeopleError(response.error || "Couldn't load departments and people.")
        return
      }
      setPeople(response.data.users)
      setGroups(response.data.approval_groups ?? [])
    } catch {
      setPeopleError("Couldn't load departments and people.")
    } finally {
      setPeopleLoading(false)
    }
  }, [])
  useEffect(() => {
    void loadExtras()
    void loadPeople()
    let active = true
    void Promise.all([api.getTimeCategories(), api.getPayrollCutoff()]).then(([cats, period]) => {
      if (!active) return
      if (cats.data) setCategories(cats.data.time_categories)
      if (period.data) setCutoff(period.data)
    })
    return () => {
      active = false
    }
  }, [loadExtras, loadPeople])
  useEffect(() => {
    if (!peopleLoading && !peopleError && department !== requestedDepartment)
      rememberDepartment(currentUser?.id, 'all')
  }, [peopleLoading, peopleError, department, requestedDepartment, currentUser?.id])

  const changeQuery = async (next: URLSearchParams) => {
    if (changing.current || batches.busy) return
    changing.current = true
    try {
      if (selectedRows.length || reviewDirty) {
        const clear = await confirm({
          title: 'Clear your selection?',
          description: 'Changing this view clears the selected shifts and unsaved review note.',
          confirmLabel: 'Clear and continue',
          cancelLabel: 'Keep reviewing',
        })
        if (!clear) return
      }
      clearSelection()
      setReview(null)
      setReviewDirty(false)
      setConfirmation(null)
      setQuery(next)
      rememberDepartment(currentUser?.id, next.get('dept') || department)
    } finally {
      changing.current = false
    }
  }

  const updateQuery = (key: string, value: string) => {
    const next = new URLSearchParams(query)
    next.set(key, value)
    void changeQuery(next)
  }
  const changeKind = (kind: ApprovalKind) => updateQuery('kind', kind)
  const changeDepartment = (value: string) => updateQuery('dept', value)
  const changeGroup = (value: 'person' | 'day') => updateQuery('group', value)
  const seeEveryone = () => updateQuery('dept', 'all')
  const openFilters = () => setFiltersOpen(true)
  const closeFilters = () => setFiltersOpen(false)
  const applyFilters = (next: URLSearchParams) => {
    closeFilters()
    void changeQuery(next)
  }

  const approveSnapshot = async (snapshot: ApprovalSelection) => {
    const noun = snapshot.rows.length === 1 ? 'shift' : 'shifts'
    const person = snapshot.people.length === 1 ? ` for ${snapshot.people[0].name}` : ''
    const complete = await batches.approve(
      snapshot.items,
      inbox.data?.review_summary.batch_limit ?? 0,
      `Approved ${snapshot.rows.length} ${noun}${person}`,
      'ordinary',
      snapshot.rows,
    )
    setConfirmation(null)
    return complete
  }
  const approveGroup = async (rows: ReviewEntry[]) => {
    const snapshot = approvalSelection(rows)
    if (snapshot.people.length > 1) setConfirmation({ snapshot, all: false })
    else await approveSnapshot(snapshot)
  }
  const requestAll = () => {
    setConfirmation({ snapshot: approvalSelection(ordinary), all: true })
  }
  const requestSelection = (forceConfirm = false) => {
    if (!selection || batches.busy || !online) return
    if (forceConfirm || selection.people.length > 1) {
      setConfirmation({ snapshot: selection, all: false })
    } else {
      void approveSnapshot(selection)
    }
  }
  const approveSelection = () => requestSelection()
  const toggleSelected = (rows: ReviewEntry[], checked: boolean) => {
    setSelected(current => {
      const next = new Set(current)
      rows.forEach(row => {
        if (checked) next.add(row.id)
        else next.delete(row.id)
      })
      return next
    })
  }
  const closeReview = async (saved = false) => {
    if (batches.busy) return
    if (!saved && reviewDirty) {
      const discard = await confirm({
        title: 'Discard this note?',
        confirmLabel: 'Discard note',
        cancelLabel: 'Keep reviewing',
      })
      if (!discard) return
    }
    setReviewDirty(false)
    setReview(null)
  }
  const handleCloseReview = (saved?: boolean, message?: string) => {
    if (message) toast.show({ message })
    void closeReview(saved)
  }
  const approveReviewed = (items: ReviewItem[], label: string) => {
    return batches.approve(items, 31, label, 'reviewed', review ? [review] : [])
  }
  const reloadApprovals = () => {
    void inbox.reload()
  }
  const reloadExtras = () => {
    void loadExtras()
  }
  const undoRecent: Parameters<typeof RecentApprovals>[0]['onUndo'] = available => {
    void batches.undo(available)
  }

  const disabled = batches.busy || !online || inbox.loading || Boolean(inbox.error)
  const disabledReason = !online
    ? 'Reconnect to approve'
    : inbox.loading
      ? 'Wait for approvals to finish loading'
      : inbox.error
        ? 'Reload approvals before saving'
        : undefined
  const confirmApproval = () => {
    if (confirmation && !disabled) void approveSnapshot(confirmation.snapshot)
  }
  const cancelApproval = () => setConfirmation(null)
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const textEntry = (event.target as HTMLElement).closest(
      'input,textarea,select,[aria-modal="true"]',
    )
    if (
      event.shiftKey &&
      event.key.toLowerCase() === 'a' &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      !textEntry
    ) {
      event.preventDefault()
      requestSelection(true)
    }
  }

  const viewerGroups =
    people.find(person => person.id === currentUser?.id)?.approval_group_keys ??
    (currentUser?.approval_group ? [currentUser.approval_group] : [])
  const attention = workers.filter(worker => {
    if (!worker.open_since_work_date || !worker.open_entry_id) return false
    return (
      !viewerGroups.length ||
      people.some(person => {
        return (
          person.id === worker.user.id &&
          person.approval_group_keys?.some(key => viewerGroups.includes(key))
        )
      })
    )
  })
  const matchesPerson = (id: number) => {
    if (query.get('user_id') && String(id) !== query.get('user_id')) return false
    if (department === 'all') return true
    const person = people.find(person => person.id === id)
    const keys =
      person?.approval_group_keys ?? (person?.approval_group ? [person.approval_group] : [])
    return department === 'unassigned' ? keys.length === 0 : keys.includes(department)
  }
  const visibleLeave = leave.filter(request => matchesPerson(request.user.id))
  const visibleStubs = stubs.filter(request => matchesPerson(request.worker.id))
  const showStubs = capabilities.send_pay_statements && visibleStubs.length > 0
  const kind: ApprovalKind =
    query.get('kind') === 'leave'
      ? 'leave'
      : query.get('kind') === 'stubs' &&
          (showStubs || peopleLoading || Boolean(peopleError) || extrasLoading)
        ? 'stubs'
        : 'time'
  const lock = approvalLockCopy(cutoff)
  const departmentOptions = groups.length
    ? groups.map(group => ({ value: group.key, label: group.label }))
    : [
        { value: 'cfi', label: 'CFI' },
        { value: 'ops', label: 'Ops/Maint' },
      ]
  const headerDescription = `${inbox.data?.count ?? '…'} waiting${lock.description}`
  const filterCount = FILTER_KEYS.filter(key => query.has(key)).length
  const selectionSummary = selection
    ? `${selection.people.length} people · ${selection.hours.toFixed(1)}h`
    : undefined

  return (
    <div
      className="space-y-3 pb-6"
      onKeyDown={handleKeyDown}
    >
      <ApprovalsHeader
        description={headerDescription}
        count={inbox.data?.count}
        loadedAt={inbox.loadedAt}
        kind={kind}
        leaveCount={visibleLeave.length}
        stubCount={visibleStubs.length}
        canSendStubs={capabilities.send_pay_statements}
        department={department}
        departmentOptions={departmentOptions}
        filterCount={filterCount}
        onKindChange={changeKind}
        onDepartmentChange={changeDepartment}
        onOpenFilters={openFilters}
      />
      <ApprovalsAttention workers={attention} />
      {extrasError.workers && (
        <ErrorState
          title={extrasError.workers}
          onRetry={reloadExtras}
        />
      )}
      {batches.notice && (
        <p
          role="status"
          className="rounded-card border border-amber-200 bg-amber-50 p-3 text-body-sm"
        >
          {batches.notice}
          {batches.notice.includes('Reload') && (
            <Button
              variant="ghost"
              disabled={disabled}
              onClick={() => {
                void batches.refresh()
              }}
            >
              Reload
            </Button>
          )}
        </p>
      )}
      <RecentApprovals
        batches={batches.undoBatches}
        busy={batches.busy}
        online={online}
        onUndo={undoRecent}
      />
      <div
        id="approvals-panel"
        role="tabpanel"
        className="space-y-4"
      >
        {kind === 'time' && (
          <ApprovalsTimePanel
            inbox={inbox}
            ordinary={ordinary}
            needsLook={needsLook}
            viewerId={currentUser?.id}
            department={department}
            departmentLabel={departmentOptions.find(item => item.value === department)?.label}
            groupBy={groupBy}
            selected={selected}
            disabled={disabled}
            disabledReason={disabledReason}
            onReload={reloadApprovals}
            onReview={setReview}
            onApproveAll={requestAll}
            onGroupChange={changeGroup}
            onSelect={toggleSelected}
            onApproveGroup={approveGroup}
            onSeeEveryone={seeEveryone}
          />
        )}
        {kind === 'leave' &&
          capabilities.approve_leave &&
          currentUser?.time_tracking_enabled === true && (
            <Link
              className="inline-flex min-h-11 items-center font-semibold text-primary underline"
              to="/admin/leave?mine=1"
            >
              Request your own leave
            </Link>
          )}
        {kind === 'leave' &&
          (peopleError ? (
            <ErrorState
              title={peopleError}
              onRetry={() => {
                void loadPeople()
              }}
            />
          ) : peopleLoading ? (
            <p>Loading departments and people…</p>
          ) : extrasError.leave ? (
            <ErrorState
              title="Couldn't load leave requests."
              onRetry={reloadExtras}
            />
          ) : extrasLoading ? (
            <p>Loading leave requests…</p>
          ) : (
            <LeaveRequestsList
              requests={visibleLeave}
              viewerId={currentUser?.id}
              onChanged={loadExtras}
            />
          ))}
        {kind === 'stubs' &&
          (peopleError ? (
            <ErrorState
              title={peopleError}
              onRetry={() => {
                void loadPeople()
              }}
            />
          ) : peopleLoading || extrasLoading ? (
            <p>Loading departments and people…</p>
          ) : extrasError.stubs ? (
            <ErrorState
              title={extrasError.stubs}
              onRetry={reloadExtras}
            />
          ) : (
            <StubRequestsList
              requests={visibleStubs}
              canChooseRecipient={capabilities.preview_pay}
              onChanged={loadExtras}
            />
          ))}
      </div>
      <p className="hidden text-body-sm text-ink-subtle lg:block">
        ↑↓ or j/k move · Space selects · Enter opens · Esc clears · Shift+A reviews selected
        approvals
      </p>
      <SelectionBar
        count={selectedRows.length}
        noun={['shift', 'shifts']}
        label="Selected shifts"
        summary={selectionSummary}
        onClear={clearSelection}
        actions={
          <Button
            disabled={disabled}
            title={disabledReason}
            onClick={approveSelection}
          >
            Approve {selectedRows.length}
          </Button>
        }
      />
      <ApproveAllDialog
        disabled={disabled}
        disabledReason={disabledReason}
        selection={confirmation?.snapshot ?? null}
        ordinary={confirmation?.all}
        exclusions={exclusionCopy(needsLook)}
        lockCopy={lock.confirmation}
        busy={batches.busy}
        onCancel={cancelApproval}
        onConfirm={confirmApproval}
      />
      {filtersOpen && (
        <FiltersSheet
          query={query}
          categories={categories}
          people={people.map(person => ({ id: person.id, name: person.full_name }))}
          onClose={closeFilters}
          onApply={applyFilters}
        />
      )}
      {review && (
        <ReviewSheet
          key={review.id}
          entry={review}
          categories={categories}
          busy={batches.busy}
          onDirty={setReviewDirty}
          onClose={handleCloseReview}
          onReload={batches.refresh}
          onApprove={approveReviewed}
        />
      )}
      {unsaved.guard}
      {confirmDialog}
    </div>
  )
}
