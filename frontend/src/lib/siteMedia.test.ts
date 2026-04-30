import { describe, expect, it } from 'vitest'
import { videoEmbedUrl } from './siteMedia'

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
