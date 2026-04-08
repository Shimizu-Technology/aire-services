import { useEffect } from 'react'
import { Link } from 'react-router-dom'

const programs = [
  {
    title: 'Private Pilot Certificate',
    description: 'The foundational certificate that builds skill, confidence, and a real path into aviation on Guam.',
    href: '/programs',
  },
  {
    title: 'Discovery Flight',
    description: 'Take an introductory flight with an instructor and experience Guam from the left seat.',
    href: '/discovery-flight',
  },
  {
    title: 'Current Open Role',
    description: 'AIRE is hiring an on-demand driver. No experience required — the team will train you.',
    href: '/careers',
  },
]

const highlights = [
  'Start locally with discovery flights and Guam-based training',
  'Meet the certified flight instructors who guide the training experience',
  'Follow a clear path from first flight to Private Pilot Certificate',
  'Reach AIRE directly by phone, email, or social media',
]

const steps = [
  {
    title: 'Start with a discovery flight',
    description: 'Get a first-hand feel for the aircraft, the instructor, and what flight training can look like for you.',
  },
  {
    title: 'Build your ground knowledge',
    description: 'Prepare with structured ground school, FAA written exam study, and the aviation fundamentals every pilot needs.',
  },
  {
    title: 'Train consistently and earn your certificate',
    description: 'Move through flight hours, required experience, and your FAA check-ride with a local training team behind you.',
  },
]

const quickLinks = [
  { label: 'Call AIRE', value: '(671) 477-4243', href: 'tel:+16714774243' },
  { label: 'Core training path', value: 'Private Pilot', href: '/programs' },
  { label: 'Follow on Instagram', value: 'Instagram', href: 'https://www.instagram.com/aireservicesguam/' },
  { label: 'Follow on Facebook', value: 'Facebook', href: 'https://www.facebook.com/aireservicesguam/' },
]

const credibility = [
  {
    title: 'Featured in local coverage',
    text: 'AIRE has been covered in Pacific Island Times and Guam PDN around Guam-based aviation training and local pilot opportunities.',
  },
  {
    title: 'Real local footprint',
    text: 'AIRE is visible across social media, community directories, and local aviation discussions — a real presence in the Guam community.',
  },
  {
    title: 'Built around Guam students',
    text: 'The mission is clear: help aspiring pilots train locally instead of leaving island to begin their path into aviation.',
  },
]

const faqs = [
  {
    question: "What is the best first step if I'm new to aviation?",
    answer: 'For most people, a discovery flight is the easiest and least intimidating place to start. It gives you a practical first experience before committing to full training.',
  },
  {
    question: 'Does AIRE offer a path toward a Private Pilot Certificate?',
    answer: 'Yes. The Private Pilot Certificate is the core foundational training path at AIRE and the first major step into aviation.',
  },
  {
    question: 'Can current pilots ask about aircraft rental?',
    answer: 'Yes. AIRE offers aircraft rental with specific qualification and checkout requirements for current pilots.',
  },
]

