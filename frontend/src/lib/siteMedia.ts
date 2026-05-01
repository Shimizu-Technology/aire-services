import { useEffect, useMemo, useState } from 'react'
import { api, type SiteMedia, type SiteMediaPlacement, type SiteMediaType } from './api'

export interface SiteMediaPlacementGuide {
  key: SiteMediaPlacement;
  group: string;
  label: string;
  shortLabel: string;
  helper: string;
  section: string;
  appearsOn: string[];
  pageHref: string;
  recommended: string;
  preferredType: SiteMediaType | 'either';
}

export const SITE_MEDIA_PLACEMENT_GROUPS = [
  'Home page',
  'Programs page',
  'Shared tour cards',
  'Standalone pages',
] as const

export const SITE_MEDIA_PLACEMENTS: SiteMediaPlacementGuide[] = [
  {
    key: 'home_hero',
    group: 'Home page',
    label: 'Home page: hero background',
    shortLabel: 'Hero background',
    helper: 'Main image or muted clip behind the large homepage headline.',
    section: 'Top hero background behind "Pilot training, Guam aerial tours, and cinematic video packages."',
    appearsOn: ['Home page hero'],
    pageHref: '/',
    recommended: 'Wide landscape image or short muted video. Strong cockpit, aircraft, or aerial visuals work best.',
    preferredType: 'either',
  },
  {
    key: 'home_training',
    group: 'Home page',
    label: 'Home page: Pilot Training card',
    shortLabel: 'Pilot Training card',
    helper: 'Image on the first service card in the homepage Core Services section.',
    section: 'Core Services card for Pilot Training.',
    appearsOn: ['Home page Core Services'],
    pageHref: '/',
    recommended: 'Landscape image, ideally cockpit, instructor, aircraft, or training moment.',
    preferredType: 'image',
  },
  {
    key: 'home_tours',
    group: 'Home page',
    label: 'Home page: Guam Aerial Tours card',
    shortLabel: 'Guam Aerial Tours card',
    helper: 'Image on the second service card in the homepage Core Services section.',
    section: 'Core Services card for Guam Aerial Tours.',
    appearsOn: ['Home page Core Services'],
    pageHref: '/',
    recommended: 'Landscape aerial image with coastline, reef, or recognizable Guam scenery.',
    preferredType: 'image',
  },
  {
    key: 'home_video',
    group: 'Home page',
    label: 'Home page: Video Packages card',
    shortLabel: 'Video Packages card',
    helper: 'Image on the third service card in the homepage Core Services section.',
    section: 'Core Services card for Video Packages.',
    appearsOn: ['Home page Core Services'],
    pageHref: '/',
    recommended: 'Landscape image or poster that communicates media/video deliverables.',
    preferredType: 'image',
  },
  {
    key: 'programs_hero',
    group: 'Programs page',
    label: 'Programs page: top hero image',
    shortLabel: 'Top hero image',
    helper: 'Large image beside the Programs & Services intro.',
    section: 'Top Programs & Services intro visual.',
    appearsOn: ['Programs page intro'],
    pageHref: '/programs',
    recommended: 'Wide landscape image with aircraft, coastline, or in-flight experience.',
    preferredType: 'image',
  },
  {
    key: 'programs_training',
    group: 'Programs page',
    label: 'Programs page: Private Pilot Training feature',
    shortLabel: 'Private Pilot Training feature',
    helper: 'Large image above the Private Pilot Certificate training details.',
    section: 'Private Pilot Certificate training feature card.',
    appearsOn: ['Programs page training section'],
    pageHref: '/programs',
    recommended: 'Landscape image focused on training, cockpit, aircraft, or instruction.',
    preferredType: 'image',
  },
  {
    key: 'programs_video',
    group: 'Programs page',
    label: 'Programs/Home: video package sample reel',
    shortLabel: 'Video package sample reel',
    helper: 'Sample video or poster for the Video Packages sections.',
    section: 'Video Packages sample media.',
    appearsOn: ['Home page Video Packages section', 'Programs page Video Packages section'],
    pageHref: '/programs',
    recommended: 'Video upload or YouTube/Vimeo link. Add a poster image for clean loading and mobile previews.',
    preferredType: 'video',
  },
  {
    key: 'tour_bay',
    group: 'Shared tour cards',
    label: 'Tour cards: Bay Tour image',
    shortLabel: 'Bay Tour image',
    helper: 'Image for the Bay Tour card wherever tour cards appear.',
    section: 'Bay Tour card image.',
    appearsOn: ['Home page tour cards', 'Programs page tour cards'],
    pageHref: '/programs',
    recommended: 'Landscape aerial image that matches the bay route, water, reef, or coastline.',
    preferredType: 'image',
  },
  {
    key: 'tour_island',
    group: 'Shared tour cards',
    label: 'Tour cards: Island Tour image',
    shortLabel: 'Island Tour image',
    helper: 'Image for the Island Tour card wherever tour cards appear.',
    section: 'Island Tour card image.',
    appearsOn: ['Home page tour cards', 'Programs page tour cards'],
    pageHref: '/programs',
    recommended: 'Landscape aerial image showing a broader island/coastline view.',
    preferredType: 'image',
  },
  {
    key: 'tour_sunset',
    group: 'Shared tour cards',
    label: 'Tour cards: Sunset Tour image',
    shortLabel: 'Sunset Tour image',
    helper: 'Image for the Sunset Tour card wherever tour cards appear.',
    section: 'Sunset Tour card image.',
    appearsOn: ['Home page tour cards', 'Programs page tour cards'],
    pageHref: '/programs',
    recommended: 'Landscape sunset, golden-hour aircraft, or evening coastline image.',
    preferredType: 'image',
  },
  {
    key: 'discovery_hero',
    group: 'Standalone pages',
    label: 'Discovery Flight page: hero image',
    shortLabel: 'Discovery Flight hero',
    helper: 'Top visual for the Discovery Flight page.',
    section: 'Discovery Flight page hero.',
    appearsOn: ['Discovery Flight page hero'],
    pageHref: '/discovery-flight',
    recommended: 'Wide image showing a first-flight, aircraft, cockpit, or welcoming flight experience.',
    preferredType: 'image',
  },
  {
    key: 'team_hero',
    group: 'Standalone pages',
    label: 'Team page: feature image',
    shortLabel: 'Team feature image',
    helper: 'Team or instructor image near the top of the Team page.',
    section: 'Team page feature visual.',
    appearsOn: ['Team page feature section'],
    pageHref: '/team',
    recommended: 'Wide team, instructor, aircraft, or candid operations image.',
    preferredType: 'image',
  },
  {
    key: 'careers_hero',
    group: 'Standalone pages',
    label: 'Careers page: hero image',
    shortLabel: 'Careers hero',
    helper: 'Top visual for the Careers page.',
    section: 'Careers page hero.',
    appearsOn: ['Careers page hero'],
    pageHref: '/careers',
    recommended: 'Wide image that feels professional and team-oriented.',
    preferredType: 'image',
  },
  {
    key: 'contact_feature',
    group: 'Standalone pages',
    label: 'Contact page: feature image',
    shortLabel: 'Contact feature image',
    helper: 'Visitor-friendly image beside contact details.',
    section: 'Contact page feature image.',
    appearsOn: ['Contact page feature section'],
    pageHref: '/contact',
    recommended: 'Wide image of the office, aircraft, ramp, or friendly arrival experience.',
    preferredType: 'image',
  },
]

