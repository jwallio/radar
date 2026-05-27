import { Suspense, lazy } from 'react'
import { WeatherTopBar } from './WeatherTopBar'
import { WeatherLayerRail } from './WeatherLayerRail'
import { WeatherContextRail } from './WeatherContextRail'
import { WeatherBottomDock } from './WeatherBottomDock'

const MapView = lazy(() => import('./MapView').then((m) => ({ default: m.MapView })))

export function WeatherCommandCenter() {
  return (
    <div className="wcc-shell">
      <WeatherTopBar />

      <Suspense fallback={<div className="wcc-map-wrap" />}>
        <MapView />
      </Suspense>

      <WeatherLayerRail />
      <WeatherContextRail />
      <WeatherBottomDock />
    </div>
  )
}