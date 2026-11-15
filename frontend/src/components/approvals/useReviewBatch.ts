import { useRef, useState } from 'react'
import {
  approvalsApi,
  type ReviewEntry,
  type ReviewItem,
  type ReviewBatch,
} from '../../lib/api/approvals'
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
const unknownOutcome = (status?: number) =>
  !status || status >= 500 || (status >= 200 && status < 300)
function validBatch(data: unknown): data is ReviewBatch {
  if (!data || typeof data !== 'object') return false
  const batch = data as Partial<ReviewBatch>
  return (
    typeof batch.review_batch_id === 'string' &&
    batch.review_batch_id.trim().length > 0 &&
    typeof batch.undo_expires_at === 'string' &&
    Number.isFinite(Date.parse(batch.undo_expires_at)) &&
    Number.isInteger(batch.approved_count) &&
    Number(batch.approved_count) >= 0 &&
    Array.isArray(batch.time_entries) &&
    batch.time_entries.every(
      (row) =>
        row &&
        typeof row === 'object' &&
        Number.isInteger(row.id) &&
        Number.isInteger(row.version),
    )
  )
}

// Settle lost replies; late results cannot update UI or change retry keys.
function withDeadline<T>(request: Promise<T>, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => resolve(fallback), 30_000)
    Promise.resolve(request)
      .then(resolve, () => resolve(fallback))
      .finally(() => window.clearTimeout(timer))
  })
}
const unconfirmed = { code: 'client_deadline', error: 'Request could not be confirmed.' }
const undoneRefusal =
  'This approval was already undone. Review the refreshed list before approving again.'

export function useReviewBatch(
  reloadFresh: () => Promise<void>,
  onCommitted?: (ids: number[]) => void,
) {
  const toast = useToast()
  const latestReload = useRef(reloadFresh)
  latestReload.current = reloadFresh
  const reload = () => withDeadline(latestReload.current(), undefined)
  const lock = useRef(false)
  const retryKeys = useRef(new Map<string, string>())
  const uncertain = useRef(new Map<string, UncertainRequest>())
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [undoBatches, setUndoBatches] = useState<SucceededBatch[]>([])
  const remember = (batch: SucceededBatch, items: readonly ReviewItem[]) => {
    setUndoBatches((current) =>
      current.some((row) => row.id === batch.id) ? current : [...current, batch],
    )
    onCommitted?.(items.map((item) => item.id))
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
          .filter((row) => items.some((item) => item.id === row.id))
          .map((row) => [row.user.id, { id: row.user.id, name: row.user.full_name }]),
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
        const response = await withDeadline(approvalsApi.undo(batch.id), unconfirmed)
        if (
          (Number.isInteger(response.data?.undone_count) &&
            Number(response.data?.undone_count) >= 0) ||
          response.code === 'already_undone'
        ) {
          count += response.data?.undone_count ?? 0
          setUndoBatches((current) => current.filter((row) => row.id !== batch.id))
        } else {
          errors.push(
            unknownOutcome(response.status)
              ? "We couldn't confirm whether Undo saved. Reload before trying again."
              : response.error || "Couldn't undo this approval.",
          )
        }
      }
      const message = [
        count ? `Moved ${count} ${count === 1 ? 'shift' : 'shifts'} back to waiting.` : '',
        ...errors,
      ]
        .filter(Boolean)
        .join(' ')
      setNotice(message)
      if (message) toast.show({ message, tone: errors.length ? 'danger' : 'default' })
      await reload()
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  const refresh = async () => {
    const confirmed = new Map<number, number>()
    if (lock.current || !navigator.onLine) return
    lock.current = true
    setBusy(true)
    try {
      await reload()
      for (const [fingerprint, request] of uncertain.current) {
        const states = await Promise.all(
          request.items.map((item) => withDeadline(approvalsApi.entry(item.id), {})),
        )
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
        if (!alreadySaved) {
          const unchangedPending = request.items.every((item, index) => {
            const row = states[index].data?.time_entry
            return (
              row &&
              row.version === item.version &&
              (!item.approve_time || row.approval_status === 'pending') &&
              (!item.approve_overtime || row.overtime_status === 'pending')
            )
          })
          if (unchangedPending)
            setNotice('Not saved. The list is up to date; you can approve again.')
          continue
        }
        const response = await withDeadline(
          approvalsApi.review(request.items, request.key, request.mode),
          unconfirmed,
        )
        if (response.data?.undone) {
          uncertain.current.delete(fingerprint)
          retryKeys.current.delete(fingerprint)
          setNotice(undoneRefusal)
          toast.show({ message: undoneRefusal, tone: 'danger' })
          continue
        }
        if (!validBatch(response.data)) continue
        remember(batchFor(response.data, request.items, request.rows), request.items)
        uncertain.current.delete(fingerprint)
        retryKeys.current.delete(fingerprint)
        response.data.time_entries.forEach((row) => confirmed.set(row.id, row.version))
        setNotice('Confirmed this approval saved. Undo is available below.')
      }
    } finally {
      lock.current = false
      setBusy(false)
    }
    return confirmed
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
    let refusal = ''
    try {
      for (const chunk of approvalChunks(items, batchLimit, rows)) {
        const fingerprint = JSON.stringify({ mode, items: chunk })
        const key = retryKeys.current.get(fingerprint) ?? crypto.randomUUID()
        retryKeys.current.set(fingerprint, key)
        const response = await withDeadline(
          approvalsApi.review(chunk, key, mode),
          unconfirmed,
        )
        if (response.data?.undone || !validBatch(response.data)) {
          const unknown = !response.data?.undone && unknownOutcome(response.status)
          result = unknown ? 'unknown' : response.status === 409 ? 'conflict' : 'rejected'
          if (unknown) uncertain.current.set(fingerprint, { items: chunk, key, mode, rows })
          else {
            retryKeys.current.delete(fingerprint)
            uncertain.current.delete(fingerprint)
          }
          const server = response.data?.undone
            ? undoneRefusal
            : response.error || 'This approval was rejected.'
          const detail = server.replace(/Nothing was approved\.?/i, '').trim()
          refusal =
            unknown
              ? response.code === 'client_deadline'
                ? "We couldn't confirm that approval. The list has been refreshed — check before approving again."
                : items.length === 1
                  ? "We couldn't confirm this shift was approved. Reload before deciding again."
                  : `Confirmed ${approved} of ${items.length} shifts approved. We couldn't confirm whether this saved. This request's outcome is unknown. Reload before deciding again.`
              : approved
                ? `Approved ${approved} of ${items.length} shifts. The other ${items.length - approved} weren't approved. ${detail} The list is updated; check them and try again.`
                : `${server} ${response.status === 409 ? 'The list is updated; check them and try again.' : ''}`
          setNotice(refusal)
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
          message:
            result === 'ok' ? label : `Approved ${approved} of ${items.length} shifts.`,
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
      if (refusal) {
        let message = refusal
        if (result === 'conflict') {
          const state = items.length === 1 ? await withDeadline(approvalsApi.entry(items[0].id), {}) : undefined
          const row = state?.data?.time_entry
          message = row?.approval_status === 'approved'
            ? `${row.approved_by?.full_name || 'Another manager'} already approved this. The list has been refreshed.`
            : `${refusal} The list has been refreshed. Review the remaining shifts before trying again.`
        }
        setNotice(message)
        toast.show({ message, tone: 'danger' })
      }
      return result
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  return { approve, busy, notice, undoBatches, undo, refresh }
}
