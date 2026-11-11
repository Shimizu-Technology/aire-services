import { useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Check, ChevronDown, Search } from 'lucide-react'
import { cx } from '../../lib/cx'
import { useMediaQuery } from '../../lib/useMediaQuery'
import { Avatar } from './Avatar'
import { Sheet } from './Sheet'

export interface PickerPerson {
  id: number | string
  name: string
  /** One short line: "CFI · Employee". Searched too. */
  meta?: string
}

export interface PersonPickerProps {
  /** The field label: "Who worked". */
  label: string
  people: PickerPerson[]
  value: PickerPerson['id'] | null
  onChange: (person: PickerPerson) => void
  /** Shown first while nothing is typed, most recent first. */
  recentIds?: Array<PickerPerson['id']>
  placeholder?: string
  /** Help under the field. */
  description?: ReactNode
  disabled?: boolean
  className?: string
}

const DESKTOP = '(min-width: 1024px)'

// "tasi" finds "Tåsi"; case and accents don't matter.
const fold = (value: string) => value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()

interface Section { title: string | null; people: PickerPerson[] }

function sectionsFor(people: PickerPerson[], query: string, recentIds: Array<PickerPerson['id']>): Section[] {
  const sorted = [...people].sort((a, b) => a.name.localeCompare(b.name))
  const needle = fold(query.trim())
  if (needle) {
    const words = needle.split(/\s+/)
    return [{ title: null, people: sorted.filter(person => words.every(word => fold(`${person.name} ${person.meta ?? ''}`).includes(word))) }]
  }
  const recent = recentIds.map(id => people.find(person => person.id === id)).filter((person): person is PickerPerson => Boolean(person))
  if (recent.length === 0) return [{ title: null, people: sorted }]
  return [{ title: 'Recent', people: recent }, { title: 'Everyone', people: sorted.filter(person => !recent.includes(person)) }]
}

/**
 * Choose one person. From 1024px it's a type-to-filter combobox; on phones a
 * button opens a full-height sheet with search, so the keyboard doesn't hide
 * the list. Recent people come first while nothing is typed.
 */
export function PersonPicker(props: PersonPickerProps) {
  const desktop = useMediaQuery(DESKTOP)
  return desktop ? <PersonCombobox {...props} /> : <PersonSheetPicker {...props} />
}

function PersonOption({ person, selected }: { person: PickerPerson; selected: boolean }) {
  return (
    <>
      <Avatar name={person.name} size="sm" />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium text-ink">{person.name}</span>
        {person.meta && <span className="block truncate text-caption text-ink-muted">{person.meta}</span>}
      </span>
      {selected && <Check aria-hidden="true" className="size-4 shrink-0 text-primary" />}
    </>
  )
}

