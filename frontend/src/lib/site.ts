export const SITE_URL = (import.meta.env.VITE_SITE_URL || 'https://aire-services-guam.netlify.app').replace(/\/$/, '')

export function getAbsoluteUrl(path = '/') {
  if (/^https?:\/\//.test(path)) return path
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  return `${SITE_URL}${normalizedPath}`
}
