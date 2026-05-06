import { getAbsoluteUrl, SITE_URL } from '../../lib/site'
import { aireBusinessInfo } from '../../lib/businessInfo'
import type { AireBusinessInfo } from '../../lib/businessInfo'

export function buildWebsiteSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: aireBusinessInfo.name,
    url: SITE_URL,
  }
}

export function buildLocalBusinessSchema(info: AireBusinessInfo = aireBusinessInfo) {
  return {
    '@context': 'https://schema.org',
    '@type': 'SportsActivityLocation',
    name: info.name,
    description: 'Flight training, discovery flights, and aviation services in Guam.',
    url: SITE_URL,
    logo: getAbsoluteUrl('/assets/aire/logo.png'),
    image: getAbsoluteUrl('/assets/aire/hero.jpg'),
    telephone: info.phone.schema,
    email: info.email.display,
    address: {
      '@type': 'PostalAddress',
      streetAddress: info.address.street,
      addressLocality: info.address.locality,
      addressRegion: info.address.region,
      postalCode: info.address.postalCode,
      addressCountry: info.address.country,
    },
    areaServed: {
      '@type': 'Place',
      name: 'Guam',
    },
  }
}
