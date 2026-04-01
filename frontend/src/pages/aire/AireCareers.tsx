import { Link } from 'react-router-dom'
import Seo from '../../components/seo/Seo'

const responsibilities = [
  'Safely transport customers between designated locations in the Tumon Bay area and AIRE’s main office in Barrigada.',
  'Coordinate with the operations manager and staff to ensure timely customer pick-up and drop-off.',
  'Maintain cleanliness and functionality of the shuttle vehicle and report issues to management.',
  'Follow traffic laws and prioritize passenger, pedestrian, and road-user safety at all times.',
]

const requirements = [
  'High school diploma or equivalent (GED)',
  'Valid Guam driver’s license',
  'Strong communication skills and a friendly personality',
]

export default function AireCareers() {
  return (
    <>
      <Seo
        title="Careers | AIRE Services Guam"
        description="Review current hiring information and career opportunities with AIRE Services Guam."
        path="/careers"
      />
      <div className="bg-white">
      <section className="relative overflow-hidden bg-slate-950 py-16 text-white md:py-24">
        <div className="absolute inset-0">
          <img src="/assets/aire/careers.jpg" alt="AIRE Services hiring" className="h-full w-full object-cover opacity-30" />
          <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(2,6,23,0.94),rgba(2,6,23,0.82),rgba(8,145,178,0.25))]" />
        </div>
        <div className="relative mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-cyan-200">Careers</p>
            <h1 className="mt-2 text-4xl font-bold tracking-tight md:text-5xl">Join the AIRE team</h1>
            <p className="mt-4 text-base leading-relaxed text-slate-200 md:text-lg">
              AIRE’s public hiring page highlights an immediate opening for an on-demand driver. This standalone site keeps the role visible
              and presents the opportunity in a cleaner, more modern format.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <a href="mailto:admin@aireservicesguam.com?subject=AIRE%20Career%20Inquiry" className="rounded-xl bg-cyan-400 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300">
                Email Your Resume
              </a>
              <Link to="/contact" className="rounded-xl border border-white/20 px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/10">
                Contact AIRE
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section className="py-14 md:py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
          <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
            <section className="rounded-3xl border border-slate-200 bg-slate-50/70 p-7">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-cyan-700">Current Opening</p>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">Immediate opening for on-demand driver</h2>
              <div className="mt-6">
                <h3 className="text-sm font-semibold uppercase tracking-[0.12em] text-slate-500">Responsibilities</h3>
                <div className="mt-4 space-y-3 text-sm leading-relaxed text-slate-600">
                  {responsibilities.map((item) => (
                    <div key={item} className="flex gap-3"><span className="mt-1 text-cyan-700">•</span><span>{item}</span></div>
                  ))}
                </div>
              </div>
            </section>

            <section className="rounded-3xl border border-slate-200 bg-white p-7 shadow-sm">
              <h3 className="text-sm font-semibold uppercase tracking-[0.12em] text-slate-500">Position Requirements</h3>
              <div className="mt-4 space-y-3 text-sm leading-relaxed text-slate-600">
                {requirements.map((item) => (
                  <div key={item} className="flex gap-3"><span className="mt-1 text-cyan-700">•</span><span>{item}</span></div>
                ))}
              </div>

              <div className="mt-8 rounded-2xl border border-cyan-200 bg-cyan-50/70 p-5 text-sm leading-relaxed text-slate-700">
                <p className="font-semibold text-slate-900">Training Experience</p>
                <p className="mt-2">
                  No specific experience is required. AIRE’s public hiring page says the team will train all aspects of the job if you bring the right
                  customer-service and relationship skills.
                </p>
              </div>

              <div className="mt-8 rounded-2xl bg-slate-950 p-5 text-sm text-slate-300">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-cyan-200">Send resume or hand deliver to</p>
                <p className="mt-3 font-medium text-white">admin@aireservicesguam.com</p>
                <p className="mt-2 leading-relaxed">1780 Admiral Sherman Boulevard<br />Tiyan (Barrigada), Guam 96913</p>
              </div>
            </section>
          </div>
        </div>
      </section>
    </div>
    </>
  )
}
