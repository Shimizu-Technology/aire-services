import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const apiMock = vi.hoisted(() => ({
  getPublicSiteMedia: vi.fn(),
}))

vi.mock('./api', () => ({
  api: apiMock,
}))

import { useSiteMedia, videoEmbedUrl } from './siteMedia'

describe('videoEmbedUrl', () => {
  it('builds YouTube embed URLs', () => {
    expect(videoEmbedUrl('https://www.youtube.com/watch?v=abc123')).toBe('https://www.youtube.com/embed/abc123')
    expect(videoEmbedUrl('https://youtu.be/abc123')).toBe('https://www.youtube.com/embed/abc123')
  })

  it('builds Vimeo embed URLs', () => {
    expect(videoEmbedUrl('https://vimeo.com/123456789')).toBe('https://player.vimeo.com/video/123456789')
    expect(videoEmbedUrl('https://player.vimeo.com/video/123456789')).toBe('https://player.vimeo.com/video/123456789')
  })

  it('returns null for unsupported video links', () => {
    expect(videoEmbedUrl('https://example.com/video')).toBeNull()
    expect(videoEmbedUrl('not a url')).toBeNull()
  })
})

describe('useSiteMedia', () => {
  beforeEach(() => {
    apiMock.getPublicSiteMedia.mockReset()
  })

  it('stops loading and falls back to no media when the request fails', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    apiMock.getPublicSiteMedia.mockRejectedValueOnce(new Error('Network unavailable'))

    const { result } = renderHook(() => useSiteMedia(['careers_hero']))

    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.items).toEqual([])

    consoleSpy.mockRestore()
  })
})
