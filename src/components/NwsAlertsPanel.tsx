import { useQuery } from '@tanstack/react-query'
import { fetchNwsAlerts } from '../services/nws'
import { useMapStore } from '../state/mapStore'
import type { AlertSeverity } from '../types/weather'

const severityOrder: AlertSeverity[] = ['Extreme', 'Severe', 'Moderate', 'Minor', 'Unknown']

function formatTime(value: string | null): string {
  if (!value) return 'Unknown'
  const time = new Date(value)
  if (Number.isNaN(time.getTime())) return 'Unknown'
  return time.toLocaleString()
}

export function NwsAlertsPanel() {
  const selectedAlertId = useMapStore((state) => state.selectedAlertId)
  const selectAlert = useMapStore((state) => state.selectAlert)
  const alerts = useQuery({
    queryKey: ['nws-alerts'],
    queryFn: fetchNwsAlerts,
    staleTime: 60_000,
  })

  const list = alerts.data?.alerts ?? []
  const error = alerts.data?.error
  const counts = severityOrder.map((severity) => ({
    severity,
    count: list.filter((item) => item.severity === severity).length,
  }))

  return (
    <section className="side-panel left-panel">
      <h2>NWS Alerts ({list.length})</h2>
      {alerts.data?.updated && <p className="panel-meta">Updated: {formatTime(alerts.data.updated)}</p>}
      {alerts.isLoading && <p>Loading alerts feed...</p>}
      {error && <p>Feed status: {error.kind} ({error.message})</p>}
      {!alerts.isLoading && !error && list.length === 0 && <p>No active alerts reported.</p>}
      {list.length > 0 && (
        <>
          <div className="severity-chips">
            {counts.map((entry) => (
              <span key={entry.severity} className={`severity-chip severity-${entry.severity.toLowerCase()}`}>
                {entry.severity}: {entry.count}
              </span>
            ))}
          </div>
          <div className="alert-list">
            {list.map((alert) => (
              <button
                key={alert.id}
                type="button"
                className={`alert-card ${selectedAlertId === alert.id ? 'selected' : ''}`}
                onClick={() => selectAlert(selectedAlertId === alert.id ? null : alert.id)}
              >
                <div className="alert-card-top">
                  <strong>{alert.event}</strong>
                  <span className={`severity-badge severity-${alert.severity.toLowerCase()}`}>{alert.severity}</span>
                </div>
                <p>{alert.areaDesc}</p>
                <p className="alert-headline">{alert.headline}</p>
                <p>Expires: {formatTime(alert.expires)}</p>
                <span className={`mapped-chip ${alert.geometryStatus}`}>
                  {alert.geometryStatus === 'mapped' ? 'Mapped' : 'Unmapped'}
                </span>
              </button>
            ))}
          </div>
        </>
      )}
    </section>
  )
}