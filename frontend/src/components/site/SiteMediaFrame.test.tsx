import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import SiteMediaFrame from './SiteMediaFrame'
import type { SiteMedia } from '../../lib/api'

const imageMedia: SiteMedia = {
  id: 1,
  title: 'AIRE hero',
  alt_text: 'AIRE aircraft over Guam',
  caption: null,
  placement: 'home_hero',
  media_type: 'image',
  external_url: null,
  file_url: '/rails/active_storage/blobs/original',
  file_thumb_url: '/rails/active_storage/representations/thumb',
  file_card_url: '/rails/active_storage/representations/card',
  file_hero_url: '/rails/active_storage/representations/hero',
  poster_url: null,
  sort_order: 0,
  active: true,
  featured: false,
  metadata: {},
}

describe('SiteMediaFrame', () => {
  it('uses optimized srcSet variants and eager priority for hero images', () => {
    render(<SiteMediaFrame media={imageMedia} fallbackAlt="Fallback alt" hero />)

    const image = screen.getByRole('img', { name: 'AIRE aircraft over Guam' })
    expect(image).toHaveAttribute('src', '/rails/active_storage/representations/hero')
    expect(image).toHaveAttribute(
      'srcset',
      '/rails/active_storage/representations/thumb 480w, /rails/active_storage/representations/card 900w, /rails/active_storage/representations/hero 1800w',
    )
    expect(image).toHaveAttribute('loading', 'eager')
    expect(image).toHaveAttribute('fetchpriority', 'high')
  })
})
