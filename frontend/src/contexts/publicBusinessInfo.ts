import { createContext, useContext } from 'react'
import { aireBusinessInfo } from '../lib/businessInfo'
import type { AireBusinessInfo } from '../lib/businessInfo'

export const PublicBusinessInfoContext = createContext<AireBusinessInfo>(aireBusinessInfo)

export function usePublicBusinessInfo() {
  return useContext(PublicBusinessInfoContext)
}
