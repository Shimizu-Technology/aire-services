export function normalizeApiBaseUrl(value?: string): string {
  return value?.trim().replace(/\/$/, '') || ''
}

export const API_BASE_URL = normalizeApiBaseUrl(import.meta.env.VITE_API_URL)

export function apiUrl(endpoint: string, baseUrl = API_BASE_URL): string {
  return `${baseUrl}${endpoint}`
}

export function cableUrl(token: string, baseUrl = API_BASE_URL): string {
  const websocketBase = baseUrl.replace(/^http/i, 'ws')
  return `${websocketBase}/cable?token=${encodeURIComponent(token)}`
}
