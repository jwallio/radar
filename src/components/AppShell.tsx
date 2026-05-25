import { NwsAlertsPanel } from './NwsAlertsPanel'
import { SpcPanel } from './SpcPanel'
import { RadarPanel } from './RadarPanel'
import { MapView } from './MapView'
import { WeatherLayerPanel } from './WeatherLayerPanel'
import { PresetBar } from './PresetBar'
import { LiveContextRail } from './LiveContextRail'

export function AppShell() {
  return (
    <div className="app-shell">
      <MapView />
      <div className="operator-layout">
        <NwsAlertsPanel />
        <LiveContextRail />
      </div>
      <aside className="operator-dock">
        <SpcPanel />
        <RadarPanel />
      </aside>
      <WeatherLayerPanel />
      <PresetBar />
    </div>
  )
}
