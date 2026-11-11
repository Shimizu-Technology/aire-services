import { createContext, useContext } from 'react'
import type { SettingsCatalogEntry } from '../../lib/api'

// The backend's settings catalog, provided by the Settings page so any
// section (including PayStubSettings) can show a setting's help by id.
export const SettingsCatalogContext = createContext<SettingsCatalogEntry[]>([])

export function useSettingsCatalogEntry(id: string) {
  return useContext(SettingsCatalogContext).find((entry) => entry.id === id)
}
