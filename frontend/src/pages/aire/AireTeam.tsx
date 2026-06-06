import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type PublicTeamMember } from '../../lib/api'
import SiteMediaFrame from '../../components/site/SiteMediaFrame'
import { initialsForName } from '../../lib/initials'
import { useSiteMedia } from '../../lib/siteMedia'
import type { SiteMediaPlacement } from '../../lib/api'

const credibilityPoints = [
  'Guam-based instructors who understand local flying conditions and student needs.',
  'Support for private, instrument, and multi-engine training.',
  'A team focused on clear communication, steady progress, and student confidence.',
]

function initialsFor(member: PublicTeamMember) {
  return initialsForName(member.name)
}

function CheckIcon() {
  return (
    <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-cyan-100 text-cyan-700">
      <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.4} d="m5 12 4 4L19 7" />
      </svg>
    </span>
  )
}

function TeamPortrait({ member, index }: { member: PublicTeamMember; index: number }) {
  const src = member.photo_url || member.photo_thumb_url

  return (
    <img
      src={src || ''}
      srcSet={member.photo_thumb_url && member.photo_url ? `${member.photo_thumb_url} 320w, ${member.photo_url} 720w` : undefined}
      sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
      alt={member.photo_alt || `${member.name}, ${member.title}`}
      loading={index < 3 ? 'eager' : 'lazy'}
      className="h-full w-full object-cover transition duration-700 group-hover:scale-105"
    />
  )
}

function TeamCard({ member, index }: { member: PublicTeamMember; index: number }) {
  return (
    <article className="group overflow-hidden rounded-[1.75rem] border border-slate-200 bg-white shadow-sm transition duration-300 hover:-translate-y-1 hover:border-cyan-200 hover:shadow-xl hover:shadow-slate-200/70">
      <div className="relative aspect-[5/4] overflow-hidden bg-slate-950 sm:aspect-[4/5]">
        <TeamPortrait member={member} index={index} />
        <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-slate-950/70 to-transparent" />
      </div>
      <div className="p-5 sm:p-6">
        <h3 className="text-lg font-semibold tracking-tight text-slate-950">{member.name}</h3>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">{member.title}</p>
      </div>
    </article>
  )
}

function TextRosterCard({ member }: { member: PublicTeamMember }) {
  return (
    <article className="flex items-center gap-4 rounded-2xl border border-slate-200 bg-white px-4 py-4 shadow-sm">
      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 text-sm font-semibold text-slate-700">
        {initialsFor(member)}
      </div>
      <div className="min-w-0">
        <h3 className="font-semibold leading-snug text-slate-950">{member.name}</h3>
        <p className="mt-1 text-sm leading-relaxed text-slate-600">{member.title}</p>
      </div>
    </article>
  )
}

