import { useEffect } from 'react'
import { Outlet } from 'react-router-dom'
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
  return (
    <PublicBusinessInfoProvider>
      <div className="flex min-h-screen flex-col bg-white">
        <PublicStructuredData />
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[100] focus:px-4 focus:py-2 focus:bg-white focus:text-black focus:shadow-lg focus:rounded focus:outline-none"
        >
          Skip to main content
        </a>
        <Header />
        <main id="main-content" className="flex-1">
          <Outlet />
        </main>
        <Footer />
      </div>
    </PublicBusinessInfoProvider>
  )
}
