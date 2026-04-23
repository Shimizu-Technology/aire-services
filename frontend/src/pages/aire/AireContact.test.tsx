import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import AireContact from './AireContact'

const apiMock = vi.hoisted(() => ({
  getPublicContactSettings: vi.fn(),
  submitContact: vi.fn(),
}))

vi.mock('../../lib/api', () => ({
  api: {
    getPublicContactSettings: apiMock.getPublicContactSettings,
    submitContact: apiMock.submitContact,
  },
}))

function renderPage() {
  return render(
    <MemoryRouter>
      <AireContact />
    </MemoryRouter>,
  )
}

describe('AireContact', () => {
  beforeEach(() => {
    apiMock.getPublicContactSettings.mockReset()
    apiMock.submitContact.mockReset()
    apiMock.getPublicContactSettings.mockResolvedValue({
      data: {
        inquiry_topics: [
          'Private Pilot Certificate',
          'Discovery Flight',
          'Aircraft Rental',
          'Careers',
          'General Inquiry',
        ],
      },
    })
  })

  it('renders direct phone and email links', async () => {
    renderPage()

    await screen.findByLabelText('Subject')

    expect(screen.getByRole('link', { name: '(671) 477-4243' })).toHaveAttribute('href', 'tel:+16714774243')
    expect(screen.getByRole('link', { name: 'admin@aireservicesguam.com' })).toHaveAttribute('href', 'mailto:admin@aireservicesguam.com')
  })

  it('trims form values before submitting', async () => {
    apiMock.submitContact.mockResolvedValue({
      data: { success: true, message: 'Sent successfully.' },
    })

    renderPage()

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: '  Test User  ' } })
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: '  test@example.com  ' } })
    fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '  671-555-1212  ' } })
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: '  Hello AIRE  ' } })

    fireEvent.click(screen.getByRole('button', { name: 'Send Inquiry' }))

    await waitFor(() => {
      expect(apiMock.submitContact).toHaveBeenCalledWith({
        name: 'Test User',
        email: 'test@example.com',
        phone: '671-555-1212',
        subject: 'Private Pilot Certificate',
        message: 'Hello AIRE',
      })
    })

    expect(await screen.findByText('Sent successfully.')).toBeInTheDocument()
  })

  it('renders configured inquiry topics from the API', async () => {
    apiMock.getPublicContactSettings.mockResolvedValue({
      data: { inquiry_topics: ['Aerial Tours', 'Video Packages', 'General Inquiry'] },
    })

    renderPage()

    await screen.findByDisplayValue('Aerial Tours')
    expect(screen.getAllByText('Aerial Tours').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Video Packages').length).toBeGreaterThan(0)

    await waitFor(() => {
      expect(screen.getByLabelText('Subject')).toHaveValue('Aerial Tours')
    })
  })
})
