import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { ANALYSIS_LAYER_DEFINITIONS, CARTO_LIGHT_TILES, CITIES, CITIES_GEOJSON, GRID_GEOJSON, MAP_CENTER, PRECIP_LEGEND, PRODUCT_OPTIONS, RAINFALL_LEGEND, REFLECTIVITY_LEGEND, REGIONAL_BOUNDS, type AnalysisLayerKey } from './config'
import { emptyFeatureCollection, fetchBuoyObservations, fetchHistoryCatalog, fetchRadarManifest, fetchRegionalGeography, fetchRegionalHighways, fetchRegionalSurfaceObservations, fetchRegionalWarnings, warningsFeatureCollection } from './data'
import { encodeGif, GIF_HEIGHT_LIMIT, GIF_WIDTH_LIMIT, LATEST_FRAME_HOLD_MS } from './gif'
import type { BuoyObservation, RadarFrameManifest, RadarHistoryCatalog, RadarManifest, RadarManifestProductId, RadarProductId, RadarSourceId, RadarWarning, SurfaceObservation } from './types'
import './radar.css'

const LIVE_MANIFEST_PATHS: Record<RadarSourceId, string> = {
  mrms: `${import.meta.env.BASE_URL}data/radar/manifest.json`,
  krax: `${import.meta.env.BASE_URL}data/radar/krax/manifest.json`,
}
const HISTORY_CATALOG_PATHS: Record<RadarSourceId, string> = {
  mrms: `${import.meta.env.BASE_URL}data/radar/history/catalog.json`,
  krax: `${import.meta.env.BASE_URL}data/radar/krax/history/catalog.json`,
}
const BUOY_DATA_PATH = `${import.meta.env.BASE_URL}data/observations/buoys.json`
const RADAR_SOURCE_ID = 'wallcloud-radar-image'
const RADAR_LAYER_ID = 'wallcloud-radar-layer'
const WARNING_SOURCE_ID = 'wallcloud-warning-source'
const WARNING_FILL_ID = 'wallcloud-warning-fill'
const WARNING_CASING_ID = 'wallcloud-warning-casing'
const WARNING_LINE_ID = 'wallcloud-warning-line'
const STATE_SOURCE_ID = 'wallcloud-state-source'
const COUNTY_SOURCE_ID = 'wallcloud-county-source'
const HIGHWAY_SOURCE_ID = 'wallcloud-highway-source'
const CITY_SOURCE_ID = 'wallcloud-city-source'
const CITY_LABEL_EXCEPTION_ID = 'wallcloud-city-label-winston-salem'
const GRID_SOURCE_ID = 'wallcloud-grid-source'
const SURFACE_SOURCE_ID = 'wallcloud-surface-source'
const SURFACE_DOT_ID = 'wallcloud-surface-dot'
const SURFACE_LABEL_ID = 'wallcloud-surface-label'
const BUOY_SOURCE_ID = 'wallcloud-buoy-source'
const BUOY_DOT_ID = 'wallcloud-buoy-dot'
const BUOY_LABEL_ID = 'wallcloud-buoy-label'
const BUILD_SHA = import.meta.env.VITE_BUILD_SHA || 'local'
const RADAR_POLL_INTERVAL_MS = 5 * 60 * 1000
const DEFAULT_RADAR_SOURCE: RadarSourceId = 'krax'
const DEFAULT_RADAR_PRODUCT: RadarProductId = 'NEXRADLevel2BaseReflectivity'

const EMPTY_STATE = emptyFeatureCollection()
const PLAYBACK_FPS_OPTIONS = [2, 4, 8, 20, 30] as const

type PlaybackFps = typeof PLAYBACK_FPS_OPTIONS[number]

function initialMapZoom(): number {
  if (window.innerWidth <= 680) return 7.15
  if (window.innerWidth <= 1024) return 7.65
  return 8.15
}

function assetUrl(path: string, manifestPath: string): string {
  const manifestUrl = new URL(manifestPath, window.location.href)
  return new URL(path, manifestUrl).toString()
}

function frameUrl(frame: RadarFrameManifest, manifestPath: string): string {
  const manifestUrl = new URL(manifestPath, window.location.href)
  return new URL(frame.url, manifestUrl).toString()
}

function historicalManifestUrl(manifestUrl: string, sourceId: RadarSourceId): string {
  const catalogUrl = new URL(HISTORY_CATALOG_PATHS[sourceId], window.location.href)
  return new URL(manifestUrl, catalogUrl).toString()
}

function formatEasternTime(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(date)
}

function formatEasternDateTime(value: string | null | undefined): string {
  if (!value) return 'Unknown'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Unknown'
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(date) + ' ET'
}

function ageMinutes(value: string | null | undefined): number | null {
  if (!value) return null
  const timestamp = Date.parse(value)
  if (Number.isNaN(timestamp)) return null
  return Math.max(0, Math.floor((Date.now() - timestamp) / 60_000))
}

function createMapSources(map: maplibregl.Map): void {
  map.addSource(STATE_SOURCE_ID, { type: 'geojson', data: EMPTY_STATE })
  map.addLayer({
    id: 'wallcloud-state-fill',
    type: 'fill',
    source: STATE_SOURCE_ID,
    paint: { 'fill-color': '#f7f8f7', 'fill-opacity': 0.03 },
  })
  map.addLayer({
    id: 'wallcloud-state-line',
    type: 'line',
    source: STATE_SOURCE_ID,
    paint: { 'line-color': '#202a31', 'line-opacity': 0.9, 'line-width': 1.45 },
  })

  map.addSource(COUNTY_SOURCE_ID, { type: 'geojson', data: EMPTY_STATE })
  map.addLayer({
    id: 'wallcloud-county-line',
    type: 'line',
    source: COUNTY_SOURCE_ID,
    paint: { 'line-color': '#7f8b94', 'line-opacity': 0.58, 'line-width': 0.58 },
  })

  map.addSource(GRID_SOURCE_ID, { type: 'geojson', data: GRID_GEOJSON })
  map.addLayer({
    id: 'wallcloud-coordinate-grid',
    type: 'line',
    source: GRID_SOURCE_ID,
    paint: {
      'line-color': '#71808b',
      'line-opacity': 0.28,
      'line-width': 0.7,
      'line-dasharray': [2, 4],
    },
  })

  map.addSource(HIGHWAY_SOURCE_ID, { type: 'geojson', data: EMPTY_STATE })
  map.addLayer({
    id: 'wallcloud-highway-line',
    type: 'line',
    source: HIGHWAY_SOURCE_ID,
    layout: { visibility: 'none' },
    paint: { 'line-color': '#b27436', 'line-opacity': 0.68, 'line-width': 1.15 },
  })
  map.addLayer({
    id: 'wallcloud-highway-label',
    type: 'symbol',
    source: HIGHWAY_SOURCE_ID,
    layout: {
      visibility: 'none',
      'symbol-placement': 'line',
      'text-field': ['coalesce', ['get', 'NAME'], ['get', 'BASENAME'], ''],
      'text-size': 10,
      'text-font': ['Open Sans Regular'],
      'symbol-spacing': 500,
    },
    paint: { 'text-color': '#845324', 'text-halo-color': '#ffffff', 'text-halo-width': 1.3 },
  })

  map.addSource(CITY_SOURCE_ID, { type: 'geojson', data: CITIES_GEOJSON })
  map.addLayer({
    id: 'wallcloud-city-dot',
    type: 'circle',
    source: CITY_SOURCE_ID,
    paint: {
      'circle-radius': ['case', ['get', 'primary'], 4.2, 2.8],
      'circle-color': ['case', ['get', 'primary'], '#1d2830', '#60707a'],
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 1.2,
      'circle-opacity': 0.94,
    },
  })
  map.addLayer({
    id: 'wallcloud-city-label',
    type: 'symbol',
    source: CITY_SOURCE_ID,
    filter: ['!=', ['get', 'id'], 'winston-salem'],
    layout: {
      'text-field': ['get', 'label'],
      'text-size': ['case', ['get', 'primary'], 11, 9],
      'text-offset': [0.7, 0],
      'text-anchor': 'left',
      'text-allow-overlap': false,
      'text-ignore-placement': false,
    },
    paint: { 'text-color': ['case', ['get', 'primary'], '#172129', '#53616a'], 'text-halo-color': '#ffffff', 'text-halo-width': 1.55 },
  })
  map.addLayer({
    id: CITY_LABEL_EXCEPTION_ID,
    type: 'symbol',
    source: CITY_SOURCE_ID,
    filter: ['==', ['get', 'id'], 'winston-salem'],
    layout: {
      'text-field': ['get', 'label'],
      'text-size': 11,
      'text-offset': [0.7, 1.15],
      'text-anchor': 'top-left',
      'text-allow-overlap': true,
      'text-ignore-placement': true,
    },
    paint: { 'text-color': '#172129', 'text-halo-color': '#ffffff', 'text-halo-width': 1.55 },
  })

  map.addSource(SURFACE_SOURCE_ID, { type: 'geojson', data: EMPTY_STATE })
  map.addLayer({
    id: SURFACE_DOT_ID,
    type: 'circle',
    source: SURFACE_SOURCE_ID,
    minzoom: 5.8,
    paint: {
      'circle-radius': 4.4,
      'circle-color': '#0b8d9e',
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 1.2,
      'circle-opacity': 0.94,
    },
  })
  map.addLayer({
    id: SURFACE_LABEL_ID,
    type: 'symbol',
    source: SURFACE_SOURCE_ID,
    minzoom: 7,
    layout: {
      'text-field': ['get', 'station'],
      'text-size': 9,
      'text-offset': [0.8, 0],
      'text-anchor': 'left',
      'text-allow-overlap': false,
    },
    paint: { 'text-color': '#096d79', 'text-halo-color': '#ffffff', 'text-halo-width': 1.4 },
  })

  map.addSource(BUOY_SOURCE_ID, { type: 'geojson', data: EMPTY_STATE })
  map.addLayer({
    id: BUOY_DOT_ID,
    type: 'circle',
    source: BUOY_SOURCE_ID,
    paint: {
      'circle-radius': 5.2,
      'circle-color': '#d2772e',
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 1.5,
      'circle-opacity': 0.96,
    },
  })
  map.addLayer({
    id: BUOY_LABEL_ID,
    type: 'symbol',
    source: BUOY_SOURCE_ID,
    minzoom: 6.3,
    layout: {
      'text-field': ['get', 'id'],
      'text-size': 9,
      'text-offset': [0.85, 0],
      'text-anchor': 'left',
      'text-allow-overlap': false,
    },
    paint: { 'text-color': '#9b531d', 'text-halo-color': '#ffffff', 'text-halo-width': 1.4 },
  })

  map.addSource(WARNING_SOURCE_ID, { type: 'geojson', data: EMPTY_STATE })
  map.addLayer({
    id: WARNING_FILL_ID,
    type: 'fill',
    source: WARNING_SOURCE_ID,
    paint: {
      'fill-color': [
        'match', ['get', 'event'],
        'Tornado Warning', '#f1465d',
        'Severe Thunderstorm Warning', '#f4a340',
        'Flash Flood Warning', '#5cc47f',
        'Special Marine Warning', '#f3cf54',
        '#e8edf0',
      ],
      'fill-opacity': ['case', ['==', ['get', 'id'], '__none__'], 0.18, 0.22],
    },
  })
  map.addLayer({
    id: WARNING_CASING_ID,
    type: 'line',
    source: WARNING_SOURCE_ID,
    paint: {
      'line-color': '#07151b',
      'line-width': 5.6,
      'line-opacity': 0.9,
    },
  })
  map.addLayer({
    id: WARNING_LINE_ID,
    type: 'line',
    source: WARNING_SOURCE_ID,
    paint: {
      'line-color': [
        'match', ['get', 'event'],
        'Tornado Warning', '#f1465d',
        'Severe Thunderstorm Warning', '#f4a340',
        'Flash Flood Warning', '#5cc47f',
        'Special Marine Warning', '#f3cf54',
        '#e8edf0',
      ],
      'line-width': 2.7,
      'line-opacity': 0.98,
    },
  })
}

