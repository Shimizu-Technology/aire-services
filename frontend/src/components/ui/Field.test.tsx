import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { Field, Input, Select, Textarea } from './Field'
import { HelpTip } from './HelpTip'

describe('Field', () => {
  it('ties a real label, help and error text to the input', () => {
    render(
      <Field label="Email" help="We send the invite here." error="Enter an email address." required>
        <Input type="email" />
      </Field>,
    )
    const input = screen.getByLabelText(/Email/)
    expect(input.tagName).toBe('INPUT')
    expect(input).toBeRequired()
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).toHaveAccessibleDescription('Enter an email address. We send the invite here.')
  })

  it('works for selects and textareas and merges an existing description', () => {
    render(
      <>
        <span id="extra">Shown on the stub.</span>
        <Field label="Department"><Select aria-describedby="extra"><option>CFI</option></Select></Field>
        <Field label="Reason" help="Required when the entry was already sent to payroll."><Textarea /></Field>
      </>,
    )
    expect(screen.getByRole('combobox', { name: 'Department' })).toHaveAccessibleDescription('Shown on the stub.')
    expect(screen.getByRole('combobox', { name: 'Department' })).not.toHaveAttribute('aria-invalid')
    expect(screen.getByRole('textbox', { name: 'Reason' })).toHaveAccessibleDescription('Required when the entry was already sent to payroll.')
  })

  it('uses 16px text on touch (so iOS does not zoom) and a 44px height', () => {
    render(<Field label="Name"><Input /></Field>)
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveClass('text-body', 'pointer-fine:text-body-sm', 'min-h-11')
  })

  it('keeps a visually hidden label as the accessible name, and a help tip outside the label', async () => {
    const user = userEvent.setup()
    render(
      <Field label="Search team" labelHidden labelAction={<HelpTip label="Search">Matches names and emails.</HelpTip>}>
        <Input />
      </Field>,
    )
    const input = screen.getByRole('textbox', { name: 'Search team' })
    await user.click(screen.getByRole('button', { name: 'About Search' }))
    expect(input).not.toHaveFocus()
    expect(screen.getByText('Search team')).toHaveClass('sr-only')
  })

  it('honours an explicit id', () => {
    render(<Field label="PIN" id="kiosk-pin"><Input inputMode="numeric" /></Field>)
    expect(screen.getByLabelText('PIN')).toHaveAttribute('id', 'kiosk-pin')
  })
})
