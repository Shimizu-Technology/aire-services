import { useEffect, useMemo, useState } from 'react'
import { api, type SiteMedia, type SiteMediaPlacement } from './api'

export const SITE_MEDIA_PLACEMENTS: Array<{ key: SiteMediaPlacement; label: string; helper: string }> = [
  { key: 'home_hero', label: 'Home hero', helper: 'Primary homepage image or short muted video.' },
  { key: 'home_training', label: 'Home training card', helper: 'Pilot training service card.' },
  { key: 'home_tours', label: 'Home tours card', helper: 'Aerial tours service card.' },
  { key: 'home_video', label: 'Home video card', helper: 'Video package service card.' },
  { key: 'home_gallery', label: 'Home gallery', helper: 'Optional extra homepage gallery media.' },
  { key: 'programs_hero', label: 'Programs hero', helper: 'Top visual for services and programs.' },
  { key: 'programs_training', label: 'Programs training', helper: 'Private pilot training feature visual.' },
  { key: 'tour_bay', label: 'Bay Tour', helper: 'Tour card image or clip.' },
  { key: 'tour_island', label: 'Island Tour', helper: 'Tour card image or clip.' },
  { key: 'tour_sunset', label: 'Sunset Tour', helper: 'Tour card image or clip.' },
  { key: 'programs_video', label: 'Video package sample', helper: 'Sample reel, linked video, or poster.' },
  { key: 'discovery_hero', label: 'Discovery Flight hero', helper: 'Discovery flight page hero.' },
  { key: 'team_hero', label: 'Team page feature', helper: 'Team or instructor group image.' },
  { key: 'careers_hero', label: 'Careers hero', helper: 'Careers page hero.' },
  { key: 'contact_feature', label: 'Contact feature', helper: 'Office, aircraft, or visitor-friendly contact image.' },
]

export function useSiteMedia(placements: SiteMediaPlacement[]) {
  const [items, setItems] = useState<SiteMedia[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      if (typeof api.getPublicSiteMedia !== 'function') {
        setItems([])
        setLoading(false)
        return
      }

      const response = await api.getPublicSiteMedia(placements)
      if (cancelled) return
      setItems(response.data?.site_media || [])
      setLoading(false)
    }

    load()
    return () => { cancelled = true }
  }, [placements.join(',')])

  const byPlacement = useMemo(() => {
    return items.reduce<Partial<Record<SiteMediaPlacement, SiteMedia[]>>>((acc, item) => {
      acc[item.placement] = [...(acc[item.placement] || []), item]
      return acc
    }, {})
  }, [items])

  const firstFor = (placement: SiteMediaPlacement) => byPlacement[placement]?.[0] || null

  return { items, byPlacement, firstFor, loading }
}

export function youtubeEmbedUrl(url: string) {
  try {
    const parsed = new URL(url)
    if (parsed.hostname.includes('youtu.be')) {
      const id = parsed.pathname.split('/').filter(Boolean)[0]
      return id ? `https://www.youtube.com/embed/${id}` : null
    }

    if (parsed.hostname.includes('youtube.com')) {
      const watchId = parsed.searchParams.get('v')
      if (watchId) return `https://www.youtube.com/embed/${watchId}`
      const parts = parsed.pathname.split('/').filter(Boolean)
      const id = parts[0] === 'shorts' || parts[0] === 'embed' || parts[0] === 'live' ? parts[1] : null
      return id ? `https://www.youtube.com/embed/${id}` : null
    }
  } catch {
    return null
  }

  return null
}
