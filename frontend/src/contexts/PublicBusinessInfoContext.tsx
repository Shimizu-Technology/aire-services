import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { api } from '../lib/api'
import { buildAireBusinessInfo, defaultInquiryTopics } from '../lib/businessInfo'
import type { PublicContactInfoSettings } from '../lib/businessInfo'
import { PublicBusinessInfoContext } from './publicBusinessInfo'

export function PublicBusinessInfoProvider({ children }: { children: ReactNode }) {
  const [publicContact, setPublicContact] = useState<PublicContactInfoSettings | null>(null)
  const [inquiryTopics, setInquiryTopics] = useState(defaultInquiryTopics)

  useEffect(() => {
    let cancelled = false

    async function loadPublicContact() {
      try {
        const response = await api.getPublicContactSettings()
        if (!cancelled && response.data?.public_contact) {
          setPublicContact(response.data.public_contact)
        }
        const nextTopics = response.data?.inquiry_topics?.filter(Boolean)
        if (!cancelled && nextTopics && nextTopics.length > 0) {
          setInquiryTopics(nextTopics)
        }
      } catch (error) {
        console.warn('Unable to load public contact settings; using defaults.', error)
      }
    }

    loadPublicContact()
    return () => { cancelled = true }
  }, [])

  const value = useMemo(() => ({
    businessInfo: buildAireBusinessInfo(publicContact),
    inquiryTopics,
  }), [inquiryTopics, publicContact])

  return (
    <PublicBusinessInfoContext.Provider value={value}>
      {children}
    </PublicBusinessInfoContext.Provider>
  )
}
