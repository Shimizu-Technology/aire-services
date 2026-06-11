import { useMemo, useState, type ReactNode } from 'react'
import type { SiteMedia } from '../../lib/api'
import { videoEmbedUrl } from '../../lib/siteMedia'
import { cx } from '../../lib/cx'

interface SiteMediaFrameProps {
  media?: SiteMedia | null;
  fallbackSrc?: string;
  fallbackAlt: string;
  className?: string;
  mediaClassName?: string;
  hero?: boolean;
  priority?: boolean;
  controls?: boolean;
  loading?: boolean;
  sizes?: string;
}

interface SiteImageProps {
  imageSource: string;
  srcSet?: string;
  sizes?: string;
  fallbackSrc?: string;
  alt: string;
  className: string;
  priority: boolean;
  loading: boolean;
  skeleton: ReactNode;
}

function imageSourcesFor(media: SiteMedia | null | undefined, fallbackSrc?: string, priority = false) {
  if (media?.media_type !== 'image') {
    return {
      src: fallbackSrc || null,
      srcSet: undefined,
    }
  }

  const baseSrc = media.file_card_url || media.file_url || media.external_url || fallbackSrc || null
  const heroSrc = media.file_hero_url || media.file_card_url || media.file_url || media.external_url || fallbackSrc || null
  const src = priority ? heroSrc : baseSrc
  const srcSetParts = [
    media.file_thumb_url ? `${media.file_thumb_url} 480w` : null,
    media.file_card_url ? `${media.file_card_url} 900w` : null,
    media.file_hero_url ? `${media.file_hero_url} 1800w` : null,
  ].filter(Boolean)

  return {
    src,
    srcSet: srcSetParts.length > 0 ? srcSetParts.join(', ') : undefined,
  }
}

function posterFor(media: SiteMedia | null | undefined, fallbackSrc?: string, priority = false) {
  if (!media) return fallbackSrc
  if (priority) return media.poster_hero_url || media.poster_card_url || media.poster_url || fallbackSrc
  return media.poster_card_url || media.poster_url || fallbackSrc
}

function SiteImage({ imageSource, srcSet, sizes, fallbackSrc, alt, className, priority, loading, skeleton }: SiteImageProps) {
  const [resolvedImageSource, setResolvedImageSource] = useState(imageSource)
  const [imageState, setImageState] = useState<'loading' | 'loaded' | 'error'>('loading')
  const showImageSkeleton = loading || imageState === 'loading'
  const useSrcSet = resolvedImageSource === imageSource ? srcSet : undefined

  return (
    <>
      {showImageSkeleton && skeleton}
      <img
        src={resolvedImageSource}
        srcSet={useSrcSet}
        sizes={useSrcSet ? sizes : undefined}
        alt={alt}
        className={cx(className, 'transition duration-500 ease-out', imageState === 'loaded' ? 'opacity-100' : 'opacity-0')}
        loading={priority ? 'eager' : 'lazy'}
        fetchPriority={priority ? 'high' : 'auto'}
        decoding="async"
        onLoad={() => setImageState('loaded')}
        onError={() => {
          if (fallbackSrc && resolvedImageSource !== fallbackSrc) {
            setResolvedImageSource(fallbackSrc)
            setImageState('loading')
          } else {
            setImageState('error')
          }
        }}
      />
      {imageState === 'error' && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-100 px-4 text-center text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
          Media unavailable
        </div>
      )}
    </>
  )
}

export default function SiteMediaFrame({
  media,
  fallbackSrc,
  fallbackAlt,
  className = '',
  mediaClassName = 'h-full w-full object-cover',
  hero = false,
  priority = hero,
  controls = false,
  loading = false,
  sizes = priority ? '100vw' : '(min-width: 1280px) 38vw, (min-width: 768px) 50vw, 100vw',
}: SiteMediaFrameProps) {
  const alt = media?.alt_text || fallbackAlt
  const poster = posterFor(media, fallbackSrc, priority)
  const { src: imageSource, srcSet } = imageSourcesFor(media, fallbackSrc, priority)
  const embedUrl = media?.external_url ? videoEmbedUrl(media.external_url) : null

  const skeleton = useMemo(() => (
    <div className="absolute inset-0 overflow-hidden bg-slate-200">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(34,211,238,0.16),transparent_34%),linear-gradient(135deg,#e2e8f0,#f8fafc)]" />
      <div className="absolute inset-y-0 -left-1/2 w-1/2 animate-[site-media-shimmer_1.45s_ease-in-out_infinite] bg-gradient-to-r from-transparent via-white/60 to-transparent" />
    </div>
  ), [])

  return (
    <div className={cx('relative overflow-hidden bg-slate-200', className)}>
      {media?.media_type === 'video' && media.file_url ? (
        <video
          src={media.file_url}
          poster={poster}
          className={mediaClassName}
          autoPlay={hero}
          muted={hero}
          loop={hero}
          playsInline
          controls={controls || !hero}
          preload={priority ? 'metadata' : 'none'}
        />
      ) : media?.media_type === 'video' && embedUrl && !hero ? (
        <iframe
          title={media.title}
          src={embedUrl}
          className="h-full w-full"
          loading="lazy"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
        />
      ) : imageSource ? (
        <SiteImage
          key={`${imageSource}-${fallbackSrc || ''}`}
          imageSource={imageSource}
          srcSet={srcSet}
          sizes={sizes}
          fallbackSrc={fallbackSrc}
          alt={alt}
          className={mediaClassName}
          priority={priority}
          loading={loading}
          skeleton={skeleton}
        />
      ) : loading ? (
        skeleton
      ) : (
        <div className="h-full w-full bg-slate-200" aria-label={alt} />
      )}
    </div>
  )
}
