import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type AdminTimeCategory, type ApprovalGroupOption } from '../../../lib/api'
import type { SettingsCatalogEntry } from '../../../lib/api'
import SettingHelp from '../../../components/settings/SettingHelp'
import { SettingsCatalogContext } from '../../../components/settings/settingsCatalogContext'
import { PageHeader, UnsavedChangesBar, Switch } from '../../../components/ui'
import { useUnsavedChanges } from '../../../components/ui/useUnsavedChanges'

type WorkDraft = { id?: number; name: string; description: string; is_active: boolean }

export default function DepartmentsWork() {
  const [catalog, setCatalog] = useState<SettingsCatalogEntry[]>([])
  const [groups, setGroups] = useState<ApprovalGroupOption[]>([])
  const [work, setWork] = useState<WorkDraft[]>([])
  const [baseline, setBaseline] = useState('')
  const [savedWork, setSavedWork] = useState<AdminTimeCategory[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const snapshot = JSON.stringify({ groups, work })
  const load = async () => {
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
    setGroups(nextGroups)
    setWork(nextWork)
    setSavedWork(categories.data.time_categories)
    setBaseline(JSON.stringify({ groups: nextGroups, work: nextWork }))
  }
  useEffect(() => {
    void load().catch((reason) => setError(String(reason)))
  }, [])
  const save = async () => {
    setSaving(true)
    setError('')
    try {
      const old = JSON.parse(baseline) as { groups: ApprovalGroupOption[]; work: WorkDraft[] }
      if (JSON.stringify(groups) !== JSON.stringify(old.groups)) {
        const result = await api.updateAdminAppSettings({ approval_groups: groups })
        if (!result.data) throw new Error(result.error || 'Could not save departments')
      }
      for (const item of work) {
        if (
          JSON.stringify(item) ===
          JSON.stringify(old.work.find((previous) => previous.id === item.id))
        )
          continue
        const result = item.id
          ? await api.updateTimeCategory(item.id, item)
          : await api.createTimeCategory(item)
        if (!result.data) throw new Error(result.error || 'Could not save work')
        // Retain new IDs if a later write fails, so retry never creates duplicates.
        item.id = result.data.time_category.id
      }
      for (const item of savedWork.filter(
        (item) => !work.some((current) => current.id === item.id),
      )) {
        const result = await api.deleteTimeCategory(item.id)
        if (result.error) throw new Error(result.error)
      }
      await load()
      setMessage('Changes saved')
    } catch (reason) {
      setError(`${String(reason)}. Some changes may have saved; check the list before retrying.`)
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
      {error && <p role="alert">{error}</p>}
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
    </div>
  )
}
