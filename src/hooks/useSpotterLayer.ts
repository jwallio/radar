import { useEffect } from 'react'
import maplibregl from 'maplibre-gl'
import { MAP_LAYER_IDS } from '../config/mapLayerIds'
import { SPOTTER_NETWORK_LOCATIONS } from '../config/liveStreamers'
import { INTEGRATION_FLAGS } from '../config/integrations'

const ids = MAP_LAYER_IDS

interface HoveredSpotter {
  callsign: string
  region: string
  status: string
  notes?: string
  hasLiveCam: boolean
  streamerId?: string
}

interface UseSpotterLayerParams {
  mapRef: React.MutableRefObject<maplibregl.Map | null>
  setSelectedLiveStreamerId: (id: string | null) => void
  basemapMode: string
  onHoveredSpotterChange: (spotter: HoveredSpotter | null) => void
}

export type { HoveredSpotter }

export function useSpotterLayer({ mapRef, setSelectedLiveStreamerId, basemapMode, onHoveredSpotterChange }: UseSpotterLayerParams) {
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    if (!INTEGRATION_FLAGS.spotterMapOverlays) {
      ;[ids.spotterCamLayer, ids.spotterLayer].forEach((id) => map.getLayer(id) && map.removeLayer(id))
      map.getSource(ids.spotterSource) && map.removeSource(ids.spotterSource)
      return
    }

    const spotterFc: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: SPOTTER_NETWORK_LOCATIONS.map((spotter) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [spotter.lon, spotter.lat] },
        properties: {
          id: spotter.id,
          callsign: spotter.callsign,
          region: spotter.region,
          status: spotter.status,
          notes: spotter.notes ?? '',
          hasLiveCam: spotter.hasLiveCam ? 1 : 0,
          streamerId: spotter.streamerId ?? '',
        },
      })),
    }

    const run = () => {
      const src = map.getSource(ids.spotterSource) as maplibregl.GeoJSONSource | undefined
      if (!src) map.addSource(ids.spotterSource, { type: 'geojson', data: spotterFc })
      else src.setData(spotterFc)

      if (!map.getLayer(ids.spotterLayer))
        map.addLayer({
          id: ids.spotterLayer,
          type: 'circle',
          source: ids.spotterSource,
          paint: {
            'circle-color': ['match', ['get', 'status'], 'active', '#8ce99a', '#9fb5d8'],
            'circle-radius': ['case', ['==', ['get', 'hasLiveCam'], 1], 5.8, 4.2],
            'circle-opacity': 0.72,
            'circle-stroke-color': ['case', ['==', ['get', 'hasLiveCam'], 1], '#f8fafc', '#0b1220'],
            'circle-stroke-width': ['case', ['==', ['get', 'hasLiveCam'], 1], 1.5, 1],
          },
        })

      if (!map.getLayer(ids.spotterCamLayer))
        map.addLayer({
          id: ids.spotterCamLayer,
          type: 'symbol',
          source: ids.spotterSource,
          filter: ['==', ['get', 'hasLiveCam'], 1],
          layout: { 'text-field': 'CAM', 'text-size': 8, 'text-offset': [0, -1.4], 'text-allow-overlap': false },
          paint: { 'text-color': '#0b1220', 'text-opacity': 0.86, 'text-halo-color': '#8ce99a', 'text-halo-width': 2.4 },
        })
    }

    // Hover and click interactions
    const onMove = (event: maplibregl.MapMouseEvent) => {
      const layers = [ids.spotterCamLayer, ids.spotterLayer].filter((id) => map.getLayer(id))
      if (!layers.length) return
      const features = map.queryRenderedFeatures(event.point, { layers })
      const props = features[0]?.properties
      if (!props) {
        onHoveredSpotterChange(null)
        map.getCanvas().style.cursor = ''
        return
      }
      onHoveredSpotterChange({
        callsign: String(props.callsign ?? 'Unknown'),
        region: String(props.region ?? 'Unknown region'),
        status: String(props.status ?? 'unknown'),
        notes: String(props.notes ?? ''),
        hasLiveCam: Number(props.hasLiveCam ?? 0) === 1,
        streamerId: String(props.streamerId ?? '') || undefined,
      })
      map.getCanvas().style.cursor = 'pointer'
    }

    const onOut = () => {
      onHoveredSpotterChange(null)
      map.getCanvas().style.cursor = ''
    }

    const onClick = (event: maplibregl.MapMouseEvent) => {
      const layers = [ids.spotterCamLayer, ids.spotterLayer].filter((id) => map.getLayer(id))
      if (!layers.length) return
      const features = map.queryRenderedFeatures(event.point, { layers })
      const streamerId = String(features[0]?.properties?.streamerId ?? '')
      if (streamerId) setSelectedLiveStreamerId(streamerId)
    }

    map.isStyleLoaded() ? run() : map.once('load', run)
    map.on('mousemove', onMove)
    map.on('mouseout', onOut)
    map.on('click', onClick)

    return () => {
      map.off('mousemove', onMove)
      map.off('mouseout', onOut)
      map.off('click', onClick)
    }
  }, [setSelectedLiveStreamerId, basemapMode, onHoveredSpotterChange])
}