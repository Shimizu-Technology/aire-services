import { fetchApi } from '../api'

export interface PayrollConnection {
  state: import('./attention').PayrollConnectionStatus['state']
  mode: string
  last_publication: { published_at: string } | null
  last_delivery: { delivered_at: string } | null
  account_link: {
    aire_user: { full_name: string }
    payroll_user_email: string
    linked_at: string
  } | null
}

export const settingsApi = {
  connection: () => fetchApi<PayrollConnection>('/api/v1/payroll_connection'),
  save: (settings: Record<string, string>) =>
    fetchApi<import('../api').AdminAppSettingsResponse>('/api/v1/admin/settings', {
      method: 'PATCH',
      body: JSON.stringify({ settings }),
    }),
}