function PersonCombobox({ label, people, value, onChange, recentIds = [], placeholder = 'Find a person', description, disabled, className }: PersonPickerProps) {
  const ids = useId()
  const selected = people.find(person => person.id === value) ?? null
  const [query, setQuery] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  const sections = useMemo(() => sectionsFor(people, query ?? '', recentIds), [people, query, recentIds])
  const options = sections.flatMap(section => section.people)
  const activeIndex = Math.min(active, Math.max(0, options.length - 1))
  const optionId = (index: number) => `${ids}-option-${index}`

  const choose = (person: PickerPerson) => {
    onChange(person)
    setQuery(null)
    setOpen(false)
  }

  const moveTo = (index: number) => {
    setActive(index)
    document.getElementById(optionId(index))?.scrollIntoView?.({ block: 'nearest' })
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!open) { setOpen(true); moveTo(0); return }
      const last = options.length - 1
      moveTo(event.key === 'ArrowDown' ? (activeIndex >= last ? 0 : activeIndex + 1) : (activeIndex <= 0 ? last : activeIndex - 1))
    } else if (event.key === 'Enter' && open && options[activeIndex]) {
      event.preventDefault()
      choose(options[activeIndex])
    } else if (event.key === 'Escape' && open) {
      event.preventDefault()
      event.stopPropagation()
      setOpen(false)
      setQuery(null)
    } else if (event.key === 'Home' && open) {
      event.preventDefault(); moveTo(0)
    } else if (event.key === 'End' && open) {
      event.preventDefault(); moveTo(options.length - 1)
    }
  }

  // Where each section's options start in the flat option list.
  const offsets = sections.map((_, at) => sections.slice(0, at).reduce((sum, section) => sum + section.people.length, 0))
  return (
    <div className={cx('relative', className)}>
      <label htmlFor={`${ids}-input`} className="mb-1.5 block text-body-sm font-semibold text-ink">{label}</label>
      <div className="relative">
        <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-subtle" />
        <input
          id={`${ids}-input`}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={`${ids}-listbox`}
          aria-activedescendant={open && options[activeIndex] ? optionId(activeIndex) : undefined}
          aria-describedby={description ? `${ids}-description` : undefined}
          autoComplete="off"
          spellCheck={false}
          disabled={disabled}
          placeholder={placeholder}
          value={query ?? selected?.name ?? ''}
          onChange={(event) => { setQuery(event.target.value); setOpen(true); setActive(0) }}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onBlur={(event) => {
            if (listRef.current?.contains(event.relatedTarget as Node | null)) return
            setOpen(false)
            setQuery(null)
          }}
          onKeyDown={onKeyDown}
          className="block min-h-11 w-full rounded-control border border-line-strong bg-surface pl-9 pr-3 text-body text-ink placeholder:text-ink-subtle focus:border-primary pointer-fine:min-h-10 pointer-fine:text-body-sm"
        />
      </div>
      {description && <p id={`${ids}-description`} className="mt-1.5 text-caption text-ink-muted">{description}</p>}
      <div
        ref={listRef}
        id={`${ids}-listbox`}
        role="listbox"
        aria-label={label}
        hidden={!open}
        className="absolute inset-x-0 top-full z-(--z-popover) mt-1 max-h-80 overflow-y-auto overscroll-contain rounded-card border border-line bg-surface p-1 shadow-lg"
      >
        {options.length === 0 && <p className="px-3 py-2.5 text-body-sm text-ink-muted">Nobody matches “{query}”.</p>}
        {sections.map((section, sectionIndex) => (
          <div key={section.title ?? 'all'} role={section.title ? 'group' : undefined} aria-label={section.title ?? undefined}>
            {section.title && <p aria-hidden="true" className="px-3 pb-1 pt-2 text-caption font-semibold text-ink-subtle">{section.title}</p>}
            {section.people.map((person, position) => {
              const optionIndex = offsets[sectionIndex] + position
              return (
                <div
                  key={person.id}
                  id={optionId(optionIndex)}
                  role="option"
                  aria-selected={person.id === value}
                  data-active={optionIndex === activeIndex || undefined}
                  // Keep focus in the input so the list doesn't close before the click lands.
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseMove={() => { if (optionIndex !== activeIndex) setActive(optionIndex) }}
                  onClick={() => choose(person)}
                  className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-control px-2.5 text-body-sm data-active:bg-surface-muted data-active:outline-2 data-active:-outline-offset-2 data-active:outline-primary/30 pointer-fine:min-h-10"
                >
                  <PersonOption person={person} selected={person.id === value} />
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}

function PersonSheetPicker({ label, people, value, onChange, recentIds = [], placeholder = 'Find a person', description, disabled, className }: PersonPickerProps) {
  const ids = useId()
  const selected = people.find(person => person.id === value) ?? null
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const sections = useMemo(() => sectionsFor(people, query, recentIds), [people, query, recentIds])
  const close = () => { setOpen(false); setQuery('') }

  return (
    <div className={className}>
      <span id={`${ids}-label`} className="mb-1.5 block text-body-sm font-semibold text-ink">{label}</span>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-labelledby={`${ids}-label ${ids}-value`}
        aria-describedby={description ? `${ids}-description` : undefined}
        disabled={disabled}
        onClick={() => setOpen(true)}
        className="flex min-h-11 w-full items-center gap-2.5 rounded-control border border-line-strong bg-surface px-3 text-left text-body disabled:cursor-not-allowed disabled:opacity-60"
      >
        {selected && <Avatar name={selected.name} size="sm" />}
        <span id={`${ids}-value`} className={cx('min-w-0 flex-1 truncate', selected ? 'text-ink' : 'text-ink-subtle')}>{selected?.name ?? 'Choose a person'}</span>
        <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-ink-subtle" />
      </button>
      {description && <p id={`${ids}-description`} className="mt-1.5 text-caption text-ink-muted">{description}</p>}

      <Sheet open={open} onClose={close} title={label} fullHeight initialFocus="input[type='search']">
        <div className="relative">
          <label htmlFor={`${ids}-search`} className="sr-only">{placeholder}</label>
          <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-subtle" />
          <input
            id={`${ids}-search`}
            type="search"
            enterKeyHint="search"
            autoComplete="off"
            spellCheck={false}
            placeholder={placeholder}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="block min-h-11 w-full rounded-control border border-line-strong bg-surface pl-9 pr-3 text-body text-ink placeholder:text-ink-subtle focus:border-primary"
          />
        </div>
        <p aria-live="polite" className="sr-only">{query ? `${sections[0].people.length} ${sections[0].people.length === 1 ? 'person' : 'people'} found` : ''}</p>
        {sections.every(section => section.people.length === 0) && <p className="py-6 text-center text-body-sm text-ink-muted">Nobody matches “{query}”.</p>}
        {sections.map(section => section.people.length > 0 && (
          <section key={section.title ?? 'all'} aria-label={section.title ?? 'People'} className="mt-3">
            {section.title && <h3 className="px-1 pb-1 text-caption font-semibold text-ink-subtle">{section.title}</h3>}
            <ul className="-mx-2">
              {section.people.map(person => (
                <li key={person.id}>
                  <button
                    type="button"
                    aria-current={person.id === value || undefined}
                    onClick={() => { onChange(person); close() }}
                    className="flex min-h-14 w-full items-center gap-3 rounded-control px-2 text-left text-body hover:bg-surface-muted"
                  >
                    <PersonOption person={person} selected={person.id === value} />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </Sheet>
    </div>
  )
}
