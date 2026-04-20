import { ExternalLink } from 'lucide-react'

type VideoContent = {
  url?: string
  caption?: string
}

function isYouTubeUrl(url: string): boolean {
  return url.includes('youtube.com') || url.includes('youtu.be')
}

function getYouTubeEmbedUrl(url: string): string | null {
  try {
    const u = new URL(url)
    let videoId: string | null = null

    if (u.hostname === 'youtu.be') {
      videoId = u.pathname.slice(1)
    } else if (u.hostname.includes('youtube.com')) {
      videoId = u.searchParams.get('v')
    }

    if (!videoId) return null
    return `https://www.youtube.com/embed/${videoId}`
  } catch {
    return null
  }
}

export function VideoSection({ content }: { content: VideoContent | null }) {
  if (!content || !content.url) {
    return <p className="text-[#6a6a6a]">No video content available.</p>
  }

  const { url, caption } = content

  if (isYouTubeUrl(url)) {
    const embedUrl = getYouTubeEmbedUrl(url)
    if (embedUrl) {
      return (
        <div className="space-y-3">
          <div className="aspect-video w-full rounded-xl overflow-hidden border border-[#c1c1c1] bg-black">
            <iframe
              src={embedUrl}
              title={caption ?? 'Video'}
              className="w-full h-full"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          </div>
          {caption && (
            <p className="text-xs text-[#6a6a6a] text-center">{caption}</p>
          )}
        </div>
      )
    }
  }

  // Generic video file or fallback link
  const isVideoFile = /\.(mp4|webm|ogg)$/i.test(url)
  if (isVideoFile) {
    return (
      <div className="space-y-3">
        <div className="rounded-xl overflow-hidden border border-[#c1c1c1]">
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video
            src={url}
            controls
            className="w-full max-h-[480px]"
          />
        </div>
        {caption && (
          <p className="text-xs text-[#6a6a6a] text-center">{caption}</p>
        )}
      </div>
    )
  }

  // Fallback: external link
  return (
    <div className="space-y-3">
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-3 p-4 rounded-xl border border-[#c1c1c1] hover:border-[#ff385c] hover:bg-[#f2f2f2] transition-all group"
      >
        <ExternalLink className="w-4 h-4 text-[#6a6a6a] group-hover:text-[#ff385c] transition-colors" />
        <span className="text-sm text-[#222222] group-hover:text-[#ff385c] transition-colors font-500">
          {caption ?? 'Watch Video'}
        </span>
      </a>
    </div>
  )
}
