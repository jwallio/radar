import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import maplibregl from 'maplibre-gl'
import { PMTiles, Protocol } from 'pmtiles'
import 'maplibre-gl/dist/maplibre-gl.css'
import { ANALYSIS_LAYER_DEFINITIONS, CARTO_LIGHT_TILES, CITIES, CITIES_GEOJSON, CORRELATION_LEGEND, DEFAULT_ARCHIVE_REGION_ID, ERA5_PHASE_LEGEND, ERA5_PROCESSING_BOUNDS, ERA5_TOTAL_PRECIPITATION_LEGEND, GRID_GEOJSON, MAP_CENTER, MAP_REGIONS, MAP_VIEW_BOUNDS, MRMS_ARCHIVE_START_INPUT, MRMS_FULL_SUITE_START_INPUT, NATIONAL_BOUNDS, PRECIP_LEGEND, PRODUCT_OPTIONS, RAINFALL_LEGEND, REFLECTIVITY_LEGEND, REGIONAL_BOUNDS, VELOCITY_LEGEND, type AnalysisLayerKey } from './config'
import { emptyFeatureCollection, fetchBuoyObservations, fetchHistoryCatalog, fetchRadarManifest, fetchRegionalGeography, fetchRegionalHighways, fetchRegionalSurfaceObservations, fetchRegionalWarnings, warningsFeatureCollection } from './data'
import { encodeGif, GIF_HEIGHT_LIMIT, GIF_WIDTH_LIMIT, LATEST_FRAME_HOLD_MS } from './gif'
import type { BuoyObservation, RadarFrameManifest, RadarHistoryCatalog, RadarHistoryEntry, RadarManifest, RadarManifestProductId, RadarProductId, RadarSourceId, RadarWarning, SurfaceObservation } from './types'
import './radar.css'

function normalizeDataBaseUrl(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return `${import.meta.env.BASE_URL}data/`
  return `${trimmed.replace(/\/+$/, '')}/`
}

const RADAR_DATA_BASE_URL = normalizeDataBaseUrl(
  import.meta.env.VITE_RADAR_DATA_BASE_URL || `${import.meta.env.BASE_URL}data/`,
)
const LIVE_MANIFEST_PATHS: Record<RadarSourceId, string> = {
  mrms: `${RADAR_DATA_BASE_URL}radar/manifest.json`,
  krax: `${RADAR_DATA_BASE_URL}radar/krax/manifest.json`,
  era5: '',
}
const FOCUS_MANIFEST_PATH = `${RADAR_DATA_BASE_URL}radar/focus/manifest.json`
const HISTORY_CATALOG_PATHS: Record<RadarSourceId, string> = {
  mrms: `${RADAR_DATA_BASE_URL}radar/history/catalog.json`,
  krax: `${RADAR_DATA_BASE_URL}radar/krax/history/catalog.json`,
  era5: `${RADAR_DATA_BASE_URL}radar/history/era5/catalog.json`,
}
const BUOY_DATA_PATH = `${RADAR_DATA_BASE_URL}observations/buoys.json`
// Public endpoint only; the activation token is never bundled into the app.
// Override this with VITE_RADAR_CONTROL_API_URL when a custom Worker domain is ready.
const DEFAULT_RADAR_CONTROL_API_URL = 'https://wallcloud-radar-control.jlwall33.workers.dev'
const RADAR_CONTROL_API_URL = (import.meta.env.VITE_RADAR_CONTROL_API_URL || (import.meta.env.DEV ? '' : DEFAULT_RADAR_CONTROL_API_URL)).trim().replace(/\/+$/, '')
const CONTROL_TOKEN_SESSION_KEY = 'wallcloud-radar-control-token'
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
const ARCHIVE_ONLY = true
const ARCHIVE_DATASET_PLACEHOLDER = 'archive'
const DEFAULT_RADAR_SOURCE: RadarSourceId = 'mrms'
const DEFAULT_RADAR_PRODUCT: RadarProductId = 'MergedReflectivityQCComposite'
const PMTILES_PROTOCOL = new Protocol()
maplibregl.addProtocol('pmtiles', PMTILES_PROTOCOL.tile)

const EMPTY_STATE = emptyFeatureCollection()
const PLAYBACK_FPS_OPTIONS = [2, 4, 8, 20, 30] as const
const MOBILE_GIF_FRAME_LIMIT = 12
const LOW_MEMORY_VIEWPORT_MAX_WIDTH = 820
const MAX_COUNTY_DETAIL_LONGITUDE_SPAN = 24
const MAX_COUNTY_DETAIL_LATITUDE_SPAN = 20

type PlaybackFps = typeof PLAYBACK_FPS_OPTIONS[number]

type PollingControlState = {
  enabled: boolean
  updated_at: string | null
}

type FocusPollingControlState = PollingControlState & {
  expires_at: string | null
  region_id: string | null
  region_label: string | null
  bounds: [number, number, number, number] | null
}

type MrmsLiveCoverage = 'national' | 'focus'

type HistoryJobStatus = {
  job_id: string
  status: 'pending' | 'running' | 'complete' | 'failed'
  stage?: string
  source?: string
  dataset_id?: string
  manifest_url?: string
  message?: string
  execution?: string
}

function initialMapZoom(): number {
  if (window.innerWidth <= 680) return 4.45
  if (window.innerWidth <= 1024) return 4.9
  return 5.25
}

function shouldUseLowMemoryMapMode(): boolean {
  return window.innerWidth <= LOW_MEMORY_VIEWPORT_MAX_WIDTH
    || window.matchMedia('(pointer: coarse)').matches
}

function supportsCountyDetail(regionId: string, bounds: readonly [number, number, number, number]): boolean {
  return regionId !== 'conus'
    && bounds[2] - bounds[0] <= MAX_COUNTY_DETAIL_LONGITUDE_SPAN
    && bounds[3] - bounds[1] <= MAX_COUNTY_DETAIL_LATITUDE_SPAN
}

function assetUrl(path: string, manifestPath: string): string {
  const manifestUrl = new URL(manifestPath, window.location.href)
  return new URL(path, manifestUrl).toString()
}

function frameUrl(frame: RadarFrameManifest, manifestPath: string): string {
  const manifestUrl = new URL(manifestPath, window.location.href)
  return new URL(frame.url, manifestUrl).toString()
}

function framePmtilesUrl(frame: RadarFrameManifest, manifestPath: string): string | null {
  if (!frame.pmtiles_url) return null
  const manifestUrl = new URL(manifestPath, window.location.href)
  return new URL(frame.pmtiles_url, manifestUrl).toString()
}

function longitudeToTileX(longitude: number, zoom: number): number {
  const scale = 2 ** zoom
  return Math.min(scale - 1, Math.max(0, Math.floor(((longitude + 180) / 360) * scale)))
}

function latitudeToTileY(latitude: number, zoom: number): number {
  const scale = 2 ** zoom
  const clamped = Math.min(85.05112878, Math.max(-85.05112878, latitude))
  const radians = clamped * Math.PI / 180
  const value = (1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2
  return Math.min(scale - 1, Math.max(0, Math.floor(value * scale)))
}

async function preloadPmtilesFrame(
  frame: RadarFrameManifest,
  manifestPath: string,
  map: maplibregl.Map,
): Promise<void> {
  const url = framePmtilesUrl(frame, manifestPath)
  if (!url) return
  let archive = PMTILES_PROTOCOL.get(url)
  if (!archive) {
    archive = new PMTiles(url)
    PMTILES_PROTOCOL.add(archive)
  }
  await archive.getHeader()
  const zoom = Math.min(frame.maxzoom ?? 8, Math.max(frame.minzoom ?? 3, Math.floor(map.getZoom())))
  const bounds = map.getBounds()
  const west = Math.max(frame.bounds[0], bounds.getWest())
  const east = Math.min(frame.bounds[2], bounds.getEast())
  const south = Math.max(frame.bounds[1], bounds.getSouth())
  const north = Math.min(frame.bounds[3], bounds.getNorth())
  if (west >= east || south >= north) return
  const minX = longitudeToTileX(west, zoom)
  const maxX = longitudeToTileX(east, zoom)
  const minY = latitudeToTileY(north, zoom)
  const maxY = latitudeToTileY(south, zoom)
  const requests: Array<Promise<unknown>> = []
  for (let x = minX; x <= maxX && requests.length < 64; x += 1) {
    for (let y = minY; y <= maxY && requests.length < 64; y += 1) {
      requests.push(archive.getZxy(zoom, x, y))
    }
  }
  await Promise.allSettled(requests)
}

function historicalManifestUrl(manifestUrl: string, sourceId: RadarSourceId): string {
  const catalogUrl = new URL(HISTORY_CATALOG_PATHS[sourceId], window.location.href)
  return new URL(manifestUrl, catalogUrl).toString()
}

async function fetchPollingControlStatus(): Promise<PollingControlState> {
  const response = await fetch(`${RADAR_CONTROL_API_URL}/control/status`, { cache: 'no-store' })
  const payload = await response.json() as Partial<PollingControlState> & { error?: string }
  if (!response.ok || typeof payload.enabled !== 'boolean') {
    throw new Error(payload.error || `Polling control returned HTTP ${response.status}`)
  }
  return { enabled: payload.enabled, updated_at: typeof payload.updated_at === 'string' ? payload.updated_at : null }
}

async function updatePollingControl(enabled: boolean, token: string): Promise<PollingControlState> {
  const response = await fetch(`${RADAR_CONTROL_API_URL}/control/polling`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  })
  const payload = await response.json() as Partial<PollingControlState> & { error?: string }
  if (!response.ok || typeof payload.enabled !== 'boolean') {
    throw new Error(payload.error || `Polling control returned HTTP ${response.status}`)
  }
  return { enabled: payload.enabled, updated_at: typeof payload.updated_at === 'string' ? payload.updated_at : null }
}

function parseFocusControlPayload(
  payload: Partial<FocusPollingControlState> & { error?: string },
  responseStatus: number,
): FocusPollingControlState {
  if (typeof payload.enabled !== 'boolean') {
    throw new Error(payload.error || `Storm focus control returned HTTP ${responseStatus}`)
  }
  const bounds = Array.isArray(payload.bounds)
    && payload.bounds.length === 4
    && payload.bounds.every((value) => typeof value === 'number' && Number.isFinite(value))
    ? payload.bounds as [number, number, number, number]
    : null
  return {
    enabled: payload.enabled,
    updated_at: typeof payload.updated_at === 'string' ? payload.updated_at : null,
    expires_at: typeof payload.expires_at === 'string' ? payload.expires_at : null,
    region_id: typeof payload.region_id === 'string' ? payload.region_id : null,
    region_label: typeof payload.region_label === 'string' ? payload.region_label : null,
    bounds,
  }
}

