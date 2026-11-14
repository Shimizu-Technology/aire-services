import { useLayoutEffect, useRef } from 'react'

// "+16714774243" shown as "+1 671 477 4243". The display is built from the
// groups that exist, with no trailing space, so backspace always removes a
// character. Other country codes are shown as typed.
// eslint-disable-next-line react-refresh/only-export-components
export function formatPhoneLink(value: string) {
  const match = /^\+1(\d{0,10})$/.exec(value)
  if (!match) return value
  const digits = match[1]
  return ['+1', digits.slice(0, 3), digits.slice(3, 6), digits.slice(6)].filter(Boolean).join(' ')
}

const keep = (text: string) => text.replace(/[^+\d]/g, '')

// Where the caret belongs once `count` plus signs and digits sit before it.
function caretAfter(display: string, count: number) {
  if (count <= 0) return 0
  let seen = 0
  for (let index = 0; index < display.length; index += 1) {
    if (/[+\d]/.test(display[index])) seen += 1
    if (seen === count) return index + 1
  }
  return display.length
}

export default function PhoneLinkInput({
  id,
  value,
  onChange,
  className,
}: {
  id: string
  value: string
  onChange: (value: string) => void
  className?: string
}) {
  const input = useRef<HTMLInputElement>(null)
  const caret = useRef<number | null>(null)
  const display = formatPhoneLink(value)
  useLayoutEffect(() => {
    if (caret.current === null || !input.current) return
    const position = caretAfter(display, caret.current)
    caret.current = null
    input.current.setSelectionRange(position, position)
  })
  return (
    <input
      id={id}
      ref={input}
      type="tel"
      value={display}
      placeholder="+1 671 477 4243"
      className={className}
      onChange={(event) => {
        const { value: typed, selectionStart } = event.target
        caret.current = keep(typed.slice(0, selectionStart ?? typed.length)).length
        onChange(keep(typed))
      }}
    />
  )
}
