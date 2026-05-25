import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo } from 'react'
import { fetchRainViewerMetadata } from '../services/rainviewer'
import { useMapStore } from '../state/mapStore'

function fmt(sec: number | null) { if (!sec) return 'Unknown'; const d=new Date(sec*1000); return Number.isNaN(d.getTime())?'Unknown':d.toLocaleString() }

export function RadarPanel() {
  const selectedRadarFrameTime = useMapStore((s) => s.selectedRadarFrameTime)
  const setSelectedRadarFrameTime = useMapStore((s) => s.setSelectedRadarFrameTime)
  const radarOpacity = useMapStore((s) => s.radarOpacity)
  const setRadarOpacity = useMapStore((s) => s.setRadarOpacity)
  const radarPlaying = useMapStore((s) => s.radarPlaying)
  const setRadarPlaying = useMapStore((s) => s.setRadarPlaying)
  const toggleRadarPlaying = useMapStore((s) => s.toggleRadarPlaying)
  const radarFrameIntervalMs = useMapStore((s) => s.radarFrameIntervalMs)
  const setRadarFrameIntervalMs = useMapStore((s) => s.setRadarFrameIntervalMs)
  const radar = useQuery({ queryKey: ['rainviewer-metadata'], queryFn: fetchRainViewerMetadata, staleTime: 180_000 })

  const data = radar.data
  const frames = useMemo(() => data?.frames ?? [], [data?.frames])
  const latest = data?.latestFrame ?? null
  const selected = selectedRadarFrameTime ? frames.find((f) => f.time === selectedRadarFrameTime) ?? latest : latest
  const selectedIndex = selected ? frames.findIndex((f) => f.time === selected.time) : -1
  const hasPrev = selectedIndex > 0
  const hasNext = selectedIndex >= 0 && selectedIndex < frames.length - 1

  useEffect(() => {
    if (frames.length < 2 && radarPlaying) { setRadarPlaying(false); return }
    if (!radarPlaying || frames.length < 2) return
    const timer = setInterval(() => {
      const currentIndex = selectedRadarFrameTime ? frames.findIndex((f) => f.time === selectedRadarFrameTime) : frames.length - 1
      const nextIndex = ((currentIndex >= 0 ? currentIndex : frames.length - 1) + 1) % frames.length
      setSelectedRadarFrameTime(frames[nextIndex].time)
    }, radarFrameIntervalMs)
    return () => clearInterval(timer)
  }, [frames, radarPlaying, radarFrameIntervalMs, selectedRadarFrameTime, setRadarPlaying, setSelectedRadarFrameTime])

  return (
    <section className="panel-block">
      <h3>Radar Context</h3>
      <p className="radar-meta-row">Source: RainViewer</p>
      <p className="radar-meta-row" title={data?.sourceUrl ?? ''}>Feed: public weather maps metadata</p>
      <p className="radar-meta-row">Radar tiles © RainViewer</p>
      {data?.version && <p className="radar-meta-row">API version: {data.version}</p>}
      <p className="radar-meta-row">Generated: {fmt(data?.generated ?? null)}</p>
      <p className="radar-meta-row">Frames: {frames.length}</p>
      <p className="radar-meta-row">Frame position: {selectedIndex >= 0 ? `${selectedIndex + 1} / ${frames.length}` : `0 / ${frames.length}`}</p>
      <p className="radar-meta-row">Latest frame: {latest ? fmt(latest.time) : 'None'}</p>
      <p className="radar-meta-row">Selected frame: {selected ? fmt(selected.time) : 'None'}</p>
      <div className="radar-button-row">
        <button type="button" onClick={() => hasPrev && setSelectedRadarFrameTime(frames[selectedIndex - 1].time)} disabled={!hasPrev}>Previous</button>
        <button type="button" onClick={() => setSelectedRadarFrameTime(null)} disabled={frames.length === 0}>Latest</button>
        <button type="button" onClick={() => hasNext && setSelectedRadarFrameTime(frames[selectedIndex + 1].time)} disabled={!hasNext}>Next</button>
      </div>
      <div className="radar-button-row"><button type="button" onClick={toggleRadarPlaying} disabled={frames.length < 2}>{radarPlaying ? 'Pause' : 'Play'}</button></div>
      <label className="radar-slider-row"><span>Playback speed: {(radarFrameIntervalMs / 1000).toFixed(2)}s</span><input type="range" min={250} max={2500} step={250} value={radarFrameIntervalMs} onChange={(e) => setRadarFrameIntervalMs(Number(e.target.value))} /></label>
      <label className="radar-slider-row"><span>Opacity: {Math.round(radarOpacity * 100)}%</span><input type="range" min={0} max={1} step={0.05} value={radarOpacity} onChange={(e) => setRadarOpacity(Number(e.target.value))} /></label>
    </section>
  )
}
