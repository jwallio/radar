import { useEffect, useMemo, useRef, useState } from 'react'
import type { LiveStreamer } from '../types/weather'

interface LiveStreamerPlayerProps {
  streamer: LiveStreamer
}

export function LiveStreamerPlayer({ streamer }: LiveStreamerPlayerProps) {
  const [loaded, setLoaded] = useState(false)
  const [timedOut, setTimedOut] = useState(false)
  const loadedRef = useRef(false)

  useEffect(() => {
    loadedRef.current = loaded
  }, [loaded])

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setTimedOut(() => {
        if (!loadedRef.current) {
          console.warn('[live-streamer] embed-load-timeout', { streamerId: streamer.id, label: streamer.label })
        }
        return true
      })
    }, 8000)

    return () => window.clearTimeout(timeout)
  }, [streamer.id, streamer.label])

  const showFallback = useMemo(() => timedOut && !loaded, [timedOut, loaded])
  const playerState = showFallback ? 'fallback' : loaded ? 'ready' : 'loading'

  return (
    <div className="live-streamer-player">
      <div className="live-streamer-player-top">
        <div>
          <strong>{streamer.label}</strong>
          {streamer.region && <span>{streamer.region}</span>}
        </div>
        <span className={`live-streamer-health ${playerState}`} aria-live="polite">
          {playerState === 'ready' ? 'embed ready' : playerState === 'fallback' ? 'fallback' : 'connecting'}
        </span>
      </div>
      <iframe
        title={`Live stream: ${streamer.label}`}
        src={streamer.youtubeEmbedUrl}
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        referrerPolicy="strict-origin-when-cross-origin"
        allowFullScreen
        onLoad={() => setLoaded(true)}
      />
      {showFallback && (
        <p className="weather-news-meta">
          In-app playback may be blocked by the source or network policy. Use channel link fallback.
        </p>
      )}
      <a href={streamer.youtubeChannelUrl} target="_blank" rel="noreferrer">Open channel on YouTube</a>
    </div>
  )
}
