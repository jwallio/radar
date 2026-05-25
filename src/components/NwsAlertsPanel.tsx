import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { fetchNwsAlerts } from '../services/nws'
import { useMapStore } from '../state/mapStore'
import type { AlertSeverity } from '../types/weather'

const severityOrder: AlertSeverity[] = ['Extreme', 'Severe', 'Moderate', 'Minor', 'Unknown']

interface NwsAlertsPanelProps { embedded?: boolean }

function formatTime(value: string | null): string {
  if (!value) return 'Unknown'
  const time = new Date(value)
  if (Number.isNaN(time.getTime())) return 'Unknown'
  return time.toLocaleString()
}

export function NwsAlertsPanel({ embedded = false }: NwsAlertsPanelProps) {
  const selectedAlertId = useMapStore((s) => s.selectedAlertId)
  const selectAlert = useMapStore((s) => s.selectAlert)
  const requestZoomToAlert = useMapStore((s) => s.requestZoomToAlert)
  const [severityFilter, setSeverityFilter] = useState<AlertSeverity | 'All'>('All')
  const alerts = useQuery({ queryKey: ['nws-alerts'], queryFn: fetchNwsAlerts, staleTime: 60_000 })
  const list = useMemo(() => alerts.data?.alerts ?? [], [alerts.data?.alerts])
  const filteredList = useMemo(() => (severityFilter === 'All' ? list : list.filter((i) => i.severity === severityFilter)), [list, severityFilter])
  const error = alerts.data?.error
  const counts = severityOrder.map((severity) => ({ severity, count: list.filter((item) => item.severity === severity).length }))

  const content = (
    <>
      <h2>NWS Alerts ({filteredList.length})</h2>
      {alerts.data?.updated && <p className="panel-meta">Updated: {formatTime(alerts.data.updated)}</p>}
      {alerts.isLoading && <p>Loading alerts feed...</p>}
      {error && <p>Feed status: {error.kind} ({error.message})</p>}
      {!alerts.isLoading && !error && list.length === 0 && <p>No active alerts reported.</p>}
      {list.length > 0 && (
        <>
          <div className="severity-chips">
            <button type="button" className={`severity-filter ${severityFilter === 'All' ? 'active' : ''}`} onClick={() => setSeverityFilter('All')}>All: {list.length}</button>
            {counts.map((entry) => (
              <button key={entry.severity} type="button" className={`severity-filter severity-${entry.severity.toLowerCase()} ${severityFilter === entry.severity ? 'active' : ''}`} onClick={() => setSeverityFilter(entry.severity)}>{entry.severity}: {entry.count}</button>
            ))}
          </div>
          <div className="alert-list">
            {filteredList.map((alert) => (
              <div key={alert.id} className={`alert-card ${selectedAlertId === alert.id ? 'selected' : ''}`} role="button" tabIndex={0} onClick={() => selectAlert(selectedAlertId === alert.id ? null : alert.id)}>
                <div className="alert-card-top"><strong>{alert.event}</strong><span className={`severity-badge severity-${alert.severity.toLowerCase()}`}>{alert.severity}</span></div>
                <p>{alert.areaDesc}</p><p className="alert-headline">{alert.headline}</p><p>Expires: {formatTime(alert.expires)}</p>
                <span className={`mapped-chip ${alert.geometryStatus}`}>{alert.geometryStatus === 'mapped' ? 'Mapped' : 'Unmapped'}</span>
                {alert.geometryStatus === 'mapped' && <button type="button" className="alert-zoom-action" onClick={(e) => { e.stopPropagation(); requestZoomToAlert(alert.id) }}>Zoom to alert</button>}
              </div>
            ))}
          </div>
        </>
      )}
    </>
  )

  return embedded ? <div className="workspace-module-body">{content}</div> : <section className="side-panel left-panel">{content}</section>
}
