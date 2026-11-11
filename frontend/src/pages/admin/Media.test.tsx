import '@testing-library/jest-dom'
import type { ReactNode } from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Media from './Media'
import type { SiteMedia } from '../../lib/api'

const apiMock = vi.hoisted(() => ({
  getAdminSiteMedia: vi.fn(),
  deleteSiteMedia: vi.fn(),
  updateSiteMedia: vi.fn(),
  createSiteMedia: vi.fn(),
}))
vi.mock('../../lib/api', () => ({ api: apiMock }))
vi.mock('../../components/ui/MotionComponents', () => ({
  FadeUp: ({ children }: { children: ReactNode }) => <>{children}</>,
}))
vi.mock('../../components/site/SiteMediaFrame', () => ({ default: () => <div data-testid="media-frame" /> }))

const hero: SiteMedia = {
  id: 5, title: 'Sunset over Tumon', alt_text: null, caption: null, placement: 'home_hero', media_type: 'image',
  external_url: null, file_url: null, poster_url: null, sort_order: 0, active: true, featured: false, metadata: {},
}

describe('Media delete confirmation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    apiMock.getAdminSiteMedia.mockResolvedValue({ data: { site_media: [hero] } })
    apiMock.deleteSiteMedia.mockResolvedValue({})
  })

  it('keeps the media when the confirmation is cancelled', async () => {
    render(<Media />)
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Delete "Sunset over Tumon"?' })
    expect(dialog).toHaveTextContent('This removes the uploaded media from the site.')
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(apiMock.deleteSiteMedia).not.toHaveBeenCalled()
  })

  it('deletes and reloads after the confirmation', async () => {
    render(<Media />)
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }))
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Delete media' }))
    await waitFor(() => expect(apiMock.deleteSiteMedia).toHaveBeenCalledWith(5))
    await waitFor(() => expect(apiMock.getAdminSiteMedia).toHaveBeenCalledTimes(2))
  })
})
