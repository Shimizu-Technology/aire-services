import { useEffect, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import SiteMediaFrame from '../../components/site/SiteMediaFrame'
import { useSiteMedia } from '../../lib/siteMedia'
import type { SiteMediaPlacement } from '../../lib/api'
import { usePublicBusinessInfo } from '../../contexts/publicBusinessInfo'
import { isInternalHref } from '../../lib/publicLinks'
import {
  ArrowRightIcon,
  CameraIcon,
  CardIcon,
  CheckIcon,
  ClockIcon,
  PlaneIcon,
  PublicButtonLink,
  RouteIcon,
  SectionHeader,
} from '../../components/public/PublicPrimitives'

const pillars = [
  {
    title: 'Pilot Training',
    description: 'Private Pilot Certificate training with a local Guam-based team and a clear starting path for future pilots.',
    cta: 'Explore training',
    href: '/programs',
    icon: PlaneIcon,
  },
  {
    title: 'Guam Aerial Tours',
    description: 'Bay, Island, and Sunset routes built around Guam landmarks, scenic coastline, and a simple visitor-friendly experience.',
    cta: 'See tour options',
    href: '/programs',
    icon: RouteIcon,
  },
  {
    title: 'Video Packages',
    description: 'Add edited 4K content, social reels, and photo deliverables to your tour with standard or all-inclusive packages.',
    cta: 'Compare packages',
    href: '/programs',
    icon: CameraIcon,
  },
]

const tours = [
  {
    title: 'Bay Tour',
    price: '$275',
    duration: '30 minutes',
    landmarks: "Two Lovers' Point, Tumon Bay, Chamorro Village, Fish Eye",
  },
  {
    title: 'Island Tour',
    price: '$395',
    duration: '60 minutes',
    landmarks: 'Pago Bay, Talofofo Bay, Inarajan Pool, Cocos Island',
  },
  {
    title: 'Sunset Tour',
    price: '$345',
    duration: '45 minutes',
    landmarks: "Two Lovers' Point, Tumon Bay, Chamorro Village, Fish Eye, Agat Marina",
  },
]

const videoPackages = [
  {
    title: 'Standard',
    prices: 'Bay $79, Sunset $89, Island $99',
    features: ['10 images', '1 social media reel', '3-5 minutes edited video'],
  },
  {
    title: 'All Inclusive',
    prices: 'Bay $129, Sunset $139, Island $149',
    features: ['10 images', '3 social media reels', '3-5 minutes edited video', 'Raw footage'],
  },
]

const trainingPath = [
  {
    title: 'Start with a conversation',
    description: 'Talk with the AIRE team about your goals, schedule, and the best place to begin.',
  },
  {
    title: 'Build knowledge and flight skill',
    description: 'Move through ground study, FAA prep, and instructor-led flight training with a Guam-based team.',
  },
  {
    title: 'Keep progressing toward your certificate',
    description: 'Build confidence step by step as you work toward the Private Pilot Certificate with local instructor support.',
  },
]

const heroTracks = [
  {
    title: 'Flight training',
    description: 'Work toward a Private Pilot Certificate with local instructor support.',
    icon: PlaneIcon,
  },
  {
    title: 'Scenic tours',
    description: 'Choose Bay, Island, or Sunset routes with published starting prices.',
    icon: RouteIcon,
  },
  {
    title: 'Media add-ons',
    description: 'Add edited 4K video, social reels, stills, and optional raw footage.',
    icon: CameraIcon,
  },
]

const homeMediaPlacements: SiteMediaPlacement[] = ['home_hero', 'home_training', 'home_tours', 'home_video', 'tour_bay', 'tour_island', 'tour_sunset', 'programs_video']

function SmartStatLink({ href, children, className = '' }: { href: string; children: ReactNode; className?: string }) {
  if (isInternalHref(href)) {
    return <Link to={href} className={className}>{children}</Link>
  }

  return <a href={href} className={className}>{children}</a>
}

export default function AireHome() {
  useEffect(() => { document.title = 'AIRE Services Guam | Pilot Training, Tours, and Video Packages' }, [])
  const { firstFor, loading: mediaLoading } = useSiteMedia(homeMediaPlacements)
  const businessInfo = usePublicBusinessInfo()
  const quickStats = [
    { label: 'Call AIRE', value: businessInfo.phone.display, href: businessInfo.phone.href },
    { label: 'Bay Tour', value: 'From $275', href: '/programs' },
    { label: 'Video Add-On', value: 'From $79', href: '/programs' },
    { label: 'Local + Military', value: 'Ask for rates', href: '/contact' },
  ]

  const pillarMedia: Record<string, ReturnType<typeof firstFor>> = {
    'Pilot Training': firstFor('home_training'),
    'Guam Aerial Tours': firstFor('home_tours'),
    'Video Packages': firstFor('home_video'),
  }

  const tourMedia: Record<string, ReturnType<typeof firstFor>> = {
    'Bay Tour': firstFor('tour_bay'),
    'Island Tour': firstFor('tour_island'),
    'Sunset Tour': firstFor('tour_sunset'),
  }

  return (
    <div className="bg-white text-slate-950">
      <section className="relative overflow-hidden bg-slate-950 text-white">
        <div className="absolute inset-0">
          <SiteMediaFrame
            media={firstFor('home_hero')}
            fallbackSrc="/assets/aire/hero.jpg"
            fallbackAlt="AIRE Services aircraft flying over Guam"
            hero
            loading={mediaLoading}
            className="h-full w-full"
            mediaClassName="h-full w-full object-cover opacity-[0.34]"
          />
          <div className="absolute inset-0 bg-[linear-gradient(112deg,rgba(2,6,23,0.97),rgba(15,23,42,0.88)_48%,rgba(14,116,144,0.34))]" />
          <div className="absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-slate-950/70 to-transparent" />
        </div>

        <div className="relative mx-auto grid max-w-6xl gap-9 px-4 py-12 sm:px-6 sm:py-16 lg:grid-cols-[1.02fr_0.98fr] lg:items-center lg:px-8 lg:py-20">
          <div>
            <p className="inline-flex max-w-full rounded-full border border-white/15 bg-white/10 px-4 py-1.5 text-[11px] font-bold uppercase tracking-[0.18em] text-cyan-200 shadow-sm backdrop-blur-sm sm:text-xs">
              Guam aviation experiences
            </p>
            <h1 className="mt-5 max-w-3xl text-4xl font-bold leading-[0.98] tracking-tight sm:text-5xl lg:text-6xl xl:text-7xl">
              Fly Guam with AIRE.
            </h1>
            <p className="mt-5 max-w-2xl text-xl font-semibold leading-tight text-white sm:text-2xl lg:text-3xl">
              Pilot training, scenic aerial tours, and cinematic media packages.
            </p>
            <p className="mt-5 max-w-2xl text-base leading-8 text-slate-200 md:text-lg">
              Train with Guam-based instructors, book a visitor-friendly tour, or add video deliverables that preserve the full experience.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <PublicButtonLink to="/programs" variant="primary">
                Explore services <ArrowRightIcon />
              </PublicButtonLink>
              <PublicButtonLink to="/contact" variant="secondary">
                Contact AIRE
              </PublicButtonLink>
            </div>

            <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:max-w-[38rem]">
              {quickStats.map((item) => (
                <SmartStatLink
                  key={item.label}
                  href={item.href}
                  className="group rounded-2xl border border-white/10 bg-white/[0.06] px-3 py-4 text-center shadow-sm backdrop-blur-sm transition duration-200 hover:-translate-y-0.5 hover:border-cyan-300/40 hover:bg-white/[0.1]"
                >
                  <div className="text-base font-bold leading-tight text-white sm:text-lg">{item.value}</div>
                  <div className="mt-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-300">{item.label}</div>
                </SmartStatLink>
              ))}
            </div>
          </div>

          <div className="hidden rounded-[2rem] border border-white/10 bg-white/[0.07] p-4 shadow-2xl shadow-slate-950/35 backdrop-blur-md sm:p-5 lg:block lg:p-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-200">Choose your route</p>
                <h2 className="mt-2 text-2xl font-bold tracking-tight text-white">Three ways to fly with AIRE.</h2>
              </div>
              <span className="hidden h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-white/10 text-cyan-200 sm:inline-flex">
                <PlaneIcon className="h-7 w-7" />
              </span>
            </div>

            <div className="mt-5 space-y-3">
              {heroTracks.map((track) => {
                const Icon = track.icon
                return (
                  <div key={track.title} className="group rounded-2xl border border-white/10 bg-slate-950/[0.32] p-4 transition duration-200 hover:border-cyan-300/30 hover:bg-slate-950/[0.45]">
                    <div className="flex gap-4">
                      <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-cyan-200/15 bg-cyan-300/10 text-cyan-200">
                        <Icon />
                      </span>
                      <div>
                        <h3 className="text-base font-semibold text-white">{track.title}</h3>
                        <p className="mt-1 text-sm leading-6 text-slate-300">{track.description}</p>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </section>

      <section className="py-16 md:py-24">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
          <SectionHeader
            eyebrow="Core services"
            title="A cleaner path from interest to takeoff"
            description="AIRE keeps the public offer simple: flight training for future pilots, scenic routes for guests, and media packages for people who want the memory captured well."
            action={(
              <PublicButtonLink to="/programs" variant="text" className="min-h-10 rounded-none">
                View full service details <ArrowRightIcon />
              </PublicButtonLink>
            )}
          />

          <div className="grid gap-5 lg:grid-cols-3">
            {pillars.map((pillar) => {
              const Icon = pillar.icon
              return (
                <Link
                  key={pillar.title}
                  to={pillar.href}
                  className="group overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-[0_18px_50px_rgba(15,23,42,0.06)] transition duration-300 hover:-translate-y-1 hover:border-cyan-200 hover:shadow-[0_24px_70px_rgba(14,116,144,0.12)]"
                >
                  {mediaLoading || pillarMedia[pillar.title] ? (
                    <SiteMediaFrame
                      media={pillarMedia[pillar.title]}
                      fallbackAlt={pillar.title}
                      loading={mediaLoading}
                      className="aspect-[16/10]"
                      mediaClassName="h-full w-full object-cover transition duration-700 group-hover:scale-105"
                    />
                  ) : (
                    <div className="flex h-32 items-end bg-[radial-gradient(circle_at_20%_20%,rgba(34,211,238,0.18),transparent_36%),linear-gradient(135deg,#f8fafc,#e0f2fe)] p-6 sm:h-36">
                      <CardIcon><Icon /></CardIcon>
                    </div>
                  )}
                  <div className="p-6">
                    {pillarMedia[pillar.title] && <CardIcon><Icon /></CardIcon>}
                    <h3 className="mt-5 text-xl font-bold tracking-tight text-slate-950">{pillar.title}</h3>
                    <p className="mt-3 text-sm leading-7 text-slate-600">{pillar.description}</p>
                    <div className="mt-6 inline-flex items-center gap-2 text-sm font-bold text-cyan-700 transition group-hover:text-cyan-900">
                      {pillar.cta} <ArrowRightIcon />
                    </div>
                  </div>
                </Link>
              )
            })}
          </div>
        </div>
      </section>

      <section className="bg-slate-50 py-16 md:py-24">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
          <SectionHeader
            eyebrow="Guam aerial tours"
            title="Published routes, clear starting prices"
            description="Three scenic options give guests a straightforward way to choose the right duration, route, and add-on package."
          />

          <div className="grid gap-5 lg:grid-cols-3">
            {tours.map((tour) => (
              <div key={tour.title} className="group overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-[0_18px_50px_rgba(15,23,42,0.07)] transition duration-300 hover:-translate-y-1 hover:shadow-[0_24px_70px_rgba(15,23,42,0.1)]">
                {(mediaLoading || tourMedia[tour.title]) && (
                  <SiteMediaFrame
                    media={tourMedia[tour.title]}
                    fallbackAlt={`${tour.title} aerial route`}
                    loading={mediaLoading}
                    className="aspect-[16/10]"
                    mediaClassName="h-full w-full object-cover transition duration-700 group-hover:scale-105"
                  />
                )}
                <div className="p-6">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-700">{tour.title}</p>
                      <h3 className="mt-2 text-4xl font-bold tracking-tight text-slate-950">{tour.price}</h3>
                    </div>
                    <div className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-bold uppercase tracking-[0.12em] text-slate-600">
                      <ClockIcon className="h-3.5 w-3.5" />
                      {tour.duration}
                    </div>
                  </div>
                  <p className="mt-5 text-sm leading-7 text-slate-600">{tour.landmarks}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-8 flex gap-4 rounded-[2rem] border border-amber-200 bg-amber-50 px-5 py-5 text-sm leading-7 text-slate-700 sm:px-6">
            <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700">
              <CheckIcon className="h-4 w-4" />
            </span>
            <p>Local residents and military members qualify for discounted rates. Contact AIRE directly for those details.</p>
          </div>
        </div>
      </section>

      <section className="py-16 md:py-24">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
          <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
            <div className="overflow-hidden rounded-[2rem] bg-slate-950 text-white shadow-[0_24px_70px_rgba(15,23,42,0.2)]">
              {(mediaLoading || firstFor('programs_video')) && (
                <SiteMediaFrame
                  media={firstFor('programs_video')}
                  fallbackAlt="AIRE aerial video package sample"
                  loading={mediaLoading}
                  className="aspect-video"
                  controls
                />
              )}
              <div className="p-7 sm:p-8">
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-200">Video packages</p>
                <h2 className="mt-3 text-3xl font-bold tracking-tight">Edited content that matches the experience.</h2>
                <p className="mt-4 text-sm leading-7 text-slate-300">
                  Every package is built around 4K delivery, preferred theme selection, and a seven-day download window after the content is ready.
                </p>
                <div className="mt-6 grid gap-3 sm:grid-cols-3">
                  {['4K videos', 'Theme choice', '7-day download'].map((item) => (
                    <div key={item} className="rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-4 text-center">
                      <div className="text-sm font-bold text-white">{item}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="grid gap-5 md:grid-cols-2">
              {videoPackages.map((tier) => (
                <div key={tier.title} className="rounded-[2rem] border border-slate-200 bg-slate-50/70 p-6">
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-700">{tier.title}</p>
                  <h3 className="mt-2 text-2xl font-bold tracking-tight text-slate-950">{tier.prices}</h3>
                  <div className="mt-5 space-y-3">
                    {tier.features.map((feature) => (
                      <div key={feature} className="flex gap-3 text-sm leading-7 text-slate-600">
                        <span className="mt-1 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-cyan-50 text-cyan-700">
                          <CheckIcon className="h-3.5 w-3.5" />
                        </span>
                        <span>{feature}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="bg-slate-50 py-16 md:py-24">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
          <SectionHeader
            eyebrow="Training path"
            title="How flight training starts with AIRE"
            description="A practical beginning for people who want to understand the next step before committing to a full program."
          />

          <div className="grid gap-5 md:grid-cols-3">
            {trainingPath.map((step, index) => (
              <div key={step.title} className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-[0_18px_50px_rgba(15,23,42,0.06)]">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-950 text-sm font-bold text-cyan-200">{index + 1}</div>
                <h3 className="mt-5 text-xl font-bold tracking-tight text-slate-950">{step.title}</h3>
                <p className="mt-3 text-sm leading-7 text-slate-600">{step.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-16 md:py-24">
        <div className="mx-auto grid max-w-6xl gap-8 rounded-[2rem] bg-slate-950 px-6 py-10 text-white shadow-[0_24px_70px_rgba(15,23,42,0.18)] sm:px-8 lg:grid-cols-[1fr_auto] lg:items-center lg:px-10">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-200">Ready to plan?</p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight">Talk with AIRE about training, tours, or your video package add-on.</h2>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-300 md:text-base">
              If you need help picking the right tour, understanding training, or confirming local and military pricing, reach out directly and the team can guide you.
            </p>
          </div>
          <div className="flex flex-wrap gap-3 lg:justify-end">
            <PublicButtonLink to="/contact" variant="primary">Contact AIRE</PublicButtonLink>
            <PublicButtonLink to="/programs" variant="secondary">View pricing</PublicButtonLink>
          </div>
        </div>
      </section>
    </div>
  )
}
