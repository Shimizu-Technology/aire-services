import { useState } from 'react'
import { api, type AdminUser } from '../../lib/api'
import { peopleApi } from '../../lib/api/people'
import { formatWorkDate } from '../../lib/dateUtils'
import { Button, ConfirmDialog, Field, Input, Switch, UnsavedChangesBar, blockPathOrParams, useUnsavedChanges } from '../ui'
import { EndEmploymentFlow } from './EndEmploymentFlow'
import { personName } from './personFormat'
import { dataOrThrow, useLoadable } from './useLoadable'
import { usePersonEdit } from './usePersonEdit'
import { EditError } from './EditError'
import { WebsiteProfileSheet } from './WebsiteProfileSheet'
import { websiteDraft } from './websiteDraft'

function Chip({ checked, disabled, onChange, children }: { checked: boolean; disabled: boolean; onChange: () => void; children: React.ReactNode }) {
  return <label className={`inline-flex min-h-11 max-w-full cursor-pointer items-center gap-2 rounded-control border px-3 py-2 text-body-sm ${checked ? 'border-primary bg-primary/5' : 'border-line'}`}>
    <input type="checkbox" checked={checked} disabled={disabled} onChange={onChange} className="size-4 shrink-0 accent-primary" />
    <span className="[overflow-wrap:anywhere]">{children}</span>
  </label>
}
const toggle = <T,>(values: T[], value: T) => values.includes(value) ? values.filter(item => item !== value) : [...values, value]

