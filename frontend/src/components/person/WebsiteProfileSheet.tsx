import { useEffect, useState } from 'react'
import type { AdminUser } from '../../lib/api'
import { Button, Field, Input, Sheet, Switch, Textarea } from '../ui'

import type { WebsiteDraft } from './websiteDraft'

export function WebsiteProfileSheet({ open, user, value, photo, removePhoto, onChange, onPhoto, onRemovePhoto, onClose }: {
  open: boolean; user: AdminUser; value: WebsiteDraft; photo: File | null; removePhoto: boolean;
  onChange: (draft: WebsiteDraft) => void; onPhoto: (photo: File | null) => void; onRemovePhoto: (remove: boolean) => void; onClose: () => void
}) {
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!photo) return
    const url = URL.createObjectURL(photo)
    setPhotoUrl(url) // eslint-disable-line react-hooks/set-state-in-effect -- object URL lifecycle
    return () => URL.revokeObjectURL(url)
  }, [photo])
  const src = photo ? photoUrl : removePhoto ? null : user.public_team_photo_card_url || user.public_team_photo_url
  const set = <K extends keyof WebsiteDraft>(key: K, next: WebsiteDraft[K]) => onChange({ ...value, [key]: next })
  return <Sheet open={open} onClose={onClose} title="Website profile" description="Changes are saved with Employment."
    footer={<Button onClick={onClose} className="w-full">Done</Button>}>
    <div className="space-y-4">
      <Switch label="Shown on site" checked={value.public_team_enabled} onChange={next => set('public_team_enabled', next)} />
      <Field label="Public display name" help="Leave blank to use their name."><Input value={value.public_team_name} onChange={e => set('public_team_name', e.target.value)} /></Field>
      <Field label="Public title" help="Leave blank to use their job title."><Input value={value.public_team_title} onChange={e => set('public_team_title', e.target.value)} /></Field>
      <Field label="Bio" help="Up to 5,000 characters."><Textarea rows={5} maxLength={5000} value={value.public_team_bio} onChange={e => set('public_team_bio', e.target.value)} /></Field>
      <Field label="Display order" help="Lower numbers appear first."><Input type="number" step="1" value={value.public_team_sort_order} onChange={e => set('public_team_sort_order', Number(e.target.value))} /></Field>
      {src && <img src={src} alt="Website profile preview" className="mx-auto aspect-[4/5] w-48 max-w-full rounded-card object-cover"
        style={{ objectPosition: `${value.public_team_photo_position_x}% ${value.public_team_photo_position_y}%` }} />}
      <Field label="Photo" help="JPG, PNG, WebP, AVIF or GIF, up to 15 MB."><Input type="file" accept="image/jpeg,image/png,image/webp,image/avif,image/gif" onChange={e => {
        const file = e.target.files?.[0] || null
        if (file && file.size > 15 * 1024 * 1024) { setError('Team photos must be smaller than 15 MB.'); e.target.value = ''; return }
        setError(''); onPhoto(file); if (file) onRemovePhoto(false)
      }} /></Field>
      {error && <p role="alert" className="text-body-sm text-danger">{error}</p>}
      {photo && <Button variant="secondary" onClick={() => onPhoto(null)}>Clear selected photo</Button>}
      {!photo && (user.public_team_photo_url || user.public_team_photo_thumb_url) && <Button variant="secondary" onClick={() => onRemovePhoto(!removePhoto)}>{removePhoto ? 'Undo removal' : 'Remove current photo'}</Button>}
      {removePhoto && <p className="text-body-sm text-ink-muted">The photo will be removed when you save Employment.</p>}
      <Field label="Horizontal focus"><Input type="range" min="0" max="100" value={value.public_team_photo_position_x} onChange={e => set('public_team_photo_position_x', Number(e.target.value))} /></Field>
      <Field label="Vertical focus"><Input type="range" min="0" max="100" value={value.public_team_photo_position_y} onChange={e => set('public_team_photo_position_y', Number(e.target.value))} /></Field>
    </div>
  </Sheet>
}
