import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import Seo from '../../components/seo/Seo'
import { api } from '../../lib/api'
import { socialLinks } from '../../lib/socialLinks'

const contactPoints = [
  { label: 'Phone', value: '(671) 477-4243' },
  { label: 'Email', value: 'admin@aireservicesguam.com' },
  { label: 'Location', value: '1780 Admiral Sherman Boulevard, Tiyan / Barrigada, Guam 96913' },
]

const reasons = [
  'Private Pilot Certificate training',
  'Discovery flight questions',
  'Aircraft rental requirements',
  'Career opportunities',
  'General training path guidance',
]

const subjects = [
  'Private Pilot Certificate',
  'Discovery Flight',
  'Aircraft Rental',
  'Careers',
  'General Inquiry',
]

export default function AireContact() {
  useEffect(() => { document.title = 'Contact | AIRE Services Guam' }, [])
  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    subject: subjects[0],
    message: '',
  })
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const updateField = (field: keyof typeof form, value: string) => {
    setForm((current) => ({ ...current, [field]: value }))
  }

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSubmitting(true)
    setSuccess(null)
    setError(null)

    const response = await api.submitContact(form)

    if (response.error || !response.data?.success) {
      setError(response.error || 'Failed to send message. Please try again.')
      setSubmitting(false)
      return
    }

    setSuccess(response.data.message || 'Your message has been sent successfully!')
    setForm({ name: '', email: '', phone: '', subject: subjects[0], message: '' })
    setSubmitting(false)
  }

  return (
    <>
      <Seo
        title="Contact | AIRE Services Guam"
        description="Contact AIRE Services Guam about discovery flights, private pilot training, aircraft rental, or general aviation questions."
        path="/contact"
      />
      <div className="bg-white py-14 md:py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-cyan-700">Contact</p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900 md:text-5xl">Talk with AIRE about training, discovery flights, rentals, or careers</h1>
            <p className="mt-4 text-sm leading-relaxed text-slate-600 md:text-base">
              Ready to start? Reach out to the AIRE team and get help with discovery flights, private pilot training, aircraft rental questions, or the best next step for your goals.
            </p>
          </div>

          <div className="mt-10 grid gap-6 lg:grid-cols-[0.88fr_1.12fr]">
            <section className="rounded-3xl border border-slate-200 bg-slate-50/70 p-7">
              <h2 className="text-2xl font-semibold tracking-tight text-slate-900">Direct contact information</h2>
              <div className="mt-6 space-y-4">
                {contactPoints.map((item) => (
                  <div key={item.label} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                    <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{item.label}</p>
                    <p className="mt-2 text-sm leading-relaxed text-slate-800">{item.value}</p>
                  </div>
                ))}
              </div>

              <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Social</p>
                <div className="mt-3 flex flex-wrap gap-3">
                  {socialLinks.map((link) => (
                    <a key={link.label} href={link.href} target="_blank" rel="noreferrer" className="rounded-xl border border-cyan-200 bg-cyan-50 px-4 py-2.5 text-sm font-semibold text-cyan-700 transition hover:bg-cyan-100">
                      {link.label}
                    </a>
                  ))}
                </div>
              </div>

              <div className="mt-8 rounded-3xl bg-slate-950 p-6 text-white">
                <h3 className="text-xl font-semibold tracking-tight">Want the fastest starting point?</h3>
                <p className="mt-3 text-sm leading-relaxed text-slate-300">
                  Discovery flights are still the easiest way to experience flying, meet the team, and decide whether full training is the right next step.
                </p>
                <div className="mt-5 flex flex-wrap gap-3">
                  <Link to="/discovery-flight" className="rounded-xl bg-cyan-400 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300">
                    Explore Discovery Flight
                  </Link>
                  <Link to="/programs" className="rounded-xl border border-white/20 px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/10">
                    View Programs
                  </Link>
                </div>
              </div>
            </section>

            <section className="rounded-3xl border border-slate-200 bg-white p-7 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-cyan-700">Send an Inquiry</p>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">Let’s help you find the right place to start</h2>
              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                {reasons.map((item) => (
                  <div key={item} className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm font-medium text-slate-700">
                    {item}
                  </div>
                ))}
              </div>

              <form onSubmit={handleSubmit} className="mt-8 space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label htmlFor="name" className="mb-2 block text-sm font-medium text-slate-700">Name</label>
                    <input
                      id="name"
                      value={form.name}
                      onChange={(e) => updateField('name', e.target.value)}
                      className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-900 shadow-sm outline-none transition focus:border-cyan-500 focus:ring-4 focus:ring-cyan-100"
                      placeholder="Your name"
                      required
                    />
                  </div>
                  <div>
                    <label htmlFor="email" className="mb-2 block text-sm font-medium text-slate-700">Email</label>
                    <input
                      id="email"
                      type="email"
                      value={form.email}
                      onChange={(e) => updateField('email', e.target.value)}
                      className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-900 shadow-sm outline-none transition focus:border-cyan-500 focus:ring-4 focus:ring-cyan-100"
                      placeholder="you@example.com"
                      required
                    />
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-[0.8fr_1.2fr]">
                  <div>
                    <label htmlFor="phone" className="mb-2 block text-sm font-medium text-slate-700">Phone</label>
                    <input
                      id="phone"
                      value={form.phone}
                      onChange={(e) => updateField('phone', e.target.value)}
                      className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-900 shadow-sm outline-none transition focus:border-cyan-500 focus:ring-4 focus:ring-cyan-100"
                      placeholder="(671) ..."
                    />
                  </div>
                  <div>
                    <label htmlFor="subject" className="mb-2 block text-sm font-medium text-slate-700">Subject</label>
                    <select
                      id="subject"
                      value={form.subject}
                      onChange={(e) => updateField('subject', e.target.value)}
                      className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-900 shadow-sm outline-none transition focus:border-cyan-500 focus:ring-4 focus:ring-cyan-100"
                    >
                      {subjects.map((subject) => (
                        <option key={subject} value={subject}>{subject}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label htmlFor="message" className="mb-2 block text-sm font-medium text-slate-700">Message</label>
                  <textarea
                    id="message"
                    value={form.message}
                    onChange={(e) => updateField('message', e.target.value)}
                    rows={6}
                    className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm text-slate-900 shadow-sm outline-none transition focus:border-cyan-500 focus:ring-4 focus:ring-cyan-100"
                    placeholder="Tell us what you're interested in and where you'd like to start."
                    required
                  />
                </div>

                {error && <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
                {success && <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{success}</div>}

                <button
                  type="submit"
                  disabled={submitting}
                  className={`rounded-xl px-6 py-3 text-sm font-semibold transition ${submitting ? 'cursor-not-allowed bg-slate-300 text-slate-600' : 'bg-slate-950 text-white hover:bg-slate-800'}`}
                >
                  {submitting ? 'Sending...' : 'Send Inquiry'}
                </button>
              </form>
            </section>
          </div>
        </div>
      </div>
    </>
  )
}