export function EmploymentTab({ user: incomingUser, onSaved }: { user: AdminUser; onSaved: (user: AdminUser, pin?: string | null) => void }) {
  // Keep the loaded version with its draft until this editor saves or reloads.
  const [user, setUser] = useState(incomingUser)
  const [title, setTitle] = useState(user.staff_title || '')
  const [first, setFirst] = useState(user.first_name || '')
  const [last, setLast] = useState(user.last_name || '')
  const [groups, setGroups] = useState(user.approval_group_keys ?? (user.approval_group ? [user.approval_group] : []))
  const [categories, setCategories] = useState(user.time_category_ids ?? [])
  const [tracking, setTracking] = useState(user.time_tracking_enabled)
  const [intern, setIntern] = useState(Boolean(user.is_intern))
  const [website, setWebsite] = useState(() => websiteDraft(user))
  const [photo, setPhoto] = useState<File | null>(null)
  const [removePhoto, setRemovePhoto] = useState(false)
  const [showWebsite, setShowWebsite] = useState(false)
  const [ending, setEnding] = useState(false)
  const [reactivating, setReactivating] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [retry, setRetry] = useState(0)
  const reset = (next: AdminUser) => {
    setTitle(next.staff_title || ''); setFirst(next.first_name || ''); setLast(next.last_name || '')
    setGroups(next.approval_group_keys ?? (next.approval_group ? [next.approval_group] : [])); setCategories(next.time_category_ids ?? [])
    setTracking(next.time_tracking_enabled); setIntern(Boolean(next.is_intern)); setWebsite(websiteDraft(next)); setPhoto(null); setRemovePhoto(false)
  }
  const accept = (next: AdminUser, pin?: string | null) => { setUser(next); reset(next); onSaved(next, pin) }
  const edit = usePersonEdit(user, accept)
  const options = useLoadable(String(retry), async () => {
    const [settings, work] = await Promise.all([api.getAdminAppSettings(), api.getAdminTimeCategories()])
    return { groups: dataOrThrow(settings, "Couldn't load departments.").approval_groups, categories: dataOrThrow(work, "Couldn't load work types.").time_categories }
  }, "Couldn't load the work setup choices.")
  const ended = user.employment_status === 'terminated'
  const inactive = !user.is_active
  const dirty = title !== (user.staff_title || '') || first !== (user.first_name || '') || last !== (user.last_name || '') ||
    JSON.stringify(groups) !== JSON.stringify(user.approval_group_keys ?? (user.approval_group ? [user.approval_group] : [])) ||
    JSON.stringify(categories) !== JSON.stringify(user.time_category_ids ?? []) || tracking !== user.time_tracking_enabled || intern !== Boolean(user.is_intern) ||
    JSON.stringify(website) !== JSON.stringify(websiteDraft(user)) || Boolean(photo) || removePhoto
  const discard = () => { reset(user); edit.clearError() }
  const save = () => void edit.save({ staff_title: title.trim() || null, approval_groups: groups, time_category_ids: tracking ? categories : [],
    time_tracking_enabled: tracking, is_intern: intern, ...website, remove_photo: removePhoto,
    ...(!user.personal_access_enabled ? { first_name: first.trim(), last_name: last.trim() } : {}) }, photo)
  const unsaved = useUnsavedChanges({ dirty, onSave: save, onDiscard: discard, saving: edit.saving, shouldBlock: blockPathOrParams('tab'),
    what: 'Employment', summary: 'Work setup and website profile', saveLabel: 'Save', saveDisabled: edit.conflict || ended || options.status !== 'ready' })
  const reactivate = async () => {
    if (restoring || edit.conflict) return
    setRestoring(true)
    const response = await peopleApi.reactivate(user.id, user.admin_edit_version ?? 0)
    setRestoring(false)
    setReactivating(false)
    if (response.data) { edit.clearError(); accept(response.data.user, response.data.kiosk_pin) }
    else edit.fail(response.error || "Couldn't reactivate this person.", response.status)
  }
  return <div className="max-w-[55rem] space-y-4 pb-24 lg:pb-0">
    <section aria-label="Work setup" className="space-y-4 rounded-card border border-line bg-surface p-4">
      <h2 className="text-body font-semibold">Work setup</h2>
      <fieldset disabled={ended || edit.saving} className="space-y-4">
        {!user.personal_access_enabled && !ended && <div className="grid gap-3 sm:grid-cols-2"><Field label="First name"><Input value={first} onChange={e => setFirst(e.target.value)} /></Field><Field label="Last name"><Input value={last} onChange={e => setLast(e.target.value)} /></Field></div>}
        <Field label="Job title"><Input value={title} onChange={e => setTitle(e.target.value)} /></Field>
        {options.status === 'error' && <div role="alert" className="text-body-sm text-danger">{options.message}<Button variant="secondary" onClick={() => setRetry(value => value + 1)}>Retry choices</Button></div>}
        {options.status === 'loading' && <p role="status" className="text-body-sm">Loading departments and work types…</p>}
        {options.status === 'ready' && <>
          <fieldset><legend className="mb-2 text-body-sm font-medium">Departments</legend><div className="flex flex-wrap gap-2">
            {options.value.groups.map(group => <Chip key={group.key} checked={groups.includes(group.key)} disabled={ended || edit.saving} onChange={() => setGroups(toggle(groups, group.key))}>{group.label}</Chip>)}
            {!options.value.groups.length && <p className="text-body-sm text-ink-muted">No departments configured.</p>}
          </div></fieldset>
          <Switch label="Tracks work hours" checked={tracking} onChange={setTracking} disabled={user.can_change_access === false || !user.personal_access_enabled} description={user.personal_access_enabled ? "Includes shared kiosk access. Clock them out before changing this setup." : "Kiosk-only staff must track work hours. Enable personal sign-in in Access before turning this off."} />
          {tracking && <fieldset><legend className="mb-2 text-body-sm font-medium">Work they can clock</legend><div className="flex flex-wrap gap-2">
            {options.value.categories.filter(category => category.is_active || categories.includes(category.id)).map(category => <Chip key={category.id} checked={categories.includes(category.id)} disabled={ended || edit.saving} onChange={() => setCategories(toggle(categories, category.id))}>{category.name}{!category.is_active && ' (inactive)'}</Chip>)}
          </div><p className="mt-2 text-body-sm text-ink-muted">Choose at least one active work type.</p></fieldset>}
        </>}
        <Switch label="Intern" checked={intern} onChange={setIntern} />
      </fieldset>
    </section>
    <section aria-label="Public website" className="rounded-card border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><div className="min-w-0 text-body-sm"><h2 className="font-semibold">Public website</h2><p className="text-ink-muted">{website.public_team_enabled && !ended ? 'Shown on the Team page' : 'Hidden from the Team page'}</p>
        <p className="[overflow-wrap:anywhere]">{website.public_team_title || title || 'No title yet'}</p></div><Button variant="secondary" disabled={ended || edit.saving} onClick={() => setShowWebsite(true)}>Edit profile</Button></div>
    </section>
    <section aria-label="Employment status" className="space-y-3 rounded-card border border-danger/30 bg-surface p-4">
      <h2 className="text-body font-semibold">{ended ? 'Employment ended' : inactive ? 'Inactive' : 'End employment'}</h2>
      {ended || inactive ? <><p className="text-body-sm [overflow-wrap:anywhere]">{ended ? 'Employment ended' : 'This person is inactive'}{user.termination_effective_on ? ` ${formatWorkDate(user.termination_effective_on)}` : ''}{user.terminated_by ? ` by ${user.terminated_by.full_name}` : ''}.</p>
        {user.termination_reason && <p className="text-body-sm text-ink-muted [overflow-wrap:anywhere]">{user.termination_reason}</p>}
        {user.can_change_access !== false && <Button variant="secondary" disabled={edit.conflict || edit.saving} onClick={() => setReactivating(true)}>Reactivate…</Button>}</>
        : <><p className="text-body-sm text-ink-muted">Turns off sign-in, the kiosk and My Pay, and revokes open pay stub links. Their hours and paychecks stay.</p>
          {user.can_change_access !== false && <Button variant="danger-outline" className="max-w-full whitespace-normal! text-left [overflow-wrap:anywhere]" disabled={dirty || edit.saving} onClick={() => setEnding(true)}>End {personName(user)}'s employment…</Button>}
          {dirty && <p className="text-body-sm text-ink-muted">Save or discard changes before ending employment.</p>}</>}
      {user.can_change_access === false && <p className="text-body-sm text-ink-muted">Only an owner can end or restore employment for an owner or admin.</p>}
    </section>
    <EditError error={edit.error} conflict={edit.conflict} busy={edit.saving} onReload={() => void edit.reload()} />
    <UnsavedChangesBar {...unsaved.barProps} />{unsaved.guard}
    <WebsiteProfileSheet open={showWebsite} user={user} value={website} photo={photo} removePhoto={removePhoto} onChange={setWebsite} onPhoto={setPhoto} onRemovePhoto={setRemovePhoto} onClose={() => setShowWebsite(false)} />
    {ending && <EndEmploymentFlow user={user} onClose={() => setEnding(false)} onEnded={accept} />}
    <ConfirmDialog open={reactivating} title="Reactivate this person?" description="Restores the access saved when employment ended. If no saved setup exists, keeps their current sign-in, time tracking and kiosk settings. Old PINs are revoked. Kiosk-only staff with kiosk access get a new PIN shown once; personal accounts choose a new PIN at sign-in. My Pay and website visibility stay as they are; revoked pay stub links stay revoked." confirmLabel="Reactivate" busy={restoring} onConfirm={() => void reactivate()} onCancel={() => setReactivating(false)} />
  </div>
}
