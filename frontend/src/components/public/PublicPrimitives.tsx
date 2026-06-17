import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { SiteMedia } from '../../lib/api'
import { cx } from '../../lib/cx'
import { isInternalHref } from '../../lib/publicLinks'
import SiteMediaFrame from '../site/SiteMediaFrame'

export type PublicButtonVariant = 'primary' | 'secondary' | 'dark' | 'light' | 'outline' | 'text'

interface PublicButtonLinkProps {
  to: string
  children: ReactNode
  variant?: PublicButtonVariant
  className?: string
  ariaLabel?: string
}

const buttonVariants: Record<PublicButtonVariant, string> = {
  primary: 'bg-cyan-400 text-slate-950 shadow-[0_18px_45px_rgba(34,211,238,0.22)] hover:-translate-y-0.5 hover:bg-cyan-300 hover:shadow-[0_22px_55px_rgba(34,211,238,0.28)]',
  secondary: 'border border-white/20 bg-white/[0.08] text-white hover:-translate-y-0.5 hover:border-white/35 hover:bg-white/[0.14]',
  dark: 'bg-slate-950 text-white shadow-[0_18px_45px_rgba(15,23,42,0.16)] hover:-translate-y-0.5 hover:bg-slate-800',
  light: 'bg-white text-slate-950 shadow-[0_18px_45px_rgba(15,23,42,0.12)] hover:-translate-y-0.5 hover:bg-slate-50',
  outline: 'border border-slate-300 bg-white text-slate-800 hover:-translate-y-0.5 hover:border-cyan-300 hover:bg-cyan-50/70 hover:text-cyan-900',
  text: 'px-0 text-cyan-700 hover:text-cyan-900',
}

export function PublicButtonLink({ to, children, variant = 'primary', className, ariaLabel }: PublicButtonLinkProps) {
  const classes = cx(
    'inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl px-5 py-3 text-sm font-semibold leading-none transition duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-500',
    buttonVariants[variant],
    className,
  )

  if (isInternalHref(to)) {
    return <Link to={to} className={classes} aria-label={ariaLabel}>{children}</Link>
  }

  return (
    <a
      href={to}
      className={classes}
      aria-label={ariaLabel}
      target={to.startsWith('http') ? '_blank' : undefined}
      rel={to.startsWith('http') ? 'noopener noreferrer' : undefined}
    >
      {children}
    </a>
  )
}

export function ArrowRightIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M5 12h14m-6-6 6 6-6 6" />
    </svg>
  )
}

export function CheckIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.4} d="m5 12 4 4L19 7" />
    </svg>
  )
}

export function PlaneIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.9} d="M10.5 20.25 13 13l7.25-2.5a1.15 1.15 0 0 0 .06-2.15L4.55 2.45a1.15 1.15 0 0 0-1.46 1.46L9 19.68a1.15 1.15 0 0 0 1.5.57Z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.9} d="m9.25 14.75 4.3-4.3" />
    </svg>
  )
}

export function RouteIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.9} d="M6.75 17.25c-2.5 0-4-1.4-4-3.25 0-2 1.7-3.25 4-3.25h10.5c2.5 0 4-1.4 4-3.25s-1.5-3.25-4-3.25" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.9} d="M6.75 20.25a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM17.25 7.75a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
    </svg>
  )
}

export function CameraIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.9} d="M4.75 7.75A2.75 2.75 0 0 1 7.5 5h1.4l1.05-1.45h4.1L15.1 5h1.4a2.75 2.75 0 0 1 2.75 2.75v8.5A2.75 2.75 0 0 1 16.5 19h-9a2.75 2.75 0 0 1-2.75-2.75v-8.5Z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.9} d="M12 15.5a3.25 3.25 0 1 0 0-6.5 3.25 3.25 0 0 0 0 6.5Z" />
    </svg>
  )
}

export function UsersIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.9} d="M16.5 19.25c0-2.35-2-4.25-4.5-4.25s-4.5 1.9-4.5 4.25" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.9} d="M12 12.25a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM19 18.25c0-1.55-.95-2.9-2.35-3.55M16.75 5.85a2.9 2.9 0 0 1 0 5.3M5 18.25c0-1.55.95-2.9 2.35-3.55M7.25 5.85a2.9 2.9 0 0 0 0 5.3" />
    </svg>
  )
}

