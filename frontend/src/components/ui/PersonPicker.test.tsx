import '@testing-library/jest-dom'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mockMatchMedia } from '../../test/matchMedia'
import { PersonPicker, type PickerPerson } from './PersonPicker'
import { Sheet } from './Sheet'

const PEOPLE: PickerPerson[] = [
  { id: 1, name: 'Marcus Quinata', meta: 'CFI · Employee' },
  { id: 2, name: 'Caleb Perez', meta: 'CFI · Employee' },
  { id: 3, name: 'Tåsi Leon Guerrero-Santos', meta: 'Ops/Maint · Employee' },
  { id: 4, name: 'Grace Torres', meta: 'Ops/Maint · Employee' },
]

function Picker({ onChange = vi.fn() }: { onChange?: (person: PickerPerson) => void }) {
  const [value, setValue] = useState<PickerPerson['id'] | null>(null)
  return (
    <PersonPicker
      label="Who worked"
      people={PEOPLE}
      value={value}
      recentIds={[2]}
      description="Always required."
      onChange={person => { setValue(person.id); onChange(person) }}
    />
  )
}

let restore = () => undefined as void
afterEach(() => restore())

describe('PersonPicker on desktop', () => {
  it('is a combobox: type to filter, arrows to move, Enter to pick', async () => {
    restore = mockMatchMedia({ width: 1280 })
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Picker onChange={onChange} />)
    const input = screen.getByRole('combobox', { name: 'Who worked' })
    expect(input).toHaveAccessibleDescription('Always required.')
    expect(input).toHaveAttribute('aria-expanded', 'false')

    await user.click(input)
    expect(input).toHaveAttribute('aria-expanded', 'true')
    const listbox = screen.getByRole('listbox', { name: 'Who worked' })
    // Recent first, then everyone else alphabetically.
    const options = within(listbox).getAllByRole('option')
    expect(options.map(option => option.querySelector('.font-medium')?.textContent)).toEqual(['Caleb Perez', 'Grace Torres', 'Marcus Quinata', 'Tåsi Leon Guerrero-Santos'])
    expect(options[0]).toHaveAccessibleName('Caleb Perez CFI · Employee')
    expect(within(listbox).getByRole('group', { name: 'Recent' })).toBeInTheDocument()

    await user.type(input, 'tasi')
    expect(within(listbox).getAllByRole('option')).toHaveLength(1)
    await user.clear(input)
    await user.type(input, 'ops')
    expect(within(listbox).getAllByRole('option')).toHaveLength(2)
    await user.keyboard('{ArrowDown}')
    expect(input.getAttribute('aria-activedescendant')).toBe(within(listbox).getAllByRole('option')[1].id)
    await user.keyboard('{Enter}')
    expect(onChange).toHaveBeenCalledWith(PEOPLE[2])
    expect(input).toHaveValue('Tåsi Leon Guerrero-Santos')
    expect(input).toHaveAttribute('aria-expanded', 'false')
  })

  it('closes on Escape and keeps the chosen person', async () => {
    restore = mockMatchMedia({ width: 1280 })
    const user = userEvent.setup()
    render(<Picker />)
    const input = screen.getByRole('combobox')
    await user.click(input)
    await user.click(screen.getByRole('option', { name: /Marcus Quinata/ }))
    expect(input).toHaveValue('Marcus Quinata')
    await user.type(input, 'zzz')
    expect(screen.getByText('Nobody matches “Marcus Quinatazzz”.')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(input).toHaveAttribute('aria-expanded', 'false')
    expect(input).toHaveValue('Marcus Quinata')
  })
})

describe('PersonPicker inside a Sheet on desktop', () => {
  function InSheet({ onClose = vi.fn() }: { onClose?: () => void }) {
    const [value, setValue] = useState<PickerPerson['id'] | null>(null)
    return (
      <Sheet open onClose={onClose} title="Add a shift">
        <PersonPicker label="Who worked" people={[...PEOPLE, { id: 5, name: 'Ana O’Brien' }]} value={value} onChange={person => setValue(person.id)} />
      </Sheet>
    )
  }

  it('portals the list out of the sheet so its scrolling body cannot clip it', async () => {
    restore = mockMatchMedia({ width: 1280 })
    const user = userEvent.setup()
    render(<InSheet />)
    await user.click(screen.getByRole('combobox', { name: 'Who worked' }))
    const listbox = screen.getByRole('listbox', { name: 'Who worked' })
    expect(screen.getByRole('dialog', { name: 'Add a shift' })).not.toContainElement(listbox)
    expect(listbox.parentElement).toBe(document.body)
    expect(listbox).toHaveClass('fixed', 'z-(--z-popover)')
  })

  it('closes the list on Escape first, then the sheet', async () => {
    restore = mockMatchMedia({ width: 1280 })
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<InSheet onClose={onClose} />)
    const input = screen.getByRole('combobox', { name: 'Who worked' })
    await user.click(input)
    expect(input).toHaveAttribute('aria-expanded', 'true')
    await user.keyboard('{Escape}')
    expect(input).toHaveAttribute('aria-expanded', 'false')
    expect(onClose).not.toHaveBeenCalled()
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('stays open when the list padding or scrollbar is pressed', async () => {
    restore = mockMatchMedia({ width: 1280 })
    const user = userEvent.setup()
    render(<InSheet />)
    const input = screen.getByRole('combobox', { name: 'Who worked' })
    await user.click(input)
    expect(fireEvent.mouseDown(screen.getByRole('listbox'))).toBe(false)
  })

  it('ignores apostrophes, so "obrien" finds O’Brien', async () => {
    restore = mockMatchMedia({ width: 1280 })
    const user = userEvent.setup()
    render(<InSheet />)
    const input = screen.getByRole('combobox', { name: 'Who worked' })
    await user.type(input, "o'brien")
    expect(within(screen.getByRole('listbox')).getAllByRole('option').map(option => option.textContent)).toEqual(['AOAna O’Brien'])
    await user.clear(input)
    await user.type(input, 'obrien')
    expect(within(screen.getByRole('listbox')).getAllByRole('option')).toHaveLength(1)
  })
})

describe('PersonPicker on phones', () => {
  it('opens a full-height sheet with search and recent people first', async () => {
    restore = mockMatchMedia({ width: 390 })
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Picker onChange={onChange} />)
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    const trigger = screen.getByRole('button', { name: 'Who worked Choose a person' })
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog')
    expect(trigger).toHaveClass('min-h-11')

    await user.click(trigger)
    const sheet = screen.getByRole('dialog', { name: 'Who worked' })
    expect(sheet.className).toContain('h-[calc(100dvh')
    const search = within(sheet).getByRole('searchbox', { name: 'Find a person' })
    expect(search).toHaveFocus()
    expect(within(within(sheet).getByRole('region', { name: 'Recent' })).getByRole('button')).toHaveTextContent('Caleb Perez')

    await user.type(search, 'grace')
    expect(within(sheet).getByText('1 person found')).toBeInTheDocument()
    const grace = within(sheet).getByRole('button', { name: /Grace Torres/ })
    expect(grace).toHaveClass('min-h-14')
    await user.click(grace)
    expect(onChange).toHaveBeenCalledWith(PEOPLE[3])
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Who worked Grace Torres' })).toHaveFocus()
  })
})
