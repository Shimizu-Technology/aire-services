import '@testing-library/jest-dom'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { DataList, type DataListColumn } from './DataList'

interface Person { id: number; name: string; role: string; hours: number }
const people: Person[] = [
  { id: 1, name: 'Ethan Cruz', role: 'Employee', hours: 40 },
  { id: 2, name: 'Grace Torres', role: 'Manager', hours: 38.5 },
]
const columns: DataListColumn<Person>[] = [
  { id: 'role', header: 'Role', cell: person => person.role },
  { id: 'name', header: 'Name', cell: person => person.name, primary: true },
  { id: 'hours', header: 'Hours', cell: person => `${person.hours}h`, align: 'right' },
  { id: 'action', header: 'Action', cell: person => <button type="button" onClick={() => actions(person.id)}>Reset PIN</button>, hideOnMobile: true },
]
const actions = vi.fn()

describe('DataList', () => {
  it('renders a captioned table for desktop with the primary column first as row headers', () => {
    render(<DataList rows={people} columns={columns} getRowKey={person => person.id} label="Team members" />)
    const table = screen.getByRole('table', { name: 'Team members' })
    expect(table.parentElement).toHaveClass('hidden', 'lg:block', 'overflow-x-auto')
    const headers = within(table).getAllByRole('columnheader').map(header => header.textContent)
    expect(headers).toEqual(['Name', 'Role', 'Hours', 'Action'])
    expect(within(table).getByRole('rowheader', { name: 'Ethan Cruz' })).toHaveClass('sticky', 'left-0')
  })

  it('renders phone cards with labelled values and leaves out hidden columns', () => {
    render(<DataList rows={people} columns={columns} getRowKey={person => person.id} label="Team members" />)
    const list = screen.getByRole('list', { name: 'Team members' })
    expect(list).toHaveClass('lg:hidden')
    const card = within(list).getAllByRole('listitem')[1]
    expect(within(card).getByText('Grace Torres')).toBeInTheDocument()
    expect(within(card).getByText('Role').tagName).toBe('DT')
    expect(within(card).getByText('38.5h').tagName).toBe('DD')
    expect(within(card).queryByRole('button', { name: 'Reset PIN' })).not.toBeInTheDocument()
  })

  it('opens a row from the keyboard, a click anywhere on it, but not from controls inside it', async () => {
    const user = userEvent.setup()
    const onRowClick = vi.fn()
    actions.mockClear()
    render(<DataList rows={people} columns={columns} getRowKey={person => person.id} label="Team" onRowClick={onRowClick} rowActionLabel={person => `Open ${person.name}`} />)
    const table = screen.getByRole('table')
    const open = within(table).getByRole('button', { name: 'Open Ethan Cruz' })
    open.focus()
    await user.keyboard('{Enter}')
    expect(onRowClick).toHaveBeenLastCalledWith(people[0])

    await user.click(within(table).getByText('38.5h'))
    expect(onRowClick).toHaveBeenLastCalledWith(people[1])
    expect(onRowClick).toHaveBeenCalledTimes(2)

    await user.click(within(table).getAllByRole('button', { name: 'Reset PIN' })[0])
    expect(actions).toHaveBeenCalledWith(1)
    expect(onRowClick).toHaveBeenCalledTimes(2)

    const card = within(screen.getByRole('list')).getByRole('button', { name: 'Open Grace Torres' })
    expect(card).toHaveClass('min-h-11', 'w-full')
  })

  it('shows the empty state instead of an empty table', () => {
    render(<DataList rows={[]} columns={columns} getRowKey={person => person.id} label="Team" empty="No one matches. Clear the filters to see everyone." />)
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.getByText('No one matches. Clear the filters to see everyone.')).toBeInTheDocument()
  })
})
