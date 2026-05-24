import { useQuery } from '@tanstack/react-query'
import { fetchRainViewerMetadata } from '../services/rainviewer'
import { useMapStore } from '../state/mapStore'

function formatUtcFromSeconds(seconds: number | null): string {
  if (!seconds) return 'Unknown'
  const date = new Date(seconds * 1000)
  return Number.isNaN(date.getTime()) ? 'Unknown' : date.toLocaleString()
}

function formatUtcFromFrameTime(seconds: number): string {
  const date = new Date(seconds * 1000)
  return Number.isNaN(date.getTime()) ? 'Unknown' : date.toLocaleString()
}

export function RadarPanel() {
  const selectedRadarFrameTime = useMapStore((state) => state.selectedRadarFrameTime)
  const setSelectedRadarFrameTime = useMapStore((state) => state.setSelectedRadarFrameTime)
  const radarOpacity = useMapStore((state) => state.radarOpacity)
  const setRadarOpacity = useMapStore((state) => state.setRadarOpacity)
  const radar = useQuery({
    queryKey: ['rainviewer-metadata'],
    queryFn: fetchRainViewerMetadata,
    staleTime: 180_000,
  })

  const data = radar.data
  const frames = data?.frames ?? []
  const latest = data?.latestFrame ?? null
  const selected = selectedRadarFrameTime
    ? frames.find((frame) => frame.time === selectedRadarFrameTime) ?? latest
    : latest
  const selectedIndex = selected ? frames.findIndex((frame) => frame.time === selected.time) : -1
  const hasPrev = selectedIndex > 0
  const hasNext = selectedIndex >= 0 && selectedIndex < frames.length - 1

  function selectPrev() {
    if (!hasPrev) return
    setSelectedRadarFrameTime(frames[selectedIndex - 1].time)
  }

  function selectNext() {
    if (!hasNext) return
    setSelectedRadarFrameTime(frames[selectedIndex + 1].time)
  }

  return (
    <section className="panel-block">
      <h3>Radar Context</h3>
      <p className="radar-meta-row">Source: RainViewer</p>
      <p className="radar-meta-row">Feed URL: {data?.sourceUrl ?? 'Unavailable'}</p>
      {data?.version && <p className="radar-meta-row">API version: {data.version}</p>}
      <p className="radar-meta-row">Generated: {formatUtcFromSeconds(data?.generated ?? null)}</p>
      <p className="radar-meta-row">Frames: {frames.length}</p>
      <p className="radar-meta-row">Latest frame: {latest ? formatUtcFromFrameTime(latest.time) : 'None'}</p>
      <p className="radar-meta-row">Selected frame: {selected ? formatUtcFromFrameTime(selected.time) : 'None'}</p>

      {radar.isLoading && <p className="radar-status">Loading RainViewer metadata...</p>}
      {data?.error && (
        <p className="radar-status radar-error">
          Feed status: {data.error.kind} ({data.error.message})
        </p>
      )}
      {!radar.isLoading && !data?.error && frames.length === 0 && (
        <p className="radar-status">No radar frames returned by RainViewer.</p>
      )}

      <div className="radar-button-row">
        <button type="button" onClick={selectPrev} disabled={!hasPrev}>
          Previous
        </button>
        <button type="button" onClick={() => setSelectedRadarFrameTime(null)} disabled={frames.length === 0}>
          Latest
        </button>
        <button type="button" onClick={selectNext} disabled={!hasNext}>
          Next
        </button>
      </div>

      <label className="radar-slider-row">
        <span>Opacity: {Math.round(radarOpacity * 100)}%</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={radarOpacity}
          onChange={(event) => setRadarOpacity(Number(event.target.value))}
        />
      </label>
    </section>
  )
}

