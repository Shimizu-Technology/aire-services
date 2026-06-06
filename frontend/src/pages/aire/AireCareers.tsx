import { useEffect } from 'react'
import Seo from '../../components/seo/Seo'
import { useSiteMedia } from '../../lib/siteMedia'
import type { SiteMediaPlacement } from '../../lib/api'
import { aireAddressLinesFor } from '../../lib/businessInfo'
import { usePublicBusinessInfo } from '../../contexts/publicBusinessInfo'
import {
  ArrowRightIcon,
  CheckList,
  MailIcon,
  PublicButtonLink,
  PublicPageHero,
  SectionHeader,
} from '../../components/public/PublicPrimitives'

const responsibilities = [
  'Safely transport customers between designated locations in the Tumon Bay area and AIRE\'s main office in Barrigada.',
  'Coordinate with the operations manager and staff to ensure timely customer pick-up and drop-off.',
  'Maintain cleanliness and functionality of the shuttle vehicle and report issues to management.',
  'Follow traffic laws and prioritize passenger, pedestrian, and road-user safety at all times.',
]

const requirements = [
  'High school diploma or equivalent (GED)',
  'Valid Guam driver\'s license',
  'Strong communication skills and a friendly personality',
]

export default function AireCareers() {
  useEffect(() => { document.title = 'Careers | AIRE Services Guam' }, [])
  const placements: SiteMediaPlacement[] = ['careers_hero']
  const { firstFor } = useSiteMedia(placements)
  const businessInfo = usePublicBusinessInfo()
  const addressLines = aireAddressLinesFor(businessInfo)

  return (
    <>
      <Seo
        title="Careers | AIRE Services Guam"
        description="Review current hiring information and career opportunities with AIRE Services Guam."
        path="/careers"
      />
      <div className="bg-white text-slate-950">
        <PublicPageHero
          eyebrow="Careers"
          title="Join the AIRE team"
          description="AIRE is looking for dependable team members who bring a strong work ethic, clear communication, and a willingness to learn. Review the current opening below and reach out if it sounds like a fit."
          media={firstFor('careers_hero')}
          fallbackSrc="/assets/aire/careers.jpg"
          fallbackAlt="AIRE Services hiring"
          mediaMode="background"
          compact
          actions={(
            <>
              <PublicButtonLink to={businessInfo.email.careerHref} variant="primary">Email your resume <ArrowRightIcon /></PublicButtonLink>
              <PublicButtonLink to="/contact" variant="secondary">Contact AIRE</PublicButtonLink>
            </>
          )}
        />

        <section className="py-16 md:py-24">
          <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
            <SectionHeader
              eyebrow="Current opening"
              title="Immediate opening: on-demand driver"
              description="A customer-facing role supporting transportation between Tumon Bay locations and AIRE's main office in Barrigada."
            />

            <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
              <div className="rounded-[2rem] border border-slate-200 bg-slate-50/70 p-7 shadow-[0_18px_50px_rgba(15,23,42,0.06)] sm:p-8">
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-700">Responsibilities</p>
                <h3 className="mt-3 text-2xl font-bold tracking-tight text-slate-950">What this role supports</h3>
                <div className="mt-6">
                  <CheckList items={responsibilities} />
                </div>
              </div>

              <div className="rounded-[2rem] border border-slate-200 bg-white p-7 shadow-[0_18px_50px_rgba(15,23,42,0.06)] sm:p-8">
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-700">Position requirements</p>
                <h3 className="mt-3 text-2xl font-bold tracking-tight text-slate-950">What AIRE is looking for</h3>
                <div className="mt-6">
                  <CheckList items={requirements} />
                </div>

                <div className="mt-8 rounded-2xl border border-cyan-200 bg-cyan-50/70 p-5 text-sm leading-7 text-slate-700">
                  <p className="font-bold text-slate-950">Training provided</p>
                  <p className="mt-2">
                    No previous experience is required. The team will train you in the role if you bring the right customer-service mindset and communication skills.
                  </p>
                </div>

                <div className="mt-8 rounded-2xl bg-slate-950 p-5 text-sm text-slate-300">
                  <div className="flex gap-3">
                    <span className="mt-1 text-cyan-200"><MailIcon className="h-5 w-5" /></span>
                    <div>
                      <p className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-200">Send resume or hand deliver to</p>
                      <p className="mt-3 font-semibold text-white">{businessInfo.email.display}</p>
                      <p className="mt-2 leading-7">{addressLines[0]}<br />{addressLines[1]}</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </>
  )
}
