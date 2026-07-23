import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { ANALYSIS_LAYER_DEFINITIONS, CARTO_LIGHT_TILES, CITIES, CITIES_GEOJSON, GRID_GEOJSON, INITIAL_VIEW_BOUNDS, MAP_CENTER, PRECIP_LEGEND, PRODUCT_OPTIONS, RAINFALL_LEGEND, REFLECTIVITY_LEGEND, REGIONAL_BOUNDS, type AnalysisLayerKey } from './config'
import { emptyFeatureCollection, fetchBuoyObservations, fetchHistoryCatalog, fetchRadarManifest, fetchRegionalGeography, fetchRegionalHighways, fetchRegionalSurfaceObservations, fetchRegionalWarnings, warningsFeatureCollection } from './data'
import { encodeGif, GIF_HEIGHT_LIMIT, GIF_WIDTH_LIMIT, LATEST_FRAME_HOLD_MS } from './gif'
import type { BuoyObservation, RadarFrameManifest, RadarHistoryCatalog, RadarManifest, RadarManifestProductId, RadarProductId, RadarWarning, SurfaceObservation } from './types'
import './radar.css'

const LIVE_MANIFEST_PATH = `${import.meta.env.BASE_URL}data/radar/manifest.json`
const HISTORY_CATALOG_PATH = `${import.meta.env.BASE_URL}data/radar/history/catalog.json`
const BUOY_DATA_PATH = `${import.meta.env.BASE_URL}data/observations/buoys.json`
const RADAR_SOURCE_ID = 'wallcloud-radar-image'
const RADAR_LAYER_ID = 'wallcloud-radar-layer'
const WARNING_SOURCE_ID = 'wallcloud-warning-source'
const WARNING_FILL_ID = 'wallcloud-warning-fill'
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

const EMPTY_STATE = emptyFeatureCollection()
const PLAYBACK_FPS_OPTIONS = [2, 4, 8, 20, 30] as const

type PlaybackFps = typeof PLAYBACK_FPS_OPTIONS[number]

function assetUrl(path: string, manifestPath: string): string {
  const manifestUrl = new URL(manifestPath, window.location.href)
  return new URL(path, manifestUrl).toString()
}

function frameUrl(frame: RadarFrameManifest, manifestPath: string): string {
  const manifestUrl = new URL(manifestPath, window.location.href)
  return new URL(frame.url, manifestUrl).toString()
}

function historicalManifestUrl(manifestUrl: string): string {
  const catalogUrl = new URL(HISTORY_CATALOG_PATH, window.location.href)
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
      'fill-opacity': ['case', ['==', ['get', 'id'], '__none__'], 0.12, 0.14],
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
      'line-width': 1.8,
      'line-opacity': 0.88,
    },
  })
}

function setLayerVisibility(map: maplibregl.Map, ids: string[], visible: boolean): void {
  ids.forEach((id) => {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none')
  })
}

