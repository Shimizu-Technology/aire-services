import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { api } from '../lib/api'
import { buildAireBusinessInfo } from '../lib/businessInfo'
import type { PublicContactInfoSettings } from '../lib/businessInfo'
import { PublicBusinessInfoContext } from './publicBusinessInfo'

export function PublicBusinessInfoProvider({ children }: { children: ReactNode }) {
  const [publicContact, setPublicContact] = useState<PublicContactInfoSettings | null>(null)

  useEffect(() => {
    let cancelled = false

    async function loadPublicContact() {
      const response = await api.getPublicContactSettings()
      if (!cancelled && response.data?.public_contact) {
        setPublicContact(response.data.public_contact)
      }
    }

    loadPublicContact()
    return () => { cancelled = true }
  }, [])

  const value = useMemo(() => buildAireBusinessInfo(publicContact), [publicContact])

  return (
    <PublicBusinessInfoContext.Provider value={value}>
      {children}
    </PublicBusinessInfoContext.Provider>
  )
}
