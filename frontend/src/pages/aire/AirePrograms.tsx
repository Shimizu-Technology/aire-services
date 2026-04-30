import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import SiteMediaFrame from '../../components/site/SiteMediaFrame'
import type { SiteMediaPlacement } from '../../lib/api'
import { useSiteMedia } from '../../lib/siteMedia'

const trainingHighlights = [
  'Private Pilot Certificate training is the foundation of the AIRE flight-training program.',
  'Guam-based instructors help students build confidence, knowledge, and flight skill close to home.',
  'Discovery flights are available for people who want an introductory flight before starting training.',
]

const tours = [
  {
    title: 'Bay Tour',
    price: '$275',
    duration: '30 minutes',
    details: ['Max 3 pax per flight', "Two Lovers' Point", 'Tumon Bay', 'Chamorro Village', 'Fish Eye'],
  },
  {
    title: 'Island Tour',
    price: '$395',
    duration: '60 minutes',
    details: ['Max 3 pax per flight', 'Pago Bay', 'Talofofo Bay', 'Inarajan Pool', 'Cocos Island'],
  },
  {
    title: 'Sunset Tour',
    price: '$345',
    duration: '45 minutes',
    details: ['Max 3 pax per flight', "Two Lovers' Point", 'Tumon Bay', 'Chamorro Village', 'Fish Eye', 'Agat Marina'],
  },
]

const videoPackages = [
  {
    title: 'Standard Video Package',
    prices: ['Bay $79', 'Sunset $89', 'Island $99'],
    features: ['10 images', '1 social media reel', '3-5 minutes edited video'],
  },
  {
    title: 'All Inclusive Video Package',
    prices: ['Bay $129', 'Sunset $139', 'Island $149'],
    features: ['10 images', '3 social media reels', '3-5 minutes edited video', 'Raw footage'],
  },
]

const notes = [
  'Local residents and military members qualify for discounted rates. Contact AIRE for details.',
  'Guests of all ages can enjoy the experience.',
  'Use of personal recording devices is not allowed during flight.',
  'Video packages include 4K delivery, your preferred editing theme, and a 7-day download window.',
  'Basic edits may remove taxiing, ramp movement, hold-short time, and other nonessential footage.',
  'AIRE Services may exclude footage that could affect U.S. national security or the privacy of individuals who have not granted permission.',
]

const programsMediaPlacements: SiteMediaPlacement[] = ['programs_hero', 'programs_training', 'tour_bay', 'tour_island', 'tour_sunset', 'programs_video']

