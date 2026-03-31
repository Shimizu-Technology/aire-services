const instructors = [
  'Mindy Wilson — Certified Flight Instructor',
  'Addison “AJ” Weldy — Certified Flight Instructor, Instrument / Multi Engine',
  'Spencer Williams — Certified Flight Instructor',
  'Roke Matanane — Certified Flight Instructor, Instrument / Multi Engine',
  'Brandon Letourneau — Certified Flight Instructor',
  'Monique Ayuyu — Certified Flight Instructor',
  'Jason Kim — Certified Flight Instructor',
]

const credibilityPoints = [
  'AIRE’s public footprint includes local news coverage, social presence, and Guam directory listings.',
  'The business has been publicly positioned around local pilot training, discovery flights, and building aviation opportunities on Guam.',
  'The current team page gives AIRE a strong credibility base — this redesign keeps that trust signal front and center.',
]

export default function AireTeam() {
  return (
    <div className="bg-white py-14 md:py-20">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="max-w-3xl">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-cyan-700">Meet the Crew</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900 md:text-5xl">Instructors and crew that make training feel local and personal</h1>
          <p className="mt-4 text-sm leading-relaxed text-slate-600 md:text-base">
            One of AIRE’s biggest strengths is that the current site puts real people in front of prospective students. For a flight school,
            that matters. This page keeps that human credibility while setting up a cleaner, more modern presentation.
          </p>
        </div>

        <div className="mt-10 grid gap-6 lg:grid-cols-[1fr_0.9fr]">
          <section className="rounded-3xl border border-slate-200 bg-slate-50/70 p-7">
            <h2 className="text-2xl font-semibold tracking-tight text-slate-900">Current public instructor roster</h2>
            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              {instructors.map((instructor) => (
                <div key={instructor} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <p className="text-sm font-medium leading-relaxed text-slate-800">{instructor}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-3xl border border-slate-200 bg-white p-7 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-cyan-700">Why this matters</p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">A team page should build trust, not just fill space</h2>
            <div className="mt-5 space-y-4 text-sm leading-relaxed text-slate-600">
              {credibilityPoints.map((point) => (
                <div key={point} className="flex gap-3"><span className="mt-1 text-cyan-700">•</span><span>{point}</span></div>
              ))}
            </div>
            <div className="mt-8 rounded-2xl border border-cyan-200 bg-cyan-50/60 p-5 text-sm leading-relaxed text-slate-700">
              Later polish pass: replace these simple text cards with real team profile cards, headshots, role tags, and short bios from AIRE’s approved assets.
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
