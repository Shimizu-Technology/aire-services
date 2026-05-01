import type { SiteMedia } from '../../lib/api'
import { videoEmbedUrl } from '../../lib/siteMedia'

interface SiteMediaFrameProps {
  media?: SiteMedia | null;
  fallbackSrc?: string;
  fallbackAlt: string;
  className?: string;
  mediaClassName?: string;
  hero?: boolean;
  controls?: boolean;
}

export default function SiteMediaFrame({
  media,
  fallbackSrc,
  fallbackAlt,
  className = '',
  mediaClassName = 'h-full w-full object-cover',
  hero = false,
  controls = false,
}: SiteMediaFrameProps) {
  const alt = media?.alt_text || fallbackAlt
  const poster = media?.poster_url || fallbackSrc
  const imageSource = media?.media_type === 'image' ? (media.file_url || media.external_url) : poster
  const embedUrl = media?.external_url ? videoEmbedUrl(media.external_url) : null

  return (
    <div className={`relative overflow-hidden bg-slate-200 ${className}`}>
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
          preload={hero ? 'metadata' : 'none'}
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
        <img src={imageSource} alt={alt} className={mediaClassName} loading={hero ? 'eager' : 'lazy'} />
      ) : (
        <div className="h-full w-full bg-slate-200" aria-label={alt} />
      )}
    </div>
  )
}
