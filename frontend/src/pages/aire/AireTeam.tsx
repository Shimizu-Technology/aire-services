import { useEffect, useState } from 'react'
import { api, type PublicTeamMember } from '../../lib/api'

const fallbackTeamMembers: PublicTeamMember[] = [
  { id: 1, name: 'Mindy Wilson', title: 'Certified Flight Instructor' },
  { id: 2, name: 'Addison "AJ" Weldy', title: 'Certified Flight Instructor, Instrument / Multi Engine' },
  { id: 3, name: 'Spencer Williams', title: 'Certified Flight Instructor' },
  { id: 4, name: 'Roke Matanane', title: 'Certified Flight Instructor, Instrument / Multi Engine' },
  { id: 5, name: 'Brandon Letourneau', title: 'Certified Flight Instructor' },
  { id: 6, name: 'Monique Ayuyu', title: 'Certified Flight Instructor' },
  { id: 7, name: 'Jason Kim', title: 'Certified Flight Instructor' },
]

const credibilityPoints = [
  'Guam-based instructors who understand local flying conditions and student needs.',
  'Support for private, instrument, and multi-engine training.',
  'A team focused on clear communication, steady progress, and student confidence.',
]

export default function AireTeam() {
  const [teamMembers, setTeamMembers] = useState<PublicTeamMember[]>([])
  const [loadedTeamMembers, setLoadedTeamMembers] = useState(false)

  useEffect(() => {
    document.title = 'Meet the Team | AIRE Services Guam'

    let cancelled = false

    async function loadTeamMembers() {
      const result = await api.getPublicTeamMembers()
      if (cancelled || result.error || !result.data) return

      setTeamMembers(result.data.team_members)
      setLoadedTeamMembers(true)
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

        <div className="mt-10 grid gap-6 lg:grid-cols-[1fr_0.9fr] lg:items-start">
          <section className="rounded-3xl border border-slate-200 bg-slate-50/70 p-7">
            <h2 className="text-2xl font-semibold tracking-tight text-slate-900">Training team</h2>
            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              {(loadedTeamMembers ? teamMembers : fallbackTeamMembers).map((member) => (
                <div key={`${member.id}-${member.name}`} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <p className="text-base font-semibold leading-snug text-slate-900">{member.name}</p>
                  <p className="mt-2 text-sm leading-relaxed text-slate-600">{member.title}</p>
                </div>
              ))}
            </div>
            {loadedTeamMembers && teamMembers.length === 0 && (
              <div className="mt-6 rounded-2xl border border-dashed border-slate-300 bg-white p-5 text-sm leading-relaxed text-slate-600">
                Reach out to AIRE for the latest instructor roster and training availability.
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
