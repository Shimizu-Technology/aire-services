import { useEffect } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import Header from './Header'
import Footer from './Footer'
import { PublicBusinessInfoProvider } from '../../contexts/PublicBusinessInfoContext'
import { usePublicBusinessInfo } from '../../contexts/publicBusinessInfo'
import { buildLocalBusinessSchema, buildWebsiteSchema } from '../seo/seoSchemas'

function PublicStructuredData() {
  const businessInfo = usePublicBusinessInfo()

  useEffect(() => {
    const scriptId = 'public-business-json-ld'
    const existingScript = document.getElementById(scriptId)
    existingScript?.remove()

    const script = document.createElement('script')
    script.id = scriptId
    script.type = 'application/ld+json'
    script.textContent = JSON.stringify([
      buildWebsiteSchema(),
      buildLocalBusinessSchema(businessInfo),
    ])
    document.head.appendChild(script)

    return () => {
      script.remove()
    }
  }, [businessInfo])

  return null
}

export default function PublicLayout() {
  const location = useLocation()

  return (
    <PublicBusinessInfoProvider>
    <div className="min-h-screen flex flex-col">
      <PublicStructuredData />
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[100] focus:px-4 focus:py-2 focus:bg-white focus:text-black focus:shadow-lg focus:rounded focus:outline-none"
      >
        Skip to main content
      </a>
      <Header />
      <main id="main-content" className="flex-1">
        <AnimatePresence mode="wait">
          <motion.div
            key={location.pathname}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
          >
            <Outlet />
          </motion.div>
        </AnimatePresence>
      </main>
      <Footer />
    </div>
    </PublicBusinessInfoProvider>
  )
}