function TeamSkeleton() {
  const skeletonCards = ['', 'hidden sm:block', 'hidden lg:block']

  return (
    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {skeletonCards.map((visibilityClass, index) => (
        <div key={index} className={`overflow-hidden rounded-[1.75rem] border border-slate-200 bg-white shadow-sm ${visibilityClass}`}>
          <div className="aspect-[5/4] animate-pulse bg-slate-200 sm:aspect-[4/5]" />
          <div className="p-5">
            <div className="h-5 w-40 animate-pulse rounded bg-slate-200" />
            <div className="mt-3 h-4 w-52 animate-pulse rounded bg-slate-100" />
          </div>
        </div>
      ))}
    </div>
  )
}

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

  const photoMembers = teamMembers?.filter((member) => Boolean(member.photo_url || member.photo_thumb_url)) ?? []
  const textOnlyMembers = teamMembers?.filter((member) => !member.photo_url && !member.photo_thumb_url) ?? []

  return (
    <div className="bg-white">
      <section className="relative overflow-hidden bg-slate-950 text-white">
        <div className="absolute inset-0 opacity-50">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(34,211,238,0.22),_transparent_34%),linear-gradient(135deg,_#020617,_#0f172a_48%,_#164e63)]" />
          <div className="absolute inset-0 dot-pattern opacity-30" />
        </div>
        <div className="relative mx-auto grid max-w-6xl gap-8 px-4 py-14 sm:px-6 md:py-20 lg:grid-cols-[0.9fr_1.1fr] lg:items-center lg:px-8">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-cyan-200">Meet the Team</p>
            <h1 className="mt-3 max-w-3xl text-3xl font-bold leading-tight tracking-tight sm:text-4xl md:text-5xl">
              Meet the people behind AIRE flight training.
            </h1>
            <p className="mt-5 max-w-2xl text-sm leading-relaxed text-slate-200 sm:text-base">
              Training works best when you know who you are flying with. Meet the instructors and training team members helping students on Guam build skill, confidence, and a steady path into aviation.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link to="/programs" className="inline-flex min-h-11 items-center justify-center rounded-xl bg-cyan-400 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300">
                Explore training
              </Link>
              <Link to="/contact" className="inline-flex min-h-11 items-center justify-center rounded-xl border border-white/20 px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/10">
                Ask a question
              </Link>
            </div>
          </div>

          <div className="overflow-hidden rounded-[2rem] border border-white/10 bg-white/5 p-2 shadow-2xl shadow-slate-950/40">
            <SiteMediaFrame
              media={firstFor('team_hero')}
              fallbackSrc="/assets/aire/hero.jpg"
              fallbackAlt="AIRE Services Guam flight training team"
              className="aspect-[16/11] rounded-[1.5rem]"
              mediaClassName="h-full w-full object-cover"
            />
          </div>
        </div>
      </section>

      <section className="bg-slate-50 py-14 md:py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
          <div className="mb-8 max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-cyan-700">Training team</p>
            <h2 className="mt-2 text-3xl font-bold tracking-tight text-slate-950 md:text-4xl">Instructors and aviation staff</h2>
          </div>

          {teamMembers === null ? (
            <TeamSkeleton />
          ) : teamMembers.length > 0 ? (
            <div className="space-y-8">
              {photoMembers.length > 0 && (
                <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                  {photoMembers.map((member, index) => (
                    <TeamCard key={`${member.id}-${member.name}-${member.title}`} member={member} index={index} />
                  ))}
                </div>
              )}

              {textOnlyMembers.length > 0 && (
                <div className="rounded-[1.75rem] border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.12em] text-cyan-700">Additional team members</p>
                    <h3 className="mt-1 text-xl font-semibold tracking-tight text-slate-950">Flight training support team</h3>
                  </div>
                  <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {textOnlyMembers.map((member) => (
                      <TextRosterCard key={`${member.id}-${member.name}-${member.title}`} member={member} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-[1.75rem] border border-dashed border-slate-300 bg-white p-8 text-sm leading-relaxed text-slate-600 shadow-sm">
              {teamLoadFailed
                ? 'We could not load the instructor roster right now. Reach out to AIRE for the latest training availability.'
                : 'Reach out to AIRE for the latest instructor roster and training availability.'}
            </div>
          )}
        </div>
      </section>

      <section className="py-14 md:py-20">
        <div className="mx-auto grid max-w-6xl gap-6 px-4 sm:px-6 lg:grid-cols-[0.9fr_1.1fr] lg:px-8">
          <div className="rounded-[2rem] bg-slate-950 p-7 text-white md:p-8">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-cyan-200">Why train with AIRE</p>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight md:text-3xl">A Guam-based team focused on students.</h2>
            <p className="mt-4 text-sm leading-relaxed text-slate-300">
              The right instructor relationship makes every lesson clearer. AIRE pairs practical local knowledge with a steady training path.
            </p>
          </div>

          <div className="rounded-[2rem] border border-slate-200 bg-white p-7 shadow-sm md:p-8">
            <div className="space-y-4">
              {credibilityPoints.map((point) => (
                <div key={point} className="flex gap-3 text-sm leading-relaxed text-slate-700">
                  <CheckIcon />
                  <span>{point}</span>
                </div>
              ))}
            </div>
            <div className="mt-7 rounded-2xl border border-cyan-200 bg-cyan-50/70 p-5 text-sm leading-relaxed text-slate-700">
              Have questions before your first lesson or discovery flight? Reach out and the team can help you choose the right next step.
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
