import { getAbsoluteUrl, SITE_URL } from '../../lib/site'
import { aireBusinessInfo } from '../../lib/businessInfo'

export function buildWebsiteSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: aireBusinessInfo.name,
    url: SITE_URL,
  }
}

export function buildLocalBusinessSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'SportsActivityLocation',
    name: aireBusinessInfo.name,
    description: 'Flight training, discovery flights, and aviation services in Guam.',
    url: SITE_URL,
    logo: getAbsoluteUrl('/assets/aire/logo.png'),
    image: getAbsoluteUrl('/assets/aire/hero.jpg'),
    telephone: aireBusinessInfo.phone.schema,
    email: aireBusinessInfo.email.display,
    address: {
      '@type': 'PostalAddress',
      streetAddress: aireBusinessInfo.address.street,
      addressLocality: aireBusinessInfo.address.locality,
      addressRegion: aireBusinessInfo.address.region,
      postalCode: aireBusinessInfo.address.postalCode,
      addressCountry: aireBusinessInfo.address.country,
    },
    areaServed: {
      '@type': 'Place',
      name: 'Guam',
    },
  }
}
