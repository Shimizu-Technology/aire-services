import { getAbsoluteUrl, SITE_URL } from '../../lib/site'

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
