/* eslint-disable @typescript-eslint/no-unused-expressions */
import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { fetchNwsAlerts, fetchNwsAlertsByAreas } from '../services/nws'
import { getBasemap } from '../config/basemaps'
import { fetchRadarMetadata } from '../services/radar'
import { fetchSpcDay1Outlook, fetchSpcReports } from '../services/spc'
import { fetchWwaWatches, fetchWwaWarnings } from '../services/wwa'
import { fetchJsonSafe } from '../services/fetchJson'
import { useMapStore } from '../state/mapStore'
import { boundsFromGeometries, boundsFromGeometry } from '../utils/geojson'
import { INTEGRATION_FLAGS } from '../config/integrations'
import { ALL_LAYER_IDS } from '../config/mapLayerIds'

import { useAlertLayers } from '../hooks/useAlertLayers'
import { useSpcOutlookLayer } from '../hooks/useSpcOutlookLayer'
import { useSpcReportsLayer } from '../hooks/useSpcReportsLayer'
import { useRadarLayer } from '../hooks/useRadarLayer'
import { useSpotterLayer, type HoveredSpotter } from '../hooks/useSpotterLayer'
import { useWatchesLayer } from '../hooks/useWatchesLayer'
import { useWwaWarningLayer } from '../hooks/useWwaWarningLayer'
import { useMapInteractions } from '../hooks/useMapInteractions'
import { useAlertNotifications } from '../hooks/useAlertNotifications'

const conusCenter: [number, number] = [-97.5, 38.5]
// SW: [-130, 20], NE: [-58, 53] — lower 48 + thin Canada/Mexico/coastal buffer
const conusMaxBounds: [[number, number], [number, number]] = [[-130, 20], [-58, 53]]

function fmt(v: string | null) {
  if (!v) return 'Unknown'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString()
}

