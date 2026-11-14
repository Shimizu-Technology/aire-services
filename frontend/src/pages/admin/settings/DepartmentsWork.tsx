import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type AdminTimeCategory, type ApprovalGroupOption } from '../../../lib/api'
import type { SettingsCatalogEntry } from '../../../lib/api'
import SettingHelp from '../../../components/settings/SettingHelp'
import { SettingsCatalogContext } from '../../../components/settings/settingsCatalogContext'
import { PageHeader, UnsavedChangesBar, Switch } from '../../../components/ui'
import { useUnsavedChanges } from '../../../components/ui/useUnsavedChanges'
import { useConfirm } from '../../../components/ui/useConfirm'

type WorkDraft = { id?: number; name: string; description: string; is_active: boolean }

// One key order for every copy of a row, so a created row equals the server's copy.
const shape = ({ id, name, description, is_active }: WorkDraft): WorkDraft => ({
  id,
  name,
  description,
  is_active,
})

// A refusal from the server (nothing was applied), or a request whose outcome we cannot know:
// no HTTP status, a server error, or a success we could not read.
class SaveProblem extends Error {
  readonly unconfirmed: boolean
  constructor(message: string, unconfirmed: boolean) {
    super(message)
    this.unconfirmed = unconfirmed
  }
}
const problem = (result: { error?: string; status?: number }, fallback: string) =>
  new SaveProblem(
    result.error || fallback,
    result.status === undefined || result.status >= 500 || result.status < 300,
  )

const asDraft = (row: AdminTimeCategory): WorkDraft =>
  shape({ ...row, description: row.description ?? '' })

// After a failed save, line the admin's draft up with what the server now holds.
// A row the server gained since the admin last saw the list is either the create we
// could not confirm (adopt its id into the matching new row) or someone else's row
// (show it). It is never left looking like something the admin removed. Anything
// we cannot match one to one is ambiguous, and the draft is replaced by the server's list.
function reconcileWork(
  draft: WorkDraft[],
  rows: AdminTimeCategory[],
  seen: Set<number>,
): { work: WorkDraft[]; added: string[] } | 'ambiguous' {
  const unseen = rows.filter((row) => !seen.has(row.id) && !draft.some((item) => item.id === row.id))
  const fresh = draft.filter((item) => !item.id)
  const sameName = (item: WorkDraft, row: AdminTimeCategory) =>
    item.name.trim().toLowerCase() === row.name.trim().toLowerCase()
  const same = (item: WorkDraft, row: AdminTimeCategory) =>
    item.name.trim() === row.name.trim() &&
    item.description.trim() === (row.description ?? '').trim() &&
    item.is_active === row.is_active
  const matches = new Map<WorkDraft, AdminTimeCategory>()
  const extra: WorkDraft[] = []
  for (const row of unseen) {
    const named = fresh.filter((item) => sameName(item, row))
    if (!named.length) {
      extra.push(asDraft(row))
      continue
    }
    const [only] = named
    if (
      named.length > 1 ||
      !same(only, row) ||
      matches.has(only) ||
      unseen.filter((other) => sameName(only, other)).length > 1
    )
      return 'ambiguous'
    matches.set(only, row)
  }
  matches.forEach((row, item) => Object.assign(item, asDraft(row)))
  return { work: [...draft, ...extra], added: extra.map((item) => item.name) }
}