function setLayerVisibility(map: maplibregl.Map, ids: string[], visible: boolean): void {
  ids.forEach((id) => {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none')
  })
}

function productFrames(manifest: RadarManifest | null, productId: RadarManifestProductId): RadarFrameManifest[] {
  return manifest?.products[productId]?.frames ?? (productId === manifest?.product ? manifest.frames ?? [] : [])
}

function hasUsableFrames(manifest: RadarManifest, productId: RadarManifestProductId): boolean {
  return manifest.status === 'ready' && productFrames(manifest, productId).length > 0
}

function analysisSourceId(productId: string): string {
  return `wallcloud-analysis-source-${productId.replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase()}`
}

function analysisLayerId(productId: string): string {
  return `wallcloud-analysis-layer-${productId.replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase()}`
}

function imageCoordinates(bounds: [number, number, number, number]): [[number, number], [number, number], [number, number], [number, number]] {
  return [[bounds[0], bounds[3]], [bounds[2], bounds[3]], [bounds[2], bounds[1]], [bounds[0], bounds[1]]]
}

function loadBrowserImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.decoding = 'async'
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error(`Unable to load radar frame ${url}`))
    image.src = url
  })
}

function captureMapCanvas(map: maplibregl.Map): ImageData {
  const source = map.getCanvas()
  const scale = Math.min(1, GIF_WIDTH_LIMIT / source.width, GIF_HEIGHT_LIMIT / source.height)
  const width = Math.max(1, Math.round(source.width * scale))
  const height = Math.max(1, Math.round(source.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Browser canvas is unavailable')
  context.drawImage(source, 0, 0, width, height)
  return context.getImageData(0, 0, width, height)
}

type ExportBounds = [number, number, number, number]

function exportProject(longitude: number, latitude: number, bounds: ExportBounds, width: number, height: number): [number, number] {
  return [
    (longitude - bounds[0]) / (bounds[2] - bounds[0]) * width,
    (bounds[3] - latitude) / (bounds[3] - bounds[1]) * height,
  ]
}

function drawExportGeometry(
  context: CanvasRenderingContext2D,
  collection: GeoJSON.FeatureCollection,
  bounds: ExportBounds,
  width: number,
  height: number,
  lineColor: string,
  lineWidth: number,
  fillColor?: string,
): void {
  context.save()
  context.strokeStyle = lineColor
  context.lineWidth = lineWidth
  collection.features.forEach((feature) => {
    const geometry = feature.geometry
    if (!geometry || (geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon')) return
    const polygons = geometry.type === 'Polygon'
      ? [geometry.coordinates as number[][][]]
      : geometry.coordinates as number[][][][]
    polygons.forEach((polygon) => polygon.forEach((ring, ringIndex) => {
      if (ring.length < 2) return
      context.beginPath()
      ring.forEach((position, index) => {
        const [x, y] = exportProject(position[0], position[1], bounds, width, height)
        if (index === 0) context.moveTo(x, y)
        else context.lineTo(x, y)
      })
      context.closePath()
      if (fillColor && ringIndex === 0) {
        context.fillStyle = fillColor
        context.fill()
      }
      context.stroke()
    }))
  })
  context.restore()
}

function drawExportLineGeometry(
  context: CanvasRenderingContext2D,
  collection: GeoJSON.FeatureCollection,
  bounds: ExportBounds,
  width: number,
  height: number,
  lineColor: string,
  lineWidth: number,
): void {
  context.save()
  context.strokeStyle = lineColor
  context.lineWidth = lineWidth
  collection.features.forEach((feature) => {
    const geometry = feature.geometry
    if (!geometry || (geometry.type !== 'LineString' && geometry.type !== 'MultiLineString')) return
    const lines = geometry.type === 'LineString'
      ? [geometry.coordinates as number[][]]
      : geometry.coordinates as number[][][]
    lines.forEach((line) => {
      if (line.length < 2) return
      context.beginPath()
      line.forEach((position, index) => {
        const [x, y] = exportProject(position[0], position[1], bounds, width, height)
        if (index === 0) context.moveTo(x, y)
        else context.lineTo(x, y)
      })
      context.stroke()
    })
  })
  context.restore()
}

function drawExportWarnings(
  context: CanvasRenderingContext2D,
  collection: GeoJSON.FeatureCollection,
  bounds: ExportBounds,
  width: number,
  height: number,
): void {
  const styles: Record<string, { line: string; fill: string }> = {
    'Tornado Warning': { line: '#f1465d', fill: 'rgba(241,70,93,.18)' },
    'Severe Thunderstorm Warning': { line: '#f4a340', fill: 'rgba(244,163,64,.18)' },
    'Flash Flood Warning': { line: '#5cc47f', fill: 'rgba(92,196,127,.18)' },
    'Special Marine Warning': { line: '#d5ae36', fill: 'rgba(213,174,54,.18)' },
  }
  collection.features.forEach((feature) => {
    const style = styles[String(feature.properties?.event ?? '')] ?? { line: '#e8edf0', fill: 'rgba(232,237,240,.16)' }
    drawExportGeometry(
      context,
      { type: 'FeatureCollection', features: [feature] },
      bounds,
      width,
      height,
      '#07151b',
      5,
    )
    drawExportGeometry(
      context,
      { type: 'FeatureCollection', features: [feature] },
      bounds,
      width,
      height,
      style.line,
      2.6,
      style.fill.replace(/\.18\)/, '.25)').replace(/\.16\)/, '.22)'),
    )
  })
}

function drawExportCityLabels(context: CanvasRenderingContext2D, bounds: ExportBounds, width: number, height: number): void {
  const used: Array<{ left: number; top: number; right: number; bottom: number }> = []
  context.save()
  context.textBaseline = 'top'
  CITIES.forEach((city) => {
    if (city.lon < bounds[0] || city.lon > bounds[2] || city.lat < bounds[1] || city.lat > bounds[3]) return
    const primary = Boolean(city.primary)
    context.font = `${primary ? '800 12px' : '600 9px'} Arial, sans-serif`
    const [x, y] = exportProject(city.lon, city.lat, bounds, width, height)
    const labelWidth = context.measureText(city.label).width
    const labelHeight = primary ? 14 : 11
    const candidates = [[5, -labelHeight - 3], [5, 5], [-labelWidth - 5, -labelHeight - 3], [-labelWidth - 5, 5]]
    context.fillStyle = primary ? '#172129' : '#53616a'
    context.beginPath()
    context.arc(x, y, primary ? 3.2 : 2.1, 0, Math.PI * 2)
    context.fill()
    context.strokeStyle = '#ffffff'
    context.lineWidth = primary ? 1.2 : 1
    context.stroke()
    for (const [offsetX, offsetY] of candidates) {
      const box = { left: x + offsetX, top: y + offsetY, right: x + offsetX + labelWidth, bottom: y + offsetY + labelHeight }
      if (box.left < 2 || box.top < 2 || box.right >= width - 2 || box.bottom >= height - 2) continue
      if (used.some((other) => box.left - 3 < other.right && box.right + 3 > other.left && box.top - 3 < other.bottom && box.bottom + 3 > other.top)) continue
      context.lineWidth = primary ? 3.2 : 2.5
      context.strokeStyle = '#ffffff'
      context.strokeText(city.label, x + offsetX, y + offsetY)
      context.fillStyle = primary ? '#172129' : '#53616a'
      context.fillText(city.label, x + offsetX, y + offsetY)
      used.push(box)
      break
    }
  })
  context.restore()
}

function hasVisibleMapCapture(image: ImageData): boolean {
  const pixelCount = image.data.length / 4
  const sampleStep = Math.max(1, Math.floor(pixelCount / 10_000))
  let samples = 0
  let visible = 0
  let brightness = 0
  for (let pixel = 0; pixel < pixelCount; pixel += sampleStep) {
    const source = pixel * 4
    const value = image.data[source] + image.data[source + 1] + image.data[source + 2]
    brightness += value
    samples += 1
    if (image.data[source + 3] > 0 && value > 24) visible += 1
  }
  return samples > 0 && visible / samples > 0.05 && brightness / samples > 24
}

async function captureExportMap(
  map: maplibregl.Map,
  frame: RadarFrameManifest,
  manifestPath: string,
  states: GeoJSON.FeatureCollection,
  counties: GeoJSON.FeatureCollection,
  includeCounties: boolean,
  includeCities: boolean,
  highways: GeoJSON.FeatureCollection,
  includeHighways: boolean,
  warnings: GeoJSON.FeatureCollection,
  includeWarnings: boolean,
): Promise<ImageData> {
  const image = await loadBrowserImage(frameUrl(frame, manifestPath))
  const sourceCanvas = map.getCanvas()
  const scale = Math.min(1, GIF_WIDTH_LIMIT / sourceCanvas.width, GIF_HEIGHT_LIMIT / sourceCanvas.height)
  const width = Math.max(1, Math.round(sourceCanvas.width * scale))
  const height = Math.max(1, Math.round(sourceCanvas.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Browser canvas is unavailable')

  const view = map.getBounds()
  const viewBounds: ExportBounds = [view.getWest(), view.getSouth(), view.getEast(), view.getNorth()]
  context.fillStyle = '#e5edf4'
  context.fillRect(0, 0, width, height)
  drawExportGeometry(context, states, viewBounds, width, height, 'rgba(32,42,49,.9)', 1.4, '#f7f8f7')
  if (includeCounties) drawExportGeometry(context, counties, viewBounds, width, height, 'rgba(127,139,148,.62)', 0.65)
  const [west, south, east, north] = frame.bounds
  const viewWest = Math.max(west, view.getWest())
  const viewEast = Math.min(east, view.getEast())
  const viewSouth = Math.max(south, view.getSouth())
  const viewNorth = Math.min(north, view.getNorth())
  if (viewWest < viewEast && viewSouth < viewNorth) {
    const sourceX = (viewWest - west) / (east - west) * image.naturalWidth
    const sourceY = (north - viewNorth) / (north - south) * image.naturalHeight
    const sourceWidth = (viewEast - viewWest) / (east - west) * image.naturalWidth
    const sourceHeight = (viewNorth - viewSouth) / (north - south) * image.naturalHeight
    context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, width, height)
  } else {
    context.drawImage(image, 0, 0, width, height)
  }
  if (includeCounties) drawExportGeometry(context, counties, viewBounds, width, height, 'rgba(127,139,148,.62)', 0.65)
  if (includeWarnings) drawExportWarnings(context, warnings, viewBounds, width, height)
  if (includeHighways) drawExportLineGeometry(context, highways, viewBounds, width, height, 'rgba(132,83,36,.82)', 1.25)
  drawExportGeometry(context, states, viewBounds, width, height, 'rgba(32,42,49,.9)', 1.4)
  if (includeCities) drawExportCityLabels(context, viewBounds, width, height)
  return context.getImageData(0, 0, width, height)
}

const SHARE_GIF_MAP_WIDTH = 720
const SHARE_GIF_WIDTH = SHARE_GIF_MAP_WIDTH
const SHARE_GIF_MAP_HEIGHT = 480
const SHARE_GIF_HEADER_HEIGHT = 58
const SHARE_GIF_FOOTER_HEIGHT = 34
const SHARE_BRAND_NAVY = '#102a43'
const SHARE_BRAND_TEAL = '#81ded0'
const SHARE_BRAND_LIGHT = '#edf5f3'
const SHARE_FRAME_BORDER = '#243746'

function shareProductDetails(productId: RadarProductId): { label: string; source: string; resolution: string; unit: string; legend: Array<{ label: string; color: string }> } {
  if (productId === 'PrecipFlag') return { label: 'Precipitation Type', source: 'MRMS', resolution: '1 km', unit: 'TYPE', legend: PRECIP_LEGEND }
  if (productId === 'MultiSensor_QPE_01H_Pass1') return { label: '1-hour Rainfall', source: 'MRMS', resolution: '1 km', unit: 'mm', legend: RAINFALL_LEGEND }
  if (productId === 'NEXRADLevel2BaseReflectivity') return { label: 'Base Reflectivity', source: 'KRAX Level II', resolution: 'native', unit: 'dBZ', legend: REFLECTIVITY_LEGEND }
  return { label: 'Composite Reflectivity', source: 'MRMS', resolution: '1 km', unit: 'dBZ', legend: REFLECTIVITY_LEGEND }
}

function formatShareValidTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'VALID TIME UNKNOWN'
  const formatted = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).formatToParts(date)
  const part = (type: Intl.DateTimeFormatPartTypes) => formatted.find((item) => item.type === type)?.value ?? ''
  return `${part('hour')}:${part('minute')} ${part('dayPeriod')} ET · ${part('weekday')} ${part('day')} ${part('month')} ${part('year')}`
}

function formatShareLoopPeriod(firstValue: string | undefined, lastValue: string | undefined): string {
  const first = firstValue ? new Date(firstValue) : null
  const last = lastValue ? new Date(lastValue) : null
  if (!first || !last || Number.isNaN(first.getTime()) || Number.isNaN(last.getTime())) return 'PERIOD UNKNOWN'
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
  const firstParts = formatter.formatToParts(first)
  const lastParts = formatter.formatToParts(last)
  const firstPeriod = firstParts.find((part) => part.type === 'dayPeriod')?.value ?? ''
  const lastPeriod = lastParts.find((part) => part.type === 'dayPeriod')?.value ?? ''
  const firstClock = formatter.format(first)
  const compactFirstClock = firstPeriod === lastPeriod
    ? firstClock.replace(` ${firstPeriod}`, '')
    : firstClock
  return `${compactFirstClock}–${formatter.format(last)} ET`
}

function drawShareVerticalLegend(
  context: CanvasRenderingContext2D,
  details: ReturnType<typeof shareProductDetails>,
): void {
  const compact = details.legend.length > 8
  const panelWidth = compact ? 52 : 94
  const rowHeight = compact ? 13 : 34
  const panelHeight = 26 + details.legend.length * rowHeight + 6
  const panelX = SHARE_GIF_MAP_WIDTH - panelWidth - 10
  const panelY = SHARE_GIF_HEADER_HEIGHT + SHARE_GIF_MAP_HEIGHT - panelHeight - 10

  context.save()
  context.fillStyle = 'rgba(255, 255, 255, .5)'
  context.fillRect(panelX, panelY, panelWidth, panelHeight)
  context.strokeStyle = 'rgba(16, 42, 67, .72)'
  context.lineWidth = 1
  context.strokeRect(panelX + 0.5, panelY + 0.5, panelWidth - 1, panelHeight - 1)
  context.fillStyle = SHARE_BRAND_NAVY
  context.font = '800 8px Arial, sans-serif'
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillText(details.unit.toUpperCase(), panelX + panelWidth / 2, panelY + 13)

  details.legend.forEach((entry, index) => {
    const rowY = panelY + 26 + index * rowHeight
    context.fillStyle = entry.color
    context.fillRect(panelX + 7, rowY, compact ? 11 : 15, rowHeight)
    context.fillStyle = SHARE_FRAME_BORDER
    context.font = `${compact ? '700 8px' : '700 9px'} Arial, sans-serif`
    context.textAlign = 'left'
    context.fillText(entry.label, panelX + (compact ? 23 : 29), rowY + rowHeight / 2)
  })
  context.restore()
}

function composeShareFrame(
  mapImage: ImageData,
  frame: RadarFrameManifest,
  productId: RadarProductId,
  isHistorical: boolean,
  playbackFps: number,
  frameNumber: number,
  frameCount: number,
  loopPeriod: string,
): ImageData {
  const details = shareProductDetails(productId)
  const output = document.createElement('canvas')
  output.width = SHARE_GIF_WIDTH
  output.height = SHARE_GIF_HEADER_HEIGHT + SHARE_GIF_MAP_HEIGHT + SHARE_GIF_FOOTER_HEIGHT
  const context = output.getContext('2d')
  if (!context) throw new Error('Browser canvas is unavailable')

  const source = document.createElement('canvas')
  source.width = mapImage.width
  source.height = mapImage.height
  const sourceContext = source.getContext('2d')
  if (!sourceContext) throw new Error('Browser canvas is unavailable')
  sourceContext.putImageData(mapImage, 0, 0)

  context.fillStyle = '#e9eff2'
  context.fillRect(0, 0, output.width, output.height)
  context.fillStyle = SHARE_BRAND_NAVY
  context.fillRect(0, 0, output.width, SHARE_GIF_HEADER_HEIGHT)
  context.fillStyle = SHARE_BRAND_TEAL
  context.fillRect(0, SHARE_GIF_HEADER_HEIGHT - 2, output.width, 2)
  context.font = '800 18px Arial, sans-serif'
  context.fillStyle = SHARE_BRAND_TEAL
  context.fillText('wall.cloud Radar', 14, 22)
  context.fillStyle = SHARE_BRAND_LIGHT
  context.font = '700 12px Arial, sans-serif'
  const subtitleParts = ['North Carolina', details.source]
  if (details.resolution !== 'native') subtitleParts.push(details.resolution)
  subtitleParts.push(details.label)
  context.fillText(subtitleParts.join(' · '), 14, 45)
  context.textAlign = 'right'
  context.font = '800 13px Arial, sans-serif'
  context.fillStyle = '#ffffff'
  context.fillText(`Valid: ${formatShareValidTime(frame.valid_time)}`, output.width - 14, 22)
  context.textAlign = 'left'

  const scale = Math.max(SHARE_GIF_MAP_WIDTH / source.width, SHARE_GIF_MAP_HEIGHT / source.height)
  const imageWidth = Math.max(1, Math.round(source.width * scale))
  const imageHeight = Math.max(1, Math.round(source.height * scale))
  const imageX = Math.round((SHARE_GIF_MAP_WIDTH - imageWidth) / 2)
  const imageY = SHARE_GIF_HEADER_HEIGHT + Math.round((SHARE_GIF_MAP_HEIGHT - imageHeight) / 2)
  context.fillStyle = '#dfe8ec'
  context.fillRect(0, SHARE_GIF_HEADER_HEIGHT, output.width, SHARE_GIF_MAP_HEIGHT)
  context.imageSmoothingEnabled = scale < 1
  context.imageSmoothingQuality = 'high'
  context.drawImage(source, imageX, imageY, imageWidth, imageHeight)
  context.imageSmoothingEnabled = true
  drawShareVerticalLegend(context, details)
  context.strokeStyle = SHARE_FRAME_BORDER
  context.lineWidth = 1
  context.strokeRect(0.5, SHARE_GIF_HEADER_HEIGHT + 0.5, SHARE_GIF_MAP_WIDTH - 1, SHARE_GIF_MAP_HEIGHT - 1)

  const footerY = SHARE_GIF_HEADER_HEIGHT + SHARE_GIF_MAP_HEIGHT
  context.fillStyle = SHARE_BRAND_NAVY
  context.fillRect(0, footerY, output.width, SHARE_GIF_FOOTER_HEIGHT)
  context.fillStyle = SHARE_BRAND_TEAL
  context.fillRect(0, footerY, output.width, 2)
  context.fillStyle = SHARE_BRAND_LIGHT
  context.font = '800 11px Arial, sans-serif'
  const archivePrefix = isHistorical ? 'ARCHIVE · ' : ''
  context.fillText(`${archivePrefix}OBSERVED LOOP · ${loopPeriod} · FRAME ${frameNumber + 1}/${frameCount} · ${playbackFps} FPS`, 14, footerY + 22)
  context.textAlign = 'right'
  context.fillStyle = SHARE_BRAND_TEAL
  context.font = '800 10px Arial, sans-serif'
  context.fillText('wall.cloud', output.width - 14, footerY + 22)
  context.textAlign = 'left'
  context.strokeStyle = SHARE_FRAME_BORDER
  context.lineWidth = 1
  context.strokeRect(0.5, 0.5, output.width - 1, output.height - 1)
  return context.getImageData(0, 0, output.width, output.height)
}

function updateRadarMapImage(map: maplibregl.Map, frame: RadarFrameManifest, manifestPath: string): void {
  const source = map.getSource(RADAR_SOURCE_ID) as maplibregl.ImageSource | undefined
  if (!source) throw new Error('Radar image source is not ready')
  source.updateImage({ url: frameUrl(frame, manifestPath), coordinates: imageCoordinates(frame.bounds) })
}

function waitForMapPaint(map: maplibregl.Map): Promise<void> {
  return new Promise((resolve) => {
    let settled = false
    let timer = 0
    const finish = () => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      map.off('idle', finish)
      window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()))
    }
    map.once('idle', finish)
    timer = window.setTimeout(finish, 450)
    map.triggerRepaint()
  })
}