export function MapView() {
  const mapContainer = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const zoomNonceRef = useRef(0)
  const regionalFocusNonceRef = useRef('')
  const zoneGeometryCacheRef = useRef<Map<string, GeoJSON.Geometry | null>>(new Map())
  const previousExtentRef = useRef<{
    center: maplibregl.LngLatLike
    zoom: number
    bearing: number
    pitch: number
  } | null>(null)

  const [hasPreviousExtent, setHasPreviousExtent] = useState(false)
  const [hoveredAlertId, setHoveredAlertId] = useState<string | null>(null)
  const [hoveredSpotter, setHoveredSpotter] = useState<HoveredSpotter | null>(null)

  const s = useMapStore()
  const alertsEnabled = s.enabledLayers.includes('nwsAlerts')
  const radarEnabled = s.enabledLayers.includes('radar')
  const basemapMode = s.basemapMode
  const radarProvider = s.radarProvider
  const stormReportsEnabled = s.enabledLayers.includes('stormReports')
  const spcOutlookEnabled = s.enabledLayers.includes('spcOutlook')
  const watchesEnabled = s.enabledLayers.includes('spcWatches')
  const wwaPolygonsEnabled = s.enabledLayers.includes('wwaPolygons')
  const alertViewMode = s.alertViewMode
  const setSelectedLiveStreamerId = s.setSelectedLiveStreamerId
  const regionalFocusPackId = s.regionalFocusPackId
  const regionalFocusAreas = s.regionalFocusAreas

  // ---- queries ----
  const alertsQ = useQuery({
    queryKey: ['nws-alerts'],
    queryFn: fetchNwsAlerts,
    staleTime: 60000,
    enabled: alertsEnabled,
  })
  const regionalFocusQ = useQuery({
    queryKey: ['nws-alerts-regional-focus', regionalFocusPackId, regionalFocusAreas.join(',')],
    queryFn: () => fetchNwsAlertsByAreas(regionalFocusAreas),
    staleTime: 60_000,
    enabled: regionalFocusAreas.length > 0,
  })
  const radarQ = useQuery({
    queryKey: ['radar-metadata', radarProvider],
    queryFn: () => fetchRadarMetadata(radarProvider),
    staleTime: 180000,
    enabled: radarEnabled,
  })
  const reportsQ = useQuery({
    queryKey: ['spc-reports'],
    queryFn: fetchSpcReports,
    staleTime: 120000,
    enabled: stormReportsEnabled,
  })
  const outlookQ = useQuery({
    queryKey: ['spc-day1-outlook'],
    queryFn: fetchSpcDay1Outlook,
    staleTime: 180000,
    enabled: spcOutlookEnabled,
  })
  const watchesQ = useQuery({
    queryKey: ['wwa-watches'],
    queryFn: fetchWwaWatches,
    staleTime: 120000,
    enabled: watchesEnabled,
  })
  const wwaWarningsQ = useQuery({
    queryKey: ['wwa-warnings'],
    queryFn: fetchWwaWarnings,
    staleTime: 120000,
    enabled: wwaPolygonsEnabled,
  })

  const alerts = alertsQ.data?.alerts ?? []
  const alertsById = useMemo(() => new Map(alerts.map((a) => [a.id, a])), [alerts])
  const detailAlert = hoveredAlertId
    ? alertsById.get(hoveredAlertId) ?? null
    : alertsById.get(s.selectedAlertId ?? '') ?? null

  // ---- extent management ----
  const capturePreviousExtent = () => {
    const map = mapRef.current
    if (!map) return
    previousExtentRef.current = {
      center: map.getCenter(),
      zoom: map.getZoom(),
      bearing: map.getBearing(),
      pitch: map.getPitch(),
    }
    setHasPreviousExtent(true)
  }

  const returnToPreviousExtent = () => {
    const map = mapRef.current
    const previous = previousExtentRef.current
    if (!map || !previous) return
    map.easeTo({ ...previous, duration: 560 })
    previousExtentRef.current = null
    setHasPreviousExtent(false)
  }

  const toggleOpsLayer = (layerId: 'radar' | 'stormReports') => {
    s.toggleLayer(layerId)
  }

  const zoomToActiveAlertExtent = async (scope: 'visible' | 'all') => {
    const map = mapRef.current
    if (!map) return
    const sourceAlerts = alerts
    const candidateAlerts = sourceAlerts.filter((alert) => {
      if (scope === 'all') return true
      if (alert.geometry) return true
      return alert.affectedZones.length > 0
    })
    const geometries: Array<GeoJSON.Geometry | null> = []
    for (const alert of candidateAlerts) {
      if (alert.geometry) {
        geometries.push(alert.geometry)
        continue
      }
      for (const zoneUrl of alert.affectedZones.filter(Boolean)) {
        if (zoneGeometryCacheRef.current.has(zoneUrl)) {
          geometries.push(zoneGeometryCacheRef.current.get(zoneUrl) ?? null)
          continue
        }
        const result = await fetchJsonSafe<{ geometry?: GeoJSON.Geometry | null }>(zoneUrl, {
          headers: { Accept: 'application/geo+json, application/json' },
        })
        const geometry = result.data?.geometry ?? null
        zoneGeometryCacheRef.current.set(zoneUrl, geometry)
        geometries.push(geometry)
      }
    }
    capturePreviousExtent()
    const bounds = boundsFromGeometries(geometries)
    if (bounds) {
      map.fitBounds(bounds, { padding: 60, duration: 640, maxZoom: scope === 'visible' ? 10.5 : 7.5 })
    } else {
      map.easeTo({ center: conusCenter, zoom: 4.2, duration: 640 })
    }
  }

  // ---- map init ----
  useEffect(() => {
    if (!mapContainer.current || mapRef.current) return
    const initialBasemap = getBasemap('black')
    const map = new maplibregl.Map({
      container: mapContainer.current,
      style: {
        version: 8,
        sources: { basemap: { type: 'raster', tiles: initialBasemap.tiles, tileSize: 256 } },
        layers: [{ id: 'basemap', type: 'raster', source: 'basemap' }],
      },
      center: conusCenter,
      zoom: 4.0,
      minZoom: 3,
      maxZoom: 18,
      maxBounds: conusMaxBounds,
    })
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right')
    mapRef.current = map
    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [])

  // ---- basemap switching ----
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const basemap = getBasemap(basemapMode)
    const run = () => {
      ALL_LAYER_IDS.filter((id) => map.getLayer(id)).forEach((id) => map.removeLayer(id))
      if (map.getLayer('basemap')) map.removeLayer('basemap')
      if (map.getSource('basemap')) map.removeSource('basemap')
      map.addSource('basemap', { type: 'raster', tiles: basemap.tiles, tileSize: 256 })
      map.addLayer({ id: 'basemap', type: 'raster', source: 'basemap' })
    }
    map.isStyleLoaded() ? run() : map.once('load', run)
  }, [basemapMode])

  // ---- zoom-to-alert effect ---- (kept in MapView — needs extent state + geometry cache)
  useEffect(() => {
    const map = mapRef.current
    if (!map || !alertsEnabled) return

    let target = s.selectedAlertId
    if (s.zoomRequestAlertId && s.zoomRequestNonce !== zoomNonceRef.current) {
      target = s.zoomRequestAlertId
      zoomNonceRef.current = s.zoomRequestNonce
    }
    if (!target) return

    const alert = alerts.find((x) => x.id === target)
    if (!alert) return

    const zoomToAlert = async () => {
      const directBounds = boundsFromGeometry(alert.geometry)
      if (directBounds) {
        capturePreviousExtent()
        map.fitBounds(directBounds, { padding: 56, duration: 560, maxZoom: 14.5 })
        return
      }
      const zoneUrls = alert.affectedZones.filter(Boolean)
      if (!zoneUrls.length) return
      const geometries: Array<GeoJSON.Geometry | null> = []
      for (const zoneUrl of zoneUrls) {
        if (zoneGeometryCacheRef.current.has(zoneUrl)) {
          geometries.push(zoneGeometryCacheRef.current.get(zoneUrl) ?? null)
          continue
        }
        const result = await fetchJsonSafe<{ geometry?: GeoJSON.Geometry | null }>(zoneUrl, {
          headers: { Accept: 'application/geo+json, application/json' },
        })
        const geometry = result.data?.geometry ?? null
        zoneGeometryCacheRef.current.set(zoneUrl, geometry)
        geometries.push(geometry)
      }
      const fallbackBounds = boundsFromGeometries(geometries)
      if (!fallbackBounds) return
      capturePreviousExtent()
      map.fitBounds(fallbackBounds, { padding: 56, duration: 560, maxZoom: 13.5 })
    }

    zoomToAlert().catch(() => undefined)
  }, [alertsEnabled, alerts, s.selectedAlertId, s.zoomRequestAlertId, s.zoomRequestNonce])

  // ---- regional focus effect ----
  useEffect(() => {
    const map = mapRef.current
    if (!map || !alertsEnabled || !regionalFocusPackId || regionalFocusAreas.length === 0 || !regionalFocusQ.data) return

    const focusKey = `${regionalFocusPackId}:${regionalFocusAreas.join(',')}`
    if (regionalFocusNonceRef.current === focusKey) return

    const regionalGeometries = regionalFocusQ.data.alerts
      .filter((a) => a.geometryStatus === 'mapped')
      .map((a) => a.geometry)

    const regionalBounds = boundsFromGeometries(regionalGeometries)
    if (!regionalBounds) return

    regionalFocusNonceRef.current = focusKey
    map.fitBounds(regionalBounds, { padding: 52, duration: 720, maxZoom: 8.75 })
  }, [alertsEnabled, regionalFocusPackId, regionalFocusAreas, regionalFocusQ.data])

  // ---- layer hooks (extracted from this component) ----
  useAlertLayers({ mapRef, alerts, alertsEnabled, selectedAlertId: s.selectedAlertId, alertViewMode, basemapMode })
  useSpcOutlookLayer({ mapRef, outlookData: outlookQ.data, spcOutlookEnabled, basemapMode })
  useSpcReportsLayer({ mapRef, reports: reportsQ.data?.reports ?? [], stormReportsEnabled, basemapMode })
  useRadarLayer({ mapRef, radarData: radarQ.data, radarEnabled, selectedRadarFrameTime: s.selectedRadarFrameTime, radarOpacity: s.radarOpacity, basemapMode })
  useSpotterLayer({ mapRef, setSelectedLiveStreamerId, basemapMode, onHoveredSpotterChange: setHoveredSpotter })
  useWatchesLayer({ mapRef, watches: watchesQ.data?.watches ?? [], watchesEnabled, basemapMode })
  useWwaWarningLayer({ mapRef, warnings: wwaWarningsQ.data?.warnings ?? [], wwaEnabled: wwaPolygonsEnabled, basemapMode })
  useMapInteractions({ mapRef, alertsEnabled, selectAlert: s.selectAlert, requestZoomToAlert: s.requestZoomToAlert, onHoveredAlertChange: setHoveredAlertId })
  useAlertNotifications({ alerts, alertsEnabled })

  // ---- JSX ----
  return (
    <div className="map-root-wrap">
      <div className="map-root" ref={mapContainer} aria-label="Weather map" />

      {/* Map operations panel */}
      <section className="wcc-map-ops-panel" aria-label="Weather map operations">
        <div className="wcc-map-ops-head">
          <strong>Map Ops</strong>
          <span>{getBasemap(basemapMode).label}</span>
          <span>{radarQ.data?.providerLabel ?? (radarProvider === 'level2' ? 'Level2 radar' : 'RainViewer')}</span>
        </div>
        <div className="wcc-map-alert-actions">
          <button type="button" onClick={() => zoomToActiveAlertExtent('visible')} disabled={!alerts.length}>
            Zoom active alerts
          </button>
          <button type="button" onClick={() => zoomToActiveAlertExtent('all')} disabled={!alerts.length}>
            CONUS alerts
          </button>
          <button type="button" onClick={returnToPreviousExtent} disabled={!hasPreviousExtent}>
            Back to extent
          </button>
          <button type="button" className={radarEnabled ? 'active' : ''} onClick={() => toggleOpsLayer('radar')}>
            Radar
          </button>
        </div>
      </section>

      {/* Selected alert card */}
      {detailAlert && (
        <section className="wcc-map-alert-ops" aria-label="Selected alert map operations">
          <div className="wcc-map-alert-ops-head">
            <span>Selected Alert</span>
            <strong>{detailAlert.event}</strong>
            <span className={`wcc-severity-badge severity-${detailAlert.severity.toLowerCase()}`}>
              {detailAlert.severity}
            </span>
          </div>
          <p>{detailAlert.areaDesc}</p>
          <div className="wcc-map-alert-actions">
            <button type="button" onClick={() => s.requestZoomToAlert(detailAlert.id)}>
              Zoom to alert
            </button>
            <button type="button" onClick={returnToPreviousExtent} disabled={!hasPreviousExtent}>
              Back to extent
            </button>
            <button type="button" className={radarEnabled ? 'active' : ''} onClick={() => toggleOpsLayer('radar')}>
              Radar
            </button>
            <button
              type="button"
              className={stormReportsEnabled ? 'active' : ''}
              onClick={() => toggleOpsLayer('stormReports')}
            >
              Reports
            </button>
          </div>
        </section>
      )}

      {/* Alert detail strip */}
      {detailAlert && (
        <section className="alert-detail-strip">
          <div className="alert-detail-top">
            <strong>{detailAlert.event}</strong>
            <span className={`severity-badge severity-${detailAlert.severity.toLowerCase()}`}>
              {detailAlert.severity}
            </span>
          </div>
          <p>{detailAlert.areaDesc}</p>
          <p>{detailAlert.headline}</p>
          <p>
            Urgency: {detailAlert.urgency ?? 'Unknown'} | Certainty:{' '}
            {detailAlert.certainty ?? 'Unknown'}
          </p>
          <p>
            Effective: {fmt(detailAlert.effective)} | Expires: {fmt(detailAlert.expires)}
          </p>
        </section>
      )}

      {/* Spotter hover card */}
      {INTEGRATION_FLAGS.spotterMapOverlays && hoveredSpotter && (
        <section className="wcc-spotter-hover-card">
          <div className="wcc-spotter-hover-head">
            <strong>{hoveredSpotter.callsign}</strong>
            <span className={hoveredSpotter.status === 'active' ? 'active' : ''}>
              {hoveredSpotter.status}
            </span>
            {hoveredSpotter.hasLiveCam && <span className="cam">CAM</span>}
          </div>
          <p>{hoveredSpotter.region}</p>
          {hoveredSpotter.notes && <p>{hoveredSpotter.notes}</p>}
          {hoveredSpotter.streamerId && (
            <button
              type="button"
              onClick={() => setSelectedLiveStreamerId(hoveredSpotter.streamerId ?? null)}
            >
              Open in live viewer
            </button>
          )}
        </section>
      )}
    </div>
  )
}