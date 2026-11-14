import { useCapabilities } from '../../lib/useCapabilities'
import { MyTimeHome } from './Dashboard'
import MyTime from './MyTime'

// Supervisors retain their existing override-capable clock and payroll notice.
export default function EmployeeClockRoute() {
  const capabilities = useCapabilities()
  return capabilities.manage_team_time ? <MyTimeHome /> : <MyTime />
}
