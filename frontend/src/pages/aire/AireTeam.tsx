import Seo from '../../components/seo/Seo'

const instructors = [
  { name: 'Mindy Wilson', role: 'Certified Flight Instructor' },
  { name: 'Addison “AJ” Weldy', role: 'Certified Flight Instructor', specialty: 'Instrument / Multi Engine' },
  { name: 'Spencer Williams', role: 'Certified Flight Instructor' },
  { name: 'Roke Matanane', role: 'Certified Flight Instructor', specialty: 'Instrument / Multi Engine' },
  { name: 'Brandon Letourneau', role: 'Certified Flight Instructor' },
  { name: 'Monique Ayuyu', role: 'Certified Flight Instructor' },
  { name: 'Jason Kim', role: 'Certified Flight Instructor' },
]

const teamNotes = [
  'AIRE’s live public team page already does one important thing right: it names the instructors directly.',
  'That makes the school feel more trustworthy than a generic training page with no people attached to it.',
  'This polished page keeps the same names visible while giving the roster a cleaner, more modern presentation.',
]

export default function AireTeam() {
  return (
    <>
      <Seo
        title="Team | AIRE Services Guam"
        description="Meet the instructors and flight crew behind AIRE Services Guam’s local training experience."
        path="/team"
      />
      <div className="bg-white py-14 md:py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-cyan-700">Meet the Crew</p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900 md:text-5xl">The instructor roster students already see on AIRE’s live public site</h1>
            <p className="mt-4 text-sm leading-relaxed text-slate-600 md:text-base">
              AIRE’s strongest public trust signal is simple: it names the instructors. This page keeps that same public roster in a cleaner format so prospective students can quickly understand who is behind the training experience.
            </p>
          </div>

          <div className="mt-10 grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
            <section className="rounded-3xl border border-slate-200 bg-slate-50/70 p-7">
              <h2 className="text-2xl font-semibold tracking-tight text-slate-900">Current public instructor roster</h2>
              <div className="mt-6 grid gap-4 sm:grid-cols-2">
                {instructors.map((instructor) => (
                  <div key={instructor.name} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                    <p className="text-lg font-semibold text-slate-900">{instructor.name}</p>
                    <p className="mt-2 text-sm text-slate-600">{instructor.role}</p>
                    {instructor.specialty && (
                      <p className="mt-2 inline-flex rounded-full border border-cyan-200 bg-cyan-50 px-2.5 py-1 text-xs font-medium text-cyan-700">
                        {instructor.specialty}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-3xl border border-slate-200 bg-white p-7 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-cyan-700">Why this matters</p>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">A flight school should feel human, not anonymous</h2>
              <div className="mt-5 space-y-4 text-sm leading-relaxed text-slate-600">
                {teamNotes.map((point) => (
                  <div key={point} className="flex gap-3"><span className="mt-1 text-cyan-700">•</span><span>{point}</span></div>
                ))}
              </div>
              <div className="mt-8 rounded-2xl border border-slate-200 bg-slate-50 p-5 text-sm leading-relaxed text-slate-700">
                Next content pass later: add approved headshots, bios, and role-specific personality once AIRE has the official media/assets ready.
              </div>
            </section>
          </div>
        </div>
      </div>
    </>
  )
}
