import { useQuery } from '@tanstack/react-query'
import { fetchNwsAlerts } from '../services/nws'
import { fetchRainViewerMetadata } from '../services/rainviewer'
import { fetchSpcDay1Outlook, fetchSpcReports } from '../services/spc'

interface SourceStatus {
  id: string
  label: string
  status: 'live' | 'loading' | 'error' | 'stale' | 'unavailable'
  updated: string
  count: string
  detail: string
  sourceUrl?: string
}

const staleMs = {
  nws: 15 * 60 * 1000,
  spc: 20 * 60 * 1000,
  radar: 20 * 60 * 1000,
}

function formatTime(value: string | number | null | undefined): string {
  if (!value) return 'Unknown'
  const date = typeof value === 'number' ? new Date(value * 1000) : new Date(value)
  return Number.isNaN(date.getTime()) ? 'Unknown' : date.toLocaleString()
}

function isStale(value: string | number | null | undefined, maxAgeMs: number): boolean {
  if (!value) return false
  const time = typeof value === 'number' ? value * 1000 : Date.parse(value)
  return Number.isFinite(time) && Date.now() - time > maxAgeMs
}

export function SourceHealthPanel() {
  const alerts = useQuery({ queryKey: ['nws-alerts'], queryFn: fetchNwsAlerts, staleTime: 60_000 })
  const reports = useQuery({ queryKey: ['spc-reports'], queryFn: fetchSpcReports, staleTime: 120_000 })
  const outlook = useQuery({ queryKey: ['spc-day1-outlook'], queryFn: fetchSpcDay1Outlook, staleTime: 180_000 })
  const radar = useQuery({ queryKey: ['rainviewer-metadata'], queryFn: fetchRainViewerMetadata, staleTime: 180_000 })

  const rows: SourceStatus[] = [
    {
      id: 'nws',
      label: 'NWS Alerts',
      status: alerts.isLoading ? 'loading' : alerts.data?.error ? 'error' : isStale(alerts.data?.updated, staleMs.nws) ? 'stale' : 'live',
      updated: formatTime(alerts.data?.updated),
      count: `${alerts.data?.alerts.length ?? 0} alerts`,
      detail: alerts.data?.error ? alerts.data.error.message : 'Active alerts feed for current NWS public alert products.',
      sourceUrl: alerts.data?.sourceUrl,
    },
    {
      id: 'spc-reports',
      label: 'SPC Reports',
      status: reports.isLoading ? 'loading' : reports.data?.error ? 'error' : isStale(reports.data?.fetchedAt, staleMs.spc) ? 'stale' : 'live',
      updated: formatTime(reports.data?.fetchedAt),
      count: `${reports.data?.reports.length ?? 0} reports`,
      detail: reports.data?.error ? reports.data.error.message : 'Today raw tornado, wind, and hail reports parsed from SPC.',
      sourceUrl: reports.data?.sourceUrl,
    },
    {
      id: 'spc-outlook',
      label: 'SPC Day 1 Outlook',
      status: outlook.isLoading ? 'loading' : outlook.data?.error ? 'error' : isStale(outlook.data?.fetchedAt, staleMs.spc) ? 'stale' : 'live',
      updated: formatTime(outlook.data?.fetchedAt),
      count: `${outlook.data?.featureCollection.features.length ?? 0} polygons`,
      detail: outlook.data?.error ? outlook.data.error.message : 'Day 1 convective outlook polygons from public SPC GIS.',
      sourceUrl: outlook.data?.sourceUrl,
    },
    {
      id: 'rainviewer',
      label: 'RainViewer Radar',
      status: radar.isLoading ? 'loading' : radar.data?.error ? 'error' : isStale(radar.data?.generated, staleMs.radar) ? 'stale' : 'live',
      updated: formatTime(radar.data?.generated),
      count: `${radar.data?.frames.length ?? 0} frames`,
      detail: radar.data?.error ? radar.data.error.message : 'Public radar metadata used for map playback controls.',
      sourceUrl: radar.data?.sourceUrl,
    },
  ]

  return (
    <div className="workspace-module-body source-health-panel">
      {rows.map((row) => (
        <article key={row.id} className={`source-health-row source-${row.status}`}>
          <div className="source-health-top">
            <strong>{row.label}</strong>
            <span className="source-health-status">{row.status}</span>
          </div>
          <p>{row.detail}</p>
          <p>Updated: {row.updated}</p>
          <p>{row.count}</p>
          {row.sourceUrl && <a href={row.sourceUrl} target="_blank" rel="noreferrer">Source</a>}
        </article>
      ))}
    </div>
  )
}
