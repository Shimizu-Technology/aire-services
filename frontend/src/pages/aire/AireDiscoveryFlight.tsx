import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import Seo from '../../components/seo/Seo'
import SiteMediaFrame from '../../components/site/SiteMediaFrame'
import { useSiteMedia } from '../../lib/siteMedia'
import type { SiteMediaPlacement } from '../../lib/api'
import { usePublicBusinessInfo } from '../../contexts/publicBusinessInfo'

const details = [
  'Introductory flight with a certified flight instructor',
  'Hands-on experience from the left seat',
  '1 to 2 additional passengers may accompany at no additional charge',
  'Weight and balance restrictions may apply',
]

const reasons = [
  'A hands-on first look at flight training on Guam',
  'A chance to experience the instructor and aircraft environment',
  'The clearest low-friction step before committing to full training',
]

export default function AireDiscoveryFlight() {
  useEffect(() => { document.title = 'Discovery Flight | AIRE Services Guam' }, [])
  const placements: SiteMediaPlacement[] = ['discovery_hero']
  const { firstFor } = useSiteMedia(placements)
  const businessInfo = usePublicBusinessInfo()
  return (
    <>
      <Seo
        title="Discovery Flight | AIRE Services Guam"
        description="Take a discovery flight with AIRE Services Guam and get a real first look at aviation training on Guam."
        path="/discovery-flight"
      />
      <div className="bg-white">
        <section className="relative overflow-hidden bg-slate-950 py-16 text-white md:py-24">
          <div className="absolute inset-0">
            <SiteMediaFrame
              media={firstFor('discovery_hero')}
              fallbackSrc="/assets/aire/hero.jpg"
              fallbackAlt="Discovery flight with AIRE Services"
              hero
              className="h-full w-full"
              mediaClassName="h-full w-full object-cover opacity-30"
            />
            <div className="absolute inset-0 bg-[linear-gradient(140deg,rgba(2,6,23,0.94),rgba(2,6,23,0.80),rgba(8,145,178,0.28))]" />
          </div>
          <div className="relative mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
            <div className="max-w-3xl">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-cyan-200">Discovery Flight</p>
              <h1 className="mt-2 text-4xl font-bold tracking-tight md:text-5xl">Take a discovery flight and get a real first look at flying</h1>
              <p className="mt-4 text-base leading-relaxed text-slate-200 md:text-lg">
                A discovery flight is a simple way to meet an instructor, experience the aircraft, and see whether flight training feels like the right next step for you.
              </p>
            </div>
          </div>
        </section>

        <section className="py-14 md:py-20">
          <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
            <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
              <section className="rounded-3xl border border-slate-200 bg-slate-50/70 p-7 shadow-sm">
                <h2 className="text-2xl font-semibold tracking-tight text-slate-900">What to expect</h2>
                <div className="mt-6 space-y-4 text-sm leading-relaxed text-slate-600">
                  {details.map((detail) => (
                    <div key={detail} className="flex gap-3"><span className="mt-1 text-cyan-700">•</span><span>{detail}</span></div>
                  ))}
                </div>
              </section>

              <section className="rounded-3xl border border-slate-200 bg-white p-7 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-cyan-700">Why start here?</p>
                <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">A practical preview before full training</h2>
                <div className="mt-4 space-y-3 text-sm leading-relaxed text-slate-600">
                  {reasons.map((reason) => (
                    <div key={reason} className="flex gap-3"><span className="mt-1 text-cyan-700">•</span><span>{reason}</span></div>
                  ))}
                </div>
                <div className="mt-8 rounded-2xl border border-cyan-200 bg-cyan-50/60 p-5 text-sm leading-relaxed text-slate-700">
                  Current details, pricing, and scheduling should be confirmed directly with AIRE at <strong>{businessInfo.phone.display}</strong> or <strong>{businessInfo.email.display}</strong>.
                </div>
                <div className="mt-6 flex flex-wrap gap-3">
                  <Link to="/contact" className="rounded-xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800">
                    Ask About Discovery Flights
                  </Link>
                  <Link to="/programs" className="rounded-xl border border-slate-300 px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50">
                    View Tours and Services
                  </Link>
                </div>
              </section>
            </div>
          </div>
        </section>
      </div>
    </>
  )
}
