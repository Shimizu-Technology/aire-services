import { useEffect, useState } from 'react'
import { useNavigate, Navigate, useLocation } from 'react-router-dom'
import { api, type AdminAppSettingsResponse } from '../../../lib/api'
import { ListGroup, ListRow, PageHeader } from '../../../components/ui'
import { settingsApi } from '../../../lib/api/settings'
import { settingsAnchorPaths } from '../AdminRedirects'

export default function SettingsHome() {
  const navigate = useNavigate()
  const location = useLocation()
  const [data, setData] = useState<AdminAppSettingsResponse | null>(null)
  const [categoryCount, setCategoryCount] = useState<number | null>(null)
  const [connection, setConnection] = useState('Loading…')
  const [error, setError] = useState('')
  useEffect(() => {
    void api.getAdminAppSettings().then(result => {
      if (result.data) setData(result.data)
      else setError(result.error || 'Could not load settings')
    }).catch(() => setError('Could not load settings'))
    void api.getAdminTimeCategories().then(result => setCategoryCount(result.data?.time_categories.length ?? null)).catch(() => {})
    void settingsApi.connection().then(result => setConnection(result.data?.state.replaceAll('_', ' ') ?? 'Unavailable')).catch(() => setConnection('Unavailable'))
  }, [])
  const redirect = settingsAnchorPaths[location.hash]
  if (redirect) return <Navigate replace to={redirect} />
  const settings = (data?.settings ?? {}) as Record<string, string>
  const on = (key: string) => settings[key] === 'true' ? 'on' : 'off'
  const rows = [
    ['time-clock', 'Time clock rules', `Alerts at ${settings.overtime_daily_threshold_hours}h a day and ${settings.overtime_weekly_threshold_hours}h a week · location check ${on('clock_in_location_enforced')}`],
    ['approvals', 'Approvals', `Auto-approve ${on('auto_approve_ordinary_shifts')} · managers ${settings.managers_can_approve_own_time === 'true' ? 'can' : "can't"} approve their own time · reminders to ${(settings.payroll_cutoff_reminder_emails || '').split(/[\n,;]+/).filter(value => value.trim()).length} people`],
    ['departments', 'Departments and work', `${data?.approval_groups.length ?? 0} departments · ${categoryCount ?? '—'} kinds of work`],
    ['pay-stubs', 'Pay stubs', `Kiosk requests ${on('pay_stub_kiosk_requests_enabled')} · self-email ${on('pay_stub_self_email_enabled')}`],
    ['kiosk', 'Kiosk', `Pay stub requests ${on('pay_stub_kiosk_requests_enabled')}`],
    ['payroll-connection', 'Payroll connection', connection],
    ['schedules', 'Schedules', on('schedules_enabled')],
    ['roles', 'Roles & access', 'View permissions by role'],
  ]
  return (
    <div className="mx-auto max-w-[880px] space-y-6">
      <PageHeader title="Settings" />
      {error && <p role="alert">{error}</p>}
      <ListGroup label="Settings pages">
        {rows.map(([path, title, summary]) => <ListRow key={path} title={title} meta={data ? summary : 'Loading…'} onOpen={() => navigate(`/admin/settings/${path}`)} />)}
      </ListGroup>
    </div>
  )
}
