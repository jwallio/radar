import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { fetchNwsAlerts } from '../services/nws'
import { useMapStore } from '../state/mapStore'
import type { AlertSeverity } from '../types/weather'

const severityOrder: AlertSeverity[] = ['Extreme', 'Severe', 'Moderate', 'Minor', 'Unknown']

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
  const [severityFilter, setSeverityFilter] = useState<AlertSeverity | 'All'>('All')

  const alertList = useMemo(() => alerts.data?.alerts ?? [], [alerts.data?.alerts])
  const filteredAlerts = useMemo(
    () => (severityFilter === 'All' ? alertList : alertList.filter((item) => item.severity === severityFilter)),
    [alertList, severityFilter],
  )
  const alert = selectedAlertId ? alertList.find((a) => a.id === selectedAlertId) ?? null : null
  const severeCount = alertList.filter((a) => a.severity === 'Extreme' || a.severity === 'Severe').length
  const counts = severityOrder.map((severity) => ({ severity, count: alertList.filter((item) => item.severity === severity).length }))

  return (
    <aside className="wcc-right-rail">
      {!alert ? (
        <div className="wcc-rail-empty">
          <h3 className="wcc-rail-heading">Situation</h3>
          {alerts.isLoading ? (
            <p className="wcc-rail-muted">Loading active NWS alerts...</p>
          ) : alerts.data?.error ? (
            <p className="wcc-dock-error">NWS alerts: {alerts.data.error.kind} ({alerts.data.error.message})</p>
          ) : alertList.length === 0 ? (
            <p className="wcc-rail-muted">No active NWS alerts at this time.</p>
          ) : (
            <>
              <div className="wcc-situation-summary">
                <p className="wcc-rail-stat">{alertList.length} active alerts</p>
                {severeCount > 0 && <p className="wcc-rail-stat severe">{severeCount} severe</p>}
              </div>
              <div className="wcc-severity-filters" aria-label="Alert severity filter">
                <button type="button" className={severityFilter === 'All' ? 'active' : ''} onClick={() => setSeverityFilter('All')}>All</button>
                {counts.map((entry) => (
                  <button
                    key={entry.severity}
                    type="button"
                    className={`severity-${entry.severity.toLowerCase()} ${severityFilter === entry.severity ? 'active' : ''}`}
                    onClick={() => setSeverityFilter(entry.severity)}
                  >
                    {entry.severity}: {entry.count}
                  </button>
                ))}
              </div>
              <div className="wcc-alert-list" aria-label="Active NWS alerts">
                {filteredAlerts.map((item) => {
                  const canZoom = item.geometryStatus === 'mapped' || item.affectedZones.length > 0
                  return (
                    <article
                      key={item.id}
                      className={`wcc-alert-card ${selectedAlertId === item.id ? 'selected' : ''}`}
                      role="button"
                      tabIndex={0}
                      onClick={() => selectAlert(item.id)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          selectAlert(item.id)
                        }
                      }}
                    >
                      <div className="wcc-alert-card-top">
                        <strong>{item.event}</strong>
                        <span className={`wcc-severity-badge severity-${item.severity.toLowerCase()}`}>{item.severity}</span>
                      </div>
                      <p className="wcc-alert-card-area">{item.areaDesc}</p>
                      <p className="wcc-alert-card-headline">{item.headline}</p>
                      <div className="wcc-alert-card-meta">
                        <span>{item.geometryStatus === 'mapped' ? 'Mapped polygon' : item.affectedZones.length > 0 ? 'Zone fallback' : 'No geometry'}</span>
                        <span>Expires: {fmt(item.expires)}</span>
                      </div>
                      {canZoom && (
                        <button
                          type="button"
                          className="wcc-alert-card-zoom"
                          onClick={(event) => {
                            event.stopPropagation()
                            requestZoomToAlert(item.id)
                          }}
                        >
                          {item.geometryStatus === 'mapped' ? 'Zoom to alert' : 'Zoom to zones'}
                        </button>
                      )}
                    </article>
                  )
                })}
              </div>
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
            <p>Geometry: {alert.geometryStatus === 'mapped' ? 'Mapped polygon' : alert.affectedZones.length > 0 ? 'Zone fallback available' : 'No map geometry'}</p>
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
