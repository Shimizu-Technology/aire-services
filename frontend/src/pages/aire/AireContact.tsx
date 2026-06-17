import { useState, useEffect, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import Seo from '../../components/seo/Seo'
import SiteMediaFrame from '../../components/site/SiteMediaFrame'
import { useSiteMedia } from '../../lib/siteMedia'
import type { SiteMediaPlacement } from '../../lib/api'
import { aireAddressDisplayFor } from '../../lib/businessInfo'
import { usePublicBusinessInfo, usePublicInquiryTopics, usePublicSocialLinks } from '../../contexts/publicBusinessInfo'
import { api } from '../../lib/api'
import {
  ArrowRightIcon,
  CameraIcon,
  MailIcon,
  MessageIcon,
  PhoneIcon,
  PinIcon,
  PublicButtonLink,
  PublicPageHero,
  SocialIcon,
} from '../../components/public/PublicPrimitives'

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
  const { firstFor, loading: mediaLoading } = useSiteMedia(placements)
  const businessInfo = usePublicBusinessInfo()
  const inquiryTopics = usePublicInquiryTopics()
  const socialLinks = usePublicSocialLinks()
  const contactPoints = [
    { label: 'Email', value: businessInfo.email.display, href: businessInfo.email.href, icon: MailIcon },
    { label: 'Location', value: aireAddressDisplayFor(businessInfo), icon: PinIcon },
  ]
  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    subject: '',
    message: '',
  })
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const selectedSubject = inquiryTopics.includes(form.subject) ? form.subject : inquiryTopics[0]

  const updateField = (field: keyof typeof form, value: string) => {
    setForm((current) => ({ ...current, [field]: value }))
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSubmitting(true)
    setSuccess(null)
    setError(null)

    const payload = {
      name: form.name.trim(),
      email: form.email.trim(),
      phone: form.phone.trim(),
      subject: selectedSubject.trim(),
      message: form.message.trim(),
    }

    const response = await api.submitContact(payload)

    if (response.error || !response.data?.success) {
      setError(response.error || 'Failed to send message. Please try again.')
      setSubmitting(false)
      return
    }

    setSuccess(response.data.message || 'Your message has been sent successfully!')
    setForm({ name: '', email: '', phone: '', subject: '', message: '' })
    setSubmitting(false)
  }

  return (
    <>
      <Seo
        title="Contact | AIRE Services Guam"
        description="Contact AIRE Services Guam about pilot training, Guam aerial tours, video packages, or general aviation questions."
        path="/contact"
      />
      <div className="bg-white text-slate-950">
        <PublicPageHero
          eyebrow="Contact"
          title="Talk with AIRE about training, tours, media, or careers"
          description="Reach out if you are planning flight training, comparing tour options, adding a video package, or checking local and military rates."
          media={firstFor('contact_feature')}
          fallbackSrc="/assets/aire/hero.jpg"
          mediaLoading={mediaLoading}
          fallbackAlt="AIRE Services Guam aircraft and office"
          mediaMode="side"
          compact
          actions={(
            <>
              <PublicButtonLink to={businessInfo.phone.href} variant="primary">Call {businessInfo.phone.display}</PublicButtonLink>
              <PublicButtonLink to={businessInfo.email.href} variant="secondary">Email AIRE</PublicButtonLink>
            </>
          )}
        />

        <section className="py-16 md:py-24">
          <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
            <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
              <aside className="space-y-6 rounded-[2rem] border border-slate-200 bg-slate-50/70 p-5 shadow-[0_18px_50px_rgba(15,23,42,0.06)] sm:p-7">
                {(mediaLoading || firstFor('contact_feature')) && (
                  <SiteMediaFrame
                    media={firstFor('contact_feature')}
                    fallbackAlt="AIRE Services Guam aircraft and office"
                    loading={mediaLoading}
                    className="aspect-[16/10] rounded-[1.5rem]"
                    mediaClassName="h-full w-full object-cover"
                  />
                )}

                <div>
                  <h2 className="text-2xl font-bold tracking-tight text-slate-950">Direct contact information</h2>
                  <div className="mt-5 space-y-3">
                    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                      <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">Phone & messaging</p>
                      <div className="mt-4 space-y-3">
                        {businessInfo.phoneContacts.map((contact) => {
                          const Icon = contact.channel === 'whatsapp' ? MessageIcon : PhoneIcon
                          const isWhatsApp = contact.channel === 'whatsapp'

                          return (
                            <a
                              key={`${contact.channel}-${contact.e164}-${contact.label}`}
                              href={contact.href}
                              target={isWhatsApp ? '_blank' : undefined}
                              rel={isWhatsApp ? 'noopener noreferrer' : undefined}
                              className="group grid min-h-16 grid-cols-[auto_1fr_auto] items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 transition hover:-translate-y-0.5 hover:border-cyan-300 hover:bg-cyan-50/70"
                            >
                              <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-white text-cyan-700 shadow-sm ring-1 ring-slate-200 group-hover:ring-cyan-200">
                                <Icon className="h-5 w-5" />
                              </span>
                              <span className="min-w-0">
                                <span className="block text-xs font-bold uppercase tracking-[0.14em] text-slate-500">{contact.label}</span>
                                <span className="mt-1 block text-sm font-bold text-slate-950">{contact.display}</span>
                              </span>
                              <span className="hidden rounded-full border border-cyan-200 bg-white px-3 py-1 text-xs font-bold text-cyan-700 sm:inline-flex">
                                {contact.actionLabel}
                              </span>
                            </a>
                          )
                        })}
                      </div>
                    </div>

                    {contactPoints.map((item) => {
                      const Icon = item.icon
                      return (
                        <div key={item.label} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                          <div className="flex gap-3">
                            <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-cyan-50 text-cyan-700">
                              <Icon className="h-5 w-5" />
                            </span>
                            <div>
                              <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">{item.label}</p>
                              {item.href ? (
                                <a href={item.href} className="mt-2 inline-block min-h-10 text-sm font-semibold leading-7 text-cyan-700 transition hover:text-cyan-900">
                                  {item.value}
                                </a>
                              ) : (
                                <p className="mt-2 text-sm leading-7 text-slate-800">{item.value}</p>
                              )}
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">Pricing snapshot</p>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    {pricingSnapshot.map((item) => (
                      <div key={item.label} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                        <div className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">{item.label}</div>
                        <div className="mt-2 text-sm font-bold text-slate-950">{item.value}</div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">Social</p>
                  <div className="mt-3 flex flex-wrap gap-2.5">
                    {socialLinks.map((link) => (
                      <a key={link.key} href={link.url} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-2 rounded-2xl border border-cyan-200 bg-cyan-50 px-4 py-2.5 text-sm font-bold text-cyan-700 transition hover:-translate-y-0.5 hover:bg-cyan-100">
                        <SocialIcon socialKey={link.key || link.label} />
                        {link.label}
                      </a>
                    ))}
                  </div>
                </div>

                <div className="rounded-[1.75rem] bg-slate-950 p-6 text-white shadow-[0_18px_50px_rgba(15,23,42,0.15)]">
                  <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/10 text-cyan-200">
                    <CameraIcon />
                  </span>
                  <h3 className="mt-5 text-xl font-bold tracking-tight">Need help choosing the right option?</h3>
                  <div className="mt-4 space-y-3 text-sm leading-7 text-slate-300">
                    <p>Pilot training: ask about the Private Pilot path and the best place to start.</p>
                    <p>Tours: ask which route fits your time and sightseeing goals.</p>
                    <p>Video packages: ask whether standard or all-inclusive is the better fit.</p>
                  </div>
                  <div className="mt-5 flex flex-wrap gap-3">
                    <PublicButtonLink to="/programs" variant="primary">View services</PublicButtonLink>
                    <PublicButtonLink to="/team" variant="secondary">Meet the team</PublicButtonLink>
                  </div>
                </div>
              </aside>

              <section className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-[0_18px_50px_rgba(15,23,42,0.06)] sm:p-7">
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-700">Send an Inquiry</p>
                <h2 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">Let&apos;s get you to the right next step</h2>

                <form onSubmit={handleSubmit} className="mt-8 space-y-5">
                  <fieldset>
                    <legend className="mb-3 block text-sm font-semibold text-slate-700">Subject</legend>
                    <div className="grid gap-3 sm:grid-cols-2">
                      {inquiryTopics.map((topic) => {
                        const selected = selectedSubject === topic

                        return (
                          <button
                            key={topic}
                            type="button"
                            onClick={() => updateField('subject', topic)}
                            aria-pressed={selected}
                            className={`min-h-14 rounded-2xl border px-4 py-4 text-left text-sm font-semibold transition ${
                              selected
                                ? 'border-cyan-500 bg-cyan-50 text-cyan-950 shadow-sm ring-4 ring-cyan-100'
                                : 'border-slate-200 bg-slate-50 text-slate-700 hover:border-cyan-200 hover:bg-cyan-50/60'
                            }`}
                          >
                            {topic}
                          </button>
                        )
                      })}
                    </div>
                    <p className="mt-3 text-xs leading-6 text-slate-500">Choose the topic that best matches what you need help with.</p>
                  </fieldset>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <label htmlFor="name" className="mb-2 block text-sm font-semibold text-slate-700">Name</label>
                      <input
                        id="name"
                        value={form.name}
                        onChange={(e) => updateField('name', e.target.value)}
                        className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm text-slate-950 shadow-sm outline-none transition focus:border-cyan-500 focus:ring-4 focus:ring-cyan-100"
                        placeholder="Your name"
                        required
                      />
                    </div>
                    <div>
                      <label htmlFor="email" className="mb-2 block text-sm font-semibold text-slate-700">Email</label>
                      <input
                        id="email"
                        type="email"
                        value={form.email}
                        onChange={(e) => updateField('email', e.target.value)}
                        className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm text-slate-950 shadow-sm outline-none transition focus:border-cyan-500 focus:ring-4 focus:ring-cyan-100"
                        placeholder="you@example.com"
                        required
                      />
                    </div>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-[0.8fr_1.2fr]">
                    <div>
                      <label htmlFor="phone" className="mb-2 block text-sm font-semibold text-slate-700">Phone</label>
                      <input
                        id="phone"
                        value={form.phone}
                        onChange={(e) => updateField('phone', e.target.value)}
                        className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm text-slate-950 shadow-sm outline-none transition focus:border-cyan-500 focus:ring-4 focus:ring-cyan-100"
                        placeholder="(671) ..."
                      />
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                      <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">Selected topic</p>
                      <p className="mt-2 text-sm font-semibold text-slate-950">{selectedSubject}</p>
                    </div>
                  </div>

                  <div>
                    <label htmlFor="message" className="mb-2 block text-sm font-semibold text-slate-700">Message</label>
                    <textarea
                      id="message"
                      value={form.message}
                      onChange={(e) => updateField('message', e.target.value)}
                      rows={6}
                      className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm text-slate-950 shadow-sm outline-none transition focus:border-cyan-500 focus:ring-4 focus:ring-cyan-100"
                      placeholder="Tell us what you're interested in and any timing, pricing, or route questions you have."
                      required
                    />
                  </div>

                  {error && <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
                  {success && <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{success}</div>}

                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      type="submit"
                      disabled={submitting}
                      className={`inline-flex min-h-11 items-center justify-center rounded-2xl px-6 py-3 text-sm font-bold transition ${submitting ? 'cursor-not-allowed bg-slate-300 text-slate-600' : 'bg-slate-950 text-white hover:-translate-y-0.5 hover:bg-slate-800'}`}
                    >
                      {submitting ? 'Sending...' : 'Send Inquiry'}
                    </button>
                    <Link to="/programs" className="inline-flex min-h-11 items-center gap-2 rounded-2xl px-2 py-3 text-sm font-bold text-cyan-700 transition hover:text-cyan-900">
                      Review services <ArrowRightIcon />
                    </Link>
                  </div>
                </form>
              </section>
            </div>
          </div>
        </section>
      </div>
    </>
  )
}
