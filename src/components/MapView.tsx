/* eslint-disable @typescript-eslint/no-unused-expressions */
import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { fetchNwsAlerts, fetchNwsAlertsByAreas } from '../services/nws'
import { getBasemap } from '../config/basemaps'
import { fetchRadarMetadata } from '../services/radar'
import { fetchSpcDay1Outlook, fetchSpcReports } from '../services/spc'
import { fetchJsonSafe } from '../services/fetchJson'
import { useMapStore } from '../state/mapStore'
import { boundsFromGeometries, boundsFromGeometry, featureCollectionFromAlerts, featureCollectionFromSpcReports } from '../utils/geojson'
import { SPOTTER_NETWORK_LOCATIONS } from '../config/liveStreamers'
import { INTEGRATION_FLAGS } from '../config/integrations'

const conusCenter: [number, number] = [-97.5, 38.5]
const ids = {
  alertsSource: 'nws-alerts-source', alertsFill: 'nws-alerts-fill', alertsLine: 'nws-alerts-line', alertsSelectedLine: 'nws-alerts-selected-line', alertsPulse: 'nws-alerts-warning-pulse',
  radarSource: 'rainviewer-radar-source', radarLayer: 'rainviewer-radar-layer',
  reportsSource: 'spc-reports-source', reportsLayer: 'spc-reports-layer',
  outlookSource: 'spc-day1-outlook-source', outlookFill: 'spc-day1-outlook-fill', outlookLine: 'spc-day1-outlook-line',
  spotterSource: 'spotter-network-source', spotterLayer: 'spotter-network-layer', spotterCamLayer: 'spotter-cam-layer',
}

function fmt(v: string | null) { if (!v) return 'Unknown'; const d=new Date(v); return Number.isNaN(d.getTime()) ? v : d.toLocaleString() }

