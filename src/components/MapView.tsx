/* eslint-disable @typescript-eslint/no-unused-expressions */
import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { fetchNwsAlerts } from '../services/nws'
import { fetchRainViewerMetadata } from '../services/rainviewer'
import { fetchSpcDay1Outlook, fetchSpcReports } from '../services/spc'
import { useMapStore } from '../state/mapStore'
import { boundsFromGeometry, featureCollectionFromAlerts, featureCollectionFromSpcReports } from '../utils/geojson'

const conusCenter: [number, number] = [-97.5, 38.5]
const ids = {
  alertsSource: 'nws-alerts-source', alertsFill: 'nws-alerts-fill', alertsLine: 'nws-alerts-line', alertsPulse: 'nws-alerts-warning-pulse',
  radarSource: 'rainviewer-radar-source', radarLayer: 'rainviewer-radar-layer',
  reportsSource: 'spc-reports-source', reportsLayer: 'spc-reports-layer',
  outlookSource: 'spc-day1-outlook-source', outlookFill: 'spc-day1-outlook-fill', outlookLine: 'spc-day1-outlook-line',
}

function fmt(v: string | null) { if (!v) return 'Unknown'; const d=new Date(v); return Number.isNaN(d.getTime()) ? v : d.toLocaleString() }

export function MapView() {
  const mapContainer = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const radarOpacityRef = useRef(0.65)
  const radarTileRef = useRef<string | null>(null)
  const pulseRef = useRef(0.45)
  const zoomNonceRef = useRef(0)
  const [hoveredAlertId, setHoveredAlertId] = useState<string | null>(null)

  const s = useMapStore()
  const alertsEnabled = s.enabledLayers.includes('nwsAlerts')
  const radarEnabled = s.enabledLayers.includes('radar')
  const stormReportsEnabled = s.enabledLayers.includes('stormReports')
  const spcOutlookEnabled = s.enabledLayers.includes('spcOutlook')
  const alertViewMode = s.alertViewMode

  const alertsQ = useQuery({ queryKey: ['nws-alerts'], queryFn: fetchNwsAlerts, staleTime: 60000 })
  const radarQ = useQuery({ queryKey: ['rainviewer-metadata'], queryFn: fetchRainViewerMetadata, staleTime: 180000 })
  const reportsQ = useQuery({ queryKey: ['spc-reports'], queryFn: fetchSpcReports, staleTime: 120000 })
  const outlookQ = useQuery({ queryKey: ['spc-day1-outlook'], queryFn: fetchSpcDay1Outlook, staleTime: 180000 })

  const alertsById = useMemo(() => new Map((alertsQ.data?.alerts ?? []).map((a) => [a.id, a])), [alertsQ.data?.alerts])
  const detailAlert = hoveredAlertId ? alertsById.get(hoveredAlertId) ?? null : alertsById.get(s.selectedAlertId ?? '') ?? null

  useEffect(() => {
    if (!mapContainer.current || mapRef.current) return
    const map = new maplibregl.Map({
      container: mapContainer.current,
      style: { version: 8, sources: { basemap: { type: 'raster', tiles: ['https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png'], tileSize: 256 } }, layers: [{ id: 'basemap', type: 'raster', source: 'basemap' }] },
      center: conusCenter, zoom: 3.7, minZoom: 2, maxZoom: 12,
    })
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right')
    mapRef.current = map
    return () => { map.remove(); mapRef.current = null }
  }, [])

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
        ;[ids.alertsPulse,ids.alertsLine,ids.alertsFill].forEach((id)=>map.getLayer(id)&&map.removeLayer(id))
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
      if (!map.getLayer(ids.alertsLine)) map.addLayer({id:ids.alertsLine,type:'line',source:ids.alertsSource,paint:{'line-color':['case',['==',['get','id'],s.selectedAlertId??'__none__'],'#f8fafc','#d5e1f5'],'line-width':['case',['==',['get','id'],s.selectedAlertId??'__none__'],3.2,1.2]}}, before)
      if (!map.getLayer(ids.alertsPulse)) map.addLayer({id:ids.alertsPulse,type:'line',source:ids.alertsSource,filter:['>=',['index-of','Warning',['coalesce',['get','event'],'']],0],paint:{'line-color':'#ffeded','line-width':4,'line-opacity':pulseRef.current}}, before)
    }
    map.isStyleLoaded()?run():map.once('load',run)
  }, [alertsEnabled, alertsQ.data, s.selectedAlertId, alertViewMode])

  useEffect(()=>{ const map=mapRef.current; if(!map||!alertsEnabled||!map.getLayer(ids.alertsPulse)) return; let t=0; const timer=setInterval(()=>{ t+=0.28; const o=0.25+((Math.sin(t)+1)/2)*0.6; pulseRef.current=o; map.getLayer(ids.alertsPulse)&&map.setPaintProperty(ids.alertsPulse,'line-opacity',o)},150); return ()=>clearInterval(timer)},[alertsEnabled,alertsQ.data])

  useEffect(()=>{ const map=mapRef.current; if(!map||!alertsEnabled) return; let target=s.selectedAlertId; if(s.zoomRequestAlertId && s.zoomRequestNonce!==zoomNonceRef.current){target=s.zoomRequestAlertId; zoomNonceRef.current=s.zoomRequestNonce} if(!target) return; const a=alertsQ.data?.alerts.find((x)=>x.id===target); const b=boundsFromGeometry(a?.geometry??null); if(!a||!b) return; map.fitBounds(b,{padding:44,duration:560,maxZoom:8.5}) },[alertsEnabled,alertsQ.data,s.selectedAlertId,s.zoomRequestAlertId,s.zoomRequestNonce])

  useEffect(()=>{ const map=mapRef.current; if(!map) return; const run=()=>{ if(!radarEnabled){ map.getLayer(ids.radarLayer)&&map.removeLayer(ids.radarLayer); map.getSource(ids.radarSource)&&map.removeSource(ids.radarSource); radarTileRef.current=null; return } const frames=radarQ.data?.frames??[]; const active=s.selectedRadarFrameTime? frames.find((f)=>f.time===s.selectedRadarFrameTime)??frames[frames.length-1]:frames[frames.length-1]; if(!active){return} const src=map.getSource(ids.radarSource) as maplibregl.RasterTileSource|undefined; if(!src || radarTileRef.current!==active.tileUrlTemplate){ map.getLayer(ids.radarLayer)&&map.removeLayer(ids.radarLayer); map.getSource(ids.radarSource)&&map.removeSource(ids.radarSource); map.addSource(ids.radarSource,{type:'raster',tiles:[active.tileUrlTemplate],tileSize:256}); const before=map.getLayer(ids.outlookFill)?ids.outlookFill:map.getLayer(ids.alertsFill)?ids.alertsFill:map.getLayer(ids.reportsLayer)?ids.reportsLayer:undefined; map.addLayer({id:ids.radarLayer,type:'raster',source:ids.radarSource,paint:{'raster-opacity':radarOpacityRef.current}},before); radarTileRef.current=active.tileUrlTemplate }}; map.isStyleLoaded()?run():map.once('load',run)},[radarEnabled,radarQ.data,s.selectedRadarFrameTime])
  useEffect(()=>{ const map=mapRef.current; if(map?.getLayer(ids.radarLayer)) map.setPaintProperty(ids.radarLayer,'raster-opacity',s.radarOpacity)},[s.radarOpacity])

  useEffect(()=>{ const map=mapRef.current; if(!map) return; const run=()=>{ if(!spcOutlookEnabled){ [ids.outlookLine,ids.outlookFill].forEach((id)=>map.getLayer(id)&&map.removeLayer(id)); map.getSource(ids.outlookSource)&&map.removeSource(ids.outlookSource); return } const fc=outlookQ.data?.featureCollection??{type:'FeatureCollection',features:[] as GeoJSON.Feature[]}; const src=map.getSource(ids.outlookSource) as maplibregl.GeoJSONSource|undefined; if(!src) map.addSource(ids.outlookSource,{type:'geojson',data:fc}); else src.setData(fc); const before=map.getLayer(ids.alertsFill)?ids.alertsFill:map.getLayer(ids.reportsLayer)?ids.reportsLayer:undefined; if(!map.getLayer(ids.outlookFill)) map.addLayer({id:ids.outlookFill,type:'fill',source:ids.outlookSource,paint:{'fill-color':['match',['coalesce',['to-string',['get','LABEL']],['to-string',['get','label']],'' ],'TSTM','#6ea8fe','MRGL','#5bc0de','SLGT','#f7dc6f','ENH','#f5b041','MDT','#ec7063','HIGH','#e74c3c','#7f8c8d'],'fill-opacity':0.22}},before); if(!map.getLayer(ids.outlookLine)) map.addLayer({id:ids.outlookLine,type:'line',source:ids.outlookSource,paint:{'line-color':'#d0d7e3','line-width':1.1,'line-opacity':0.75}},before)}; map.isStyleLoaded()?run():map.once('load',run)},[spcOutlookEnabled,outlookQ.data])

  useEffect(()=>{ const map=mapRef.current; if(!map) return; const run=()=>{ if(!stormReportsEnabled){ map.getLayer(ids.reportsLayer)&&map.removeLayer(ids.reportsLayer); map.getSource(ids.reportsSource)&&map.removeSource(ids.reportsSource); return } const fc=featureCollectionFromSpcReports(reportsQ.data?.reports??[]); const src=map.getSource(ids.reportsSource) as maplibregl.GeoJSONSource|undefined; if(!src) map.addSource(ids.reportsSource,{type:'geojson',data:fc}); else src.setData(fc); if(!map.getLayer(ids.reportsLayer)) map.addLayer({id:ids.reportsLayer,type:'circle',source:ids.reportsSource,paint:{'circle-color':['match',['get','type'],'tornado','#ff5f7f','wind','#58c4ff','hail','#75e65d','#b8bec9'],'circle-radius':4.2,'circle-opacity':0.9,'circle-stroke-color':'#0b1220','circle-stroke-width':1}})}; map.isStyleLoaded()?run():map.once('load',run)},[stormReportsEnabled,reportsQ.data])

  return (
    <div className="map-root-wrap">
      <div className="map-root" ref={mapContainer} aria-label="Weather map" />
      {detailAlert && (
        <section className="alert-detail-strip">
          <div className="alert-detail-top"><strong>{detailAlert.event}</strong><span className={`severity-badge severity-${detailAlert.severity.toLowerCase()}`}>{detailAlert.severity}</span></div>
          <p>{detailAlert.areaDesc}</p><p>{detailAlert.headline}</p>
          <p>Urgency: {detailAlert.urgency ?? 'Unknown'} | Certainty: {detailAlert.certainty ?? 'Unknown'}</p>
          <p>Effective: {fmt(detailAlert.effective)} | Expires: {fmt(detailAlert.expires)}</p>
        </section>
      )}
    </div>
  )
}
