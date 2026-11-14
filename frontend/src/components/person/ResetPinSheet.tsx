import { useState } from 'react'
import { api } from '../../lib/api'
import { Button, Field, Input, Sheet } from '../ui'

interface ResetPinSheetProps {
  open: boolean
  userId: number
  name: string
  onClose: () => void
  /** After a new PIN is saved, so the page can reload the person. */
  onReset: () => void
}

/** Sets or generates a kiosk PIN and shows it once. */
export function ResetPinSheet({ open, userId, name, onClose, onReset }: ResetPinSheetProps) {
  const [pin, setPin] = useState('')
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState<'generate' | 'custom' | null>(null)

  const close = () => {
    setPin('')
    setResult(null)
    setError(null)
    onClose()
  }

  const save = async (custom?: string) => {
    setSaving(custom ? 'custom' : 'generate')
    setError(null)
    const response = await api.resetKioskPin(userId, custom)
    setSaving(null)
    if (!response.data) {
      setError(response.error || "The PIN wasn't changed. Try again.")
      return
    }
    setResult(response.data.kiosk_pin)
    setPin('')
    onReset()
  }

  return (
    <Sheet
      open={open}
      onClose={() => { if (!saving) close() }}
      title="Reset kiosk PIN"
      description={`Set a 4 to 8 digit PIN for ${name}, or let AIRE make one.`}
      footer={result ? (
        <Button
          fullWidth
          onClick={close}
        >
          Done
        </Button>
      ) : (
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            variant="secondary"
            onClick={() => void save()}
            loading={saving === 'generate'}
            disabled={saving !== null}
          >
            Make a PIN for me
          </Button>
          <Button
            onClick={() => void save(pin)}
            loading={saving === 'custom'}
            disabled={saving !== null || pin.length < 4}
          >
            Save this PIN
          </Button>
        </div>
      )}
    >
      {result ? (
        <div role="status" className="rounded-card border border-emerald-200 bg-emerald-50 px-4 py-3">
          <p className="text-body-sm font-semibold text-emerald-900">New PIN for {name}</p>
          <p className="mt-1 font-mono text-heading font-semibold tracking-[0.2em] text-ink">{result}</p>
          <p className="mt-1 text-body-sm text-ink-muted">Share it privately. It won't be shown again.</p>
        </div>
      ) : (
        <div className="space-y-3">
          <Field
            label="New PIN"
            help="Leave it blank and choose Make a PIN for me to get a random one."
          >
            <Input
              value={pin}
              onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, 8))}
              inputMode="numeric"
              autoComplete="off"
              enterKeyHint="done"
            />
          </Field>
          {error && <p role="alert" className="text-body-sm text-danger">{error}</p>}
        </div>
      )}
    </Sheet>
  )
}
