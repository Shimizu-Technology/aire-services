// Skeleton loading component for better UX

interface SkeletonProps {
  className?: string
  variant?: 'text' | 'rectangular' | 'circular'
  width?: string | number
  height?: string | number
  count?: number
}

export function Skeleton({ 
  className = '', 
  variant = 'rectangular',
  width,
  height,
  count = 1
}: SkeletonProps) {
  const baseClasses = 'animate-pulse bg-gray-200'
  
  const variantClasses = {
    text: 'rounded',
    rectangular: 'rounded-lg',
    circular: 'rounded-full'
  }

  const style: React.CSSProperties = {}
  if (width) style.width = typeof width === 'number' ? `${width}px` : width
  if (height) style.height = typeof height === 'number' ? `${height}px` : height

  if (count === 1) {
    return (
      <div 
        className={`${baseClasses} ${variantClasses[variant]} ${className}`}
        style={style}
      />
    )
  }

  return (
    <div className="space-y-2">
      {Array.from({ length: count }).map((_, i) => (
        <div 
          key={i}
          className={`${baseClasses} ${variantClasses[variant]} ${className}`}
          style={style}
        />
      ))}
    </div>
  )
}

// Pre-built skeleton patterns for common UI elements
export function SkeletonCard() {
  return (
    <div className="bg-white rounded-2xl border border-secondary-dark p-5 space-y-3">
      <div className="flex items-center gap-3">
        <Skeleton variant="circular" width={40} height={40} />
        <div className="flex-1 space-y-2">
          <Skeleton height={16} className="w-3/4" />
          <Skeleton height={12} className="w-1/2" />
        </div>
      </div>
      <Skeleton height={12} className="w-full" />
      <Skeleton height={12} className="w-2/3" />
    </div>
  )
}

export function SkeletonTableRow({ columns = 5 }: { columns?: number }) {
  return (
    <tr className="border-b border-secondary-dark">
      {Array.from({ length: columns }).map((_, i) => (
        <td key={i} className="px-4 py-4">
          <Skeleton height={16} className={i === 0 ? 'w-32' : 'w-20'} />
        </td>
      ))}
    </tr>
  )
}

export function SkeletonTimeEntry() {
  return (
    <div className="p-4 border-b border-secondary-dark">
      <div className="flex items-start gap-3">
        <Skeleton variant="circular" width={40} height={40} />
        <div className="flex-1 space-y-2">
          <div className="flex items-center justify-between">
            <Skeleton height={16} className="w-24" />
            <Skeleton height={16} className="w-12" />
          </div>
          <Skeleton height={12} className="w-3/4" />
        </div>
      </div>
    </div>
  )
}

export function SkeletonStats() {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="bg-white rounded-2xl border border-secondary-dark p-5">
          <div className="flex items-center gap-4">
            <Skeleton variant="rectangular" width={48} height={48} className="rounded-xl" />
            <div className="space-y-2">
              <Skeleton height={28} className="w-12" />
              <Skeleton height={12} className="w-20" />
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