function surfaceFeatureCollection(observations: SurfaceObservation[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: observations.map((observation) => ({
      type: 'Feature',
      id: observation.id,
      geometry: { type: 'Point', coordinates: [observation.lon, observation.lat] },
      properties: {
        id: observation.id,
        station: observation.station,
        name: observation.name,
        observedAt: observation.observedAt ?? '',
        temperatureC: observation.temperatureC,
        textDescription: observation.textDescription,
      },
    })),
  }
}

function buoyFeatureCollection(observations: BuoyObservation[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: observations.map((observation) => ({
      type: 'Feature',
      id: observation.id,
      geometry: { type: 'Point', coordinates: [observation.lon, observation.lat] },
      properties: {
        id: observation.id,
        name: observation.name,
        observedAt: observation.observedAt ?? '',
      },
    })),
  }
}

function formatNumber(value: number | null | undefined, suffix = ''): string {
  return value === null || value === undefined || !Number.isFinite(value) ? '—' : `${value.toFixed(1)}${suffix}`
}

function formatTemperature(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return `${Math.round(value * 9 / 5 + 32)}°F`
}

function formatWind(value: number | null | undefined, unit: 'kmh' | 'mps'): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  const mph = unit === 'kmh' ? value * 0.621371 : value * 2.23694
  return `${Math.round(mph)} mph`
}

