import { NwsAlertsPanel } from './NwsAlertsPanel'
import { SpcPanel } from './SpcPanel'
import { RadarPanel } from './RadarPanel'
import { MapView } from './MapView'
import { WeatherLayerPanel } from './WeatherLayerPanel'
import { PresetBar } from './PresetBar'

export function AppShell() {
  return (
    <div className="app-shell">
      <MapView />
      <NwsAlertsPanel />
      <aside className="side-panel right-panel">
        <SpcPanel />
        <RadarPanel />
      </aside>
      <WeatherLayerPanel />
      <PresetBar />
    </div>
  )
}

