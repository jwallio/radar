import { useEffect } from 'react'
import maplibregl from 'maplibre-gl'
import { MAP_LAYER_IDS } from '../config/mapLayerIds'
import { featureCollectionFromWatches } from '../utils/geojson'
import type { WwaWatch } from '../services/wwa'

const ids = MAP_LAYER_IDS

interface UseWatchesLayerParams {
  mapRef: React.MutableRefObject<maplibregl.Map | null>
  watches: WwaWatch[]
  watchesEnabled: boolean
  basemapMode: string
}

export function useWatchesLayer({ mapRef, watches, watchesEnabled, basemapMode }: UseWatchesLayerParams) {
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const run = () => {
      if (!watchesEnabled) {
        ;[ids.watchesLine, ids.watchesFill].forEach((id) => map.getLayer(id) && map.removeLayer(id))
        map.getSource(ids.watchesSource) && map.removeSource(ids.watchesSource)
        return
      }

      const fc = featureCollectionFromWatches(watches)
      const src = map.getSource(ids.watchesSource) as maplibregl.GeoJSONSource | undefined
      if (!src) map.addSource(ids.watchesSource, { type: 'geojson', data: fc })
      else src.setData(fc)

      const before = map.getLayer(ids.outlookFill)
        ? ids.outlookFill
        : map.getLayer(ids.alertsFill)
          ? ids.alertsFill
          : map.getLayer(ids.reportsLayer)
            ? ids.reportsLayer
            : undefined

      if (!map.getLayer(ids.watchesFill))
        map.addLayer(
          {
            id: ids.watchesFill,
            type: 'fill',
            source: ids.watchesSource,
            paint: {
              'fill-color': [
                'match', ['get', 'type'],
                'tornado', '#ffd700',
                'severe-thunderstorm', '#ff8c42',
                '#8b949e',
              ],
              'fill-opacity': 0.18,
            },
          },
          before,
        )

      if (!map.getLayer(ids.watchesLine))
        map.addLayer(
          {
            id: ids.watchesLine,
            type: 'line',
            source: ids.watchesSource,
            paint: {
              'line-color': [
                'match', ['get', 'type'],
                'tornado', '#e6c200',
                'severe-thunderstorm', '#e0702a',
                '#6b7280',
              ],
              'line-width': 2,
              'line-opacity': 0.8,
              'line-dasharray': [4, 2],
            },
          },
          before,
        )
    }

    map.isStyleLoaded() ? run() : map.once('load', run)
  }, [watchesEnabled, watches, basemapMode])
}