export function PhoneIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.9} d="M6.6 4.75h2.55l1.2 4.1-1.65 1.2a11.8 11.8 0 0 0 5.25 5.25l1.2-1.65 4.1 1.2v2.55a2.1 2.1 0 0 1-2.35 2.1C9.85 18.8 5.2 14.15 4.5 7.1a2.1 2.1 0 0 1 2.1-2.35Z" />
    </svg>
  )
}

export function MessageIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.9} d="M5.25 6.75A3.25 3.25 0 0 1 8.5 3.5h7A3.25 3.25 0 0 1 18.75 6.75v5.5A3.25 3.25 0 0 1 15.5 15.5h-3.6l-4.15 4v-4A3.25 3.25 0 0 1 5.25 12.25v-5.5Z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.9} d="M8.75 8.25h6.5M8.75 11.25h4.75" />
    </svg>
  )
}

export function MailIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.9} d="M5.75 6.75h12.5A1.75 1.75 0 0 1 20 8.5v7a1.75 1.75 0 0 1-1.75 1.75H5.75A1.75 1.75 0 0 1 4 15.5v-7a1.75 1.75 0 0 1 1.75-1.75Z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.9} d="m5 8 7 5 7-5" />
    </svg>
  )
}

export function PinIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.9} d="M12 21s6.25-5.2 6.25-11.25a6.25 6.25 0 1 0-12.5 0C5.75 15.8 12 21 12 21Z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.9} d="M12 12.25a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" />
    </svg>
  )
}

export function ClockIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.9} d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.9} d="M12 7.5V12l3 1.75" />
    </svg>
  )
}

export function ExternalLinkIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5h5v5m-.5-4.5L11 13" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14v3.25A1.75 1.75 0 0 1 17.25 19H6.75A1.75 1.75 0 0 1 5 17.25V6.75A1.75 1.75 0 0 1 6.75 5H10" />
    </svg>
  )
}

export function SocialIcon({ socialKey, className = 'h-4 w-4' }: { socialKey: string; className?: string }) {
  const normalized = socialKey.toLowerCase()

  if (normalized.includes('instagram')) {
    return (
      <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <rect width="15.5" height="15.5" x="4.25" y="4.25" rx="4" strokeWidth="1.9" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.9" d="M15.25 11.55a3.25 3.25 0 1 1-6.5.9 3.25 3.25 0 0 1 6.5-.9Z" />
        <path strokeLinecap="round" strokeWidth="2.2" d="M16.9 7.75h.01" />
      </svg>
    )
  }

  if (normalized.includes('facebook')) {
    return (
      <svg className={className} fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M13.35 20.4v-7.25h2.43l.37-2.83h-2.8V8.52c0-.82.23-1.38 1.4-1.38h1.5V4.6c-.26-.03-1.15-.1-2.18-.1-2.16 0-3.64 1.32-3.64 3.74v2.08H8v2.83h2.43v7.25h2.92Z" />
      </svg>
    )
  }

  if (normalized.includes('tiktok')) {
    return (
      <svg className={className} fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M15.85 4.5c.2 1.7 1.14 3.05 2.9 3.42v2.9a6.08 6.08 0 0 1-2.9-.77v4.75c0 3.05-1.86 4.7-4.45 4.7-2.47 0-4.15-1.62-4.15-3.9 0-2.65 2.23-4.25 4.95-3.82v2.95c-1.12-.34-2.08.11-2.08.9 0 .65.52 1.08 1.27 1.08.86 0 1.43-.47 1.43-1.65V4.5h3.03Z" />
      </svg>
    )
  }

  return <ExternalLinkIcon className={className} />
}

export function SectionEyebrow({ children, light = false, className }: { children: ReactNode; light?: boolean; className?: string }) {
  return (
    <p className={cx('text-xs font-bold uppercase tracking-[0.18em]', light ? 'text-cyan-200' : 'text-cyan-700', className)}>
      {children}
    </p>
  )
}

interface SectionHeaderProps {
  eyebrow: ReactNode
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  invert?: boolean
  className?: string
}

