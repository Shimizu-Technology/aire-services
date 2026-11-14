import { Input } from '../../../components/ui'

export default function EmailChips({ id, value, disabled, onChange }: {
  id: string
  value: string
  disabled: boolean
  onChange: (value: string) => void
}) {
  const emails = [...new Set(value.split(/[\n,;]+/).map(email => email.trim()).filter(Boolean))]
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {emails.filter(email => email.includes('@')).map(email => (
          <span key={email} className="inline-flex items-center gap-2 rounded-control border border-line px-3">
            {email}
            <button
              type="button"
              disabled={disabled}
              aria-label={`Remove ${email}`}
              className="min-h-11 px-2"
              onClick={() => onChange(emails.filter(item => item !== email).join(', '))}
            >×</button>
          </span>
        ))}
      </div>
      <Input
        id={id}
        type="text"
        inputMode="email"
        value={value}
        disabled={disabled}
        placeholder="Add email addresses, separated by commas"
        onChange={event => onChange(event.target.value)}
      />
    </div>
  )
}
