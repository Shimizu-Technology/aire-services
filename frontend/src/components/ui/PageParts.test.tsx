import '@testing-library/jest-dom'
import { render, screen, within } from '@testing-library/react'
import { Clock } from 'lucide-react'
import { describe, expect, it } from 'vitest'
import { AttentionItem } from './AttentionItem'
import { Button } from './Button'
import { ChecklistItem } from './ChecklistItem'
import { ProgressSplit } from './ProgressSplit'
import { StepList } from './StepList'

describe('AttentionItem', () => {
  it('is one list row: sentence, secondary line and one action', () => {
    render(
      <ul aria-label="Needs attention">
        <AttentionItem tone="bad" icon={<Clock />} meta="Since Tue, Nov 10, 7:02 AM · 36.7h" action={<Button size="sm">Fix clock-out</Button>}>
          <b>Caleb Perez</b> still clocked in
        </AttentionItem>
      </ul>,
    )
    const item = within(screen.getByRole('list', { name: 'Needs attention' })).getByRole('listitem')
    expect(item).toHaveTextContent('Caleb Perez still clocked in')
    expect(item).toHaveTextContent('Since Tue, Nov 10, 7:02 AM · 36.7h')
    expect(within(item).getByRole('button', { name: 'Fix clock-out' })).toHaveClass('min-h-11')
    expect(item.querySelector('svg')?.closest('[aria-hidden="true"]')).not.toBeNull()
  })
})

describe('ChecklistItem', () => {
  it('says each state in words, not only with the icon', () => {
    render(
      <ul aria-label="Before it locks">
        <ChecklistItem status="todo" meta="27 ordinary · 4 need a look">31 shifts waiting for approval</ChecklistItem>
        <ChecklistItem status="done">Every shift has a work category</ChecklistItem>
        <ChecklistItem status="info">3 shifts approved after the Oct 16–31 lock go into this payroll</ChecklistItem>
      </ul>,
    )
    const [todo, done, info] = screen.getAllByRole('listitem')
    expect(todo).toHaveTextContent('To do: 31 shifts waiting for approval')
    expect(done).toHaveTextContent('Done: Every shift has a work category')
    expect(info).toHaveTextContent('Note: 3 shifts approved')
  })
})

describe('StepList', () => {
  const steps = [
    { id: 'open', label: 'Open' },
    { id: 'locked', label: 'Locked' },
    { id: 'received', label: 'Received by Payroll' },
    { id: 'run', label: 'In a payroll run' },
    { id: 'paid', label: 'Paid' },
  ]

  it('is one ordered list with the current step marked', () => {
    render(<StepList label="Hand-off to Cornerstone Payroll" steps={steps} current="received" />)
    const list = screen.getByRole('list', { name: 'Hand-off to Cornerstone Payroll' })
    expect(list.tagName).toBe('OL')
    const items = within(list).getAllByRole('listitem')
    expect(items).toHaveLength(5)
    expect(items[2]).toHaveAttribute('aria-current', 'step')
    expect(items.map(item => item.textContent)).toEqual(['Done: Open', 'Done: Locked', 'Now: Received by Payroll', 'Not yet: In a payroll run', 'Not yet: Paid'])
  })

  it('reads every step as done once complete', () => {
    render(<StepList label="Hand-off" steps={steps} current="paid" complete />)
    const items = screen.getAllByRole('listitem')
    expect(items.every(item => item.textContent?.startsWith('Done:'))).toBe(true)
    expect(items.some(item => item.hasAttribute('aria-current'))).toBe(false)
  })
})

describe('ProgressSplit', () => {
  it('is one image named with both numbers, sized by share', () => {
    render(<ProgressSplit parts={[{ label: 'approved', value: 1005, tone: 'approved' }, { label: 'waiting (31 shifts)', value: 276, tone: 'waiting' }]} />)
    const bar = screen.getByRole('img', { name: '1,005h approved, 276h waiting (31 shifts)' })
    const [approved, waiting] = Array.from(bar.children) as HTMLElement[]
    expect(approved.style.width).toBe(`${(1005 / 1281) * 100}%`)
    expect(waiting.style.width).toBe(`${(276 / 1281) * 100}%`)
  })

  it('draws an empty track when there are no hours', () => {
    render(<ProgressSplit parts={[{ label: 'approved', value: 0, tone: 'approved' }, { label: 'waiting', value: 0, tone: 'waiting' }]} />)
    expect(screen.getByRole('img', { name: '0h approved, 0h waiting' }).children).toHaveLength(0)
  })
})
