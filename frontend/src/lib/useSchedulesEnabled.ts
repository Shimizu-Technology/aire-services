import { useAuthContext } from '../contexts/AuthContext'

/** "Use schedules" in Settings, from the signed-in profile. Off until AIRE starts planning shifts. */
export function useSchedulesEnabled() {
  const { currentUser } = useAuthContext()
  return Boolean(currentUser?.schedules_enabled)
}
