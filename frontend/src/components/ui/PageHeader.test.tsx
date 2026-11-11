import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PageHeader } from './PageHeader'

describe('PageHeader', () => {
  it('renders one H1, a short description and actions', () => {
    render(<PageHeader title="Team" description="27 active" actions={<button type="button">Add person</button>}>Nov 1–15</PageHeader>)
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByRole('heading', { name: 'Team' })).toHaveClass('text-heading')
    expect(screen.getByText('27 active')).toBeInTheDocument()
    expect(screen.getByText('Nov 1–15')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add person' })).toBeInTheDocument()
  })

  it('stacks actions under the title on phones and wraps long names', () => {
    const { container } = render(<PageHeader title="Rosa Leon Guerrero-Unpingco" actions={<button type="button">Edit</button>} />)
    expect(container.querySelector('header')).toHaveClass('flex-col', 'sm:flex-row')
    expect(screen.getByRole('heading')).toHaveClass('[overflow-wrap:anywhere]')
    expect(container.querySelector('p')).toBeNull()
  })
})
