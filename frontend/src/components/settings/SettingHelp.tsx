import { HelpTip } from '../ui/HelpTip'
import { useSettingsCatalogEntry } from './settingsCatalogContext'

interface SettingHelpProps {
  /** A SettingsCatalog entry id, e.g. "managers_can_approve_own_time". */
  id: string
  className?: string
}

/**
 * The (i) help for one setting, written once in the backend's SettingsCatalog:
 * what it does, its default, who can change it and an example. Renders
 * nothing until the catalog has loaded.
 */
export default function SettingHelp({ id, className }: SettingHelpProps) {
  const entry = useSettingsCatalogEntry(id)
  if (!entry) return null
  return (
    <HelpTip
      label={entry.label}
      what={entry.what}
      defaultValue={entry.default}
      who={entry.who}
      example={entry.example}
      className={className}
    />
  )
}
