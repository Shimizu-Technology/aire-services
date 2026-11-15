import { Button, Input } from '../../../components/ui'

/**
 * A list of email addresses as chips, with one field to add the next address.
 * The list is only what has been added; typed text is not part of it until Add.
 */
export default function EmailChips({
  id,
  label,
  emails,
  pending,
  disabled,
  error,
  onPendingChange,
  onAdd,
  onRemove,
}: {
  id: string
  label: string
  emails: string[]
  pending: string
  disabled: boolean
  error?: string
  onPendingChange: (value: string) => void
  onAdd: () => void
  onRemove: (email: string) => void
}) {
  const unique = [...new Map(emails.map((email) => [email.toLowerCase(), email])).values()]
  const errorId = error ? `${id}-error` : undefined
  return (
    <div className="space-y-2">
      {unique.length > 0 && (
        <ul aria-label={`${label}: current addresses`} className="flex flex-wrap gap-2">
          {unique.map((email) => (
            <li
              key={email}
              className="inline-flex items-center gap-2 rounded-control border border-line pl-3"
            >
              {email}
              <button
                type="button"
                disabled={disabled}
                aria-label={`Remove ${email}`}
                className="min-h-11 px-3"
                onClick={() => onRemove(email)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1 basis-64">
          <Input
            id={id}
            type="text"
            inputMode="email"
            autoComplete="off"
            value={pending}
            disabled={disabled}
            placeholder="name@example.com"
            aria-invalid={error ? true : undefined}
            aria-describedby={errorId}
            onChange={(event) => onPendingChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                onAdd()
              }
            }}
          />
        </div>
        <Button variant="secondary" disabled={disabled || !pending.trim()} onClick={onAdd}>
          Add email address
        </Button>
      </div>
      {error && (
        <p id={errorId} className="text-sm font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  )
}
