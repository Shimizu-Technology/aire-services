import type { ReactNode } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PublicBusinessInfoProvider } from './PublicBusinessInfoContext'
import { usePublicBusinessInfo, usePublicInquiryTopics } from './publicBusinessInfo'
import { defaultInquiryTopics, defaultPublicContactSettings } from '../lib/businessInfo'

const apiMock = vi.hoisted(() => ({
  getPublicContactSettings: vi.fn(),
}))

vi.mock('../lib/api', () => ({
  api: {
    getPublicContactSettings: apiMock.getPublicContactSettings,
  },
}))

function Probe() {
  const businessInfo = usePublicBusinessInfo()
  const inquiryTopics = usePublicInquiryTopics()

  return (
    <div>
      <p>{businessInfo.phone.display}</p>
      <p>{businessInfo.email.display}</p>
      <p>{inquiryTopics.join(', ')}</p>
    </div>
  )
}

function renderProvider(children: ReactNode = <Probe />) {
  return render(
    <PublicBusinessInfoProvider>
      {children}
    </PublicBusinessInfoProvider>,
  )
}

describe('PublicBusinessInfoProvider', () => {
  beforeEach(() => {
    apiMock.getPublicContactSettings.mockReset()
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('uses public contact settings from the API when available', async () => {
    apiMock.getPublicContactSettings.mockResolvedValue({
      data: {
        public_contact: {
          ...defaultPublicContactSettings,
          phone_display: '(671) 555-0100',
          email: 'frontdesk@example.com',
        },
        inquiry_topics: ['Tours', 'Training'],
      },
    })

    renderProvider()

    expect(await screen.findByText('(671) 555-0100')).toBeInTheDocument()
    expect(screen.getByText('frontdesk@example.com')).toBeInTheDocument()
    expect(screen.getByText('Tours, Training')).toBeInTheDocument()
  })

  it('keeps defaults when the public contact settings request fails', async () => {
    apiMock.getPublicContactSettings.mockRejectedValue(new Error('network failed'))

    renderProvider()

    await waitFor(() => {
      expect(apiMock.getPublicContactSettings).toHaveBeenCalled()
    })
    expect(screen.getByText(defaultPublicContactSettings.phone_display)).toBeInTheDocument()
    expect(screen.getByText(defaultPublicContactSettings.email)).toBeInTheDocument()
    expect(screen.getByText(defaultInquiryTopics.join(', '))).toBeInTheDocument()
    expect(console.warn).toHaveBeenCalledWith(
      'Unable to load public contact settings; using defaults.',
      expect.any(Error),
    )
  })
})
