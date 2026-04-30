import { useEffect, useMemo, useRef, useState } from 'react'
import { api, type SiteMedia, type SiteMediaInput, type SiteMediaPlacement, type SiteMediaType } from '../../lib/api'
import { SITE_MEDIA_PLACEMENTS } from '../../lib/siteMedia'
import SiteMediaFrame from '../../components/site/SiteMediaFrame'
import { FadeUp } from '../../components/ui/MotionComponents'

const emptyForm = {
  title: '',
  alt_text: '',
  caption: '',
  placement: 'home_hero' as SiteMediaPlacement,
  media_type: 'image' as SiteMediaType,
  external_url: '',
  sort_order: '0',
  active: true,
  featured: false,
}

const imageAccept = 'image/jpeg,image/png,image/webp,image/avif,image/gif'
const videoAccept = 'video/mp4,video/webm,video/quicktime'

function filePreview(file: File | null) {
  if (!file) return null
  return URL.createObjectURL(file)
}

export default function Media() {
  useEffect(() => { document.title = 'Media | AIRE Ops' }, [])

  const [items, setItems] = useState<SiteMedia[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [editing, setEditing] = useState<SiteMedia | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [file, setFile] = useState<File | null>(null)
  const [poster, setPoster] = useState<File | null>(null)
  const [filePreviewUrl, setFilePreviewUrl] = useState<string | null>(null)
  const [posterPreviewUrl, setPosterPreviewUrl] = useState<string | null>(null)
  const [placementFilter, setPlacementFilter] = useState<SiteMediaPlacement | 'all'>('all')
  const formRef = useRef<HTMLFormElement>(null)

  const loadMedia = async () => {
    setLoading(true)
    const response = await api.getAdminSiteMedia()
    if (response.error) setError(response.error)
    else setItems(response.data?.site_media || [])
    setLoading(false)
  }

  useEffect(() => {
    loadMedia()
  }, [])

  useEffect(() => {
    const next = filePreview(file)
    setFilePreviewUrl(next)
    return () => { if (next) URL.revokeObjectURL(next) }
  }, [file])

  useEffect(() => {
    const next = filePreview(poster)
    setPosterPreviewUrl(next)
    return () => { if (next) URL.revokeObjectURL(next) }
  }, [poster])

  const visibleItems = useMemo(() => {
    return placementFilter === 'all' ? items : items.filter((item) => item.placement === placementFilter)
  }, [items, placementFilter])

  const placementCounts = useMemo(() => {
    return items.reduce<Partial<Record<SiteMediaPlacement, number>>>((acc, item) => {
      acc[item.placement] = (acc[item.placement] || 0) + 1
      return acc
    }, {})
  }, [items])

  const selectedPlacement = SITE_MEDIA_PLACEMENTS.find((item) => item.key === form.placement)
  const currentPreview: SiteMedia | null = editing || null

  const resetForm = () => {
    setEditing(null)
    setForm(emptyForm)
    setFile(null)
    setPoster(null)
    setError('')
    setMessage('')
  }

  const loadEdit = (item: SiteMedia) => {
    setEditing(item)
    setForm({
      title: item.title,
      alt_text: item.alt_text || '',
      caption: item.caption || '',
      placement: item.placement,
      media_type: item.media_type,
      external_url: item.external_url || '',
      sort_order: String(item.sort_order || 0),
      active: item.active,
      featured: item.featured,
    })
    setFile(null)
    setPoster(null)
    setError('')
    setMessage('')
    setTimeout(() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0)
  }

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault()
    setSaving(true)
    setError('')
    setMessage('')

    const payload: SiteMediaInput = {
      title: form.title.trim(),
      alt_text: form.alt_text.trim(),
      caption: form.caption.trim(),
      placement: form.placement,
      media_type: form.media_type,
      external_url: form.external_url.trim(),
      sort_order: Number.parseInt(form.sort_order, 10) || 0,
      active: form.active,
      featured: form.featured,
      file,
      poster,
    }

    const response = editing
      ? await api.updateSiteMedia(editing.id, payload)
      : await api.createSiteMedia(payload)

    if (response.error) {
      setError(response.error)
      setSaving(false)
      return
    }

    setMessage(editing ? 'Media updated.' : 'Media uploaded.')
    resetForm()
    await loadMedia()
    setSaving(false)
  }

  const handleDelete = async (item: SiteMedia) => {
    if (!confirm(`Delete "${item.title}"? This removes the uploaded media from the site.`)) return
    const response = await api.deleteSiteMedia(item.id)
    if (response.error) {
      setError(response.error)
      return
    }
    if (editing?.id === item.id) resetForm()
    await loadMedia()
  }

  const handleQuickToggle = async (item: SiteMedia) => {
    const response = await api.updateSiteMedia(item.id, {
      title: item.title,
      alt_text: item.alt_text || '',
      caption: item.caption || '',
      placement: item.placement,
      media_type: item.media_type,
      external_url: item.external_url || '',
      sort_order: item.sort_order,
      active: !item.active,
      featured: item.featured,
    })
    if (response.error) setError(response.error)
    else loadMedia()
  }

  return (
    <FadeUp>
      <div className="space-y-8">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-cyan-700">Site Media</p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900">Photos and videos</h1>
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-600">
              Upload real AIRE photos, short hero clips, video posters, and linked reels for the public site.
            </p>
          </div>
          <button
            type="button"
            onClick={resetForm}
            className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            New media
          </button>
        </div>

        <div className="grid gap-6 xl:grid-cols-[0.88fr_1.12fr]">
          <form ref={formRef} onSubmit={handleSave} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold tracking-tight text-slate-900">{editing ? 'Edit media' : 'Add media'}</h2>
                <p className="mt-1 text-sm leading-relaxed text-slate-500">{selectedPlacement?.helper}</p>
              </div>
              {editing && <span className="rounded-full bg-cyan-50 px-3 py-1 text-xs font-semibold text-cyan-700">Editing</span>}
            </div>

            <div className="mt-6 grid gap-4">
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700">Placement</label>
                <select
                  value={form.placement}
                  onChange={(event) => setForm((draft) => ({ ...draft, placement: event.target.value as SiteMediaPlacement }))}
                  className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-cyan-500 focus:ring-4 focus:ring-cyan-100"
                >
                  {SITE_MEDIA_PLACEMENTS.map((placement) => (
                    <option key={placement.key} value={placement.key}>{placement.label}</option>
                  ))}
                </select>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-700">Title</label>
                  <input
                    value={form.title}
                    onChange={(event) => setForm((draft) => ({ ...draft, title: event.target.value }))}
                    className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-cyan-500 focus:ring-4 focus:ring-cyan-100"
                    placeholder="Island tour coastline"
                    required
                  />
                </div>
                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-700">Type</label>
                  <select
                    value={form.media_type}
                    onChange={(event) => setForm((draft) => ({ ...draft, media_type: event.target.value as SiteMediaType }))}
                    className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-cyan-500 focus:ring-4 focus:ring-cyan-100"
                  >
                    <option value="image">Image</option>
                    <option value="video">Video</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700">Alt text</label>
                <input
                  value={form.alt_text}
                  onChange={(event) => setForm((draft) => ({ ...draft, alt_text: event.target.value }))}
                  className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-cyan-500 focus:ring-4 focus:ring-cyan-100"
                  placeholder="Aerial view of Guam coastline from an AIRE Services flight"
                  required={form.media_type === 'image'}
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700">Caption</label>
                <input
                  value={form.caption}
                  onChange={(event) => setForm((draft) => ({ ...draft, caption: event.target.value }))}
                  className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-cyan-500 focus:ring-4 focus:ring-cyan-100"
                  placeholder="Optional caption"
                />
              </div>

              {form.media_type === 'video' && (
                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-700">Video link</label>
                  <input
                    value={form.external_url}
                    onChange={(event) => setForm((draft) => ({ ...draft, external_url: event.target.value }))}
                    className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-cyan-500 focus:ring-4 focus:ring-cyan-100"
                    placeholder="YouTube, Vimeo, or hosted video URL"
                  />
                </div>
              )}

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 p-4 text-sm transition hover:border-cyan-300 hover:bg-cyan-50/50">
                  <span className="font-semibold text-slate-800">{form.media_type === 'video' ? 'Upload short video file' : 'Upload image'}</span>
                  <span className="mt-1 block text-xs leading-relaxed text-slate-500">
                    {form.media_type === 'video' ? 'MP4, WebM, or MOV. Keep hero clips short and compressed.' : 'JPG, PNG, WebP, AVIF, or GIF.'}
                  </span>
                  <input
                    type="file"
                    accept={form.media_type === 'video' ? videoAccept : imageAccept}
                    onChange={(event) => setFile(event.target.files?.[0] || null)}
                    className="mt-3 block w-full text-xs text-slate-500"
                  />
                </label>

                <label className="block rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 p-4 text-sm transition hover:border-cyan-300 hover:bg-cyan-50/50">
                  <span className="font-semibold text-slate-800">Poster image</span>
                  <span className="mt-1 block text-xs leading-relaxed text-slate-500">Recommended for videos and social previews.</span>
                  <input
                    type="file"
                    accept={imageAccept}
                    onChange={(event) => setPoster(event.target.files?.[0] || null)}
                    className="mt-3 block w-full text-xs text-slate-500"
                  />
                </label>
              </div>

              {(filePreviewUrl || posterPreviewUrl || currentPreview?.file_url || currentPreview?.poster_url) && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-100">
                    <SiteMediaFrame
                      media={filePreviewUrl ? { ...(currentPreview || {} as SiteMedia), media_type: form.media_type, file_url: filePreviewUrl, external_url: null, poster_url: posterPreviewUrl } as SiteMedia : currentPreview}
                      fallbackSrc={filePreviewUrl || currentPreview?.file_url || undefined}
                      fallbackAlt={form.alt_text || form.title || 'Media preview'}
                      className="aspect-video"
                    />
                  </div>
                  {(posterPreviewUrl || currentPreview?.poster_url) && (
                    <img src={posterPreviewUrl || currentPreview?.poster_url || ''} alt="" className="aspect-video w-full rounded-2xl border border-slate-200 object-cover" />
                  )}
                </div>
              )}

              <div className="grid gap-4 sm:grid-cols-3">
                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-700">Sort order</label>
                  <input
                    type="number"
                    value={form.sort_order}
                    onChange={(event) => setForm((draft) => ({ ...draft, sort_order: event.target.value }))}
                    className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-cyan-500 focus:ring-4 focus:ring-cyan-100"
                  />
                </div>
                <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-700">
                  <input type="checkbox" checked={form.active} onChange={(event) => setForm((draft) => ({ ...draft, active: event.target.checked }))} />
                  Active
                </label>
                <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-700">
                  <input type="checkbox" checked={form.featured} onChange={(event) => setForm((draft) => ({ ...draft, featured: event.target.checked }))} />
                  Featured
                </label>
              </div>

              {error && <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
              {message && <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div>}

              <div className="flex flex-wrap justify-end gap-3">
                {editing && (
                  <button type="button" onClick={resetForm} className="rounded-xl border border-slate-300 px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50">
                    Cancel
                  </button>
                )}
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  {saving ? 'Saving...' : editing ? 'Save changes' : 'Add media'}
                </button>
              </div>
            </div>
          </form>

          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="text-xl font-semibold tracking-tight text-slate-900">Media library</h2>
                <p className="mt-1 text-sm text-slate-500">{items.length} uploaded or linked items</p>
              </div>
              <select
                value={placementFilter}
                onChange={(event) => setPlacementFilter(event.target.value as SiteMediaPlacement | 'all')}
                className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm text-slate-900 outline-none transition focus:border-cyan-500 focus:ring-4 focus:ring-cyan-100"
              >
                <option value="all">All placements</option>
                {SITE_MEDIA_PLACEMENTS.map((placement) => (
                  <option key={placement.key} value={placement.key}>{placement.label} ({placementCounts[placement.key] || 0})</option>
                ))}
              </select>
            </div>

            {loading ? (
              <div className="mt-6 grid gap-4 sm:grid-cols-2">
                {Array.from({ length: 4 }).map((_, index) => <div key={index} className="h-56 animate-pulse rounded-2xl bg-slate-100" />)}
              </div>
            ) : visibleItems.length === 0 ? (
              <div className="mt-6 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-500">
                No media for this filter yet.
              </div>
            ) : (
              <div className="mt-6 grid gap-4 sm:grid-cols-2">
                {visibleItems.map((item) => {
                  const placement = SITE_MEDIA_PLACEMENTS.find((entry) => entry.key === item.placement)
                  return (
                    <article key={item.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
                      <SiteMediaFrame media={item} fallbackAlt={item.alt_text || item.title} className="aspect-video" />
                      <div className="p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <h3 className="font-semibold text-slate-900">{item.title}</h3>
                            <p className="mt-1 text-xs font-semibold uppercase tracking-[0.12em] text-cyan-700">{placement?.label || item.placement}</p>
                          </div>
                          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${item.active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-200 text-slate-600'}`}>
                            {item.active ? 'Active' : 'Hidden'}
                          </span>
                        </div>
                        {item.caption && <p className="mt-3 text-sm leading-relaxed text-slate-600">{item.caption}</p>}
                        <div className="mt-4 flex flex-wrap gap-2">
                          <button onClick={() => loadEdit(item)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">Edit</button>
                          <button onClick={() => handleQuickToggle(item)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                            {item.active ? 'Hide' : 'Show'}
                          </button>
                          <button onClick={() => handleDelete(item)} className="rounded-lg border border-red-200 bg-white px-3 py-2 text-xs font-semibold text-red-600 hover:bg-red-50">Delete</button>
                        </div>
                      </div>
                    </article>
                  )
                })}
              </div>
            )}
          </section>
        </div>
      </div>
    </FadeUp>
  )
}
