import { useEffect } from 'react'
import Seo from '../../components/seo/Seo'
import { useSiteMedia } from '../../lib/siteMedia'
import type { SiteMediaPlacement } from '../../lib/api'
import { usePublicBusinessInfo } from '../../contexts/publicBusinessInfo'
import {
  ArrowRightIcon,
  CheckList,
  PlaneIcon,
  PublicButtonLink,
  PublicPageHero,
  SectionHeader,
} from '../../components/public/PublicPrimitives'

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
  const { firstFor, loading: mediaLoading } = useSiteMedia(placements)
  const businessInfo = usePublicBusinessInfo()
  return (
    <>
      <Seo
        title="Discovery Flight | AIRE Services Guam"
        description="Take a discovery flight with AIRE Services Guam and get a real first look at aviation training on Guam."
        path="/discovery-flight"
      />
      <div className="bg-white text-slate-950">
        <PublicPageHero
          eyebrow="Discovery Flight"
          title="Get a real first look at flying"
          description="A discovery flight is a simple way to meet an instructor, experience the aircraft, and see whether flight training feels like the right next step for you."
          media={firstFor('discovery_hero')}
          fallbackSrc="/assets/aire/hero.jpg"
          mediaLoading={mediaLoading}
          fallbackAlt="Discovery flight with AIRE Services"
          mediaMode="background"
          compact
          actions={(
            <>
              <PublicButtonLink to="/contact" variant="primary">Ask about discovery flights <ArrowRightIcon /></PublicButtonLink>
              <PublicButtonLink to="/programs" variant="secondary">View services</PublicButtonLink>
            </>
          )}
        />

        <section className="py-16 md:py-24">
          <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
            <SectionHeader
              eyebrow="First flight preview"
              title="A practical first step before full training"
              description="Meet the aircraft environment, understand the training experience, and ask questions before committing to a full path."
            />

            <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
              <div className="rounded-[2rem] border border-slate-200 bg-slate-50/70 p-7 shadow-[0_18px_50px_rgba(15,23,42,0.06)] sm:p-8">
                <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-950 text-cyan-200">
                  <PlaneIcon className="h-6 w-6" />
                </span>
                <h2 className="mt-5 text-2xl font-bold tracking-tight text-slate-950">What to expect</h2>
                <div className="mt-6">
                  <CheckList items={details} />
                </div>
              </div>

              <div className="rounded-[2rem] border border-slate-200 bg-white p-7 shadow-[0_18px_50px_rgba(15,23,42,0.06)] sm:p-8">
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-700">Why start here?</p>
                <h2 className="mt-2 text-2xl font-bold tracking-tight text-slate-950">A low-friction preview before full training</h2>
                <div className="mt-5">
                  <CheckList items={reasons} />
                </div>
                <div className="mt-8 rounded-2xl border border-cyan-200 bg-cyan-50/60 p-5 text-sm leading-7 text-slate-700">
                  Current details, pricing, and scheduling should be confirmed directly with AIRE at <strong>{businessInfo.phone.display}</strong> or <strong>{businessInfo.email.display}</strong>.
                </div>
                <div className="mt-6 flex flex-wrap gap-3">
                  <PublicButtonLink to="/contact" variant="dark">Ask about discovery flights</PublicButtonLink>
                  <PublicButtonLink to="/programs" variant="outline">View tours and services</PublicButtonLink>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </>
  )
}
