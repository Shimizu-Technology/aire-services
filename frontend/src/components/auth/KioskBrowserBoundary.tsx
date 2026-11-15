import { useSyncExternalStore, type ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { readKioskSession } from '../../lib/kioskSession'

function subscribe(onChange: () => void) {
  window.addEventListener('storage', onChange)
  return () => window.removeEventListener('storage', onChange)
}

const hasDeviceSession = () => !!readKioskSession()

export function KioskBrowserBoundary({ children }: { children: ReactNode }) {
  const location = useLocation()
  const active = useSyncExternalStore(subscribe, hasDeviceSession)
  if (active && location.pathname !== '/kiosk') return <Navigate to="/kiosk" replace />
  return children
}
