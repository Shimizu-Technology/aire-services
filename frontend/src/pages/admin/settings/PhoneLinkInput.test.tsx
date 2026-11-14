import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { expect, it } from 'vitest'
import PhoneLinkInput, { formatPhoneLink } from './PhoneLinkInput'

function Harness({ start = '' }: { start?: string }) {
  const [value, setValue] = useState(start)
  return (
    <>
      <label htmlFor="phone">Link number</label>
      <PhoneLinkInput id="phone" value={value} onChange={setValue} />
      <output aria-label="saved value">{value}</output>
    </>
  )
}
const saved = () => screen.getByLabelText('saved value')

it('formats from the groups that exist, with no trailing space', () => {
  expect(formatPhoneLink('')).toBe('')
  expect(formatPhoneLink('+')).toBe('+')
  expect(formatPhoneLink('+1')).toBe('+1')
  expect(formatPhoneLink('+1671')).toBe('+1 671')
  expect(formatPhoneLink('+1671477')).toBe('+1 671 477')
  expect(formatPhoneLink('+16714774243')).toBe('+1 671 477 4243')
  expect(formatPhoneLink('+819012345678')).toBe('+819012345678')
})
it('saves +16714774243 from "+1 671 477 4243"', async () => {
  const user = userEvent.setup()
  render(<Harness />)
  await user.type(screen.getByLabelText('Link number'), '+1 671 477 4243')
  expect(screen.getByLabelText('Link number')).toHaveValue('+1 671 477 4243')
  expect(saved()).toHaveTextContent('+16714774243')
})
it('backspaces from the end all the way to empty', async () => {
  const user = userEvent.setup()
  render(<Harness start="+16714774243" />)
  const input = screen.getByLabelText('Link number')
  const shown: string[] = []
  await user.click(input)
  for (let step = 0; step < 12; step += 1) {
    await user.keyboard('{Backspace}')
    shown.push((input as HTMLInputElement).value)
  }
  expect(shown).toEqual([
    '+1 671 477 424',
    '+1 671 477 42',
    '+1 671 477 4',
    '+1 671 477',
    '+1 671 47',
    '+1 671 4',
    '+1 671',
    '+1 67',
    '+1 6',
    '+1',
    '+',
    '',
  ])
  expect(saved()).toHaveTextContent('')
})
it('edits in the middle and keeps typing where the caret was', async () => {
  const user = userEvent.setup()
  render(<Harness start="+16714774243" />)
  const input = screen.getByLabelText('Link number') as HTMLInputElement
  // Caret just after the first 4 of "477".
  await user.type(input, '{Backspace}', { initialSelectionStart: 8, initialSelectionEnd: 8 })
  expect(input).toHaveValue('+1 671 774 243')
  expect(input.selectionStart).toBe(6)
  await user.type(input, '9', { skipClick: true })
  expect(input).toHaveValue('+1 671 977 4243')
  expect(saved()).toHaveTextContent('+16719774243')
})
it('drops letters and spaces from what is saved', async () => {
  const user = userEvent.setup()
  render(<Harness />)
  await user.type(screen.getByLabelText('Link number'), '+1 (671) 477-4243 ext')
  expect(saved()).toHaveTextContent('+16714774243')
})