export default function AireHome() {
  useEffect(() => { document.title = 'AIRE Services Guam | Flight Training & Discovery Flights' }, [])
  return (
    <div className="bg-white text-slate-900">
      <section className="relative overflow-hidden bg-slate-950 text-white">
        <div className="absolute inset-0">
          <img src="/assets/aire/hero.jpg" alt="AIRE Services aircraft and training" className="h-full w-full object-cover opacity-30" />
          <div className="absolute inset-0 bg-[linear-gradient(120deg,rgba(2,6,23,0.95),rgba(2,6,23,0.72),rgba(8,145,178,0.30))]" />
        </div>
        <div className="relative mx-auto grid max-w-6xl gap-10 px-4 py-20 sm:px-6 md:py-28 lg:grid-cols-[1.1fr_0.9fr] lg:px-8">
          <div>
            <p className="inline-flex rounded-full border border-white/15 bg-white/10 px-4 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-cyan-200">
              Learn to fly on Guam
            </p>
            <h1 className="mt-6 max-w-3xl text-4xl font-bold leading-tight tracking-tight md:text-6xl">
              Discovery flights, local flight training, and a real path into aviation.
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-relaxed text-slate-200 md:text-lg">
              AIRE Services Guam helps future pilots start with confidence — from introductory discovery flights
              to the Private Pilot Certificate — with local instructors, direct contact, and a practical path into aviation.
            </p>
            <div className="mt-10 flex flex-wrap gap-3">
              <Link to="/discovery-flight" className="rounded-xl bg-cyan-400 px-6 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300">
                Book a Discovery Flight
              </Link>
              <Link to="/programs" className="rounded-xl border border-white/25 px-6 py-3 text-sm font-semibold text-white transition hover:bg-white/10">
                Explore Programs
              </Link>
              <Link to="/careers" className="rounded-xl border border-cyan-300/70 px-6 py-3 text-sm font-semibold text-cyan-200 transition hover:bg-cyan-400/10">
                See Hiring
              </Link>
            </div>
            <div className="mt-10 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {quickLinks.map((item) => (
                <a
                  key={item.label}
                  href={item.href}
                  {...(item.href.startsWith('http') ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                  className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4 text-center backdrop-blur-sm transition hover:border-white/20 hover:bg-white/10"
                >
                  <div className="text-base font-bold text-white sm:text-lg">{item.value}</div>
                  <div className="mt-1 text-[11px] uppercase tracking-[0.12em] text-slate-300">{item.label}</div>
                </a>
              ))}
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur-sm lg:mt-10">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-cyan-200">Why AIRE</p>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-white">Built for Guam, with a clear and local path into flight training</h2>
            <div className="mt-6 space-y-4">
              {highlights.map((item) => (
                <div key={item} className="flex items-start gap-3 rounded-2xl border border-white/10 bg-slate-900/35 px-4 py-4">
                  <div className="mt-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-cyan-400/20 text-cyan-200">✓</div>
                  <p className="text-sm leading-relaxed text-slate-200">{item}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="py-16 md:py-24">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
          <div className="mb-10 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-cyan-700">Programs & Opportunities</p>
              <h2 className="mt-2 text-3xl font-bold tracking-tight text-slate-900 md:text-4xl">Choose the next step that fits where you are</h2>
              <p className="mt-3 max-w-2xl text-sm leading-relaxed text-slate-600 md:text-base">
                Whether you want to test the waters, begin formal training, or explore an open role with the team,
                AIRE gives you a direct path forward.
              </p>
            </div>
            <Link to="/programs" className="text-sm font-semibold text-cyan-700 hover:text-cyan-900">
              View program details →
            </Link>
          </div>

          <div className="grid gap-5 md:grid-cols-3">
            {programs.map((program) => (
              <Link
                key={program.title}
                to={program.href}
                className="rounded-2xl border border-slate-200 bg-slate-50/70 p-6 transition hover:-translate-y-0.5 hover:border-cyan-300 hover:bg-cyan-50/40"
              >
                <h3 className="text-lg font-semibold tracking-tight text-slate-900">{program.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-600">{program.description}</p>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-slate-50 py-16 md:py-24">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-cyan-700">Training Path</p>
            <h2 className="mt-2 text-3xl font-bold tracking-tight text-slate-900 md:text-4xl">A clearer route from first interest to first certificate</h2>
          </div>

          <div className="mt-10 grid gap-5 md:grid-cols-3">
            {steps.map((step, index) => (
              <div key={step.title} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <div className="text-sm font-semibold uppercase tracking-[0.12em] text-cyan-700">Step {index + 1}</div>
                <h3 className="mt-3 text-xl font-semibold tracking-tight text-slate-900">{step.title}</h3>
                <p className="mt-3 text-sm leading-relaxed text-slate-600">{step.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-16 md:py-24">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-cyan-700">Why trust AIRE?</p>
            <h2 className="mt-2 text-3xl font-bold tracking-tight text-slate-900 md:text-4xl">A public presence that already signals credibility</h2>
          </div>
          <div className="mt-10 grid gap-5 md:grid-cols-3">
            {credibility.map((item) => (
              <div key={item.title} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <h3 className="text-lg font-semibold tracking-tight text-slate-900">{item.title}</h3>
                <p className="mt-3 text-sm leading-relaxed text-slate-600">{item.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-slate-50 py-16 md:py-24">
        <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-cyan-700">Frequently Asked</p>
            <h2 className="mt-2 text-3xl font-bold tracking-tight text-slate-900 md:text-4xl">Questions future students are likely to ask</h2>
          </div>
          <div className="mt-10 space-y-4">
            {faqs.map((faq) => (
              <div key={faq.question} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <h3 className="text-lg font-semibold text-slate-900">{faq.question}</h3>
                <p className="mt-3 text-sm leading-relaxed text-slate-600">{faq.answer}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-16 md:py-24">
        <div className="mx-auto grid max-w-6xl gap-8 rounded-3xl bg-slate-950 px-6 py-10 text-white sm:px-8 lg:grid-cols-[1fr_auto] lg:items-center lg:px-10">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-cyan-200">Ready to begin?</p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight">Take the next step with AIRE Services Guam.</h2>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-slate-300 md:text-base">
              If you’re exploring flight training, discovery flights, or rental options, reach out and we’ll help you figure out the best place to start.
            </p>
          </div>
          <div className="flex flex-wrap gap-3 lg:justify-end">
            <Link to="/contact" className="rounded-xl bg-cyan-400 px-6 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300">
              Contact AIRE
            </Link>
            <Link to="/team" className="rounded-xl border border-white/20 px-6 py-3 text-sm font-semibold text-white transition hover:bg-white/10">
              Meet the Crew
            </Link>
          </div>
        </div>
      </section>
    </div>
  )
}
