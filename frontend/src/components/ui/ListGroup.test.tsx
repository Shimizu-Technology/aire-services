import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { ListGroup } from './ListGroup'
import { ListRow } from './ListRow'
import { Menu } from './Menu'

const PEOPLE = [
  { id: 'marcus', name: 'Marcus Quinata', shifts: ['Tue, Nov 10', 'Wed, Nov 11'] },
  { id: 'grace', name: 'Grace Torres', shifts: ['Tue, Nov 10'] },
]

function Groups({ onApprove = vi.fn(), onOpen }: { onApprove?: (id: string) => void; onOpen?: (id: string) => void }) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const toggle = (set: Set<string>, keys: string[], on: boolean) => {
    const next = new Set(set)
    keys.forEach(key => (on ? next.add(key) : next.delete(key)))
    return next
  }
  return (
    <>
      <input aria-label="Search" />
      <ListGroup label="Ordinary shifts by person">
        {PEOPLE.map(person => {
          const keys = person.shifts.map(shift => `${person.id}:${shift}`)
          const count = keys.filter(key => selected.has(key)).length
          return (
            <ListRow
              key={person.id}
              title={person.name}
              meta={`${person.shifts.length} shifts`}
              checkbox={{ checked: count === 0 ? false : count === keys.length ? true : 'mixed', onChange: on => setSelected(set => toggle(set, keys, on)), label: `Select ${person.name}'s shifts` }}
              action={{ label: `Approve ${keys.length}`, onClick: () => onApprove(person.id) }}
              onOpen={onOpen ? () => onOpen(person.id) : undefined}
              expanded={expanded.has(person.id)}
              onExpandedChange={on => setExpanded(set => toggle(set, [person.id], on))}
              expandLabel={`Show ${person.name}'s shifts`}
            >
              {person.shifts.map((shift, index) => (
                <ListRow
                  key={shift}
                  title={shift}
                  checkbox={{ checked: selected.has(keys[index]), onChange: on => setSelected(set => toggle(set, [keys[index]], on)), label: `Select ${shift}` }}
                />
              ))}
            </ListRow>
          )
        })}
      </ListGroup>
    </>
  )
}

const rows = () => Array.from(document.querySelectorAll<HTMLElement>('[data-list-row]'))
const tabbable = () => rows().filter(row => row.tabIndex === 0)

