import { createContext, useContext } from 'react'
import { aireBusinessInfo, defaultInquiryTopics } from '../lib/businessInfo'
import type { AireBusinessInfo } from '../lib/businessInfo'

export interface PublicBusinessInfoContextValue {
  businessInfo: AireBusinessInfo
  inquiryTopics: string[]
}

export const PublicBusinessInfoContext = createContext<PublicBusinessInfoContextValue>({
  businessInfo: aireBusinessInfo,
  inquiryTopics: defaultInquiryTopics,
})

export function usePublicBusinessInfo() {
  return useContext(PublicBusinessInfoContext).businessInfo
}

export function usePublicInquiryTopics() {
  return useContext(PublicBusinessInfoContext).inquiryTopics
}
