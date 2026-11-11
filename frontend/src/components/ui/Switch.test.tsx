import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import MyPaySwitch from '../team/MyPaySwitch'
import { Switch } from './Switch'

function Setting() {
  const [on, setOn] = useState(false)
  return <Switch checked={on} onChange={setOn} label="Use schedules" description="Show a Schedule tab and shift times." />
}

describe('Switch', () => {
  it('is a labelled switch that flips from the switch, its label and the keyboard', async () => {
    const user = userEvent.setup()
    render(<Setting />)
    const control = screen.getByRole('switch', { name: 'Use schedules' })
    expect(control).toHaveAccessibleDescription('Show a Schedule tab and shift times.')
    expect(control).toHaveAttribute('aria-checked', 'false')
    await user.click(control)
    expect(control).toHaveAttribute('aria-checked', 'true')
    await user.click(screen.getByText('Use schedules'))
    expect(control).toHaveAttribute('aria-checked', 'false')
    control.focus()
    await user.keyboard(' ')
    expect(control).toHaveAttribute('aria-checked', 'true')
  })

  it('blocks taps while busy or disabled, with a 44px target', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const { rerender } = render(<Switch checked label="My Pay" hideLabel busy onChange={onChange} />)
    const control = screen.getByRole('switch', { name: 'My Pay' })
    expect(control).toHaveAttribute('aria-busy', 'true')
    expect(control).toHaveClass('min-h-11', 'min-w-11')
    await user.click(control)
    rerender(<Switch checked label="My Pay" hideLabel disabled onChange={onChange} />)
    await user.click(control)
    expect(onChange).not.toHaveBeenCalled()
  })

  it("is what the Team list's My Pay switch uses, in navy", async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<MyPaySwitch checked={false} onChange={onChange} label="My Pay for Ethan Cruz" />)
    const control = screen.getByRole('switch', { name: 'My Pay for Ethan Cruz' })
    await user.click(control)
    expect(onChange).toHaveBeenCalledWith(true)
    expect(control.innerHTML).not.toContain('cyan')
  })
})