function productFrames(manifest: RadarManifest | null, productId: RadarManifestProductId): RadarFrameManifest[] {
  return manifest?.products[productId]?.frames ?? (productId === 'MergedReflectivityQCComposite' ? manifest?.frames ?? [] : [])
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

function drawExportCityLabels(context: CanvasRenderingContext2D, bounds: ExportBounds, width: number, height: number): void {
  const used: Array<{ left: number; top: number; right: number; bottom: number }> = []
  context.save()
  context.font = '700 11px Arial, sans-serif'
  context.textBaseline = 'top'
  CITIES.filter((city) => city.primary).forEach((city) => {
    if (city.lon < bounds[0] || city.lon > bounds[2] || city.lat < bounds[1] || city.lat > bounds[3]) return
    const [x, y] = exportProject(city.lon, city.lat, bounds, width, height)
    const labelWidth = context.measureText(city.label).width
    const labelHeight = 13
    const candidates = [[5, -labelHeight - 3], [5, 5], [-labelWidth - 5, -labelHeight - 3], [-labelWidth - 5, 5]]
    context.fillStyle = '#172129'
    context.beginPath()
    context.arc(x, y, 3, 0, Math.PI * 2)
    context.fill()
    context.strokeStyle = '#ffffff'
    context.lineWidth = 1.2
    context.stroke()
    for (const [offsetX, offsetY] of candidates) {
      const box = { left: x + offsetX, top: y + offsetY, right: x + offsetX + labelWidth, bottom: y + offsetY + labelHeight }
      if (box.left < 2 || box.top < 2 || box.right >= width - 2 || box.bottom >= height - 2) continue
      if (used.some((other) => box.left - 3 < other.right && box.right + 3 > other.left && box.top - 3 < other.bottom && box.bottom + 3 > other.top)) continue
      context.lineWidth = 3
      context.strokeStyle = '#ffffff'
      context.strokeText(city.label, x + offsetX, y + offsetY)
      context.fillStyle = '#172129'
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

async function captureRadarFallback(
  map: maplibregl.Map,
  frame: RadarFrameManifest,
  manifestPath: string,
  states: GeoJSON.FeatureCollection,
  counties: GeoJSON.FeatureCollection,
  includeCounties: boolean,
  includeCities: boolean,
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
  drawExportGeometry(context, states, viewBounds, width, height, 'rgba(32,42,49,.9)', 1.4)
  if (includeCities) drawExportCityLabels(context, viewBounds, width, height)
  return context.getImageData(0, 0, width, height)
}

const SHARE_GIF_WIDTH = 720
const SHARE_GIF_MAP_HEIGHT = 480
const SHARE_GIF_HEADER_HEIGHT = 48
const SHARE_GIF_FOOTER_HEIGHT = 78

function shareProductDetails(productId: RadarProductId): { label: string; unit: string; legend: Array<{ label: string; color: string }> } {
  if (productId === 'PrecipFlag') return { label: 'Precipitation Type', unit: 'TYPE', legend: PRECIP_LEGEND }
  if (productId === 'MultiSensor_QPE_01H_Pass1') return { label: '1-hour Rainfall', unit: 'mm', legend: RAINFALL_LEGEND }
  return { label: 'Composite Reflectivity', unit: 'dBZ', legend: REFLECTIVITY_LEGEND }
}

function formatShareValidTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'VALID TIME UNKNOWN'
  const eastern = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(date)
  const zulu = new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date).replace(':', '')
  return `${eastern} ET · ${zulu}Z`
}

function composeShareFrame(
  mapImage: ImageData,
  frame: RadarFrameManifest,
  productId: RadarProductId,
  isHistorical: boolean,
  playbackFps: number,
  frameNumber: number,
  frameCount: number,
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
  context.fillStyle = '#f7fafb'
  context.fillRect(0, 0, output.width, SHARE_GIF_HEADER_HEIGHT)
  context.fillStyle = '#0b6e72'
  context.fillRect(0, SHARE_GIF_HEADER_HEIGHT - 3, output.width, 3)
  context.fillStyle = '#10252e'
  context.font = '800 15px Arial, sans-serif'
  context.fill…6753 tokens truncated…ud-highway-line', 'wallcloud-highway-label'], layers.highways)
    setLayerVisibility(map, [WARNING_FILL_ID, WARNING_LINE_ID], layers.warnings && !isHistorical)
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
      map.setPaintProperty(WARNING_FILL_ID, 'fill-opacity', ['case', ['==', ['get', 'id'], selectedWarningId ?? '__none__'], 0.25, 0.13])
    }
    if (map.getLayer(WARNING_LINE_ID)) {
      map.setPaintProperty(WARNING_LINE_ID, 'line-width', ['case', ['==', ['get', 'id'], selectedWarningId ?? '__none__'], 3.4, 1.8])
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
    let usedLocalBaseFallback = false
    setGifExporting(true)
    setGifExportProgress(0)
    setGifExportError(null)
    setPlaying(false)
    try {
      await Promise.all(frames.map((frame) => loadBrowserImage(frameUrl(frame, manifestPath))))
      const captured: ImageData[] = []
      for (let index = 0; index < frames.length; index += 1) {
        const frame = frames[index]
        const radarSourceReady = Boolean(map.getSource(RADAR_SOURCE_ID))
        let mapImage: ImageData
        try {
          if (!radarSourceReady) throw new Error('Radar image source is not ready')
          updateRadarMapImage(map, frame, manifestPath)
          await waitForMapPaint(map)
          const mapCapture = captureMapCanvas(map)
          if (!hasVisibleMapCapture(mapCapture)) throw new Error('Map canvas did not contain rendered pixels')
          mapImage = mapCapture
        } catch {
          usedLocalBaseFallback = true
          mapImage = await captureRadarFallback(map, frame, manifestPath, states, counties, layers.counties, layers.cities)
        }
        captured.push(composeShareFrame(mapImage, frame, productId, isHistorical, playbackFps, index, frames.length))
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
      if (usedLocalBaseFallback) setGifExportError('GIF saved with the local radar and geography base; external map tiles could not be included.')
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
    if (key === 'highways' && !layers.highways) setHighwaysLoading(true)
    setLayers((current) => ({ ...current, [key]: !current[key] }))
  }

  return (
    <div className="radar-app">
      <header className="radar-header">
        <div className="radar-brand-lockup">
          <span className="radar-mark" aria-hidden="true"><i /><i /><i /></span>
          <div>
            <div className="radar-product-name">Wall Cloud Radar</div>
            <div className="radar-region-name">North Carolina <span>/ {isHistorical ? 'archive loop' : 'regional view'}</span></div>
          </div>
        </div>
        <div className="radar-header-status">
          <div className={`radar-freshness ${freshnessLabel === 'LIVE' ? 'live' : freshnessLabel === 'HISTORICAL' ? 'historical' : freshnessLabel === 'DATA UNAVAILABLE' ? 'unavailable' : ''}`}>
            <span className="radar-status-dot" /> {freshnessLabel}
          </div>
          <div className="radar-valid-time">{formatEasternTime(activeFrame?.valid_time)} ET</div>
        </div>
        <div className="radar-header-actions">
          <span className="radar-warning-count">{isHistorical ? manifest?.label ?? 'Historical loop' : `${warnings.length} active warning${warnings.length === 1 ? '' : 's'}`}</span>
          <button type="button" className="radar-settings-button" onClick={() => setSettingsOpen((open) => !open)} aria-expanded={settingsOpen}>
            <span className="radar-sliders-icon" aria-hidden="true">☷</span> Layers
          </button>
        </div>
      </header>

      <main className="radar-map-area">
        <div ref={mapContainer} className="radar-map" aria-label="Interactive North Carolina radar map" />

        <div className="radar-map-badge">
          <span>{isHistorical ? 'MRMS archive' : 'MRMS live'}</span>
          <span className="radar-badge-divider" />
          <span>{selectedProduct?.label ?? 'Composite Reflectivity'}</span>
        </div>

        {(manifestError || mapError) && (
          <div className="radar-data-strip degraded" role="status">
            <strong>Map data issue</strong>
            <span>{manifestError ?? mapError}</span>
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
            <span>{isHistorical ? 'That historical pack has no usable radar frames.' : 'The map is ready. Run the MRMS processor or wait for the next generated data artifact.'}</span>
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

          <label className="radar-field-label" htmlFor="radar-dataset">Loop source</label>
          <select
            id="radar-dataset"
            className="radar-select"
            value={datasetId}
            onChange={(event) => {
              const nextDatasetId = event.target.value
              setDatasetId(nextDatasetId)
              setLayers((current) => ({ ...current, warnings: nextDatasetId === 'live' }))
              setSelectedWarningId(null)
              setProductId('MergedReflectivityQCComposite')
              setPlaying(false)
            }}
          >
            <option value="live">Live / recent radar</option>
            {(historyCatalog?.datasets.length ?? 0) > 0 && (
              <optgroup label="Historical loops">
                {historyCatalog?.datasets.map((dataset) => (
                  <option key={dataset.id} value={dataset.id}>{dataset.label}</option>
                ))}
              </optgroup>
            )}
          </select>
          {!historyCatalog?.datasets.length && <p className="radar-field-note">No historical packs are generated yet. Use the historical Python command documented in the README.</p>}
          {historyError && <p className="radar-field-note error">Historical catalog unavailable: {historyError}</p>}

          <label className="radar-field-label" htmlFor="radar-product">Product</label>
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
            {PRODUCT_OPTIONS.map((option) => {
              const status = manifest?.products[option.id]?.status
              const ready = option.id === 'MergedReflectivityQCComposite' || status === 'ready' || status === 'partial'
              return <option key={option.id} value={option.id} disabled={!ready}>{option.label}{ready ? '' : ' · processor needed'}</option>
            })}
          </select>
          {productId === 'PrecipFlag' && <p className="radar-field-note">MRMS flag classes are shown only where the official PrecipFlag product decodes successfully.</p>}
          {productId === 'MultiSensor_QPE_01H_Pass1' && <p className="radar-field-note">MRMS one-hour quantitative precipitation estimate in millimeters.</p>}

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
              ['radar', 'Radar', 'MRMS observed raster frame'],
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

          <label className="radar-field-label" htmlFor="radar-opacity">Radar opacity <output>{Math.round(radarOpacity * 100)}%</output></label>
          <input id="radar-opacity" className="radar-range" type="range" min="0.2" max="1" step="0.05" value={radarOpacity} onChange={(event) => setRadarOpacity(Number(event.target.value))} />
          {highwaysError && <p className="radar-field-note error">Highway overlay unavailable: {highwaysError}</p>}
          {warningErrors.length > 0 && <p className="radar-field-note error">NWS: showing the last successful regional result where available.</p>}
          {surfaceError && <p className="radar-field-note error">Surface observations: {surfaceError}</p>}
          {buoyError && <p className="radar-field-note error">Buoys: {buoyError}</p>}
          <p className="radar-source-note">Radar: NOAA/NCEP MRMS · alerts: National Weather Service · boundaries: U.S. Census TIGERweb</p>
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
              <span className="radar-observed-badge" title="Playback displays exact observed MRMS frames">Observed</span>
              <span className="radar-fps-label">FPS</span>
              <div className="radar-speed-control" role="group" aria-label="Playback rate in frames per second">
                {PLAYBACK_FPS_OPTIONS.map((value) => <button key={value} type="button" className={playbackFps === value ? 'active' : ''} aria-pressed={playbackFps === value} aria-label={`${value} frames per second`} onClick={() => setPlaybackFps(value)}>{value}</button>)}
              </div>
              <button type="button" className="radar-download-button" onClick={() => { void exportGif() }} disabled={gifExporting || !frames.length} title="Save a share-ready GIF using the current map view and playback FPS">
                {gifExporting ? `GIF ${gifExportProgress}%` : 'Save GIF'}
              </button>
              {loopDownloadUrl ? (
                <a className="radar-static-download" href={loopDownloadUrl} download={`wall-cloud-${manifest?.dataset_id ?? 'live'}-${productId}-branded.gif`} title="Download the pre-rendered branded regional loop">Branded loop</a>
              ) : null}
            </div>
          </div>
          {gifExportError && <div className="radar-playback-note">{gifExportError}</div>}
          {activeAge !== null && !isLatest && !isHistorical && <div className="radar-playback-note">Playback frame · latest observation is {Math.max(0, latestAge ?? 0)} min old</div>}
        </section>
      </main>
    </div>
  )
}