function RadarAnalysisLegends({
  layers,
  manifest,
  isHistorical,
}: {
  layers: Record<AnalysisLayerKey, boolean>
  manifest: RadarManifest | null
  isHistorical: boolean
}) {
  const active = ANALYSIS_LAYER_DEFINITIONS.filter((definition) => definition.key !== 'rainfall').filter((definition) => {
    const product = manifest?.products[definition.productId]
    return !isHistorical && layers[definition.key] && Boolean(product?.frames.length)
  })
  if (!active.length) return null
  return (
    <div className="radar-analysis-legends" aria-label="Active storm analysis legends">
      {active.map((definition) => (
        <div className="radar-analysis-legend" key={definition.key}>
          <div className="radar-analysis-legend-title">{definition.label} <span>{definition.unit}</span></div>
          <div className="radar-analysis-legend-swatches">
            {definition.legend.map((entry) => <span key={entry.label} style={{ backgroundColor: entry.color }} title={`${entry.label} ${definition.unit}`} />)}
          </div>
          <div className="radar-analysis-legend-labels">
            {definition.legend.map((entry) => <span key={entry.label}>{entry.label}</span>)}
          </div>
        </div>
      ))}
    </div>
  )
}

function RadarObservationPanel({
  observation,
  buoy,
  onClose,
}: {
  observation: SurfaceObservation | null
  buoy: BuoyObservation | null
  onClose: () => void
}) {
  if (!observation && !buoy) return null
  if (observation) {
    return (
      <section className="radar-observation-panel" aria-live="polite">
        <div className="radar-warning-panel-top">
          <div><span className="radar-panel-kicker">NWS surface observation</span><h2>{observation.name}</h2></div>
          <button type="button" className="radar-icon-button" onClick={onClose} aria-label="Close observation details">×</button>
        </div>
        <p className="radar-warning-headline">{observation.textDescription} · {formatEasternDateTime(observation.observedAt)}</p>
        <dl>
          <div><dt>Temp / dewpoint</dt><dd>{formatTemperature(observation.temperatureC)} / {formatTemperature(observation.dewpointC)}</dd></div>
          <div><dt>Wind</dt><dd>{formatWind(observation.windSpeedKmh, 'kmh')}{observation.windDirectionDeg === null ? '' : ` from ${Math.round(observation.windDirectionDeg)}°`}</dd></div>
          <div><dt>Gust</dt><dd>{formatWind(observation.windGustKmh, 'kmh')}</dd></div>
          <div><dt>Pressure / RH</dt><dd>{formatNumber(observation.pressureHpa, ' hPa')} / {formatNumber(observation.humidityPercent, '%')}</dd></div>
        </dl>
      </section>
    )
  }
  if (!buoy) return null
  return (
    <section className="radar-observation-panel" aria-live="polite">
      <div className="radar-warning-panel-top">
        <div><span className="radar-panel-kicker">NOAA buoy</span><h2>{buoy.name}</h2></div>
        <button type="button" className="radar-icon-button" onClick={onClose} aria-label="Close buoy details">×</button>
      </div>
      <p className="radar-warning-headline">Latest report · {formatEasternDateTime(buoy.observedAt)}</p>
      <dl>
        <div><dt>Wind</dt><dd>{formatWind(buoy.windSpeedMps, 'mps')}{buoy.windDirectionDeg === null ? '' : ` from ${Math.round(buoy.windDirectionDeg)}°`}</dd></div>
        <div><dt>Gust / waves</dt><dd>{formatWind(buoy.windGustMps, 'mps')} / {formatNumber(buoy.waveHeightM, ' m')}</dd></div>
        <div><dt>Period / pressure</dt><dd>{formatNumber(buoy.dominantPeriodS, ' s')} / {formatNumber(buoy.pressureHpa, ' hPa')}</dd></div>
        <div><dt>Air / water</dt><dd>{formatTemperature(buoy.airTemperatureC)} / {formatTemperature(buoy.waterTemperatureC)}</dd></div>
      </dl>
    </section>
  )
}

function freshWarningPanel(warning: RadarWarning | null, onClose: () => void): ReactElement | null {
  if (!warning) return null
  return (
    <section className="radar-warning-panel" aria-live="polite">
      <div className="radar-warning-panel-top">
        <div>
          <span className="radar-panel-kicker">Active NWS warning</span>
          <h2>{warning.event}</h2>
        </div>
        <button type="button" className="radar-icon-button" onClick={onClose} aria-label="Close warning details">×</button>
      </div>
      <p className="radar-warning-headline">{warning.headline}</p>
      <dl>
        <div><dt>Office</dt><dd>{warning.issuingOffice}</dd></div>
        <div><dt>Area</dt><dd>{warning.areaDesc}</dd></div>
        <div><dt>Effective</dt><dd>{formatEasternDateTime(warning.effective)}</dd></div>
        <div><dt>Expires</dt><dd>{formatEasternDateTime(warning.expires)}</dd></div>
      </dl>
    </section>
  )
}

function RadarLegend({ productId }: { productId: RadarProductId }) {
  const entries = productId === 'PrecipFlag'
    ? PRECIP_LEGEND
    : productId === 'MultiSensor_QPE_01H_Pass1'
      ? RAINFALL_LEGEND
      : REFLECTIVITY_LEGEND
  const heading = productId === 'PrecipFlag' ? 'TYPE' : productId === 'MultiSensor_QPE_01H_Pass1' ? 'mm' : 'dBZ'
  return (
    <aside className="radar-legend" aria-label={`${productId === 'PrecipFlag' ? 'Precipitation type' : productId === 'MultiSensor_QPE_01H_Pass1' ? 'Rainfall accumulation' : 'Reflectivity'} legend`}>
      <div className="radar-legend-heading">{heading}</div>
      <div className="radar-legend-swatches">
        {entries.map((entry) => <span key={entry.label} style={{ backgroundColor: entry.color }} title={entry.label} />)}
      </div>
      <div className="radar-legend-labels">
        {entries.map((entry) => <span key={entry.label}>{entry.label}</span>)}
      </div>
    </aside>
  )
}

