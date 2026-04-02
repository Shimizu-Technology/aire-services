import { useState, useEffect, useCallback } from 'react'
import { FadeUp } from '../../components/ui/MotionComponents'
import { api, type AdminTimeCategory, type UserSummary, type EffectiveRate } from '../../lib/api'

// ─── Settings Tab ───────────────────────────────────────────────────────────

function SettingsTab() {
  const [settings, setSettings] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const loadSettings = useCallback(async () => {
    setLoading(true)
    const res = await api.getSettings()
    if (res.data) setSettings(res.data.settings)
    else setError(res.error || 'Failed to load settings')
    setLoading(false)
  }, [])

  useEffect(() => {
    const run = async () => {
      await loadSettings()
    }

    void run()
  }, [loadSettings])

  const handleSave = async () => {
    setSaving(true)
    setMessage(null)
    setError(null)
    const res = await api.updateSettings(settings)
    if (res.data) {
      setSettings(res.data.settings)
      setMessage('Settings saved')
    } else {
      setError(res.error || 'Failed to save settings')
    }
    setSaving(false)
  }

  if (loading) return <div className="animate-pulse h-40 bg-gray-100 rounded-xl" />

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-neutral-warm p-6 space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-primary-dark">Time Tracking Settings</h3>
        <p className="text-sm text-text-muted mt-1">Configure global time tracking policies.</p>
      </div>

      {error && <div className="bg-red-50 text-red-700 px-4 py-2 rounded-lg text-sm">{error}</div>}
      {message && <div className="bg-green-50 text-green-700 px-4 py-2 rounded-lg text-sm">{message}</div>}

      <div className="space-y-5">
        {/* Schedule Required Toggle */}
        <div className="flex items-start gap-4">
          <div className="flex-1">
            <label className="block font-medium text-sm text-primary-dark">Require Schedule for Clock-In</label>
            <p className="text-xs text-text-muted mt-1">
              When enabled, employees must have a schedule assigned before they can clock in.
              When disabled, employees can clock in at any time without a schedule.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={settings.schedule_required_for_clock_in === 'true'}
            onClick={() => setSettings(s => ({ ...s, schedule_required_for_clock_in: s.schedule_required_for_clock_in === 'true' ? 'false' : 'true' }))}
            className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out cursor-pointer ${settings.schedule_required_for_clock_in === 'true' ? 'bg-primary' : 'bg-gray-200'}`}
          >
            <span className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transform ring-0 transition duration-200 ease-in-out ${settings.schedule_required_for_clock_in === 'true' ? 'translate-x-5' : 'translate-x-0'}`} />
          </button>
        </div>

        {/* Overtime Thresholds */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block font-medium text-sm text-primary-dark">Daily Overtime Threshold (hours)</label>
            <input
              type="number"
              min="1"
              max="24"
              step="0.5"
              value={settings.overtime_daily_threshold_hours || '8'}
              onChange={e => setSettings(s => ({ ...s, overtime_daily_threshold_hours: e.target.value }))}
              className="mt-1 w-full px-3 py-2 border border-neutral-warm rounded-lg focus:outline-none focus:ring-2 focus:ring-primary text-sm"
            />
          </div>
          <div>
            <label className="block font-medium text-sm text-primary-dark">Weekly Overtime Threshold (hours)</label>
            <input
              type="number"
              min="1"
              max="168"
              step="0.5"
              value={settings.overtime_weekly_threshold_hours || '40'}
              onChange={e => setSettings(s => ({ ...s, overtime_weekly_threshold_hours: e.target.value }))}
              className="mt-1 w-full px-3 py-2 border border-neutral-warm rounded-lg focus:outline-none focus:ring-2 focus:ring-primary text-sm"
            />
          </div>
        </div>

        {/* Early Clock-In Buffer */}
        <div className="max-w-xs">
          <label className="block font-medium text-sm text-primary-dark">Early Clock-In Buffer (minutes)</label>
          <p className="text-xs text-text-muted mt-1">How early before a shift start employees can clock in.</p>
          <input
            type="number"
            min="0"
            max="60"
            value={settings.early_clock_in_buffer_minutes || '5'}
            onChange={e => setSettings(s => ({ ...s, early_clock_in_buffer_minutes: e.target.value }))}
            className="mt-1 w-full px-3 py-2 border border-neutral-warm rounded-lg focus:outline-none focus:ring-2 focus:ring-primary text-sm"
          />
        </div>
      </div>

      <div className="pt-4 border-t border-neutral-warm">
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-6 py-2 bg-primary text-white rounded-lg hover:bg-primary-dark transition-colors text-sm font-medium disabled:opacity-60"
        >
          {saving ? 'Saving...' : 'Save Settings'}
        </button>
      </div>
    </div>
  )
}

// ─── Time Categories Tab ────────────────────────────────────────────────────

