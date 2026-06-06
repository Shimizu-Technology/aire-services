import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { api } from '../lib/api'
import { buildAireBusinessInfo, defaultInquiryTopics } from '../lib/businessInfo'
import { defaultSocialLinks, visibleSocialLinks } from '../lib/socialLinks'
import type { PublicContactInfoSettings } from '../lib/businessInfo'
import type { SocialLink } from '../lib/api'
import { PublicBusinessInfoContext } from './publicBusinessInfo'

export function PublicBusinessInfoProvider({ children }: { children: ReactNode }) {
  const [publicContact, setPublicContact] = useState<PublicContactInfoSettings | null>(null)
  const [inquiryTopics, setInquiryTopics] = useState(defaultInquiryTopics)
  const [socialLinks, setSocialLinks] = useState<SocialLink[]>(defaultSocialLinks)

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
        if (!cancelled && response.data?.social_links) {
          setSocialLinks(visibleSocialLinks(response.data.social_links))
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
    socialLinks,
  }), [inquiryTopics, publicContact, socialLinks])

  return (
    <PublicBusinessInfoContext.Provider value={value}>
      {children}
    </PublicBusinessInfoContext.Provider>
  )
}
