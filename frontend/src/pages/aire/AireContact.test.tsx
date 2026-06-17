import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import AireContact from './AireContact'
import { aireAddressDisplay, aireBusinessInfo } from '../../lib/businessInfo'
import { PublicBusinessInfoContext } from '../../contexts/publicBusinessInfo'
import { defaultSocialLinks } from '../../lib/socialLinks'

const apiMock = vi.hoisted(() => ({
  submitContact: vi.fn(),
}))

vi.mock('../../lib/api', () => ({
  api: {
    submitContact: apiMock.submitContact,
  },
}))

const fixtureInquiryTopics = [
  'Private Pilot Certificate',
  'Aerial Tours',
  'Aircraft Rental',
  'Careers',
  'General Inquiry',
]

function renderPage(inquiryTopics = fixtureInquiryTopics) {
  return render(
    <MemoryRouter>
      <PublicBusinessInfoContext.Provider value={{ businessInfo: aireBusinessInfo, inquiryTopics, socialLinks: defaultSocialLinks }}>
        <AireContact />
      </PublicBusinessInfoContext.Provider>
    </MemoryRouter>,
  )
}

describe('AireContact', () => {
  beforeEach(() => {
    apiMock.submitContact.mockReset()
  })

  it('renders direct phone, WhatsApp, and email links', async () => {
    renderPage()

    await screen.findByRole('button', { name: 'Private Pilot Certificate' })

    const primaryPhone = aireBusinessInfo.phoneContacts[0]
    const whatsappPhone = aireBusinessInfo.phoneContacts.find((contact) => contact.channel === 'whatsapp')

    expect(screen.getByText(primaryPhone.display).closest('a')).toHaveAttribute('href', primaryPhone.href)
    expect(whatsappPhone).toBeTruthy()
    expect(screen.getByText(whatsappPhone!.display).closest('a')).toHaveAttribute('href', whatsappPhone!.href)
    expect(screen.getByRole('link', { name: aireBusinessInfo.email.display })).toHaveAttribute('href', aireBusinessInfo.email.href)
    expect(screen.getByText(aireAddressDisplay)).toBeInTheDocument()
  })

  it('trims form values before submitting', async () => {
    apiMock.submitContact.mockResolvedValue({
      data: { success: true, message: 'Sent successfully.' },
    })

    renderPage()
    await screen.findByRole('button', { name: 'Private Pilot Certificate' })

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
    renderPage(['Aerial Tours', 'Video Packages', 'General Inquiry'])

    const aerialToursButton = await screen.findByRole('button', { name: 'Aerial Tours' })
    expect(aerialToursButton).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Video Packages' })).toBeInTheDocument()

    expect(screen.getByText('Selected topic').parentElement).toHaveTextContent('Aerial Tours')
  })

  it('lets visitors pick the subject from topic buttons', async () => {
    renderPage()

    const aerialToursButton = await screen.findByRole('button', { name: 'Aerial Tours' })
    fireEvent.click(aerialToursButton)

    expect(aerialToursButton).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('Selected topic').parentElement).toHaveTextContent('Aerial Tours')
  })
})
