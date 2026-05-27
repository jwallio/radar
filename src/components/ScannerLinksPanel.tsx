import { useMemo, useState } from 'react'
import { INTEGRATION_FLAGS } from '../config/integrations'
import { SCANNER_LINK_GROUPS } from '../config/scannerLinks'
import type { ExternalOpsItem } from '../types/weather'
import { ModuleStateNotice, ModuleStatusBadge } from './ModuleStatusBadge'

interface ScannerLinksPanelProps {
  embedded?: boolean
}

type ScannerPlaybackState = 'idle' | 'connecting' | 'live' | 'stalled' | 'error'

const scannerSources = SCANNER_LINK_GROUPS.flatMap((group) => group.items)

function ScannerPlayer({ source }: { source: ExternalOpsItem }) {
  const [playbackState, setPlaybackState] = useState<ScannerPlaybackState>('idle')
  const playableUrl = source.audioStreamUrl ?? source.embedUrl
  const stateLabel = playbackState === 'live' ? 'live' : playbackState

  if (!playableUrl) {
    return (
      <div className="scanner-player scanner-player-empty">
        <span className="scanner-health-chip error">external only</span>
        <p>No embeddable scanner player is configured for this source yet.</p>
      </div>
    )
  }

  return (
    <div className="scanner-player">
      <div className="scanner-player-top">
        <strong>{source.label}</strong>
        <span className={`scanner-health-chip ${playbackState}`} aria-live="polite">{stateLabel}</span>
      </div>
      {source.audioStreamUrl ? (
        <audio
          key={source.id}
          controls
          src={source.audioStreamUrl}
          onLoadStart={() => setPlaybackState('connecting')}
          onCanPlay={() => setPlaybackState('connecting')}
          onPlaying={() => setPlaybackState('live')}
          onWaiting={() => setPlaybackState('stalled')}
          onPause={() => setPlaybackState('idle')}
          onError={() => setPlaybackState('error')}
        />
      ) : (
        <iframe
          key={source.id}
          title={`${source.label} embedded scanner`}
          src={source.embedUrl}
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
          onLoad={() => setPlaybackState('live')}
          onError={() => setPlaybackState('error')}
        />
      )}
      <a href={source.url} target="_blank" rel="noreferrer">Open canonical source</a>
    </div>
  )
}

export function ScannerLinksPanel({ embedded = false }: ScannerLinksPanelProps) {
  const defaultSource = useMemo(() => scannerSources.find((item) => item.audioStreamUrl || item.embedUrl) ?? scannerSources[0], [])
  const [selectedSourceId, setSelectedSourceId] = useState(defaultSource?.id ?? null)
  const selectedSource = scannerSources.find((item) => item.id === selectedSourceId) ?? defaultSource
  const hasEmbeddedSource = scannerSources.some((item) => item.audioStreamUrl || item.embedUrl)
  const moduleState = !INTEGRATION_FLAGS.embeddedScanners ? 'disabled' : hasEmbeddedSource ? 'ready' : 'degraded'

  const content = (
    <div className="workspace-module-body external-links-panel scanner-monitor-panel">
      <div className="module-title-row">
        <h3>Scanner Monitor</h3>
        <ModuleStatusBadge state={moduleState} />
      </div>
      {INTEGRATION_FLAGS.embeddedScanners && selectedSource && <ScannerPlayer source={selectedSource} />}
      {!INTEGRATION_FLAGS.embeddedScanners && (
        <ModuleStateNotice
          state="disabled"
          title="Embedded scanner monitor disabled"
          message="Set VITE_ENABLE_EMBEDDED_SCANNERS=true to enable in-app scanner playback surfaces. External links remain available below."
        />
      )}
      {INTEGRATION_FLAGS.embeddedScanners && !hasEmbeddedSource && (
        <ModuleStateNotice
          state="degraded"
          title="No embeddable scanner source configured"
          message="Add embedUrl or verified audioStreamUrl entries to scannerLinks.ts. External scanner links remain available."
        />
      )}
      {SCANNER_LINK_GROUPS.map((group) => (
        <section key={group.id} className="external-links-group">
          <h4>{group.title}</h4>
          {group.items.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`external-links-row scanner-source-row ${selectedSource?.id === item.id ? 'active' : ''}`}
              onClick={() => setSelectedSourceId(item.id)}
            >
              <span>{item.label}</span>
              <span className="external-links-meta">
                <span className="external-links-chip">{item.audioStreamUrl ? 'audio' : item.embedUrl ? 'embed' : 'link'}</span>
                <span className="external-links-chip">{item.sourceType}</span>
                {item.region && <span className="external-links-chip">{item.region}</span>}
              </span>
            </button>
          ))}
        </section>
      ))}
    </div>
  )

  return embedded ? content : <aside className="operator-rail right-rail">{content}</aside>
}
