export const KIOSK_ACCESS_STORAGE_KEY = 'aire_kiosk_access_session'

export interface StoredKioskAccessSession {
  token: string
  expiresAt: string
  unlockedBy: string
}

export function readKioskSession(): StoredKioskAccessSession | null {
  try {
    // Read the old per-tab storage during rollout. New sessions are shared
    // across tabs so opening another page cannot bypass the manager PIN flow.
    const raw = localStorage.getItem(KIOSK_ACCESS_STORAGE_KEY) ?? sessionStorage.getItem(KIOSK_ACCESS_STORAGE_KEY)
    const session = raw ? JSON.parse(raw) as StoredKioskAccessSession : null
    return session?.token && Date.parse(session.expiresAt) > Date.now() ? session : null
  } catch {
    return null
  }
}

export function storeKioskSession(session: StoredKioskAccessSession) {
  localStorage.setItem(KIOSK_ACCESS_STORAGE_KEY, JSON.stringify(session))
  sessionStorage.removeItem(KIOSK_ACCESS_STORAGE_KEY)
}

export function clearKioskSession() {
  localStorage.removeItem(KIOSK_ACCESS_STORAGE_KEY)
  sessionStorage.removeItem(KIOSK_ACCESS_STORAGE_KEY)
}
