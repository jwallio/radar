import { useQuery } from '@tanstack/react-query'
import { fetchNwsAlerts } from '../services/nws'
import { useMapStore } from '../state/mapStore'

function fmt(v: string | null) {
  if (!v) return 'Unknown'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString()
}

export function WeatherContextRail() {
  const selectedAlertId = useMapStore((s) => s.selectedAlertId)
  const selectAlert = useMapStore((s) => s.selectAlert)
  const requestZoomToAlert = useMapStore((s) => s.requestZoomToAlert)
  const alerts = useQuery({ queryKey: ['nws-alerts'], queryFn: fetchNwsAlerts, staleTime: 60_000 })

  const alertList = alerts.data?.alerts ?? []
  const alert = selectedAlertId ? alertList.find((a) => a.id === selectedAlertId) ?? null : null

  const severeCount = alertList.filter((a) => a.severity === 'Extreme' || a.severity === 'Severe').length

  return (
    <aside className="wcc-right-rail">
      {!alert ? (
        <div className="wcc-rail-empty">
          <h3 className="wcc-rail-heading">Situation</h3>
          {alerts.isLoading ? (
            <p className="wcc-rail-muted">Loading alerts...</p>
          ) : alertList.length === 0 ? (
            <p className="wcc-rail-muted">No active NWS alerts at this time.</p>
          ) : (
            <>
              <p className="wcc-rail-stat">{alertList.length} active alerts</p>
              {severeCount > 0 && <p className="wcc-rail-stat severe">{severeCount} severe+</p>}
              <p className="wcc-rail-muted">Click an alert polygon on the map or select from the list to view details.</p>
            </>
          )}
        </div>
      ) : (
        <div className="wcc-alert-detail">
          <div className="wcc-alert-detail-header">
            <h3 className="wcc-rail-heading">{alert.event}</h3>
            <button className="wcc-alert-dismiss" onClick={() => selectAlert(null)} aria-label="Dismiss alert">x</button>
          </div>
          <span className={`wcc-severity-badge severity-${alert.severity.toLowerCase()}`}>{alert.severity}</span>
          <p className="wcc-alert-area">{alert.areaDesc}</p>
          <p className="wcc-alert-headline">{alert.headline}</p>
          <div className="wcc-alert-meta">
            <p>Urgency: {alert.urgency ?? 'Unknown'}</p>
            <p>Certainty: {alert.certainty ?? 'Unknown'}</p>
            <p>Effective: {fmt(alert.effective)}</p>
            <p>Expires: {fmt(alert.expires)}</p>
          </div>
          <div className="wcc-alert-actions">
            <button onClick={() => requestZoomToAlert(alert.id)} disabled={alert.geometryStatus !== 'mapped' && alert.affectedZones.length === 0}>
              {alert.geometryStatus === 'mapped' ? 'Zoom to alert' : alert.affectedZones.length > 0 ? 'Zoom to zones' : 'No map geometry'}
            </button>
          </div>
        </div>
      )}
    </aside>
  )
}