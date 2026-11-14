import { beforeEach, describe, expect, it, vi } from 'vitest'
import { outcomeUnknown, timecardsApi } from './timecards'

const apiMock = vi.hoisted(() => ({ getTimeEntries: vi.fn() }))
vi.mock('../api', () => ({ api: apiMock }))

const pages = (totalPages: number) => async (params: { page: number }) => ({ data: { time_entries: [{ id: params.page }], pagination: { total_pages: totalPages } } })

describe('timecardsApi entry paging', () => {
  beforeEach(() => { apiMock.getTimeEntries.mockReset() })

  it('loads every page', async () => {
    apiMock.getTimeEntries.mockImplementation(pages(3))
    const result = await timecardsApi.teamWeek('2026-11-08')
    expect(result.data?.map(entry => entry.id)).toEqual([1, 2, 3])
    expect(apiMock.getTimeEntries).toHaveBeenCalledTimes(3)
  })

  it('refuses rather than returning part of an 11-page week', async () => {
    apiMock.getTimeEntries.mockImplementation(pages(11))
    const result = await timecardsApi.teamWeek('2026-11-08')
    expect(result.data).toBeUndefined()
    expect(result.error).toMatch(/too many to show at once/)
  })
})

describe('outcomeUnknown', () => {
  it('is unknown with no answer, an unreadable answer, or a server failure', () => {
    expect(outcomeUnknown({ error: 'Failed to fetch' })).toBe(true)
    expect(outcomeUnknown({ error: 'Server returned an invalid response (200)', status: 200 })).toBe(true)
    expect(outcomeUnknown({ error: 'Bad gateway', status: 502 })).toBe(true)
    expect(outcomeUnknown({ error: 'Service unavailable', status: 503 })).toBe(true)
  })

  it('is known when the API refused the write', () => {
    expect(outcomeUnknown({ error: 'Reason is required', status: 422 })).toBe(false)
    expect(outcomeUnknown({ error: 'This entry changed', status: 409 })).toBe(false)
  })
})
