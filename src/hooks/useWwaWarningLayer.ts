import { useEffect } from 'react'
import maplibregl from 'maplibre-gl'
import { MAP_LAYER_IDS } from '../config/mapLayerIds'
import type { WwaWarning } from '../services/wwa'

const ids = MAP_LAYER_IDS

interface UseWwaWarningLayerParams {
  mapRef: React.MutableRefObject<maplibregl.Map | null>
  warnings: WwaWarning[]
  wwaEnabled: boolean
  basemapMode: string
}

export function useWwaWarningLayer({ mapRef, warnings, wwaEnabled, basemapMode }: UseWwaWarningLayerParams) {
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const run = () => {
      if (!wwaEnabled) {
        ;[ids.wwaLine, ids.wwaFill].forEach((id) => map.getLayer(id) && map.removeLayer(id))
        map.getSource(ids.wwaSource) && map.removeSource(ids.wwaSource)
        return
      }

      const fc: GeoJSON.FeatureCollection = {
        type: 'FeatureCollection',
        features: warnings.map((w) => ({
          type: 'Feature',
          geometry: w.geometry,
          properties: {
            id: w.id,
            type: w.type,
            severity: w.severity,
            issued: w.issued ?? '',
            expires: w.expires ?? '',
          },
        })),
      }

      const src = map.getSource(ids.wwaSource) as maplibregl.GeoJSONSource | undefined
      if (!src) map.addSource(ids.wwaSource, { type: 'geojson', data: fc })
      else src.setData(fc)

      // Place below alerts so alert fills take priority
      const before = map.getLayer(ids.alertsFill)
        ? ids.alertsFill
        : map.getLayer(ids.outlookFill)
          ? ids.outlookFill
          : map.getLayer(ids.reportsLayer)
            ? ids.reportsLayer
            : undefined

      if (!map.getLayer(ids.wwaFill))
        map.addLayer(
          {
            id: ids.wwaFill,
            type: 'fill',
            source: ids.wwaSource,
            paint: {
              'fill-color': [
                'match', ['get', 'severity'],
                'Extreme', '#ff1f4b',
                'Severe', '#ff6a00',
                'Moderate', '#58a6ff',
                '#8b949e',
              ],
              'fill-opacity': 0.14,
            },
          },
          before,
        )

      if (!map.getLayer(ids.wwaLine))
        map.addLayer(
          {
            id: ids.wwaLine,
            type: 'line',
            source: ids.wwaSource,
            paint: {
              'line-color': [
                'match', ['get', 'severity'],
                'Extreme', '#e01a3e',
                'Severe', '#e06020',
                'Moderate', '#4a8de0',
                '#6b7280',
              ],
              'line-width': 1.5,
              'line-opacity': 0.65,
            },
          },
          before,
        )
    }

    map.isStyleLoaded() ? run() : map.once('load', run)
  }, [wwaEnabled, warnings, basemapMode])
}