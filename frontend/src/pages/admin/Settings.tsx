import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../../lib/api'
import type { AdminTimeCategory, TimeClockAppSettings } from '../../lib/api'
import { FadeUp } from '../../components/ui/MotionComponents'

const emptyCategoryForm = {
  name: '',
  key: '',
  description: '',
  is_active: true,
}

export default function Settings() {
  useEffect(() => {
    document.title = 'Settings | AIRE Ops'
  }, [])

  const [categories, setCategories] = useState<AdminTimeCategory[]>([])
  const [clockSettings, setClockSettings] = useState<TimeClockAppSettings | null>(null)
  const [thresholdDraft, setThresholdDraft] = useState({
    overtime_daily_threshold_hours: '',
    overtime_weekly_threshold_hours: '',
    early_clock_in_buffer_minutes: '',
  })
  const [loading, setLoading] = useState(true)
  const [categoriesError, setCategoriesError] = useState('')
  const [settingsError, setSettingsError] = useState('')
  const [savingCategory, setSavingCategory] = useState(false)
  const [savingThresholds, setSavingThresholds] = useState(false)
  const [showInactive, setShowInactive] = useState(true)
  const [categoryModalOpen, setCategoryModalOpen] = useState(false)
  const [editingCategory, setEditingCategory] = useState<AdminTimeCategory | null>(null)
  const [categoryForm, setCategoryForm] = useState(emptyCategoryForm)
  const modalRef = useRef<HTMLDivElement>(null)

  const loadData = useCallback(async () => {
    setLoading(true)
    setCategoriesError('')
    setSettingsError('')
    try {
      const [catRes, setRes] = await Promise.all([api.getAdminTimeCategories(), api.getAdminAppSettings()])
      if (catRes.error) setCategoriesError(catRes.error)
      else if (catRes.data) setCategories(catRes.data.time_categories)

      if (setRes.error) setSettingsError(setRes.error)
      else if (setRes.data) {
        const s = setRes.data.settings
        setClockSettings(s)
        setThresholdDraft({
          overtime_daily_threshold_hours: s.overtime_daily_threshold_hours,
          overtime_weekly_threshold_hours: s.overtime_weekly_threshold_hours,
          early_clock_in_buffer_minutes: s.early_clock_in_buffer_minutes,
        })
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadData()
  }, [loadData])

  useEffect(() => {
    if (categoryModalOpen && modalRef.current) {
      const first = modalRef.current.querySelector<HTMLElement>('input, select, textarea')
      if (first) setTimeout(() => first.focus(), 0)
    }
  }, [categoryModalOpen])

  const openNewCategory = () => {
    setEditingCategory(null)
    setCategoryForm(emptyCategoryForm)
    setCategoryModalOpen(true)
  }

  const openEditCategory = (cat: AdminTimeCategory) => {
    setEditingCategory(cat)
    setCategoryForm({
      name: cat.name,
      key: cat.key ?? '',
      description: cat.description ?? '',
      is_active: cat.is_active,
    })
    setCategoryModalOpen(true)
  }

  const closeCategoryModal = () => {
    setCategoryModalOpen(false)
    setEditingCategory(null)
    setCategoryForm(emptyCategoryForm)
  }

  const handleSaveCategory = async (e: React.FormEvent) => {
    e.preventDefault()
    const name = categoryForm.name.trim()
    if (!name) return

    const payload = {
      name,
      key: categoryForm.key.trim() || null,
      description: categoryForm.description.trim() || null,
      ...(editingCategory ? { is_active: categoryForm.is_active } : {}),
    }

    setSavingCategory(true)
    try {
      const res = editingCategory
        ? await api.updateTimeCategory(editingCategory.id, payload)
        : await api.createTimeCategory(payload)

      if (res.error) {
        alert(res.error)
        return
      }
      closeCategoryModal()
      loadData()
    } finally {
      setSavingCategory(false)
    }
  }

  const handleDeactivateCategory = async (cat: AdminTimeCategory) => {
    if (cat.time_entries_count > 0) {
      if (!confirm(`Deactivate "${cat.name}"? Existing time entries keep this category; it will be hidden from new clock-ins.`)) return
    } else if (!confirm(`Deactivate "${cat.name}"?`)) return

    const res = await api.deleteTimeCategory(cat.id)
    if (res.error) alert(res.error)
    else loadData()
  }

  const handleReactivateCategory = async (cat: AdminTimeCategory) => {
    const res = await api.updateTimeCategory(cat.id, { is_active: true })
    if (res.error) alert(res.error)
    else loadData()
  }

  const handleSaveThresholds = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!clockSettings) return

    setSavingThresholds(true)
    setSettingsError('')
    try {
      const res = await api.updateAdminAppSettings({
        overtime_daily_threshold_hours: thresholdDraft.overtime_daily_threshold_hours,
        overtime_weekly_threshold_hours: thresholdDraft.overtime_weekly_threshold_hours,
        early_clock_in_buffer_minutes: thresholdDraft.early_clock_in_buffer_minutes,
      })
      if (res.error) {
        setSettingsError(res.error)
        return
      }
      if (res.data) {
        setClockSettings(res.data.settings)
        setThresholdDraft({
          overtime_daily_threshold_hours: res.data.settings.overtime_daily_threshold_hours,
          overtime_weekly_threshold_hours: res.data.settings.overtime_weekly_threshold_hours,
          early_clock_in_buffer_minutes: res.data.settings.early_clock_in_buffer_minutes,
        })
      }
    } finally {
      setSavingThresholds(false)
    }
  }

  const visibleCategories = showInactive ? categories : categories.filter((c) => c.is_active)

  return (
    <div className="space-y-8">
      <FadeUp>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Settings</h1>
          <p className="mt-1 text-sm text-slate-600">
            Manage work categories for kiosk clock-in, overtime rules, and early clock-in window.
          </p>
        </div>
      </FadeUp>

      {loading ? (
        <div className="rounded-2xl border border-slate-200 bg-white px-5 py-12 text-center text-sm text-slate-500 shadow-sm">Loading settings…</div>
      ) : (
        <>
          <FadeUp delay={0.05}>
            <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 px-5 py-4">
                <h2 className="text-lg font-semibold text-slate-900">Time clock rules</h2>
                <p className="mt-1 text-sm text-slate-500">
                  Overtime flags and how early staff may clock in before a scheduled shift.
                </p>
              </div>
              <form onSubmit={handleSaveThresholds} className="space-y-5 px-5 py-5">
                {settingsError && (
                  <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{settingsError}</div>
                )}
                <div className="grid gap-5 sm:grid-cols-3">
                  <div>
                    <label className="mb-2 block text-sm font-medium text-slate-700">Daily overtime after (hours)</label>
                    <input
                      type="number"
                      step="0.25"
                      min="0.25"
                      required
                      value={thresholdDraft.overtime_daily_threshold_hours}
                      onChange={(e) => setThresholdDraft((d) => ({ ...d, overtime_daily_threshold_hours: e.target.value }))}
                      className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-100"
                    />
                  </div>
                  <div>
                    <label className="mb-2 block text-sm font-medium text-slate-700">Weekly overtime after (hours)</label>
                    <input
                      type="number"
                      step="0.25"
                      min="0.25"
                      required
                      value={thresholdDraft.overtime_weekly_threshold_hours}
                      onChange={(e) => setThresholdDraft((d) => ({ ...d, overtime_weekly_threshold_hours: e.target.value }))}
                      className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-100"
                    />
                  </div>
                  <div>
                    <label className="mb-2 block text-sm font-medium text-slate-700">Early clock-in buffer (minutes)</label>
                    <input
                      type="number"
                      step="1"
                      min="0"
                      required
                      value={thresholdDraft.early_clock_in_buffer_minutes}
                      onChange={(e) => setThresholdDraft((d) => ({ ...d, early_clock_in_buffer_minutes: e.target.value }))}
                      className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-100"
                    />
                  </div>
                </div>
                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={savingThresholds || !clockSettings}
                    className="rounded-xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
                  >
                    {savingThresholds ? 'Saving…' : 'Save time clock rules'}
                  </button>
                </div>
              </form>
            </section>
          </FadeUp>

          <FadeUp delay={0.1}>
            <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="flex flex-col gap-4 border-b border-slate-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">Time categories</h2>
                  <p className="mt-1 text-sm text-slate-500">
                    Define the types of work your team tracks. Assign categories to people on the <a href="/admin/users" className="font-medium text-cyan-700 hover:text-cyan-900">Users</a> page.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-600">
                    <input
                      type="checkbox"
                      checked={showInactive}
                      onChange={(e) => setShowInactive(e.target.checked)}
                      className="rounded border-slate-300 text-cyan-600 focus:ring-cyan-500"
                    />
                    Show inactive
                  </label>
                  <button
                    type="button"
                    onClick={openNewCategory}
                    className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
                  >
                    Add category
                  </button>
                </div>
              </div>

              {categoriesError && (
                <div className="mx-5 mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{categoriesError}</div>
              )}

              {visibleCategories.length === 0 ? (
                <div className="px-5 py-10 text-center text-sm text-slate-500">No categories match this filter.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[600px]">
                    <thead className="bg-slate-50">
                      <tr>
                        <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Name</th>
                        <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Key</th>
                        <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Entries</th>
                        <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Status</th>
                        <th className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {visibleCategories.map((cat) => (
                        <tr key={cat.id} className={cat.is_active ? 'hover:bg-slate-50/80' : 'bg-slate-50/60 text-slate-500'}>
                          <td className="px-5 py-4">
                            <div className="font-medium text-slate-900">{cat.name}</div>
                            {cat.description && <div className="mt-1 max-w-md text-xs text-slate-500">{cat.description}</div>}
                          </td>
                          <td className="px-5 py-4 font-mono text-xs">{cat.key ?? '—'}</td>
                          <td className="px-5 py-4 text-sm">{cat.time_entries_count}</td>
                          <td className="px-5 py-4">
                            {cat.is_active ? (
                              <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
                                Active
                              </span>
                            ) : (
                              <span className="inline-flex rounded-full border border-slate-200 bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
                                Inactive
                              </span>
                            )}
                          </td>
                          <td className="px-5 py-4">
                            <div className="flex justify-end gap-3 text-sm font-medium">
                              <button type="button" onClick={() => openEditCategory(cat)} className="text-cyan-700 hover:text-cyan-900">
                                Edit
                              </button>
                              {cat.is_active ? (
                                <button type="button" onClick={() => handleDeactivateCategory(cat)} className="text-slate-600 hover:text-slate-900">
                                  Deactivate
                                </button>
                              ) : (
                                <button type="button" onClick={() => handleReactivateCategory(cat)} className="text-cyan-700 hover:text-cyan-900">
                                  Reactivate
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </FadeUp>
        </>
      )}

      {categoryModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div ref={modalRef} className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold text-slate-900">{editingCategory ? 'Edit category' : 'New time category'}</h2>
                <p className="mt-1 text-sm text-slate-500">Define a type of work your team can track time against.</p>
              </div>
              <button type="button" onClick={closeCategoryModal} className="rounded-lg px-2 py-1 text-slate-500 hover:bg-slate-100">
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveCategory} className="mt-6 space-y-4">
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700">Name</label>
                <input
                  value={categoryForm.name}
                  onChange={(e) => setCategoryForm((f) => ({ ...f, name: e.target.value }))}
                  className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-100"
                  required
                />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700">Key (optional)</label>
                <input
                  value={categoryForm.key}
                  onChange={(e) => setCategoryForm((f) => ({ ...f, key: e.target.value }))}
                  placeholder="e.g. aire_flight_instruction"
                  className="w-full rounded-xl border border-slate-300 px-4 py-3 font-mono text-sm outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-100"
                />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700">Description (optional)</label>
                <textarea
                  value={categoryForm.description}
                  onChange={(e) => setCategoryForm((f) => ({ ...f, description: e.target.value }))}
                  rows={3}
                  className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-100"
                />
              </div>
              {editingCategory && (
                <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={categoryForm.is_active}
                    onChange={(e) => setCategoryForm((f) => ({ ...f, is_active: e.target.checked }))}
                    className="rounded border-slate-300 text-cyan-600 focus:ring-cyan-500"
                  />
                  Category is active (available for clock-in)
                </label>
              )}
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={closeCategoryModal} className="rounded-xl border border-slate-300 px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50">
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingCategory}
                  className="rounded-xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
                >
                  {savingCategory ? 'Saving…' : editingCategory ? 'Save changes' : 'Create category'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
