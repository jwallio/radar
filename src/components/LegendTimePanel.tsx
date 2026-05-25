import { useQuery } from '@tanstack/react-query'
import { WEATHER_LAYERS } from '../config/layers'
import { fetchNwsAlerts } from '../services/nws'
import { fetchRainViewerMetadata } from '../services/rainviewer'
import { fetchSpcDay1Outlook, fetchSpcReports } from '../services/spc'
import { useMapStore } from '../state/mapStore'

function fmt(value: string | number | null | undefined): string {
  if (!value) return 'Unknown'
  const date = typeof value === 'number' ? new Date(value * 1000) : new Date(value)
  return Number.isNaN(date.getTime()) ? 'Unknown' : date.toLocaleString()
}

export function LegendTimePanel() {
  const enabledLayers = useMapStore((state) => state.enabledLayers)

  const alerts = useQuery({ queryKey: ['nws-alerts'], queryFn: fetchNwsAlerts, staleTime: 60_000 })
  const reports = useQuery({ queryKey: ['spc-reports'], queryFn: fetchSpcReports, staleTime: 120_000 })
  const outlook = useQuery({ queryKey: ['spc-day1-outlook'], queryFn: fetchSpcDay1Outlook, staleTime: 180_000 })
  const radar = useQuery({ queryKey: ['rainviewer-metadata'], queryFn: fetchRainViewerMetadata, staleTime: 180_000 })

  const activeLayers = WEATHER_LAYERS.filter((layer) => enabledLayers.includes(layer.id))

  return (
    <div className="workspace-module-body legend-time-panel">
      <section className="legend-time-section">
        <h3>Active layers</h3>
        {activeLayers.length === 0 ? (
          <p>No map layers are enabled.</p>
        ) : (
          <div className="legend-time-layer-badges">
            {activeLayers.map((layer) => (
              <span key={layer.id} className="workspace-module-badge">{layer.label}</span>
            ))}
          </div>
        )}
      </section>

      <section className="legend-time-section">
        <h3>Legend</h3>
        <p><span className="legend-dot legend-tornado" /> Tornado reports</p>
        <p><span className="legend-dot legend-wind" /> Wind reports</p>
        <p><span className="legend-dot legend-hail" /> Hail reports</p>
        <p><span className="legend-swatch legend-alert" /> NWS alert polygons</p>
        <p><span className="legend-swatch legend-outlook" /> SPC Day 1 outlook polygons</p>
      </section>

      <section className="legend-time-section">
        <h3>Last updated</h3>
        <p>NWS alerts: {fmt(alerts.data?.updated)}</p>
        <p>SPC reports: {fmt(reports.data?.fetchedAt)}</p>
        <p>SPC outlook: {fmt(outlook.data?.fetchedAt)}</p>
        <p>Radar metadata: {fmt(radar.data?.generated)}</p>
      </section>
    </div>
  )
}
