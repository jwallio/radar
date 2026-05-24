import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { fetchNwsAlerts } from '../services/nws'
import { fetchRainViewerMetadata } from '../services/rainviewer'
import { fetchSpcDay1Outlook, fetchSpcReports } from '../services/spc'
import { useMapStore } from '../state/mapStore'
import { boundsFromGeometry, featureCollectionFromAlerts, featureCollectionFromSpcReports } from '../utils/geojson'
import type { RainViewerFrame } from '../types/weather'

const conusCenter: [number, number] = [-97.5, 38.5]
const alertsSourceId = 'nws-alerts-source'
const alertsFillLayerId = 'nws-alerts-fill'
const alertsLineLayerId = 'nws-alerts-line'
const radarSourceId = 'rainviewer-radar-source'
const radarLayerId = 'rainviewer-radar-layer'
const spcReportsSourceId = 'spc-reports-source'
const spcReportsLayerId = 'spc-reports-layer'
const spcOutlookSourceId = 'spc-day1-outlook-source'
const spcOutlookFillLayerId = 'spc-day1-outlook-fill'
const spcOutlookLineLayerId = 'spc-day1-outlook-line'

function removeRadarLayerAndSource(map: maplibregl.Map) {
  if (map.getLayer(radarLayerId)) map.removeLayer(radarLayerId)
  if (map.getSource(radarSourceId)) map.removeSource(radarSourceId)
}

function selectedOrLatestFrame(frames: RainViewerFrame[], selectedFrameTime: number | null): RainViewerFrame | null {
  if (frames.length === 0) return null
  if (selectedFrameTime === null) return frames[frames.length - 1]
  return frames.find((frame) => frame.time === selectedFrameTime) ?? frames[frames.length - 1]
}

function removeSpcReports(map: maplibregl.Map) {
  if (map.getLayer(spcReportsLayerId)) map.removeLayer(spcReportsLayerId)
  if (map.getSource(spcReportsSourceId)) map.removeSource(spcReportsSourceId)
}

function removeSpcOutlook(map: maplibregl.Map) {
  if (map.getLayer(spcOutlookLineLayerId)) map.removeLayer(spcOutlookLineLayerId)
  if (map.getLayer(spcOutlookFillLayerId)) map.removeLayer(spcOutlookFillLayerId)
  if (map.getSource(spcOutlookSourceId)) map.removeSource(spcOutlookSourceId)
}

