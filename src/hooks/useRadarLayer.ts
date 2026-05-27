import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import { MAP_LAYER_IDS } from '../config/mapLayerIds'
import type { RadarState } from '../types/weather'

const ids = MAP_LAYER_IDS

interface UseRadarLayerParams {
  mapRef: React.MutableRefObject<maplibregl.Map | null>
  radarData: RadarState | undefined
  radarEnabled: boolean
  selectedRadarFrameTime: number | null
  radarOpacity: number
  basemapMode: string
}

export function useRadarLayer({ mapRef, radarData, radarEnabled, selectedRadarFrameTime, radarOpacity, basemapMode }: UseRadarLayerParams) {
  const radarTileRef = useRef<string | null>(null)
  const radarOpacityRef = useRef(0.65)

  useEffect(() => {
    radarOpacityRef.current = radarOpacity
  }, [radarOpacity])

  // Radar tile rendering
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const run = () => {
      if (!radarEnabled) {
        map.getLayer(ids.radarLayer) && map.removeLayer(ids.radarLayer)
        map.getSource(ids.radarSource) && map.removeSource(ids.radarSource)
        radarTileRef.current = null
        return
      }

      const frames = radarData?.frames ?? []
      const active = selectedRadarFrameTime
        ? frames.find((f: { time: number }) => f.time === selectedRadarFrameTime) ?? frames[frames.length - 1]
        : frames[frames.length - 1]
      if (!active) return

      const src = map.getSource(ids.radarSource) as maplibregl.RasterTileSource | undefined
      if (!src || radarTileRef.current !== active.tileUrlTemplate) {
        map.getLayer(ids.radarLayer) && map.removeLayer(ids.radarLayer)
        map.getSource(ids.radarSource) && map.removeSource(ids.radarSource)

        map.addSource(ids.radarSource, { type: 'raster', tiles: [active.tileUrlTemplate], tileSize: 256 })

        const before = map.getLayer(ids.outlookFill)
          ? ids.outlookFill
          : map.getLayer(ids.alertsFill)
            ? ids.alertsFill
            : map.getLayer(ids.reportsLayer)
              ? ids.reportsLayer
              : undefined

        map.addLayer(
          {
            id: ids.radarLayer,
            type: 'raster',
            source: ids.radarSource,
            paint: { 'raster-opacity': radarOpacityRef.current },
          },
          before,
        )

        radarTileRef.current = active.tileUrlTemplate
      }
    }

    map.isStyleLoaded() ? run() : map.once('load', run)
  }, [radarEnabled, radarData, selectedRadarFrameTime, basemapMode])

  // Radar opacity
  useEffect(() => {
    const map = mapRef.current
    if (map?.getLayer(ids.radarLayer)) map.setPaintProperty(ids.radarLayer, 'raster-opacity', radarOpacity)
  }, [radarOpacity])
}