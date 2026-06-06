import type { SocialLink } from './api'

export const defaultSocialLinks: SocialLink[] = [
  { key: 'instagram', label: 'Instagram', url: 'https://www.instagram.com/aire.services/' },
  { key: 'facebook', label: 'Facebook', url: 'https://www.facebook.com/AireServicesGuam/' },
]

export function visibleSocialLinks(links: SocialLink[] | null | undefined) {
  const source = links ?? defaultSocialLinks

  return source.filter((link) => link.label.trim() && link.url.trim())
}
