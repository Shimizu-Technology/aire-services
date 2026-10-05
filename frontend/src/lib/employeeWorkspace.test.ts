import { describe, expect, it } from 'vitest'
import { employeeWorkspaceHref, safeAdminReturn } from './employeeWorkspace'

describe('employee investigation links', () => {
  it('retains the exact person, period, entry and filter context', () => {
    const url = new URL(employeeWorkspaceHref(7, { tab: 'hours', period: '2026-09-01', entry: '19', startDate: '2026-09-01', returnTo: '/admin/time?user_id=7&view=reports' }), 'https://local.invalid')
    expect(url.pathname).toBe('/admin/users/7')
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ tab: 'hours', period: '2026-09-01', entry: '19', return_to: '/admin/time?user_id=7&view=reports' })
  })
  it('rejects unsafe return targets and invalid employee identifiers', () => {
    for (const value of ['https://evil.invalid', '//evil.invalid', '/admin\\evil.invalid', '/administrator', '/admin\n']) expect(safeAdminReturn(value)).toBe('/admin/users')
    expect(employeeWorkspaceHref('7/../8')).toBe('/admin/users')
  })
})