export function MapView() {
  const mapContainer = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const enabledLayers = useMapStore((state) => state.enabledLayers)
  const selectedAlertId = useMapStore((state) => state.selectedAlertId)
  const selectedRadarFrameTime = useMapStore((state) => state.selectedRadarFrameTime)
  const radarOpacity = useMapStore((state) => state.radarOpacity)
  const alertsEnabled = enabledLayers.includes('nwsAlerts')
  const radarEnabled = enabledLayers.includes('radar')
  const stormReportsEnabled = enabledLayers.includes('stormReports')
  const spcOutlookEnabled = enabledLayers.includes('spcOutlook')

  const alertsQuery = useQuery({
    queryKey: ['nws-alerts'],
    queryFn: fetchNwsAlerts,
    staleTime: 60_000,
  })
  const radarQuery = useQuery({
    queryKey: ['rainviewer-metadata'],
    queryFn: fetchRainViewerMetadata,
    staleTime: 180_000,
  })
  const spcReportsQuery = useQuery({
    queryKey: ['spc-reports'],
    queryFn: fetchSpcReports,
    staleTime: 120_000,
  })
  const spcOutlookQuery = useQuery({
    queryKey: ['spc-day1-outlook'],
    queryFn: fetchSpcDay1Outlook,
    staleTime: 180_000,
  })

  useEffect(() => {
    if (!mapContainer.current || mapRef.current) return

    const map = new maplibregl.Map({
      container: mapContainer.current,
      style: {
        version: 8,
        sources: {
          basemap: {
            type: 'raster',
            tiles: ['https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png'],
            tileSize: 256,
            attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
          },
        },
        layers: [
          {
            id: 'basemap',
            type: 'raster',
            source: 'basemap',
          },
        ],
      },
      center: conusCenter,
      zoom: 3.7,
      minZoom: 2,
      maxZoom: 12,
    })

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right')
    mapRef.current = map

    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const updateOutlook = () => {
      if (!spcOutlookEnabled) {
        removeSpcOutlook(map)
        return
      }

      const featureCollection = spcOutlookQuery.data?.featureCollection ?? { type: 'FeatureCollection', features: [] }
      const source = map.getSource(spcOutlookSourceId) as maplibregl.GeoJSONSource | undefined

      if (!source) {
        map.addSource(spcOutlookSourceId, {
          type: 'geojson',
          data: featureCollection,
        })
      } else {
        source.setData(featureCollection)
      }

      if (!map.getLayer(spcOutlookFillLayerId)) {
        map.addLayer({
          id: spcOutlookFillLayerId,
          type: 'fill',
          source: spcOutlookSourceId,
          paint: {
            'fill-color': [
              'match',
              ['coalesce', ['to-string', ['get', 'LABEL']], ['to-string', ['get', 'label']], ''],
              'TSTM',
              '#6ea8fe',
              'MRGL',
              '#5bc0de',
              'SLGT',
              '#f7dc6f',
              'ENH',
              '#f5b041',
              'MDT',
              '#ec7063',
              'HIGH',
              '#e74c3c',
              '#7f8c8d',
            ],
            'fill-opacity': 0.22,
          },
        })
      }

      if (!map.getLayer(spcOutlookLineLayerId)) {
        map.addLayer({
          id: spcOutlookLineLayerId,
          type: 'line',
          source: spcOutlookSourceId,
          paint: {
            'line-color': '#d0d7e3',
            'line-width': 1.1,
            'line-opacity': 0.75,
          },
        })
      }
    }

    if (map.isStyleLoaded()) {
      updateOutlook()
    } else {
      map.once('load', updateOutlook)
    }
  }, [spcOutlookEnabled, spcOutlookQuery.data])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const updateLayers = () => {
      if (!alertsEnabled) {
        if (map.getLayer(alertsFillLayerId)) map.removeLayer(alertsFillLayerId)
        if (map.getLayer(alertsLineLayerId)) map.removeLayer(alertsLineLayerId)
        if (map.getSource(alertsSourceId)) map.removeSource(alertsSourceId)
        return
      }

      const mappedAlerts = (alertsQuery.data?.alerts ?? []).filter((alert) => alert.geometryStatus === 'mapped')
      const data = featureCollectionFromAlerts(mappedAlerts)

      const existingSource = map.getSource(alertsSourceId) as maplibregl.GeoJSONSource | undefined
      if (!existingSource) {
        map.addSource(alertsSourceId, {
          type: 'geojson',
          data,
        })
      } else {
        existingSource.setData(data)
      }

      if (!map.getLayer(alertsFillLayerId)) {
        map.addLayer({
          id: alertsFillLayerId,
          type: 'fill',
          source: alertsSourceId,
          paint: {
            'fill-color': [
              'match',
              ['get', 'severity'],
              'Extreme',
              '#ff1f4b',
              'Severe',
              '#ff6a00',
              'Moderate',
              '#ffd347',
              'Minor',
              '#58a6ff',
              '#8b949e',
            ],
            'fill-opacity': [
              'case',
              ['==', ['get', 'id'], selectedAlertId ?? '__none__'],
              0.5,
              0.22,
            ],
          },
        })
      }

      if (!map.getLayer(alertsLineLayerId)) {
        map.addLayer({
          id: alertsLineLayerId,
          type: 'line',
          source: alertsSourceId,
          paint: {
            'line-color': [
              'case',
              ['==', ['get', 'id'], selectedAlertId ?? '__none__'],
              '#f8fafc',
              '#9db0ce',
            ],
            'line-width': [
              'case',
              ['==', ['get', 'id'], selectedAlertId ?? '__none__'],
              3,
              1.2,
            ],
          },
        })
      }

      if (map.getLayer(alertsFillLayerId)) {
        map.setPaintProperty(alertsFillLayerId, 'fill-opacity', [
          'case',
          ['==', ['get', 'id'], selectedAlertId ?? '__none__'],
          0.5,
          0.22,
        ])
      }
      if (map.getLayer(alertsLineLayerId)) {
        map.setPaintProperty(alertsLineLayerId, 'line-width', [
          'case',
          ['==', ['get', 'id'], selectedAlertId ?? '__none__'],
          3,
          1.2,
        ])
        map.setPaintProperty(alertsLineLayerId, 'line-color', [
          'case',
          ['==', ['get', 'id'], selectedAlertId ?? '__none__'],
          '#f8fafc',
          '#9db0ce',
        ])
      }
    }

    if (map.isStyleLoaded()) {
      updateLayers()
    } else {
      map.once('load', updateLayers)
    }
  }, [alertsEnabled, alertsQuery.data, selectedAlertId])

  useEffect(() => {
    if (!selectedAlertId || !alertsEnabled) return
    const map = mapRef.current
    if (!map) return

    const selected = alertsQuery.data?.alerts.find((alert) => alert.id === selectedAlertId)
    const bounds = boundsFromGeometry(selected?.geometry ?? null)
    if (!selected || !bounds) return

    map.fitBounds(bounds, {
      padding: 36,
      duration: 550,
      maxZoom: 8,
    })
  }, [selectedAlertId, alertsEnabled, alertsQuery.data])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const updateRadarLayer = () => {
      if (!radarEnabled) {
        removeRadarLayerAndSource(map)
        return
      }

      const frames = radarQuery.data?.frames ?? []
      const activeFrame = selectedOrLatestFrame(frames, selectedRadarFrameTime)
      if (!activeFrame) {
        removeRadarLayerAndSource(map)
        return
      }

      const tiles = [activeFrame.tileUrlTemplate]
      const source = map.getSource(radarSourceId) as maplibregl.RasterTileSource | undefined

      if (source) {
        removeRadarLayerAndSource(map)
      }

      map.addSource(radarSourceId, {
        type: 'raster',
        tiles,
        tileSize: 256,
      })

      const beforeId = map.getLayer(spcOutlookFillLayerId)
        ? spcOutlookFillLayerId
        : map.getLayer(alertsFillLayerId)
          ? alertsFillLayerId
          : undefined
      map.addLayer(
        {
          id: radarLayerId,
          type: 'raster',
          source: radarSourceId,
          paint: {
            'raster-opacity': radarOpacity,
          },
        },
        beforeId,
      )
    }

    if (map.isStyleLoaded()) {
      updateRadarLayer()
    } else {
      map.once('load', updateRadarLayer)
    }
  }, [radarEnabled, radarQuery.data, selectedRadarFrameTime, radarOpacity])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.getLayer(radarLayerId)) return
    map.setPaintProperty(radarLayerId, 'raster-opacity', radarOpacity)
  }, [radarOpacity])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const updateReports = () => {
      if (!stormReportsEnabled) {
        removeSpcReports(map)
        return
      }

      const reportCollection = featureCollectionFromSpcReports(spcReportsQuery.data?.reports ?? [])
      const source = map.getSource(spcReportsSourceId) as maplibregl.GeoJSONSource | undefined

      if (!source) {
        map.addSource(spcReportsSourceId, {
          type: 'geojson',
          data: reportCollection,
        })
      } else {
        source.setData(reportCollection)
      }

      if (!map.getLayer(spcReportsLayerId)) {
        map.addLayer({
          id: spcReportsLayerId,
          type: 'circle',
          source: spcReportsSourceId,
          paint: {
            'circle-color': [
              'match',
              ['get', 'type'],
              'tornado',
              '#ff5f7f',
              'wind',
              '#58c4ff',
              'hail',
              '#75e65d',
              '#b8bec9',
            ],
            'circle-radius': 4,
            'circle-opacity': 0.86,
            'circle-stroke-color': '#0b1220',
            'circle-stroke-width': 1,
          },
        })
      }
    }

    if (map.isStyleLoaded()) {
      updateReports()
    } else {
      map.once('load', updateReports)
    }
  }, [stormReportsEnabled, spcReportsQuery.data])

  return <div className="map-root" ref={mapContainer} aria-label="Weather map" />
}