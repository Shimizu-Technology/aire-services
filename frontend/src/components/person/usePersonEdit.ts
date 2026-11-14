import { useState } from 'react'
import type { AdminUser } from '../../lib/api'
import { peopleApi, type PersonEdit } from '../../lib/api/people'
import { invitationOutcomeMessage } from '../../lib/invitationOutcome'
import { useToast } from '../ui'

export function usePersonEdit(user: AdminUser, onSaved: (user: AdminUser, pin?: string | null) => void) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [conflict, setConflict] = useState(false)
  const toast = useToast()
  const fail = (message: string, status?: number) => {
    setError(message)
    if (status === 409) setConflict(true)
  }
  const clearError = () => { if (!conflict) setError('') }
  const save = async (edit: Omit<PersonEdit, 'admin_edit_version'>, photo?: File | null) => {
    if (saving || conflict) return
    setSaving(true)
    setError('')
    const response = await peopleApi.save(user.id, { ...edit, admin_edit_version: user.admin_edit_version ?? 0 }, photo)
    setSaving(false)
    if (!response.data) {
      fail(response.error || "Couldn't save this person.", response.status)
      return
    }
    onSaved(response.data.user, response.data.kiosk_pin)
    toast.show({ message: edit.send_invitation ? `Changes saved. ${invitationOutcomeMessage(response.data, true)}` : 'Changes saved.' })
  }
  const reload = async () => {
    setSaving(true)
    const response = await peopleApi.person(user.id)
    setSaving(false)
    if (response.data) { setConflict(false); setError(''); onSaved(response.data.user) }
    else if (!conflict) setError(response.error || "Couldn't reload this person.")
  }
  return { saving, conflict, save, error, clearError, fail, reload }
}
