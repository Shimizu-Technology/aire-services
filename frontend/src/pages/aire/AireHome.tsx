import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import Seo from '../../components/seo/Seo'
import { buildLocalBusinessSchema, buildWebsiteSchema } from '../../components/seo/seoSchemas'
import { FACEBOOK_URL, INSTAGRAM_URL } from '../../lib/socialLinks'

const programs = [
  {
    title: 'Private Pilot Certificate',
    description: 'The foundational certificate and the first major milestone for students beginning their flight-training journey.',
    href: '/programs',
  },
  {
    title: 'Discovery Flight',
    description: 'Take the controls with an instructor and experience what flying over Guam actually feels like.',
    href: '/discovery-flight',
  },
  {
    title: 'Current Open Role',
    description: 'AIRE is hiring for an on-demand driver role supporting customer transportation and operations.',
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
    title: 'Book a discovery flight',
    description: 'Start with a low-friction first experience and get in the aircraft with an instructor before committing to full training.',
  },
  {
    title: 'Complete ground school and written prep',
    description: 'Build the knowledge base around weather, navigation, regulations, radio work, and decision-making fundamentals.',
  },
  {
    title: 'Train toward your certificate',
    description: 'Progress through instructor-led flight training, required experience, and the final FAA check-ride.',
  },
]

const stats = [
  { label: 'Call AIRE', value: '(671) 477-4243', href: 'tel:+16714774243' },
  { label: 'Core training path', value: 'Private Pilot' },
  { label: 'Follow on Instagram', value: 'Instagram', href: INSTAGRAM_URL },
  { label: 'Follow on Facebook', value: 'Facebook', href: FACEBOOK_URL },
]

const trustSignals = [
  {
    title: 'Named instructors you can actually look up',
    text: 'See the crew behind the training experience so you know who is teaching, supporting, and guiding your path into aviation.',
  },
  {
    title: 'A clear first step into flying',
    text: 'Start with a discovery flight if you want a low-pressure way to experience the aircraft, the instructor, and the feeling of flying on Guam.',
  },
  {
    title: 'Direct ways to stay connected',
    text: 'Call, email, or follow AIRE on social media to stay close to the latest updates, hiring, and training opportunities.',
  },
]

const faqs = [
  {
    question: 'What is the best first step if I’m new to aviation?',
    answer: 'A discovery flight is the clearest first step. It lets you experience the aircraft, instructor, and overall training environment before committing to full lessons.',
  },
  {
    question: 'What program is AIRE centered around?',
    answer: 'The Private Pilot Certificate is the main training path and the first major milestone for most new students starting with AIRE.',
  },
  {
    question: 'Can I follow AIRE online before reaching out?',
    answer: 'Yes. You can follow AIRE on Instagram and Facebook to stay close to the team, updates, and training opportunities before you contact them directly.',
  },
]

export default function AireHome() {
  const jsonLd = useMemo(() => [buildWebsiteSchema(), buildLocalBusinessSchema()], [])

  return (
    <>
      <Seo
        title="AIRE Services Guam | Discovery Flights and Flight Training"
        description="Explore discovery flights, private pilot training, current hiring, and local aviation opportunities with AIRE Services Guam."
        path="/"
        jsonLd={jsonLd}
      />
      <div className="bg-white text-slate-900">
        <section className="relative overflow-hidden bg-slate-950 text-white">
          <div className="absolute inset-0">
            <img src="/assets/aire/hero.jpg" alt="AIRE Services aircraft and training" className="h-full w-full object-cover opacity-30" />
            <div className="absolute inset-0 bg-[linear-gradient(120deg,rgba(2,6,23,0.95),rgba(2,6,23,0.72),rgba(8,145,178,0.30))]" />
          </div>
          <div className="relative mx-auto grid max-w-6xl gap-10 px-4 py-20 sm:px-6 md:py-28 lg:grid-cols-[1.1fr_0.9fr] lg:px-8">
            <div>
              <p className="inline-flex rounded-full border border-white/15 bg-white/10 px-4 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-cyan-200">
                Learn to Fly on Guam
              </p>
              <h1 className="mt-6 max-w-3xl text-4xl font-bold leading-tight tracking-tight md:text-6xl">
                Discovery flights, local flight training, and a real path into aviation.
              </h1>
              <p className="mt-5 max-w-2xl text-base leading-relaxed text-slate-200 md:text-lg">
                AIRE Services Guam helps future pilots start with confidence — from introductory discovery flights to the
                Private Pilot Certificate — with local instructors, direct contact, and a practical path into aviation.
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
              <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {stats.map((stat) => (
                  <div key={stat.label} className="flex min-h-[124px] flex-col items-center justify-center rounded-2xl border border-white/10 bg-white/5 px-4 py-4 text-center backdrop-blur-sm">
                    {stat.href ? (
                      <a href={stat.href} className="inline-flex min-h-[2.25rem] items-center justify-center whitespace-nowrap text-lg font-bold text-white underline-offset-4 transition hover:text-cyan-200 hover:underline sm:text-xl xl:text-[1.65rem]">
                        {stat.value}
                      </a>
                    ) : (
                      <div className="inline-flex min-h-[2.25rem] items-center justify-center whitespace-nowrap text-lg font-bold text-white sm:text-xl xl:text-[1.65rem]">{stat.value}</div>
                    )}
                    <div className="mt-2 text-xs uppercase tracking-[0.12em] text-slate-300">{stat.label}</div>
                  </div>
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
                  Whether you want to test the waters, begin formal training, or explore an open role with the team, AIRE gives you a direct path forward.
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
              <h2 className="mt-2 text-3xl font-bold tracking-tight text-slate-900 md:text-4xl">A training path that matches how students actually start</h2>
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
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-cyan-700">Why Students Reach Out</p>
              <h2 className="mt-2 text-3xl font-bold tracking-tight text-slate-900 md:text-4xl">The details that help future students feel confident reaching out</h2>
            </div>
            <div className="mt-10 grid gap-5 md:grid-cols-3">
              {trustSignals.map((item) => (
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
              <h2 className="mt-3 text-3xl font-bold tracking-tight">Reach out, follow AIRE online, or start with a discovery flight.</h2>
              <p className="mt-3 max-w-2xl text-sm leading-relaxed text-slate-300 md:text-base">
                The strongest next step is still the simplest one: contact the team directly, ask about discovery flights, and get a real answer from a local operator.
              </p>
            </div>
            <div className="flex flex-wrap gap-3 lg:justify-end">
              <Link to="/contact" className="rounded-xl bg-cyan-400 px-6 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300">
                Contact AIRE
              </Link>
              <a href={INSTAGRAM_URL} target="_blank" rel="noreferrer" className="rounded-xl border border-white/20 px-6 py-3 text-sm font-semibold text-white transition hover:bg-white/10">
                Follow on Instagram
              </a>
              <a href={FACEBOOK_URL} target="_blank" rel="noreferrer" className="rounded-xl border border-white/20 px-6 py-3 text-sm font-semibold text-white transition hover:bg-white/10">
                Follow on Facebook
              </a>
            </div>
          </div>
        </section>
      </div>
    </>
  )
}
