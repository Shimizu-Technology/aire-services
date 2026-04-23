import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../../lib/api'

interface KioskPinSetupModalProps {
  open: boolean
  userName: string
  onComplete: () => Promise<void> | void
}

export default function KioskPinSetupModal({ open, userName, onComplete }: KioskPinSetupModalProps) {
  const [pin, setPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const pinInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) {
      setPin('')
      setConfirmPin('')
      setError('')
      setSaving(false)
      return
    }

    setTimeout(() => pinInputRef.current?.focus(), 0)
  }, [open])

  const pinLooksValid = useMemo(() => /^\d{4,8}$/.test(pin), [pin])

  if (!open) return null

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError('')

    if (!pinLooksValid) {
      setError('Enter a 4 to 8 digit PIN.')
      return
    }

    if (pin !== confirmPin) {
      setError('PIN confirmation does not match.')
      return
    }

    setSaving(true)
    try {
      const response = await api.setMyKioskPin(pin)
      if (response.error) {
        setError(response.error)
        return
      }

      try {
        await onComplete()
      } catch {
        setError('Your PIN was saved, but we could not refresh your account. Please reload the page.')
        return
      }

      setPin('')
      setConfirmPin('')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/55 p-4">
      <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-6 shadow-2xl">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-cyan-700">Kiosk setup</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">Create your kiosk PIN</h2>
          <p className="mt-2 text-sm text-slate-600">
            {userName}, set the PIN you&apos;ll use at the staff kiosk. You only need to do this once.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">PIN</label>
            <input
              ref={pinInputRef}
              type="password"
              inputMode="numeric"
              autoComplete="new-password"
              maxLength={8}
              value={pin}
              onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, 8))}
              className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-100"
              placeholder="4 to 8 digits"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">Confirm PIN</label>
            <input
              type="password"
              inputMode="numeric"
              autoComplete="new-password"
              maxLength={8}
              value={confirmPin}
              onChange={(event) => setConfirmPin(event.target.value.replace(/\D/g, '').slice(0, 8))}
              className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-100"
              placeholder="Re-enter PIN"
            />
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-500">
            This PIN is separate from your email login and is only used at the kiosk.
          </div>

          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={saving}
            className="w-full rounded-xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save kiosk PIN'}
          </button>
        </form>
      </div>
    </div>
  )
}
