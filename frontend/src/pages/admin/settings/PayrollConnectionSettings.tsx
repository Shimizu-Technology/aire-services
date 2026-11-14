import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { PageHeader } from '../../../components/ui'
import { settingsApi, type PayrollConnection } from '../../../lib/api/settings'

export default function PayrollConnectionSettings() {
  const [connection, setConnection] = useState<PayrollConnection | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    void settingsApi
      .connection()
      .then((result) => {
        if (result.data) setConnection(result.data)
        else setError(result.error || 'Could not load payroll connection')
      })
      .catch(() => setError('Could not load payroll connection'))
  }, [])
  return (
    <div className="mx-auto max-w-[880px] space-y-6">
      <Link to="/admin/settings" className="inline-flex min-h-11 items-center text-primary">
        Settings
      </Link>
      <PageHeader title="Payroll connection" />
      {error && <p role="alert">{error}</p>}
      {!connection ? (
        <p>Loading connection…</p>
      ) : (
        <div className="space-y-4 rounded-card border border-line bg-surface p-5">
          {connection.state === 'paused' && (
            <p role="alert" className="rounded-card bg-red-50 p-4 text-red-800">
              Payroll connection paused. AIRE keeps tracking time but can't send locked hours.
              Cornerstone Payroll admins can resume it.
            </p>
          )}
          <p>{connection.state.replaceAll('_', ' ')}</p>
          <p>
            Last heard from:{' '}
            {connection.last_publication
              ? new Date(connection.last_publication.published_at).toLocaleString()
              : 'No publication yet'}
          </p>
          <p>
            Last delivered:{' '}
            {connection.last_delivery
              ? new Date(connection.last_delivery.delivered_at).toLocaleString()
              : 'No delivery yet'}
          </p>
          {connection.account_link && (
            <p>
              {connection.account_link.payroll_user_email} · Linked by{' '}
              {connection.account_link.aire_user.full_name} on{' '}
              {new Date(connection.account_link.linked_at).toLocaleString()}
            </p>
          )}
          <Link
            to="/admin/payroll-link"
            className="inline-flex min-h-11 items-center text-primary underline"
          >
            Reconnect
          </Link>
        </div>
      )}
    </div>
  )
}
