import { useCapabilities } from '../../lib/useCapabilities'
import MyLeave from './MyLeave'
import TimeTracking from './TimeTracking'

// PR 4 will redirect supervisors to Approvals. Preserve their current page
// here until that lands; MyLeave itself is reusable for ?mine=1.
export default function EmployeeLeaveRoute() {
  const capabilities = useCapabilities()
  return capabilities.manage_team_time ? <TimeTracking section="leave" /> : <MyLeave />
}
