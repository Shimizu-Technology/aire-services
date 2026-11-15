import type { ReviewEntry } from '../../lib/api/approvals'
import type { useApprovalsQuery } from './useApprovalsQuery'
import { Button, EmptyState, ErrorState, SegmentedControl } from '../ui'
import NeedsLookList from './NeedsLookList'
import OrdinaryGroups from './OrdinaryGroups'

interface ApprovalsTimePanelProps {
  inbox: ReturnType<typeof useApprovalsQuery>
  ordinary: ReviewEntry[]
  needsLook: ReviewEntry[]
  maxShiftHours?: number
  viewerId?: number
  department: string
  departmentLabel?: string
  groupBy: 'person' | 'day'
  selected: Set<number>
  disabled: boolean
  disabledReason?: string
  onReload: () => void
  onReview: (entry: ReviewEntry) => void
  onApproveAll: () => void
  onGroupChange: (group: 'person' | 'day') => void
  onSelect: (rows: ReviewEntry[], checked: boolean) => void
  onApproveGroup: (rows: ReviewEntry[]) => Promise<void>
  onSeeEveryone: () => void
}

function LoadingRows() {
  return (
    <div
      aria-label="Loading approvals"
      className="space-y-2"
    >
      {[1, 2, 3].map(row => (
        <div
          key={row}
          className="h-14 animate-pulse rounded-card bg-slate-100 motion-reduce:animate-none"
        />
      ))}
    </div>
  )
}

export default function ApprovalsTimePanel({
  inbox,
  ordinary,
  needsLook,
  maxShiftHours,
  viewerId,
  department,
  departmentLabel,
  groupBy,
  selected,
  disabled,
  disabledReason,
  onReload,
  onReview,
  onApproveAll,
  onGroupChange,
  onSelect,
  onApproveGroup,
  onSeeEveryone,
}: ApprovalsTimePanelProps) {
  const totalHours = ordinary.reduce((sum, row) => sum + row.hours, 0)
  const incomplete = Boolean(inbox.data && !inbox.data.review_summary.complete)
  const allDisabledReason =
    disabledReason || (incomplete ? 'Narrow the filters to load a complete list' : undefined)
  const emptyDescription = `Nothing is waiting for approval${
    department !== 'all' ? ` in ${departmentLabel || department}` : ''
  }.`

  return (
    <>
      {inbox.error && (
        <ErrorState
          title="Couldn't load approvals."
          description={inbox.error}
          onRetry={onReload}
        />
      )}
      {inbox.showSkeleton && <LoadingRows />}
      {inbox.slow && (
        <ErrorState
          title="Still loading…"
          onRetry={onReload}
        />
      )}
      {!inbox.error && (
        <>
          <NeedsLookList
            rows={needsLook}
            onReview={onReview}
            viewerId={viewerId}
          />
          {ordinary.length > 0 ? (
            <section className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-body font-semibold">
                  Ordinary shifts · {ordinary.length} · {totalHours.toFixed(1)}h
                </h2>
                <Button
                  variant="ghost"
                  disabled={disabled || !inbox.data?.review_summary.complete}
                  title={allDisabledReason}
                  onClick={onApproveAll}
                >
                  Approve all {ordinary.length}
                </Button>
              </div>
              <SegmentedControl
                label="Group shifts"
                options={[
                  { value: 'person', label: 'By person' },
                  { value: 'day', label: 'By day' },
                ]}
                value={groupBy}
                onChange={onGroupChange}
              />
              <p className="text-body-sm text-ink-muted">
                Phone or kiosk clock-ins, no edits, no overtime,{' '}
                {maxShiftHours ? `under ${maxShiftHours} hours` : 'under the shift limit'}
              </p>
              <OrdinaryGroups
                rows={ordinary}
                groupBy={groupBy}
                selected={selected}
                onSelect={onSelect}
                disabled={disabled}
                disabledReason={disabledReason}
                onApprove={onApproveGroup}
              />
            </section>
          ) : (
            !inbox.loading &&
            (needsLook.length ? (
              <EmptyState title={`No ordinary shifts. ${needsLook.length} need a look above.`} />
            ) : (
              <EmptyState
                title="All caught up."
                description={emptyDescription}
                action={
                  department !== 'all' ? (
                    <Button
                      variant="secondary"
                      onClick={onSeeEveryone}
                    >
                      See everyone
                    </Button>
                  ) : undefined
                }
              />
            ))
          )}
          {incomplete && (
            <p className="text-body-sm text-ink-muted">
              Showing {inbox.data!.pending_entries.length} of {inbox.data!.count} shifts. Narrow the
              filters to approve all.
            </p>
          )}
        </>
      )}
    </>
  )
}