async function fetchFocusControlStatus(): Promise<FocusPollingControlState> {
  const response = await fetch(`${RADAR_CONTROL_API_URL}/focus/status`, { cache: 'no-store' })
  const payload = await response.json() as Partial<FocusPollingControlState> & { error?: string }
  if (!response.ok) throw new Error(payload.error || `Storm focus control returned HTTP ${response.status}`)
  return parseFocusControlPayload(payload, response.status)
}

async function updateFocusControl(
  enabled: boolean,
  token: string,
  region?: { id: string; label: string; bounds: readonly [number, number, number, number] },
): Promise<FocusPollingControlState> {
  const response = await fetch(`${RADAR_CONTROL_API_URL}/focus/polling`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      enabled,
      ...(enabled && region
        ? {
            region_id: region.id,
            region_label: region.label,
            bounds: [...region.bounds],
            duration_hours: 12,
          }
        : {}),
    }),
  })
  const payload = await response.json() as Partial<FocusPollingControlState> & { error?: string }
  if (!response.ok) throw new Error(payload.error || `Storm focus control returned HTTP ${response.status}`)
  return parseFocusControlPayload(payload, response.status)
}

function controlTokenFromSession(): string {
  try { return window.sessionStorage.getItem(CONTROL_TOKEN_SESSION_KEY) || '' } catch { return '' }
}

function promptForControlToken(): string {
  const existing = controlTokenFromSession()
  if (existing) return existing
  const token = window.prompt('Enter the radar control key. It is kept only for this browser session.')?.trim() || ''
  if (!token) return ''
  try { window.sessionStorage.setItem(CONTROL_TOKEN_SESSION_KEY, token) } catch { /* best effort */ }
  return token
}

function easternInputValue(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date)
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? '00'
  const hour = value('hour') === '24' ? '00' : value('hour')
  return `${value('year')}-${value('month')}-${value('day')}T${hour}:${value('minute')}`
}

function easternHourInputValue(date: Date): string {
  const value = easternInputValue(date)
  return value.replace(/:\d{2}$/, ':00')
}

function defaultHistoryInputValues(source: RadarSourceId): { start: string; end: string } {
  const end = new Date(Date.now() - (source === 'era5' ? 5 * 24 * 60 * 60 * 1000 : 0))
  const format = source === 'era5' ? easternHourInputValue : easternInputValue
  return {
    start: format(new Date(end.getTime() - 2 * 60 * 60 * 1000)),
    end: format(end),
  }
}

function easternInputToIso(value: string): string {
  const [datePart, timePart] = value.split('T')
  const [year, month, day] = datePart.split('-').map(Number)
  const [hour, minute] = timePart.split(':').map(Number)
  const naive = new Date(Date.UTC(year, month - 1, day, hour, minute))
  const offsetMilliseconds = (date: Date): number => {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      timeZoneName: 'longOffset',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    }).formatToParts(date)
    const raw = parts.find((part) => part.type === 'timeZoneName')?.value ?? 'GMT-05:00'
    const match = raw.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/)
    if (!match) return -5 * 60 * 60 * 1000
    const sign = match[1] === '+' ? 1 : -1
    return sign * (Number(match[2]) * 60 + Number(match[3] || 0)) * 60 * 1000
  }
  const first = new Date(naive.getTime() - offsetMilliseconds(naive))
  const corrected = new Date(naive.getTime() - offsetMilliseconds(first))
  return corrected.toISOString()
}

async function requestHistoryJob(payload: {
  source: RadarSourceId
  start: string
  end: string
  max_frames: number
  bounds?: [number, number, number, number]
  region_id?: string
}, token?: string): Promise<HistoryJobStatus> {
  const response = await fetch(`${RADAR_CONTROL_API_URL}/history/jobs`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(payload),
  })
  const result = await response.json() as HistoryJobStatus & { error?: string }
  if (!response.ok || !result.job_id) throw new Error(result.error || `Historical job request returned HTTP ${response.status}`)
  return result
}

