import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { SegmentedControl } from './SegmentedControl'
import { TabChips } from './TabChips'

function Segmented() {
  const [value, setValue] = useState<'person' | 'day'>('person')
  return (
    <>
      <SegmentedControl label="Group shifts" controls="groups" value={value} onChange={setValue} options={[{ value: 'person', label: 'By person' }, { value: 'day', label: 'By day' }]} />
      <div id="groups">{value}</div>
    </>
  )
}

function Chips() {
  const [value, setValue] = useState<'time' | 'leave' | 'stubs'>('time')
  return (
    <TabChips
      label="What's waiting"
      value={value}
      onChange={setValue}
      items={[{ value: 'time', label: 'Time', count: 31 }, { value: 'leave', label: 'Leave', count: 5 }, { value: 'stubs', label: 'Pay stubs', count: 1 }]}
    />
  )
}

describe('SegmentedControl', () => {
  it('is a tablist with one tab stop; arrows move and pick', async () => {
    const user = userEvent.setup()
    render(<Segmented />)
    expect(screen.getByRole('tablist', { name: 'Group shifts' })).toBeInTheDocument()
    const person = screen.getByRole('tab', { name: 'By person' })
    const day = screen.getByRole('tab', { name: 'By day' })
    expect(person).toHaveAttribute('aria-selected', 'true')
    expect(person).toHaveAttribute('aria-controls', 'groups')
    expect(day).toHaveAttribute('tabindex', '-1')
    await user.tab()
    expect(person).toHaveFocus()
    await user.keyboard('{ArrowRight}')
    expect(day).toHaveFocus()
    expect(day).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('day', { selector: 'div' })).toBeInTheDocument()
    await user.keyboard('{ArrowRight}')
    expect(person).toHaveFocus()
    await user.keyboard('{End}')
    expect(day).toHaveAttribute('aria-selected', 'true')
    await user.click(person)
    expect(person).toHaveAttribute('aria-selected', 'true')
  })

  it('keeps 44px targets on touch', () => {
    render(<Segmented />)
    for (const tab of screen.getAllByRole('tab')) expect(tab).toHaveClass('min-h-11', 'pointer-fine:min-h-8')
  })
})

describe('TabChips', () => {
  it('names each chip with its count and switches like tabs', async () => {
    const user = userEvent.setup()
    render(<Chips />)
    expect(screen.getByRole('tablist', { name: "What's waiting" })).toBeInTheDocument()
    const time = screen.getByRole('tab', { name: 'Time 31' })
    expect(time).toHaveAttribute('aria-selected', 'true')
    await user.tab()
    await user.keyboard('{ArrowLeft}')
    expect(screen.getByRole('tab', { name: 'Pay stubs 1' })).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('{Home}')
    expect(time).toHaveFocus()
    await user.click(screen.getByRole('tab', { name: 'Leave 5' }))
    expect(screen.getByRole('tab', { name: 'Leave 5' })).toHaveAttribute('aria-selected', 'true')
    expect(time).toHaveAttribute('tabindex', '-1')
  })

  it('scrolls sideways without a scrollbar and keeps 44px targets on touch', () => {
    render(<Chips />)
    expect(screen.getByRole('tablist')).toHaveClass('overflow-x-auto', '[scrollbar-width:none]')
    for (const tab of screen.getAllByRole('tab')) expect(tab).toHaveClass('min-h-11', 'pointer-fine:min-h-9')
  })
})