describe('ListGroup and ListRow', () => {
  it('is a labelled list whose rows are named groups', () => {
    render(<Groups />)
    const list = screen.getByRole('list', { name: 'Ordinary shifts by person' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(2)
    expect(screen.getByRole('group', { name: 'Marcus Quinata' })).toHaveAccessibleDescription('2 shifts')
  })

  it('has one tab stop that moves with arrow keys and j/k', async () => {
    const user = userEvent.setup()
    render(<Groups />)
    expect(tabbable()).toHaveLength(1)
    const [marcus, grace] = rows()
    expect(marcus.tabIndex).toBe(0)

    await user.click(screen.getByRole('textbox', { name: 'Search' }))
    await user.tab()
    expect(marcus).toHaveFocus()
    await user.keyboard('{ArrowDown}')
    expect(grace).toHaveFocus()
    expect(tabbable()).toEqual([grace])
    await user.keyboard('k')
    expect(marcus).toHaveFocus()
    await user.keyboard('j')
    expect(grace).toHaveFocus()
    await user.keyboard('{Home}')
    expect(marcus).toHaveFocus()
    await user.keyboard('{End}')
    expect(grace).toHaveFocus()
  })

  it("lets Tab reach only the focused row's own controls", async () => {
    const user = userEvent.setup()
    render(<Groups />)
    const [marcus] = rows()
    marcus.focus()
    await user.tab()
    expect(screen.getByRole('checkbox', { name: "Select Marcus Quinata's shifts" })).toHaveFocus()
    await user.tab()
    expect(screen.getByRole('button', { name: 'Approve 2' })).toHaveFocus()
    await user.tab()
    expect(screen.getByRole('button', { name: "Show Marcus Quinata's shifts" })).toHaveFocus()
    expect(screen.getByRole('checkbox', { name: "Select Grace Torres's shifts" })).toHaveAttribute('tabindex', '-1')
    expect(screen.getByRole('button', { name: 'Approve 1' })).toHaveAttribute('tabindex', '-1')
  })

  it('toggles the focused row with Space, including the mixed group state', async () => {
    const user = userEvent.setup()
    render(<Groups />)
    rows()[0].focus()
    await user.keyboard(' ')
    const group = screen.getByRole('checkbox', { name: "Select Marcus Quinata's shifts" })
    expect(group).toBeChecked()

    await user.keyboard('{ArrowRight}')
    const first = await screen.findByRole('checkbox', { name: 'Select Tue, Nov 10' })
    expect(first).toBeChecked()
    await user.keyboard('{ArrowDown}')
    await user.keyboard(' ')
    expect(first).not.toBeChecked()
    expect(group).toHaveAttribute('aria-checked', 'mixed')
  })

  it('expands a group with Enter and walks into its rows', async () => {
    const user = userEvent.setup()
    render(<Groups />)
    const expand = screen.getByRole('button', { name: "Show Marcus Quinata's shifts" })
    expect(expand).toHaveAttribute('aria-expanded', 'false')
    rows()[0].focus()
    await user.keyboard('{Enter}')
    expect(expand).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('list', { name: 'Marcus Quinata' })).toBeInTheDocument()
    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('group', { name: 'Tue, Nov 10' })).toHaveFocus()
    await waitFor(() => expect(tabbable()).toEqual([screen.getByRole('group', { name: 'Tue, Nov 10' })]))
    await user.keyboard('{ArrowUp}{ArrowLeft}')
    expect(expand).toHaveAttribute('aria-expanded', 'false')
  })

  it('opens the row with Enter when it has onOpen', async () => {
    const user = userEvent.setup()
    const onOpen = vi.fn()
    render(<Groups onOpen={onOpen} />)
    rows()[1].focus()
    await user.keyboard('{Enter}')
    expect(onOpen).toHaveBeenCalledWith('grace')
    fireEvent.click(screen.getByRole('group', { name: 'Marcus Quinata' }))
    expect(onOpen).toHaveBeenLastCalledWith('marcus')
  })

  it("leaves a row's buttons and text fields to handle their own keys", async () => {
    const user = userEvent.setup()
    const onApprove = vi.fn()
    render(<Groups onApprove={onApprove} />)
    rows()[0].focus()
    await user.tab()
    await user.tab()
    await user.keyboard('{Enter}')
    expect(onApprove).toHaveBeenCalledWith('marcus')
    expect(screen.getByRole('button', { name: "Show Marcus Quinata's shifts" })).toHaveAttribute('aria-expanded', 'false')
  })

  it('hands the tab stop to the first row when the active row goes away', () => {
    const { rerender } = render(
      <ListGroup label="Rows">
        <ListRow key="a" title="A" />
        <ListRow key="b" title="B" />
      </ListGroup>,
    )
    rows()[1].focus()
    fireEvent.focus(rows()[1])
    expect(tabbable().map(row => row.textContent)).toEqual(['B'])
    rerender(<ListGroup label="Rows"><ListRow key="a" title="A" /></ListGroup>)
    expect(tabbable().map(row => row.textContent)).toEqual(['A'])
  })

  it('moves focus to the next row when the focused row is removed, or the previous one at the end', async () => {
    function Approvable() {
      const [people, setPeople] = useState(['Marcus', 'Grace', 'Ethan'])
      return (
        <ListGroup label="Rows">
          {people.map(name => (
            <ListRow key={name} title={name} action={{ label: `Approve ${name}`, onClick: () => setPeople(list => list.filter(other => other !== name)) }} />
          ))}
        </ListGroup>
      )
    }
    const user = userEvent.setup()
    render(<Approvable />)
    rows()[0].focus()
    await user.tab()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(screen.getByRole('group', { name: 'Grace' })).toHaveFocus())
    expect(tabbable().map(row => row.textContent)).toEqual(['GraceApprove Grace'])

    await user.keyboard('{End}')
    expect(screen.getByRole('group', { name: 'Ethan' })).toHaveFocus()
    await user.tab()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(screen.getByRole('group', { name: 'Grace' })).toHaveFocus())
  })

  it('leaves focus alone when a row goes away after focus left the list', async () => {
    const { rerender } = render(
      <>
        <button type="button">Elsewhere</button>
        <ListGroup label="Rows"><ListRow key="a" title="A" /><ListRow key="b" title="B" /></ListGroup>
      </>,
    )
    const user = userEvent.setup()
    rows()[0].focus()
    await user.click(screen.getByRole('button', { name: 'Elsewhere' }))
    rerender(
      <>
        <button type="button">Elsewhere</button>
        <ListGroup label="Rows"><ListRow key="b" title="B" /></ListGroup>
      </>,
    )
    expect(screen.getByRole('button', { name: 'Elsewhere' })).toHaveFocus()
  })

  it('puts buttons in trailing, like a ⋯ Menu, in the roving model', async () => {
    const user = userEvent.setup()
    render(
      <ListGroup label="People">
        {['Marcus', 'Grace'].map(name => (
          <ListRow key={name} title={name} trailing={<Menu label={`More actions for ${name}`} items={[{ id: 'stub', label: 'Send stub', onSelect: vi.fn() }]} />} />
        ))}
      </ListGroup>,
    )
    expect(screen.getByRole('button', { name: 'More actions for Marcus' })).toHaveAttribute('tabindex', '0')
    expect(screen.getByRole('button', { name: 'More actions for Grace' })).toHaveAttribute('tabindex', '-1')
    rows()[0].focus()
    await user.tab()
    expect(screen.getByRole('button', { name: 'More actions for Marcus' })).toHaveFocus()
    await user.tab()
    expect(document.body).toHaveFocus()
  })

  it('is 56px tall on touch and 48px with a mouse', () => {
    render(<ListGroup label="Rows"><ListRow title="A" /></ListGroup>)
    expect(rows()[0]).toHaveClass('min-h-14', 'pointer-fine:min-h-12')
  })
})
