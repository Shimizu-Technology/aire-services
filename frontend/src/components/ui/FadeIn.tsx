import { useEffect, useState } from 'react'

interface FadeInProps {
  children: React.ReactNode
  delay?: number
  duration?: number
  className?: string
}

export function FadeIn({ 
  children, 
  delay = 0, 
  duration = 160,
  className = '' 
}: FadeInProps) {
  const [isVisible, setIsVisible] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsVisible(true)
    }, delay)

    return () => clearTimeout(timer)
  }, [delay])

  return (
    <div
      className={`motion-reduce:!opacity-100 motion-reduce:!transition-none transition-opacity ${className}`}
      style={{
        opacity: isVisible ? 1 : 0,
        transitionDuration: `${Math.min(duration, 160)}ms`,
        transitionTimingFunction: 'ease-out'
      }}
    >
      {children}
    </div>
  )
}

// Staggered fade-in for lists
interface FadeInListProps {
  children: React.ReactNode[]
  staggerDelay?: number
  initialDelay?: number
  duration?: number
  className?: string
}

export function FadeInList({ 
  children, 
  staggerDelay = 50, 
  initialDelay = 0,
  duration = 160,
  className = ''
}: FadeInListProps) {
  return (
    <>
      {children.map((child, index) => (
        <FadeIn 
          key={index} 
          delay={initialDelay + (index * staggerDelay)}
          duration={duration}
          className={className}
        >
          {child}
        </FadeIn>
      ))}
    </>
  )
}
