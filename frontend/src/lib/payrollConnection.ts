import type { PayrollConnectionStatus } from './api/attention'
import { BUSINESS_TIME_ZONE } from './dateUtils'

const formatBusinessDateTime = (instant: string) => new Date(instant).toLocaleString('en-US', { timeZone: BUSINESS_TIME_ZONE, dateStyle: 'medium', timeStyle: 'short' })

// A receipt proves delivery at that time, not continuing availability. After
// 24 hours describe the last receipt without claiming a current connection.
const RECENT_RECEIPT_MS = 24 * 60 * 60 * 1000

type ConnectionEvidence = { state: PayrollConnectionStatus['state']; last_delivery: { delivered_at: string | null } | null }

export function payrollConnectionCopy(connection: ConnectionEvidence, now = new Date()) {
  const receipt = connection.last_delivery?.delivered_at
  const age = receipt ? now.getTime() - Date.parse(receipt) : NaN
  const recent = age >= 0 && age <= RECENT_RECEIPT_MS
  const receiptText = receipt ? `Last confirmed receipt: ${formatBusinessDateTime(receipt)}.` : 'No confirmed receipt from Cornerstone Payroll yet.'
  if (connection.state === 'paused') return { title: 'Payroll connection paused', detail: `${receiptText} Cornerstone Payroll admins can resume the connection.`, connected: false }
  if (connection.state === 'delivery_problem') return { title: "Hours haven't reached Cornerstone Payroll yet", detail: `${receiptText} Check the connection in Cornerstone Payroll; AIRE keeps retrying.`, connected: false }
  return {
    title: recent ? 'Connected to Cornerstone Payroll' : receipt ? 'No recent receipt from Cornerstone Payroll' : 'Set up, but nothing confirmed yet',
    detail: `${receiptText}${recent ? '' : ' Check the connection in Cornerstone Payroll before preparing payroll.'}`,
    connected: recent,
  }
}
