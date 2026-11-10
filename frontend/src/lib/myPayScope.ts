import { createContext, useContext } from 'react'
import { myPayApi, myPayPreviewApi, type MyPayHoursLine, type MyPaySource } from './myPayApi'
import type { CurrentUser } from './api'

// What a My Pay screen reads and where its links go. The worker's own My Pay
// uses the default; the admin preview supplies the previewed worker's scope so
// the same list and detail screens render exactly what that worker sees.
export interface MyPayScope {
  source: MyPaySource
  isEnabled: (user: CurrentUser | null | undefined) => boolean
  listHref: string
  statementHref: (statementId: string) => string
  timeHref: string
  timeLabel: string
  entryHref: (line: MyPayHoursLine, statementId: string) => string | null
}

function entryQuery(line: MyPayHoursLine, returnTo: string, extra: Record<string, string> = {}): URLSearchParams | null {
  if (!line.time_entry_id || !line.work_date) return null
  return new URLSearchParams({ ...extra, date: line.work_date, view: 'day', entry_id: String(line.time_entry_id), return_to: returnTo })
}

export const ownMyPayScope: MyPayScope = {
  source: myPayApi,
  isEnabled: (user) => Boolean(user?.my_pay_enabled),
  listHref: '/admin/pay',
  statementHref: (id) => `/admin/pay/${id}`,
  timeHref: '/admin/time',
  timeLabel: 'My Time',
  entryHref: (line, statementId) => {
    const query = entryQuery(line, `/admin/pay/${statementId}`)
    return query ? `/admin/time?${query}` : null
  },
}

export const MY_PAY_PREVIEW_PATH = '/admin/pay-preview'

// Links stay with the previewed worker: their statements, and their own time
// entries in the admin Time & Payroll view.
export function previewMyPayScope(userId: string): MyPayScope {
  const listHref = `${MY_PAY_PREVIEW_PATH}/${userId}`
  return {
    source: myPayPreviewApi.source(userId),
    isEnabled: (user) => Boolean(user?.my_pay_preview_enabled),
    listHref,
    statementHref: (id) => `${listHref}/${id}`,
    timeHref: `/admin/time?${new URLSearchParams({ user_id: userId })}`,
    timeLabel: 'Time & Payroll',
    entryHref: (line, statementId) => {
      const query = entryQuery(line, `${listHref}/${statementId}`, { user_id: userId })
      return query ? `/admin/time?${query}` : null
    },
  }
}

export const MyPayScopeContext = createContext<MyPayScope>(ownMyPayScope)

export function useMyPayScope(): MyPayScope {
  return useContext(MyPayScopeContext)
}
