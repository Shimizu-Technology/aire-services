import { useEffect } from 'react'
import SiteMediaFrame from '../../components/site/SiteMediaFrame'
import type { SiteMediaPlacement } from '../../lib/api'
import { useSiteMedia } from '../../lib/siteMedia'
import {
  ArrowRightIcon,
  CameraIcon,
  CardIcon,
  CheckIcon,
  CheckList,
  ClockIcon,
  PlaneIcon,
  PublicButtonLink,
  PublicPageHero,
  RouteIcon,
  SectionHeader,
} from '../../components/public/PublicPrimitives'

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
  const { firstFor, loading: mediaLoading } = useSiteMedia(programsMediaPlacements)
  const tourMedia = {
    'Bay Tour': firstFor('tour_bay'),
    'Island Tour': firstFor('tour_island'),
    'Sunset Tour': firstFor('tour_sunset'),
  }

  return (
    <div className="bg-white text-slate-950">
      <PublicPageHero
        eyebrow="Programs & Services"
        title="Pilot training, scenic tours, and media packages"
        description="Explore AIRE's flight training, scenic aerial tours, and add-on media packages. Reach out for scheduling, local and military rates, or discovery flight questions."
        media={firstFor('programs_hero')}
        fallbackSrc="/assets/aire/hero.jpg"
        mediaLoading={mediaLoading}
        fallbackAlt="AIRE Services scenic Guam flight"
        actions={(
          <>
            <PublicButtonLink to="/contact" variant="primary">Ask about scheduling <ArrowRightIcon /></PublicButtonLink>
            <PublicButtonLink to="/discovery-flight" variant="secondary">Discovery flight</PublicButtonLink>
          </>
        )}
      />

      <section className="py-16 md:py-24">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
          <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
            <div className="overflow-hidden rounded-[2rem] border border-slate-200 bg-slate-50/70 shadow-[0_18px_50px_rgba(15,23,42,0.06)]">
              {(mediaLoading || firstFor('programs_training')) && (
                <SiteMediaFrame
                  media={firstFor('programs_training')}
                  fallbackAlt="Private pilot training with AIRE Services Guam"
                  loading={mediaLoading}
                  className="aspect-[16/9]"
                  mediaClassName="h-full w-full object-cover"
                />
              )}
              <div className="p-7 sm:p-8">
                <CardIcon><PlaneIcon /></CardIcon>
                <p className="mt-5 text-xs font-bold uppercase tracking-[0.18em] text-cyan-700">Pilot Training</p>
                <h2 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">Private Pilot Certificate training</h2>
                <div className="mt-6">
                  <CheckList items={trainingHighlights} />
                </div>
                <div className="mt-7 rounded-2xl border border-cyan-200 bg-cyan-50/70 p-5 text-sm leading-7 text-slate-700">
                  Interested in a first flight before committing to training? Ask about a discovery flight.
                </div>
              </div>
            </div>

            <div className="rounded-[2rem] bg-slate-950 p-7 text-white shadow-[0_24px_70px_rgba(15,23,42,0.18)] sm:p-8">
              <CardIcon dark><RouteIcon /></CardIcon>
              <p className="mt-5 text-xs font-bold uppercase tracking-[0.18em] text-cyan-200">Tours and media</p>
              <h2 className="mt-2 text-3xl font-bold tracking-tight">Scenic routes with optional video packages</h2>
              <p className="mt-4 text-sm leading-7 text-slate-300">
                Guests can choose scenic tour options and then add a standard or all-inclusive video package depending on how much finished content they want.
              </p>
              <div className="mt-7 grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-4">
                  <div className="text-sm font-bold text-white">Tours</div>
                  <p className="mt-2 text-sm leading-6 text-slate-300">Bay, Island, and Sunset routes with fixed durations and published pricing.</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-4">
                  <div className="text-sm font-bold text-white">Add-on content</div>
                  <p className="mt-2 text-sm leading-6 text-slate-300">4K edited delivery, reels, stills, and optional raw footage.</p>
                </div>
              </div>
              <div className="mt-7">
                <PublicButtonLink to="/contact" variant="secondary">Talk to AIRE</PublicButtonLink>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="bg-slate-50 py-16 md:py-24">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
          <SectionHeader
            eyebrow="Guam aerial tours"
            title="Route options and pricing"
            description="Each tour lists max capacity as three passengers per flight. Contact AIRE for local and military discount details."
          />

          <div className="grid gap-5 lg:grid-cols-3">
            {tours.map((tour) => (
              <div key={tour.title} className="group overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-[0_18px_50px_rgba(15,23,42,0.07)] transition duration-300 hover:-translate-y-1 hover:shadow-[0_24px_70px_rgba(15,23,42,0.1)]">
                {(mediaLoading || tourMedia[tour.title as keyof typeof tourMedia]) && (
                  <SiteMediaFrame
                    media={tourMedia[tour.title as keyof typeof tourMedia]}
                    fallbackAlt={`${tour.title} route over Guam`}
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
                  <div className="mt-5">
                    <CheckList items={tour.details} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-16 md:py-24">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
          <div className="overflow-hidden rounded-[2rem] border border-slate-200 bg-slate-50/70 shadow-[0_18px_50px_rgba(15,23,42,0.06)]">
            {(mediaLoading || firstFor('programs_video')) && (
              <SiteMediaFrame
                media={firstFor('programs_video')}
                fallbackAlt="AIRE video package sample"
                loading={mediaLoading}
                className="aspect-video max-h-[32rem]"
                mediaClassName="h-full w-full object-cover"
                controls
              />
            )}
            <div className="p-7 sm:p-8">
              <SectionHeader
                eyebrow="Video packages"
                title="Standard and all-inclusive add-ons"
                description="Choose a media package based on how much finished content you want from the flight."
                className="mb-8"
              />
              <div className="grid gap-5 lg:grid-cols-2">
                {videoPackages.map((tier) => (
                  <div key={tier.title} className="rounded-[1.75rem] border border-slate-200 bg-white p-6 shadow-sm">
                    <CardIcon><CameraIcon /></CardIcon>
                    <p className="mt-5 text-xs font-bold uppercase tracking-[0.18em] text-cyan-700">{tier.title}</p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {tier.prices.map((price) => (
                        <span key={price} className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-bold uppercase tracking-[0.1em] text-slate-700">
                          {price}
                        </span>
                      ))}
                    </div>
                    <div className="mt-5">
                      <CheckList items={tier.features} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="bg-amber-50/70 py-16 md:py-24">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
          <SectionHeader
            eyebrow="Important notes"
            title="Helpful details before you book"
            description="These details keep expectations clear before scheduling a training conversation, tour, or media package."
            className="mb-8"
          />
          <div className="grid gap-4 md:grid-cols-2">
            {notes.map((note) => (
              <div key={note} className="flex gap-3 rounded-2xl border border-amber-200/90 bg-white/80 px-4 py-4 text-sm leading-7 text-slate-700 shadow-sm">
                <span className="mt-1 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700">
                  <CheckIcon className="h-3.5 w-3.5" />
                </span>
                <span>{note}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-16 md:py-24">
        <div className="mx-auto grid max-w-6xl gap-6 rounded-[2rem] bg-slate-950 px-6 py-10 text-white shadow-[0_24px_70px_rgba(15,23,42,0.18)] sm:px-8 lg:grid-cols-[1fr_auto] lg:items-center lg:px-10">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-200">Need help choosing?</p>
            <h2 className="mt-2 text-3xl font-bold tracking-tight">Talk with AIRE before booking.</h2>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-300">
              Contact the team if you need help picking the right tour, understanding training, or confirming local and military discount details.
            </p>
          </div>
          <div className="flex flex-wrap gap-3 lg:justify-end">
            <PublicButtonLink to="/contact" variant="primary">Contact AIRE</PublicButtonLink>
            <PublicButtonLink to="/team" variant="secondary">Meet the team</PublicButtonLink>
          </div>
        </div>
      </section>
    </div>
  )
}
