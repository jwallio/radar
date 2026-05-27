import { Suspense, lazy, useState } from 'react'
import { WeatherTopBar } from './WeatherTopBar'
import { WeatherLayerRail } from './WeatherLayerRail'
import { WeatherContextRail } from './WeatherContextRail'
import { WeatherBottomDock } from './WeatherBottomDock'

const MapView = lazy(() => import('./MapView').then((m) => ({ default: m.MapView })))

export function WeatherCommandCenter() {
  const [mapBooted, setMapBooted] = useState(false)

  return (
    <div className="wcc-shell">
      <WeatherTopBar />

      {mapBooted ? (
        <Suspense fallback={<div className="wcc-map-wrap" />}>
          <MapView />
        </Suspense>
      ) : (
        <section className="wcc-boot-splash">
          <h2>wall.cloud Weather Command</h2>
          <p>National weather monitoring and situational awareness workspace.</p>
          <p className="wcc-boot-sub">NWS alerts · SPC outlooks · radar · severe weather context</p>
          <button type="button" onClick={() => setMapBooted(true)}>
            Enter Command Center
          </button>
        </section>
      )}

      <WeatherLayerRail />
      <WeatherContextRail />
      <WeatherBottomDock />
    </div>
  )
}