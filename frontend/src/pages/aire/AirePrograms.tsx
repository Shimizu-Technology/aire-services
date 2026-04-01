import { Link } from 'react-router-dom'
import Seo from '../../components/seo/Seo'

const certificateRequirements = [
  'Be at least 16 years old to solo and 17 years old to earn the certificate',
  'Pass the FAA knowledge test',
  'Hold a third-class medical certificate',
  'Demonstrate English proficiency and basic math ability',
  'Complete the required flight experience, including a minimum of 40 flight hours',
]

const groundSchoolTopics = [
  'Weight and balance',
  'Radio communications',
  'Weather',
  'Aerodynamics, power plants, and aircraft systems',
  'VFR navigation',
  'Privileges and limitations',
  'Preflight action',
  'FAR/AIM',
  'Aeronautical decision making',
]

const flightTrainingTopics = [
  'Preflight and post-flight procedures',
  'Takeoffs, landings, and go-arounds',
  'Ground reference maneuvers',
  'Stalls, steep turns, and slow flight',
  'Emergency operations',
  'Cross-country and navigation training',
]

const flightExperience = [
  '40 total flight hours',
  '10 hours solo flight time',
  '5 hours solo cross-country time',
  '20 hours dual instruction',
  '3 hours night flying',
  '3 hours instrument instruction',
  '10 full-stop night takeoffs/landings',
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
    <>
      <Seo
        title="Programs | AIRE Services Guam"
        description="Review AIRE Services Guam training programs, discovery flights, private pilot certificate details, and aircraft rental requirements."
        path="/programs"
      />
      <div className="bg-white py-14 md:py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-cyan-700">Programs & Services</p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900 md:text-5xl">Discovery flights, private pilot training, and aircraft rental</h1>
            <p className="mt-4 text-sm leading-relaxed text-slate-600 md:text-base">
              Whether you want a first flight, a structured path toward your Private Pilot Certificate, or rental access as a current pilot,
              AIRE gives you a clear place to start and a practical path forward.
            </p>
          </div>

          <div className="mt-10 grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
            <section className="rounded-3xl border border-slate-200 bg-slate-50/60 p-7">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-cyan-700">Core Program</p>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900 md:text-3xl">Private Pilot Certificate</h2>
              <p className="mt-4 text-sm leading-relaxed text-slate-600 md:text-base">
                The Private Pilot Certificate is the first major goal AIRE presents to future students. It starts with ground school, progresses through
                instructor-led flight training, and culminates in the FAA check-ride.
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
                  <h3 className="text-sm font-semibold uppercase tracking-[0.12em] text-slate-500">Ground School Topics</h3>
                  <ul className="mt-4 space-y-3 text-sm leading-relaxed text-slate-600">
                    {groundSchoolTopics.map((item) => (
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
                  The live public site uses discovery flights as the easiest first step into aviation. Students fly with a certified instructor,
                  get a left-seat experience, and can bring 1–2 additional passengers subject to weight and balance limits.
                </p>
                <div className="mt-6 flex flex-wrap gap-3">
                  <Link to="/discovery-flight" className="rounded-xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800">View Discovery Flight</Link>
                  <Link to="/contact" className="rounded-xl border border-slate-300 px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50">Ask AIRE Directly</Link>
                </div>
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

          <section className="mt-10 grid gap-6 lg:grid-cols-2">
            <div className="rounded-3xl border border-slate-200 bg-white p-7 shadow-sm">
              <h2 className="text-xl font-semibold tracking-tight text-slate-900">Flight Training Topics</h2>
              <ul className="mt-4 space-y-3 text-sm leading-relaxed text-slate-600">
                {flightTrainingTopics.map((item) => (
                  <li key={item} className="flex gap-3"><span className="mt-1 text-cyan-700">•</span><span>{item}</span></li>
                ))}
              </ul>
            </div>
            <div className="rounded-3xl border border-amber-200 bg-amber-50/70 p-7">
              <h2 className="text-xl font-semibold tracking-tight text-slate-900">Flight Experience Benchmarks</h2>
              <ul className="mt-4 space-y-3 text-sm leading-relaxed text-slate-700">
                {flightExperience.map((item) => (
                  <li key={item} className="flex gap-3"><span className="mt-1 text-amber-700">•</span><span>{item}</span></li>
                ))}
              </ul>
              <p className="mt-5 text-sm leading-relaxed text-slate-700">
                Once the instructor determines the student is ready, the final check-ride proceeds through both the oral/theoretical exam and the practical flight test.
              </p>
            </div>
          </section>
        </div>
      </div>
    </>
  )
}
