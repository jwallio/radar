import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchRainViewerMetadata } from '../services/rainviewer'
import { fetchSpcDay1Outlook, fetchSpcReports } from '../services/spc'
import { fetchNwsAlerts } from '../services/nws'
import { useMapStore } from '../state/mapStore'

type DockTab = 'radar' | 'spc' | 'status'

function fmt(sec: number | null) {
  if (!sec) return 'Unknown'
  const d = new Date(sec * 1000)
  return Number.isNaN(d.getTime()) ? 'Unknown' : d.toLocaleString()
}

function formatTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

function RadarTab() {
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
    if (frames.length < 2 && radarPlaying) {
      setRadarPlaying(false)
      return
    }
    if (!radarPlaying || frames.length < 2) return

    const timer = window.setInterval(() => {
      const currentIndex = selectedRadarFrameTime ? frames.findIndex((f) => f.time === selectedRadarFrameTime) : frames.length - 1
      const nextIndex = ((currentIndex >= 0 ? currentIndex : frames.length - 1) + 1) % frames.length
      setSelectedRadarFrameTime(frames[nextIndex].time)
    }, radarFrameIntervalMs)

    return () => window.clearInterval(timer)
  }, [frames, radarFrameIntervalMs, radarPlaying, selectedRadarFrameTime, setRadarPlaying, setSelectedRadarFrameTime])

  return (
    <div className="wcc-dock-panel">
      <div className="wcc-dock-row">
        <span className="wcc-dock-label">Source: RainViewer</span>
        <span className="wcc-dock-label">Frames: {frames.length}</span>
        <span className="wcc-dock-label">Latest: {latest ? fmt(latest.time) : 'None'}</span>
      </div>
      <div className="wcc-dock-row wcc-dock-controls">
        <button onClick={() => hasPrev && setSelectedRadarFrameTime(frames[selectedIndex - 1].time)} disabled={!hasPrev}>Prev</button>
        <button onClick={toggleRadarPlaying} disabled={frames.length < 2}>{radarPlaying ? 'Pause' : 'Play'}</button>
        <button onClick={() => hasNext && setSelectedRadarFrameTime(frames[selectedIndex + 1].time)} disabled={!hasNext}>Next</button>
        <button onClick={() => setSelectedRadarFrameTime(null)} disabled={frames.length === 0}>Latest</button>
      </div>
      <div className="wcc-dock-row wcc-dock-sliders">
        <label>
          <span>Speed: {(radarFrameIntervalMs / 1000).toFixed(1)}s</span>
          <input type="range" min={250} max={2500} step={250} value={radarFrameIntervalMs} onChange={(e) => setRadarFrameIntervalMs(Number(e.target.value))} />
        </label>
        <label>
          <span>Opacity: {Math.round(radarOpacity * 100)}%</span>
          <input type="range" min={0} max={1} step={0.05} value={radarOpacity} onChange={(e) => setRadarOpacity(Number(e.target.value))} />
        </label>
      </div>
    </div>
  )
}

function SpcTab() {
  const reportsQuery = useQuery({ queryKey: ['spc-reports'], queryFn: fetchSpcReports, staleTime: 120_000 })
  const outlookQuery = useQuery({ queryKey: ['spc-day1-outlook'], queryFn: fetchSpcDay1Outlook, staleTime: 180_000 })

  const reports = reportsQuery.data?.reports ?? []
  const byType = reportsQuery.data?.byType
  const recent = reports.slice(0, 6)
  const outlookFeatures = outlookQuery.data?.featureCollection.features.length ?? 0
  const outlookError = outlookQuery.data?.error
  const reportsError = reportsQuery.data?.error

  return (
    <div className="wcc-dock-panel">
      <div className="wcc-dock-row">
        <span className="wcc-dock-badge tornado">Tornado: {byType?.tornado ?? 0}</span>
        <span className="wcc-dock-badge wind">Wind: {byType?.wind ?? 0}</span>
        <span className="wcc-dock-badge hail">Hail: {byType?.hail ?? 0}</span>
        <span className="wcc-dock-label">Day 1 outlook: {outlookFeatures} features</span>
      </div>
      {reportsQuery.isLoading && <p className="wcc-dock-muted">Loading SPC reports...</p>}
      {reportsError && <p className="wcc-dock-error">Reports: {reportsError.kind}</p>}
      {outlookQuery.isLoading && <p className="wcc-dock-muted">Loading Day 1 outlook...</p>}
      {outlookError && <p className="wcc-dock-error">Outlook: {outlookError.kind}</p>}
      {recent.length > 0 && (
        <div className="wcc-spc-recent">
          {recent.map((r) => (
            <div key={r.id} className="wcc-spc-chip">
              <span className={`wcc-spc-type ${r.type}`}>{r.type}</span>
              <span>{r.location}, {r.state}</span>
              <span className="wcc-spc-time">{r.time}</span>
            </div>
          ))}
        </div>
      )}
      {recent.length === 0 && !reportsQuery.isLoading && !reportsError && (
        <p className="wcc-dock-muted">No storm reports in current SPC feed.</p>
      )}
    </div>
  )
}

function StatusTab() {
  const alerts = useQuery({ queryKey: ['nws-alerts'], queryFn: fetchNwsAlerts, staleTime: 60_000 })
  const radar = useQuery({ queryKey: ['rainviewer-metadata'], queryFn: fetchRainViewerMetadata, staleTime: 180_000 })
  const reports = useQuery({ queryKey: ['spc-reports'], queryFn: fetchSpcReports, staleTime: 120_000 })
  const outlook = useQuery({ queryKey: ['spc-day1-outlook'], queryFn: fetchSpcDay1Outlook, staleTime: 180_000 })

  const sources = [
    { label: 'NWS Alerts', error: alerts.data?.error, loading: alerts.isLoading, updated: alerts.data?.updated ? formatTime(alerts.data.updated) : null },
    { label: 'Radar', error: radar.data?.error, loading: radar.isLoading, updated: radar.data?.generated ? fmt(radar.data.generated) : null },
    { label: 'SPC Reports', error: reports.data?.error, loading: reports.isLoading, updated: reports.data?.fetchedAt ? formatTime(reports.data.fetchedAt) : null },
    { label: 'SPC Outlook', error: outlook.data?.error, loading: outlook.isLoading, updated: outlook.data?.fetchedAt ? formatTime(outlook.data.fetchedAt) : null },
  ]

  return (
    <div className="wcc-dock-panel">
      <div className="wcc-status-grid">
        {sources.map((src) => (
          <div key={src.label} className={`wcc-status-card ${src.error ? 'error' : src.loading ? 'loading' : 'ok'}`}>
            <strong>{src.label}</strong>
            <span>{src.loading ? 'Loading...' : src.error ? src.error.kind : 'Live'}</span>
            {src.updated && <span className="wcc-status-updated">Updated: {src.updated}</span>}
          </div>
        ))}
      </div>
    </div>
  )
}

const tabs: { id: DockTab; label: string }[] = [
  { id: 'radar', label: 'Radar' },
  { id: 'spc', label: 'SPC' },
  { id: 'status', label: 'Status' },
]

export function WeatherBottomDock() {
  const [activeTab, setActiveTab] = useState<DockTab>('radar')

  return (
    <section className="wcc-bottom-dock">
      <nav className="wcc-dock-tabs" aria-label="Bottom dock tabs">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className={`wcc-dock-tab ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>
      <div className="wcc-dock-content">
        {activeTab === 'radar' && <RadarTab />}
        {activeTab === 'spc' && <SpcTab />}
        {activeTab === 'status' && <StatusTab />}
      </div>
    </section>
  )
}