import { useEffect, useState } from 'react'
import { api, type PublicTeamMember } from '../../lib/api'
import { initialsForName } from '../../lib/initials'
import { useSiteMedia } from '../../lib/siteMedia'
import type { SiteMediaPlacement } from '../../lib/api'
import {
  ArrowRightIcon,
  CheckList,
  PublicButtonLink,
  PublicPageHero,
  SectionHeader,
  UsersIcon,
} from '../../components/public/PublicPrimitives'

const credibilityPoints = [
  'Guam-based instructors who understand local flying conditions and student needs.',
  'Support for private, instrument, and multi-engine training.',
  'A team focused on clear communication, steady progress, and student confidence.',
]

function initialsFor(member: PublicTeamMember) {
  return initialsForName(member.name)
}

function TeamPortrait({ member, index }: { member: PublicTeamMember; index: number }) {
  const src = member.photo_url || member.photo_thumb_url

  return (
    <img
      src={src || ''}
      srcSet={member.photo_thumb_url && member.photo_url ? `${member.photo_thumb_url} 480w, ${member.photo_url} 900w` : undefined}
      sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
      alt={member.photo_alt || `${member.name}, ${member.title}`}
      loading={index < 3 ? 'eager' : 'lazy'}
      className="h-full w-full object-cover transition duration-700 group-hover:scale-105"
      style={{ objectPosition: `${member.photo_position_x ?? 50}% ${member.photo_position_y ?? 50}%` }}
    />
  )
}

function TeamCard({ member, index }: { member: PublicTeamMember; index: number }) {
  return (
    <article className="group overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-[0_18px_50px_rgba(15,23,42,0.07)] transition duration-300 hover:-translate-y-1 hover:border-cyan-200 hover:shadow-[0_24px_70px_rgba(14,116,144,0.12)]">
      <div className="relative aspect-[4/5] overflow-hidden bg-slate-950">
        <TeamPortrait member={member} index={index} />
        <div className="absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-slate-950/72 to-transparent" />
      </div>
      <div className="p-5 sm:p-6">
        <h3 className="text-xl font-bold tracking-tight text-slate-950">{member.name}</h3>
        <p className="mt-2 text-sm leading-7 text-slate-600">{member.title}</p>
      </div>
    </article>
  )
}

function TextRosterCard({ member }: { member: PublicTeamMember }) {
  return (
    <article className="flex items-center gap-4 rounded-2xl border border-slate-200 bg-white px-4 py-4 shadow-sm transition hover:border-cyan-200 hover:bg-cyan-50/30">
      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-cyan-100 bg-cyan-50 text-sm font-bold text-cyan-800">
        {initialsFor(member)}
      </div>
      <div className="min-w-0">
        <h3 className="font-bold leading-snug text-slate-950">{member.name}</h3>
        <p className="mt-1 text-sm leading-6 text-slate-600">{member.title}</p>
      </div>
    </article>
  )
}

function TeamSkeleton() {
  const skeletonCards = ['', 'hidden sm:block', 'hidden lg:block']

  return (
    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {skeletonCards.map((visibilityClass, index) => (
        <div key={index} className={`overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-sm ${visibilityClass}`}>
          <div className="aspect-[4/5] animate-pulse bg-slate-200" />
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
  const { firstFor, loading: mediaLoading } = useSiteMedia(placements)

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
    <div className="bg-white text-slate-950">
      <PublicPageHero
        eyebrow="Meet the team"
        title="Meet the people behind AIRE flight training"
        description="Training works best when you know who you are flying with. Meet the instructors and training team members helping students on Guam build skill, confidence, and a steady path into aviation."
        media={firstFor('team_hero')}
        fallbackSrc="/assets/aire/hero.jpg"
        mediaLoading={mediaLoading}
        fallbackAlt="AIRE Services Guam flight training team"
        mediaMode="background"
        actions={(
          <>
            <PublicButtonLink to="/programs" variant="primary">Explore training <ArrowRightIcon /></PublicButtonLink>
            <PublicButtonLink to="/contact" variant="secondary">Ask a question</PublicButtonLink>
          </>
        )}
      />

      <section className="bg-slate-50 py-16 md:py-24">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
          <SectionHeader
            eyebrow="Training team"
            title="Instructors and aviation staff"
            description="A clean look at the instructors and support team members helping students move through training with confidence."
          />

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
                <div className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-[0_18px_50px_rgba(15,23,42,0.06)] sm:p-6">
                  <div className="flex items-start gap-4">
                    <span className="hidden h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-slate-950 text-cyan-200 sm:inline-flex">
                      <UsersIcon />
                    </span>
                    <div>
                      <p className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-700">Additional team members</p>
                      <h3 className="mt-1 text-2xl font-bold tracking-tight text-slate-950">Flight training support team</h3>
                    </div>
                  </div>
                  <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {textOnlyMembers.map((member) => (
                      <TextRosterCard key={`${member.id}-${member.name}-${member.title}`} member={member} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-[2rem] border border-dashed border-slate-300 bg-white p-8 text-sm leading-7 text-slate-600 shadow-sm">
              {teamLoadFailed
                ? 'We could not load the instructor roster right now. Reach out to AIRE for the latest training availability.'
                : 'Reach out to AIRE for the latest instructor roster and training availability.'}
            </div>
          )}
        </div>
      </section>

      <section className="py-16 md:py-24">
        <div className="mx-auto grid max-w-6xl gap-6 px-4 sm:px-6 lg:grid-cols-[0.9fr_1.1fr] lg:px-8">
          <div className="rounded-[2rem] bg-slate-950 p-7 text-white shadow-[0_24px_70px_rgba(15,23,42,0.16)] md:p-8">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-200">Why train with AIRE</p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight">A Guam-based team focused on students.</h2>
            <p className="mt-4 text-sm leading-7 text-slate-300">
              The right instructor relationship makes every lesson clearer. AIRE pairs practical local knowledge with a steady training path.
            </p>
          </div>

          <div className="rounded-[2rem] border border-slate-200 bg-white p-7 shadow-[0_18px_50px_rgba(15,23,42,0.06)] md:p-8">
            <CheckList items={credibilityPoints} />
            <div className="mt-7 rounded-2xl border border-cyan-200 bg-cyan-50/70 p-5 text-sm leading-7 text-slate-700">
              Have questions before your first lesson or discovery flight? Reach out and the team can help you choose the right next step.
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
