import { useEffect } from 'react'

const instructors = [
  'Mindy Wilson — Certified Flight Instructor',
  'Addison "AJ" Weldy — Certified Flight Instructor, Instrument / Multi Engine',
  'Spencer Williams — Certified Flight Instructor',
  'Roke Matanane — Certified Flight Instructor, Instrument / Multi Engine',
  'Brandon Letourneau — Certified Flight Instructor',
  'Monique Ayuyu — Certified Flight Instructor',
  'Jason Kim — Certified Flight Instructor',
]

const credibilityPoints = [
  'Featured in local coverage by Pacific Island Times and Guam PDN around Guam-based aviation training.',
  'Active social presence and community engagement across Guam directory listings and social profiles.',
  'A growing team of certified instructors dedicated to helping students train locally.',
]

export default function AireTeam() {
  useEffect(() => { document.title = 'Meet the Team | AIRE Services Guam' }, [])
  return (
    <div className="bg-white py-14 md:py-20">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="max-w-3xl">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-cyan-700">Meet the Crew</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900 md:text-5xl">Instructors and crew that make training feel local and personal</h1>
          <p className="mt-4 text-sm leading-relaxed text-slate-600 md:text-base">
            Flight training is personal. AIRE's team of certified flight instructors brings real experience
            and a commitment to helping Guam-based students build skill, confidence, and a genuine path into aviation.
          </p>
        </div>

        <div className="mt-10 grid gap-6 lg:grid-cols-[1fr_0.9fr]">
          <section className="rounded-3xl border border-slate-200 bg-slate-50/70 p-7">
            <h2 className="text-2xl font-semibold tracking-tight text-slate-900">AIRE flight instructor roster</h2>
            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              {instructors.map((instructor) => (
                <div key={instructor} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <p className="text-sm font-medium leading-relaxed text-slate-800">{instructor}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-3xl border border-slate-200 bg-white p-7 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-cyan-700">Local credibility</p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">A real local presence, not just a website</h2>
            <div className="mt-5 space-y-4 text-sm leading-relaxed text-slate-600">
              {credibilityPoints.map((point) => (
                <div key={point} className="flex gap-3"><span className="mt-1 text-cyan-700">•</span><span>{point}</span></div>
              ))}
            </div>
            <div className="mt-8 rounded-2xl border border-cyan-200 bg-cyan-50/60 p-5 text-sm leading-relaxed text-slate-700">
              Want to learn more about the team before your first flight? Reach out and we'll connect you with an instructor who can answer your questions.
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