export function RadarApp() {
  const mapContainer = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const warningsRef = useRef<Map<string, RadarWarning>>(new Map())
  const [mapReady, setMapReady] = useState(false)
  const [mapError, setMapError] = useState<string | null>(null)
  const [manifest, setManifest] = useState<RadarManifest | null>(null)
  const [manifestError, setManifestError] = useState<string | null>(null)
  const [sourceId, setSourceId] = useState<RadarSourceId>(DEFAULT_RADAR_SOURCE)
  const [manifestPath, setManifestPath] = useState(LIVE_MANIFEST_PATHS[DEFAULT_RADAR_SOURCE])
  const [sourceFallbackNotice, setSourceFallbackNotice] = useState<string | null>(null)
  const [historyCatalogs, setHistoryCatalogs] = useState<Record<RadarSourceId, RadarHistoryCatalog | null>>({ mrms: null, krax: null })
  const [historyErrors, setHistoryErrors] = useState<Record<RadarSourceId, string | null>>({ mrms: null, krax: null })
  const [datasetId, setDatasetId] = useState('live')
  const [productId, setProductId] = useState<RadarProductId>(DEFAULT_RADAR_PRODUCT)
  const [frameIndex, setFrameIndex] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [playbackFps, setPlaybackFps] = useState<PlaybackFps>(4)
  const [radarOpacity, setRadarOpacity] = useState(0.96)
  const [gifExporting, setGifExporting] = useState(false)
  const [gifExportProgress, setGifExportProgress] = useState(0)
  const [gifExportError, setGifExportError] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [layers, setLayers] = useState({
    radar: true,
    warnings: true,
    counties: true,
    cities: true,
    highways: false,
    rainfall: false,
    shearLow: false,
    shearMid: false,
    rotation: false,
    hailMesh: false,
    hailPosh: false,
    lightning: false,
    surface: false,
    buoys: false,
  })
  const [warnings, setWarnings] = useState<RadarWarning[]>([])
  const [warningStatus, setWarningStatus] = useState<'loading' | 'ready' | 'degraded'>('loading')
  const [warningErrors, setWarningErrors] = useState<string[]>([])
  const [selectedWarningId, setSelectedWarningId] = useState<string | null>(null)
  const [states, setStates] = useState<GeoJSON.FeatureCollection>(EMPTY_STATE)
  const [counties, setCounties] = useState<GeoJSON.FeatureCollection>(EMPTY_STATE)
  const [geographyError, setGeographyError] = useState<string | null>(null)
  const [highways, setHighways] = useState<GeoJSON.FeatureCollection>(EMPTY_STATE)
  const [highwaysLoading, setHighwaysLoading] = useState(true)
  const [highwaysError, setHighwaysError] = useState<string | null>(null)
  const [surfaceObservations, setSurfaceObservations] = useState<SurfaceObservation[]>([])
  const [surfaceLoading, setSurfaceLoading] = useState(false)
  const [surfaceError, setSurfaceError] = useState<string | null>(null)
  const [buoys, setBuoys] = useState<BuoyObservation[]>([])
  const [buoyError, setBuoyError] = useState<string | null>(null)
  const [selectedObservationId, setSelectedObservationId] = useState<string | null>(null)
  const [selectedBuoyId, setSelectedBuoyId] = useState<string | null>(null)

  const historyCatalog = historyCatalogs[sourceId]
  const historyError = historyErrors[sourceId]
  const isKrax = sourceId === 'krax'
  const sourceLabel = isKrax ? 'KRAX Level II' : 'MRMS'

  const frames = useMemo(() => productFrames(manifest, productId), [manifest, productId])
  const activeIndex = frames.length ? Math.min(Math.max(frameIndex, 0), frames.length - 1) : 0
  const activeFrame = frames[activeIndex] ?? null
  const latestFrame = frames[frames.length - 1] ?? null
  const selectedWarning = selectedWarningId ? warnings.find((warning) => warning.id === selectedWarningId) ?? null : null
  const selectedObservation = selectedObservationId ? surfaceObservations.find((observation) => observation.id === selectedObservationId) ?? null : null
  const selectedBuoy = selectedBuoyId ? buoys.find((buoy) => buoy.id === selectedBuoyId) ?? null : null
  const isHistorical = manifest?.mode === 'historical' || datasetId !== 'live'
  const latestAge = ageMinutes(manifest?.latest_valid_time)
  const activeAge = ageMinutes(activeFrame?.valid_time)
  const isLatest = Boolean(activeFrame && latestFrame && activeFrame.id === latestFrame.id)
  const freshnessLabel = !activeFrame
    ? 'DATA UNAVAILABLE'
    : isHistorical
      ? 'HISTORICAL'
    : !isLatest
      ? 'PLAYBACK'
      : latestAge === null || latestAge <= 8
        ? 'LIVE'
        : `${latestAge} MIN OLD`

  useEffect(() => {
    let cancelled = false
    ;(['mrms', 'krax'] as RadarSourceId[]).forEach((source) => {
      fetchHistoryCatalog(HISTORY_CATALOG_PATHS[source])
        .then((catalog) => {
          if (!cancelled) {
            setHistoryCatalogs((current) => ({ ...current, [source]: catalog }))
            setHistoryErrors((current) => ({ ...current, [source]: null }))
          }
        })
        .catch((error: unknown) => {
          if (!cancelled) {
            setHistoryErrors((current) => ({
              ...current,
              [source]: error instanceof Error ? error.message : 'Historical catalog request failed',
            }))
          }
        })
    })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    let cancelled = false
    const historyEntry = historyCatalog?.datasets.find((dataset) => dataset.id === datasetId)
    const nextManifestPath = datasetId === 'live'
      ? LIVE_MANIFEST_PATHS[sourceId]
      : historyEntry
        ? historicalManifestUrl(historyEntry.manifest_url, sourceId)
        : null
    const load = async () => {
      if (!nextManifestPath) {
        if (!cancelled) setManifestError('The selected historical loop is no longer in the catalog')
        return
      }
      const applyManifest = (next: RadarManifest, path: string, nextProductId: RadarProductId) => {
        if (cancelled) return
        setManifest(next)
        setManifestPath(path)
        setProductId(nextProductId)
        setFrameIndex(Math.max(productFrames(next, nextProductId).length - 1, 0))
        setPlaying(false)
        setManifestError(null)
      }
      const loadMrmsFallback = async (reason: string) => {
        const fallbackPath = LIVE_MANIFEST_PATHS.mrms
        const fallback = await fetchRadarManifest(fallbackPath)
        applyManifest(fallback, fallbackPath, 'MergedReflectivityQCComposite')
        if (!cancelled) {
          setSourceFallbackNotice(`KRAX Level II unavailable · showing MRMS regional fallback (${reason})`)
          setSourceId('mrms')
        }
      }
      try {
        const next = await fetchRadarManifest(nextManifestPath)
        const hasFrames = hasUsableFrames(next, productId)
        if (datasetId === 'live' && sourceId === 'krax' && !hasFrames) {
          await loadMrmsFallback('no usable Level II frames')
        } else {
          applyManifest(next, nextManifestPath, productId)
        }
      } catch (error) {
        if (datasetId === 'live' && sourceId === 'krax') {
          try {
            await loadMrmsFallback('source request failed')
          } catch (fallbackError) {
            if (!cancelled) {
              const primaryMessage = error instanceof Error ? error.message : 'KRAX manifest request failed'
              const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : 'MRMS fallback request failed'
              setManifestError(`${primaryMessage}; ${fallbackMessage}`)
            }
          }
        } else if (!cancelled) {
          setManifestError(error instanceof Error ? error.message : 'Manifest request failed')
        }
      }
    }
    void load()
    const refresh = datasetId === 'live' ? window.setInterval(() => { void load() }, RADAR_POLL_INTERVAL_MS) : null
    return () => {
      cancelled = true
      if (refresh !== null) window.clearInterval(refresh)
    }
  }, [datasetId, historyCatalog, productId, sourceId])

  useEffect(() => {
    if (!playing || frames.length < 2) return
    const delay = 1_000 / playbackFps + (activeIndex === frames.length - 1 ? LATEST_FRAME_HOLD_MS : 0)
    const timer = window.setTimeout(() => {
      setFrameIndex((index) => index >= frames.length - 1 ? 0 : index + 1)
    }, delay)
    return () => window.clearTimeout(timer)
  }, [activeIndex, frames.length, playbackFps, playing])

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const result = await fetchRegionalWarnings()
        if (cancelled) return
        if (!result.errors.length || result.warnings.length > 0) {
          setWarnings(result.warnings)
          warningsRef.current = new Map(result.warnings.map((warning) => [warning.id, warning]))
        }
        setWarningErrors(result.errors)
        setWarningStatus(result.errors.length ? 'degraded' : 'ready')
      } catch (error) {
        if (!cancelled) {
          setWarningErrors([error instanceof Error ? error.message : 'NWS request failed'])
          setWarningStatus('degraded')
        }
      }
    }
    void load()
    const refresh = window.setInterval(() => { void load() }, 60_000)
    return () => {
      cancelled = true
      window.clearInterval(refresh)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    fetchRegionalGeography(controller.signal)
      .then((result) => {
        if (cancelled) return
        setStates(result.states)
        setCounties(result.counties)
        setGeographyError(null)
      })
      .catch((error: unknown) => {
        if (!cancelled && error instanceof Error && error.name !== 'AbortError') setGeographyError(error.message)
      })
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    fetchRegionalHighways(controller.signal)
      .then((result) => {
        if (!cancelled) {
          setHighways(result)
          setHighwaysError(null)
        }
      })
      .catch((error: unknown) => {
        if (!cancelled && error instanceof Error && error.name !== 'AbortError') setHighwaysError(error.message)
      })
      .finally(() => {
        if (!cancelled) setHighwaysLoading(false)
      })
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [])

  useEffect(() => {
    if (!layers.surface || isHistorical) return
    let cancelled = false
    const controller = new AbortController()
    const load = async () => {
      setSurfaceLoading(true)
      try {
        const result = await fetchRegionalSurfaceObservations(controller.signal)
        if (cancelled) return
        if (result.observations.length || !surfaceObservations.length) setSurfaceObservations(result.observations)
        setSurfaceError(result.errors.length ? result.errors[0] : null)
      } catch (error: unknown) {
        if (!cancelled && error instanceof Error && error.name !== 'AbortError') setSurfaceError(error.message)
      } finally {
        if (!cancelled) setSurfaceLoading(false)
      }
    }
    void load()
    const refresh = window.setInterval(() => { void load() }, 600_000)
    return () => {
      cancelled = true
      controller.abort()
      window.clearInterval(refresh)
    }
  }, [isHistorical, layers.surface, surfaceObservations.length])

  useEffect(() => {
    if (!layers.buoys || isHistorical) return
    let cancelled = false
    const controller = new AbortController()
    const load = async () => {
      try {
        const result = await fetchBuoyObservations(BUOY_DATA_PATH, controller.signal)
        if (cancelled) return
        setBuoys(result.stations)
        setBuoyError(result.status === 'unavailable' ? result.notes ?? 'NOAA buoy data unavailable' : null)
      } catch (error: unknown) {
        if (!cancelled && error instanceof Error && error.name !== 'AbortError') setBuoyError(error.message)
      }
    }
    void load()
    const refresh = window.setInterval(() => { void load() }, 600_000)
    return () => {
      cancelled = true
      controller.abort()
      window.clearInterval(refresh)
    }
  }, [isHistorical, layers.buoys])

  useEffect(() => {
    if (!mapContainer.current || mapRef.current) return
    const map = new maplibregl.Map({
      container: mapContainer.current,
      style: {
        version: 8,
        sources: {
          basemap: { type: 'raster', tiles: [CARTO_LIGHT_TILES], tileSize: 256, attribution: '© OpenStreetMap contributors © CARTO' },
        },
        layers: [{ id: 'wallcloud-basemap', type: 'raster', source: 'basemap', paint: { 'raster-opacity': 1 } }],
      },
      center: MAP_CENTER,
      zoom: initialMapZoom(),
      canvasContextAttributes: { preserveDrawingBuffer: true },
      minZoom: 5.2,
      maxZoom: 12,
      maxBounds: [[REGIONAL_BOUNDS[0] - 1, REGIONAL_BOUNDS[1] - 1], [REGIONAL_BOUNDS[2] + 1, REGIONAL_BOUNDS[3] + 1]],
      attributionControl: false,
      dragRotate: false,
      touchPitch: false,
      pitchWithRotate: false,
    })
    map.touchZoomRotate.disableRotation()
    map.keyboard.disableRotation()
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right')
    map.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: '© OpenStreetMap contributors © CARTO · NOAA radar · NWS' }), 'bottom-right')
    map.on('load', () => {
      createMapSources(map)
      map.jumpTo({ center: MAP_CENTER, zoom: initialMapZoom(), bearing: 0, pitch: 0 })
      map.resize()
      setMapReady(true)
    })
    map.on('click', WARNING_FILL_ID, (event) => {
      const feature = event.features?.[0]
      const id = feature?.properties?.id ?? feature?.id
      if (id) setSelectedWarningId(String(id))
    })
    map.on('mouseenter', WARNING_FILL_ID, () => { map.getCanvas().style.cursor = 'pointer' })
    map.on('mouseleave', WARNING_FILL_ID, () => { map.getCanvas().style.cursor = '' })
    map.on('click', SURFACE_DOT_ID, (event) => {
      const id = event.features?.[0]?.properties?.id
      if (id) {
        setSelectedBuoyId(null)
        setSelectedObservationId(String(id))
      }
    })
    map.on('mouseenter', SURFACE_DOT_ID, () => { map.getCanvas().style.cursor = 'pointer' })
    map.on('mouseleave', SURFACE_DOT_ID, () => { map.getCanvas().style.cursor = '' })
    map.on('click', BUOY_DOT_ID, (event) => {
      const id = event.features?.[0]?.properties?.id
      if (id) {
        setSelectedObservationId(null)
        setSelectedBuoyId(String(id))
      }
    })
    map.on('mouseenter', BUOY_DOT_ID, () => { map.getCanvas().style.cursor = 'pointer' })
    map.on('mouseleave', BUOY_DOT_ID, () => { map.getCanvas().style.cursor = '' })
    map.on('error', (event) => {
      if (event.error?.message && !event.error.message.toLowerCase().includes('tile')) setMapError(event.error.message)
    })
    const resizeObserver = new ResizeObserver(() => map.resize())
    resizeObserver.observe(mapContainer.current)
    mapRef.current = map
    return () => {
      resizeObserver.disconnect()
      map.remove()
      mapRef.current = null
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    const source = map.getSource(RADAR_SOURCE_ID) as maplibregl.ImageSource | undefined
    if (activeFrame && !source) {
      const bounds = activeFrame.bounds
      map.addSource(RADAR_SOURCE_ID, {
        type: 'image',
        url: frameUrl(activeFrame, manifestPath),
        coordinates: [[bounds[0], bounds[3]], [bounds[2], bounds[3]], [bounds[2], bounds[1]], [bounds[0], bounds[1]]],
      })
      map.addLayer({
        id: RADAR_LAYER_ID,
        type: 'raster',
        source: RADAR_SOURCE_ID,
        paint: { 'raster-opacity': radarOpacity, 'raster-fade-duration': 0, 'raster-resampling': 'nearest' },
      }, map.getLayer('wallcloud-state-fill') ? 'wallcloud-state-fill' : undefined)
    } else if (source && activeFrame) {
      const bounds = activeFrame.bounds
      source.updateImage({
        url: frameUrl(activeFrame, manifestPath),
        coordinates: [[bounds[0], bounds[3]], [bounds[2], bounds[3]], [bounds[2], bounds[1]], [bounds[0], bounds[1]]],
      })
    }
  }, [activeFrame, manifestPath, mapReady, radarOpacity])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    ANALYSIS_LAYER_DEFINITIONS.forEach((definition) => {
      const frame = productFrames(manifest, definition.productId).at(-1)
      if (!frame) return
      const sourceId = analysisSourceId(definition.productId)
      const layerId = analysisLayerId(definition.productId)
      const coordinates = imageCoordinates(frame.bounds)
      const source = map.getSource(sourceId) as maplibregl.ImageSource | undefined
      if (!source) {
        map.addSource(sourceId, {
          type: 'image',
          url: frameUrl(frame, manifestPath),
          coordinates,
        })
        map.addLayer({
          id: layerId,
          type: 'raster',
          source: sourceId,
          paint: { 'raster-opacity': radarOpacity, 'raster-fade-duration': 0, 'raster-resampling': 'nearest' },
        }, map.getLayer('wallcloud-state-fill') ? 'wallcloud-state-fill' : undefined)
      } else {
        source.updateImage({ url: frameUrl(frame, manifestPath), coordinates })
      }
    })
  }, [manifest, manifestPath, mapReady, radarOpacity])

  useEffect(() => {
    if (!activeFrame) return
    const preload = playbackFps >= 20
      ? frames
      : frames.slice(Math.max(0, activeIndex - 2), Math.min(frames.length, activeIndex + 3))
    preload.forEach((frame) => {
      const image = new Image()
      image.decoding = 'async'
      image.src = frameUrl(frame, manifestPath)
    })
  }, [activeFrame, activeIndex, frames, manifestPath, playbackFps])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    if (map.getLayer(RADAR_LAYER_ID)) map.setPaintProperty(RADAR_LAYER_ID, 'raster-opacity', radarOpacity)
    ANALYSIS_LAYER_DEFINITIONS.forEach((definition) => {
      const layerId = analysisLayerId(definition.productId)
      if (map.getLayer(layerId)) map.setPaintProperty(layerId, 'raster-opacity', radarOpacity)
    })
    setLayerVisibility(map, [RADAR_LAYER_ID], layers.radar && Boolean(activeFrame))
    setLayerVisibility(map, ['wallcloud-county-line'], layers.counties)
    setLayerVisibility(map, ['wallcloud-city-dot', 'wallcloud-city-label', CITY_LABEL_EXCEPTION_ID], layers.cities)
    setLayerVisibility(map, ['wallcloud-highway-line', 'wallcloud-highway-label'], layers.highways)
    setLayerVisibility(map, [WARNING_FILL_ID, WARNING_CASING_ID, WARNING_LINE_ID], layers.warnings && !isHistorical)
    setLayerVisibility(map, [SURFACE_DOT_ID, SURFACE_LABEL_ID], layers.surface && !isHistorical)
    setLayerVisibility(map, [BUOY_DOT_ID, BUOY_LABEL_ID], layers.buoys && !isHistorical)
    ANALYSIS_LAYER_DEFINITIONS.forEach((definition) => {
      const frame = productFrames(manifest, definition.productId).at(-1)
      setLayerVisibility(map, [analysisLayerId(definition.productId)], layers[definition.key] && !isHistorical && Boolean(frame))
    })
  }, [activeFrame, isHistorical, layers, manifest, mapReady, radarOpacity])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    const stateSource = map.getSource(STATE_SOURCE_ID) as maplibregl.GeoJSONSource | undefined
    const countySource = map.getSource(COUNTY_SOURCE_ID) as maplibregl.GeoJSONSource | undefined
    const highwaySource = map.getSource(HIGHWAY_SOURCE_ID) as maplibregl.GeoJSONSource | undefined
    const citySource = map.getSource(CITY_SOURCE_ID) as maplibregl.GeoJSONSource | undefined
    const surfaceSource = map.getSource(SURFACE_SOURCE_ID) as maplibregl.GeoJSONSource | undefined
    const buoySource = map.getSource(BUOY_SOURCE_ID) as maplibregl.GeoJSONSource | undefined
    const warningSource = map.getSource(WARNING_SOURCE_ID) as maplibregl.GeoJSONSource | undefined
    stateSource?.setData(states)
    countySource?.setData(counties)
    highwaySource?.setData(highways)
    citySource?.setData(CITIES_GEOJSON)
    surfaceSource?.setData(surfaceFeatureCollection(surfaceObservations))
    buoySource?.setData(buoyFeatureCollection(buoys))
    warningSource?.setData(warningsFeatureCollection(warnings))
    if (map.getLayer(WARNING_FILL_ID)) {
      map.setPaintProperty(WARNING_FILL_ID, 'fill-opacity', ['case', ['==', ['get', 'id'], selectedWarningId ?? '__none__'], 0.34, 0.22])
    }
    if (map.getLayer(WARNING_CASING_ID)) {
      map.setPaintProperty(WARNING_CASING_ID, 'line-width', ['case', ['==', ['get', 'id'], selectedWarningId ?? '__none__'], 7.2, 5.6])
    }
    if (map.getLayer(WARNING_LINE_ID)) {
      map.setPaintProperty(WARNING_LINE_ID, 'line-width', ['case', ['==', ['get', 'id'], selectedWarningId ?? '__none__'], 4.2, 2.7])
    }
  }, [buoys, counties, highways, mapReady, selectedWarningId, states, surfaceObservations, warnings])

  const selectedProduct = manifest?.products[productId]
  const dataUnavailable = !manifest || manifest.status !== 'ready' || !activeFrame
  const dataStale = !isHistorical && latestAge !== null && latestAge > 15
  const loopDownloadUrl = selectedProduct?.loop_url ? assetUrl(selectedProduct.loop_url, manifestPath) : null

  const exportGif = async () => {
    const map = mapRef.current
    if (gifExporting || !map || !frames.length) return
    const originalIndex = activeIndex
    const originalFrame = activeFrame
    const wasPlaying = playing
    let usedMapCanvasFallback = false
    setGifExporting(true)
    setGifExportProgress(0)
    setGifExportError(null)
    setPlaying(false)
    try {
      await Promise.all(frames.map((frame) => loadBrowserImage(frameUrl(frame, manifestPath))))
      const captured: ImageData[] = []
      const loopPeriod = formatShareLoopPeriod(frames[0]?.valid_time, frames.at(-1)?.valid_time)
      const exportWarnings = layers.warnings && !isHistorical ? warningsFeatureCollection(warnings) : EMPTY_STATE
      for (let index = 0; index < frames.length; index += 1) {
        const frame = frames[index]
        let mapImage: ImageData
        try {
          // Build the export from the source raster and local vector layers. A
          // WebGL canvas can omit label/boundary layers depending on tile and
          // preserveDrawingBuffer timing, so it is not a reliable share image.
          mapImage = await captureExportMap(
            map,
            frame,
            manifestPath,
            states,
            counties,
            layers.counties,
            layers.cities,
            highways,
            layers.highways,
            exportWarnings,
            layers.warnings && !isHistorical,
          )
        } catch {
          // Keep a last-resort browser capture for transient source failures;
          // the normal path above is the deterministic labeled export path.
          usedMapCanvasFallback = true
          updateRadarMapImage(map, frame, manifestPath)
          await waitForMapPaint(map)
          const mapCapture = captureMapCanvas(map)
          if (!hasVisibleMapCapture(mapCapture)) throw new Error('Unable to render a shareable radar frame')
          mapImage = mapCapture
        }
        captured.push(composeShareFrame(mapImage, frame, productId, isHistorical, playbackFps, index, frames.length, loopPeriod))
        setGifExportProgress(Math.round((index + 1) / frames.length * 100))
      }
      const blob = encodeGif(captured, playbackFps)
      const zoom = Math.round(map.getZoom() * 10) / 10
      const safeDataset = (manifest?.dataset_id ?? 'live').replace(/[^a-z0-9-]+/gi, '-')
      const safeProduct = productId.replace(/[^a-z0-9-]+/gi, '-')
      const filename = `wall-cloud-${safeDataset}-${safeProduct}-share-z${zoom.toFixed(1).replace('.', 'p')}-${playbackFps}fps.gif`
      const downloadUrl = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = downloadUrl
      anchor.download = filename
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 2_000)
      if (usedMapCanvasFallback) setGifExportError('GIF saved with the browser map base because the deterministic export base was temporarily unavailable.')
    } catch (error: unknown) {
      setGifExportError(error instanceof Error ? error.message : 'GIF export failed')
    } finally {
      try {
        if (originalFrame && map.getSource(RADAR_SOURCE_ID)) updateRadarMapImage(map, originalFrame, manifestPath)
      } catch {
        // The map can still be loading while a fallback GIF is being exported.
      }
      setFrameIndex(originalIndex)
      setPlaying(wasPlaying)
      setGifExporting(false)
    }
  }

  const toggleLayer = (key: keyof typeof layers) => {
    setLayers((current) => ({ ...current, [key]: !current[key] }))
  }

  return (
    <div className="radar-app" data-build-sha={BUILD_SHA}>
      <header className="radar-header">
        <div className="radar-brand-lockup">
          <span className="radar-mark" aria-hidden="true"><i /><i /><i /></span>
          <div>
            <div className="radar-product-name">wall.cloud Radar</div>
            <div className="radar-region-name">North Carolina <span>/ {isHistorical ? `${sourceLabel} archive` : isKrax ? 'KRAX single-site' : 'regional view'}</span></div>
          </div>
        </div>
        <div className="radar-header-status">
          <div className={`radar-freshness ${freshnessLabel === 'LIVE' ? 'live' : freshnessLabel === 'HISTORICAL' ? 'historical' : freshnessLabel === 'DATA UNAVAILABLE' ? 'unavailable' : ''}`}>
            <span className="radar-status-dot" /> {freshnessLabel}
          </div>
          <div className="radar-valid-time">{formatEasternTime(activeFrame?.valid_time)} ET</div>
        </div>
        <div className="radar-header-actions">
          <span className="radar-dedication">
            <strong>Dedicated to Jack Roney</strong>
            <span>7.29.86–7.5.26</span>
          </span>
          <span className="radar-warning-count">{isHistorical ? manifest?.label ?? 'Historical loop' : `${warnings.length} active warning${warnings.length === 1 ? '' : 's'}`}</span>
          <button type="button" className="radar-settings-button" onClick={() => setSettingsOpen((open) => !open)} aria-expanded={settingsOpen}>
            <span className="radar-sliders-icon" aria-hidden="true">☷</span> Layers
          </button>
        </div>
      </header>

      <main className="radar-map-area">
        <div ref={mapContainer} className="radar-map" aria-label="Interactive North Carolina radar map" />

        <div className="radar-map-badge">
          <span>{sourceLabel} {isHistorical ? 'archive' : 'live'}</span>
          <span className="radar-badge-divider" />
          <span>{selectedProduct?.label ?? 'Composite Reflectivity'}</span>
        </div>

        {(manifestError || sourceFallbackNotice || mapError) && (
          <div className="radar-data-strip degraded" role="status">
            <strong>{sourceFallbackNotice ? 'Source fallback' : 'Map data issue'}</strong>
            <span>{manifestError ?? sourceFallbackNotice ?? mapError}</span>
          </div>
        )}

        {dataStale && !manifestError && !mapError && (
          <div className="radar-data-strip stale" role="status">
            <strong>Stale radar</strong>
            <span>Latest generated observation is {latestAge} min old.</span>
          </div>
        )}

        {dataUnavailable && (
          <div className="radar-unavailable" role="status">
            <div className="radar-unavailable-icon">◎</div>
            <strong>Radar imagery unavailable</strong>
            <span>{isHistorical ? 'That historical pack has no usable radar frames.' : `The map is ready. Run the ${isKrax ? 'KRAX Level II' : 'MRMS'} processor or wait for the next generated data artifact.`}</span>
            {manifest?.errors?.[0] && <small>{manifest.errors[0]}</small>}
          </div>
        )}

        {geographyError && <div className="radar-data-strip geography-warning">Boundary data unavailable · radar remains available</div>}

        {layers.radar && <RadarLegend productId={productId} />}
        <RadarAnalysisLegends
          layers={layers}
          manifest={manifest}
          isHistorical={isHistorical}
        />

        <aside className={`radar-settings ${settingsOpen ? 'open' : ''}`} aria-label="Radar controls and layers">
          <div className="radar-settings-head">
            <div>
              <span className="radar-panel-kicker">Display</span>
              <h2>Layers & product</h2>
            </div>
            <button type="button" className="radar-icon-button radar-mobile-close" onClick={() => setSettingsOpen(false)} aria-label="Close layers panel">×</button>
          </div>

          <label className="radar-field-label" htmlFor="radar-source">Radar source</label>
          <div className="radar-select-wrap">
            <select
              id="radar-source"
              className="radar-select"
              value={sourceId}
              onChange={(event) => {
                const nextSource = event.target.value as RadarSourceId
                setSourceId(nextSource)
                setSourceFallbackNotice(null)
                setDatasetId('live')
                setProductId(nextSource === 'krax' ? DEFAULT_RADAR_PRODUCT : 'MergedReflectivityQCComposite')
                setFrameIndex(0)
                setPlaying(false)
                setSelectedWarningId(null)
                setLayers((current) => ({
                  ...current,
                  warnings: true,
                  rainfall: false,
                  shearLow: false,
                  shearMid: false,
                  rotation: false,
                  hailMesh: false,
                  hailPosh: false,
                  lightning: false,
                }))
              }}
            >
              <option value="mrms">MRMS regional mosaic</option>
              <option value="krax">KRAX Level II</option>
            </select>
          </div>

          <label className="radar-field-label" htmlFor="radar-dataset">Loop source</label>
          <div className="radar-select-wrap">
            <select
              id="radar-dataset"
              className="radar-select"
              value={datasetId}
              onChange={(event) => {
                const nextDatasetId = event.target.value
                setDatasetId(nextDatasetId)
                setSourceFallbackNotice(null)
                setLayers((current) => ({ ...current, warnings: nextDatasetId === 'live' }))
                setSelectedWarningId(null)
                setProductId(isKrax ? 'NEXRADLevel2BaseReflectivity' : 'MergedReflectivityQCComposite')
                setPlaying(false)
              }}
            >
              <option value="live">Live / recent {sourceLabel}</option>
              {(historyCatalog?.datasets.length ?? 0) > 0 && (
                <optgroup label="Historical loops">
                  {historyCatalog?.datasets.map((dataset) => (
                    <option key={dataset.id} value={dataset.id}>{dataset.label}</option>
                  ))}
                </optgroup>
              )}
            </select>
          </div>
          {!historyCatalog?.datasets.length && <p className="radar-field-note">No {sourceLabel} historical packs are generated yet. Use the historical Python command or GitHub workflow documented in the README.</p>}
          {historyError && <p className="radar-field-note error">Historical catalog unavailable: {historyError}</p>}

          <label className="radar-field-label" htmlFor="radar-product">Product</label>
          <div className="radar-select-wrap">
            <select
              id="radar-product"
              className="radar-select"
              value={productId}
              onChange={(event) => {
                const nextProduct = event.target.value as RadarProductId
                setProductId(nextProduct)
                setFrameIndex(Math.max(productFrames(manifest, nextProduct).length - 1, 0))
                setPlaying(false)
              }}
            >
              {PRODUCT_OPTIONS.filter((option) => option.source === sourceId).map((option) => {
                const status = manifest?.products[option.id]?.status
                const ready = option.id === 'MergedReflectivityQCComposite' || status === 'ready' || status === 'partial'
                return <option key={option.id} value={option.id} disabled={!ready}>{option.label}{ready ? '' : ' · processor needed'}</option>
              })}
            </select>
          </div>
          {productId === 'PrecipFlag' && <p className="radar-field-note">MRMS flag classes are shown only where the official PrecipFlag product decodes successfully.</p>}
          {productId === 'MultiSensor_QPE_01H_Pass1' && <p className="radar-field-note">MRMS one-hour quantitative precipitation estimate in millimeters.</p>}
          {productId === 'NEXRADLevel2BaseReflectivity' && <p className="radar-field-note">Native KRAX Level II reflectivity from the lowest available elevation sweep. Coverage and beam height vary with range from the radar.</p>}

          <div className="radar-layer-list">
            <div className="radar-layer-section-heading">Storm analysis <small>latest generated analysis</small></div>
            {ANALYSIS_LAYER_DEFINITIONS.filter((definition) => definition.key !== 'rainfall').map((definition) => {
              const product = manifest?.products[definition.productId]
              const ready = product?.status === 'ready' || product?.status === 'partial'
              const note = isHistorical
                ? 'Unavailable during historical playback'
                : ready
                  ? definition.note
                  : product?.notes ?? 'Processor needed'
              return (
                <label key={definition.key} className="radar-layer-row">
                  <input type="checkbox" checked={layers[definition.key]} onChange={() => toggleLayer(definition.key)} disabled={isHistorical || !ready} />
                  <span className="radar-checkbox" aria-hidden="true" />
                  <span><strong>{definition.label}</strong><small>{note}</small></span>
                </label>
              )
            })}

            <div className="radar-layer-section-heading">Observations <small>click a marker for details</small></div>
            <label className="radar-layer-row">
              <input type="checkbox" checked={layers.surface} onChange={() => toggleLayer('surface')} disabled={isHistorical} />
              <span className="radar-checkbox" aria-hidden="true" />
              <span><strong>Surface observations</strong><small>{isHistorical ? 'Unavailable during historical playback' : surfaceLoading ? 'Loading NWS stations…' : surfaceError ? 'NWS refresh degraded' : `${surfaceObservations.length || 'No'} stations · refreshes independently`}</small></span>
            </label>
            <label className="radar-layer-row">
              <input type="checkbox" checked={layers.buoys} onChange={() => toggleLayer('buoys')} disabled={isHistorical} />
              <span className="radar-checkbox" aria-hidden="true" />
              <span><strong>Buoys</strong><small>{isHistorical ? 'Unavailable during historical playback' : buoyError ?? `${buoys.length || 'No'} NOAA NDBC stations`}</small></span>
            </label>

            <div className="radar-layer-section-heading">Map overlays</div>
            {([
              ['radar', 'Radar', `${sourceLabel} observed raster frame`],
              ['warnings', 'Warnings', isHistorical ? 'Unavailable for historical playback' : warningStatus === 'degraded' ? 'NWS refresh degraded' : 'NWS active polygons'],
              ['counties', 'Counties', 'Census boundary overlay'],
              ['cities', 'Cities', 'Priority NC locations'],
              ['highways', 'Highways', highwaysLoading ? 'Loading on demand…' : 'Census interstate overlay'],
            ] as Array<[keyof typeof layers, string, string]>).map(([key, label, note]) => (
              <label key={key} className="radar-layer-row">
                <input type="checkbox" checked={layers[key]} onChange={() => toggleLayer(key)} disabled={key === 'warnings' && isHistorical} />
                <span className="radar-checkbox" aria-hidden="true" />
                <span><strong>{label}</strong><small>{note}</small></span>
              </label>
            ))}
          </div>

          <label className="radar-field-label" htmlFor="radar-opacity">Radar & storm opacity <output>{Math.round(radarOpacity * 100)}%</output></label>
          <input id="radar-opacity" className="radar-range" type="range" min="0.2" max="1" step="0.05" value={radarOpacity} onChange={(event) => setRadarOpacity(Number(event.target.value))} />
          {highwaysError && <p className="radar-field-note error">Highway overlay unavailable: {highwaysError}</p>}
          {warningErrors.length > 0 && <p className="radar-field-note error">NWS: showing the last successful regional result where available.</p>}
          {surfaceError && <p className="radar-field-note error">Surface observations: {surfaceError}</p>}
          {buoyError && <p className="radar-field-note error">Buoys: {buoyError}</p>}
          <p className="radar-source-note">Radar: {isKrax ? 'NOAA NEXRAD Level II via the Unidata public archive' : 'NOAA/NCEP MRMS'} · alerts: National Weather Service · boundaries: U.S. Census TIGERweb</p>
        </aside>

        {freshWarningPanel(selectedWarning, () => setSelectedWarningId(null))}
        <RadarObservationPanel
          observation={selectedObservation}
          buoy={selectedBuoy}
          onClose={() => {
            setSelectedObservationId(null)
            setSelectedBuoyId(null)
          }}
        />

        <section className="radar-timeline" aria-label="Radar animation controls">
          <div className="radar-timeline-top">
            <div>
              <span className="radar-panel-kicker">Timeline</span>
              <strong>{activeFrame ? formatEasternDateTime(activeFrame.valid_time) : 'No frame selected'}</strong>
            </div>
            <span className="radar-frame-count">{frames.length ? `${activeIndex + 1} / ${frames.length}` : '0 frames'}</span>
          </div>
          <input
            className="radar-timeline-range"
            type="range"
            min="0"
            max={Math.max(frames.length - 1, 0)}
            step="1"
            value={activeIndex}
            disabled={frames.length < 2}
            onChange={(event) => {
              setPlaying(false)
              setFrameIndex(Number(event.target.value))
            }}
            aria-label="Radar frame timeline"
          />
          <div className="radar-timeline-endpoints"><span>{formatEasternTime(frames[0]?.valid_time)} ET</span><span>{latestFrame ? `${formatEasternTime(latestFrame.valid_time)} ET · ${isHistorical ? 'end' : 'latest'}` : 'Latest unavailable'}</span></div>
          <div className="radar-control-row" data-playback-mode="observed" data-playback-fps={playbackFps}>
            <div className="radar-transport-control">
              <button type="button" onClick={() => { setPlaying(false); setFrameIndex((index) => Math.max(0, index - 1)) }} disabled={!frames.length || activeIndex === 0}>‹ <span>Previous</span></button>
              <button type="button" className="radar-play-button" onClick={() => setPlaying((value) => !value)} disabled={frames.length < 2}>{playing ? '❚❚ Pause' : '▶ Play'}</button>
              <button type="button" onClick={() => { setPlaying(false); setFrameIndex((index) => Math.min(frames.length - 1, index + 1)) }} disabled={!frames.length || activeIndex === frames.length - 1}><span>Next</span> ›</button>
            </div>
            <div className="radar-playback-options">
              <span className="radar-observed-badge" title={`Playback displays exact observed ${sourceLabel} frames`}>Observed</span>
              <span className="radar-fps-label">FPS</span>
              <div className="radar-speed-control" role="group" aria-label="Playback rate in frames per second">
                {PLAYBACK_FPS_OPTIONS.map((value) => <button key={value} type="button" className={playbackFps === value ? 'active' : ''} aria-pressed={playbackFps === value} aria-label={`${value} frames per second`} onClick={() => setPlaybackFps(value)}>{value}</button>)}
              </div>
              <button type="button" className="radar-download-button" onClick={() => { void exportGif() }} disabled={gifExporting || !frames.length} title="Save a share-ready GIF using the current map view and playback FPS">
                {gifExporting ? `GIF ${gifExportProgress}%` : 'Save GIF'}
              </button>
              {loopDownloadUrl ? (
                <a className="radar-static-download" href={loopDownloadUrl} download={`wall-cloud-${manifest?.dataset_id ?? 'live'}-${productId}-branded.gif`} title="Download the pre-rendered reference-style NC loop">Branded loop</a>
              ) : null}
            </div>
          </div>
          <div className="radar-playback-note" aria-live="polite" aria-hidden={!gifExportError && !(activeAge !== null && !isLatest && !isHistorical)}>
            {gifExportError ?? (activeAge !== null && !isLatest && !isHistorical
              ? `Playback frame · latest observation is ${Math.max(0, latestAge ?? 0)} min old`
              : '\u00a0')}
          </div>
        </section>
      </main>
    </div>
  )
}
