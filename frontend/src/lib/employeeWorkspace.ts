export type EmployeeTab = 'overview' | 'hours' | 'schedule' | 'activity' | 'setup'

export function safeAdminReturn(value: string | null | undefined): string {
  if (!value || !value.startsWith('/admin') || !/^\/admin(?:\/|\?|$)/.test(value) || (value.includes('\\') || Array.from(value).some((character) => character.charCodeAt(0) < 32))) return '/admin/users'
  const url = new URL(value, 'https://local.invalid')
  return url.origin === 'https://local.invalid' ? `${url.pathname}${url.search}${url.hash}` : '/admin/users'
}

export function employeeWorkspaceHref(id: number | string, options: { tab?: EmployeeTab; returnTo?: string; startDate?: string; endDate?: string; period?: string; entry?: string; cursor?: string; detailCursor?: string; sourceUserUuid?: string; sourceInstanceId?: string } = {}): string {
  if (!/^[1-9]\d*$/.test(String(id))) return '/admin/users'
  const query = new URLSearchParams()
  query.set('tab', options.tab || 'overview')
  if (options.returnTo) query.set('return_to', safeAdminReturn(options.returnTo))
  if (options.startDate) query.set('start_date', options.startDate)
  if (options.endDate) query.set('end_date', options.endDate)
  if (options.period) query.set('period', options.period)
  if (options.entry) query.set('entry', options.entry)
  if (options.cursor) query.set('cursor', options.cursor)
  if (options.detailCursor) query.set('detail_cursor', options.detailCursor)
  if (options.sourceUserUuid) query.set('source_user_uuid', options.sourceUserUuid)
  if (options.sourceInstanceId) query.set('source_instance_id', options.sourceInstanceId)
  return `/admin/users/${id}?${query}`
}
