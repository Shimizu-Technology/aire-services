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
  'Seeing the instructors by name makes the school feel more personal and approachable.',
  'Seeing the crew helps future students connect the training experience to real people instead of a generic brand.',
  'A clear team page helps future students feel more confident before they book a discovery flight.',
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
            <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900 md:text-5xl">Meet the instructors behind AIRE’s training experience</h1>
            <p className="mt-4 text-sm leading-relaxed text-slate-600 md:text-base">
              Flight training is personal. Meeting the instructors helps future students understand who will be teaching, guiding, and supporting them from the first lesson forward.
            </p>
          </div>

          <div className="mt-10 grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
            <section className="rounded-3xl border border-slate-200 bg-slate-50/70 p-7">
              <h2 className="text-2xl font-semibold tracking-tight text-slate-900">Instructor roster</h2>
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
                Flight training is personal. Knowing who is teaching, guiding, and supporting you makes it easier to take the next step with confidence.
              </div>
            </section>
          </div>
        </div>
      </div>
    </>
  )
}
