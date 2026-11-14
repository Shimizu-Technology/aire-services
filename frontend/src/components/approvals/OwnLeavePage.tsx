import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import MyLeave from '../../pages/admin/MyLeave'

/** Supervisors use the same own-leave screen and request sheet as employees. */
export default function OwnLeavePage() {
  useEffect(() => {
    document.title = 'Leave | AIRE Ops'
  }, [])
  return (
    <div className="space-y-4">
      <Link
        to="/admin/approvals?kind=leave"
        className="inline-flex min-h-11 items-center font-semibold text-primary underline"
      >
        Back to Approvals
      </Link>
      <MyLeave />
    </div>
  )
}
