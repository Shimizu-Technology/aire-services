import { Link } from 'react-router-dom'
import { socialLinks } from '../../lib/socialLinks'

export default function Footer() {
  const year = new Date().getFullYear()

  return (
    <footer className="bg-slate-950 text-slate-300">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-6 lg:grid-cols-[1.1fr_0.9fr_0.9fr] lg:px-8">
        <div>
          <img src="/assets/aire/logo.png" alt="AIRE Services Guam" className="h-14 w-auto rounded bg-white/95 p-2" />
          <p className="mt-4 max-w-sm text-sm leading-relaxed text-slate-400">
            Discovery flights, local flight training, current hiring, and internal operations built for Guam.
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            {socialLinks.map((link) => (
              <a key={link.label} href={link.href} target="_blank" rel="noreferrer" className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-300 transition hover:border-cyan-400 hover:text-white">
                {link.label}
              </a>
            ))}
          </div>
        </div>

        <div>
          <h3 className="text-sm font-semibold uppercase tracking-[0.12em] text-slate-200">Site</h3>
          <ul className="mt-4 space-y-3 text-sm">
            <li><Link to="/" className="hover:text-white">Home</Link></li>
            <li><Link to="/programs" className="hover:text-white">Programs</Link></li>
            <li><Link to="/discovery-flight" className="hover:text-white">Discovery Flight</Link></li>
            <li><Link to="/team" className="hover:text-white">Team</Link></li>
            <li><Link to="/careers" className="hover:text-white">Careers</Link></li>
            <li><Link to="/contact" className="hover:text-white">Contact</Link></li>
          </ul>
        </div>

        <div>
          <h3 className="text-sm font-semibold uppercase tracking-[0.12em] text-slate-200">Contact</h3>
          <ul className="mt-4 space-y-3 text-sm text-slate-400">
            <li>1780 Admiral Sherman Boulevard, Tiyan / Barrigada, Guam</li>
            <li>(671) 477-4243</li>
            <li>admin@aireservicesguam.com</li>
          </ul>
        </div>
      </div>
      <div className="border-t border-slate-800 px-4 py-5 text-center text-xs text-slate-500">© {year} AIRE Services Guam. All rights reserved.</div>
    </footer>
  )
}
