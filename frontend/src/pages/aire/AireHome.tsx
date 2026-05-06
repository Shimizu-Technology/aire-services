import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import SiteMediaFrame from '../../components/site/SiteMediaFrame'
import { useSiteMedia } from '../../lib/siteMedia'
import type { SiteMediaPlacement } from '../../lib/api'
import { aireBusinessInfo } from '../../lib/businessInfo'

const pillars = [
  {
    title: 'Pilot Training',
    description: 'Private Pilot Certificate training with a local Guam-based team and a clear starting path for future pilots.',
    cta: 'Explore training',
    href: '/programs',
  },
  {
    title: 'Guam Aerial Tours',
    description: 'Bay, Island, and Sunset tours built around Guam landmarks, scenic coastline, and a simple visitor-friendly experience.',
    cta: 'See tour options',
    href: '/programs',
  },
  {
    title: 'Video Packages',
    description: 'Add edited 4K content, social reels, and photo deliverables to your tour with standard or all-inclusive packages.',
    cta: 'Compare packages',
    href: '/programs',
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

const quickStats = [
  { label: 'Call AIRE', value: aireBusinessInfo.phone.display, href: aireBusinessInfo.phone.href },
  { label: 'Bay Tour', value: 'From $275', href: '/programs' },
  { label: 'Video Add-On', value: 'From $79', href: '/programs' },
  { label: 'Local + Military', value: 'Contact for rates', href: '/contact' },
]

const homeMediaPlacements: SiteMediaPlacement[] = ['home_hero', 'home_training', 'home_tours', 'home_video', 'tour_bay', 'tour_island', 'tour_sunset', 'programs_video']

export default function AireHome() {
  useEffect(() => { document.title = 'AIRE Services Guam | Pilot Training, Tours, and Video Packages' }, [])
  const { firstFor } = useSiteMedia(homeMediaPlacements)

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
    <div className="bg-white text-slate-900">
      <section className="relative overflow-hidden bg-slate-950 text-white">
        <div className="absolute inset-0">
          <SiteMediaFrame
            media={firstFor('home_hero')}
            fallbackSrc="/assets/aire/hero.jpg"
            fallbackAlt="AIRE Services aircraft flying over Guam"
            hero
            className="h-full w-full"
            mediaClassName="h-full w-full object-cover opacity-35"
          />
          <div className="absolute inset-0 bg-[linear-gradient(122deg,rgba(2,6,23,0.96),rgba(15,23,42,0.82),rgba(14,116,144,0.32))]" />
        </div>
        <div className="relative mx-auto grid max-w-6xl gap-10 px-4 py-20 sm:px-6 md:py-28 lg:grid-cols-[1.1fr_0.9fr] lg:px-8">
          <div>
            <p className="inline-flex rounded-full border border-white/15 bg-white/10 px-4 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-cyan-200">
              Guam aviation experiences
            </p>
            <h1 className="mt-6 max-w-3xl text-4xl font-bold leading-tight tracking-tight md:text-6xl">
              Pilot training, Guam aerial tours, and cinematic video packages.
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-relaxed text-slate-200 md:text-lg">
              Train with Guam-based instructors, book a scenic aerial tour, or add a video package to capture the full experience.
            </p>
            <div className="mt-10 flex flex-wrap gap-3">
              <Link to="/programs" className="rounded-xl bg-cyan-400 px-6 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300">
                Explore Services
              </Link>
              <Link to="/contact" className="rounded-xl border border-white/25 px-6 py-3 text-sm font-semibold text-white transition hover:bg-white/10">
                Contact AIRE
              </Link>
              <Link to="/team" className="rounded-xl border border-cyan-300/70 px-6 py-3 text-sm font-semibold text-cyan-200 transition hover:bg-cyan-400/10">
                Meet the Team
              </Link>
            </div>
            <div className="mt-10 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {quickStats.map((item) => (
                <a
                  key={item.label}
                  href={item.href}
                  {...(item.href.startsWith('http') ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                  className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4 text-center backdrop-blur-sm transition hover:border-white/20 hover:bg-white/10"
                >
                  <div className="text-base font-bold text-white sm:text-lg">{item.value}</div>
                  <div className="mt-1 text-[11px] uppercase tracking-[0.12em] text-slate-300">{item.label}</div>
                </a>
              ))}
            </div>
          </div>

          <div className="rounded-[2rem] border border-white/10 bg-white/6 p-6 backdrop-blur-sm lg:mt-10">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-cyan-200">Ways to fly with AIRE</p>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-white">Choose the experience that fits you.</h2>
            <div className="mt-6 space-y-4">
              <div className="rounded-2xl border border-white/10 bg-slate-900/35 px-4 py-4">
                <div className="text-sm font-semibold text-white">Flight training</div>
                <p className="mt-2 text-sm leading-relaxed text-slate-200">
                  Start working toward a Private Pilot Certificate with a local instructor team.
                </p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-slate-900/35 px-4 py-4">
                <div className="text-sm font-semibold text-white">Scenic tours</div>
                <p className="mt-2 text-sm leading-relaxed text-slate-200">
                  Choose from Bay, Island, and Sunset routes with clear pricing and memorable views.
                </p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-slate-900/35 px-4 py-4">
                <div className="text-sm font-semibold text-white">Video packages</div>
                <p className="mt-2 text-sm leading-relaxed text-slate-200">
                  Add edited 4K video, social reels, stills, and optional raw footage.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="py-16 md:py-24">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
          <div className="mb-10 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-cyan-700">Core Services</p>
              <h2 className="mt-2 text-3xl font-bold tracking-tight text-slate-900 md:text-4xl">Training, tours, and video packages</h2>
            </div>
            <Link to="/programs" className="text-sm font-semibold text-cyan-700 hover:text-cyan-900">
              View full service details →
            </Link>
          </div>

          <div className="grid gap-5 md:grid-cols-3">
            {pillars.map((pillar) => (
              <Link
                key={pillar.title}
                to={pillar.href}
                className="group overflow-hidden rounded-[1.75rem] border border-slate-200 bg-slate-50/70 transition hover:-translate-y-0.5 hover:border-cyan-300 hover:bg-cyan-50/40"
              >
                {pillarMedia[pillar.title] && (
                  <SiteMediaFrame
                    media={pillarMedia[pillar.title]}
                    fallbackAlt={pillar.title}
                    className="aspect-[4/3]"
                    mediaClassName="h-full w-full object-cover transition duration-500 group-hover:scale-105"
                  />
                )}
                <div className="p-6">
                  <h3 className="text-lg font-semibold tracking-tight text-slate-900">{pillar.title}</h3>
                  <p className="mt-3 text-sm leading-relaxed text-slate-600">{pillar.description}</p>
                  <div className="mt-6 text-sm font-semibold text-cyan-700">{pillar.cta}</div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-slate-50 py-16 md:py-24">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-cyan-700">Guam Aerial Tours</p>
            <h2 className="mt-2 text-3xl font-bold tracking-tight text-slate-900 md:text-4xl">Scenic routes with clear pricing</h2>
          </div>

          <div className="mt-10 grid gap-5 lg:grid-cols-3">
            {tours.map((tour) => (
              <div key={tour.title} className="overflow-hidden rounded-[1.75rem] border border-slate-200 bg-white shadow-sm">
                {tourMedia[tour.title] && (
                  <SiteMediaFrame
                    media={tourMedia[tour.title]}
                    fallbackAlt={`${tour.title} aerial route`}
                    className="aspect-[16/10]"
                    mediaClassName="h-full w-full object-cover"
                  />
                )}
                <div className="p-6">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-cyan-700">{tour.title}</p>
                      <h3 className="mt-2 text-3xl font-bold tracking-tight text-slate-900">{tour.price}</h3>
                    </div>
                    <div className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-slate-600">
                      {tour.duration}
                    </div>
                  </div>
                  <p className="mt-5 text-sm leading-relaxed text-slate-600">{tour.landmarks}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-8 rounded-[1.75rem] border border-amber-200 bg-amber-50 px-6 py-5 text-sm leading-relaxed text-slate-700">
            Local residents and military members qualify for discounted rates. Contact AIRE directly for those details.
          </div>
        </div>
      </section>

      <section className="py-16 md:py-24">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
          <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
            <div className="overflow-hidden rounded-[2rem] bg-slate-950 text-white">
              {firstFor('programs_video') && (
                <SiteMediaFrame
                  media={firstFor('programs_video')}
                  fallbackAlt="AIRE aerial video package sample"
                  className="aspect-video"
                  controls
                />
              )}
              <div className="p-8">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-cyan-200">Video Packages</p>
              <h2 className="mt-3 text-3xl font-bold tracking-tight">Add edited content that matches the experience.</h2>
              <p className="mt-4 text-sm leading-relaxed text-slate-300">
                Every package is built around 4K delivery, preferred theme selection, and a seven-day download window after the content is ready.
              </p>
              <div className="mt-6 grid gap-3 sm:grid-cols-3">
                <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4 text-center">
                  <div className="text-lg font-bold text-white">4K</div>
                  <div className="mt-1 text-[11px] uppercase tracking-[0.12em] text-slate-300">Videos</div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4 text-center">
                  <div className="text-lg font-bold text-white">Custom</div>
                  <div className="mt-1 text-[11px] uppercase tracking-[0.12em] text-slate-300">Theme choice</div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4 text-center">
                  <div className="text-lg font-bold text-white">7 Days</div>
                  <div className="mt-1 text-[11px] uppercase tracking-[0.12em] text-slate-300">To download</div>
                </div>
              </div>
              </div>
            </div>

            <div className="grid gap-5 md:grid-cols-2">
              {videoPackages.map((tier) => (
                <div key={tier.title} className="rounded-[1.75rem] border border-slate-200 bg-slate-50/70 p-6">
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-cyan-700">{tier.title}</p>
                  <h3 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">{tier.prices}</h3>
                  <div className="mt-5 space-y-3">
                    {tier.features.map((feature) => (
                      <div key={feature} className="flex gap-3 text-sm leading-relaxed text-slate-600">
                        <span className="mt-1 text-cyan-700">•</span>
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
          <div className="max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-cyan-700">Training Path</p>
            <h2 className="mt-2 text-3xl font-bold tracking-tight text-slate-900 md:text-4xl">How flight training starts with AIRE</h2>
          </div>

          <div className="mt-10 grid gap-5 md:grid-cols-3">
            {trainingPath.map((step, index) => (
              <div key={step.title} className="rounded-[1.75rem] border border-slate-200 bg-white p-6 shadow-sm">
                <div className="text-sm font-semibold uppercase tracking-[0.12em] text-cyan-700">Step {index + 1}</div>
                <h3 className="mt-3 text-xl font-semibold tracking-tight text-slate-900">{step.title}</h3>
                <p className="mt-3 text-sm leading-relaxed text-slate-600">{step.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-16 md:py-24">
        <div className="mx-auto grid max-w-6xl gap-8 rounded-[2rem] bg-slate-950 px-6 py-10 text-white sm:px-8 lg:grid-cols-[1fr_auto] lg:items-center lg:px-10">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-cyan-200">Ready to plan?</p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight">Talk with AIRE about training, tours, or your video package add-on.</h2>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-slate-300 md:text-base">
              If you need help picking the right tour, understanding training, or confirming local and military pricing, reach out directly and the team can guide you.
            </p>
          </div>
          <div className="flex flex-wrap gap-3 lg:justify-end">
            <Link to="/contact" className="rounded-xl bg-cyan-400 px-6 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300">
              Contact AIRE
            </Link>
            <Link to="/programs" className="rounded-xl border border-white/20 px-6 py-3 text-sm font-semibold text-white transition hover:bg-white/10">
              View Pricing
            </Link>
          </div>
        </div>
      </section>
    </div>
  )
}
