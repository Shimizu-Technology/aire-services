import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import Seo from '../../components/seo/Seo'
import { api } from '../../lib/api'
import { socialLinks } from '../../lib/socialLinks'
import SiteMediaFrame from '../../components/site/SiteMediaFrame'
import { useSiteMedia } from '../../lib/siteMedia'
import type { SiteMediaPlacement } from '../../lib/api'
import { aireAddressDisplay, aireBusinessInfo } from '../../lib/businessInfo'

const contactPoints = [
  { label: 'Phone', value: aireBusinessInfo.phone.display, href: aireBusinessInfo.phone.href },
  { label: 'Email', value: aireBusinessInfo.email.display, href: aireBusinessInfo.email.href },
  { label: 'Location', value: aireAddressDisplay },
]

const defaultInquiryTopics = [
  'Pilot Training',
  'Guam Aerial Tours',
  'Video Packages',
  'Discovery Flight',
  'Careers',
  'General Inquiry',
]

const pricingSnapshot = [
  { label: 'Bay Tour', value: '$275' },
  { label: 'Island Tour', value: '$395' },
  { label: 'Sunset Tour', value: '$345' },
  { label: 'Standard Video', value: 'From $79' },
  { label: 'All Inclusive', value: 'From $129' },
]

export default function AireContact() {
  useEffect(() => { document.title = 'Contact | AIRE Services Guam' }, [])
  const placements: SiteMediaPlacement[] = ['contact_feature']
  const { firstFor } = useSiteMedia(placements)
  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    subject: defaultInquiryTopics[0],
    message: '',
  })
  const [inquiryTopics, setInquiryTopics] = useState(defaultInquiryTopics)
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function loadContactSettings() {
      const response = await api.getPublicContactSettings()
      const nextTopics = response.data?.inquiry_topics?.filter(Boolean)
      if (!cancelled && nextTopics && nextTopics.length > 0) {
        setInquiryTopics(nextTopics)
        setForm((current) => ({
          ...current,
          subject: nextTopics.includes(current.subject) ? current.subject : nextTopics[0],
        }))
      }
    }

    loadContactSettings()
    return () => { cancelled = true }
  }, [])

  const updateField = (field: keyof typeof form, value: string) => {
    setForm((current) => ({ ...current, [field]: value }))
  }

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSubmitting(true)
    setSuccess(null)
    setError(null)

    const payload = {
      name: form.name.trim(),
      email: form.email.trim(),
      phone: form.phone.trim(),
      subject: form.subject.trim(),
      message: form.message.trim(),
    }

    const response = await api.submitContact(payload)

    if (response.error || !response.data?.success) {
      setError(response.error || 'Failed to send message. Please try again.')
      setSubmitting(false)
      return
    }

    setSuccess(response.data.message || 'Your message has been sent successfully!')
    setForm({ name: '', email: '', phone: '', subject: inquiryTopics[0] || defaultInquiryTopics[0], message: '' })
    setSubmitting(false)
  }

  return (
    <>
      <Seo
        title="Contact | AIRE Services Guam"
        description="Contact AIRE Services Guam about pilot training, Guam aerial tours, video packages, or general aviation questions."
        path="/contact"
      />
      <div className="bg-white py-14 md:py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-cyan-700">Contact</p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900 md:text-5xl">Talk with AIRE about training, tours, video packages, or careers</h1>
            <p className="mt-4 text-sm leading-relaxed text-slate-600 md:text-base">
              Reach out if you are planning flight training, comparing tour options, adding a video package, or checking local and military rates.
            </p>
          </div>

          <div className="mt-10 grid gap-6 lg:grid-cols-[0.88fr_1.12fr]">
            <section className="rounded-[2rem] border border-slate-200 bg-slate-50/70 p-7">
              {firstFor('contact_feature') && (
                <SiteMediaFrame
                  media={firstFor('contact_feature')}
                  fallbackAlt="AIRE Services Guam aircraft and office"
                  className="-mx-1 mb-6 aspect-[16/10] rounded-[1.5rem]"
                  mediaClassName="h-full w-full object-cover"
                />
              )}
              <h2 className="text-2xl font-semibold tracking-tight text-slate-900">Direct contact information</h2>
              <div className="mt-6 space-y-4">
                {contactPoints.map((item) => (
                  <div key={item.label} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                    <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{item.label}</p>
                    {item.href ? (
                      <a href={item.href} className="mt-2 inline-block text-sm font-medium leading-relaxed text-cyan-700 transition hover:text-cyan-800">
                        {item.value}
                      </a>
                    ) : (
                      <p className="mt-2 text-sm leading-relaxed text-slate-800">{item.value}</p>
                    )}
                  </div>
                ))}
              </div>

              <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Pricing snapshot</p>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  {pricingSnapshot.map((item) => (
                    <div key={item.label} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                      <div className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{item.label}</div>
                      <div className="mt-2 text-sm font-semibold text-slate-900">{item.value}</div>
                    </div>
                  ))}
                </div>
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

              <div className="mt-8 rounded-[1.75rem] bg-slate-950 p-6 text-white">
                <h3 className="text-xl font-semibold tracking-tight">Need help choosing the right option?</h3>
                <div className="mt-4 space-y-3 text-sm leading-relaxed text-slate-300">
                  <p>Pilot training: ask about the Private Pilot path and the best place to start.</p>
                  <p>Tours: ask which route fits your time and sightseeing goals.</p>
                  <p>Video packages: ask whether standard or all-inclusive is the better fit.</p>
                </div>
                <div className="mt-5 flex flex-wrap gap-3">
                  <Link to="/programs" className="rounded-xl bg-cyan-400 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300">
                    View Services
                  </Link>
                  <Link to="/team" className="rounded-xl border border-white/20 px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/10">
                    Meet the Team
                  </Link>
                </div>
              </div>
            </section>

            <section className="rounded-[2rem] border border-slate-200 bg-white p-7 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-cyan-700">Send an Inquiry</p>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">Let&apos;s get you to the right next step</h2>

              <form onSubmit={handleSubmit} className="mt-8 space-y-4">
                <fieldset>
                  <legend className="mb-2 block text-sm font-medium text-slate-700">Subject</legend>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {inquiryTopics.map((topic) => {
                      const selected = form.subject === topic

                      return (
                        <button
                          key={topic}
                          type="button"
                          onClick={() => updateField('subject', topic)}
                          aria-pressed={selected}
                          className={`rounded-2xl border px-4 py-4 text-left text-sm font-medium transition ${
                            selected
                              ? 'border-cyan-500 bg-cyan-50 text-cyan-900 shadow-sm ring-4 ring-cyan-100'
                              : 'border-slate-200 bg-slate-50 text-slate-700 hover:border-cyan-200 hover:bg-cyan-50/60'
                          }`}
                        >
                          {topic}
                        </button>
                      )
                    })}
                  </div>
                  <p className="mt-2 text-xs text-slate-500">Choose the topic that best matches what you need help with.</p>
                </fieldset>

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
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Selected topic</p>
                    <p className="mt-2 text-sm font-medium text-slate-900">{form.subject}</p>
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
                    placeholder="Tell us what you're interested in and any timing, pricing, or route questions you have."
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
