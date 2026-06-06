import { createContext, useContext } from 'react'
import { aireBusinessInfo, defaultInquiryTopics } from '../lib/businessInfo'
import { defaultSocialLinks } from '../lib/socialLinks'
import type { AireBusinessInfo } from '../lib/businessInfo'
import type { SocialLink } from '../lib/api'

export interface PublicBusinessInfoContextValue {
  businessInfo: AireBusinessInfo
  inquiryTopics: string[]
  socialLinks: SocialLink[]
}

export const PublicBusinessInfoContext = createContext<PublicBusinessInfoContextValue>({
  businessInfo: aireBusinessInfo,
  inquiryTopics: defaultInquiryTopics,
  socialLinks: defaultSocialLinks,
})

export function usePublicBusinessInfo() {
  return useContext(PublicBusinessInfoContext).businessInfo
}

export function usePublicInquiryTopics() {
  return useContext(PublicBusinessInfoContext).inquiryTopics
}

export function usePublicSocialLinks() {
  return useContext(PublicBusinessInfoContext).socialLinks
}
