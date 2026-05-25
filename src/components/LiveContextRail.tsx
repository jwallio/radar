import { LIVE_CONTEXT_MODULES } from '../config/liveContext'
import { LIVE_STREAMERS } from '../config/liveStreamers'
import { useMapStore } from '../state/mapStore'

interface LiveContextRailProps { embedded?: boolean }

export function LiveContextRail({ embedded = false }: LiveContextRailProps) {
  const selectedLiveStreamerId = useMapStore((state) => state.selectedLiveStreamerId)
  const setSelectedLiveStreamerId = useMapStore((state) => state.setSelectedLiveStreamerId)

  const selectedStreamer = LIVE_STREAMERS.find((streamer) => streamer.id === selectedLiveStreamerId)
    ?? LIVE_STREAMERS.find((streamer) => streamer.isLiveByDefault)
    ?? LIVE_STREAMERS[0]

  const content = (
    <>
      <h2>Live Context</h2>

      <section className="context-card">
        <h3>Live Streamers</h3>
        <div className="live-streamer-list">
          {LIVE_STREAMERS.map((streamer) => (
            <button
              key={streamer.id}
              type="button"
              className={selectedStreamer?.id === streamer.id ? 'active' : ''}
              onClick={() => setSelectedLiveStreamerId(streamer.id)}
            >
              {streamer.label}
              {streamer.region ? ` · ${streamer.region}` : ''}
            </button>
          ))}
        </div>
        {selectedStreamer && (
          <div className="live-streamer-player">
            <iframe
              title={`Live stream: ${selectedStreamer.label}`}
              src={selectedStreamer.youtubeEmbedUrl}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              referrerPolicy="strict-origin-when-cross-origin"
              allowFullScreen
            />
            <a href={selectedStreamer.youtubeChannelUrl} target="_blank" rel="noreferrer">Open channel on YouTube</a>
          </div>
        )}
      </section>

      {LIVE_CONTEXT_MODULES.map((module) => (
        <section key={module.id} className="context-card">
          <h3>{module.title}</h3>
          {module.items.length === 0 && <p className="context-empty">{module.emptyMessage}</p>}
          {module.items.length > 0 && (
            <ul>
              {module.items.map((item) => (
                <li key={item.id}>
                  <a href={item.url} target="_blank" rel="noreferrer">{item.label}</a>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </>
  )

  return embedded ? <div className="workspace-module-body">{content}</div> : <aside className="operator-rail right-rail">{content}</aside>
}
