import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import { MAP_LAYER_IDS } from '../config/mapLayerIds'
import { featureCollectionFromAlerts } from '../utils/geojson'
import type { WeatherAlert } from '../types/weather'

const ids = MAP_LAYER_IDS

interface UseAlertLayersParams {
  mapRef: React.MutableRefObject<maplibregl.Map | null>
  alerts: WeatherAlert[]
  alertsEnabled: boolean
  selectedAlertId: string | null
  alertViewMode: 'all' | 'warnings' | 'watches'
  basemapMode: string
}

export function useAlertLayers({ mapRef, alerts, alertsEnabled, selectedAlertId, alertViewMode, basemapMode }: UseAlertLayersParams) {
  const pulseRef = useRef(0.45)

  // Alert polygon rendering
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const run = () => {
      if (!alertsEnabled) {
        ;[ids.alertsPulse, ids.alertsSelectedLine, ids.alertsLine, ids.alertsFill]
          .forEach((id) => map.getLayer(id) && map.removeLayer(id))
        map.getSource(ids.alertsSource) && map.removeSource(ids.alertsSource)
        return
      }

      const fc = featureCollectionFromAlerts(
        alerts
          .filter((a) => a.geometryStatus === 'mapped')
          .filter((a) => {
            if (alertViewMode === 'warnings') return a.event.toLowerCase().includes('warning')
            if (alertViewMode === 'watches') return a.event.toLowerCase().includes('watch')
            return true
          }),
      )

      const src = map.getSource(ids.alertsSource) as maplibregl.GeoJSONSource | undefined
      if (!src) map.addSource(ids.alertsSource, { type: 'geojson', data: fc })
      else src.setData(fc)

      const before = map.getLayer(ids.reportsLayer) ? ids.reportsLayer : undefined
      if (!map.getLayer(ids.alertsFill))
        map.addLayer(
          {
            id: ids.alertsFill,
            type: 'fill',
            source: ids.alertsSource,
            paint: {
              'fill-color': [
                'match', ['get', 'severity'],
                'Extreme', '#ff1f4b',
                'Severe', '#ff6a00',
                'Moderate', '#ffd347',
                'Minor', '#58a6ff',
                '#8b949e',
              ],
              'fill-opacity': ['case', ['==', ['get', 'id'], selectedAlertId ?? '__none__'], 0.52, 0.2],
            },
          },
          before,
        )
      else
        map.setPaintProperty(ids.alertsFill, 'fill-opacity', [
          'case', ['==', ['get', 'id'], selectedAlertId ?? '__none__'], 0.52, 0.2,
        ])

      if (!map.getLayer(ids.alertsLine))
        map.addLayer(
          {
            id: ids.alertsLine,
            type: 'line',
            source: ids.alertsSource,
            paint: {
              'line-color': ['case', ['==', ['get', 'id'], selectedAlertId ?? '__none__'], '#f8fafc', '#d5e1f5'],
              'line-width': ['case', ['==', ['get', 'id'], selectedAlertId ?? '__none__'], 3.2, 1.2],
            },
          },
          before,
        )
      else {
        map.setPaintProperty(ids.alertsLine, 'line-color', [
          'case', ['==', ['get', 'id'], selectedAlertId ?? '__none__'], '#f8fafc', '#d5e1f5',
        ])
        map.setPaintProperty(ids.alertsLine, 'line-width', [
          'case', ['==', ['get', 'id'], selectedAlertId ?? '__none__'], 3.2, 1.2,
        ])
      }

      if (!map.getLayer(ids.alertsSelectedLine))
        map.addLayer(
          {
            id: ids.alertsSelectedLine,
            type: 'line',
            source: ids.alertsSource,
            filter: ['==', ['get', 'id'], selectedAlertId ?? '__none__'],
            paint: { 'line-color': '#8ce99a', 'line-width': 5.4, 'line-opacity': 0.95, 'line-blur': 0.4 },
          },
          before,
        )
      else map.setFilter(ids.alertsSelectedLine, ['==', ['get', 'id'], selectedAlertId ?? '__none__'])

      if (!map.getLayer(ids.alertsPulse))
        map.addLayer(
          {
            id: ids.alertsPulse,
            type: 'line',
            source: ids.alertsSource,
            filter: ['>=', ['index-of', 'Warning', ['coalesce', ['get', 'event'], '']], 0],
            paint: { 'line-color': '#ffeded', 'line-width': 4, 'line-opacity': pulseRef.current },
          },
          before,
        )
    }

    map.isStyleLoaded() ? run() : map.once('load', run)
  }, [alertsEnabled, alerts, selectedAlertId, alertViewMode, basemapMode])

  // Warning pulse animation
  useEffect(() => {
    const map = mapRef.current
    if (!map || !alertsEnabled || !map.getLayer(ids.alertsPulse)) return

    let t = 0
    const timer = setInterval(() => {
      t += 0.28
      const o = 0.25 + ((Math.sin(t) + 1) / 2) * 0.6
      pulseRef.current = o
      map.getLayer(ids.alertsPulse) && map.setPaintProperty(ids.alertsPulse, 'line-opacity', o)
    }, 150)

    return () => clearInterval(timer)
  }, [alertsEnabled, alerts])
}