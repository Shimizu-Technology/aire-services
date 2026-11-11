import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { CheckCircle2 } from 'lucide-react'
import { StatusPill, type StatusTone } from './StatusPill'

describe('StatusPill', () => {
  it.each<[StatusTone, string]>([
    ['waiting', 'bg-amber-50'],
    ['approved', 'bg-emerald-50'],
    ['needs-fix', 'bg-red-50'],
    ['info', 'bg-sky-50'],
    ['off', 'bg-slate-100'],
  ])('renders the %s tone with readable 12px text', (tone, background) => {
    render(<StatusPill tone={tone}>Waiting on approval</StatusPill>)
    const pill = screen.getByText('Waiting on approval').parentElement!
    expect(pill).toHaveAttribute('data-tone', tone)
    expect(pill).toHaveClass(background, 'text-caption')
  })

  it('keeps the dot or icon decorative so only the label is read', () => {
    const { container, rerender } = render(<StatusPill tone="approved">Approved</StatusPill>)
    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull()
    expect(container.textContent).toBe('Approved')
    rerender(<StatusPill tone="approved" icon={<CheckCircle2 />}>Approved</StatusPill>)
    expect(container.querySelector('svg')?.closest('[aria-hidden="true"]')).not.toBeNull()
  })
})
