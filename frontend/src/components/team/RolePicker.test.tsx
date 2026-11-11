import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import RolePicker from './RolePicker'

describe('RolePicker', () => {
  it('links to what each role can do in a new tab, so the form is kept', () => {
    render(<RolePicker value="employee" options={['manager', 'employee']} onChange={vi.fn()} />, { wrapper: MemoryRouter })
    const link = screen.getByRole('link', { name: 'See what each role can do (opens in a new tab)' })
    expect(link).toHaveAttribute('href', '/admin/settings/roles')
    expect(link).toHaveAttribute('target', '_blank')
  })

  it('keeps the link when the role is locked', () => {
    render(<RolePicker value="owner" options={[]} lockedReason="Only an owner can change an owner’s or admin’s role." onChange={vi.fn()} />, { wrapper: MemoryRouter })
    expect(screen.getByRole('link', { name: /See what each role can do/ })).toHaveAttribute('href', '/admin/settings/roles')
  })
})
