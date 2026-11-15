import type { PayrollConnectionStatus } from './api/attention'
import { BUSINESS_TIME_ZONE } from './dateUtils'

export const formatPayrollConnectionTime = (instant: string) => new Date(instant).toLocaleString('en-US', { timeZone: BUSINESS_TIME_ZONE, dateStyle: 'medium', timeStyle: 'short' })

type ConnectionEvidence = {
  state: PayrollConnectionStatus['state']
  last_delivery: { delivered_at: string | null } | null
  latest_locked_period_delivery?: PayrollConnectionStatus['latest_locked_period_delivery']
  undelivered?: { count: number }
}

export function payrollConnectionCopy(connection: ConnectionEvidence) {
  const receipt = connection.last_delivery?.delivered_at
  const latest = connection.latest_locked_period_delivery
  const connected = connection.state === 'connected' && latest?.status === 'delivered' && Boolean(latest.delivered_at) && connection.undelivered?.count === 0
  const problem = connection.state === 'delivery_problem' || (connection.undelivered?.count ?? 0) > 0 || (latest != null && latest.status !== 'delivered')
  const receiptText = receipt ? `Last confirmed receipt: ${formatPayrollConnectionTime(receipt)}.` : 'No confirmed receipt from Cornerstone Payroll yet.'
  if (connection.state === 'paused') return { title: 'Payroll connection paused', detail: `${receiptText} Cornerstone Payroll admins can resume the connection.`, connected: false }
  if (problem) return { title: "Hours haven't reached Cornerstone Payroll yet", detail: `${receiptText} Check the connection in Cornerstone Payroll; AIRE keeps retrying.`, connected: false }
  return {
    title: connected ? 'Connected to Cornerstone Payroll' : 'Set up, but nothing confirmed yet',
    detail: `${receiptText}${connected ? '' : ' Check the connection in Cornerstone Payroll before preparing payroll.'}`,
    connected,
  }
}
