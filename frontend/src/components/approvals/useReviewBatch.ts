import { useRef, useState } from 'react'
import { approvalsApi, type ReviewEntry, type ReviewItem } from '../../lib/api/approvals'
import { approvalChunks } from '../../lib/approvalsFilters'
import { useToast } from '../ui'

export type ApprovalResult = 'ok' | 'conflict' | 'rejected' | 'unknown'
export interface SucceededBatch {
  id: string
  count: number
  expiresAt: string
  people?: { id: number; name: string }[]
}
interface UncertainRequest {
  items: ReviewItem[]
  key: string
  mode: 'ordinary' | 'reviewed'
  rows: readonly ReviewEntry[]
}
const unknownOutcome = (status?: number) => !status || status >= 500

export function useReviewBatch(reload: () => Promise<void>, onCommitted?: (ids: number[]) => void) {
  const toast = useToast()
  const lock = useRef(false)
  const retryKeys = useRef(new Map<string, string>())
  const uncertain = useRef(new Map<string, UncertainRequest>())
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [undoBatches, setUndoBatches] = useState<SucceededBatch[]>([])
  const remember = (batch: SucceededBatch, items: readonly ReviewItem[]) => {
    setUndoBatches(current =>
      current.some(row => row.id === batch.id) ? current : [...current, batch],
    )
    onCommitted?.(items.map(item => item.id))
  }
  const batchFor = (
    data: { review_batch_id: string; undo_expires_at: string },
    items: readonly ReviewItem[],
    rows: readonly ReviewEntry[],
  ): SucceededBatch => ({
    id: data.review_batch_id,
    count: items.length,
    expiresAt: data.undo_expires_at,
    people: [
      ...new Map(
        rows
          .filter(row => items.some(item => item.id === row.id))
          .map(row => [row.user.id, { id: row.user.id, name: row.user.full_name }]),
      ).values(),
    ],
  })
  const undo = async (batches: SucceededBatch[]) => {
    if (lock.current || !navigator.onLine) return
    lock.current = true
    setBusy(true)
    let count = 0
    const errors: string[] = []
    try {
      for (const batch of [...batches].reverse()) {
        const response = await approvalsApi.undo(batch.id)
        if (response.data || response.code === 'already_undone') {
          count += response.data?.undone_count ?? 0
          setUndoBatches(current => current.filter(row => row.id !== batch.id))
        } else {
          errors.push(
            unknownOutcome(response.status)
              ? "We couldn't confirm whether Undo saved. Reload before trying again."
              : response.error || "Couldn't undo this approval.",
          )
        }
      }
      const message = [count ? `Moved ${count} shifts back to waiting.` : '', ...errors]
        .filter(Boolean)
        .join(' ')
      setNotice(message)
      toast.show({ message, tone: errors.length ? 'danger' : 'default' })
      await reload()
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  const refresh = async () => {
    if (lock.current || !navigator.onLine) return
    lock.current = true
    setBusy(true)
    try {
      await reload()
      for (const [fingerprint, request] of uncertain.current) {
        const states = await Promise.all(request.items.map(item => approvalsApi.entry(item.id)))
        // Only replay once all requested decisions are already saved. If the
        // first request never committed, this check prevents Reload approving
        // pending time. The same key then recovers the committed batch + Undo.
        const alreadySaved = request.items.every((item, index) => {
          const row = states[index].data?.time_entry
          return (
            row &&
            (!item.approve_time || row.approval_status === 'approved') &&
            (!item.approve_overtime || row.overtime_status === 'approved')
          )
        })
        if (!alreadySaved) continue
        const response = await approvalsApi.review(request.items, request.key, request.mode)
        if (!response.data) continue
        remember(batchFor(response.data, request.items, request.rows), request.items)
        uncertain.current.delete(fingerprint)
        retryKeys.current.delete(fingerprint)
        setNotice('Confirmed this approval saved. Undo is available below.')
      }
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  const approve = async (
    items: readonly ReviewItem[],
    batchLimit: number,
    label: string,
    mode: 'ordinary' | 'reviewed' = 'ordinary',
    rows: readonly ReviewEntry[] = [],
  ): Promise<ApprovalResult> => {
    if (lock.current || !navigator.onLine || !items.length) return 'rejected'
    if (!Number.isInteger(batchLimit) || batchLimit < 1) {
      setNotice("Couldn't read the approval limit. Reload and try again.")
      return 'rejected'
    }
    lock.current = true
    setBusy(true)
    setNotice('')
    toast.dismiss()
    const succeeded: SucceededBatch[] = []
    let approved = 0
    let result: ApprovalResult = 'ok'
    try {
      for (const chunk of approvalChunks(items, batchLimit, rows)) {
        const fingerprint = JSON.stringify({ mode, items: chunk })
        const key = retryKeys.current.get(fingerprint) ?? crypto.randomUUID()
        retryKeys.current.set(fingerprint, key)
        const response = await approvalsApi.review(chunk, key, mode)
        if (!response.data) {
          const unknown = unknownOutcome(response.status)
          result = unknown ? 'unknown' : response.status === 409 ? 'conflict' : 'rejected'
          if (unknown) uncertain.current.set(fingerprint, { items: chunk, key, mode, rows })
          else {
            retryKeys.current.delete(fingerprint)
            uncertain.current.delete(fingerprint)
          }
          const server = response.error || 'This approval was rejected.'
          const detail = server.replace(/Nothing was approved\.?/i, '').trim()
          setNotice(
            unknown
              ? `Confirmed ${approved} of ${items.length} shifts approved. We couldn't confirm whether this saved. This request's outcome is unknown. Reload before deciding again.`
              : approved
                ? `Approved ${approved} of ${items.length} shifts. The other ${items.length - approved} weren't approved. ${detail} The list is updated; check them and try again.`
                : `${server} ${response.status === 409 ? 'The list is updated; check them and try again.' : ''}`,
          )
          break
        }
        retryKeys.current.delete(fingerprint)
        uncertain.current.delete(fingerprint)
        const batch = batchFor(response.data, chunk, rows)
        remember(batch, chunk)
        succeeded.push(batch)
        approved += chunk.length
      }
      if (succeeded.length) {
        toast.show({
          message: result === 'ok' ? label : `Approved ${approved} of ${items.length} shifts.`,
          duration: 10_000,
          action: {
            label: 'Undo',
            onAction: () => {
              void undo(succeeded)
            },
          },
        })
      }
      await reload()
      return result
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  return { approve, busy, notice, undoBatches, undo, refresh }
}
