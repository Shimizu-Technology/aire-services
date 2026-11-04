export const PAUSED_PAYROLL_MESSAGE = 'Payroll connection is paused. Time tracking and approvals work normally; Cornerstone processes payroll from the hours report.'

export interface ConnectedPayrollCapability {
  mode: 'enabled' | 'paused'
  enabled: boolean
  message: string | null
}