export function MapView() {
  const mapContainer = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const radarOpacityRef = useRef(0.65)
  const radarTileRef = useRef<string | null>(null)
  const pulseRef = useRef(0.45)
  const zoomNonceRef = useRef(0)
  const regionalFocusNonceRef = useRef('')
  const zoneGeometryCacheRef = useRef<Map<string, GeoJSON.Geometry | null>>(new Map())
  const previousExtentRef = useRef<{ center: maplibregl.LngLatLike; zoom: number; bearing: number; pitch: number } | null>(null)
  const [hasPreviousExtent, setHasPreviousExtent] = useState(false)
  const [hoveredAlertId, setHoveredAlertId] = useState<string | null>(null)
  const [hoveredSpotter, setHoveredSpotter] = useState<{ callsign: string; region: string; status: string; notes?: string; hasLiveCam: boolean; streamerId?: string } | null>(null)

  const s = useMapStore()
  const alertsEnabled = s.enabledLayers.includes('nwsAlerts')
  const radarEnabled = s.enabledLayers.includes('radar')
  const basemapMode = s.basemapMode
  const radarProvider = s.radarProvider
  const stormReportsEnabled = s.enabledLayers.includes('stormReports')
  const spcOutlookEnabled = s.enabledLayers.includes('spcOutlook')
  const alertViewMode = s.alertViewMode
  const setSelectedLiveStreamerId = s.setSelectedLiveStreamerId
  const regionalFocusPackId = s.regionalFocusPackId
  const regionalFocusAreas = s.regionalFocusAreas

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
  const radarQ = useQuery({ queryKey: ['radar-metadata', radarProvider], queryFn: () => fetchRadarMetadata(radarProvider), staleTime: 180000, enabled: radarEnabled })
  const reportsQ = useQuery({ queryKey: ['spc-reports'], queryFn: fetchSpcReports, staleTime: 120000, enabled: stormReportsEnabled })
  const outlookQ = useQuery({ queryKey: ['spc-day1-outlook'], queryFn: fetchSpcDay1Outlook, staleTime: 180000, enabled: spcOutlookEnabled })

  const alertsById = useMemo(() => new Map((alertsQ.data?.alerts ?? []).map((a) => [a.id, a])), [alertsQ.data?.alerts])
  const detailAlert = hoveredAlertId ? alertsById.get(hoveredAlertId) ?? null : alertsById.get(s.selectedAlertId ?? '') ?? null

  const capturePreviousExtent = () => {
    const map = mapRef.current
    if (!map) return
    previousExtentRef.current = { center: map.getCenter(), zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch() }
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
    const sourceAlerts = alertsQ.data?.alerts ?? []
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
    const bounds = boundsFromGeometries(geometries)
    if (bounds) {
      capturePreviousExtent()
      map.fitBounds(bounds, { padding: 60, duration: 640, maxZoom: scope === 'visible' ? 10.5 : 7.5 })
      return
    }
    capturePreviousExtent()
    map.easeTo({ center: conusCenter, zoom: 4.2, duration: 640 })
  }

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
      center: conusCenter, zoom: 3.7, minZoom: 2, maxZoom: 18,
    })
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right')
    mapRef.current = map
    return () => { map.remove(); mapRef.current = null }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const basemap = getBasemap(basemapMode)
    const run = () => {
      const layersToRestore = [
        ids.radarLayer, ids.outlookFill, ids.outlookLine, ids.alertsFill, ids.alertsLine, ids.alertsSelectedLine,
        ids.alertsPulse, ids.reportsLayer, ids.spotterLayer, ids.spotterCamLayer,
      ].filter((id) => map.getLayer(id))
      layersToRestore.forEach((id) => map.removeLayer(id))
      if (map.getLayer('basemap')) map.removeLayer('basemap')
      if (map.getSource('basemap')) map.removeSource('basemap')
      map.addSource('basemap', { type: 'raster', tiles: basemap.tiles, tileSize: 256 })
      map.addLayer({ id: 'basemap', type: 'raster', source: 'basemap' })
      radarTileRef.current = null
    }
    map.isStyleLoaded() ? run() : map.once('load', run)
  }, [basemapMode])

  useEffect(() => { radarOpacityRef.current = s.radarOpacity }, [s.radarOpacity])

  useEffect(() => {
    const map = mapRef.current; if (!map || !alertsEnabled) return
    const onMove = (e: maplibregl.MapMouseEvent) => {
      const layers=[ids.alertsPulse,ids.alertsLine,ids.alertsFill].filter((id)=>!!map.getLayer(id))
      if (!layers.length) return
      const f=map.queryRenderedFeatures(e.point,{layers})
      const id=(f[0]?.properties?.id as string|undefined)??null
      setHoveredAlertId(id); map.getCanvas().style.cursor=id?'pointer':''
    }
    const onClick = (e: maplibregl.MapMouseEvent) => {
      const layers=[ids.alertsPulse,ids.alertsLine,ids.alertsFill].filter((id)=>!!map.getLayer(id))
      if (!layers.length) return
      const f=map.queryRenderedFeatures(e.point,{layers})
      const id=(f[0]?.properties?.id as string|undefined)??null
      if (!id) return
      s.selectAlert(id); s.requestZoomToAlert(id)
    }
    const onOut=()=>{ setHoveredAlertId(null); map.getCanvas().style.cursor='' }
    map.on('mousemove',onMove); map.on('click',onClick); map.on('mouseout',onOut)
    return ()=>{ map.off('mousemove',onMove); map.off('click',onClick); map.off('mouseout',onOut) }
  }, [alertsEnabled, s])

  useEffect(() => {
    const map = mapRef.current; if (!map) return
    const run = () => {
      if (!alertsEnabled) {
        ;[ids.alertsPulse,ids.alertsSelectedLine,ids.alertsLine,ids.alertsFill].forEach((id)=>map.getLayer(id)&&map.removeLayer(id))
        map.getSource(ids.alertsSource)&&map.removeSource(ids.alertsSource); return
      }
      const fc=featureCollectionFromAlerts((alertsQ.data?.alerts??[])
        .filter((a)=>a.geometryStatus==='mapped')
        .filter((a)=>{
          if (alertViewMode === 'warnings') return a.event.toLowerCase().includes('warning')
          if (alertViewMode === 'watches') return a.event.toLowerCase().includes('watch')
          return true
        }))
      const src = map.getSource(ids.alertsSource) as maplibregl.GeoJSONSource | undefined
      if (!src) map.addSource(ids.alertsSource,{type:'geojson',data:fc}); else src.setData(fc)
      const before = map.getLayer(ids.reportsLayer) ? ids.reportsLayer : undefined
      if (!map.getLayer(ids.alertsFill)) map.addLayer({id:ids.alertsFill,type:'fill',source:ids.alertsSource,paint:{'fill-color':['match',['get','severity'],'Extreme','#ff1f4b','Severe','#ff6a00','Moderate','#ffd347','Minor','#58a6ff','#8b949e'],'fill-opacity':['case',['==',['get','id'],s.selectedAlertId??'__none__'],0.52,0.2]}}, before)
      else map.setPaintProperty(ids.alertsFill, 'fill-opacity', ['case',['==',['get','id'],s.selectedAlertId??'__none__'],0.52,0.2])
      if (!map.getLayer(ids.alertsLine)) map.addLayer({id:ids.alertsLine,type:'line',source:ids.alertsSource,paint:{'line-color':['case',['==',['get','id'],s.selectedAlertId??'__none__'],'#f8fafc','#d5e1f5'],'line-width':['case',['==',['get','id'],s.selectedAlertId??'__none__'],3.2,1.2]}}, before)
      else {
        map.setPaintProperty(ids.alertsLine, 'line-color', ['case',['==',['get','id'],s.selectedAlertId??'__none__'],'#f8fafc','#d5e1f5'])
        map.setPaintProperty(ids.alertsLine, 'line-width', ['case',['==',['get','id'],s.selectedAlertId??'__none__'],3.2,1.2])
      }
      if (!map.getLayer(ids.alertsSelectedLine)) map.addLayer({id:ids.alertsSelectedLine,type:'line',source:ids.alertsSource,filter:['==',['get','id'],s.selectedAlertId??'__none__'],paint:{'line-color':'#8ce99a','line-width':5.4,'line-opacity':0.95,'line-blur':0.4}}, before)
      else map.setFilter(ids.alertsSelectedLine, ['==',['get','id'],s.selectedAlertId??'__none__'])
      if (!map.getLayer(ids.alertsPulse)) map.addLayer({id:ids.alertsPulse,type:'line',source:ids.alertsSource,filter:['>=',['index-of','Warning',['coalesce',['get','event'],'']],0],paint:{'line-color':'#ffeded','line-width':4,'line-opacity':pulseRef.current}}, before)
    }
    map.isStyleLoaded()?run():map.once('load',run)
  }, [alertsEnabled, alertsQ.data, s.selectedAlertId, alertViewMode, basemapMode])

  useEffect(()=>{ const map=mapRef.current; if(!map||!alertsEnabled||!map.getLayer(ids.alertsPulse)) return; let t=0; const timer=setInterval(()=>{ t+=0.28; const o=0.25+((Math.sin(t)+1)/2)*0.6; pulseRef.current=o; map.getLayer(ids.alertsPulse)&&map.setPaintProperty(ids.alertsPulse,'line-opacity',o)},150); return ()=>clearInterval(timer)},[alertsEnabled,alertsQ.data])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !alertsEnabled) return

    let target = s.selectedAlertId
    if (s.zoomRequestAlertId && s.zoomRequestNonce !== zoomNonceRef.current) {
      target = s.zoomRequestAlertId
      zoomNonceRef.current = s.zoomRequestNonce
    }
    if (!target) return

    const alert = alertsQ.data?.alerts.find((x) => x.id === target)
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
  }, [alertsEnabled, alertsQ.data, s.selectedAlertId, s.zoomRequestAlertId, s.zoomRequestNonce])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !alertsEnabled || !regionalFocusPackId || regionalFocusAreas.length === 0 || !regionalFocusQ.data) return

    const focusKey = `${regionalFocusPackId}:${regionalFocusAreas.join(',')}`
    if (regionalFocusNonceRef.current === focusKey) return

    const regionalGeometries = regionalFocusQ.data.alerts
      .filter((alert) => alert.geometryStatus === 'mapped')
      .map((alert) => alert.geometry)

    const regionalBounds = boundsFromGeometries(regionalGeometries)
    if (!regionalBounds) return

    regionalFocusNonceRef.current = focusKey
    map.fitBounds(regionalBounds, { padding: 52, duration: 720, maxZoom: 8.75 })
  }, [alertsEnabled, regionalFocusPackId, regionalFocusAreas, regionalFocusQ.data])

  useEffect(()=>{ const map=mapRef.current; if(!map) return; const run=()=>{ if(!radarEnabled){ map.getLayer(ids.radarLayer)&&map.removeLayer(ids.radarLayer); map.getSource(ids.radarSource)&&map.removeSource(ids.radarSource); radarTileRef.current=null; return } const frames=radarQ.data?.frames??[]; const active=s.selectedRadarFrameTime? frames.find((f)=>f.time===s.selectedRadarFrameTime)??frames[frames.length-1]:frames[frames.length-1]; if(!active){return} const src=map.getSource(ids.radarSource) as maplibregl.RasterTileSource|undefined; if(!src || radarTileRef.current!==active.tileUrlTemplate){ map.getLayer(ids.radarLayer)&&map.removeLayer(ids.radarLayer); map.getSource(ids.radarSource)&&map.removeSource(ids.radarSource); map.addSource(ids.radarSource,{type:'raster',tiles:[active.tileUrlTemplate],tileSize:256}); const before=map.getLayer(ids.outlookFill)?ids.outlookFill:map.getLayer(ids.alertsFill)?ids.alertsFill:map.getLayer(ids.reportsLayer)?ids.reportsLayer:undefined; map.addLayer({id:ids.radarLayer,type:'raster',source:ids.radarSource,paint:{'raster-opacity':radarOpacityRef.current}},before); radarTileRef.current=active.tileUrlTemplate }}; map.isStyleLoaded()?run():map.once('load',run)},[radarEnabled,radarQ.data,s.selectedRadarFrameTime,basemapMode])
  useEffect(()=>{ const map=mapRef.current; if(map?.getLayer(ids.radarLayer)) map.setPaintProperty(ids.radarLayer,'raster-opacity',s.radarOpacity)},[s.radarOpacity])

  useEffect(()=>{ const map=mapRef.current; if(!map) return; const run=()=>{ if(!spcOutlookEnabled){ [ids.outlookLine,ids.outlookFill].forEach((id)=>map.getLayer(id)&&map.removeLayer(id)); map.getSource(ids.outlookSource)&&map.removeSource(ids.outlookSource); return } const fc=outlookQ.data?.featureCollection??{type:'FeatureCollection',features:[] as GeoJSON.Feature[]}; const src=map.getSource(ids.outlookSource) as maplibregl.GeoJSONSource|undefined; if(!src) map.addSource(ids.outlookSource,{type:'geojson',data:fc}); else src.setData(fc); const before=map.getLayer(ids.alertsFill)?ids.alertsFill:map.getLayer(ids.reportsLayer)?ids.reportsLayer:undefined; if(!map.getLayer(ids.outlookFill)) map.addLayer({id:ids.outlookFill,type:'fill',source:ids.outlookSource,paint:{'fill-color':['match',['coalesce',['to-string',['get','LABEL']],['to-string',['get','label']],'' ],'TSTM','#6ea8fe','MRGL','#5bc0de','SLGT','#f7dc6f','ENH','#f5b041','MDT','#ec7063','HIGH','#e74c3c','#7f8c8d'],'fill-opacity':0.22}},before); if(!map.getLayer(ids.outlookLine)) map.addLayer({id:ids.outlookLine,type:'line',source:ids.outlookSource,paint:{'line-color':'#d0d7e3','line-width':1.1,'line-opacity':0.75}},before)}; map.isStyleLoaded()?run():map.once('load',run)},[spcOutlookEnabled,outlookQ.data,basemapMode])

  useEffect(()=>{ const map=mapRef.current; if(!map) return; const run=()=>{ if(!stormReportsEnabled){ map.getLayer(ids.reportsLayer)&&map.removeLayer(ids.reportsLayer); map.getSource(ids.reportsSource)&&map.removeSource(ids.reportsSource); return } const fc=featureCollectionFromSpcReports(reportsQ.data?.reports??[]); const src=map.getSource(ids.reportsSource) as maplibregl.GeoJSONSource|undefined; if(!src) map.addSource(ids.reportsSource,{type:'geojson',data:fc}); else src.setData(fc); if(!map.getLayer(ids.reportsLayer)) map.addLayer({id:ids.reportsLayer,type:'circle',source:ids.reportsSource,paint:{'circle-color':['match',['get','type'],'tornado','#ff5f7f','wind','#58c4ff','hail','#75e65d','#b8bec9'],'circle-radius':4.2,'circle-opacity':0.9,'circle-stroke-color':'#0b1220','circle-stroke-width':1}})}; map.isStyleLoaded()?run():map.once('load',run)},[stormReportsEnabled,reportsQ.data,basemapMode])

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

      if (!map.getLayer(ids.spotterLayer)) map.addLayer({ id: ids.spotterLayer, type: 'circle', source: ids.spotterSource, paint: { 'circle-color': ['match', ['get', 'status'], 'active', '#8ce99a', '#9fb5d8'], 'circle-radius': ['case', ['==', ['get', 'hasLiveCam'], 1], 5.8, 4.2], 'circle-opacity': 0.72, 'circle-stroke-color': ['case', ['==', ['get', 'hasLiveCam'], 1], '#f8fafc', '#0b1220'], 'circle-stroke-width': ['case', ['==', ['get', 'hasLiveCam'], 1], 1.5, 1] } })
      if (!map.getLayer(ids.spotterCamLayer)) map.addLayer({ id: ids.spotterCamLayer, type: 'symbol', source: ids.spotterSource, filter: ['==', ['get', 'hasLiveCam'], 1], layout: { 'text-field': 'CAM', 'text-size': 8, 'text-offset': [0, -1.4], 'text-allow-overlap': false }, paint: { 'text-color': '#0b1220', 'text-opacity': 0.86, 'text-halo-color': '#8ce99a', 'text-halo-width': 2.4 } })
    }

    const onMove = (event: maplibregl.MapMouseEvent) => {
      const layers = [ids.spotterCamLayer, ids.spotterLayer].filter((id) => map.getLayer(id))
      if (!layers.length) return
      const features = map.queryRenderedFeatures(event.point, { layers })
      const props = features[0]?.properties
      if (!props) {
        setHoveredSpotter(null)
        map.getCanvas().style.cursor = ''
        return
      }
      setHoveredSpotter({
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
      setHoveredSpotter(null)
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
  }, [setSelectedLiveStreamerId, basemapMode])

  return (
    <div className="map-root-wrap">
      <div className="map-root" ref={mapContainer} aria-label="Weather map" />
      <section className="wcc-map-ops-panel" aria-label="Weather map operations">
        <div className="wcc-map-ops-head">
          <strong>Map Ops</strong>
          <span>{getBasemap(basemapMode).label}</span>
          <span>{radarQ.data?.providerLabel ?? (radarProvider === 'level2' ? 'Level2 radar' : 'RainViewer')}</span>
        </div>
        <div className="wcc-map-alert-actions">
          <button type="button" onClick={() => zoomToActiveAlertExtent('visible')} disabled={!alertsQ.data?.alerts.length}>Zoom active alerts</button>
          <button type="button" onClick={() => zoomToActiveAlertExtent('all')} disabled={!alertsQ.data?.alerts.length}>CONUS alerts</button>
          <button type="button" onClick={returnToPreviousExtent} disabled={!hasPreviousExtent}>Back to extent</button>
          <button type="button" className={radarEnabled ? 'active' : ''} onClick={() => toggleOpsLayer('radar')}>Radar</button>
        </div>
      </section>
      {detailAlert && (
        <section className="wcc-map-alert-ops" aria-label="Selected alert map operations">
          <div className="wcc-map-alert-ops-head">
            <span>Selected Alert</span>
            <strong>{detailAlert.event}</strong>
            <span className={`wcc-severity-badge severity-${detailAlert.severity.toLowerCase()}`}>{detailAlert.severity}</span>
          </div>
          <p>{detailAlert.areaDesc}</p>
          <div className="wcc-map-alert-actions">
            <button type="button" onClick={() => s.requestZoomToAlert(detailAlert.id)}>Zoom to alert</button>
            <button type="button" onClick={returnToPreviousExtent} disabled={!hasPreviousExtent}>Back to extent</button>
            <button type="button" className={radarEnabled ? 'active' : ''} onClick={() => toggleOpsLayer('radar')}>Radar</button>
            <button type="button" className={stormReportsEnabled ? 'active' : ''} onClick={() => toggleOpsLayer('stormReports')}>Reports</button>
          </div>
        </section>
      )}
      {detailAlert && (
        <section className="alert-detail-strip">
          <div className="alert-detail-top"><strong>{detailAlert.event}</strong><span className={`severity-badge severity-${detailAlert.severity.toLowerCase()}`}>{detailAlert.severity}</span></div>
          <p>{detailAlert.areaDesc}</p><p>{detailAlert.headline}</p>
          <p>Urgency: {detailAlert.urgency ?? 'Unknown'} | Certainty: {detailAlert.certainty ?? 'Unknown'}</p>
          <p>Effective: {fmt(detailAlert.effective)} | Expires: {fmt(detailAlert.expires)}</p>
        </section>
      )}
      {INTEGRATION_FLAGS.spotterMapOverlays && hoveredSpotter && (
        <section className="wcc-spotter-hover-card">
          <div className="wcc-spotter-hover-head">
            <strong>{hoveredSpotter.callsign}</strong>
            <span className={hoveredSpotter.status === 'active' ? 'active' : ''}>{hoveredSpotter.status}</span>
            {hoveredSpotter.hasLiveCam && <span className="cam">CAM</span>}
          </div>
          <p>{hoveredSpotter.region}</p>
          {hoveredSpotter.notes && <p>{hoveredSpotter.notes}</p>}
          {hoveredSpotter.streamerId && (
            <button type="button" onClick={() => setSelectedLiveStreamerId(hoveredSpotter.streamerId ?? null)}>
              Open in live viewer
            </button>
          )}
        </section>
      )}
    </div>
  )
}
