import { SlidersHorizontal } from 'lucide-react'
import { Button, OfflineBanner, PageHeader, TabChips } from '../ui'

export type ApprovalKind = 'time' | 'leave' | 'stubs'
export interface DepartmentOption {
  value: string
  label: string
}

interface ApprovalsHeaderProps {
  description: string
  count?: number
  loadedAt?: Date
  kind: ApprovalKind
  leaveCount: number
  stubCount: number
  canSendStubs: boolean
  department: string
  departmentOptions: DepartmentOption[]
  filterCount: number
  onKindChange: (kind: ApprovalKind) => void
  onDepartmentChange: (department: string) => void
  onOpenFilters: () => void
}

export default function ApprovalsHeader({
  description,
  count,
  loadedAt,
  kind,
  leaveCount,
  stubCount,
  canSendStubs,
  department,
  departmentOptions,
  filterCount,
  onKindChange,
  onDepartmentChange,
  onOpenFilters,
}: ApprovalsHeaderProps) {
  const kinds = [
    { value: 'time' as const, label: 'Time', count },
    { value: 'leave' as const, label: 'Leave', count: leaveCount },
    ...(canSendStubs && stubCount > 0
      ? [{ value: 'stubs' as const, label: 'Pay stubs', count: stubCount }]
      : []),
  ]

  return (
    <>
      <PageHeader title="Approvals" description={description} />
      <OfflineBanner loadedAt={loadedAt} />
      <TabChips
        label="What's waiting"
        value={kind}
        controls="approvals-panel"
        items={kinds}
        onChange={onKindChange}
      />
      <div className="flex items-center gap-1">
        <div className="min-w-0 flex-1">
          <TabChips
            label="Department"
            className="flex-wrap overflow-visible"
            value={department}
            items={[{ value: 'all', label: 'Everyone' }, ...departmentOptions]}
            onChange={onDepartmentChange}
          />
        </div>
        <Button
          variant="ghost"
          aria-label={`Filters${filterCount ? ` (${filterCount})` : ''}`}
          onClick={onOpenFilters}
        >
          <SlidersHorizontal className="size-4" aria-hidden="true" />
          <span className="hidden sm:inline">Filters</span>
          {filterCount > 0 && <span>{filterCount}</span>}
        </Button>
      </div>
    </>
  )
}
