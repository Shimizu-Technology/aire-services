import { Link } from 'react-router-dom'
import { aireAddressFooterFor } from '../../lib/businessInfo'
import { usePublicBusinessInfo, usePublicSocialLinks } from '../../contexts/publicBusinessInfo'
import { ArrowRightIcon, MailIcon, MessageIcon, PhoneIcon, PinIcon, PublicButtonLink, SocialIcon } from '../public/PublicPrimitives'

const siteLinks = [
  { label: 'Home', href: '/' },
  { label: 'Programs', href: '/programs' },
  { label: 'Team', href: '/team' },
  { label: 'Careers', href: '/careers' },
  { label: 'Contact', href: '/contact' },
]

export default function Footer() {
  const year = new Date().getFullYear()
  const businessInfo = usePublicBusinessInfo()
  const socialLinks = usePublicSocialLinks()

  return (
    <footer className="bg-slate-950 text-slate-300">
      <div className="mx-auto max-w-6xl px-4 pt-12 sm:px-6 lg:px-8">
        <div className="grid gap-6 rounded-[2rem] border border-white/10 bg-white/[0.04] p-6 shadow-2xl shadow-black/20 sm:p-8 lg:grid-cols-[1fr_auto] lg:items-center">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-200">Ready to plan with AIRE?</p>
            <h2 className="mt-3 max-w-2xl text-2xl font-bold tracking-tight text-white md:text-3xl">
              Talk with the Guam-based aviation team about training, tours, or media add-ons.
            </h2>
          </div>
          <div className="flex flex-wrap gap-3 lg:justify-end">
            <PublicButtonLink to="/contact" variant="primary">
              Contact AIRE <ArrowRightIcon />
            </PublicButtonLink>
            <PublicButtonLink to={businessInfo.phone.href} variant="secondary">
              Call {businessInfo.phone.display}
            </PublicButtonLink>
          </div>
        </div>

        <div className="grid gap-10 py-12 lg:grid-cols-[1.2fr_0.7fr_1fr] lg:py-14">
          <div>
            <img src="/assets/aire/logo.png" alt="AIRE Services Guam" className="h-14 w-auto rounded-xl bg-white p-2" />
            <p className="mt-5 max-w-sm text-sm leading-7 text-slate-400">
              Pilot training, Guam aerial tours, and cinematic media packages from a local aviation team.
            </p>
            <div className="mt-6 flex flex-wrap gap-2.5">
              {socialLinks.map((link) => (
                <a
                  key={link.key}
                  href={link.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex min-h-11 items-center gap-2 rounded-2xl border border-slate-700 bg-slate-900/70 px-3.5 py-2 text-sm font-semibold text-slate-300 transition hover:-translate-y-0.5 hover:border-cyan-400 hover:text-white"
                >
                  <SocialIcon socialKey={link.key || link.label} />
                  {link.label}
                </a>
              ))}
            </div>
          </div>

          <div>
            <h3 className="text-xs font-bold uppercase tracking-[0.18em] text-slate-200">Site</h3>
            <ul className="mt-4 space-y-1 text-sm">
              {siteLinks.map((link) => (
                <li key={link.href}>
                  <Link to={link.href} className="inline-flex min-h-10 items-center text-slate-400 transition hover:text-white">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h3 className="text-xs font-bold uppercase tracking-[0.18em] text-slate-200">Contact</h3>
            <ul className="mt-5 space-y-4 text-sm text-slate-400">
              <li className="flex gap-3">
                <span className="mt-0.5 text-cyan-200"><PinIcon className="h-4 w-4" /></span>
                <span>{aireAddressFooterFor(businessInfo)}</span>
              </li>
              {businessInfo.phoneContacts.map((contact) => {
                const Icon = contact.channel === 'whatsapp' ? MessageIcon : PhoneIcon
                const isWhatsApp = contact.channel === 'whatsapp'

                return (
                  <li key={`${contact.channel}-${contact.e164}-${contact.label}`}>
                    <a
                      href={contact.href}
                      target={isWhatsApp ? '_blank' : undefined}
                      rel={isWhatsApp ? 'noopener noreferrer' : undefined}
                      className="flex min-h-10 items-start gap-3 transition hover:text-white"
                    >
                      <span className="mt-1 text-cyan-200"><Icon className="h-4 w-4" /></span>
                      <span>
                        <span className="block text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">{contact.label}</span>
                        <span className="mt-1 block text-slate-300">{contact.display}</span>
                      </span>
                    </a>
                  </li>
                )
              })}
              <li>
                <a href={businessInfo.email.href} className="flex min-h-10 items-center gap-3 transition hover:text-white">
                  <span className="text-cyan-200"><MailIcon className="h-4 w-4" /></span>
                  <span>{businessInfo.email.display}</span>
                </a>
              </li>
            </ul>
          </div>
        </div>
      </div>
      <div className="border-t border-slate-800 px-4 py-5 text-center text-xs text-slate-500">© {year} AIRE Services Guam. All rights reserved.</div>
    </footer>
  )
}
