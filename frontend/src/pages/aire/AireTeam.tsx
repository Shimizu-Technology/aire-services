import { useEffect, useState } from 'react'
import { api, type PublicTeamMember } from '../../lib/api'
import SiteMediaFrame from '../../components/site/SiteMediaFrame'
import { useSiteMedia } from '../../lib/siteMedia'
import type { SiteMediaPlacement } from '../../lib/api'

const credibilityPoints = [
  'Guam-based instructors who understand local flying conditions and student needs.',
  'Support for private, instrument, and multi-engine training.',
  'A team focused on clear communication, steady progress, and student confidence.',
]

export default function AireTeam() {
  const [teamMembers, setTeamMembers] = useState<PublicTeamMember[] | null>(null)
  const [teamLoadFailed, setTeamLoadFailed] = useState(false)
  const placements: SiteMediaPlacement[] = ['team_hero']
  const { firstFor } = useSiteMedia(placements)

  useEffect(() => {
    document.title = 'Meet the Team | AIRE Services Guam'

    let cancelled = false

    async function loadTeamMembers() {
      const result = await api.getPublicTeamMembers()
      if (cancelled) return

      if (result.error || !result.data) {
        setTeamLoadFailed(true)
        setTeamMembers([])
        return
      }

      setTeamMembers(result.data.team_members)
    }

    loadTeamMembers()

    return () => { cancelled = true }
  }, [])

  return (
    <div className="bg-white py-14 md:py-20">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="max-w-3xl">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-cyan-700">Meet the Team</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900 md:text-5xl">Meet the people behind AIRE flight training</h1>
          <p className="mt-4 text-sm leading-relaxed text-slate-600 md:text-base">
            Training works best when you know who you are flying with. Meet the instructors and training team members helping students on Guam build skill, confidence, and a steady path into aviation.
          </p>
        </div>

        {firstFor('team_hero') && (
          <SiteMediaFrame
            media={firstFor('team_hero')}
            fallbackAlt="AIRE Services Guam flight training team"
            className="mt-10 aspect-[16/7] rounded-[2rem] shadow-sm"
            mediaClassName="h-full w-full object-cover"
          />
        )}

        <div className="mt-10 grid gap-6 lg:grid-cols-[1fr_0.9fr] lg:items-start">
          <section className="rounded-3xl border border-slate-200 bg-slate-50/70 p-7">
            <h2 className="text-2xl font-semibold tracking-tight text-slate-900">Training team</h2>
            {teamMembers === null ? (
              <div className="mt-6 grid gap-4 sm:grid-cols-2">
                {Array.from({ length: 4 }).map((_, index) => (
                  <div key={index} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                    <div className="h-5 w-40 animate-pulse rounded bg-slate-200" />
                    <div className="mt-3 h-4 w-52 animate-pulse rounded bg-slate-100" />
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-6 grid gap-4 sm:grid-cols-2">
                {teamMembers.map((member, index) => (
                  <div key={`${member.name}-${member.title}-${index}`} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                    <p className="text-base font-semibold leading-snug text-slate-900">{member.name}</p>
                    <p className="mt-2 text-sm leading-relaxed text-slate-600">{member.title}</p>
                  </div>
                ))}
              </div>
            )}
            {teamMembers !== null && teamMembers.length === 0 && (
              <div className="mt-6 rounded-2xl border border-dashed border-slate-300 bg-white p-5 text-sm leading-relaxed text-slate-600">
                {teamLoadFailed
                  ? 'We could not load the instructor roster right now. Reach out to AIRE for the latest training availability.'
                  : 'Reach out to AIRE for the latest instructor roster and training availability.'}
              </div>
            )}
          </section>

          <section className="self-start rounded-3xl border border-slate-200 bg-white p-7 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-cyan-700">Why Train With AIRE</p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">A Guam-based team focused on students</h2>
            <div className="mt-5 space-y-4 text-sm leading-relaxed text-slate-600">
              {credibilityPoints.map((point) => (
                <div key={point} className="flex gap-3"><span className="mt-1 text-cyan-700">•</span><span>{point}</span></div>
              ))}
            </div>
            <div className="mt-8 rounded-2xl border border-cyan-200 bg-cyan-50/60 p-5 text-sm leading-relaxed text-slate-700">
              Have questions before your first lesson or discovery flight? Reach out and the team can help you choose the right next step.
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
