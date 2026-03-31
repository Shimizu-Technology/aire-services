import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'

const EASE = [0.22, 1, 0.36, 1] as const

interface NotFoundProps {
  title?: string
  message?: string
  backTo?: string
  backLabel?: string
}

export default function NotFound({
  title = 'Page Not Found',
  message = "Oops! The page you're looking for doesn't seem to exist. It may have been moved or the link might be incorrect.",
  backTo = '/',
  backLabel = 'Return Home'
}: NotFoundProps) {
  return (
    <div className="min-h-[70vh] flex items-center justify-center px-4">
      <motion.div
        className="text-center max-w-lg"
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: EASE }}
      >
        {/* Large 404 with gradient */}
        <motion.h1
          className="text-[8rem] md:text-[10rem] font-bold leading-none tracking-tighter gradient-text mb-2 select-none"
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.7, delay: 0.1, ease: EASE }}
        >
          404
        </motion.h1>

        <motion.h2
          className="text-2xl md:text-3xl font-bold text-gray-900 mb-4 tracking-tight"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.3, ease: EASE }}
        >
          {title}
        </motion.h2>

        <motion.p
          className="text-gray-500 text-lg leading-relaxed mb-10 max-w-md mx-auto"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.4, ease: EASE }}
        >
          {message}
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.5, ease: EASE }}
        >
          <Link
            to={backTo}
            className="group inline-flex items-center gap-2 bg-primary text-white px-8 py-4 rounded-xl text-base font-medium hover:bg-primary-dark transition-all duration-200 hover:shadow-lg hover:shadow-primary/20 hover:-translate-y-0.5 active:translate-y-0"
          >
            <svg
              className="w-4 h-4 transition-transform duration-200 group-hover:-translate-x-1"
              fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            {backLabel}
          </Link>
        </motion.div>

        {/* Decorative accent dots */}
        <motion.div
          className="mt-16 flex items-center justify-center gap-2"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.7 }}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-accent/40" />
          <span className="w-1.5 h-1.5 rounded-full bg-accent/70" />
          <span className="w-1.5 h-1.5 rounded-full bg-accent/40" />
        </motion.div>
      </motion.div>
    </div>
  )
}
