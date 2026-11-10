import { formatPayDate } from '../../lib/myPayApi'
import type { PayStubLink, PayStubLinkState, PayStubRequest } from '../../lib/payStubsApi'
import type { StatusTone } from '../../lib/myPayApi'

export function describeRequest(request: Pick<PayStubRequest, 'scope' | 'pay_date' | 'year'>): string {
  if (request.scope === 'year') return `All ${request.year} pay stubs`
  if (request.scope === 'pay_date') return `Pay date ${formatPayDate(request.pay_date)}`
  return 'Latest pay stub'
}

export const LINK_STATE: Record<PayStubLinkState, { label: string; tone: StatusTone }> = {
  active: { label: 'Active', tone: 'success' },
  pending: { label: 'Not sent', tone: 'neutral' },
  inactive: { label: 'No longer works here', tone: 'neutral' },
  expired: { label: 'Expired', tone: 'neutral' },
  revoked: { label: 'Revoked', tone: 'danger' },
  used_up: { label: 'Downloads used up', tone: 'neutral' },
  failed: { label: 'Email failed', tone: 'danger' },
}

export function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export function linkDates(link: PayStubLink): string {
  const dates = link.documents.map((document) => formatPayDate(document.pay_date, { month: 'short', day: 'numeric', year: 'numeric' }))
  if (dates.length <= 3) return dates.join(', ')
  return `${dates.slice(0, 2).join(', ')} and ${dates.length - 2} more`
}
