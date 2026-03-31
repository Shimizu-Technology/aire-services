import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { SignedIn, SignedOut, SignInButton, UserButton } from '@clerk/clerk-react'
import { useAuthContext } from '../../contexts/AuthContext'

const navigation = [
  { name: 'Home', href: '/' },
  { name: 'Programs', href: '/programs' },
  { name: 'Discovery Flight', href: '/discovery-flight' },
  { name: 'Team', href: '/team' },
  { name: 'Careers', href: '/careers' },
  { name: 'Contact', href: '/contact' },
]

export default function Header() {
  const [mobileOpen, setMobileOpen] = useState(false)
  const location = useLocation()
  const { isClerkEnabled } = useAuthContext()

  const isActive = (href: string) => location.pathname === href

  return (
    <header className="sticky top-0 z-50 border-b border-slate-200/80 bg-white/95 backdrop-blur">
      <nav className="mx-auto flex h-[72px] max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <Link to="/" className="flex min-w-0 items-center gap-3">
          <img src="/assets/aire/logo.png" alt="AIRE Services Guam" className="h-12 w-auto shrink-0 object-contain" />
          <div className="hidden min-w-0 sm:block">
            <div className="truncate text-sm font-semibold uppercase leading-tight tracking-[0.14em] text-slate-500">AIRE Services</div>
            <div className="truncate text-xs leading-tight text-slate-400">Guam Flight Training</div>
          </div>
        </Link>

        <div className="hidden items-center gap-2 lg:flex">
          {navigation.map((item) => (
            <Link
              key={item.href}
              to={item.href}
              className={`inline-flex h-10 items-center rounded-lg px-3 text-sm font-medium leading-none transition ${
                isActive(item.href)
                  ? 'bg-cyan-50 text-cyan-700'
                  : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
              }`}
            >
              {item.name}
            </Link>
          ))}

          <div className="ml-2 flex items-center gap-2">
            <Link
              to="/kiosk"
              className="inline-flex h-10 items-center rounded-lg border border-cyan-300 px-4 text-sm font-semibold leading-none text-cyan-700 transition hover:bg-cyan-50"
            >
              Staff Kiosk
            </Link>
            {isClerkEnabled && (
              <>
                <SignedOut>
                  <SignInButton mode="modal">
                    <button className="inline-flex h-10 items-center rounded-lg bg-slate-900 px-4 text-sm font-semibold leading-none text-white transition hover:bg-slate-800">
                      Staff Login
                    </button>
                  </SignInButton>
                </SignedOut>
                <SignedIn>
                  <Link to="/admin" className="inline-flex h-10 items-center rounded-lg px-3 text-sm font-medium leading-none text-slate-600 transition hover:bg-slate-50 hover:text-slate-900">
                    Admin
                  </Link>
                  <UserButton afterSignOutUrl="/" appearance={{ elements: { avatarBox: 'w-9 h-9' } }} />
                </SignedIn>
              </>
            )}
          </div>
        </div>

        <button
          onClick={() => setMobileOpen((v) => !v)}
          className="rounded-lg p-2 text-slate-600 transition hover:bg-slate-100 lg:hidden"
          aria-label="Toggle menu"
        >
          <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={mobileOpen ? 'M6 18L18 6M6 6l12 12' : 'M4 6h16M4 12h16M4 18h16'} />
          </svg>
        </button>
      </nav>

      {mobileOpen && (
        <div className="border-t border-slate-200 bg-white lg:hidden">
          <div className="space-y-2 px-4 py-4">
            {navigation.map((item) => (
              <Link
                key={item.href}
                to={item.href}
                onClick={() => setMobileOpen(false)}
                className={`block rounded-lg px-3 py-3 text-sm font-medium ${
                  isActive(item.href) ? 'bg-cyan-50 text-cyan-700' : 'text-slate-700 hover:bg-slate-50'
                }`}
              >
                {item.name}
              </Link>
            ))}
            <Link
              to="/kiosk"
              onClick={() => setMobileOpen(false)}
              className="block rounded-lg border border-cyan-200 px-3 py-3 text-sm font-semibold text-cyan-700"
            >
              Staff Kiosk
            </Link>
            {isClerkEnabled && (
              <div className="pt-2">
                <SignedOut>
                  <SignInButton mode="modal">
                    <button className="w-full rounded-lg bg-slate-900 px-3 py-3 text-sm font-semibold text-white transition hover:bg-slate-800">
                      Staff Login
                    </button>
                  </SignInButton>
                </SignedOut>
              </div>
            )}
          </div>
        </div>
      )}
    </header>
  )
}
