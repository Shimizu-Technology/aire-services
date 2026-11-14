import { useEffect, useState } from 'react'
import { ExternalLink } from 'lucide-react'
import { Link } from 'react-router-dom'
import { PageHeader, buttonClasses } from '../../../components/ui'
import { cornerstoneConnectionUrl } from '../../../lib/cornerstonePayroll'
import { settingsApi, type PayrollConnection } from '../../../lib/api/settings'

export default function PayrollConnectionSettings() {
  const [connection, setConnection] = useState<PayrollConnection | null>(null)
  const [error, setError] = useState('')
  const reconnectUrl = cornerstoneConnectionUrl()
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
          <p className="font-semibold">
            {connection.state.charAt(0).toUpperCase() + connection.state.replaceAll('_', ' ').slice(1)}
          </p>
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
          <div className="space-y-2 border-t border-line pt-4">
            <p className="text-sm text-ink-muted">
              The connection is started from Cornerstone Payroll, not from here. In Cornerstone Payroll, open{' '}
              <strong>Time tracking account</strong> in its settings and choose{' '}
              <strong>Connect my time tracking account</strong>. It brings you back to AIRE to confirm.
            </p>
            {reconnectUrl && (
              <a
                href={reconnectUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonClasses({ variant: 'secondary' })}
              >
                Open Cornerstone Payroll to reconnect
                <ExternalLink className="size-4" aria-hidden="true" />
                <span className="sr-only">(opens in a new tab)</span>
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
