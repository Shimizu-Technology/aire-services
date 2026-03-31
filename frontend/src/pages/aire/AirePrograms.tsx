import { Link } from 'react-router-dom'

const certificateRequirements = [
  'Be at least 16 years old to solo and 17 years old to earn the certificate',
  'Pass the FAA knowledge test',
  'Hold a third-class medical certificate',
  'Demonstrate English proficiency and basic math ability',
  'Complete the required flight experience, including a minimum of 40 flight hours',
]

const trainingSteps = [
  'Complete ground school, including online study such as Sporty’s Learn To Fly Course',
  'Prepare for and pass the FAA written exam',
  'Build flight proficiency with instructor-led training',
  'Meet required flight experience benchmarks',
  'Complete the FAA check-ride, including oral and practical testing',
]

const rentalRequirements = [
  'Private pilot license required',
  'Minimum 80 hours PIC time required',
  'Must be checked out by an AIRE pilot',
  'Currency flight required if the pilot has not flown in the previous 30 days',
  'Cross-country checkout required for cross-country rentals',
  'Multi-engine rental available with instructor only',
]

export default function AirePrograms() {
  return (
    <div className="bg-white py-14 md:py-20">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="max-w-3xl">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-cyan-700">Programs & Services</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900 md:text-5xl">Training options built around real flight goals</h1>
          <p className="mt-4 text-sm leading-relaxed text-slate-600 md:text-base">
            AIRE Services Guam offers a practical starting point for future pilots, first-time discovery flyers, and current pilots
            looking for rental options. This first-pass site structure keeps the real public details from AIRE’s current site, but puts
            them in a cleaner, more usable flow.
          </p>
        </div>

        <div className="mt-10 grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
          <section className="rounded-3xl border border-slate-200 bg-slate-50/60 p-7">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-cyan-700">Core Program</p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900 md:text-3xl">Private Pilot Certificate</h2>
            <p className="mt-4 text-sm leading-relaxed text-slate-600 md:text-base">
              This is the foundational certificate for pilots who want to build skill, confidence, and a real path into aviation.
              It is the first major step toward broader flight training and, for some students, the start of a long-term airline career path.
            </p>

            <div className="mt-8 grid gap-6 md:grid-cols-2">
              <div>
                <h3 className="text-sm font-semibold uppercase tracking-[0.12em] text-slate-500">Requirements</h3>
                <ul className="mt-4 space-y-3 text-sm leading-relaxed text-slate-600">
                  {certificateRequirements.map((item) => (
                    <li key={item} className="flex gap-3"><span className="mt-1 text-cyan-700">•</span><span>{item}</span></li>
                  ))}
                </ul>
              </div>
              <div>
                <h3 className="text-sm font-semibold uppercase tracking-[0.12em] text-slate-500">Training Flow</h3>
                <ul className="mt-4 space-y-3 text-sm leading-relaxed text-slate-600">
                  {trainingSteps.map((item) => (
                    <li key={item} className="flex gap-3"><span className="mt-1 text-cyan-700">•</span><span>{item}</span></li>
                  ))}
                </ul>
              </div>
            </div>
          </section>

          <div className="space-y-6">
            <section className="rounded-3xl border border-slate-200 bg-white p-7 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-cyan-700">First Flight</p>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">Discovery Flight</h2>
              <p className="mt-4 text-sm leading-relaxed text-slate-600">
                A discovery flight gives first-time flyers a hands-on introductory experience with a certified flight instructor.
                Students fly from the left seat and get a practical first look at what training can feel like.
              </p>
              <ul className="mt-5 space-y-3 text-sm leading-relaxed text-slate-600">
                <li className="flex gap-3"><span className="mt-1 text-cyan-700">•</span><span>Introductory flight with a certified flight instructor</span></li>
                <li className="flex gap-3"><span className="mt-1 text-cyan-700">•</span><span>Hands-on experience from the left seat</span></li>
                <li className="flex gap-3"><span className="mt-1 text-cyan-700">•</span><span>1 to 2 additional passengers may accompany at no additional charge</span></li>
                <li className="flex gap-3"><span className="mt-1 text-cyan-700">•</span><span>Weight and balance restrictions may apply</span></li>
              </ul>
              <Link to="/contact" className="mt-6 inline-flex text-sm font-semibold text-cyan-700 hover:text-cyan-900">Ask about discovery flights →</Link>
            </section>

            <section className="rounded-3xl border border-slate-200 bg-white p-7 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-cyan-700">For Current Pilots</p>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">Aircraft Rental</h2>
              <ul className="mt-4 space-y-3 text-sm leading-relaxed text-slate-600">
                {rentalRequirements.map((item) => (
                  <li key={item} className="flex gap-3"><span className="mt-1 text-cyan-700">•</span><span>{item}</span></li>
                ))}
              </ul>
            </section>
          </div>
        </div>

        <section className="mt-10 rounded-3xl border border-amber-200 bg-amber-50/70 p-7">
          <h2 className="text-xl font-semibold tracking-tight text-slate-900">Important training notes</h2>
          <div className="mt-4 grid gap-4 md:grid-cols-2 text-sm leading-relaxed text-slate-700">
            <p>
              Discovery flight and block time pricing on the current AIRE site indicate that aircraft rental, instructor fees,
              and landing fees are included. Ground instructor fees may apply if needed.
            </p>
            <p>
              The current site also notes that block time is valid for two years and that cancellation fees may apply when less
              than 24 hours notice is given, except in situations involving weather or maintenance.
            </p>
          </div>
        </section>
      </div>
    </div>
  )
}