export default function DepartmentsWork() {
  const [catalog, setCatalog] = useState<SettingsCatalogEntry[]>([])
  const [groups, setGroups] = useState<ApprovalGroupOption[]>([])
  const [work, setWork] = useState<WorkDraft[]>([])
  const [baseline, setBaseline] = useState('')
  const [savedWork, setSavedWork] = useState<AdminTimeCategory[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  // True when we could not re-read the server after a failure, so the page cannot tell
  // what is saved. Saving stays off until the list is reloaded.
  const [stale, setStale] = useState(false)
  const [confirm, dialog] = useConfirm()
  const alertRef = useRef<HTMLParagraphElement>(null)
  const snapshot = JSON.stringify({ groups, work: work.map(shape) })
  // keepDraft refreshes what is saved on the server and leaves the admin's edits on screen.
  const load = async (keepDraft = false) => {
    const [settings, categories] = await Promise.all([
      api.getAdminAppSettings(),
      api.getAdminTimeCategories(),
    ])
    if (!settings.data || !categories.data)
      throw new Error(settings.error || categories.error || 'Could not load departments and work')
    setCatalog(settings.data.catalog ?? [])
    const nextGroups = settings.data.approval_groups
    const nextWork = categories.data.time_categories.map(
      ({ id, name, description, is_active }) => ({
        id,
        name,
        description: description ?? '',
        is_active,
      }),
    )
    if (!keepDraft) {
      setGroups(nextGroups)
      setWork(nextWork)
    }
    setSavedWork(categories.data.time_categories)
    setBaseline(JSON.stringify({ groups: nextGroups, work: nextWork.map(shape) }))
    return { rows: categories.data.time_categories, groups: nextGroups, work: nextWork }
  }
  useEffect(() => {
    alertRef.current?.scrollIntoView?.({ block: 'center' })
  }, [error])
  useEffect(() => {
    void load().catch((reason) => setError(String(reason)))
  }, [])
  const save = async () => {
    if (stale) {
      setError(
        "We couldn't confirm what was saved. Reload the page to see what is saved before you try again.",
      )
      return
    }
    const old = JSON.parse(baseline) as { groups: ApprovalGroupOption[]; work: WorkDraft[] }
    const removed = savedWork.filter((item) => !work.some((current) => current.id === item.id))
    for (const item of removed) {
      if (
        !(await confirm({
          title: `Permanently delete ${item.name}?`,
          description: "This can't be undone.",
          tone: 'danger',
          confirmLabel: 'Delete',
        }))
      )
        return
    }
    setSaving(true)
    setError('')
    setMessage('')
    let wrote = false
    try {
      if (JSON.stringify(groups) !== JSON.stringify(old.groups)) {
        const result = await api.updateAdminAppSettings({ approval_groups: groups })
        if (!result.data) throw problem(result, 'Could not save departments')
        wrote = true
      }
      for (const item of work) {
        const previous = item.id ? old.work.find((row) => row.id === item.id) : undefined
        if (previous && JSON.stringify(shape(item)) === JSON.stringify(shape(previous))) continue
        const result = item.id
          ? await api.updateTimeCategory(item.id, item)
          : await api.createTimeCategory(item)
        if (!result.data) throw problem(result, 'Could not save work')
        // Keep the new row's id and server copy if a later write fails, so retry never
        // creates duplicates and the row does not stay "unsaved".
        const saved = result.data.time_category
        Object.assign(item, shape({ ...saved, description: saved.description ?? '' }))
        wrote = true
      }
      for (const item of removed) {
        const result = await api.deleteTimeCategory(item.id)
        if (result.error) throw problem(result, 'Could not delete work')
        wrote = true
      }
      await load()
      setMessage('Changes saved')
    } catch (reason) {
      const unconfirmed = !(reason instanceof SaveProblem) || reason.unconfirmed
      const text = reason instanceof Error ? reason.message : String(reason)
      // Changes before the failed request are already saved; take the server's list as the
      // baseline, and make the draft agree with it before the admin can save again.
      const seen = new Set(savedWork.map((row) => row.id))
      const fresh = await load(true).catch(() => null)
      if (!fresh) {
        setStale(true)
        setError(
          unconfirmed
            ? "We couldn't confirm what was saved. Reload the page to see what is saved before you try again."
            : `${text}. Some changes may have saved. Reload the page to see what is saved before you try again.`,
        )
        return
      }
      const reconciled = reconcileWork(work, fresh.rows, seen)
      if (reconciled === 'ambiguous') {
        setGroups(fresh.groups)
        setWork(fresh.work)
        setError(
          "We couldn't confirm what was saved. This is what's saved now; check it and make any changes again.",
        )
        return
      }
      setWork(reconciled.work)
      const added = reconciled.added.length
        ? ` New in the list: ${reconciled.added.join(', ')}.`
        : ''
      setError(
        (unconfirmed
          ? "We couldn't confirm what was saved. We reloaded what is saved. Anything you edited is still on screen: check it and save again if something is missing."
          : wrote
            ? `${text}. Changes made before this problem are saved. Anything else you edited is still on screen and was not saved: fix the problem and save again.`
            : `${text}. Nothing was saved. Your edits are still on screen: fix the problem and save again.`) +
          added,
      )
    } finally {
      setSaving(false)
    }
  }
  const unsaved = useUnsavedChanges({
    dirty: !!baseline && snapshot !== baseline,
    what: 'Departments and work',
    saving,
    onSave: () => void save(),
    onDiscard: () => {
      if (stale) {
        void load().then(() => setStale(false))
        return
      }
      const previous = JSON.parse(baseline) as { groups: ApprovalGroupOption[]; work: WorkDraft[] }
      setGroups(previous.groups)
      setWork(previous.work)
    },
  })
  return (
    <div className="mx-auto max-w-[880px] space-y-6 pb-24">
      <Link to="/admin/settings" className="inline-flex min-h-11 items-center text-primary">
        Settings
      </Link>
      <PageHeader title="Departments and work" />
      {error && (
        <p
          ref={alertRef}
          role="alert"
          className="rounded-card border border-red-300 bg-red-50 p-4 text-red-800"
        >
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      <SettingsCatalogContext.Provider value={catalog}>
        <fieldset
          disabled={saving}
          className="space-y-4 rounded-card border border-line bg-surface p-4"
        >
          <legend className="font-semibold">
            Departments <SettingHelp id="approval_groups" />
          </legend>
          {groups.map((group, index) => (
            <div key={index} className="flex gap-3">
              <input
                aria-label={`Department ${index + 1}`}
                placeholder="Department name"
                value={group.label}
                onChange={(event) =>
                  setGroups((previous) =>
                    previous.map((item, at) =>
                      at === index ? { ...item, label: event.target.value } : item,
                    ),
                  )
                }
                className="min-h-11 min-w-0 flex-1 rounded-control border border-line px-3 text-base"
              />
              <button
                type="button"
                onClick={() => setGroups((previous) => previous.filter((_, at) => at !== index))}
                className="min-h-11"
              >
                Remove
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setGroups((previous) => [...previous, { key: '', label: '' }])}
            className="min-h-11 text-primary"
          >
            Add department
          </button>
        </fieldset>
        <fieldset
          disabled={saving}
          className="space-y-4 rounded-card border border-line bg-surface p-4"
        >
          <legend className="font-semibold">
            Kinds of work <SettingHelp id="time_categories" />
          </legend>
          {work.map((item, index) => (
            <div key={index} className="space-y-3 border-b border-line pb-4">
              <input
                aria-label={`Work name ${index + 1}`}
                placeholder="Name of the work"
                value={item.name}
                onChange={(event) =>
                  setWork((previous) =>
                    previous.map((row, at) =>
                      at === index ? { ...row, name: event.target.value } : row,
                    ),
                  )
                }
                className="min-h-11 w-full rounded-control border border-line px-3 text-base"
              />
              <input
                aria-label={`Work description ${index + 1}`}
                placeholder="Description (optional)"
                value={item.description}
                onChange={(event) =>
                  setWork((previous) =>
                    previous.map((row, at) =>
                      at === index ? { ...row, description: event.target.value } : row,
                    ),
                  )
                }
                className="min-h-11 w-full rounded-control border border-line px-3 text-base"
              />
              <Switch
                label="Available for clock-in"
                checked={item.is_active}
                onChange={(checked) =>
                  setWork((previous) =>
                    previous.map((row, at) =>
                      at === index ? { ...row, is_active: checked } : row,
                    ),
                  )
                }
              />
              {(!item.id || savedWork.find((row) => row.id === item.id)?.deletable) && (
                <button
                  type="button"
                  className="min-h-11 text-red-700"
                  onClick={() => setWork((previous) => previous.filter((_, at) => at !== index))}
                >
                  Delete work category
                </button>
              )}
            </div>
          ))}
          <button
            type="button"
            onClick={() =>
              setWork((previous) => [...previous, { name: '', description: '', is_active: true }])
            }
            className="min-h-11 text-primary"
          >
            Add kind of work
          </button>
        </fieldset>
      </SettingsCatalogContext.Provider>
      <UnsavedChangesBar {...unsaved.barProps} />
      {unsaved.guard}
      {dialog}
    </div>
  )
}
