export interface PublicContactInfoSettings {
  phone_display: string
  phone_e164: string
  email: string
  street_address: string
  address_area_label: string
  address_locality: string
  address_region: string
  postal_code: string
  address_country: string
}

export interface AireBusinessInfo {
  name: 'AIRE Services Guam'
  phone: {
    display: string
    e164: string
    href: string
    schema: string
  }
  email: {
    display: string
    href: string
    careerHref: string
  }
  address: {
    street: string
    locality: string
    region: string
    postalCode: string
    country: string
    areaLabel: string
  }
}

export const defaultInquiryTopics = [
  'Pilot Training',
  'Guam Aerial Tours',
  'Video Packages',
  'Discovery Flight',
  'Careers',
  'General Inquiry',
]

export const defaultPublicContactSettings: PublicContactInfoSettings = {
  phone_display: '(671) 477-4243',
  phone_e164: '+16714774243',
  email: 'admin@aireservicesguam.com',
  street_address: '353 Admiral Sherman Boulevard',
  address_area_label: 'Tiyan / Barrigada',
  address_locality: 'Barrigada',
  address_region: 'Guam',
  postal_code: '96913',
  address_country: 'GU',
}

const digitsOnly = (value: string) => value.replace(/\D/g, '')

const normalizePhoneE164 = (value: string) => {
  const digits = digitsOnly(value)
  if (digits.length === 10) return `+1${digits}`
  if (digits.length > 0) return `+${digits}`
  return value
}

const formatSchemaPhone = (value: string) => {
  const digits = digitsOnly(value)
  if (digits.length === 11 && digits.startsWith('1')) {
    return `+1-${digits.slice(1, 4)}-${digits.slice(4, 7)}-${digits.slice(7)}`
  }
  if (digits.length === 10) {
    return `+1-${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`
  }
  return value
}

const valueOrDefault = (value: string | null | undefined, fallback: string) => {
  const trimmed = value?.trim()
  return trimmed || fallback
}

const parenthesizedAreaLabel = (value: string) => {
  const parts = value.split('/').map((part) => part.trim()).filter(Boolean)
  return parts.length > 1 ? `${parts[0]} (${parts.slice(1).join(' / ')})` : value
}

export function buildAireBusinessInfo(settings?: Partial<PublicContactInfoSettings> | null): AireBusinessInfo {
  const merged = {
    ...defaultPublicContactSettings,
    ...settings,
  }

  const phoneDisplay = valueOrDefault(merged.phone_display, defaultPublicContactSettings.phone_display)
  const phoneE164 = normalizePhoneE164(valueOrDefault(merged.phone_e164, defaultPublicContactSettings.phone_e164))
  const publicEmail = valueOrDefault(merged.email, defaultPublicContactSettings.email)

  return {
    name: 'AIRE Services Guam',
    phone: {
      display: phoneDisplay,
      e164: phoneE164,
      href: `tel:${phoneE164}`,
      schema: formatSchemaPhone(phoneE164),
    },
    email: {
      display: publicEmail,
      href: `mailto:${publicEmail}`,
      careerHref: `mailto:${publicEmail}?subject=AIRE%20Career%20Inquiry`,
    },
    address: {
      street: valueOrDefault(merged.street_address, defaultPublicContactSettings.street_address),
      locality: valueOrDefault(merged.address_locality, defaultPublicContactSettings.address_locality),
      region: valueOrDefault(merged.address_region, defaultPublicContactSettings.address_region),
      postalCode: valueOrDefault(merged.postal_code, defaultPublicContactSettings.postal_code),
      country: valueOrDefault(merged.address_country, defaultPublicContactSettings.address_country),
      areaLabel: valueOrDefault(merged.address_area_label, defaultPublicContactSettings.address_area_label),
    },
  }
}

export const aireBusinessInfo = buildAireBusinessInfo()

export const aireAddressDisplayFor = (businessInfo: AireBusinessInfo = aireBusinessInfo) =>
  `${businessInfo.address.street}, ${businessInfo.address.areaLabel}, ${businessInfo.address.region} ${businessInfo.address.postalCode}`

export const aireAddressFooterFor = (businessInfo: AireBusinessInfo = aireBusinessInfo) =>
  `${businessInfo.address.street}, ${businessInfo.address.areaLabel}, ${businessInfo.address.region}`

export const aireAddressLinesFor = (businessInfo: AireBusinessInfo = aireBusinessInfo) => [
  businessInfo.address.street,
  `${parenthesizedAreaLabel(businessInfo.address.areaLabel)}, ${businessInfo.address.region} ${businessInfo.address.postalCode}`,
] as const

export const aireAddressDisplay = aireAddressDisplayFor()
export const aireAddressFooter = aireAddressFooterFor()
export const aireAddressLines = aireAddressLinesFor()
