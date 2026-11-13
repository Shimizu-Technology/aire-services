import { useRef, useState } from 'react'
import { approvalsApi, type ReviewItem } from '../../lib/api/approvals'
import { useToast } from '../ui'

export interface SucceededBatch { id: string; count: number; expiresAt: string }
export function useReviewBatch(reload: () => Promise<void>) {
  const toast = useToast()
  const lock = useRef(false)
  const retryKeys = useRef(new Map<string, string>())
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [undoBatches, setUndoBatches] = useState<SucceededBatch[]>([])
  const undo = async (batches: SucceededBatch[]) => {
    if (lock.current || !navigator.onLine) return
    lock.current = true; setBusy(true)
    let count = 0
    const remaining: SucceededBatch[] = []
    const errors: string[] = []
    try {
      // Reverse commit order, and attempt every succeeded batch even if one
      // refuses. Keep only refused batches available to retry.
      for (const batch of [...batches].reverse()) {
        const response = await approvalsApi.undo(batch.id)
        if (response.data) count += response.data.undone_count
        else { remaining.unshift(batch); errors.push(response.error || "Couldn't undo this approval.") }
      }
      setUndoBatches(current => current.filter(batch => !batches.some(item => item.id === batch.id)).concat(remaining))
      const message = [count ? `Moved ${count} shifts back to waiting.` : '', ...errors].filter(Boolean).join(' ')
      setNotice(message); toast.show({ message, tone: errors.length ? 'danger' : 'default' })
      await reload()
    } finally { lock.current = false; setBusy(false) }
  }
  const approve = async (items: readonly ReviewItem[], batchLimit: number, label: string, mode: 'ordinary' | 'reviewed' = 'ordinary') => {
    if (lock.current || !navigator.onLine || !items.length) return false
    if (!Number.isInteger(batchLimit) || batchLimit < 1) { setNotice("Couldn't read the approval limit. Reload and try again."); return false }
    lock.current = true; setBusy(true); setNotice('')
    const succeeded: SucceededBatch[] = []
    let approved = 0
    let complete = true
    try {
      for (let offset = 0; offset < items.length; offset += batchLimit) {
        const chunk = items.slice(offset, offset + batchLimit)
        const fingerprint = JSON.stringify({ mode, items: chunk })
        // Retain the key after transport uncertainty. An identical retry must
        // replay a possible commit, rather than make a second approval.
        const key = retryKeys.current.get(fingerprint) ?? crypto.randomUUID()
        retryKeys.current.set(fingerprint, key)
        const response = await approvalsApi.review(chunk, key, mode)
        if (!response.data) {
          complete = false
          if (response.status) retryKeys.current.delete(fingerprint)
          const server = response.error || 'The connection was interrupted. Reload to check what was saved before retrying.'
          const detail = server.replace(/Nothing was approved\.?/i, '').trim()
          const message = approved
            ? `Approved ${approved} of ${items.length} shifts. The other ${items.length - approved} weren't approved. ${detail} The list is updated; check them and try again.`
            : `${server} ${response.status === 409 ? 'The list is updated; check them and try again.' : ''}`
          setNotice(message)
          break
        }
        retryKeys.current.delete(fingerprint)
        const batch = { id: response.data.review_batch_id, count: chunk.length, expiresAt: response.data.undo_expires_at }
        succeeded.push(batch); approved += chunk.length
      }
      if (succeeded.length) {
        setUndoBatches(current => [...current, ...succeeded.filter(batch => !current.some(item => item.id === batch.id))])
        toast.show({ message: complete ? label : `Approved ${approved} of ${items.length} shifts.`, duration: 10_000,
          action: { label: 'Undo', onAction: () => { void undo(succeeded) } } })
      }
      await reload()
      return complete
    } finally { lock.current = false; setBusy(false) }
  }
  return { approve, busy, notice, undoBatches, undo }
}
