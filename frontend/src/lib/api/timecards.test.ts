import { beforeEach, describe, expect, it, vi } from 'vitest'
import { timecardsApi } from './timecards'

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
