const envValue = (key: string) => {
  const value = import.meta.env[key]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

const digitsOnly = (value: string) => value.replace(/\D/g, '')

const parenthesizedAreaLabel = (value: string) => {
  const parts = value.split('/').map((part) => part.trim()).filter(Boolean)
  return parts.length > 1 ? `${parts[0]} (${parts.slice(1).join(' / ')})` : value
}

const phoneDisplay = envValue('VITE_AIRE_PHONE_DISPLAY') || '(671) 477-4243'
const phoneDigits = digitsOnly(phoneDisplay)
const phoneE164 = envValue('VITE_AIRE_PHONE_E164') || (phoneDigits.length === 10 ? `+1${phoneDigits}` : '+16714774243')
const publicEmail = envValue('VITE_AIRE_PUBLIC_EMAIL') || 'admin@aireservicesguam.com'

export const aireBusinessInfo = {
  name: 'AIRE Services Guam',
  phone: {
    display: phoneDisplay,
    e164: phoneE164,
    href: `tel:${phoneE164}`,
    schema: phoneE164.replace(/^\+1/, '+1-').replace(/(\d{3})(\d{3})(\d{4})$/, '$1-$2-$3'),
  },
  email: {
    display: publicEmail,
    href: `mailto:${publicEmail}`,
    careerHref: `mailto:${publicEmail}?subject=AIRE%20Career%20Inquiry`,
  },
  address: {
    street: envValue('VITE_AIRE_STREET_ADDRESS') || '353 Admiral Sherman Boulevard',
    locality: envValue('VITE_AIRE_ADDRESS_LOCALITY') || 'Barrigada',
    region: envValue('VITE_AIRE_ADDRESS_REGION') || 'Guam',
    postalCode: envValue('VITE_AIRE_POSTAL_CODE') || '96913',
    country: envValue('VITE_AIRE_ADDRESS_COUNTRY') || 'GU',
    areaLabel: envValue('VITE_AIRE_ADDRESS_AREA_LABEL') || 'Tiyan / Barrigada',
  },
} as const

export const aireAddressDisplay =
  `${aireBusinessInfo.address.street}, ${aireBusinessInfo.address.areaLabel}, ${aireBusinessInfo.address.region} ${aireBusinessInfo.address.postalCode}`

export const aireAddressFooter =
  `${aireBusinessInfo.address.street}, ${aireBusinessInfo.address.areaLabel}, ${aireBusinessInfo.address.region}`

export const aireAddressLines = [
  aireBusinessInfo.address.street,
  `${parenthesizedAreaLabel(aireBusinessInfo.address.areaLabel)}, ${aireBusinessInfo.address.region} ${aireBusinessInfo.address.postalCode}`,
] as const