function TimeCategoriesTab() {
  const [categories, setCategories] = useState<AdminTimeCategory[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState({ name: '', key: '', description: '', hourly_rate: '' })
  const [saving, setSaving] = useState(false)

  const loadCategories = useCallback(async () => {
    setLoading(true)
    const res = await api.getAdminTimeCategories()
    if (res.data) setCategories(res.data.time_categories)
    else setError(res.error || 'Failed to load categories')
    setLoading(false)
  }, [])

  useEffect(() => {
    const run = async () => {
      await loadCategories()
    }

    void run()
  }, [loadCategories])

  const openNew = () => {
    setEditingId(null)
    setForm({ name: '', key: '', description: '', hourly_rate: '' })
    setShowForm(true)
  }

  const openEdit = (cat: AdminTimeCategory) => {
    setEditingId(cat.id)
    setForm({
      name: cat.name,
      key: cat.key || '',
      description: cat.description || '',
      hourly_rate: cat.hourly_rate != null ? cat.hourly_rate.toString() : '',
    })
    setShowForm(true)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError(null)

    const rateCents = form.hourly_rate ? Math.round(parseFloat(form.hourly_rate) * 100) : null

    if (editingId) {
      const res = await api.updateTimeCategory(editingId, {
        name: form.name,
        key: form.key || undefined,
        description: form.description || undefined,
        hourly_rate_cents: rateCents,
      })
      if (res.error) { setError(res.error); setSaving(false); return }
    } else {
      const res = await api.createTimeCategory({
        name: form.name,
        key: form.key || undefined,
        description: form.description || undefined,
        hourly_rate_cents: rateCents,
      })
      if (res.error) { setError(res.error); setSaving(false); return }
    }

    setShowForm(false)
    setSaving(false)
    loadCategories()
  }

  const toggleActive = async (cat: AdminTimeCategory) => {
    await api.updateTimeCategory(cat.id, { is_active: !cat.is_active })
    loadCategories()
  }

  if (loading) return <div className="animate-pulse h-40 bg-gray-100 rounded-xl" />

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-primary-dark">Work Categories</h3>
          <p className="text-sm text-text-muted">Manage work types and their default hourly rates.</p>
        </div>
        <button
          onClick={openNew}
          className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary-dark transition-colors text-sm font-medium"
        >
          Add Category
        </button>
      </div>

      {error && <div className="bg-red-50 text-red-700 px-4 py-2 rounded-lg text-sm">{error}</div>}

      {/* Form Modal */}
      {showForm && (
        <div className="bg-white rounded-2xl shadow-sm border border-neutral-warm p-6">
          <h4 className="font-medium text-primary-dark mb-4">{editingId ? 'Edit Category' : 'New Category'}</h4>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-primary-dark mb-1">Name *</label>
                <input
                  required
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  className="w-full px-3 py-2 border border-neutral-warm rounded-lg focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                  placeholder="e.g. Flight Instruction"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-primary-dark mb-1">Key</label>
                <input
                  value={form.key}
                  onChange={e => setForm(f => ({ ...f, key: e.target.value }))}
                  className="w-full px-3 py-2 border border-neutral-warm rounded-lg focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                  placeholder="e.g. aire_flight_instruction"
                />
                <p className="text-xs text-text-muted mt-1">Used to identify AIRE categories. Prefix with aire_ for kiosk display.</p>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-primary-dark mb-1">Description</label>
              <input
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                className="w-full px-3 py-2 border border-neutral-warm rounded-lg focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                placeholder="Optional description"
              />
            </div>
            <div className="max-w-xs">
              <label className="block text-sm font-medium text-primary-dark mb-1">Default Hourly Rate ($)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.hourly_rate}
                onChange={e => setForm(f => ({ ...f, hourly_rate: e.target.value }))}
                className="w-full px-3 py-2 border border-neutral-warm rounded-lg focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                placeholder="0.00"
              />
              <p className="text-xs text-text-muted mt-1">Default rate. Can be overridden per employee in Pay Rates.</p>
            </div>
            <div className="flex gap-3">
              <button type="submit" disabled={saving} className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary-dark transition-colors text-sm font-medium disabled:opacity-60">
                {saving ? 'Saving...' : (editingId ? 'Update' : 'Create')}
              </button>
              <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 border border-neutral-warm rounded-lg text-sm font-medium text-text-muted hover:bg-gray-50">
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Categories Table */}
      <div className="bg-white rounded-2xl shadow-sm border border-neutral-warm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-warm bg-gray-50/50">
                <th className="text-left px-4 py-3 font-medium text-text-muted">Name</th>
                <th className="text-left px-4 py-3 font-medium text-text-muted">Key</th>
                <th className="text-right px-4 py-3 font-medium text-text-muted">Default Rate</th>
                <th className="text-center px-4 py-3 font-medium text-text-muted">Entries</th>
                <th className="text-center px-4 py-3 font-medium text-text-muted">Status</th>
                <th className="text-right px-4 py-3 font-medium text-text-muted">Actions</th>
              </tr>
            </thead>
            <tbody>
              {categories.map(cat => (
                <tr key={cat.id} className={`border-b border-neutral-warm/50 ${!cat.is_active ? 'opacity-50' : ''}`}>
                  <td className="px-4 py-3">
                    <div className="font-medium text-primary-dark">{cat.name}</div>
                    {cat.description && <div className="text-xs text-text-muted">{cat.description}</div>}
                  </td>
                  <td className="px-4 py-3 text-text-muted font-mono text-xs">{cat.key || '—'}</td>
                  <td className="px-4 py-3 text-right">
                    {cat.hourly_rate != null ? `$${cat.hourly_rate.toFixed(2)}/hr` : '—'}
                  </td>
                  <td className="px-4 py-3 text-center text-text-muted">{cat.time_entries_count}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${cat.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                      {cat.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button onClick={() => openEdit(cat)} className="text-primary hover:text-primary-dark text-xs font-medium">Edit</button>
                      <button onClick={() => toggleActive(cat)} className="text-xs font-medium text-text-muted hover:text-primary-dark">
                        {cat.is_active ? 'Deactivate' : 'Activate'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {categories.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-text-muted">No categories found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ─── Employee Pay Rates Tab ─────────────────────────────────────────────────

function PayRatesTab() {
  const [users, setUsers] = useState<UserSummary[]>([])
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null)
  const [selectedUserName, setSelectedUserName] = useState('')
  const [effectiveRates, setEffectiveRates] = useState<EffectiveRate[]>([])
  const [loading, setLoading] = useState(true)
  const [ratesLoading, setRatesLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editingCatId, setEditingCatId] = useState<number | null>(null)
  const [editRate, setEditRate] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    (async () => {
      const res = await api.getUsers()
      if (res.data) setUsers(res.data.users)
      setLoading(false)
    })()
  }, [])

  const loadRatesForUser = useCallback(async (userId: number) => {
    setRatesLoading(true)
    setError(null)
    const res = await api.getEffectiveRatesForUser(userId)
    if (res.data) {
      setSelectedUserName(res.data.user.full_name || res.data.user.display_name)
      setEffectiveRates(res.data.effective_rates)
    } else {
      setError(res.error || 'Failed to load rates')
    }
    setRatesLoading(false)
  }, [])

  const selectUser = (userId: number) => {
    setSelectedUserId(userId)
    setEditingCatId(null)
    loadRatesForUser(userId)
  }

  const startEdit = (rate: EffectiveRate) => {
    setEditingCatId(rate.time_category_id)
    setEditRate(rate.override_rate != null ? rate.override_rate.toString() : (rate.default_rate != null ? rate.default_rate.toString() : ''))
  }

  const saveRate = async (rate: EffectiveRate) => {
    if (!selectedUserId) return
    setSaving(true)
    setError(null)

    const newCents = editRate ? Math.round(parseFloat(editRate) * 100) : null

    // If clearing rate and override exists, delete it
    if (newCents === null && rate.override_id) {
      await api.deleteEmployeePayRate(rate.override_id)
    }
    // If setting rate same as default and override exists, delete the override
    else if (newCents === rate.default_rate_cents && rate.override_id) {
      await api.deleteEmployeePayRate(rate.override_id)
    }
    // If setting rate different from default
    else if (newCents !== null && newCents !== rate.default_rate_cents) {
      if (rate.override_id) {
        await api.updateEmployeePayRate(rate.override_id, { hourly_rate_cents: newCents })
      } else {
        const res = await api.createEmployeePayRate({
          user_id: selectedUserId,
          time_category_id: rate.time_category_id,
          hourly_rate_cents: newCents,
        })
        if (res.error) { setError(res.error); setSaving(false); return }
      }
    }

    setEditingCatId(null)
    setSaving(false)
    loadRatesForUser(selectedUserId)
  }

  if (loading) return <div className="animate-pulse h-40 bg-gray-100 rounded-xl" />

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold text-primary-dark">Employee Pay Rates</h3>
        <p className="text-sm text-text-muted">Override the default category rate per employee. For example, different CFIs may have different flight instruction rates.</p>
      </div>

      {error && <div className="bg-red-50 text-red-700 px-4 py-2 rounded-lg text-sm">{error}</div>}

      <div className="max-w-sm">
        <label className="block text-sm font-medium text-primary-dark mb-1">Select Employee</label>
        <select
          value={selectedUserId || ''}
          onChange={e => e.target.value ? selectUser(parseInt(e.target.value)) : setSelectedUserId(null)}
          className="w-full px-3 py-2 border border-neutral-warm rounded-lg focus:outline-none focus:ring-2 focus:ring-primary text-sm"
        >
          <option value="">Choose an employee...</option>
          {users.map(u => (
            <option key={u.id} value={u.id}>{u.full_name || u.display_name || u.email}</option>
          ))}
        </select>
      </div>

      {selectedUserId && (
        <div className="bg-white rounded-2xl shadow-sm border border-neutral-warm overflow-hidden">
          <div className="px-4 py-3 bg-gray-50/50 border-b border-neutral-warm">
            <h4 className="font-medium text-primary-dark">Pay Rates for {selectedUserName}</h4>
            <p className="text-xs text-text-muted mt-0.5">Override rates are used instead of the category default for payroll calculations.</p>
          </div>
          {ratesLoading ? (
            <div className="px-4 py-8 text-center text-text-muted">Loading...</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-neutral-warm">
                    <th className="text-left px-4 py-2 font-medium text-text-muted">Category</th>
                    <th className="text-right px-4 py-2 font-medium text-text-muted">Default Rate</th>
                    <th className="text-right px-4 py-2 font-medium text-text-muted">Override Rate</th>
                    <th className="text-right px-4 py-2 font-medium text-text-muted">Effective Rate</th>
                    <th className="text-right px-4 py-2 font-medium text-text-muted">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {effectiveRates.map(rate => (
                    <tr key={rate.time_category_id} className="border-b border-neutral-warm/50">
                      <td className="px-4 py-2">
                        <div className="font-medium text-primary-dark">{rate.time_category_name}</div>
                        {rate.time_category_key && <div className="text-xs text-text-muted font-mono">{rate.time_category_key}</div>}
                      </td>
                      <td className="px-4 py-2 text-right text-text-muted">
                        {rate.default_rate != null ? `$${rate.default_rate.toFixed(2)}/hr` : '—'}
                      </td>
                      <td className="px-4 py-2 text-right">
                        {editingCatId === rate.time_category_id ? (
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={editRate}
                            onChange={e => setEditRate(e.target.value)}
                            className="w-24 px-2 py-1 border border-neutral-warm rounded text-sm text-right"
                            autoFocus
                          />
                        ) : (
                          rate.override_rate != null
                            ? <span className="font-medium text-amber-600">${rate.override_rate.toFixed(2)}/hr</span>
                            : <span className="text-text-muted">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right font-medium text-primary-dark">
                        {rate.effective_rate != null ? `$${rate.effective_rate.toFixed(2)}/hr` : '—'}
                      </td>
                      <td className="px-4 py-2 text-right">
                        {editingCatId === rate.time_category_id ? (
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={() => saveRate(rate)}
                              disabled={saving}
                              className="text-xs font-medium text-primary hover:text-primary-dark"
                            >
                              Save
                            </button>
                            <button
                              onClick={() => setEditingCatId(null)}
                              className="text-xs font-medium text-text-muted"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center justify-end gap-2">
                            <button onClick={() => startEdit(rate)} className="text-xs font-medium text-primary hover:text-primary-dark">
                              {rate.override_id ? 'Edit' : 'Set Override'}
                            </button>
                            {rate.override_id && (
                              <button
                                onClick={async () => {
                                  await api.deleteEmployeePayRate(rate.override_id!)
                                  loadRatesForUser(selectedUserId)
                                }}
                                className="text-xs font-medium text-red-500 hover:text-red-700"
                              >
                                Remove
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                  {effectiveRates.length === 0 && (
                    <tr><td colSpan={5} className="px-4 py-8 text-center text-text-muted">No active categories found</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Main Settings Page ─────────────────────────────────────────────────────

export default function Settings() {
  useEffect(() => { document.title = 'Settings | AIRE Ops' }, [])

  const [activeTab, setActiveTab] = useState<'settings' | 'categories' | 'pay_rates'>('settings')

  const tabs = [
    { key: 'settings' as const, label: 'General' },
    { key: 'categories' as const, label: 'Work Categories' },
    { key: 'pay_rates' as const, label: 'Pay Rates' },
  ]

  return (
    <div className="space-y-6">
      <FadeUp>
        <div>
          <h1 className="text-2xl font-bold text-primary-dark tracking-tight">Settings</h1>
          <p className="text-text-muted mt-1">Configure time tracking policies, work categories, and employee pay rates.</p>
        </div>
      </FadeUp>

      {/* Tab Navigation */}
      <div className="border-b border-neutral-warm">
        <nav className="flex gap-4">
          {tabs.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`pb-3 px-1 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.key
                  ? 'border-primary text-primary'
                  : 'border-transparent text-text-muted hover:text-primary-dark'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {activeTab === 'settings' && <SettingsTab />}
      {activeTab === 'categories' && <TimeCategoriesTab />}
      {activeTab === 'pay_rates' && <PayRatesTab />}
    </div>
  )
}
