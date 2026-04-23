import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { api } from '../../lib/api'

interface TimeCategoryOption {
  id: number
  name: string
}

interface EditableTimeEntry {
  id: number
  work_date: string
  start_time: string | null
  end_time: string | null
  break_minutes: number | null
  description: string | null
  approval_status?: 'pending' | 'approved' | 'denied' | null
  approval_note?: string | null
  approved_by?: { id: number; full_name: string } | null
  locked_at: string | null
  user: {
    id: number
    email: string
    display_name?: string
    full_name?: string
  }
  time_category: {
    id: number
    name: string
  } | null
}

interface EditTimeEntryModalProps {
  isOpen: boolean
  entry: EditableTimeEntry | null
  categories: TimeCategoryOption[]
  canDelete: boolean
  onClose: () => void
  onSaved: () => void | Promise<void>
  onDeleted: () => void | Promise<void>
  onError?: (message: string | null) => void
}

const BREAK_PRESETS = [
  { label: 'None', minutes: null },
  { label: '15m', minutes: 15 },
  { label: '30m', minutes: 30 },
  { label: '45m', minutes: 45 },
  { label: '1h', minutes: 60 },
  { label: 'Custom', minutes: -1 },
]

export default function EditTimeEntryModal({
  isOpen,
  entry,
  categories,
  canDelete,
  onClose,
  onSaved,
  onDeleted,
  onError,
}: EditTimeEntryModalProps) {
  const [formData, setFormData] = useState({
    work_date: '',
    start_time: '08:00',
    end_time: '17:00',
    description: '',
    time_category_id: '',
    break_minutes: null as number | null,
  })
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isOpen || !entry) return

    setFormData({
      work_date: entry.work_date,
      start_time: entry.start_time || '08:00',
      end_time: entry.end_time || '17:00',
      description: entry.description || '',
      time_category_id: entry.time_category?.id.toString() || '',
      break_minutes: entry.break_minutes,
    })
    setError(null)
  }, [entry, isOpen])

  const calculatedHours = useMemo(() => {
    if (!formData.start_time || !formData.end_time) return 0

    const [startH, startM] = formData.start_time.split(':').map(Number)
    const [endH, endM] = formData.end_time.split(':').map(Number)
    const startMinutes = startH * 60 + startM
    const endMinutes = endH * 60 + endM

    let durationMinutes = endMinutes - startMinutes
    if (durationMinutes < 0) durationMinutes += 24 * 60
    if (formData.break_minutes) durationMinutes -= formData.break_minutes

    return Math.max(0, durationMinutes / 60)
  }, [formData.break_minutes, formData.end_time, formData.start_time])

  if (!isOpen || !entry) return null

  const ownerName = entry.user.full_name || entry.user.display_name || entry.user.email.split('@')[0]
  const isLocked = !!entry.locked_at

  const setLocalError = (message: string | null) => {
    setError(message)
    onError?.(message)
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setSaving(true)
    setLocalError(null)

    try {
      const response = await api.updateTimeEntry(entry.id, {
        work_date: formData.work_date,
        start_time: formData.start_time,
        end_time: formData.end_time,
        description: formData.description || undefined,
        time_category_id: formData.time_category_id ? parseInt(formData.time_category_id, 10) : undefined,
        break_minutes: formData.break_minutes,
      })

      if (response.error) {
        setLocalError(response.error)
        return
      }

      await onSaved()
    } catch {
      setLocalError('Failed to save time entry')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!canDelete) return
    if (!confirm('Are you sure you want to delete this time entry?')) return

    setDeleting(true)
    setLocalError(null)

    try {
      const response = await api.deleteTimeEntry(entry.id)
      if (response.error) {
        setLocalError(response.error)
        return
      }

      await onDeleted()
    } catch {
      setLocalError('Failed to delete time entry')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
        onClick={(event) => {
          if (event.target === event.currentTarget) onClose()
        }}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          transition={{ duration: 0.25, delay: 0.1 }}
          className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white shadow-xl"
        >
          <div className="p-6">
            <h2 className="mb-1 text-xl font-bold text-primary-dark">Edit Time Entry</h2>
            <div className="mb-4">
              <p className="text-sm text-primary-dark/70">
                Entry for: <span className="font-medium text-primary-dark">{ownerName}</span>
              </p>
              {isLocked && (
                <div className="mt-2 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
                  <LockIcon />
                  <span>This entry is locked and cannot be edited.</span>
                </div>
              )}
              {entry.approved_by && (
                <div className={`mt-2 rounded-lg border px-3 py-2 text-sm ${
                  entry.approval_status === 'approved'
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                    : 'border-red-200 bg-red-50 text-red-700'
                }`}>
                  <span className="font-medium">
                    {entry.approval_status === 'approved' ? 'Approved' : 'Denied'}
                  </span>{' '}
                  by {entry.approved_by.full_name}
                  {entry.approval_note && (
                    <p className="mt-1 text-xs italic opacity-80">"{entry.approval_note}"</p>
                  )}
                </div>
              )}
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <fieldset disabled={isLocked || saving || deleting} className={isLocked ? 'opacity-60' : ''}>
                <div>
                  <label className="mb-1 block text-sm font-medium text-primary-dark">Date *</label>
                  <input
                    type="date"
                    value={formData.work_date}
                    onChange={(event) => setFormData({ ...formData, work_date: event.target.value })}
                    className="w-full rounded-lg border border-neutral-warm px-3 py-2 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-primary"
                    required
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="mb-1 block text-sm font-medium text-primary-dark">Start Time *</label>
                    <input
                      type="time"
                      value={formData.start_time}
                      onChange={(event) => setFormData({ ...formData, start_time: event.target.value })}
                      className="w-full rounded-lg border border-neutral-warm px-3 py-2 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-primary"
                      required
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-primary-dark">End Time *</label>
                    <input
                      type="time"
                      value={formData.end_time}
                      onChange={(event) => setFormData({ ...formData, end_time: event.target.value })}
                      className="w-full rounded-lg border border-neutral-warm px-3 py-2 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-primary"
                      required
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between rounded-lg bg-neutral-warm/30 p-3">
                  <span className="text-sm text-primary-dark">Calculated Hours:</span>
                  <span className="text-lg font-bold text-primary">{calculatedHours.toFixed(2)}h</span>
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-primary-dark">Break Duration</label>
                  <div className="mb-2 flex flex-wrap gap-2">
                    {BREAK_PRESETS.map((preset) => (
                      <button
                        key={preset.label}
                        type="button"
                        onClick={() => {
                          if (preset.minutes === -1) {
                            setFormData({ ...formData, break_minutes: formData.break_minutes || 0 })
                          } else {
                            setFormData({ ...formData, break_minutes: preset.minutes })
                          }
                        }}
                        className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                          (preset.minutes === null && formData.break_minutes === null) ||
                          (preset.minutes === formData.break_minutes) ||
                          (preset.minutes === -1 &&
                            formData.break_minutes !== null &&
                            !BREAK_PRESETS.slice(0, -1).some((item) => item.minutes === formData.break_minutes))
                            ? 'bg-primary text-white'
                            : 'bg-neutral-warm text-primary-dark hover:bg-primary/20'
                        }`}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                  {formData.break_minutes !== null &&
                    !BREAK_PRESETS.slice(0, -1).some((preset) => preset.minutes === formData.break_minutes) && (
                      <input
                        type="number"
                        min="0"
                        max="480"
                        value={formData.break_minutes || ''}
                        onChange={(event) => setFormData({
                          ...formData,
                          break_minutes: event.target.value ? parseInt(event.target.value, 10) : null,
                        })}
                        placeholder="Minutes"
                        className="w-full rounded-lg border border-neutral-warm px-3 py-2 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-primary"
                      />
                    )}
                  <p className="mt-1 text-xs text-text-muted">Break time is not counted toward work hours</p>
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-primary-dark">Category</label>
                  <select
                    value={formData.time_category_id}
                    onChange={(event) => setFormData({ ...formData, time_category_id: event.target.value })}
                    className="w-full rounded-lg border border-neutral-warm px-3 py-2 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    <option value="">Select category...</option>
                    {categories.map((category) => (
                      <option key={category.id} value={category.id}>{category.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-primary-dark">Description</label>
                  <textarea
                    value={formData.description}
                    onChange={(event) => setFormData({ ...formData, description: event.target.value })}
                    rows={3}
                    placeholder="What did you work on?"
                    className="w-full resize-none rounded-lg border border-neutral-warm px-3 py-2 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
              </fieldset>

              {error && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
                  {error}
                </div>
              )}

              <div className="flex items-center justify-between gap-3 pt-4">
                <div>
                  <button
                    type="button"
                    onClick={handleDelete}
                    disabled={!canDelete || deleting || saving}
                    className={`rounded-lg px-4 py-2 transition-colors ${
                      canDelete ? 'text-red-600 hover:bg-red-50' : 'cursor-not-allowed text-gray-300'
                    }`}
                    title={canDelete ? 'Delete this time entry' : 'This entry is locked/finalized or cannot be deleted'}
                  >
                    {deleting ? 'Deleting...' : 'Delete'}
                  </button>
                </div>

                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={onClose}
                    className="rounded-lg px-4 py-2 font-medium text-primary-dark transition-colors hover:bg-neutral-warm"
                  >
                    Cancel
                  </button>
                  {!isLocked && (
                    <button
                      type="submit"
                      disabled={saving || deleting}
                      className="rounded-lg bg-primary px-4 py-2 text-white transition-colors hover:bg-primary-dark disabled:opacity-50"
                    >
                      {saving ? 'Saving...' : 'Update'}
                    </button>
                  )}
                </div>
              </div>
            </form>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}

function LockIcon() {
  return (
    <svg className="h-3 w-3" fill="none" aria-hidden="true" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
    </svg>
  )
}
