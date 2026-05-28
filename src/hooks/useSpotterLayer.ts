import { useEffect, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import { MAP_LAYER_IDS } from '../config/mapLayerIds'
import { SPOTTER_NETWORK_LOCATIONS } from '../config/liveStreamers'
import { INTEGRATION_FLAGS } from '../config/integrations'
import { fetchSpotterNetwork } from '../services/spotternetwork'

const ids = MAP_LAYER_IDS

// Refresh interval for live data (ms)
const REFRESH_INTERVAL = 60_000

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
  const [liveGeoJson, setLiveGeoJson] = useState<GeoJSON.FeatureCollection | null>(null)
  const [feedError, setFeedError] = useState<string | null>(null)
  const [spotterCount, setSpotterCount] = useState<number>(0)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    if (!INTEGRATION_FLAGS.spotterMapOverlays) return

    const fetchFeed = async () => {
      // Cancel any in-flight request
      if (abortRef.current) abortRef.current.abort()
      const controller = new AbortController()
      abortRef.current = controller

      try {
        const { featureCollection, feed } = await fetchSpotterNetwork()
        if (!controller.signal.aborted) {
          setLiveGeoJson(featureCollection)
          setSpotterCount(feed.count)
          setFeedError(null)
        }
      } catch (err) {
        if (controller.signal.aborted) return
        const msg = err instanceof Error ? err.message : 'Unknown fetch error'
        console.warn('[SpotterNetwork] feed fetch failed:', msg)
        setFeedError(msg)
        // Keep showing last-known data or fallback
      }
    }

    // Initial fetch
    fetchFeed()

    // Poll on interval
    timerRef.current = setInterval(fetchFeed, REFRESH_INTERVAL)

    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
      if (abortRef.current) abortRef.current.abort()
    }
  }, [])

  // Build the feature collection to render
  // Priority: live feed > demo fallback
  const spotterFc: GeoJSON.FeatureCollection | null = liveGeoJson
    ? liveGeoJson
    : SPOTTER_NETWORK_LOCATIONS.length > 0
      ? {
          type: 'FeatureCollection',
          features: SPOTTER_NETWORK_LOCATIONS.map((spotter) => ({
            type: 'Feature' as const,
            geometry: { type: 'Point' as const, coordinates: [spotter.lon, spotter.lat] },
            properties: {
              name: spotter.callsign,
              displayText: spotter.callsign,
              status: spotter.status,
              notes: spotter.notes ?? '',
              hasLiveCam: spotter.hasLiveCam ? 1 : 0,
              streamerId: spotter.streamerId ?? '',
              timestamp: '',
              heading: 0,
            },
          })),
        }
      : null

  // Map rendering effect
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    if (!INTEGRATION_FLAGS.spotterMapOverlays || !spotterFc) {
      ;[ids.spotterCamLayer, ids.spotterLayer].forEach((id) => map.getLayer(id) && map.removeLayer(id))
      map.getSource(ids.spotterSource) && map.removeSource(ids.spotterSource)
      return
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
        callsign: String(props.name ?? props.displayText ?? 'Unknown'),
        region: String(props.region ?? ''),
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setSelectedLiveStreamerId, basemapMode, onHoveredSpotterChange, spotterFc])

  return { spotterCount, feedError }
}