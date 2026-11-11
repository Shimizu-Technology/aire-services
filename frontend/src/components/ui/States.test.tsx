import '@testing-library/jest-dom'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Avatar } from './Avatar'
import { EmptyState } from './EmptyState'
import { ErrorState } from './ErrorState'
import { OfflineBanner } from './OfflineBanner'

function setOnline(online: boolean) {
  Object.defineProperty(window.navigator, 'onLine', { value: online, configurable: true })
  act(() => { window.dispatchEvent(new Event(online ? 'online' : 'offline')) })
}

afterEach(() => setOnline(true))

describe('EmptyState', () => {
  it('says what is true, what was checked and one way forward', () => {
    render(<EmptyState title="All caught up." description="Nothing is waiting for approval in CFI." action={<a href="/admin/approvals?dept=all">See everyone</a>} />)
    expect(screen.getByText('All caught up.')).toBeInTheDocument()
    expect(screen.getByText('Nothing is waiting for approval in CFI.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'See everyone' })).toBeInTheDocument()
  })
})

describe('ErrorState', () => {
  it('is announced and offers a retry', async () => {
    const user = userEvent.setup()
    const onRetry = vi.fn()
    const { rerender } = render(<ErrorState title="Couldn't load approvals." onRetry={onRetry} />)
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load approvals.")
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
    rerender(<ErrorState title="Couldn't load approvals." onRetry={onRetry} retrying />)
    expect(screen.getByRole('button', { name: 'Try again' })).toHaveAttribute('aria-busy', 'true')
  })
})

describe('OfflineBanner', () => {
  it('appears only while offline and says when the data was loaded (Guam time)', () => {
    render(<OfflineBanner loadedAt={new Date('2026-11-11T09:41:00Z')} />)
    const region = screen.getByRole('status')
    expect(region).toBeEmptyDOMElement()
    setOnline(false)
    expect(region).toHaveTextContent("You're offline. Showing what was loaded at 7:41 PM. Nothing can be saved until you reconnect.")
    setOnline(true)
    expect(region).toBeEmptyDOMElement()
  })

  it('can be driven by the page', () => {
    render(<OfflineBanner online={false}>Reconnect to approve.</OfflineBanner>)
    expect(screen.getByRole('status')).toHaveTextContent("You're offline. Reconnect to approve.")
  })
})

describe('Avatar', () => {
  it('shows initials, is decorative next to a name, and tints by name only', () => {
    const { container } = render(
      <>
        <Avatar name="Marcus Quinata" />
        <Avatar name="marcus quinata " />
        <Avatar name="Tåsi Leon Guerrero-Santos" size="lg" label="Tåsi Leon Guerrero-Santos" />
      </>,
    )
    const [first, again] = Array.from(container.querySelectorAll('[aria-hidden="true"]'))
    expect(first).toHaveTextContent('MQ')
    expect(first.className).toBe(again.className)
    expect(screen.getByRole('img', { name: 'Tåsi Leon Guerrero-Santos' })).toHaveTextContent('TL')
  })

  it('never uses a status colour', () => {
    const names = ['Ethan Cruz', 'Grace Torres', 'Caleb Perez', 'Roke Aguon', 'Mindy Santos', 'Kai Blas', 'Jun Santos', 'Rosa Leon Guerrero']
    const { container } = render(<>{names.map(name => <Avatar key={name} name={name} />)}</>)
    for (const avatar of Array.from(container.children)) expect(avatar.className).not.toMatch(/amber|emerald|green|red|rose/)
  })
})
