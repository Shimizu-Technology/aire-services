import { describe, expect, it } from 'vitest'

import { apiUrl, cableUrl, normalizeApiBaseUrl } from './apiBase'

describe('AIRE API URL helpers', () => {
  it('uses same-origin paths when no API URL is configured', () => {
    expect(normalizeApiBaseUrl()).toBe('')
    expect(apiUrl('/api/v1/admin/users', '')).toBe('/api/v1/admin/users')
    expect(cableUrl('test token', '')).toBe('/cable?token=test%20token')
  })

  it('normalizes configured API and websocket origins', () => {
    const baseUrl = normalizeApiBaseUrl('https://api.example.test/')

    expect(apiUrl('/api/v1/admin/users', baseUrl)).toBe('https://api.example.test/api/v1/admin/users')
    expect(cableUrl('token', baseUrl)).toBe('wss://api.example.test/cable?token=token')
  })
})
