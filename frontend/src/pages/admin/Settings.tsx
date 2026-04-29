import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../../lib/api'
import type { AdminTimeCategory, ApprovalGroupOption, ContactSettings, PlaceAutocompleteSuggestion, TimeClockAppSettings } from '../../lib/api'
import { FadeUp } from '../../components/ui/MotionComponents'

const emptyCategoryForm = {
  name: '',
  key: '',
  description: '',
  is_active: true,
}

const normalizeApprovalGroupKey = (value: string) => (
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_')
)

const GOOGLE_MAPS_BROWSER_KEY = import.meta.env.VITE_GOOGLE_MAPS_BROWSER_KEY
const IS_TEST = import.meta.env.MODE === 'test'

const createPlaceSessionToken = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function GoogleMapPreview({ latitude, longitude }: { latitude: number; longitude: number }) {
  const mapRef = useRef<HTMLDivElement>(null)
  const [mapError, setMapError] = useState('')

  useEffect(() => {
    if (!GOOGLE_MAPS_BROWSER_KEY || IS_TEST || !mapRef.current) return

    let cancelled = false
    const scriptId = 'google-maps-js'

    const renderMap = () => {
      if (cancelled || !mapRef.current || !window.google?.maps) return

      const center = { lat: latitude, lng: longitude }
      const map = new window.google.maps.Map(mapRef.current, {
        center,
        zoom: 17,
        mapTypeControl: false,
        fullscreenControl: false,
        streetViewControl: false,
      })
      new window.google.maps.Marker({ position: center, map })
    }

    const existingScript = document.getElementById(scriptId) as HTMLScriptElement | null
    if (window.google?.maps) {
      renderMap()
    } else if (existingScript) {
      existingScript.addEventListener('load', renderMap, { once: true })
    } else {
      const script = document.createElement('script')
      script.id = scriptId
      script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(GOOGLE_MAPS_BROWSER_KEY)}`
      script.async = true
      script.defer = true
      script.addEventListener('load', renderMap, { once: true })
      script.addEventListener('error', () => {
        if (!cancelled) setMapError('Google map preview could not be loaded.')
      })
      document.head.appendChild(script)
    }

    return () => {
      cancelled = true
      existingScript?.removeEventListener('load', renderMap)
    }
  }, [latitude, longitude])

  if (!GOOGLE_MAPS_BROWSER_KEY || IS_TEST) {
    return null
  }

  return (
    <>
      {mapError && <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">{mapError}</div>}
      <div ref={mapRef} className="h-72 w-full" />
    </>
  )
}

export default function Settings() {
  useEffect(() => {
    document.title = 'Settings | AIRE Ops'
  }, [])

  const [categories, setCategories] = useState<AdminTimeCategory[]>([])
  const [clockSettings, setClockSettings] = useState<TimeClockAppSettings | null>(null)
  const [contactSettings, setContactSettings] = useState<ContactSettings | null>(null)
  const [approvalGroups, setApprovalGroups] = useState<ApprovalGroupOption[]>([])
  const [thresholdDraft, setThresholdDraft] = useState({
    overtime_daily_threshold_hours: '',
    overtime_weekly_threshold_hours: '',
    early_clock_in_buffer_minutes: '',
    clock_in_location_enforced: 'false',
    clock_in_location_name: '',
    clock_in_location_latitude: '',
    clock_in_location_longitude: '',
    clock_in_location_radius_meters: '',
  })
  const [approvalGroupDrafts, setApprovalGroupDrafts] = useState<ApprovalGroupOption[]>([{ key: '', label: '' }])
  const [contactNotificationEmailsDraft, setContactNotificationEmailsDraft] = useState('')
  const [inquiryTopicsDraft, setInquiryTopicsDraft] = useState<string[]>([''])
  const [loading, setLoading] = useState(true)
  const [categoriesError, setCategoriesError] = useState('')
  const [settingsError, setSettingsError] = useState('')
  const [approvalGroupsError, setApprovalGroupsError] = useState('')
  const [approvalGroupsMessage, setApprovalGroupsMessage] = useState('')
  const [contactSettingsError, setContactSettingsError] = useState('')
  const [contactSettingsMessage, setContactSettingsMessage] = useState('')
  const [savingCategory, setSavingCategory] = useState(false)
  const [savingThresholds, setSavingThresholds] = useState(false)
  const [savingApprovalGroups, setSavingApprovalGroups] = useState(false)
  const [savingContactSettings, setSavingContactSettings] = useState(false)
  const [locationSearchQuery, setLocationSearchQuery] = useState('')
  const [placeSuggestions, setPlaceSuggestions] = useState<PlaceAutocompleteSuggestion[]>([])
  const [placeLoading, setPlaceLoading] = useState(false)
  const [selectedPlaceLoading, setSelectedPlaceLoading] = useState(false)
  const [geocodeError, setGeocodeError] = useState('')
  const [currentLocationLoading, setCurrentLocationLoading] = useState(false)
  const [showInactive, setShowInactive] = useState(true)
  const [categoryModalOpen, setCategoryModalOpen] = useState(false)
  const [editingCategory, setEditingCategory] = useState<AdminTimeCategory | null>(null)
  const [categoryForm, setCategoryForm] = useState(emptyCategoryForm)
  const modalRef = useRef<HTMLDivElement>(null)
  const placeSessionTokenRef = useRef(createPlaceSessionToken())

  const applyFetchedData = useCallback((
    catRes: Awaited<ReturnType<typeof api.getAdminTimeCategories>>,
    setRes: Awaited<ReturnType<typeof api.getAdminAppSettings>>,
    contactRes: Awaited<ReturnType<typeof api.getAdminContactSettings>>,
  ) => {
    if (catRes.error) setCategoriesError(catRes.error)
    else if (catRes.data) setCategories(catRes.data.time_categories)

    if (setRes.error) setSettingsError(setRes.error)
    else if (setRes.data) {
      const s = setRes.data.settings
      setClockSettings(s)
      setApprovalGroups(setRes.data.approval_groups)
      setApprovalGroupDrafts(
        setRes.data.approval_groups.length > 0
          ? setRes.data.approval_groups
          : [{ key: '', label: '' }]
      )
      setThresholdDraft({
        overtime_daily_threshold_hours: s.overtime_daily_threshold_hours,
        overtime_weekly_threshold_hours: s.overtime_weekly_threshold_hours,
        early_clock_in_buffer_minutes: s.early_clock_in_buffer_minutes,
        clock_in_location_enforced: s.clock_in_location_enforced,
        clock_in_location_name: s.clock_in_location_name,
        clock_in_location_latitude: s.clock_in_location_latitude,
        clock_in_location_longitude: s.clock_in_location_longitude,
        clock_in_location_radius_meters: s.clock_in_location_radius_meters,
      })
    }

    if (contactRes.error) setContactSettingsError(contactRes.error)
    else if (contactRes.data) {
      setContactSettings(contactRes.data)
      setContactNotificationEmailsDraft(contactRes.data.contact_notification_emails.join('\n'))
      setInquiryTopicsDraft(contactRes.data.inquiry_topics.length > 0 ? contactRes.data.inquiry_topics : [''])
    }
  }, [])

  const applyClockLocation = useCallback((location: { latitude: string; longitude: string; label?: string }) => {
    setThresholdDraft((draft) => ({
      ...draft,
      clock_in_location_latitude: location.latitude,
      clock_in_location_longitude: location.longitude,
      clock_in_location_name: location.label?.trim() || draft.clock_in_location_name,
    }))
  }, [])

  useEffect(() => {
    let cancelled = false
    async function initialLoad() {
      setLoading(true)
      setCategoriesError('')
      setSettingsError('')
      setContactSettingsError('')
      try {
        const [catRes, setRes, contactRes] = await Promise.all([
          api.getAdminTimeCategories(),
          api.getAdminAppSettings(),
          api.getAdminContactSettings(),
        ])
        if (!cancelled) applyFetchedData(catRes, setRes, contactRes)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    initialLoad()
    return () => { cancelled = true }
  }, [applyFetchedData])

  const refreshCategories = useCallback(async () => {
    const res = await api.getAdminTimeCategories()
    if (res.error) {
      setCategoriesError(res.error)
    } else if (res.data) {
      setCategoriesError('')
      setCategories(res.data.time_categories)
    }
  }, [])

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
      refreshCategories()
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
    else refreshCategories()
  }

  const handleReactivateCategory = async (cat: AdminTimeCategory) => {
    const res = await api.updateTimeCategory(cat.id, { is_active: true })
    if (res.error) alert(res.error)
    else refreshCategories()
  }

  const handleDeleteCategory = async (cat: AdminTimeCategory) => {
    const hasUsage = cat.time_entries_count > 0 || (cat.employee_pay_rates_count ?? 0) > 0
    if (hasUsage) {
      alert('This category already has saved time history or pay-rate data, so it cannot be permanently deleted. Deactivate it instead.')
      return
    }

    if (!confirm(`Permanently delete "${cat.name}"? This cannot be undone.`)) return

    const res = await api.deleteTimeCategory(cat.id)
    if (res.error) alert(res.error)
    else refreshCategories()
  }

  const handleSaveThresholds = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!clockSettings) return

    setSavingThresholds(true)
    setSettingsError('')
    try {
      const res = await api.updateAdminAppSettings({
        settings: {
          overtime_daily_threshold_hours: thresholdDraft.overtime_daily_threshold_hours,
          overtime_weekly_threshold_hours: thresholdDraft.overtime_weekly_threshold_hours,
          early_clock_in_buffer_minutes: thresholdDraft.early_clock_in_buffer_minutes,
          clock_in_location_enforced: thresholdDraft.clock_in_location_enforced,
          clock_in_location_name: thresholdDraft.clock_in_location_name,
          clock_in_location_latitude: thresholdDraft.clock_in_location_latitude,
          clock_in_location_longitude: thresholdDraft.clock_in_location_longitude,
          clock_in_location_radius_meters: thresholdDraft.clock_in_location_radius_meters,
        },
      })
      if (res.error) {
        setSettingsError(res.error)
        return
      }
      if (res.data) {
        setClockSettings(res.data.settings)
        setApprovalGroups(res.data.approval_groups)
        setThresholdDraft({
          overtime_daily_threshold_hours: res.data.settings.overtime_daily_threshold_hours,
          overtime_weekly_threshold_hours: res.data.settings.overtime_weekly_threshold_hours,
          early_clock_in_buffer_minutes: res.data.settings.early_clock_in_buffer_minutes,
          clock_in_location_enforced: res.data.settings.clock_in_location_enforced,
          clock_in_location_name: res.data.settings.clock_in_location_name,
          clock_in_location_latitude: res.data.settings.clock_in_location_latitude,
          clock_in_location_longitude: res.data.settings.clock_in_location_longitude,
          clock_in_location_radius_meters: res.data.settings.clock_in_location_radius_meters,
        })
      }
    } finally {
      setSavingThresholds(false)
    }
  }

  useEffect(() => {
    const query = locationSearchQuery.trim()
    if (!query) {
      setPlaceSuggestions([])
      setGeocodeError('')
      setPlaceLoading(false)
      return undefined
    }

    if (query.length < 3) {
      setPlaceSuggestions([])
      setGeocodeError('')
      setPlaceLoading(false)
      return undefined
    }

    let cancelled = false
    setPlaceLoading(true)
    setGeocodeError('')

    const timeoutId = window.setTimeout(() => {
      void (async () => {
        try {
          const result = await api.autocompleteAdminClockLocation(query, placeSessionTokenRef.current)
          if (cancelled) return

          if (result.error || !result.data) {
            setGeocodeError(result.error || 'Address lookup failed.')
            setPlaceSuggestions([])
            return
          }

          setPlaceSuggestions(result.data.suggestions)
          if (result.data.suggestions.length === 0) {
            setGeocodeError('No matching locations were found. Try the business name, full street address, or use current location.')
          }
        } catch {
          if (!cancelled) {
            setGeocodeError('Address lookup failed.')
            setPlaceSuggestions([])
          }
        } finally {
          if (!cancelled) {
            setPlaceLoading(false)
          }
        }
      })()
    }, 300)

    return () => {
      cancelled = true
      window.clearTimeout(timeoutId)
    }
  }, [locationSearchQuery])

  const handleSelectPlaceSuggestion = async (suggestion: PlaceAutocompleteSuggestion) => {
    setSelectedPlaceLoading(true)
    setGeocodeError('')
    try {
      const result = await api.getAdminClockPlaceDetails(suggestion.place_id, placeSessionTokenRef.current)
      if (result.error || !result.data) {
        setGeocodeError(result.error || 'Could not load the selected location.')
        return
      }

      const place = result.data.place
      applyClockLocation({
        latitude: place.latitude,
        longitude: place.longitude,
        label: thresholdDraft.clock_in_location_name.trim() ? thresholdDraft.clock_in_location_name : place.display_name || suggestion.main_text || suggestion.description,
      })
      setLocationSearchQuery(place.formatted_address || suggestion.description)
      setPlaceSuggestions([])
      placeSessionTokenRef.current = createPlaceSessionToken()
    } finally {
      setSelectedPlaceLoading(false)
    }
  }

  const handleUseCurrentLocation = async () => {
    if (!navigator.geolocation) {
      setGeocodeError('This browser does not support location lookup.')
      return
    }

    setCurrentLocationLoading(true)
    setGeocodeError('')

    navigator.geolocation.getCurrentPosition(
      (position) => {
        applyClockLocation({
          latitude: position.coords.latitude.toFixed(6),
          longitude: position.coords.longitude.toFixed(6),
        })
        setPlaceSuggestions([])
        placeSessionTokenRef.current = createPlaceSessionToken()
        setCurrentLocationLoading(false)
      },
      (error) => {
        setGeocodeError(
          error.code === error.PERMISSION_DENIED
            ? 'Location permission was denied.'
            : 'Could not get the current device location.'
        )
        setCurrentLocationLoading(false)
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 30000,
      }
    )
  }

  const updateApprovalGroupDraft = (index: number, field: keyof ApprovalGroupOption, value: string) => {
    setApprovalGroupDrafts((current) => current.map((group, groupIndex) => (
      groupIndex === index ? { ...group, [field]: value } : group
    )))
  }

  const addApprovalGroupDraft = () => {
    setApprovalGroupDrafts((current) => [...current, { key: '', label: '' }])
  }

  const removeApprovalGroupDraft = (index: number) => {
    setApprovalGroupDrafts((current) => {
      if (current.length === 1) return [{ key: '', label: '' }]
      return current.filter((_, groupIndex) => groupIndex !== index)
    })
  }

  const handleSaveApprovalGroups = async (e: React.FormEvent) => {
    e.preventDefault()

    const normalizedGroups = approvalGroupDrafts
      .map((group) => ({ key: group.key.trim(), label: group.label.trim() }))
      .filter((group) => group.key || group.label)

    if (normalizedGroups.length === 0) {
      setApprovalGroupsError('At least one department is required.')
      setApprovalGroupsMessage('')
      return
    }

    if (normalizedGroups.some((group) => !group.label)) {
      setApprovalGroupsError('Each department needs a label.')
      setApprovalGroupsMessage('')
      return
    }

    const normalizedKeys = normalizedGroups.map((group) => normalizeApprovalGroupKey(group.key || group.label))
    if (normalizedKeys.some((key) => !key)) {
      setApprovalGroupsError('Department keys may only contain letters, numbers, and underscores.')
      setApprovalGroupsMessage('')
      return
    }

    if (new Set(normalizedKeys).size !== normalizedKeys.length) {
      setApprovalGroupsError('Department keys must be unique.')
      setApprovalGroupsMessage('')
      return
    }

    setSavingApprovalGroups(true)
    setApprovalGroupsError('')
    setApprovalGroupsMessage('')
    try {
      const res = await api.updateAdminAppSettings({
        approval_groups: normalizedGroups,
      })
      if (res.error || !res.data) {
        setApprovalGroupsError(res.error || 'Failed to save departments')
        return
      }

      setApprovalGroups(res.data.approval_groups)
      setApprovalGroupDrafts(
        res.data.approval_groups.length > 0
          ? res.data.approval_groups
          : [{ key: '', label: '' }]
      )
      setApprovalGroupsMessage('Departments saved.')
    } finally {
      setSavingApprovalGroups(false)
    }
  }

  const handleSaveContactSettings = async (e: React.FormEvent) => {
    e.preventDefault()

    const contact_notification_emails = contactNotificationEmailsDraft
      .split(/\n+/)
      .map((email) => email.trim())
      .filter(Boolean)
    const inquiry_topics = inquiryTopicsDraft
      .map((topic) => topic.trim())
      .filter(Boolean)

    if (contact_notification_emails.length === 0) {
      setContactSettingsError('At least one notification email is required.')
      setContactSettingsMessage('')
      return
    }

    if (inquiry_topics.length === 0) {
      setContactSettingsError('At least one inquiry topic is required.')
      setContactSettingsMessage('')
      return
    }

    setSavingContactSettings(true)
    setContactSettingsError('')
    setContactSettingsMessage('')
    try {
      const res = await api.updateAdminContactSettings({
        contact_notification_emails,
        inquiry_topics,
      })
      if (res.error || !res.data) {
        setContactSettingsError(res.error || 'Failed to save contact settings')
        return
      }

      setContactSettings({
        contact_notification_emails: res.data.contact_notification_emails,
        inquiry_topics: res.data.inquiry_topics,
      })
      setContactNotificationEmailsDraft(res.data.contact_notification_emails.join('\n'))
      setInquiryTopicsDraft(res.data.inquiry_topics.length > 0 ? res.data.inquiry_topics : [''])
      setContactSettingsMessage(res.data.message || 'Contact settings saved.')
    } finally {
      setSavingContactSettings(false)
    }
  }

  const updateInquiryTopicDraft = (index: number, value: string) => {
    setInquiryTopicsDraft((current) => current.map((topic, topicIndex) => (topicIndex === index ? value : topic)))
  }

  const addInquiryTopicDraft = () => {
    setInquiryTopicsDraft((current) => [...current, ''])
  }

  const removeInquiryTopicDraft = (index: number) => {
    setInquiryTopicsDraft((current) => {
      if (current.length === 1) return ['']
      return current.filter((_, topicIndex) => topicIndex !== index)
    })
  }

  const visibleCategories = showInactive ? categories : categories.filter((c) => c.is_active)
  const previewLatitude = Number.parseFloat(thresholdDraft.clock_in_location_latitude)
  const previewLongitude = Number.parseFloat(thresholdDraft.clock_in_location_longitude)
  const hasPreviewCoordinates = Number.isFinite(previewLatitude) && Number.isFinite(previewLongitude)
  const mapIframeSrc = hasPreviewCoordinates
    ? `https://www.openstreetmap.org/export/embed.html?bbox=${previewLongitude - 0.01}%2C${previewLatitude - 0.01}%2C${previewLongitude + 0.01}%2C${previewLatitude + 0.01}&layer=mapnik&marker=${previewLatitude}%2C${previewLongitude}`
    : null

  return (
    <div className="space-y-8">
      <FadeUp>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Settings</h1>
          <p className="mt-1 text-sm text-slate-600">
            Manage departments, work categories, overtime rules, and public contact settings.
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
                <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                  <div className="flex flex-col gap-4">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <h3 className="text-sm font-semibold text-slate-900">Clock-in location restriction</h3>
                        <p className="mt-1 text-sm text-slate-500">
                          Require self-service clock-ins to happen at the AIRE office. Kiosk and admin override actions still work.
                        </p>
                      </div>
                      <label className="inline-flex items-center gap-2 text-sm font-medium text-slate-700">
                        <input
                          type="checkbox"
                          checked={thresholdDraft.clock_in_location_enforced === 'true'}
                          onChange={(e) => setThresholdDraft((d) => ({ ...d, clock_in_location_enforced: e.target.checked ? 'true' : 'false' }))}
                          className="h-4 w-4 rounded border-slate-300 text-cyan-600 focus:ring-cyan-500"
                        />
                        Enforce
                      </label>
                    </div>
                    <div className="grid gap-4 lg:grid-cols-[1.3fr_0.9fr]">
                      <div className="space-y-4">
                        <div>
                          <label className="mb-2 block text-sm font-medium text-slate-700">Location label</label>
                          <input
                            value={thresholdDraft.clock_in_location_name}
                            onChange={(e) => setThresholdDraft((d) => ({ ...d, clock_in_location_name: e.target.value }))}
                            placeholder="AIRE Services Guam"
                            className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-100"
                          />
                        </div>

                        <div className="space-y-3">
                          <div>
                            <label className="mb-2 block text-sm font-medium text-slate-700">Find location by address</label>
                            <div className="flex flex-col gap-3 sm:flex-row">
                              <div className="relative flex-1">
                                <input
                                  value={locationSearchQuery}
                                  onChange={(e) => setLocationSearchQuery(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter' && placeSuggestions[0]) {
                                      e.preventDefault()
                                      void handleSelectPlaceSuggestion(placeSuggestions[0])
                                    }
                                  }}
                                  placeholder="Start typing AIRE, Admiral Sherman, Tiyan, or a Guam address"
                                  aria-autocomplete="list"
                                  aria-expanded={placeSuggestions.length > 0}
                                  className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-100"
                                />
                                {(placeLoading || selectedPlaceLoading) && (
                                  <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-slate-500">
                                    {selectedPlaceLoading ? 'Loading…' : 'Searching…'}
                                  </div>
                                )}
                              </div>
                              <button
                                type="button"
                                onClick={handleUseCurrentLocation}
                                disabled={currentLocationLoading}
                                className="rounded-xl bg-white px-4 py-3 text-sm font-semibold text-slate-800 ring-1 ring-slate-300 transition hover:bg-slate-50 disabled:opacity-50"
                              >
                                {currentLocationLoading ? 'Locating…' : 'Use current location'}
                              </button>
                            </div>
                          </div>
                          {geocodeError && (
                            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{geocodeError}</div>
                          )}
                          {placeSuggestions.length > 0 && (
                            <div className="space-y-2">
                              <p className="text-sm font-medium text-slate-700">Suggested matches</p>
                              {placeSuggestions.map((suggestion) => (
                                <button
                                  key={suggestion.place_id}
                                  type="button"
                                  onClick={() => void handleSelectPlaceSuggestion(suggestion)}
                                  disabled={selectedPlaceLoading}
                                  className="block w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-left text-sm text-slate-700 transition hover:border-cyan-300 hover:bg-cyan-50"
                                >
                                  <span className="block font-semibold text-slate-900">{suggestion.main_text || suggestion.description}</span>
                                  {suggestion.secondary_text && (
                                    <span className="mt-1 block text-xs text-slate-500">{suggestion.secondary_text}</span>
                                  )}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>

                        <div>
                          <label className="mb-2 block text-sm font-medium text-slate-700">Allowed radius (meters)</label>
                          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_130px]">
                            <input
                              type="range"
                              min="50"
                              max="2000"
                              step="25"
                              value={thresholdDraft.clock_in_location_radius_meters || '1000'}
                              onChange={(e) => setThresholdDraft((d) => ({ ...d, clock_in_location_radius_meters: e.target.value }))}
                              className="w-full accent-cyan-600"
                            />
                            <input
                              type="number"
                              min="1"
                              step="1"
                              value={thresholdDraft.clock_in_location_radius_meters}
                              onChange={(e) => setThresholdDraft((d) => ({ ...d, clock_in_location_radius_meters: e.target.value }))}
                              className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-100"
                            />
                          </div>
                        </div>

                        <details className="rounded-xl border border-slate-200 bg-white">
                          <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-slate-700">Advanced coordinates</summary>
                          <div className="grid gap-4 border-t border-slate-200 px-4 py-4 md:grid-cols-2">
                            <div>
                              <label className="mb-2 block text-sm font-medium text-slate-700">Latitude</label>
                              <input
                                type="number"
                                step="0.000001"
                                value={thresholdDraft.clock_in_location_latitude}
                                onChange={(e) => setThresholdDraft((d) => ({ ...d, clock_in_location_latitude: e.target.value }))}
                                className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-100"
                              />
                            </div>
                            <div>
                              <label className="mb-2 block text-sm font-medium text-slate-700">Longitude</label>
                              <input
                                type="number"
                                step="0.000001"
                                value={thresholdDraft.clock_in_location_longitude}
                                onChange={(e) => setThresholdDraft((d) => ({ ...d, clock_in_location_longitude: e.target.value }))}
                                className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-100"
                              />
                            </div>
                          </div>
                        </details>
                      </div>

                      <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
                        <div>
                          <p className="text-sm font-semibold text-slate-900">Map preview</p>
                          <p className="mt-1 text-sm text-slate-500">
                            Confirm the pin is on the AIRE office and then save the rule.
                          </p>
                        </div>
                        {hasPreviewCoordinates && mapIframeSrc ? (
                          <>
                            <div className="overflow-hidden rounded-2xl border border-slate-200">
                              {GOOGLE_MAPS_BROWSER_KEY ? (
                                <GoogleMapPreview latitude={previewLatitude} longitude={previewLongitude} />
                              ) : (
                                <iframe
                                  title="Clock-in location preview"
                                  src={mapIframeSrc}
                                  className="h-72 w-full"
                                  loading="lazy"
                                />
                              )}
                            </div>
                            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-600">
                              <p><span className="font-semibold text-slate-800">Latitude:</span> {thresholdDraft.clock_in_location_latitude}</p>
                              <p className="mt-1"><span className="font-semibold text-slate-800">Longitude:</span> {thresholdDraft.clock_in_location_longitude}</p>
                            </div>
                          </>
                        ) : (
                          <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">
                            Search for an address or use your current location to preview the saved pin here.
                          </div>
                        )}
                      </div>
                    </div>
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

          <FadeUp delay={0.08}>
            <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 px-5 py-4">
                <h2 className="text-lg font-semibold text-slate-900">Departments</h2>
                <p className="mt-1 text-sm text-slate-500">
                  Configure the departments used on Users and pending approvals. Labels are what admins see; keys stay stable for routing.
                </p>
              </div>
              <form onSubmit={handleSaveApprovalGroups} className="space-y-5 px-5 py-5">
                {approvalGroupsError && (
                  <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{approvalGroupsError}</div>
                )}
                {approvalGroupsMessage && (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{approvalGroupsMessage}</div>
                )}
                <div className="space-y-3">
                  {approvalGroupDrafts.map((group, index) => (
                    <div key={`approval-group-${index}`} className="grid gap-3 rounded-2xl border border-slate-200 bg-slate-50/70 p-4 md:grid-cols-[1.2fr_1fr_auto]">
                      <div>
                        <label className="mb-2 block text-sm font-medium text-slate-700">Label</label>
                        <input
                          value={group.label}
                          onChange={(e) => updateApprovalGroupDraft(index, 'label', e.target.value)}
                          placeholder={index === 0 ? 'CFI' : 'Ops / Maintenance'}
                          className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-100"
                        />
                      </div>
                      <div>
                        <label className="mb-2 block text-sm font-medium text-slate-700">Key</label>
                        <input
                          value={group.key}
                          onChange={(e) => updateApprovalGroupDraft(index, 'key', e.target.value)}
                          placeholder="optional; auto-generated from label"
                          className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-100"
                        />
                      </div>
                      <div className="flex items-end">
                        <button
                          type="button"
                          onClick={() => removeApprovalGroupDraft(index)}
                          disabled={approvalGroupDrafts.length === 1 && !group.label.trim() && !group.key.trim()}
                          className="w-full rounded-xl border border-slate-200 px-3 py-3 text-sm font-semibold text-slate-600 transition hover:border-slate-300 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    {approvalGroups.length > 0
                      ? `Currently configured: ${approvalGroups.map((group) => `${group.label} (${group.key})`).join(', ')}.`
                      : 'Departments load with the internal admin settings.'}
                  </div>
                  <button
                    type="button"
                    onClick={addApprovalGroupDraft}
                    className="rounded-lg border border-cyan-200 bg-cyan-50 px-3 py-2 text-xs font-semibold text-cyan-700 transition hover:bg-cyan-100"
                  >
                    Add department
                  </button>
                </div>
                <p className="text-xs text-slate-500">
                  If a group is already assigned to staff, reassign those users before removing that key.
                </p>
                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={savingApprovalGroups}
                    className="rounded-xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
                  >
                    {savingApprovalGroups ? 'Saving…' : 'Save departments'}
                  </button>
                </div>
              </form>
            </section>
          </FadeUp>

          <FadeUp delay={0.1}>
            <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 px-5 py-4">
                <h2 className="text-lg font-semibold text-slate-900">Contact settings</h2>
                <p className="mt-1 text-sm text-slate-500">
                  Control who receives website inquiries and which topics visitors can choose on the public contact form.
                </p>
              </div>
              <form onSubmit={handleSaveContactSettings} className="space-y-5 px-5 py-5">
                {contactSettingsError && (
                  <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{contactSettingsError}</div>
                )}
                {contactSettingsMessage && (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{contactSettingsMessage}</div>
                )}
                <div className="grid gap-5 lg:grid-cols-2">
                  <div>
                    <label htmlFor="contact-notification-emails" className="mb-2 block text-sm font-medium text-slate-700">Notification recipient emails</label>
                    <textarea
                      id="contact-notification-emails"
                      rows={6}
                      value={contactNotificationEmailsDraft}
                      onChange={(e) => setContactNotificationEmailsDraft(e.target.value)}
                      placeholder="ops@example.com&#10;owner@example.com"
                      className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-100"
                    />
                    <p className="mt-2 text-xs text-slate-500">
                      Enter one email per line. Every address listed here receives website contact-form notifications.
                    </p>
                  </div>
                  <div>
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <label className="block text-sm font-medium text-slate-700">Public inquiry topics</label>
                      <button
                        type="button"
                        onClick={addInquiryTopicDraft}
                        className="rounded-lg border border-cyan-200 bg-cyan-50 px-3 py-2 text-xs font-semibold text-cyan-700 transition hover:bg-cyan-100"
                      >
                        Add topic
                      </button>
                    </div>
                    <div className="space-y-3">
                      {inquiryTopicsDraft.map((topic, index) => (
                        <div key={`inquiry-topic-${index}`} className="flex items-center gap-3">
                          <input
                            id={`public-inquiry-topic-${index}`}
                            value={topic}
                            onChange={(e) => updateInquiryTopicDraft(index, e.target.value)}
                            placeholder={index === 0 ? 'Private Pilot Certificate' : 'Another inquiry topic'}
                            aria-label={index === 0 ? 'Public inquiry topics' : `Public inquiry topic ${index + 1}`}
                            className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-100"
                          />
                          <button
                            type="button"
                            onClick={() => removeInquiryTopicDraft(index)}
                            disabled={inquiryTopicsDraft.length === 1 && !topic.trim()}
                            aria-label={`Remove inquiry topic ${index + 1}`}
                            className="rounded-lg border border-slate-200 px-3 py-3 text-xs font-semibold text-slate-600 transition hover:border-slate-300 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                    <p className="mt-2 text-xs text-slate-500">
                      Add each topic as its own option. These are shown as selectable buttons on the public contact page.
                    </p>
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">
                  {contactSettings
                    ? `Currently configured: ${contactSettings.contact_notification_emails.length} recipient${contactSettings.contact_notification_emails.length === 1 ? '' : 's'} and ${contactSettings.inquiry_topics.length} public topic${contactSettings.inquiry_topics.length === 1 ? '' : 's'}.`
                    : 'Contact settings load separately from time clock settings.'}
                </div>
                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={savingContactSettings}
                    className="rounded-xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
                  >
                    {savingContactSettings ? 'Saving…' : 'Save contact settings'}
                  </button>
                </div>
              </form>
            </section>
          </FadeUp>

          <FadeUp delay={0.12}>
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
                        <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Usage</th>
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
                          <td className="px-5 py-4 text-sm">
                            <div>{cat.time_entries_count} entr{cat.time_entries_count === 1 ? 'y' : 'ies'}</div>
                            {(cat.employee_pay_rates_count ?? 0) > 0 && (
                              <div className="mt-1 text-xs text-slate-500">
                                {cat.employee_pay_rates_count} pay rate{cat.employee_pay_rates_count === 1 ? '' : 's'}
                              </div>
                            )}
                          </td>
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
                                <>
                                  <button type="button" onClick={() => handleDeactivateCategory(cat)} className="text-slate-600 hover:text-slate-900">
                                    Deactivate
                                  </button>
                                  {cat.deletable && (
                                    <button type="button" onClick={() => handleDeleteCategory(cat)} className="text-rose-700 hover:text-rose-900">
                                      Delete
                                    </button>
                                  )}
                                </>
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
