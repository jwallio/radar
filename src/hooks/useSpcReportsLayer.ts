import { useEffect } from 'react'
import maplibregl from 'maplibre-gl'
import { MAP_LAYER_IDS } from '../config/mapLayerIds'
import { featureCollectionFromSpcReports } from '../utils/geojson'
import type { SpcStormReport } from '../types/weather'

const ids = MAP_LAYER_IDS

interface UseSpcReportsLayerParams {
  mapRef: React.MutableRefObject<maplibregl.Map | null>
  reports: SpcStormReport[]
  stormReportsEnabled: boolean
  basemapMode: string
}

export function useSpcReportsLayer({ mapRef, reports, stormReportsEnabled, basemapMode }: UseSpcReportsLayerParams) {
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const run = () => {
      if (!stormReportsEnabled) {
        map.getLayer(ids.reportsLayer) && map.removeLayer(ids.reportsLayer)
        map.getSource(ids.reportsSource) && map.removeSource(ids.reportsSource)
        return
      }

      const fc = featureCollectionFromSpcReports(reports)
      const src = map.getSource(ids.reportsSource) as maplibregl.GeoJSONSource | undefined
      if (!src) map.addSource(ids.reportsSource, { type: 'geojson', data: fc })
      else src.setData(fc)

      if (!map.getLayer(ids.reportsLayer))
        map.addLayer({
          id: ids.reportsLayer,
          type: 'circle',
          source: ids.reportsSource,
          paint: {
            'circle-color': ['match', ['get', 'type'], 'tornado', '#ff5f7f', 'wind', '#58c4ff', 'hail', '#75e65d', '#b8bec9'],
            'circle-radius': 4.2,
            'circle-opacity': 0.9,
            'circle-stroke-color': '#0b1220',
            'circle-stroke-width': 1,
          },
        })
    }

    map.isStyleLoaded() ? run() : map.once('load', run)
  }, [stormReportsEnabled, reports, basemapMode])
}