export function useSiteMedia(placements: SiteMediaPlacement[]) {
  const placementKey = placements.join(',')
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

      const requestedPlacements = placementKey.split(',').filter(Boolean) as SiteMediaPlacement[]
      const response = await api.getPublicSiteMedia(requestedPlacements)
      if (cancelled) return
      setItems(response.data?.site_media || [])
      setLoading(false)
    }

    load()
    return () => { cancelled = true }
  }, [placementKey])

  const byPlacement = useMemo(() => {
    return items.reduce<Partial<Record<SiteMediaPlacement, SiteMedia[]>>>((acc, item) => {
      acc[item.placement] = [...(acc[item.placement] || []), item]
      return acc
    }, {})
  }, [items])

  const firstFor = (placement: SiteMediaPlacement) => byPlacement[placement]?.[0] || null

  return { items, byPlacement, firstFor, loading }
}

export function videoEmbedUrl(url: string) {
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

    if (parsed.hostname.includes('vimeo.com')) {
      const parts = parsed.pathname.split('/').filter(Boolean)
      const id = parsed.hostname.includes('player.vimeo.com')
        ? parts[0] === 'video' ? parts[1] : null
        : parts.find((part) => /^\d+$/.test(part))
      return id ? `https://player.vimeo.com/video/${id}` : null
    }
  } catch {
    return null
  }

  return null
}
