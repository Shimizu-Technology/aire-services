import type { AdminUser } from '../../lib/api'
import { formatWorkDate } from '../../lib/dateUtils'
import { SummaryCard, SummaryRow } from './AccessSummary'
import { departments } from './personFormat'

interface EmploymentSummaryProps {
  user: AdminUser
  /** Opens the Edit dialog on Team. */
  editHref: string
}

/** Work setup, the public website profile and employment status, read-only. */
export function EmploymentSummary({ user, editHref }: EmploymentSummaryProps) {
  const categories = (user.time_categories ?? []).map(category => category.name)
  const ended = user.employment_status === 'terminated'

  return (
    <div className="max-w-[55rem] space-y-4">
      <SummaryCard title="Work setup" editHref={editHref}>
        <SummaryRow label="Job title">{user.staff_title || 'Not set'}</SummaryRow>
        <SummaryRow label="Departments">{departments(user) || 'None'}</SummaryRow>
        <SummaryRow label="Work they can clock">
          {!user.time_tracking_enabled ? "Doesn't track time" : categories.length ? categories.join(', ') : 'No work categories yet'}
        </SummaryRow>
        <SummaryRow label="Intern">{user.is_intern ? 'Yes' : 'No'}</SummaryRow>
      </SummaryCard>

      <SummaryCard title="Public website" editHref={editHref}>
        <SummaryRow label="On the Team page">{user.is_active && user.public_team_enabled ? 'Shown' : 'Hidden'}</SummaryRow>
        {user.public_team_enabled && (
          <>
            <SummaryRow label="Name and title">{[user.public_team_name, user.public_team_title].filter(Boolean).join(' · ') || 'Uses their name and job title'}</SummaryRow>
            <SummaryRow label="Photo">{user.public_team_photo_url || user.public_team_photo_thumb_url ? 'Added' : 'No photo'}</SummaryRow>
          </>
        )}
      </SummaryCard>

      <SummaryCard title="Employment" editHref={editHref}>
        <SummaryRow label="Status">
          {ended
            ? `Ended${user.termination_effective_on ? ` ${formatWorkDate(user.termination_effective_on)}` : ''}${user.terminated_by ? ` by ${user.terminated_by.full_name}` : ''}`
            : user.employment_status === 'inactive' ? 'Inactive' : 'Active'}
          {ended && user.termination_reason && <span className="block font-normal text-ink-muted">{user.termination_reason}</span>}
        </SummaryRow>
      </SummaryCard>
      <p className="text-body-sm text-ink-muted">To end or restore employment, use Edit. Their hours and paychecks always stay.</p>
    </div>
  )
}
