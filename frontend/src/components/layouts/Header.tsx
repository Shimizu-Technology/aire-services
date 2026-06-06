import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { SignedIn, SignedOut, SignInButton, UserButton } from '@clerk/clerk-react'
import { useAuthContext } from '../../contexts/AuthContext'
import { cx } from '../../lib/cx'

const navigation = [
  { name: 'Home', href: '/' },
  { name: 'Programs', href: '/programs' },
  { name: 'Team', href: '/team' },
  { name: 'Careers', href: '/careers' },
  { name: 'Contact', href: '/contact' },
]

export default function Header() {
  const [mobileOpen, setMobileOpen] = useState(false)
  const location = useLocation()
  const { isClerkEnabled, userRole, isStaff, isLoading } = useAuthContext()

  const isActive = (href: string) => location.pathname === href

  return (
    <header className="sticky top-0 z-50 border-b border-slate-200/80 bg-white/[0.92] shadow-[0_1px_0_rgba(15,23,42,0.03)] backdrop-blur-xl supports-[backdrop-filter]:bg-white/[0.82]">
      <nav className="mx-auto flex h-[68px] max-w-6xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8 xl:h-[74px]">
        <Link to="/" className="flex min-w-0 items-center rounded-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-cyan-500" aria-label="AIRE Services Guam home">
          <img src="/assets/aire/logo.png" alt="AIRE Services Guam" className="h-11 w-auto shrink-0 object-contain sm:h-12 xl:h-[3.35rem]" />
        </Link>

        <div className="hidden items-center gap-2 xl:flex">
          <div className="flex items-center gap-1 rounded-2xl border border-slate-200/70 bg-slate-50/70 p-1">
            {navigation.map((item) => (
              <Link
                key={item.href}
                to={item.href}
                className={cx(
                  'inline-flex h-10 items-center rounded-xl px-3.5 text-sm font-semibold leading-none transition duration-200',
                  isActive(item.href)
                    ? 'bg-white text-cyan-700 shadow-sm ring-1 ring-slate-200/80'
                    : 'text-slate-600 hover:bg-white/80 hover:text-slate-950',
                )}
              >
                {item.name}
              </Link>
            ))}
          </div>

          {isClerkEnabled && (
            <div className="ml-2 flex items-center gap-2 border-l border-slate-200 pl-4">
              <SignedOut>
                <SignInButton mode="modal" forceRedirectUrl="/admin" fallbackRedirectUrl="/admin">
                  <button className="inline-flex h-11 items-center rounded-2xl bg-slate-950 px-5 text-sm font-semibold leading-none text-white shadow-[0_14px_30px_rgba(15,23,42,0.18)] transition hover:-translate-y-0.5 hover:bg-slate-800">
                    Staff Login
                  </button>
                </SignInButton>
              </SignedOut>
              <SignedIn>
                {!isLoading && isStaff && (
                  <>
                    {userRole === 'admin' && (
                      <Link
                        to="/kiosk"
                        className="inline-flex h-11 items-center rounded-2xl border border-cyan-300 bg-white px-4 text-sm font-semibold leading-none text-cyan-700 transition hover:-translate-y-0.5 hover:bg-cyan-50"
                      >
                        Staff Kiosk
                      </Link>
                    )}
                    <Link to="/admin" className="inline-flex h-11 items-center rounded-2xl px-3.5 text-sm font-semibold leading-none text-slate-600 transition hover:bg-slate-50 hover:text-slate-950">
                      Admin
                    </Link>
                  </>
                )}
                <UserButton afterSignOutUrl="/" appearance={{ elements: { avatarBox: 'w-9 h-9' } }} />
              </SignedIn>
            </div>
          )}
        </div>

        <button
          onClick={() => setMobileOpen((v) => !v)}
          className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-700 shadow-sm transition hover:bg-slate-50 xl:hidden"
          aria-label="Toggle menu"
          aria-expanded={mobileOpen}
        >
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={mobileOpen ? 'M6 18L18 6M6 6l12 12' : 'M4 7h16M4 12h16M4 17h16'} />
          </svg>
        </button>
      </nav>

      {mobileOpen && (
        <div className="border-t border-slate-200 bg-white/[0.96] shadow-xl shadow-slate-900/5 backdrop-blur-xl xl:hidden">
          <div className="mx-auto max-w-6xl space-y-2 px-4 py-4 sm:px-6 lg:px-8">
            {navigation.map((item) => (
              <Link
                key={item.href}
                to={item.href}
                onClick={() => setMobileOpen(false)}
                className={cx(
                  'flex min-h-12 items-center rounded-2xl px-4 text-sm font-semibold transition',
                  isActive(item.href) ? 'bg-cyan-50 text-cyan-800 ring-1 ring-cyan-100' : 'text-slate-700 hover:bg-slate-50',
                )}
              >
                {item.name}
              </Link>
            ))}
            {isClerkEnabled && (
              <div className="pt-2">
                <SignedOut>
                  <SignInButton mode="modal" forceRedirectUrl="/admin" fallbackRedirectUrl="/admin">
                    <button className="flex min-h-12 w-full items-center justify-center rounded-2xl bg-slate-950 px-4 text-sm font-semibold text-white transition hover:bg-slate-800">
                      Staff Login
                    </button>
                  </SignInButton>
                </SignedOut>
                <SignedIn>
                  {!isLoading && isStaff && (
                    <>
                      {userRole === 'admin' && (
                        <Link
                          to="/kiosk"
                          onClick={() => setMobileOpen(false)}
                          className="flex min-h-12 items-center rounded-2xl border border-cyan-200 px-4 text-sm font-semibold text-cyan-700"
                        >
                          Staff Kiosk
                        </Link>
                      )}
                      <Link
                        to="/admin"
                        onClick={() => setMobileOpen(false)}
                        className={cx('flex min-h-12 items-center rounded-2xl bg-cyan-50 px-4 text-sm font-semibold text-cyan-700', userRole === 'admin' && 'mt-2')}
                      >
                        Open Admin Dashboard
                      </Link>
                    </>
                  )}
                  <div className={cx('flex min-h-12 items-center justify-between rounded-2xl border border-slate-200 px-4', !isLoading && isStaff && 'mt-2')}>
                    <span className="text-sm font-medium text-slate-600">Account</span>
                    <UserButton afterSignOutUrl="/" appearance={{ elements: { avatarBox: 'w-9 h-9' } }} />
                  </div>
                </SignedIn>
              </div>
            )}
          </div>
        </div>
      )}
    </header>
  )
}