async function fetchHistoryJobStatus(jobId: string): Promise<HistoryJobStatus> {
  const response = await fetch(`${RADAR_CONTROL_API_URL}/history/jobs/${encodeURIComponent(jobId)}`, {
    cache: 'no-store',
  })
  const result = await response.json() as HistoryJobStatus & { error?: string }
  if (!response.ok || !result.status) throw new Error(result.error || `Historical job status returned HTTP ${response.status}`)
  return result
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

function historyEntryLabel(entry: RadarHistoryEntry): string {
  const start = new Date(entry.start_time)
  const end = new Date(entry.end_time)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return entry.label
  const region = MAP_REGIONS.find((candidate) => (
    candidate.id === entry.region_id || entry.id.includes(`-${candidate.id}-`)
  ))
  const scope = entry.site?.toUpperCase() || region?.label
  const dateFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
  const timeFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
  const startDate = dateFormatter.format(start)
  const endDate = dateFormatter.format(end)
  const range = startDate === endDate
    ? `${startDate} · ${timeFormatter.format(start)}–${timeFormatter.format(end)} ET`
    : `${startDate}, ${timeFormatter.format(start)}–${endDate}, ${timeFormatter.format(end)} ET`
  return scope ? `${scope} · ${range}` : range
}

function boundsMatch(
  first: readonly [number, number, number, number],
  second: readonly [number, number, number, number],
): boolean {
  return first.every((value, index) => Math.abs(value - second[index]) < 0.001)
}

function historyEntryMatchesScope(
  entry: RadarHistoryEntry,
  source: RadarSourceId,
  regionId: string,
  bounds?: readonly [number, number, number, number],
): boolean {
  if (source === 'krax') return true
  if (regionId === 'current-view') {
    return Boolean(bounds && entry.bounds && boundsMatch(bounds, entry.bounds))
  }
  const regionMatches = entry.region_id
    ? entry.region_id === regionId
    : entry.id.includes(`-${regionId}-`)
  if (!regionMatches) return false
  return !bounds || !entry.bounds || boundsMatch(bounds, entry.bounds)
}

function coveringHistoryEntry(
  catalog: RadarHistoryCatalog | null,
  source: RadarSourceId,
  startIso: string,
  endIso: string,
  regionId: string,
  bounds?: readonly [number, number, number, number],
): RadarHistoryEntry | null {
  const start = Date.parse(startIso)
  const end = Date.parse(endIso)
  if (!catalog || !Number.isFinite(start) || !Number.isFinite(end) || start >= end) return null
  return catalog.datasets.find((entry) => {
    const entryStart = Date.parse(entry.start_time)
    const entryEnd = Date.parse(entry.end_time)
    return Number.isFinite(entryStart)
      && Number.isFinite(entryEnd)
      && start >= entryStart
      && end <= entryEnd
      && historyEntryMatchesScope(entry, source, regionId, bounds)
  }) ?? null
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
    minzoom: 5,
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

function productFrameForTime(frames: RadarFrameManifest[], validTime: string | null | undefined): RadarFrameManifest | null {
  if (!frames.length) return null
  if (!validTime) return frames[frames.length - 1]
  const target = Date.parse(validTime)
  if (Number.isNaN(target)) return frames[frames.length - 1]
  return frames.reduce((closest, frame) => (
    Math.abs(Date.parse(frame.valid_time) - target) < Math.abs(Date.parse(closest.valid_time) - target)
      ? frame
      : closest
  ))
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
    // Radar frames are hosted on the data subdomain. Request them in CORS
    // mode so deterministic GIF exports can safely read the canvas pixels.
    image.crossOrigin = 'anonymous'
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

function cropExportBoundsToAspect(bounds: ExportBounds, targetAspect: number): ExportBounds {
  const [west, south, east, north] = bounds
  const width = east - west
  const height = north - south
  const centerLon = (west + east) / 2
  const centerLat = (south + north) / 2
  if (width / height < targetAspect) {
    const croppedHeight = width / targetAspect
    return [west, centerLat - croppedHeight / 2, east, centerLat + croppedHeight / 2]
  }
  const croppedWidth = height * targetAspect
  return [centerLon - croppedWidth / 2, south, centerLon + croppedWidth / 2, north]
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
  const width = SHARE_GIF_MAP_WIDTH
  const height = SHARE_GIF_MAP_HEIGHT
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Browser canvas is unavailable')

  const view = map.getBounds()
  const viewBounds = cropExportBoundsToAspect(
    [view.getWest(), view.getSouth(), view.getEast(), view.getNorth()],
    width / height,
  )
  context.fillStyle = '#e5edf4'
  context.fillRect(0, 0, width, height)
  drawExportGeometry(context, states, viewBounds, width, height, 'rgba(32,42,49,.9)', 1.4, '#f7f8f7')
  if (includeCounties) drawExportGeometry(context, counties, viewBounds, width, height, 'rgba(127,139,148,.62)', 0.65)
  const [west, south, east, north] = frame.bounds
  const viewWest = Math.max(west, viewBounds[0])
  const viewEast = Math.min(east, viewBounds[2])
  const viewSouth = Math.max(south, viewBounds[1])
  const viewNorth = Math.min(north, viewBounds[3])
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

const SHARE_GIF_MAP_WIDTH = 1200
const SHARE_GIF_WIDTH = SHARE_GIF_MAP_WIDTH
const SHARE_GIF_MAP_HEIGHT = 750
const SHARE_GIF_HEADER_HEIGHT = 82
const SHARE_GIF_FOOTER_HEIGHT = 48
const SHARE_BRAND_NAVY = '#102a43'
const SHARE_BRAND_TEAL = '#81ded0'
const SHARE_BRAND_LIGHT = '#edf5f3'
const SHARE_FRAME_BORDER = '#243746'

function shareProductDetails(productId: RadarProductId): { label: string; source: string; resolution: string; unit: string; legend: Array<{ label: string; color: string }> } {
  if (productId === 'PrecipFlag') return { label: 'Precipitation Type', source: 'MRMS', resolution: '1 km', unit: 'TYPE', legend: PRECIP_LEGEND }
  if (productId === 'MultiSensor_QPE_01H_Pass1') return { label: '1-hour Rainfall', source: 'MRMS', resolution: '1 km', unit: 'mm', legend: RAINFALL_LEGEND }
  if (productId === 'NEXRADLevel2BaseReflectivity') return { label: 'Base Reflectivity', source: 'KRAX Level II', resolution: 'native', unit: 'dBZ', legend: REFLECTIVITY_LEGEND }
  if (productId === 'NEXRADLevel2Velocity') return { label: 'Radial Velocity', source: 'KRAX Level II', resolution: 'native', unit: 'm/s', legend: VELOCITY_LEGEND }
  if (productId === 'NEXRADLevel2CorrelationCoefficient') return { label: 'Correlation Coefficient (ρhv)', source: 'KRAX Level II', resolution: 'native', unit: 'ρhv', legend: CORRELATION_LEGEND }
  if (productId === 'ERA5PrecipitationType') return { label: 'Precipitation phase & intensity', source: 'ERA5 reanalysis · interpolated display', resolution: '0.25° native · hourly', unit: 'PHASE / RATE', legend: ERA5_PHASE_LEGEND }
  if (productId === 'ERA5TotalPrecipitation') return { label: 'Total precipitation', source: 'ERA5 reanalysis · interpolated display', resolution: '0.25° native · hourly', unit: 'mm/h', legend: ERA5_TOTAL_PRECIPITATION_LEGEND }
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
  const panelWidth = compact ? 68 : 124
  const rowHeight = compact ? 18 : 46
  const panelHeight = 36 + details.legend.length * rowHeight + 8
  const panelX = SHARE_GIF_MAP_WIDTH - panelWidth - 15
  const panelY = SHARE_GIF_HEADER_HEIGHT + SHARE_GIF_MAP_HEIGHT - panelHeight - 15

  context.save()
  context.fillStyle = 'rgba(255, 255, 255, .5)'
  context.fillRect(panelX, panelY, panelWidth, panelHeight)
  context.strokeStyle = SHARE_BRAND_NAVY
  context.lineWidth = 2
  context.strokeRect(panelX + 1, panelY + 1, panelWidth - 2, panelHeight - 2)
  context.fillStyle = SHARE_BRAND_NAVY
  context.font = '800 11px Arial, sans-serif'
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillText(details.unit.toUpperCase(), panelX + panelWidth / 2, panelY + 18)

  details.legend.forEach((entry, index) => {
    const rowY = panelY + 36 + index * rowHeight
    context.fillStyle = entry.color
    context.fillRect(panelX + 9, rowY, compact ? 14 : 20, rowHeight)
    context.fillStyle = SHARE_FRAME_BORDER
    context.font = `${compact ? '700 11px' : '700 12px'} Arial, sans-serif`
    context.textAlign = 'left'
    context.fillText(entry.label, panelX + (compact ? 30 : 38), rowY + rowHeight / 2)
  })
  context.restore()
}

function composeShareFrame(
  mapImage: ImageData,
  frame: RadarFrameManifest,
  productId: RadarProductId,
  regionLabel: string,
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
  context.font = '800 25px Arial, sans-serif'
  context.fillStyle = SHARE_BRAND_TEAL
  context.fillText('wall.cloud Radar', 20, 31)
  context.fillStyle = SHARE_BRAND_LIGHT
  context.font = '700 15px Arial, sans-serif'
  const subtitleParts = [regionLabel, details.source]
  if (details.resolution !== 'native') subtitleParts.push(details.resolution)
  subtitleParts.push(details.label)
  context.fillText(subtitleParts.join(' · '), 20, 63)
  context.textAlign = 'right'
  context.font = '800 17px Arial, sans-serif'
  context.fillStyle = '#ffffff'
  context.fillText(`Valid: ${formatShareValidTime(frame.valid_time)}`, output.width - 20, 30)
  context.textAlign = 'left'

  const scale = Math.max(SHARE_GIF_MAP_WIDTH / source.width, SHARE_GIF_MAP_HEIGHT / source.height)
  const imageWidth = Math.max(1, Math.round(source.width * scale))
  const imageHeight = Math.max(1, Math.round(source.height * scale))
  const imageX = Math.round((SHARE_GIF_MAP_WIDTH - imageWidth) / 2)
  const imageY = SHARE_GIF_HEADER_HEIGHT + Math.round((SHARE_GIF_MAP_HEIGHT - imageHeight) / 2)
  context.fillStyle = '#dfe8ec'
  context.fillRect(0, SHARE_GIF_HEADER_HEIGHT, output.width, SHARE_GIF_MAP_HEIGHT)
  context.save()
  context.beginPath()
  context.rect(0, SHARE_GIF_HEADER_HEIGHT, SHARE_GIF_MAP_WIDTH, SHARE_GIF_MAP_HEIGHT)
  context.clip()
  context.imageSmoothingEnabled = scale < 1
  context.imageSmoothingQuality = 'high'
  context.drawImage(source, imageX, imageY, imageWidth, imageHeight)
  context.restore()
  context.imageSmoothingEnabled = true
  drawShareVerticalLegend(context, details)
  context.strokeStyle = SHARE_FRAME_BORDER
  context.lineWidth = 1
  context.strokeRect(0.5, SHARE_GIF_HEADER_HEIGHT + 0.5, SHARE_GIF_MAP_WIDTH - 1, SHARE_GIF_MAP_HEIGHT - 1)

  const footerY = SHARE_GIF_HEADER_HEIGHT + SHARE_GIF_MAP_HEIGHT
  context.fillStyle = SHARE_BRAND_NAVY
  context.fillRect(0, footerY, output.width, SHARE_GIF_FOOTER_HEIGHT)
  context.fillStyle = SHARE_BRAND_LIGHT
  context.font = '800 14px Arial, sans-serif'
  const archivePrefix = isHistorical ? 'ARCHIVE · ' : ''
  const loopLabel = productId.startsWith('ERA5')
    ? 'REANALYSIS-BASED RECONSTRUCTION · NOT OBSERVED RADAR'
    : 'OBSERVED LOOP'
  context.fillText(`${archivePrefix}${loopLabel} · ${loopPeriod} · FRAME ${frameNumber + 1}/${frameCount} · ${playbackFps} FPS`, 20, footerY + 31)
  context.textAlign = 'right'
  context.fillStyle = SHARE_BRAND_TEAL
  context.font = '800 13px Arial, sans-serif'
  context.fillText('wall.cloud', output.width - 20, footerY + 31)
  context.textAlign = 'left'
  context.strokeStyle = SHARE_FRAME_BORDER
  context.lineWidth = 1
  context.strokeRect(0.5, 0.5, output.width - 1, output.height - 1)
  return context.getImageData(0, 0, output.width, output.height)
}

function updateRadarMapImage(map: maplibregl.Map, frame: RadarFrameManifest, manifestPath: string): void {
  const source = map.getSource(RADAR_SOURCE_ID) as maplibregl.ImageSource | maplibregl.RasterTileSource | undefined
  if (!source) throw new Error('Radar image source is not ready')
  const tilesUrl = framePmtilesUrl(frame, manifestPath)
  if (tilesUrl && source.type === 'raster') {
    ;(source as maplibregl.RasterTileSource).setUrl(`pmtiles://${tilesUrl}`)
  } else if (source.type === 'image') {
    source.updateImage({ url: frameUrl(frame, manifestPath), coordinates: imageCoordinates(frame.bounds) })
  } else {
    throw new Error('Radar source type does not match the selected frame')
  }
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
  analysisPlaybackAvailable,
  sourceId,
}: {
  layers: Record<AnalysisLayerKey, boolean>
  manifest: RadarManifest | null
  analysisPlaybackAvailable: boolean
  sourceId: RadarSourceId
}) {
  if (sourceId !== 'mrms') return null
  const active = ANALYSIS_LAYER_DEFINITIONS.filter((definition) => definition.key !== 'rainfall').filter((definition) => {
    const product = manifest?.products[definition.productId]
    return analysisPlaybackAvailable && layers[definition.key] && Boolean(product?.frames.length)
  })
  if (!active.length) return null
  return (
    <div className="radar-analysis-legends" aria-label="Active MRMS analysis legends">
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
      : productId === 'NEXRADLevel2Velocity'
        ? VELOCITY_LEGEND
        : productId === 'NEXRADLevel2CorrelationCoefficient'
        ? CORRELATION_LEGEND
          : productId === 'ERA5PrecipitationType'
            ? ERA5_PHASE_LEGEND
            : productId === 'ERA5TotalPrecipitation'
              ? ERA5_TOTAL_PRECIPITATION_LEGEND
          : REFLECTIVITY_LEGEND
  const heading = productId === 'PrecipFlag'
    ? 'TYPE'
    : productId === 'MultiSensor_QPE_01H_Pass1'
      ? 'mm'
      : productId === 'NEXRADLevel2Velocity'
        ? 'm/s'
        : productId === 'NEXRADLevel2CorrelationCoefficient'
        ? 'ρhv'
          : productId === 'ERA5PrecipitationType'
            ? 'PHASE / RATE'
            : productId === 'ERA5TotalPrecipitation'
              ? 'mm/h'
          : 'dBZ'
  const label = productId === 'PrecipFlag'
    ? 'Precipitation type'
    : productId === 'MultiSensor_QPE_01H_Pass1'
      ? 'Rainfall accumulation'
      : productId === 'NEXRADLevel2Velocity'
        ? 'Radial velocity'
        : productId === 'NEXRADLevel2CorrelationCoefficient'
        ? 'Correlation coefficient'
          : productId === 'ERA5PrecipitationType'
            ? 'ERA5 precipitation phase'
            : productId === 'ERA5TotalPrecipitation'
              ? 'ERA5 total precipitation'
          : 'Reflectivity'
  return (
    <aside className="radar-legend" aria-label={`${label} legend`}>
      <div className="radar-legend-heading">{heading}</div>
      <div className="radar-legend-swatches">
        {entries.map((entry) => <span key={entry.label} style={{ backgroundColor: entry.color }} title={entry.label} />)}
      </div>
      <div className="radar-legend-labels">
        {entries.map((entry) => <span key={entry.label}>{entry.label}</span>)}
      </div>
      {productId === 'ERA5PrecipitationType' && (
        <div className="radar-legend-intensity">intensity mm/h<br /><span>0.01 · 0.1 · 1<br />5 · 10 · 25+</span></div>
      )}
    </aside>
  )
}

export function RadarApp() {
  const mapContainer = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const activeMapAssetUrlsRef = useRef<Map<string, string>>(new Map())
  const warningsRef = useRef<Map<string, RadarWarning>>(new Map())
  const [mapReady, setMapReady] = useState(false)
  const [mapError, setMapError] = useState<string | null>(null)
  const [manifest, setManifest] = useState<RadarManifest | null>(null)
  const [manifestLoading, setManifestLoading] = useState(true)
  const [manifestError, setManifestError] = useState<string | null>(null)
  const [sourceId, setSourceId] = useState<RadarSourceId>(DEFAULT_RADAR_SOURCE)
  const [mrmsLiveCoverage, setMrmsLiveCoverage] = useState<MrmsLiveCoverage>('national')
  const [manifestPath, setManifestPath] = useState(HISTORY_CATALOG_PATHS[DEFAULT_RADAR_SOURCE])
  const [sourceFallbackNotice, setSourceFallbackNotice] = useState<string | null>(null)
  const [historyCatalogs, setHistoryCatalogs] = useState<Record<RadarSourceId, RadarHistoryCatalog | null>>({ mrms: null, krax: null, era5: null })
  const [historyErrors, setHistoryErrors] = useState<Record<RadarSourceId, string | null>>({ mrms: null, krax: null, era5: null })
  const [historyRefreshNonce, setHistoryRefreshNonce] = useState(0)
  const [historyStart, setHistoryStart] = useState(() => defaultHistoryInputValues(DEFAULT_RADAR_SOURCE).start)
  const [historyEnd, setHistoryEnd] = useState(() => defaultHistoryInputValues(DEFAULT_RADAR_SOURCE).end)
  const [mapRegionId, setMapRegionId] = useState(DEFAULT_ARCHIVE_REGION_ID)
  const [historyRegionId, setHistoryRegionId] = useState('current-view')
  const [historyJobStatus, setHistoryJobStatus] = useState<HistoryJobStatus | null>(null)
  const [historyRequestBusy, setHistoryRequestBusy] = useState(false)
  const [historyRequestError, setHistoryRequestError] = useState<string | null>(null)
  const [pollingControl, setPollingControl] = useState<PollingControlState | null>(null)
  const [pollingControlError, setPollingControlError] = useState<string | null>(null)
  const [pollingControlBusy, setPollingControlBusy] = useState(false)
  const [focusControl, setFocusControl] = useState<FocusPollingControlState | null>(null)
  const [focusControlError, setFocusControlError] = useState<string | null>(null)
  const [focusControlBusy, setFocusControlBusy] = useState(false)
  const [focusRegionId, setFocusRegionId] = useState('north-carolina')
  const [datasetId, setDatasetId] = useState(ARCHIVE_DATASET_PLACEHOLDER)
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
    warnings: false,
    counties: !shouldUseLowMemoryMapMode(),
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
  const [warningErrors, setWarningErrors] = useState<string[]>([])
  const [selectedWarningId, setSelectedWarningId] = useState<string | null>(null)
  const [states, setStates] = useState<GeoJSON.FeatureCollection>(EMPTY_STATE)
  const [counties, setCounties] = useState<GeoJSON.FeatureCollection>(EMPTY_STATE)
  const [geographyError, setGeographyError] = useState<string | null>(null)
  const [highways, setHighways] = useState<GeoJSON.FeatureCollection>(EMPTY_STATE)
  const [highwaysLoading, setHighwaysLoading] = useState(false)
  const [highwaysError, setHighwaysError] = useState<string | null>(null)
  const [surfaceObservations, setSurfaceObservations] = useState<SurfaceObservation[]>([])
  const [surfaceError, setSurfaceError] = useState<string | null>(null)
  const [buoys, setBuoys] = useState<BuoyObservation[]>([])
  const [buoyError, setBuoyError] = useState<string | null>(null)
  const [selectedObservationId, setSelectedObservationId] = useState<string | null>(null)
  const [selectedBuoyId, setSelectedBuoyId] = useState<string | null>(null)

  const historyCatalog = historyCatalogs[sourceId]
  const historyError = historyErrors[sourceId]
  const isKrax = sourceId === 'krax'
  const isEra5 = sourceId === 'era5'
  const defaultHistoryDataset = historyCatalog?.datasets.find((dataset) => dataset.id.includes(`-${mapRegionId}-`))
  const activeDatasetId = datasetId === ARCHIVE_DATASET_PLACEHOLDER && historyCatalog?.datasets.length
    ? defaultHistoryDataset?.id ?? historyCatalog.datasets[0].id
    : datasetId
  const historyEntry = historyCatalog?.datasets.find((dataset) => dataset.id === activeDatasetId)
  const isFocusCoverage = sourceId === 'mrms' && activeDatasetId === 'live' && mrmsLiveCoverage === 'focus'
  const sourceLabel = isEra5 ? 'ERA5 reconstruction' : isKrax ? 'NEXRAD Level II archive' : isFocusCoverage ? 'MRMS storm focus archive' : 'MRMS archive'
  const archiveSourceLabel = isEra5
    ? 'ERA5 reconstruction archive · interpolated display'
    : sourceLabel.endsWith('archive') ? sourceLabel : `${sourceLabel} archive`

  const frames = useMemo(() => productFrames(manifest, productId), [manifest, productId])
  const activeIndex = frames.length ? Math.min(Math.max(frameIndex, 0), frames.length - 1) : 0
  const activeFrame = frames[activeIndex] ?? null
  const latestFrame = frames[frames.length - 1] ?? null
  const selectedWarning = selectedWarningId ? warnings.find((warning) => warning.id === selectedWarningId) ?? null : null
  const selectedObservation = selectedObservationId ? surfaceObservations.find((observation) => observation.id === selectedObservationId) ?? null : null
  const selectedBuoy = selectedBuoyId ? buoys.find((buoy) => buoy.id === selectedBuoyId) ?? null : null
  const mapRegion = MAP_REGIONS.find((region) => region.id === mapRegionId) ?? MAP_REGIONS[0]
  const countyDetailAvailable = supportsCountyDetail(mapRegion.id, mapRegion.bounds)
  const historyCoverageEntry = useMemo(() => {
    if (!historyStart || !historyEnd) return null
    try {
      const selectedRegion = MAP_REGIONS.find((region) => region.id === historyRegionId)
      const selectedBounds = selectedRegion?.archiveBounds?.[sourceId] ?? selectedRegion?.bounds
      return coveringHistoryEntry(
        historyCatalog,
        sourceId,
        easternInputToIso(historyStart),
        easternInputToIso(historyEnd),
        sourceId === 'krax' ? 'krax' : selectedRegion?.id ?? 'current-view',
        selectedBounds,
      )
    } catch {
      return null
    }
  }, [historyCatalog, historyEnd, historyRegionId, historyStart, sourceId])
  const focusRegion = MAP_REGIONS.find((region) => region.id === focusRegionId && region.id !== 'conus')
    ?? MAP_REGIONS.find((region) => region.id === 'north-carolina')
    ?? MAP_REGIONS[1]
  const isHistorical = ARCHIVE_ONLY || isEra5 || manifest?.mode === 'historical' || activeDatasetId !== 'live'
  const mrmsFullSuiteAvailable = sourceId === 'mrms' && (
    historyEntry?.mrms_product_tier === 'full'
    || manifest?.mrms_product_tier === 'full'
    || manifest?.mrms_full_suite === true
  )
  const analysisPlaybackAvailable = sourceId === 'mrms' && (!isHistorical || mrmsFullSuiteAvailable)
  const livePollingConfigured = Boolean(RADAR_CONTROL_API_URL)
  const freshnessLabel = !activeFrame
    ? manifestLoading ? 'LOADING' : 'DATA UNAVAILABLE'
    : 'ARCHIVE'

  useEffect(() => {
    let cancelled = false
    ;(['mrms', 'krax', 'era5'] as RadarSourceId[]).forEach((source) => {
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
  }, [historyRefreshNonce])

  useEffect(() => {
    if (!historyJobStatus || historyJobStatus.status === 'complete' || historyJobStatus.status === 'failed' || !RADAR_CONTROL_API_URL) return
    let cancelled = false
    const poll = async () => {
      try {
        const next = await fetchHistoryJobStatus(historyJobStatus.job_id)
        if (cancelled) return
        setHistoryJobStatus(next)
        if (next.status === 'complete') {
          setHistoryRefreshNonce((value) => value + 1)
          if (next.dataset_id) {
            setSourceId(next.source === 'mrms' ? 'mrms' : next.source === 'era5' ? 'era5' : 'krax')
            setDatasetId(next.dataset_id)
          }
        }
      } catch (error: unknown) {
        if (!cancelled) setHistoryRequestError(error instanceof Error ? error.message : 'Historical job status unavailable')
      }
    }
    const timer = window.setInterval(() => { void poll() }, 10_000)
    void poll()
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [historyJobStatus])

  useEffect(() => {
    if (ARCHIVE_ONLY || !RADAR_CONTROL_API_URL) return
    let cancelled = false
    const loadLevel2 = async () => {
      try {
        const state = await fetchPollingControlStatus()
        if (!cancelled) {
          setPollingControl(state)
          setPollingControlError(null)
        }
      } catch (error: unknown) {
        if (!cancelled) {
          setPollingControl(null)
          setPollingControlError(error instanceof Error ? error.message : 'Polling control unavailable')
        }
      }
    }
    const loadFocus = async () => {
      try {
        const state = await fetchFocusControlStatus()
        if (!cancelled) {
          setFocusControl(state)
          setFocusControlError(null)
        }
      } catch (error: unknown) {
        if (!cancelled) {
          setFocusControl(null)
          setFocusControlError(error instanceof Error ? error.message : 'Storm focus control unavailable')
        }
      }
    }
    void loadLevel2()
    void loadFocus()
    const refresh = window.setInterval(() => {
      void loadLevel2()
      void loadFocus()
    }, 30_000)
    return () => {
      cancelled = true
      window.clearInterval(refresh)
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    const bounds = mapRegion.bounds
    map.fitBounds(
      [[bounds[0], bounds[1]], [bounds[2], bounds[3]]],
      {
        padding: window.innerWidth <= 680
          ? { top: 92, right: 18, bottom: 230, left: 18 }
          : { top: 70, right: 330, bottom: 175, left: 28 },
        duration: 450,
        bearing: 0,
        pitch: 0,
      },
    )
  }, [mapReady, mapRegion.bounds])

  useEffect(() => {
    let cancelled = false
    const historyEntry = historyCatalog?.datasets.find((dataset) => dataset.id === activeDatasetId)
    const liveManifestPath = sourceId === 'mrms' && mrmsLiveCoverage === 'focus'
      ? FOCUS_MANIFEST_PATH
      : LIVE_MANIFEST_PATHS[sourceId]
    const nextManifestPath = activeDatasetId === 'live' && !isEra5
      ? liveManifestPath
      : historyEntry
        ? historicalManifestUrl(historyEntry.manifest_url, sourceId)
        : null
    const load = async () => {
      if (!nextManifestPath) {
        if (!cancelled) {
          if (!historyCatalog && !historyError) {
            setManifestError(null)
            setManifestLoading(true)
          } else {
            setManifest(null)
            setManifestPath(HISTORY_CATALOG_PATHS[sourceId])
            setManifestError(historyError ? `Historical catalog unavailable: ${historyError}` : null)
            setManifestLoading(false)
          }
        }
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
        setSourceFallbackNotice(null)
      }
      const loadMrmsFallback = async (reason: string) => {
        const fallbackPath = LIVE_MANIFEST_PATHS.mrms
        const fallback = await fetchRadarManifest(fallbackPath)
        applyManifest(fallback, fallbackPath, 'MergedReflectivityQCComposite')
        if (!cancelled) {
          const sourceName = sourceId === 'krax' ? 'Level II' : 'Storm focus'
          setSourceFallbackNotice(`${sourceName} unavailable · showing national MRMS fallback (${reason})`)
          if (sourceId === 'krax') {
            setSourceId('mrms')
            setMrmsLiveCoverage('national')
          }
        }
      }
      try {
        const next = await fetchRadarManifest(nextManifestPath)
        const hasFrames = hasUsableFrames(next, productId)
        if (activeDatasetId === 'live' && (sourceId === 'krax' || mrmsLiveCoverage === 'focus') && !hasFrames) {
          await loadMrmsFallback(sourceId === 'krax' ? 'no usable Level II frames' : 'no usable regional frames')
        } else {
          applyManifest(next, nextManifestPath, productId)
        }
      } catch (error) {
        if (activeDatasetId === 'live' && (sourceId === 'krax' || mrmsLiveCoverage === 'focus')) {
          try {
            await loadMrmsFallback('source request failed')
          } catch (fallbackError) {
            if (!cancelled) {
              const primaryMessage = error instanceof Error ? error.message : 'Focused radar manifest request failed'
              const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : 'MRMS fallback request failed'
              setManifestError(`${primaryMessage}; ${fallbackMessage}`)
            }
          }
        } else if (!cancelled) {
          setManifestError(error instanceof Error ? error.message : 'Manifest request failed')
        }
      } finally {
        if (!cancelled) setManifestLoading(false)
      }
    }
    void load()
    const shouldPollLiveManifest = activeDatasetId === 'live' && !isEra5 && (
      (sourceId === 'mrms' && mrmsLiveCoverage === 'national')
      || (sourceId === 'mrms' && mrmsLiveCoverage === 'focus' && focusControl?.enabled === true)
      || !livePollingConfigured
      || (sourceId === 'krax' && pollingControl?.enabled === true)
    )
    const refresh = shouldPollLiveManifest ? window.setInterval(() => { void load() }, RADAR_POLL_INTERVAL_MS) : null
    return () => {
      cancelled = true
      if (refresh !== null) window.clearInterval(refresh)
    }
  }, [
    activeDatasetId,
    focusControl?.enabled,
    historyCatalog,
    historyError,
    isEra5,
    livePollingConfigured,
    mrmsLiveCoverage,
    pollingControl?.enabled,
    productId,
    sourceId,
  ])

  useEffect(() => {
    if (!playing || frames.length < 2) return
    const delay = 1_000 / playbackFps + (activeIndex === frames.length - 1 ? LATEST_FRAME_HOLD_MS : 0)
    const timer = window.setTimeout(() => {
      setFrameIndex((index) => index >= frames.length - 1 ? 0 : index + 1)
    }, delay)
    return () => window.clearTimeout(timer)
  }, [activeIndex, frames.length, playbackFps, playing])

  useEffect(() => {
    if (ARCHIVE_ONLY) return
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
      } catch (error) {
        if (!cancelled) {
          setWarningErrors([error instanceof Error ? error.message : 'NWS request failed'])
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
    const countyBounds = layers.counties && countyDetailAvailable ? mapRegion.bounds : null
    fetchRegionalGeography(controller.signal, countyBounds)
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
  }, [countyDetailAvailable, layers.counties, mapRegion.bounds])

  useEffect(() => {
    if (!layers.highways || mapRegion.id === 'conus') return
    let cancelled = false
    const controller = new AbortController()
    const load = async () => {
      setHighwaysLoading(true)
      try {
        const result = await fetchRegionalHighways(controller.signal, mapRegion.bounds)
        if (!cancelled) {
          setHighways(result)
          setHighwaysError(null)
        }
      } catch (error: unknown) {
        if (!cancelled && error instanceof Error && error.name !== 'AbortError') setHighwaysError(error.message)
      } finally {
        if (!cancelled) setHighwaysLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [layers.highways, mapRegion.bounds, mapRegion.id])

  useEffect(() => {
    if (!layers.surface || isHistorical) return
    let cancelled = false
    const controller = new AbortController()
    const load = async () => {
      try {
        const result = await fetchRegionalSurfaceObservations(controller.signal)
        if (cancelled) return
        if (result.observations.length || !surfaceObservations.length) setSurfaceObservations(result.observations)
        setSurfaceError(result.errors.length ? result.errors[0] : null)
      } catch (error: unknown) {
        if (!cancelled && error instanceof Error && error.name !== 'AbortError') setSurfaceError(error.message)
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
    const activeMapAssetUrls = activeMapAssetUrlsRef.current
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
      canvasContextAttributes: { preserveDrawingBuffer: !shouldUseLowMemoryMapMode() },
      minZoom: 2.2,
      maxZoom: 14,
        maxBounds: [[MAP_VIEW_BOUNDS[0] - 4, MAP_VIEW_BOUNDS[1] - 4], [MAP_VIEW_BOUNDS[2] + 4, MAP_VIEW_BOUNDS[3] + 4]],
      attributionControl: false,
      dragRotate: false,
      touchPitch: false,
      pitchWithRotate: false,
    })
    map.touchZoomRotate.disableRotation()
    map.keyboard.disableRotation()
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right')
    map.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: '© OpenStreetMap contributors © CARTO · NOAA radar · NWS' }), 'bottom-right')
    const collapseAttribution = () => {
      const attribution = mapContainer.current?.querySelector<HTMLDetailsElement>('details.maplibregl-ctrl-attrib')
      if (!attribution) return
      attribution.open = false
      attribution.classList.remove('maplibregl-compact-show')
    }
    const collapseAttributionOnInteraction = (event: Event) => {
      const target = event.target
      if (target instanceof Element && target.closest('.maplibregl-ctrl-attrib')) return
      collapseAttribution()
    }
    const mapElement = mapContainer.current
    mapElement.addEventListener('pointerdown', collapseAttributionOnInteraction, true)
    mapElement.addEventListener('wheel', collapseAttribution, { passive: true })
    window.requestAnimationFrame(collapseAttribution)
    map.on('load', () => {
      createMapSources(map)
      map.jumpTo({ center: MAP_CENTER, zoom: initialMapZoom(), bearing: 0, pitch: 0 })
      map.resize()
      collapseAttribution()
      setMapReady(true)
    })
    map.on('movestart', collapseAttribution)
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
      const message = event.error?.message
      if (!message || message.toLowerCase().includes('tile')) return
      if (message.includes('Failed to fetch (0)')) {
        const belongsToActiveSource = Array.from(activeMapAssetUrls.values())
          .some((url) => message.includes(url))
        if (!belongsToActiveSource) return
      }
      setMapError(message)
    })
    const resizeObserver = new ResizeObserver(() => map.resize())
    resizeObserver.observe(mapContainer.current)
    mapRef.current = map
    return () => {
      resizeObserver.disconnect()
      mapElement.removeEventListener('pointerdown', collapseAttributionOnInteraction, true)
      mapElement.removeEventListener('wheel', collapseAttribution)
      map.remove()
      activeMapAssetUrls.clear()
      mapRef.current = null
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    const tilesUrl = activeFrame ? framePmtilesUrl(activeFrame, manifestPath) : null
    const activeAssetUrl = activeFrame ? tilesUrl ?? frameUrl(activeFrame, manifestPath) : null
    if (activeAssetUrl) activeMapAssetUrlsRef.current.set(RADAR_SOURCE_ID, activeAssetUrl)
    else activeMapAssetUrlsRef.current.delete(RADAR_SOURCE_ID)
    setMapError(null)
    const displayResampling = isEra5 ? 'linear' : 'nearest'
    let source = map.getSource(RADAR_SOURCE_ID) as maplibregl.ImageSource | maplibregl.RasterTileSource | undefined
    const desiredType = tilesUrl ? 'raster' : 'image'
    if (source && source.type !== desiredType) {
      if (map.getLayer(RADAR_LAYER_ID)) map.removeLayer(RADAR_LAYER_ID)
      map.removeSource(RADAR_SOURCE_ID)
      source = undefined
    }
    if (activeFrame && !source) {
      if (tilesUrl) {
        map.addSource(RADAR_SOURCE_ID, {
          type: 'raster',
          url: `pmtiles://${tilesUrl}`,
          tileSize: 512,
          minzoom: activeFrame.minzoom ?? 3,
          maxzoom: activeFrame.maxzoom ?? 8,
          attribution: isEra5 ? 'ERA5 • Copernicus Climate Change Service / ECMWF' : isKrax ? 'NOAA NEXRAD Level II' : 'NOAA/NCEP MRMS',
        })
      } else {
        const bounds = activeFrame.bounds
        map.addSource(RADAR_SOURCE_ID, {
          type: 'image',
          url: frameUrl(activeFrame, manifestPath),
          coordinates: [[bounds[0], bounds[3]], [bounds[2], bounds[3]], [bounds[2], bounds[1]], [bounds[0], bounds[1]]],
        })
      }
      map.addLayer({
        id: RADAR_LAYER_ID,
        type: 'raster',
        source: RADAR_SOURCE_ID,
        paint: { 'raster-opacity': 1, 'raster-fade-duration': 0, 'raster-resampling': displayResampling },
      }, map.getLayer('wallcloud-state-fill') ? 'wallcloud-state-fill' : undefined)
    } else if (source && activeFrame) {
      updateRadarMapImage(map, activeFrame, manifestPath)
    }
    if (map.getLayer(RADAR_LAYER_ID)) {
      map.setPaintProperty(RADAR_LAYER_ID, 'raster-resampling', displayResampling)
    }
  }, [activeFrame, isEra5, isKrax, manifestPath, mapReady])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    ANALYSIS_LAYER_DEFINITIONS.forEach((definition) => {
      const sourceId = analysisSourceId(definition.productId)
      const layerId = analysisLayerId(definition.productId)
      const frame = layers[definition.key] && analysisPlaybackAvailable
        ? productFrameForTime(productFrames(manifest, definition.productId), activeFrame?.valid_time)
        : null
      if (!frame) {
        activeMapAssetUrlsRef.current.delete(sourceId)
        if (map.getLayer(layerId)) map.removeLayer(layerId)
        if (map.getSource(sourceId)) map.removeSource(sourceId)
        return
      }
      const resolvedFrameUrl = frameUrl(frame, manifestPath)
      activeMapAssetUrlsRef.current.set(sourceId, resolvedFrameUrl)
      const coordinates = imageCoordinates(frame.bounds)
      const source = map.getSource(sourceId) as maplibregl.ImageSource | undefined
      if (!source) {
        map.addSource(sourceId, {
          type: 'image',
          url: resolvedFrameUrl,
          coordinates,
        })
        map.addLayer({
          id: layerId,
          type: 'raster',
          source: sourceId,
          paint: { 'raster-opacity': 1, 'raster-fade-duration': 0, 'raster-resampling': 'nearest' },
        }, map.getLayer('wallcloud-state-fill') ? 'wallcloud-state-fill' : undefined)
      } else {
        source.updateImage({ url: resolvedFrameUrl, coordinates })
      }
    })
  }, [activeFrame?.valid_time, analysisPlaybackAvailable, layers, manifest, manifestPath, mapReady])

  useEffect(() => {
    if (!activeFrame || frames.length < 2 || shouldUseLowMemoryMapMode()) return
    const preload = [1, 2]
      .map((offset) => frames[(activeIndex + offset) % frames.length])
      .filter((frame, index, candidates) => candidates.indexOf(frame) === index)
    const imagePreloads = preload.filter((frame) => !frame.pmtiles_url).map((frame) => {
      const image = new Image()
      image.decoding = 'async'
      image.src = frameUrl(frame, manifestPath)
      return image
    })
    const map = mapRef.current
    if (map) {
      preload
        .filter((frame) => Boolean(frame.pmtiles_url))
        .forEach((frame) => { void preloadPmtilesFrame(frame, manifestPath, map).catch(() => undefined) })
    }
    return () => {
      imagePreloads.forEach((image) => image.removeAttribute('src'))
    }
  }, [activeFrame, activeIndex, frames, manifestPath])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    if (map.getLayer(RADAR_LAYER_ID)) map.setPaintProperty(RADAR_LAYER_ID, 'raster-opacity', radarOpacity)
    ANALYSIS_LAYER_DEFINITIONS.forEach((definition) => {
      const layerId = analysisLayerId(definition.productId)
      if (map.getLayer(layerId)) map.setPaintProperty(layerId, 'raster-opacity', radarOpacity)
    })
    setLayerVisibility(map, [RADAR_LAYER_ID], layers.radar && Boolean(activeFrame))
    setLayerVisibility(map, ['wallcloud-county-line'], layers.counties && countyDetailAvailable)
    setLayerVisibility(map, ['wallcloud-city-dot', 'wallcloud-city-label', CITY_LABEL_EXCEPTION_ID], layers.cities)
    setLayerVisibility(map, ['wallcloud-highway-line', 'wallcloud-highway-label'], layers.highways && mapRegion.id !== 'conus')
    setLayerVisibility(map, [WARNING_FILL_ID, WARNING_CASING_ID, WARNING_LINE_ID], layers.warnings && !isHistorical)
    setLayerVisibility(map, [SURFACE_DOT_ID, SURFACE_LABEL_ID], layers.surface && !isHistorical)
    setLayerVisibility(map, [BUOY_DOT_ID, BUOY_LABEL_ID], layers.buoys && !isHistorical)
    ANALYSIS_LAYER_DEFINITIONS.forEach((definition) => {
      const frame = productFrameForTime(productFrames(manifest, definition.productId), activeFrame?.valid_time)
      setLayerVisibility(map, [analysisLayerId(definition.productId)], layers[definition.key] && analysisPlaybackAvailable && Boolean(frame))
    })
  }, [activeFrame, analysisPlaybackAvailable, countyDetailAvailable, isHistorical, layers, manifest, mapReady, mapRegion.id, radarOpacity])

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
    highwaySource?.setData(mapRegion.id === 'conus' ? EMPTY_STATE : highways)
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
  }, [buoys, counties, highways, mapReady, mapRegion.id, selectedWarningId, states, surfaceObservations, warnings])

  const selectedProduct = manifest?.products[productId]
  const dataUnavailable = !manifestLoading && (!manifest || manifest.status !== 'ready' || !activeFrame)
  const loopDownloadUrl = selectedProduct?.loop_url ? assetUrl(selectedProduct.loop_url, manifestPath) : null

  const exportGif = async () => {
    const map = mapRef.current
    if (gifExporting || !map || !frames.length) return
    const limitMobileFrames = Math.min(window.innerWidth, window.innerHeight) <= 680
      && frames.length > MOBILE_GIF_FRAME_LIMIT
    const exportFrames = limitMobileFrames ? frames.slice(-MOBILE_GIF_FRAME_LIMIT) : frames
    const exportRegionLabel = manifest?.region_label
      ?? (manifest?.coverage === 'conus' ? 'Continental U.S.' : mapRegion.label)
    const originalIndex = activeIndex
    const originalFrame = activeFrame
    const wasPlaying = playing
    let usedMapCanvasFallback = false
    setGifExporting(true)
    setGifExportProgress(0)
    setGifExportError(null)
    setPlaying(false)
    try {
      const captured: ImageData[] = []
      const loopPeriod = formatShareLoopPeriod(exportFrames[0]?.valid_time, exportFrames.at(-1)?.valid_time)
      const exportWarnings = layers.warnings && !isHistorical ? warningsFeatureCollection(warnings) : EMPTY_STATE
      for (let index = 0; index < exportFrames.length; index += 1) {
        const frame = exportFrames[index]
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
        captured.push(composeShareFrame(mapImage, frame, productId, exportRegionLabel, isHistorical, playbackFps, index, exportFrames.length, loopPeriod))
        setGifExportProgress(Math.round((index + 1) / exportFrames.length * 100))
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
      window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 30_000)
      const notices = [
        ...(limitMobileFrames ? [`Mobile export used the latest ${MOBILE_GIF_FRAME_LIMIT} frames to stay within iOS memory limits.`] : []),
        ...(usedMapCanvasFallback ? ['GIF saved with the browser map base because the deterministic export base was temporarily unavailable.'] : []),
      ]
      if (notices.length) setGifExportError(notices.join(' '))
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

  const changePollingState = async (enabled: boolean) => {
    if (!RADAR_CONTROL_API_URL || pollingControlBusy) return
    const token = promptForControlToken()
    if (!token) return
    setPollingControlBusy(true)
    setPollingControlError(null)
    try {
      const state = await updatePollingControl(enabled, token)
      setPollingControl(state)
    } catch (error: unknown) {
      if (error instanceof Error && error.message.includes('Unauthorized')) {
        try { window.sessionStorage.removeItem(CONTROL_TOKEN_SESSION_KEY) } catch { /* best effort */ }
      }
      setPollingControlError(error instanceof Error ? error.message : 'Polling control update failed')
    } finally {
      setPollingControlBusy(false)
    }
  }

  const changeFocusState = async (enabled: boolean) => {
    if (!RADAR_CONTROL_API_URL || focusControlBusy) return
    const token = promptForControlToken()
    if (!token) return
    setFocusControlBusy(true)
    setFocusControlError(null)
    try {
      const state = await updateFocusControl(enabled, token, enabled ? focusRegion : undefined)
      setFocusControl(state)
      if (enabled) {
        setSourceId('mrms')
        setMrmsLiveCoverage('focus')
        setMapRegionId(focusRegion.id)
        setDatasetId('live')
        setProductId('MergedReflectivityQCComposite')
        setManifestLoading(true)
        setSourceFallbackNotice(null)
        setFrameIndex(0)
        setPlaying(false)
      }
    } catch (error: unknown) {
      if (error instanceof Error && error.message.includes('Unauthorized')) {
        try { window.sessionStorage.removeItem(CONTROL_TOKEN_SESSION_KEY) } catch { /* best effort */ }
      }
      setFocusControlError(error instanceof Error ? error.message : 'Storm focus update failed')
    } finally {
      setFocusControlBusy(false)
    }
  }

  const requestHistoricalLoop = async () => {
    if (!RADAR_CONTROL_API_URL || historyRequestBusy) return
    setHistoryRequestError(null)
    setHistoryJobStatus(null)
    try {
      const start = easternInputToIso(historyStart)
      const end = easternInputToIso(historyEnd)
      if (Date.parse(start) >= Date.parse(end)) {
        setHistoryRequestError('Start must be before end.')
        return
      }
      const selectedHistoryRegion = MAP_REGIONS.find((region) => region.id === historyRegionId)
      const viewBounds = mapRef.current?.getBounds()
      const historyDomain = sourceId === 'era5' ? ERA5_PROCESSING_BOUNDS : NATIONAL_BOUNDS
      const selectedRegionBounds = selectedHistoryRegion?.archiveBounds?.[sourceId] ?? selectedHistoryRegion?.bounds
      const bounds: [number, number, number, number] | undefined = sourceId !== 'krax'
        ? selectedRegionBounds
          ? [...selectedRegionBounds] as [number, number, number, number]
          : viewBounds
            ? [
                Math.max(historyDomain[0], viewBounds.getWest()),
                Math.max(historyDomain[1], viewBounds.getSouth()),
                Math.min(historyDomain[2], viewBounds.getEast()),
                Math.min(historyDomain[3], viewBounds.getNorth()),
              ]
            : [...REGIONAL_BOUNDS]
        : undefined
      const regionId = sourceId !== 'krax' ? selectedHistoryRegion?.id ?? 'current-view' : 'krax'
      const existing = coveringHistoryEntry(historyCatalog, sourceId, start, end, regionId, bounds)
      if (existing) {
        setDatasetId(existing.id)
        setManifestLoading(true)
        setSourceFallbackNotice(null)
        setFrameIndex(0)
        setPlaying(false)
        return
      }
      const token = sourceId === 'krax' ? promptForControlToken() : undefined
      if (sourceId === 'krax' && !token) return
      setHistoryRequestBusy(true)
      const next = await requestHistoryJob({
        source: sourceId,
        start,
        end,
        max_frames: isEra5 ? 168 : 30,
        bounds,
        region_id: sourceId !== 'krax' ? regionId : undefined,
      }, token)
      setHistoryJobStatus(next)
    } catch (error: unknown) {
      if (sourceId === 'krax' && error instanceof Error && error.message.includes('Unauthorized')) {
        try { window.sessionStorage.removeItem(CONTROL_TOKEN_SESSION_KEY) } catch { /* best effort */ }
      }
      setHistoryRequestError(error instanceof Error ? error.message : 'Historical job request failed')
    } finally {
      setHistoryRequestBusy(false)
    }
  }

  return (
    <div className="radar-app" data-build-sha={BUILD_SHA}>
      <header className="radar-header">
        <div className="radar-brand-lockup">
          <span className="radar-mark" aria-hidden="true"><i /><i /><i /></span>
          <div>
            <div className="radar-product-name">wall.cloud Radar</div>
            <div className="radar-region-name">{mapRegion.label} <span>/ {sourceLabel}</span></div>
          </div>
        </div>
        <div className="radar-header-status">
          <div className={`radar-freshness ${freshnessLabel === 'ARCHIVE' ? 'historical' : freshnessLabel === 'DATA UNAVAILABLE' ? 'unavailable' : ''}`}>
            <span className="radar-status-dot" /> {freshnessLabel}
          </div>
          <div className="radar-valid-time">{formatEasternTime(activeFrame?.valid_time)} ET</div>
        </div>
        <div className="radar-header-actions">
          <span className="radar-dedication">
            <strong>Dedicated to Jack Roney</strong>
            <span>7.29.86–7.5.26</span>
          </span>
          <span className="radar-warning-count">{manifest?.label ?? 'Archive browser'}</span>
          <button type="button" className="radar-settings-button" onClick={() => setSettingsOpen((open) => !open)} aria-expanded={settingsOpen} aria-controls="radar-settings">
            <span className="radar-sliders-icon" aria-hidden="true">☷</span> Layers
          </button>
        </div>
      </header>

      <main className="radar-map-area">
        <div ref={mapContainer} className="radar-map" aria-label={`Interactive ${mapRegion.label} historical radar map`} />

        <div className="radar-map-badge">
            <span>{archiveSourceLabel}</span>
          <span className="radar-badge-divider" />
          <span>{selectedProduct?.label ?? shareProductDetails(productId).label}</span>
        </div>

        {(manifestError || sourceFallbackNotice || mapError) && (
          <div className="radar-data-strip degraded" role="status">
            <strong>{sourceFallbackNotice ? 'Source fallback' : 'Map data issue'}</strong>
            <span>{manifestError ?? sourceFallbackNotice ?? mapError}</span>
          </div>
        )}

        {dataUnavailable && (
          <div className="radar-unavailable" role="status">
            <div className="radar-unavailable-icon">◎</div>
            <strong>Archive imagery unavailable</strong>
            <span>{historyCatalog?.datasets.length ? (isEra5 ? 'That ERA5 reconstruction has no usable hourly frames.' : 'That historical pack has no usable radar frames.') : `No ${archiveSourceLabel} packs are indexed for this region yet.`}</span>
            {manifest?.errors?.[0] && <small>{manifest.errors[0]}</small>}
          </div>
        )}

        {geographyError && <div className="radar-data-strip geography-warning">Boundary data unavailable · radar remains available</div>}

        {layers.radar && <RadarLegend productId={productId} />}
        <RadarAnalysisLegends
          layers={layers}
          manifest={manifest}
          analysisPlaybackAvailable={analysisPlaybackAvailable}
          sourceId={sourceId}
        />

        <aside id="radar-settings" className={`radar-settings ${settingsOpen ? 'open' : ''}`} aria-label="Radar controls and layers">
          <div className="radar-settings-head">
            <div>
              <span className="radar-panel-kicker">Archive</span>
              <h2>Layers</h2>
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
                setMrmsLiveCoverage('national')
                setManifestLoading(true)
                setMapRegionId(DEFAULT_ARCHIVE_REGION_ID)
                const historyDefaults = defaultHistoryInputValues(nextSource)
                setHistoryStart(historyDefaults.start)
                setHistoryEnd(historyDefaults.end)
                setSourceFallbackNotice(null)
                setDatasetId(ARCHIVE_DATASET_PLACEHOLDER)
                setProductId(nextSource === 'krax'
                  ? 'NEXRADLevel2BaseReflectivity'
                  : nextSource === 'era5' ? 'ERA5PrecipitationType' : 'MergedReflectivityQCComposite')
                setFrameIndex(0)
                setPlaying(false)
                setSelectedWarningId(null)
                setLayers((current) => ({
                  ...current,
                  warnings: false,
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
              <option value="mrms">MRMS</option>
              <option value="krax">NEXRAD Level II</option>
              <option value="era5">ERA5 gap fill (interpolated)</option>
            </select>
          </div>

          {!ARCHIVE_ONLY && sourceId === 'mrms' && datasetId === 'live' && (
            <>
              <label className="radar-field-label" htmlFor="radar-live-coverage">Live MRMS coverage</label>
              <div className="radar-select-wrap">
                <select
                  id="radar-live-coverage"
                  className="radar-select"
                  value={mrmsLiveCoverage}
                  onChange={(event) => {
                    const nextCoverage = event.target.value as MrmsLiveCoverage
                    setMrmsLiveCoverage(nextCoverage)
                    setManifestLoading(true)
                    setSourceFallbackNotice(null)
                    setProductId('MergedReflectivityQCComposite')
                    setPlaying(false)
                    if (nextCoverage === 'focus' && focusControl?.region_id) {
                      setMapRegionId(focusControl.region_id)
                    }
                  }}
                >
                  <option value="national">National overview · always available</option>
                  <option value="focus">Storm focus · selected high-detail region</option>
                </select>
              </div>
            </>
          )}

          <label className="radar-field-label" htmlFor="radar-region">Map region</label>
          <div className="radar-select-wrap">
            <select
              id="radar-region"
              className="radar-select"
              value={mapRegionId}
              onChange={(event) => setMapRegionId(event.target.value)}
            >
              {MAP_REGIONS.map((region) => (
                <option key={region.id} value={region.id}>{region.label}</option>
              ))}
            </select>
          </div>

          <label className="radar-field-label" htmlFor="radar-dataset">Archive</label>
          <div className="radar-select-wrap">
            <select
              id="radar-dataset"
              className="radar-select"
              value={activeDatasetId}
              onChange={(event) => {
                const nextDatasetId = event.target.value
                setDatasetId(nextDatasetId)
                setManifestLoading(true)
                setSourceFallbackNotice(null)
                 setLayers((current) => ({ ...current, warnings: false }))
                setSelectedWarningId(null)
                setProductId(isKrax
                  ? 'NEXRADLevel2BaseReflectivity'
                  : isEra5 ? 'ERA5PrecipitationType' : 'MergedReflectivityQCComposite')
                setPlaying(false)
              }}
            >
              {activeDatasetId === ARCHIVE_DATASET_PLACEHOLDER && <option value={ARCHIVE_DATASET_PLACEHOLDER}>Select an archived pack…</option>}
              {(historyCatalog?.datasets.length ?? 0) > 0 && (
                <optgroup label="Available">
                  {historyCatalog?.datasets.map((dataset) => (
                    <option key={dataset.id} value={dataset.id}>{historyEntryLabel(dataset)}</option>
                  ))}
                </optgroup>
              )}
            </select>
          </div>
          {!historyCatalog?.datasets.length && <p className="radar-field-note">No packs yet.</p>}
          {historyError && <p className="radar-field-note error">Archive unavailable: {historyError}</p>}
          {sourceId === 'mrms' && mapRegion.id === 'atlantic-caribbean' && <p className="radar-field-note">MRMS ends at the CONUS grid; use ERA5 beyond it.</p>}
          {isEra5 && <p className="radar-field-note">Hourly 0.25° reanalysis gap fill, smoothed for display.</p>}

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
                return <option key={option.id} value={option.id} disabled={!ready}>{option.label}{ready ? '' : ' · unavailable'}</option>
              })}
            </select>
          </div>

          {!ARCHIVE_ONLY && !isEra5 && <>
          <section className="radar-polling-control radar-focus-control" aria-label="Storm focus radar control">
            <div>
              <span className="radar-layer-section-heading">MRMS storm focus</span>
              <strong>{
                !livePollingConfigured
                  ? 'Admin control unavailable'
                  : focusControl?.enabled
                    ? `${focusControl.region_label ?? 'Selected region'} is active`
                    : 'Storm focus is off'
              }</strong>
              <small>{
                !livePollingConfigured
                  ? 'The administrator control service is not configured in this build.'
                  : focusControl?.enabled
                    ? `Five-minute regional tiles until ${formatEasternDateTime(focusControl.expires_at)}.`
                    : 'One selected region at a time · automatically expires after 12 hours.'
              }</small>
            </div>
            <label className="radar-focus-region">
              Focus region
              <select
                value={focusRegionId}
                disabled={!livePollingConfigured || focusControlBusy}
                onChange={(event) => setFocusRegionId(event.target.value)}
              >
                {MAP_REGIONS.filter((region) => region.id !== 'conus').map((region) => (
                  <option key={region.id} value={region.id}>{region.label}</option>
                ))}
              </select>
            </label>
            <div className="radar-focus-actions">
              <button
                type="button"
                className={`radar-polling-toggle ${focusControl?.enabled ? 'enabled' : ''}`}
                disabled={!livePollingConfigured || focusControlBusy || focusControl === null}
                onClick={() => { void changeFocusState(true) }}
              >
                {focusControlBusy
                  ? 'Saving…'
                  : focusControl?.enabled && focusControl.region_id === focusRegion.id
                    ? 'Extend focus 12 hours'
                    : focusControl?.enabled
                      ? `Switch focus to ${focusRegion.label}`
                      : `Activate ${focusRegion.label}`}
              </button>
              {focusControl?.enabled && (
                <button
                  type="button"
                  className="radar-polling-toggle radar-focus-off"
                  disabled={focusControlBusy}
                  onClick={() => { void changeFocusState(false) }}
                >
                  Turn off storm focus
                </button>
              )}
            </div>
          </section>
          {focusControlError && <p className="radar-field-note error">Storm focus control: {focusControlError}</p>}

          <section className="radar-polling-control" aria-label="Live radar feed control">
            <div>
              <span className="radar-layer-section-heading">Live Level II feed</span>
              <strong>{!livePollingConfigured ? 'Admin control unavailable' : pollingControl?.enabled ? 'Live Level II is on' : 'Live Level II is off'}</strong>
              <small>{!livePollingConfigured ? 'The administrator control service is not configured in this build.' : 'Administrator-only 5-minute polling. Archive browsing remains public.'}</small>
            </div>
            <button
              type="button"
              className={`radar-polling-toggle ${pollingControl?.enabled ? 'enabled' : ''}`}
              aria-pressed={pollingControl?.enabled === true}
              disabled={!livePollingConfigured || pollingControlBusy || pollingControl === null}
              onClick={() => { void changePollingState(pollingControl?.enabled !== true) }}
            >
              {pollingControlBusy ? 'Saving…' : pollingControl?.enabled ? 'Turn off Live Level II (Admin)' : 'Turn on Live Level II (Admin)'}
            </button>
          </section>
          {pollingControlError && <p className="radar-field-note error">Live feed control: {pollingControlError}</p>}
          </>}

          <section className="radar-history-request" aria-label={`Archive ${sourceLabel} pack request`}>
            <div className="radar-layer-section-heading">Generate archive <small>Eastern Time · {isKrax ? 'admin key' : 'public'}</small></div>
            <div className="radar-history-fields">
              <label>Start<input type="datetime-local" min={sourceId === 'mrms' ? MRMS_ARCHIVE_START_INPUT : undefined} step={isEra5 ? 3600 : 60} value={historyStart} onChange={(event) => { setHistoryStart(event.target.value); setHistoryRequestError(null) }} /></label>
              <label>End<input type="datetime-local" min={sourceId === 'mrms' ? MRMS_ARCHIVE_START_INPUT : undefined} step={isEra5 ? 3600 : 60} value={historyEnd} onChange={(event) => { setHistoryEnd(event.target.value); setHistoryRequestError(null) }} /></label>
            </div>
            {isEra5 && <p className="radar-field-note">Whole hours only · available from 1940.</p>}
            {!isKrax && (
              <label className="radar-history-region">
                Region
                <select value={historyRegionId} onChange={(event) => { setHistoryRegionId(event.target.value); setHistoryRequestError(null) }}>
                  <option value="current-view">Current map view</option>
                  {MAP_REGIONS.map((region) => (
                    <option key={region.id} value={region.id}>{region.label}</option>
                  ))}
                </select>
              </label>
            )}
            <button
              type="button"
              className="radar-history-request-button"
              disabled={!livePollingConfigured || historyRequestBusy || !historyStart || !historyEnd || Boolean(historyCoverageEntry)}
              onClick={() => { void requestHistoricalLoop() }}
            >
              {historyRequestBusy ? 'Starting…' : historyCoverageEntry ? 'Already generated' : 'Generate pack'}
            </button>
            {historyCoverageEntry && <p className="radar-field-note" role="status">Already available: {historyEntryLabel(historyCoverageEntry)}. Select it above or extend the range.</p>}
            {!livePollingConfigured && <p className="radar-field-note">Generator unavailable in this build.</p>}
            {historyJobStatus && <p className={`radar-field-note ${historyJobStatus.status === 'failed' ? 'error' : ''}`} role="status">Job {historyJobStatus.status}{historyJobStatus.stage ? ` · ${historyJobStatus.stage}` : historyJobStatus.message ? ` · ${historyJobStatus.message}` : ''}</p>}
            {historyRequestError && <p className="radar-field-note error">{historyRequestError}</p>}
          </section>

          {analysisPlaybackAvailable && <div className="radar-layer-list">
            <div className="radar-layer-section-heading">MRMS products</div>
            {ANALYSIS_LAYER_DEFINITIONS.filter((definition) => definition.key !== 'rainfall').map((definition) => {
              const product = manifest?.products[definition.productId]
              const ready = product?.status === 'ready' || product?.status === 'partial'
              const note = ready ? definition.note : product?.notes ?? 'Not included in this archive pack'
              return (
                <label key={definition.key} className="radar-layer-row">
                  <input type="checkbox" checked={layers[definition.key]} onChange={() => toggleLayer(definition.key)} disabled={!ready} />
                  <span className="radar-checkbox" aria-hidden="true" />
                  <span><strong>{definition.label}</strong><small>{note}</small></span>
                </label>
              )
            })}
          </div>}

          <div className="radar-layer-list">
            <div className="radar-layer-section-heading">Map overlays</div>
            {([
              ['radar', 'Archive layer'],
              ['counties', countyDetailAvailable ? 'Counties' : 'Counties (closer regions)'],
              ['cities', 'Cities'],
              ['highways', highwaysLoading ? 'Highways (loading…)' : 'Highways'],
            ] as Array<[keyof typeof layers, string]>).map(([key, label]) => (
              <label key={key} className="radar-layer-row">
                <input
                  type="checkbox"
                  checked={key === 'counties' && !countyDetailAvailable ? false : layers[key]}
                  onChange={() => toggleLayer(key)}
                  disabled={key === 'counties' && !countyDetailAvailable}
                />
                <span className="radar-checkbox" aria-hidden="true" />
                <span><strong>{label}</strong></span>
              </label>
            ))}
          </div>

          <label className="radar-field-label" htmlFor="radar-opacity">Archive layer opacity <output>{Math.round(radarOpacity * 100)}%</output></label>
          <input id="radar-opacity" className="radar-range" type="range" min="0.2" max="1" step="0.05" value={radarOpacity} onChange={(event) => setRadarOpacity(Number(event.target.value))} />
          {highwaysError && <p className="radar-field-note error">Highway overlay unavailable: {highwaysError}</p>}
          {warningErrors.length > 0 && <p className="radar-field-note error">NWS: showing the last successful regional result where available.</p>}
          {surfaceError && <p className="radar-field-note error">Surface observations: {surfaceError}</p>}
          {buoyError && <p className="radar-field-note error">Buoys: {buoyError}</p>}
          <p className="radar-source-note">{isEra5 ? 'ERA5 / ECMWF · hourly 0.25° reanalysis · interpolated display · not radar' : isKrax ? 'NOAA NEXRAD Level II · KRAX' : `NOAA MRMS · ${MRMS_ARCHIVE_START_INPUT.slice(0, 10)}+ · full suite ${MRMS_FULL_SUITE_START_INPUT.slice(0, 10)}+`}</p>
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

        <section className={`radar-timeline ${frames.length < 2 ? 'single-frame' : ''}`} aria-label="Radar animation controls">
          <div className="radar-timeline-top">
            <div>
              <span className="radar-panel-kicker">Timeline</span>
              <strong>{activeFrame ? formatEasternDateTime(activeFrame.valid_time) : 'No frame selected'}</strong>
            </div>
            <span className="radar-frame-count">{frames.length === 1 ? '1 frame · waiting' : frames.length ? `${activeIndex + 1} / ${frames.length}` : '0 frames'}</span>
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
          <div className="radar-control-row" data-playback-mode={isEra5 ? 'reanalysis' : 'observed'} data-playback-fps={playbackFps}>
            <div className="radar-transport-control">
              <button type="button" onClick={() => { setPlaying(false); setFrameIndex((index) => Math.max(0, index - 1)) }} disabled={!frames.length || activeIndex === 0}>‹ <span>Previous</span></button>
              <button type="button" className="radar-play-button" onClick={() => setPlaying((value) => !value)} disabled={frames.length < 2} title={frames.length < 2 ? 'Waiting for at least two radar frames' : undefined}>{playing ? '❚❚ Pause' : '▶ Play'}</button>
              <button type="button" onClick={() => { setPlaying(false); setFrameIndex((index) => Math.min(frames.length - 1, index + 1)) }} disabled={!frames.length || activeIndex === frames.length - 1}><span>Next</span> ›</button>
            </div>
            <div className="radar-playback-options">
              <span className={`radar-observed-badge ${isEra5 ? 'reanalysis' : ''}`} title={isEra5 ? 'Hourly ERA5 reanalysis reconstruction — linearly interpolated display, not observed radar' : `Playback displays exact observed ${sourceLabel} frames`}>{isEra5 ? 'Interpolated reanalysis' : 'Observed'}</span>
              <span className="radar-fps-label">FPS</span>
              <div className="radar-speed-control" role="group" aria-label="Playback rate in frames per second">
                {PLAYBACK_FPS_OPTIONS.map((value) => <button key={value} type="button" className={playbackFps === value ? 'active' : ''} aria-pressed={playbackFps === value} aria-label={`${value} frames per second`} disabled={frames.length < 2} onClick={() => setPlaybackFps(value)}>{value}</button>)}
              </div>
              <select
                className="radar-mobile-speed-control"
                aria-label="Playback rate in frames per second"
                value={playbackFps}
                disabled={frames.length < 2}
                title={frames.length < 2 ? 'Waiting for at least two radar frames' : undefined}
                onChange={(event) => setPlaybackFps(Number(event.target.value) as (typeof PLAYBACK_FPS_OPTIONS)[number])}
              >
                {PLAYBACK_FPS_OPTIONS.map((value) => <option key={value} value={value}>{value} fps</option>)}
              </select>
              <button type="button" className="radar-download-button" onClick={() => { void exportGif() }} disabled={gifExporting || !frames.length} title="Save a share-ready GIF using the current map view and playback FPS">
                {gifExporting ? `GIF ${gifExportProgress}%` : 'Save GIF'}
              </button>
              {loopDownloadUrl ? (
                <a className="radar-static-download" href={loopDownloadUrl} download={`wall-cloud-${manifest?.dataset_id ?? 'live'}-${productId}-branded.gif`} title="Download the processor-generated branded loop">Branded loop</a>
              ) : null}
            </div>
          </div>
          {gifExportError && (
            <div className="radar-playback-note" aria-live="polite">
              {gifExportError}
            </div>
          )}
        </section>
      </main>
    </div>
  )
}