export function SectionHeader({ eyebrow, title, description, action, invert = false, className }: SectionHeaderProps) {
  return (
    <div className={cx('mb-9 flex flex-col gap-5 md:mb-11 md:flex-row md:items-end md:justify-between', className)}>
      <div className="max-w-3xl">
        <SectionEyebrow light={invert}>{eyebrow}</SectionEyebrow>
        <h2 className={cx('mt-3 text-3xl font-bold tracking-tight md:text-4xl', invert ? 'text-white' : 'text-slate-950')}>
          {title}
        </h2>
        {description && (
          <p className={cx('mt-4 max-w-2xl text-sm leading-7 md:text-base', invert ? 'text-slate-300' : 'text-slate-600')}>
            {description}
          </p>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}

interface PublicPageHeroProps {
  eyebrow: ReactNode
  title: ReactNode
  description: ReactNode
  media?: SiteMedia | null
  fallbackSrc?: string
  fallbackAlt: string
  actions?: ReactNode
  children?: ReactNode
  mediaMode?: 'background' | 'side' | 'none'
  mediaLoading?: boolean
  compact?: boolean
}

export function PublicPageHero({
  eyebrow,
  title,
  description,
  media,
  fallbackSrc,
  fallbackAlt,
  actions,
  children,
  mediaMode = 'side',
  mediaLoading = false,
  compact = false,
}: PublicPageHeroProps) {
  const hasMedia = Boolean(media || fallbackSrc)
  const showBackgroundMedia = mediaMode === 'background' && hasMedia
  const showSideMedia = mediaMode === 'side' && hasMedia

  return (
    <section className="relative overflow-hidden bg-slate-950 text-white">
      <div className="absolute inset-0">
        {showBackgroundMedia ? (
          <SiteMediaFrame
            media={media}
            fallbackSrc={fallbackSrc}
            fallbackAlt={fallbackAlt}
            hero
            loading={mediaLoading}
            className="h-full w-full"
            mediaClassName="h-full w-full object-cover opacity-30"
          />
        ) : (
          <div className="h-full w-full bg-[radial-gradient(circle_at_18%_20%,rgba(34,211,238,0.18),transparent_32%),radial-gradient(circle_at_85%_10%,rgba(45,90,142,0.34),transparent_34%),linear-gradient(135deg,#020617,#0f172a_58%,#12384d)]" />
        )}
        <div className="absolute inset-0 bg-[linear-gradient(115deg,rgba(2,6,23,0.94),rgba(15,23,42,0.84)_48%,rgba(14,116,144,0.26))]" />
        <div className="absolute inset-0 dot-pattern opacity-30" />
      </div>

      <div className={cx(
        'relative mx-auto grid max-w-6xl gap-8 px-4 sm:px-6 lg:px-8',
        compact ? 'py-14 md:py-20' : 'py-16 md:py-24',
        showSideMedia && 'lg:grid-cols-[0.92fr_1.08fr] lg:items-center',
      )}>
        <div className="max-w-3xl">
          <SectionEyebrow light>{eyebrow}</SectionEyebrow>
          <h1 className="mt-3 text-4xl font-bold leading-[0.98] tracking-tight text-white sm:text-5xl lg:text-6xl">
            {title}
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-8 text-slate-200 md:text-lg">
            {description}
          </p>
          {actions && <div className="mt-7 flex flex-wrap gap-3">{actions}</div>}
        </div>

        {showSideMedia && (
          <div className="overflow-hidden rounded-[2rem] border border-white/10 bg-white/[0.08] p-2 shadow-2xl shadow-slate-950/40 backdrop-blur-sm">
            <SiteMediaFrame
              media={media}
              fallbackSrc={fallbackSrc}
              fallbackAlt={fallbackAlt}
              priority
              loading={mediaLoading}
              className="aspect-[16/10] rounded-[1.45rem]"
              mediaClassName="h-full w-full object-cover"
            />
          </div>
        )}

        {children}
      </div>
    </section>
  )
}

export function CheckList({ items, light = false }: { items: string[]; light?: boolean }) {
  return (
    <div className="space-y-3">
      {items.map((item) => (
        <div key={item} className={cx('flex gap-3 text-sm leading-7', light ? 'text-slate-300' : 'text-slate-600')}>
          <span className={cx('mt-1 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full', light ? 'bg-cyan-300/15 text-cyan-200' : 'bg-cyan-50 text-cyan-700')}>
            <CheckIcon className="h-3.5 w-3.5" />
          </span>
          <span>{item}</span>
        </div>
      ))}
    </div>
  )
}

export function CardIcon({ children, dark = false }: { children: ReactNode; dark?: boolean }) {
  return (
    <span className={cx('inline-flex h-11 w-11 items-center justify-center rounded-2xl', dark ? 'border border-white/10 bg-white/10 text-cyan-200' : 'border border-cyan-100 bg-cyan-50 text-cyan-700')}>
      {children}
    </span>
  )
}