export default function AirePrograms() {
  useEffect(() => { document.title = 'Programs & Services | AIRE Services Guam' }, [])
  const { firstFor } = useSiteMedia(programsMediaPlacements)
  const tourMedia = {
    'Bay Tour': firstFor('tour_bay'),
    'Island Tour': firstFor('tour_island'),
    'Sunset Tour': firstFor('tour_sunset'),
  }

  return (
    <div className="bg-white py-14 md:py-20">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="grid gap-8 lg:grid-cols-[0.95fr_1.05fr] lg:items-center">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-cyan-700">Programs & Services</p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900 md:text-5xl">Pilot training, scenic tours, and video packages</h1>
            <p className="mt-4 text-sm leading-relaxed text-slate-600 md:text-base">
              Explore AIRE's flight training, scenic aerial tours, and add-on media packages. Reach out for scheduling, local and military rates, or discovery flight questions.
            </p>
          </div>
          <SiteMediaFrame
            media={firstFor('programs_hero')}
            fallbackSrc="/assets/aire/hero.jpg"
            fallbackAlt="AIRE Services scenic Guam flight"
            className="aspect-[16/10] rounded-[2rem] shadow-sm"
            mediaClassName="h-full w-full object-cover"
          />
        </div>

        <section className="mt-10 grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
          <div className="overflow-hidden rounded-[2rem] border border-slate-200 bg-slate-50/70">
            <SiteMediaFrame
              media={firstFor('programs_training')}
              fallbackSrc="/assets/aire/hero.jpg"
              fallbackAlt="Private pilot training with AIRE Services Guam"
              className="aspect-[16/9]"
              mediaClassName="h-full w-full object-cover"
            />
            <div className="p-7">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-cyan-700">Pilot Training</p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900 md:text-3xl">Private Pilot Certificate training</h2>
            <div className="mt-6 space-y-3 text-sm leading-relaxed text-slate-600">
              {trainingHighlights.map((item) => (
                <div key={item} className="flex gap-3">
                  <span className="mt-1 text-cyan-700">•</span>
                  <span>{item}</span>
                </div>
              ))}
            </div>
            <div className="mt-6 rounded-2xl border border-cyan-200 bg-cyan-50/70 p-5 text-sm leading-relaxed text-slate-700">
              Interested in a first flight before committing to training? Ask about a discovery flight.
            </div>
            </div>
          </div>

          <div className="rounded-[2rem] bg-slate-950 p-7 text-white">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-cyan-200">Tours and Media</p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight">Scenic tours with optional video packages</h2>
            <p className="mt-4 text-sm leading-relaxed text-slate-300">
              Guests can choose scenic tour options and then add a standard or all-inclusive video package depending on how much finished content they want.
            </p>
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4">
                <div className="text-sm font-semibold text-white">Tours</div>
                <p className="mt-2 text-sm text-slate-300">Bay, Island, and Sunset routes with fixed durations and published pricing.</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4">
                <div className="text-sm font-semibold text-white">Add-on content</div>
                <p className="mt-2 text-sm text-slate-300">4K edited delivery, reels, stills, and optional raw footage.</p>
              </div>
            </div>
          </div>
        </section>

        <section className="mt-10">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-cyan-700">Guam Aerial Tours</p>
              <h2 className="mt-2 text-3xl font-bold tracking-tight text-slate-900 md:text-4xl">Route options and pricing</h2>
            </div>
            <div className="text-sm text-slate-500">All tours list max capacity as 3 passengers per flight.</div>
          </div>

          <div className="mt-8 grid gap-5 lg:grid-cols-3">
            {tours.map((tour) => (
              <div key={tour.title} className="overflow-hidden rounded-[1.75rem] border border-slate-200 bg-white shadow-sm">
                <SiteMediaFrame
                  media={tourMedia[tour.title as keyof typeof tourMedia]}
                  fallbackSrc="/assets/aire/hero.jpg"
                  fallbackAlt={`${tour.title} route over Guam`}
                  className="aspect-[16/10]"
                  mediaClassName="h-full w-full object-cover"
                />
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
                  <div className="mt-5 space-y-3 text-sm leading-relaxed text-slate-600">
                    {tour.details.map((item) => (
                      <div key={item} className="flex gap-3">
                        <span className="mt-1 text-cyan-700">•</span>
                        <span>{item}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-12 overflow-hidden rounded-[2rem] border border-slate-200 bg-slate-50/70">
          <SiteMediaFrame
            media={firstFor('programs_video')}
            fallbackSrc="/assets/aire/hero.jpg"
            fallbackAlt="AIRE video package sample"
            className="aspect-video max-h-[32rem]"
            mediaClassName="h-full w-full object-cover"
            controls
          />
          <div className="p-7">
            <div className="max-w-3xl">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-cyan-700">Video Packages</p>
              <h2 className="mt-2 text-3xl font-bold tracking-tight text-slate-900 md:text-4xl">Standard and all-inclusive add-ons</h2>
            </div>
            <div className="mt-8 grid gap-5 lg:grid-cols-2">
              {videoPackages.map((tier) => (
                <div key={tier.title} className="rounded-[1.75rem] border border-slate-200 bg-white p-6 shadow-sm">
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-cyan-700">{tier.title}</p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {tier.prices.map((price) => (
                      <span key={price} className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.1em] text-slate-700">
                        {price}
                      </span>
                    ))}
                  </div>
                  <div className="mt-5 space-y-3 text-sm leading-relaxed text-slate-600">
                    {tier.features.map((feature) => (
                      <div key={feature} className="flex gap-3">
                        <span className="mt-1 text-cyan-700">•</span>
                        <span>{feature}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="mt-12 rounded-[2rem] border border-amber-200 bg-amber-50 px-6 py-6">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-amber-700">Important Notes</p>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {notes.map((note) => (
              <div key={note} className="rounded-2xl border border-amber-200/80 bg-white/70 px-4 py-4 text-sm leading-relaxed text-slate-700">
                {note}
              </div>
            ))}
          </div>
        </section>

        <section className="mt-12 grid gap-6 rounded-[2rem] bg-slate-950 px-6 py-8 text-white sm:px-8 lg:grid-cols-[1fr_auto] lg:items-center">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-cyan-200">Need help choosing?</p>
            <h2 className="mt-2 text-3xl font-bold tracking-tight">Talk with AIRE before booking.</h2>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-slate-300">
              Contact the team if you need help picking the right tour, understanding training, or confirming local and military discount details.
            </p>
          </div>
          <div className="flex flex-wrap gap-3 lg:justify-end">
            <Link to="/contact" className="rounded-xl bg-cyan-400 px-6 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300">
              Contact AIRE
            </Link>
            <Link to="/team" className="rounded-xl border border-white/20 px-6 py-3 text-sm font-semibold text-white transition hover:bg-white/10">
              Meet the Team
            </Link>
          </div>
        </section>
      </div>
    </div>
  )
}
