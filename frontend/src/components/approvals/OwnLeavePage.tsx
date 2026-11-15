import { useEffect } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import MyLeave from '../../pages/admin/MyLeave'

/** Supervisors use the same own-leave screen and request sheet as employees. */
export default function OwnLeavePage() {
  const [query] = useSearchParams()
  const returnQuery = new URLSearchParams(query.get('return_to') || '')
  returnQuery.set('kind', 'leave')
  useEffect(() => {
    document.title = 'Leave | AIRE Ops'
  }, [])
  return (
    <div className="space-y-4">
      <Link
        to={`/admin/approvals?${returnQuery}`}
        className="inline-flex min-h-11 items-center font-semibold text-primary underline"
      >
        Back to Approvals
      </Link>
      <MyLeave />
    </div>
  )
}
