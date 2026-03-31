import { Link } from 'react-router-dom'

const details = [
  'Introductory flight with a certified flight instructor',
  'Hands-on experience from the left seat',
  '1 to 2 additional passengers may accompany at no additional charge',
  'Weight and balance restrictions may apply',
]

const reasons = [
  'A hands-on first look at flight training on Guam',
  'A chance to experience the instructor and aircraft environment',
  'A low-friction way to see whether full training feels like the right next step',
]

export default function AireDiscoveryFlight() {
  return (
    <div className="bg-white">
      <section className="relative overflow-hidden bg-slate-950 py-16 text-white md:py-24">
        <div className="absolute inset-0">
          <img src="/assets/aire/hero.jpg" alt="Discovery flight with AIRE Services" className="h-full w-full object-cover opacity-25" />
          <div className="absolute inset-0 bg-[linear-gradient(140deg,rgba(2,6,23,0.94),rgba(2,6,23,0.80),rgba(8,145,178,0.28))]" />
        </div>
        <div className="relative mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-cyan-200">Discovery Flight</p>
            <h1 className="mt-2 text-4xl font-bold tracking-tight md:text-5xl">Your first real step into aviation</h1>
            <p className="mt-4 text-base leading-relaxed text-slate-200 md:text-lg">
              A discovery flight is the easiest way to move from curiosity to real experience. It gives future students a first-hand
              introduction to the aircraft, the instructor, and what learning to fly can actually feel like.
            </p>
          </div>
        </div>
      </section>

      <section className="py-14 md:py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
          <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
            <section className="rounded-3xl border border-slate-200 bg-slate-50/70 p-7 shadow-sm">
              <h2 className="text-2xl font-semibold tracking-tight text-slate-900">What to expect</h2>
              <div className="mt-6 space-y-4 text-sm leading-relaxed text-slate-600">
                {details.map((detail) => (
                  <div key={detail} className="flex gap-3"><span className="mt-1 text-cyan-700">•</span><span>{detail}</span></div>
                ))}
              </div>
            </section>

            <section className="rounded-3xl border border-slate-200 bg-white p-7 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-cyan-700">Why start here?</p>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">A low-friction way to see if flight training is right for you</h2>
              <div className="mt-4 space-y-3 text-sm leading-relaxed text-slate-600">
                {reasons.map((reason) => (
                  <div key={reason} className="flex gap-3"><span className="mt-1 text-cyan-700">•</span><span>{reason}</span></div>
                ))}
              </div>
              <div className="mt-8 rounded-2xl border border-cyan-200 bg-cyan-50/60 p-5 text-sm leading-relaxed text-slate-700">
                Historical public reporting around AIRE mentioned discovery flights at <strong>$180</strong> in 2021. Treat that as public background only — current pricing should be confirmed directly with AIRE.
              </div>
              <div className="mt-6 flex flex-wrap gap-3">
                <Link to="/contact" className="rounded-xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800">
                  Ask About Discovery Flights
                </Link>
                <Link to="/programs" className="rounded-xl border border-slate-300 px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50">
                  View All Programs
                </Link>
              </div>
            </section>
          </div>
        </div>
      </section>
    </div>
  )
}
