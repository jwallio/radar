import { LIVE_CONTEXT_MODULES } from '../config/liveContext'
import { LIVE_STREAMERS } from '../config/liveStreamers'
import { INTEGRATION_FLAGS } from '../config/integrations'
import { useMapStore } from '../state/mapStore'
import { ModuleStateNotice, ModuleStatusBadge } from './ModuleStatusBadge'
import { LiveStreamerPlayer } from './LiveStreamerPlayer'

interface LiveContextRailProps { embedded?: boolean }

export function LiveContextRail({ embedded = false }: LiveContextRailProps) {
  const selectedLiveStreamerId = useMapStore((state) => state.selectedLiveStreamerId)
  const setSelectedLiveStreamerId = useMapStore((state) => state.setSelectedLiveStreamerId)

  const selectedStreamer = LIVE_STREAMERS.find((streamer) => streamer.id === selectedLiveStreamerId)
    ?? LIVE_STREAMERS.find((streamer) => streamer.isLiveByDefault)
    ?? LIVE_STREAMERS[0]

  const streamerDisabled = !INTEGRATION_FLAGS.embeddedStreamers

  const content = (
    <>
      <div className="live-context-intro">
        <h2>Live Context</h2>
        {embedded && <p>Use this only when map context needs live eyes or field audio. Keep the map as the primary decision surface.</p>}
      </div>

      <section className="context-card">
        <div className="module-title-row">
          <h3>Live Streamers</h3>
          <ModuleStatusBadge state={streamerDisabled ? 'disabled' : selectedStreamer ? 'ready' : 'degraded'} />
        </div>
        {!streamerDisabled && selectedStreamer && (
          <p className="weather-news-meta">Selected: {selectedStreamer.label}{selectedStreamer.region ? ` · ${selectedStreamer.region}` : ''}</p>
        )}

        {streamerDisabled && (
          <ModuleStateNotice
            state="disabled"
            title="Embedded streamers disabled"
            message="Enable VITE_ENABLE_EMBEDDED_STREAMERS=true to show in-app live streamer playback."
          />
        )}

        {!streamerDisabled && (
          <>
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
            {selectedStreamer && <LiveStreamerPlayer key={selectedStreamer.id} streamer={selectedStreamer} />}
          </>
        )}
      </section>

      {embedded ? (
        <details className="context-card live-reference-links">
          <summary>Reference links</summary>
          {LIVE_CONTEXT_MODULES.map((module) => (
            <section key={module.id} className="live-reference-group">
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
        </details>
      ) : (
        LIVE_CONTEXT_MODULES.map((module) => (
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
        ))
      )}
    </>
  )

  return embedded ? <div className="workspace-module-body">{content}</div> : <aside className="operator-rail right-rail">{content}</aside>
}
