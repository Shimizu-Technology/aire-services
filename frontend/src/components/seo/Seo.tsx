import { useEffect } from 'react'
import { getAbsoluteUrl, SITE_URL } from '../../lib/site'

interface SeoProps {
  title: string
  description: string
  path?: string
  image?: string
  type?: 'website' | 'article'
  robots?: string
  themeColor?: string
  jsonLd?: Record<string, unknown> | Record<string, unknown>[]
}

const DEFAULT_IMAGE = '/assets/aire/hero.jpg'
const DEFAULT_THEME = '#1e3a5f'

function upsertMeta(selector: string, attributes: Record<string, string>) {
  let element = document.head.querySelector<HTMLMetaElement>(selector)

  if (!element) {
    element = document.createElement('meta')
    document.head.appendChild(element)
  }

  Object.entries(attributes).forEach(([key, value]) => {
    element?.setAttribute(key, value)
  })
}

function upsertLink(selector: string, attributes: Record<string, string>) {
  let element = document.head.querySelector<HTMLLinkElement>(selector)

  if (!element) {
    element = document.createElement('link')
    document.head.appendChild(element)
  }

  Object.entries(attributes).forEach(([key, value]) => {
    element?.setAttribute(key, value)
  })
}

export default function Seo({
  title,
  description,
  path = '/',
  image = DEFAULT_IMAGE,
  type = 'website',
  robots = 'index,follow',
  themeColor = DEFAULT_THEME,
  jsonLd,
}: SeoProps) {
  useEffect(() => {
    const canonicalUrl = getAbsoluteUrl(path)
    const imageUrl = getAbsoluteUrl(image)

    document.title = title

    upsertMeta('meta[name="description"]', { name: 'description', content: description })
    upsertMeta('meta[name="title"]', { name: 'title', content: title })
    upsertMeta('meta[name="author"]', { name: 'author', content: 'AIRE Services Guam' })
    upsertMeta('meta[name="robots"]', { name: 'robots', content: robots })
    upsertMeta('meta[name="theme-color"]', { name: 'theme-color', content: themeColor })
    upsertMeta('meta[name="apple-mobile-web-app-title"]', { name: 'apple-mobile-web-app-title', content: 'AIRE Ops' })
    upsertMeta('meta[name="apple-mobile-web-app-capable"]', { name: 'apple-mobile-web-app-capable', content: 'yes' })
    upsertMeta('meta[name="apple-mobile-web-app-status-bar-style"]', { name: 'apple-mobile-web-app-status-bar-style', content: 'black-translucent' })
    upsertMeta('meta[name="msapplication-TileColor"]', { name: 'msapplication-TileColor', content: themeColor })

    upsertMeta('meta[property="og:type"]', { property: 'og:type', content: type })
    upsertMeta('meta[property="og:site_name"]', { property: 'og:site_name', content: 'AIRE Services Guam' })
    upsertMeta('meta[property="og:title"]', { property: 'og:title', content: title })
    upsertMeta('meta[property="og:description"]', { property: 'og:description', content: description })
    upsertMeta('meta[property="og:url"]', { property: 'og:url', content: canonicalUrl })
    upsertMeta('meta[property="og:image"]', { property: 'og:image', content: imageUrl })

    upsertMeta('meta[name="twitter:card"]', { name: 'twitter:card', content: 'summary_large_image' })
    upsertMeta('meta[name="twitter:title"]', { name: 'twitter:title', content: title })
    upsertMeta('meta[name="twitter:description"]', { name: 'twitter:description', content: description })
    upsertMeta('meta[name="twitter:image"]', { name: 'twitter:image', content: imageUrl })
    upsertMeta('meta[name="twitter:url"]', { name: 'twitter:url', content: canonicalUrl })

    upsertLink('link[rel="canonical"]', { rel: 'canonical', href: canonicalUrl })
    upsertLink('link[rel="apple-touch-icon"]', { rel: 'apple-touch-icon', href: getAbsoluteUrl('/assets/aire/logo.png') })

    let script: HTMLScriptElement | null = null

    if (jsonLd) {
      script = document.createElement('script')
      script.type = 'application/ld+json'
      script.setAttribute('data-seo-json-ld', path || '/')
      script.textContent = JSON.stringify(jsonLd)
      document.head.appendChild(script)
    }

    return () => {
      if (script) script.remove()
    }
  }, [description, image, jsonLd, path, robots, themeColor, title])

  return null
}

export function buildWebsiteSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'AIRE Services Guam',
    url: SITE_URL,
  }
}

export function buildLocalBusinessSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'SportsActivityLocation',
    name: 'AIRE Services Guam',
    description: 'Flight training, discovery flights, and aviation services in Guam.',
    url: SITE_URL,
    logo: getAbsoluteUrl('/assets/aire/logo.png'),
    image: getAbsoluteUrl('/assets/aire/hero.jpg'),
    telephone: '+1-671-477-4243',
    email: 'admin@aireservicesguam.com',
    address: {
      '@type': 'PostalAddress',
      streetAddress: '1780 Admiral Sherman Boulevard',
      addressLocality: 'Barrigada',
      addressRegion: 'Guam',
      postalCode: '96913',
      addressCountry: 'GU',
    },
    areaServed: {
      '@type': 'Place',
      name: 'Guam',
    },
  }
}
