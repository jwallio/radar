import { useQuery } from '@tanstack/react-query'
import { fetchNwsAlerts } from '../services/nws'
import { useMapStore } from '../state/mapStore'

export function WeatherTopBar() {
  const alerts = useQuery({ queryKey: ['nws-alerts'], queryFn: fetchNwsAlerts, staleTime: 60_000 })
  const alertList = alerts.data?.alerts ?? []
  const severeCount = alertList.filter((a) => a.severity === 'Extreme' || a.severity === 'Severe').length
  const enabledLayers = useMapStore((s) => s.enabledLayers)
  const modeLabel = enabledLayers.includes('radar') && enabledLayers.includes('nwsAlerts') ? 'STORM OPS'
    : enabledLayers.length === 0 ? 'CLEAN MAP'
    : enabledLayers.includes('radar') && !enabledLayers.includes('nwsAlerts') ? 'RADAR'
    : 'CUSTOM'

  return (
    <header className="wcc-topbar">
      <div className="wcc-topbar-left">
        <strong className="wcc-brand">wall.cloud</strong>
        <span className="wcc-mode-badge">{modeLabel}</span>
      </div>
      <div className="wcc-topbar-center">
        <span className="wcc-stat">{alerts.isLoading ? 'Loading...' : `${alertList.length} alerts`}</span>
        {severeCount > 0 && <span className="wcc-stat wcc-stat-severe">{severeCount} severe</span>}
      </div>
      <div className="wcc-topbar-right">
        <span className="wcc-time">{new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}Z</span>
      </div>
    </header>
  )
}