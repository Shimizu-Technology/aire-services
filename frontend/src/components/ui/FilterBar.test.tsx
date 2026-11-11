import '@testing-library/jest-dom'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { FilterBar, FilterChip } from './FilterBar'

function Harness({ onClear = vi.fn() }: { onClear?: () => void }) {
  const [query, setQuery] = useState('')
  const [overtime, setOvertime] = useState(false)
  return (
    <FilterBar
      search={{ value: query, onChange: setQuery, label: 'Search approvals', placeholder: 'Name or note' }}
      moreFilters={<label>Employee <select><option>Everyone</option></select></label>}
      activeFilterCount={2}
      onClear={onClear}
      resultSummary={`${query ? 1 : 71} waiting`}
    >
      <FilterChip selected={overtime} onClick={() => setOvertime(value => !value)} count={16}>Overtime</FilterChip>
    </FilterBar>
  )
}

describe('FilterBar', () => {
  it('labels the search field and reports results politely', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    expect(screen.getByRole('search')).toBeInTheDocument()
    const search = screen.getByRole('searchbox', { name: 'Search approvals' })
    expect(search).toHaveAttribute('enterkeyhint', 'search')
    expect(search).toHaveClass('text-body', 'pointer-fine:text-body-sm', 'min-h-11')
    await user.type(search, 'Ethan')
    expect(search).toHaveValue('Ethan')
    expect(screen.getByText('1 waiting')).toHaveAttribute('aria-live', 'polite')
  })

  it('toggles chips as pressed buttons', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const chip = screen.getByRole('button', { name: 'Overtime 16' })
    expect(chip).toHaveAttribute('aria-pressed', 'false')
    await user.click(chip)
    expect(chip).toHaveAttribute('aria-pressed', 'true')
  })

  it('opens the rest of the filters in a sheet with a count', async () => {
    const user = userEvent.setup()
    const onClear = vi.fn()
    render(<Harness onClear={onClear} />)
    const filters = screen.getByRole('button', { name: 'Filters, 2 set' })
    expect(filters).toHaveAttribute('aria-haspopup', 'dialog')
    await user.click(filters)
    const sheet = screen.getByRole('dialog', { name: 'Filters' })
    expect(within(sheet).getByRole('combobox', { name: 'Employee' })).toBeInTheDocument()
    await user.click(within(sheet).getByRole('button', { name: 'Clear all' }))
    expect(onClear).toHaveBeenCalledOnce()
    await user.click(within(sheet).getByRole('button', { name: 'Done' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(filters).toHaveFocus()
  })

  it('offers Clear only when something is set', () => {
    const { rerender } = render(<FilterBar onClear={vi.fn()} activeFilterCount={0} search={{ value: '', onChange: vi.fn(), label: 'Search' }} />)
    expect(screen.queryByRole('button', { name: 'Clear' })).not.toBeInTheDocument()
    rerender(<FilterBar onClear={vi.fn()} activeFilterCount={0} search={{ value: 'a', onChange: vi.fn(), label: 'Search' }} />)
    expect(screen.getByRole('button', { name: 'Clear' })).toBeInTheDocument()
  })
})
