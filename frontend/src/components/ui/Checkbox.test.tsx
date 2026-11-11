import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { Checkbox, type CheckedState } from './Checkbox'

describe('Checkbox', () => {
  it('is a real, labelled checkbox', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Checkbox checked={false} onChange={onChange} label="Include overtime" description="Only when approved" />)
    const box = screen.getByRole('checkbox', { name: 'Include overtime' })
    expect(box).toHaveAttribute('type', 'checkbox')
    expect(box).toHaveAccessibleDescription('Only when approved')
    expect(box).not.toBeChecked()
    await user.click(screen.getByText('Include overtime'))
    expect(onChange).toHaveBeenCalledWith(true)
  })

  it('shows the mixed state as aria-checked="mixed" and indeterminate', () => {
    const { rerender } = render(<Checkbox checked="mixed" onChange={vi.fn()} label="Select Marcus Quinata's 2 shifts" hideLabel />)
    const box = screen.getByRole('checkbox', { name: "Select Marcus Quinata's 2 shifts" }) as HTMLInputElement
    expect(box).toHaveAttribute('aria-checked', 'mixed')
    expect(box.indeterminate).toBe(true)
    expect(box).toBePartiallyChecked()

    rerender(<Checkbox checked onChange={vi.fn()} label="Select Marcus Quinata's 2 shifts" hideLabel />)
    expect(box).not.toHaveAttribute('aria-checked')
    expect(box.indeterminate).toBe(false)
    expect(box).toBeChecked()
  })

  it('goes from mixed to checked to unchecked from the keyboard', async () => {
    const user = userEvent.setup()
    const seen: CheckedState[] = []
    function Harness() {
      const [checked, setChecked] = useState<CheckedState>('mixed')
      seen.push(checked)
      return <Checkbox checked={checked} onChange={setChecked} label="Group" />
    }
    render(<Harness />)
    await user.tab()
    expect(screen.getByRole('checkbox', { name: 'Group' })).toHaveFocus()
    await user.keyboard(' ')
    expect(screen.getByRole('checkbox')).toBeChecked()
    await user.keyboard(' ')
    expect(screen.getByRole('checkbox')).not.toBeChecked()
    expect(seen.at(-1)).toBe(false)
  })

  it('has a 44px hit area around the 22px box', () => {
    render(<Checkbox checked={false} onChange={vi.fn()} label="Select" hideLabel />)
    const box = screen.getByRole('checkbox')
    expect(box).toHaveClass('size-11', '-inset-[11px]')
    expect(box.nextElementSibling).toHaveClass('size-[22px]')
  })

  it('does nothing when disabled', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Checkbox checked={false} onChange={onChange} label="Select" disabled />)
    await user.click(screen.getByRole('checkbox'))
    expect(onChange).not.toHaveBeenCalled()
  })
})
