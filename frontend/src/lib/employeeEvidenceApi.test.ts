import { afterEach, describe, expect, it, vi } from 'vitest'
import { employeeEvidenceApi } from './employeeEvidenceApi'

vi.mock('./api', () => ({ getAuthTokenValue: async () => null }))
afterEach(() => vi.unstubAllGlobals())
describe('employee related evidence boundary', () => {
  it.each(['schedule', 'activity'] as const)('rejects malformed successful %s responses with a defined error', async (kind) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) }))
    const request = kind === 'schedule' ? employeeEvidenceApi.schedule('7', '2026-09-06') : employeeEvidenceApi.activity('7', 1)
    await expect(request).rejects.toThrow('Related records do not match this employee')
  })
  it('fails closed for malformed or foreign activity subjects', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ audit_logs: [{ id: 1, subject: null }] }) }))
    await expect(employeeEvidenceApi.activity('7', 1)).rejects.toThrow('Related records do not match this employee')
  })
})
