import { useEffect } from 'react'
import maplibregl from 'maplibre-gl'
import { MAP_LAYER_IDS } from '../config/mapLayerIds'
import type { SpcOutlookState } from '../types/weather'

const ids = MAP_LAYER_IDS

interface UseSpcOutlookLayerParams {
  mapRef: React.MutableRefObject<maplibregl.Map | null>
  outlookData: SpcOutlookState | undefined
  spcOutlookEnabled: boolean
  basemapMode: string
}

export function useSpcOutlookLayer({ mapRef, outlookData, spcOutlookEnabled, basemapMode }: UseSpcOutlookLayerParams) {
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const run = () => {
      if (!spcOutlookEnabled) {
        ;[ids.outlookLine, ids.outlookFill].forEach((id) => map.getLayer(id) && map.removeLayer(id))
        map.getSource(ids.outlookSource) && map.removeSource(ids.outlookSource)
        return
      }

      const fc = outlookData?.featureCollection ?? { type: 'FeatureCollection', features: [] as GeoJSON.Feature[] }
      const src = map.getSource(ids.outlookSource) as maplibregl.GeoJSONSource | undefined
      if (!src) map.addSource(ids.outlookSource, { type: 'geojson', data: fc })
      else src.setData(fc)

      const before = map.getLayer(ids.alertsFill)
        ? ids.alertsFill
        : map.getLayer(ids.reportsLayer)
          ? ids.reportsLayer
          : undefined

      if (!map.getLayer(ids.outlookFill))
        map.addLayer(
          {
            id: ids.outlookFill,
            type: 'fill',
            source: ids.outlookSource,
            paint: {
              'fill-color': [
                'match',
                ['coalesce', ['to-string', ['get', 'LABEL']], ['to-string', ['get', 'label']], ''],
                'TSTM', '#6ea8fe',
                'MRGL', '#5bc0de',
                'SLGT', '#f7dc6f',
                'ENH', '#f5b041',
                'MDT', '#ec7063',
                'HIGH', '#e74c3c',
                '#7f8c8d',
              ],
              'fill-opacity': 0.22,
            },
          },
          before,
        )

      if (!map.getLayer(ids.outlookLine))
        map.addLayer(
          {
            id: ids.outlookLine,
            type: 'line',
            source: ids.outlookSource,
            paint: { 'line-color': '#d0d7e3', 'line-width': 1.1, 'line-opacity': 0.75 },
          },
          before,
        )
    }

    map.isStyleLoaded() ? run() : map.once('load', run)
  }, [spcOutlookEnabled, outlookData, basemapMode])
}