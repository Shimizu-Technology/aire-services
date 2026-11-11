import { useEffect } from 'react'
import { Link, Outlet, useLocation } from 'react-router-dom'
import { ChevronLeft, ChevronRight, ExternalLink, Image, Phone, UsersRound, type LucideIcon } from 'lucide-react'
import { PageHeader } from '../../components/ui'
import { ADMIN_PATHS } from '../../lib/adminRoutes'

// Website: everything that shows on the public site, kept apart from the
// time and pay rules in Settings. The pages themselves are unchanged; the
// fuller Settings/Website split comes later.

const areas: { title: string; description: string; href: string; icon: LucideIcon; note?: string }[] = [
  {
    title: 'Photos & videos',
    description: 'The pictures and clips in each spot on the public site.',
    href: ADMIN_PATHS.websiteMedia,
    icon: Image,
  },
  {
    title: 'Contact & links',
    description: 'Who gets website inquiries, the phone directory, email, address and social links.',
    href: ADMIN_PATHS.websiteContact,
    icon: Phone,
  },
  {
    title: 'Public team profiles',
    description: 'Who appears on the Team page, with their photo and title.',
    href: `${ADMIN_PATHS.team}?public=visible`,
    icon: UsersRound,
    note: 'Edited on each person in Team',
  },
]

export function WebsiteHome() {
  useEffect(() => { document.title = 'Website | AIRE Ops' }, [])
  return (
    <div className="space-y-6">
      <PageHeader
        title="Website"
        description="What visitors see on the public AIRE site."
        actions={(
          <Link to="/" target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-primary hover:underline">
            View the site <ExternalLink aria-hidden="true" className="size-4" /><span className="sr-only">(opens in a new tab)</span>
          </Link>
        )}
      />
      <ul className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface shadow-sm">
        {areas.map(({ title, description, href, icon: Icon, note }) => (
          <li key={title}>
            <Link to={href} className="flex min-h-16 items-center gap-4 px-4 py-4 transition-colors duration-150 hover:bg-surface-muted sm:px-5">
              <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-control border border-line bg-surface-muted text-ink-muted">
                <Icon aria-hidden="true" className="size-5" strokeWidth={1.8} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-body font-semibold text-ink">{title}</span>
                <span className="mt-0.5 block text-body-sm text-ink-muted">{description}</span>
                {note && <span className="mt-0.5 block text-caption text-ink-subtle">{note}</span>}
              </span>
              <ChevronRight aria-hidden="true" className="size-5 shrink-0 text-ink-subtle" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** /admin/website/*: a way back to the Website overview above each page. */
export default function WebsiteLayout() {
  const location = useLocation()
  const atOverview = location.pathname.replace(/\/$/, '') === ADMIN_PATHS.website
  return (
    <div className="space-y-4">
      {!atOverview && (
        <Link to={ADMIN_PATHS.website} className="-ml-1 inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-primary hover:underline">
          <ChevronLeft aria-hidden="true" className="size-4" />Website
        </Link>
      )}
      <Outlet />
    </div>
  )
}
