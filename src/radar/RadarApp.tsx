≠rá^—f•ñÿ¶{M¨y 'v√Æ∂õ≠import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import maplibregl from 'maplibre-gl'
import { PMTiles, Protocol } from 'pmtiles'
import 'maplibre-gl/dist/maplibre-gl.css'
import { ANALYSIS_LAYER_DEFINITIONS, CARTO_LIGHT_TILES, CITIES, CITIES_GEOJSON, CORRELATION_LEGEND, DEFAULT_ARCHIVE_REGION_ID, ERA5_PHASE_LEGEND, ERA5_PROCESSING_BOUNDS, ERA5_TOTAL_PRECIPITATION_LEGEND, GRID_GEOJSON, MAP_CENTER, MAP_REGIONS, MAP_VIEW_BOUNDS, MRMS_ARCHIVE_START_INPUT, MRMS_FULL_SUITE_START_INPUT, NATIONAL_BOUNDS, PRECIP_LEGEND, PRODUCT_OPTIONS, RAINFALL_LEGEND, REFLECTIVITY_LEGEND, REGIONAL_BOUNDS, VELOCITY_LEGEND, type AnalysisLayerKey } from './config'
import { emptyFeatureCollection, fetchBuoyObservations, fetchHistoryCatalog, fetchRadarManifest, fetchRegionalGeography, fetchRegionalHighways, fetchRegionalSurfaceObservations, fetchRegionalWarnings, warningsFeatureCollection } from './data'
import { createGifFrameEncoder, GIF_HEIGHT_LIMIT, GIF_WIDTH_LIMIT, LATEST_FRAME_HOLD_MS } from './gif'
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
const ARCHIVE_DATA_PROXY_PATH = '/data/radar/history/'
const ARCHIVE_DATA_PROXY_ORIGINS = new Set(
  [DEFAULT_RADAR_CONTROL_API_URL, RADAR_CONTROL_API_URL]
    .filter(Boolean)
    .map((value) => new URL(value).origin),
)
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
const GIF_FRAME_LIMIT = 60
const LOW_MEMORY_VIEWPORT_MAX_WIDTH = 820
const IMAGE_PLAYBACK_READY_POLL_MS = 50
const IMAGE_PLAYBACK_MAX_WAIT_MS = 8_000
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

function localArchiveDataUrl(resolved: URL): string {
  const archivePath = resolved.pathname.startsWith('/data/')
    ? resolved.pathname.slice('/data'.length)
    : resolved.pathname
  const local = new URL(`/radar-data${archivePath}`, window.location.href)
  local.search = resolved.search
  local.hash = resolved.hash
  return local.toString()
}

function assetUrl(path: string, manifestPath: string): string {
  const manifestUrl = new URL(manifestPath, window.location.href)
  const resolved = new URL(path, manifestUrl)
  // Historical PNGs are fetched by MapLibre as cross-origin image requests.
  // Keep them on the control-worker proxy so the browser always receives a
  // consistent CORS response, even when a regenerated manifest uses direct
  // R2-relative URLs. Other archive assets (GIFs and PMTiles) stay direct.
  const isArchiveFrame = resolved.pathname.startsWith('/radar/history/') && resolved.pathname.endsWith('.png')
  const isArchiveProxyUrl = ARCHIVE_DATA_PROXY_ORIGINS.has(resolved.origin)
    && resolved.pathname.startsWith(ARCHIVE_DATA_PROXY_PATH)
  if (isArchiveProxyUrl) return import.meta.env.DEV ? localArchiveDataUrl(resolved) : resolved.toString()
  if (!isArchiveFrame) return resolved.toString()
  if (import.meta.env.DEV && resolved.origin !== window.location.origin) return localArchiveDataUrl(resolved)
  if (!RADAR_CONTROL_API_URL) return resolved.toString()

  const dataOrigin = new URL(RADAR_DATA_BASE_URL, window.location.href).origin
  if (resolved.origin !== dataOrigin) return resolved.toString()

  const proxied = new URL(`${RADAR_CONTROL_API_URL}${resolved.pathname.replace(/^\//, '/data/')}`)
  proxied.search = resolved.search
  proxied.hash = resolved.hash
  return proxied.toString()
}

function frameUrl(frame: RadarFrameManifest, manifestPath: string): string {
  const resolved = new URL(assetUrl(frame.url, manifestPath))
  // Historical frame objects are immutable. A stable frame identifier keeps
  // them cacheable while bypassing any stale pre-CORS response held by iOS.
  if (!resolved.searchParams.has('v')) resolved.searchParams.set('v', frame.id)
  return resolved.toString()
}

function framePmtilesUrl(frame: RadarFrameManifest, manifestPath: string): string | null {
  if (!frame.pmtiles_url) return null
  return assetUrl(frame.pmtiles_url, manifestPath)
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
  const format = source === 'erﬂ}<⁄⁄$z{-ÆÈ‹j◊ù7Fñˆ‚÷ÜVFñÊr#‰’$’27F˜&“fˆ7W3¬˜7„‡¢«7G&ˆÊsÁ∞¢∆ófUˆ∆∆ñÊt6ˆÊfñwW&V@¢ÚtF÷ñ‚6ˆÁG&ˆ¬VÊfñ∆&∆Rp¢¢fˆ7W46ˆÁG&ˆ√ÚÊVÊ&∆V@¢ÚG∂fˆ7W46ˆÁG&ˆ¬Á&VvñˆÂˆ∆&V¬ÛÚu6V∆V7FVB&Vvñˆ‚w“ó27FófV ¢¢u7F˜&“fˆ7W2ó2ˆfbp¢”¬˜7G&ˆÊs‡¢«6÷∆√Á∞¢∆ófUˆ∆∆ñÊt6ˆÊfñwW&V@¢ÚuFÜRF÷ñÊó7G&F˜"6ˆÁG&ˆ¬6W'fñ6Ró2Ê˜B6ˆÊfñwW&VBñ‚FÜó2'Vñ∆B‚p¢¢fˆ7W46ˆÁG&ˆ√ÚÊVÊ&∆V@¢ÚfófR÷÷ñÁWFR&VvñˆÊ¬Fñ∆W2VÁFñ¬G∂f˜&÷DV7FW&‰FFUFñ÷RÜfˆ7W46ˆÁG&ˆ¬ÊWáó&W5ˆBó“Ê ¢¢tˆÊR6V∆V7FVB&Vvñˆ‚BFñ÷R+rWFˆ÷Fñ6∆«íWáó&W2gFW""Ü˜W'2‚p¢”¬˜6÷∆√‡¢¬ˆFóc‡¢∆∆&V¬6∆74Ê÷S“'&F"÷fˆ7W2◊&Vvñˆ‚#‡¢fˆ7W2&Vvñˆ‡¢«6V∆V7@¢f«VS◊∂fˆ7W5&Vvñˆ‰ñG–¢Fó6&∆VC◊≤∆ófUˆ∆∆ñÊt6ˆÊfñwW&VB«¬fˆ7W46ˆÁG&ˆƒ'W7ó–¢ˆ‰6ÜÊvS◊≤ÜWfVÁBí”‚6WDfˆ7W5&Vvñˆ‰ñBÜWfVÁBÁF&vWBÁf«VRó–¢‡¢¥‘ı$TtîÙÂ2Êfñ«FW"Çá&Vvñˆ‚í”‚&Vvñˆ‚ÊñB”“v6ˆÁW2ríÊ÷Çá&Vvñˆ‚í”‚Ä¢∆˜Fñˆ‚∂Wì◊∑&Vvñˆ‚ÊñG“f«VS◊∑&Vvñˆ‚ÊñG”Á∑&Vvñˆ‚Ê∆&V«”¬ˆ˜Fñˆ„‡¢íó–¢¬˜6V∆V7C‡¢¬ˆ∆&V√‡¢∆Fób6∆74Ê÷S“'&F"÷fˆ7W2÷7FñˆÁ2#‡¢∆'WGFˆ‡¢GóS“&'WGFˆ‚ ¢6∆74Ê÷S◊∂&F"◊ˆ∆∆ñÊr◊Fˆvv∆RG∂fˆ7W46ˆÁG&ˆ√ÚÊVÊ&∆VBÚvVÊ&∆VBr¢rw÷–¢Fó6&∆VC◊≤∆ófUˆ∆∆ñÊt6ˆÊfñwW&VB«¬fˆ7W46ˆÁG&ˆƒ'W7í«¬fˆ7W46ˆÁG&ˆ¬””“ÁV∆«–¢ˆ‰6∆ñ6≥◊≤Çí”‚≤fˆñB6ÜÊvTfˆ7W57FFRáG'VRí◊–¢‡¢∂fˆ7W46ˆÁG&ˆƒ'W7ê¢Úu6fñÊ~(
bp¢¢fˆ7W46ˆÁG&ˆ√ÚÊVÊ&∆VBbbfˆ7W46ˆÁG&ˆ¬Á&VvñˆÂˆñB””“fˆ7W5&Vvñˆ‚Êñ@¢ÚtWáFVÊBfˆ7W2"Ü˜W'2p¢¢fˆ7W46ˆÁG&ˆ√ÚÊVÊ&∆V@¢Ú7vóF6Çfˆ7W2FÚG∂fˆ7W5&Vvñˆ‚Ê∆&V«÷ ¢¢7FófFRG∂fˆ7W5&Vvñˆ‚Ê∆&V«÷–¢¬ˆ'WGFˆ„‡¢∂fˆ7W46ˆÁG&ˆ√ÚÊVÊ&∆VBbbÄ¢∆'WGFˆ‡¢GóS“&'WGFˆ‚ ¢6∆74Ê÷S“'&F"◊ˆ∆∆ñÊr◊Fˆvv∆R&F"÷fˆ7W2÷ˆfb ¢Fó6&∆VC◊∂fˆ7W46ˆÁG&ˆƒ'W7ó–¢ˆ‰6∆ñ6≥◊≤Çí”‚≤fˆñB6ÜÊvTfˆ7W57FFRÜf«6Rí◊–¢‡¢GW&‚ˆfb7F˜&“fˆ7W0¢¬ˆ'WGFˆ„‡¢ó–¢¬ˆFóc‡¢¬˜6V7Fñˆ„‡¢∂fˆ7W46ˆÁG&ˆƒW'&˜"bb«6∆74Ê÷S“'&F"÷fñV∆B÷Ê˜FRW'&˜"#Â7F˜&“fˆ7W26ˆÁG&ˆ√¢∂fˆ7W46ˆÁG&ˆƒW'&˜'”¬˜Á–†¢«6V7Fñˆ‚6∆74Ê÷S“'&F"◊ˆ∆∆ñÊr÷6ˆÁG&ˆ¬"&ñ÷∆&V√“$∆ófR&F"fVVB6ˆÁG&ˆ¬#‡¢∆Fóc‡¢«7‚6∆74Ê÷S“'&F"÷∆ñW"◊6V7Fñˆ‚÷ÜVFñÊr#‰∆ófR∆WfV¬îífVVC¬˜7„‡¢«7G&ˆÊsÁ≤∆ófUˆ∆∆ñÊt6ˆÊfñwW&VBÚtF÷ñ‚6ˆÁG&ˆ¬VÊfñ∆&∆Rr¢ˆ∆∆ñÊt6ˆÁG&ˆ√ÚÊVÊ&∆VBÚt∆ófR∆WfV¬îíó2ˆ‚r¢t∆ófR∆WfV¬îíó2ˆfbw”¬˜7G&ˆÊs‡¢«6÷∆√Á≤∆ófUˆ∆∆ñÊt6ˆÊfñwW&VBÚuFÜRF÷ñÊó7G&F˜"6ˆÁG&ˆ¬6W'fñ6Ró2Ê˜B6ˆÊfñwW&VBñ‚FÜó2'Vñ∆B‚r¢tF÷ñÊó7G&F˜"÷ˆÊ«íR÷÷ñÁWFRˆ∆∆ñÊr‚&6ÜófR'&˜w6ñÊr&V÷ñÁ2V&∆ñ2‚w”¬˜6÷∆√‡¢¬ˆFóc‡¢∆'WGFˆ‡¢GóS“&'WGFˆ‚ ¢6∆74Ê÷S◊∂&F"◊ˆ∆∆ñÊr◊Fˆvv∆RG∑ˆ∆∆ñÊt6ˆÁG&ˆ√ÚÊVÊ&∆VBÚvVÊ&∆VBr¢rw÷–¢&ñ◊&W76VC◊∑ˆ∆∆ñÊt6ˆÁG&ˆ√ÚÊVÊ&∆VB””“G'VW–¢Fó6&∆VC◊≤∆ófUˆ∆∆ñÊt6ˆÊfñwW&VB«¬ˆ∆∆ñÊt6ˆÁG&ˆƒ'W7í«¬ˆ∆∆ñÊt6ˆÁG&ˆ¬””“ÁV∆«–¢ˆ‰6∆ñ6≥◊≤Çí”‚≤fˆñB6ÜÊvUˆ∆∆ñÊu7FFRáˆ∆∆ñÊt6ˆÁG&ˆ√ÚÊVÊ&∆VB”“G'VRí◊–¢‡¢∑ˆ∆∆ñÊt6ˆÁG&ˆƒ'W7íÚu6fñÊ~(
br¢ˆ∆∆ñÊt6ˆÁG&ˆ√ÚÊVÊ&∆VBÚuGW&‚ˆfb∆ófR∆WfV¬îíÑF÷ñ‚ír¢uGW&‚ˆ‚∆ófR∆WfV¬îíÑF÷ñ‚íw–¢¬ˆ'WGFˆ„‡¢¬˜6V7Fñˆ„‡¢∑ˆ∆∆ñÊt6ˆÁG&ˆƒW'&˜"bb«6∆74Ê÷S“'&F"÷fñV∆B÷Ê˜FRW'&˜"#‰∆ófRfVVB6ˆÁG&ˆ√¢∑ˆ∆∆ñÊt6ˆÁG&ˆƒW'&˜'”¬˜Á–¢¬ÛÁ–†¢«6V7Fñˆ‚6∆74Ê÷S“'&F"÷Üó7F˜'í◊&WVW7B"&ñ÷∆&V√◊∂&6ÜófRG∑6˜W&6T∆&V«“6≤&WVW7F”‡¢∆Fób6∆74Ê÷S“'&F"÷∆ñW"◊6V7Fñˆ‚÷ÜVFñÊr#‰vVÊW&FR&6ÜófR«6÷∆√‰V7FW&‚Fñ÷R+r∂ó4∑&ÇÚvF÷ñ‚∂Wír¢wV&∆ñ2w”¬˜6÷∆√„¬ˆFóc‡¢∆Fób6∆74Ê÷S“'&F"÷Üó7F˜'í÷fñV∆G2#‡¢∆∆&V√Â7F'C∆ñÁWBGóS“&FFWFñ÷R÷∆ˆ6¬"÷ñ„◊∑6˜W&6TñB””“v◊&◊2rÚ’$’5Ù$4ÑïdUı5D%EÙîÂUB¢VÊFVfñÊVG“7FW◊∂ó4W&RÚ3c¢c“f«VS◊∂Üó7F˜'ï7F'G“ˆ‰6ÜÊvS◊≤ÜWfVÁBí”‚≤6WDÜó7F˜'ï7F'BÜWfVÁBÁF&vWBÁf«VRì≤6WDÜó7F˜'ï&WVW7DW'&˜"ÜÁV∆¬í◊“Û„¬ˆ∆&V√‡¢∆∆&V√‰VÊC∆ñÁWBGóS“&FFWFñ÷R÷∆ˆ6¬"÷ñ„◊∑6˜W&6TñB””“v◊&◊2rÚ’$’5Ù$4ÑïdUı5D%EÙîÂUB¢VÊFVfñÊVG“7FW◊∂ó4W&RÚ3c¢c“f«VS◊∂Üó7F˜'îVÊG“ˆ‰6ÜÊvS◊≤ÜWfVÁBí”‚≤6WDÜó7F˜'îVÊBÜWfVÁBÁF&vWBÁf«VRì≤6WDÜó7F˜'ï&WVW7DW'&˜"ÜÁV∆¬í◊“Û„¬ˆ∆&V√‡¢¬ˆFóc‡¢∂ó4W&Rbb«6∆74Ê÷S“'&F"÷fñV∆B÷Ê˜FR#ÂvÜˆ∆RÜ˜W'2ˆÊ«í+rfñ∆&∆Rg&ˆ“ìC„¬˜Á–¢≤ó4∑&ÇbbÄ¢∆∆&V¬6∆74Ê÷S“'&F"÷Üó7F˜'í◊&Vvñˆ‚#‡¢&Vvñˆ‡¢«6V∆V7Bf«VS◊∂Üó7F˜'ï&Vvñˆ‰ñG“ˆ‰6ÜÊvS◊≤ÜWfVÁBí”‚≤6WDÜó7F˜'ï&Vvñˆ‰ñBÜWfVÁBÁF&vWBÁf«VRì≤6WDÜó7F˜'ï&WVW7DW'&˜"ÜÁV∆¬í◊”‡¢∆˜Fñˆ‚f«VS“&7W'&VÁB◊fñWr#‰7W'&VÁB÷fñWs¬ˆ˜Fñˆ„‡¢¥‘ı$TtîÙÂ2Ê÷Çá&Vvñˆ‚í”‚Ä¢∆˜Fñˆ‚∂Wì◊∑&Vvñˆ‚ÊñG“f«VS◊∑&Vvñˆ‚ÊñG”Á∑&Vvñˆ‚Ê∆&V«”¬ˆ˜Fñˆ„‡¢íó–¢¬˜6V∆V7C‡¢¬ˆ∆&V√‡¢ó–¢∆'WGFˆ‡¢GóS“&'WGFˆ‚ ¢6∆74Ê÷S“'&F"÷Üó7F˜'í◊&WVW7B÷'WGFˆ‚ ¢Fó6&∆VC◊≤∆ófUˆ∆∆ñÊt6ˆÊfñwW&VB«¬Üó7F˜'ï&WVW7D'W7í«¬Üó7F˜'ï7F'B«¬Üó7F˜'îVÊB«¬&ˆˆ∆V‚ÜÜó7F˜'î6˜fW&vTVÁG'íó–¢ˆ‰6∆ñ6≥◊≤Çí”‚≤fˆñB&WVW7DÜó7F˜&ñ6ƒ∆ˆ˜Çí◊–¢‡¢∂Üó7F˜'ï&WVW7D'W7íÚu7F'FñÊ~(
br¢Üó7F˜'î6˜fW&vTVÁG'íÚt«&VGívVÊW&FVBr¢tvVÊW&FR6≤w–¢¬ˆ'WGFˆ„‡¢∂Üó7F˜'î6˜fW&vTVÁG'íbb«6∆74Ê÷S“'&F"÷fñV∆B÷Ê˜FR"&ˆ∆S“'7FGW2#‰«&VGífñ∆&∆S¢∂Üó7F˜'îVÁG'î∆&V¬ÜÜó7F˜'î6˜fW&vTVÁG'íó“‚6V∆V7BóB&˜fR˜"WáFVÊBFÜR&ÊvR„¬˜Á–¢≤∆ófUˆ∆∆ñÊt6ˆÊfñwW&VBbb«6∆74Ê÷S“'&F"÷fñV∆B÷Ê˜FR#‰vVÊW&F˜"VÊfñ∆&∆Rñ‚FÜó2'Vñ∆B„¬˜Á–¢∂Üó7F˜'î¶ˆ%7FGW2bb«6∆74Ê÷S◊∂&F"÷fñV∆B÷Ê˜FRG∂Üó7F˜'î¶ˆ%7FGW2Á7FGW2””“vfñ∆VBrÚvW'&˜"r¢rw÷“&ˆ∆S“'7FGW2#‰¶ˆ"∂Üó7F˜'î¶ˆ%7FGW2Á7FGW7◊∂Üó7F˜'î¶ˆ%7FGW2Á7FvRÚ+rG∂Üó7F˜'î¶ˆ%7FGW2Á7FvW÷¢Üó7F˜'î¶ˆ%7FGW2Ê÷W76vRÚ+rG∂Üó7F˜'î¶ˆ%7FGW2Ê÷W76vW÷¢rw”¬˜Á–¢∂Üó7F˜'ï&WVW7DW'&˜"bb«6∆74Ê÷S“'&F"÷fñV∆B÷Ê˜FRW'&˜"#Á∂Üó7F˜'ï&WVW7DW'&˜'”¬˜Á–¢¬˜6V7Fñˆ„‡†¢∂Ê«ó6ó5∆ñ&6¥fñ∆&∆Rbb∆Fób6∆74Ê÷S“'&F"÷∆ñW"÷∆ó7B#‡¢∆Fób6∆74Ê÷S“'&F"÷∆ñW"◊6V7Fñˆ‚÷ÜVFñÊr#‰’$’2&ˆGV7G3¬ˆFóc‡¢¥‰≈ï4ï5ÙƒîU%ÙDTdî‰ïDîÙÂ2Êfñ«FW"ÇÜFVfñÊóFñˆ‚í”‚FVfñÊóFñˆ‚Ê∂Wí”“w&ñÊf∆¬ríÊ÷ÇÜFVfñÊóFñˆ‚í”‚∞¢6ˆÁ7B&ˆGV7B“÷ÊñfW7CÚÁ&ˆGV7G5∂FVfñÊóFñˆ‚Á&ˆGV7DñE–¢6ˆÁ7B&VGí“&ˆGV7CÚÁ7FGW2””“w&VGír«¬&ˆGV7CÚÁ7FGW2””“w'Fñ¬p¢6ˆÁ7BÊ˜FR“&VGíÚFVfñÊóFñˆ‚ÊÊ˜FR¢&ˆGV7CÚÊÊ˜FW2ÛÚtÊ˜BñÊ6«VFVBñ‚FÜó2&6ÜófR6≤p¢&WGW&‚Ä¢∆∆&V¬∂Wì◊∂FVfñÊóFñˆ‚Ê∂Wó“6∆74Ê÷S“'&F"÷∆ñW"◊&˜r#‡¢∆ñÁWBGóS“&6ÜV6∂&˜Ç"6ÜV6∂VC◊∂∆ñW'5∂FVfñÊóFñˆ‚Ê∂Wï◊“ˆ‰6ÜÊvS◊≤Çí”‚Fˆvv∆T∆ñW"ÜFVfñÊóFñˆ‚Ê∂Wíó“Fó6&∆VC◊≤&VGó“Û‡¢«7‚6∆74Ê÷S“'&F"÷6ÜV6∂&˜Ç"&ñ÷ÜñFFV„“'G'VR"Û‡¢«7„„«7G&ˆÊsÁ∂FVfñÊóFñˆ‚Ê∆&V«”¬˜7G&ˆÊs„«6÷∆√Á∂Ê˜FW”¬˜6÷∆√„¬˜7„‡¢¬ˆ∆&V√‡¢ê¢“ó–¢¬ˆFócÁ–†¢∆Fób6∆74Ê÷S“'&F"÷∆ñW"÷∆ó7B#‡¢∆Fób6∆74Ê÷S“'&F"÷∆ñW"◊6V7Fñˆ‚÷ÜVFñÊr#‰÷˜fW&∆ó3¬ˆFóc‡¢≤Ö∞¢≤w&F"r¬t&6ÜófR∆ñW"u“¿¢≤v6˜VÁFñW2r¬6˜VÁGîFWFñƒfñ∆&∆RÚt6˜VÁFñW2r¢t6˜VÁFñW2Ü6∆˜6W"&VvñˆÁ2íu“¿¢≤v6óFñW2r¬t6óFñW2u“¿¢≤vÜñvávó2r¬Üñvávó4∆ˆFñÊrÚtÜñvávó2Ü∆ˆFñÊ~(
bír¢tÜñvávó2u“¿¢≤wv&ÊñÊw2r¬v&ÊñÊw4∆ˆFñÊrÚuv&ÊñÊrˆ«ñvˆÁ2Ü∆ˆFñÊ~(
bír¢v&ÊñÊw2Ê∆VÊwFÇÚv&ÊñÊrˆ«ñvˆÁ2+rG∑v&ÊñÊw2Ê∆VÊwFá“7FófV¢uv&ÊñÊrˆ«ñvˆÁ2u“¿¢“2'&ì≈∂∂WñˆbGóVˆb∆ñW'2¬7G&ñÊu”‚íÊ÷ÇÖ∂∂Wí¬∆&V≈“í”‚Ä¢∆∆&V¬∂Wì◊∂∂Wó“6∆74Ê÷S“'&F"÷∆ñW"◊&˜r#‡¢∆ñÁW@¢GóS“&6ÜV6∂&˜Ç ¢6ÜV6∂VC◊≤Ü∂Wí””“v6˜VÁFñW2rbb6˜VÁGîFWFñƒfñ∆&∆Rí«¬Ü∂Wí””“wv&ÊñÊw2rbbó4W&RíÚf«6R¢∆ñW'5∂∂Wï◊–¢ˆ‰6ÜÊvS◊≤Çí”‚Fˆvv∆T∆ñW"Ü∂Wíó–¢Fó6&∆VC◊≤Ü∂Wí””“v6˜VÁFñW2rbb6˜VÁGîFWFñƒfñ∆&∆Rí«¬Ü∂Wí””“wv&ÊñÊw2rbbó4W&Ró–¢Û‡¢«7‚6∆74Ê÷S“'&F"÷6ÜV6∂&˜Ç"&ñ÷ÜñFFV„“'G'VR"Û‡¢«7„„«7G&ˆÊsÁ∂∆&V«”¬˜7G&ˆÊs„¬˜7„‡¢¬ˆ∆&V√‡¢íó–¢¬ˆFóc‡†¢«6∆74Ê÷S“'&F"÷fñV∆B÷Ê˜FR#Âv&ÊñÊrˆ«ñvˆÁ2&R7W'&VÁBÂu2∆W'G2‚vÜV‚VÊ&∆VB¬FÜWí&RñÊ6«VFVB27FFñ2˜fW&∆íñ‚WfW'ítîbg&÷S≤FÜWí&RÊ˜BFñ÷R÷÷F6ÜVBFÚ&6ÜófVB&F"g&÷W2„¬˜‡¢∆∆&V¬6∆74Ê÷S“'&F"÷fñV∆B÷∆&V¬"áF÷ƒf˜#“'&F"÷˜6óGí#‰&6ÜófR∆ñW"˜6óGí∆˜WGWCÁ¥÷FÇÁ&˜VÊBá&F$˜6óGí¢ó“S¬ˆ˜WGWC„¬ˆ∆&V√‡¢∆ñÁWBñC“'&F"÷˜6óGí"6∆74Ê÷S“'&F"◊&ÊvR"GóS“'&ÊvR"÷ñ„“#„""÷É“#"7FW“#„R"f«VS◊∑&F$˜6óGó“ˆ‰6ÜÊvS◊≤ÜWfVÁBí”‚6WE&F$˜6óGíÑÁV÷&W"ÜWfVÁBÁF&vWBÁf«VRíó“Û‡¢∂Üñvávó4W'&˜"bb«6∆74Ê÷S“'&F"÷fñV∆B÷Ê˜FRW'&˜"#‰Üñváví˜fW&∆íVÊfñ∆&∆S¢∂Üñvávó4W'&˜'”¬˜Á–¢∑v&ÊñÊtW'&˜'2Ê∆VÊwFÇ‚bb«6∆74Ê÷S“'&F"÷fñV∆B÷Ê˜FRW'&˜"#‰Âu3¢6Ü˜vñÊrFÜR∆7B7V66W76gV¬&VvñˆÊ¬&W7V«BvÜW&Rfñ∆&∆R„¬˜Á–¢∑7W&f6TW'&˜"bb«6∆74Ê÷S“'&F"÷fñV∆B÷Ê˜FRW'&˜"#Â7W&f6Rˆ'6W'fFñˆÁ3¢∑7W&f6TW'&˜'”¬˜Á–¢∂'V˜îW'&˜"bb«6∆74Ê÷S“'&F"÷fñV∆B÷Ê˜FRW'&˜"#‰'V˜ó3¢∂'V˜îW'&˜'”¬˜Á–¢«6∆74Ê÷S“'&F"◊6˜W&6R÷Ê˜FR#Á∂ó4W&RÚtU$RÚT4’tb+rÜ˜W&«í„#\+&VÊ«ó6ó2+rñÁFW'ˆ∆FVBFó7∆í+rÊ˜B&F"r¢ó4∑&ÇÚt‰Ù‰UÖ$B∆WfV¬îí+rµ$Çr¢‰Ù’$’2+rG¥’$’5Ù$4ÑïdUı5D%EÙîÂUBÁ6∆ñ6RÉ¬ó“≤+rgV∆¬7VóFRG¥’$’5ÙeTƒ≈ı5TïDUı5D%EÙîÂUBÁ6∆ñ6RÉ¬ó“∂”¬˜‡¢¬ˆ6ñFS‡†¢∂g&W6Öv&ÊñÊuÊV¬á6V∆V7FVEv&ÊñÊr¬Çí”‚6WE6V∆V7FVEv&ÊñÊtñBÜÁV∆¬íó–¢≈&F$ˆ'6W'fFñˆÂÊV¿¢ˆ'6W'fFñˆ„◊∑6V∆V7FVDˆ'6W'fFñˆÁ–¢'V˜ì◊∑6V∆V7FVD'V˜ó–¢ˆ‰6∆˜6S◊≤Çí”‚∞¢6WE6V∆V7FVDˆ'6W'fFñˆ‰ñBÜÁV∆¬ê¢6WE6V∆V7FVD'V˜îñBÜÁV∆¬ê¢◊–¢Û‡†¢«6V7Fñˆ‚6∆74Ê÷S◊∂&F"◊Fñ÷V∆ñÊRG∂g&÷W2Ê∆VÊwFÇ¬"Úw6ñÊv∆R÷g&÷Rr¢rw÷“&ñ÷∆&V√“%&F"Êñ÷Fñˆ‚6ˆÁG&ˆ«2#‡¢∆Fób6∆74Ê÷S“'&F"◊Fñ÷V∆ñÊR◊F˜#‡¢∆Fóc‡¢«7‚6∆74Ê÷S“'&F"◊ÊV¬÷∂ñ6∂W"#ÂFñ÷V∆ñÊS¬˜7„‡¢«7G&ˆÊsÁ∂7FófTg&÷RÚf˜&÷DV7FW&‰FFUFñ÷RÜ7FófTg&÷RÁf∆ñE˜Fñ÷Rí¢tÊÚg&÷R6V∆V7FVBw”¬˜7G&ˆÊs‡¢¬ˆFóc‡¢«7‚6∆74Ê÷S“'&F"÷g&÷R÷6˜VÁB#Á∂g&÷W2Ê∆VÊwFÇ””“Úsg&÷R+rvóFñÊrr¢g&÷W2Ê∆VÊwFÇÚG∂7FófTñÊFWÇ≤“ÚG∂g&÷W2Ê∆VÊwFá÷¢sg&÷W2w”¬˜7„‡¢¬ˆFóc‡¢∆ñÁW@¢6∆74Ê÷S“'&F"◊Fñ÷V∆ñÊR◊&ÊvR ¢GóS“'&ÊvR ¢÷ñ„“# ¢÷É◊¥÷FÇÊ÷ÇÜg&÷W2Ê∆VÊwFÇ“¬ó–¢7FW“# ¢f«VS◊∂7FófTñÊFWá–¢Fó6&∆VC◊∂g&÷W2Ê∆VÊwFÇ¬'–¢ˆ‰6ÜÊvS◊≤ÜWfVÁBí”‚∞¢6WE∆ññÊrÜf«6Rê¢6WDg&÷TñÊFWÇÑÁV÷&W"ÜWfVÁBÁF&vWBÁf«VRíê¢◊–¢&ñ÷∆&V√“%&F"g&÷RFñ÷V∆ñÊR ¢Û‡¢∆Fób6∆74Ê÷S“'&F"◊Fñ÷V∆ñÊR÷VÊGˆñÁG2#„«7„Á∂f˜&÷DV7FW&ÂFñ÷RÜg&÷W5≥”ÚÁf∆ñE˜Fñ÷Ró“UC¬˜7„„«7„Á∂∆FW7Dg&÷RÚG∂f˜&÷DV7FW&ÂFñ÷RÜ∆FW7Dg&÷RÁf∆ñE˜Fñ÷Ró“UB+rG∂ó4Üó7F˜&ñ6¬ÚvVÊBr¢v∆FW7Bw÷¢t∆FW7BVÊfñ∆&∆Rw”¬˜7„„¬ˆFóc‡¢∆Fób6∆74Ê÷S“'&F"÷6ˆÁG&ˆ¬◊&˜r"FF◊∆ñ&6≤÷÷ˆFS◊∂ó4W&RÚw&VÊ«ó6ó2r¢vˆ'6W'fVBw“FF◊∆ñ&6≤÷g3◊∑∆ñ&6¥g7”‡¢∆Fób6∆74Ê÷S“'&F"◊G&Á7˜'B÷6ˆÁG&ˆ¬#‡¢∆'WGFˆ‚GóS“&'WGFˆ‚"ˆ‰6∆ñ6≥◊≤Çí”‚≤6WE∆ññÊrÜf«6Rì≤6WDg&÷TñÊFWÇÇÜñÊFWÇí”‚÷FÇÊ÷ÇÉ¬ñÊFWÇ“íí◊“Fó6&∆VC◊≤g&÷W2Ê∆VÊwFÇ«¬7FófTñÊFWÇ””“”Ó(í«7„Â&Wfñ˜W3¬˜7„„¬ˆ'WGFˆ„‡¢∆'WGFˆ‚GóS“&'WGFˆ‚"6∆74Ê÷S“'&F"◊∆í÷'WGFˆ‚"ˆ‰6∆ñ6≥◊≤Çí”‚6WE∆ññÊrÇáf«VRí”‚f«VRó“Fó6&∆VC◊∂g&÷W2Ê∆VÊwFÇ¬'“FóF∆S◊∂g&÷W2Ê∆VÊwFÇ¬"ÚuvóFñÊrf˜"B∆V7BGvÚ&F"g&÷W2r¢VÊFVfñÊVG”Á∑∆ññÊrÚ~)ŸÆ)Ÿ¢W6Rr¢~)kb∆íw”¬ˆ'WGFˆ„‡¢∆'WGFˆ‚GóS“&'WGFˆ‚"ˆ‰6∆ñ6≥◊≤Çí”‚≤6WE∆ññÊrÜf«6Rì≤6WDg&÷TñÊFWÇÇÜñÊFWÇí”‚÷FÇÊ÷ñ‚Üg&÷W2Ê∆VÊwFÇ“¬ñÊFWÇ≤íí◊“Fó6&∆VC◊≤g&÷W2Ê∆VÊwFÇ«¬7FófTñÊFWÇ””“g&÷W2Ê∆VÊwFÇ“”„«7„‰ÊWáC¬˜7„‚(£¬ˆ'WGFˆ„‡¢¬ˆFóc‡¢∆Fób6∆74Ê÷S“'&F"◊∆ñ&6≤÷˜FñˆÁ2#‡¢«7‚6∆74Ê÷S◊∂&F"÷ˆ'6W'fVB÷&FvRG∂ó4W&RÚw&VÊ«ó6ó2r¢rw÷“FóF∆S◊∂ó4W&RÚtÜ˜W&«íU$R&VÊ«ó6ó2&V6ˆÁ7G'V7Fñˆ‚(	B∆ñÊV&«íñÁFW'ˆ∆FVBFó7∆í¬Ê˜Bˆ'6W'fVB&F"r¢∆ñ&6≤Fó7∆ó2WÜ7Bˆ'6W'fVBG∑6˜W&6T∆&V«“g&÷W6”Á∂ó4W&RÚtñÁFW'ˆ∆FVB&VÊ«ó6ó2r¢tˆ'6W'fVBw”¬˜7„‡¢«7‚6∆74Ê÷S“'&F"÷g2÷∆&V¬#‰e3¬˜7„‡¢∆Fób6∆74Ê÷S“'&F"◊7VVB÷6ˆÁG&ˆ¬"&ˆ∆S“&w&˜W"&ñ÷∆&V√“%∆ñ&6≤&FRñ‚g&÷W2W"6V6ˆÊB#‡¢µƒî$4µÙe5ÙıDîÙÂ2Ê÷Çáf«VRí”‚∆'WGFˆ‚∂Wì◊∑f«VW“GóS“&'WGFˆ‚"6∆74Ê÷S◊∑∆ñ&6¥g2””“f«VRÚv7FófRr¢rw“&ñ◊&W76VC◊∑∆ñ&6¥g2””“f«VW“&ñ÷∆&V√◊∂G∑f«VW“g&÷W2W"6V6ˆÊF“Fó6&∆VC◊∂g&÷W2Ê∆VÊwFÇ¬'“ˆ‰6∆ñ6≥◊≤Çí”‚6WE∆ñ&6¥g2áf«VRó”Á∑f«VW”¬ˆ'WGFˆ„‚ó–¢¬ˆFóc‡¢«6V∆V7@¢6∆74Ê÷S“'&F"÷÷ˆ&ñ∆R◊7VVB÷6ˆÁG&ˆ¬ ¢&ñ÷∆&V√“%∆ñ&6≤&FRñ‚g&÷W2W"6V6ˆÊB ¢f«VS◊∑∆ñ&6¥g7–¢Fó6&∆VC◊∂g&÷W2Ê∆VÊwFÇ¬'–¢FóF∆S◊∂g&÷W2Ê∆VÊwFÇ¬"ÚuvóFñÊrf˜"B∆V7BGvÚ&F"g&÷W2r¢VÊFVfñÊVG–¢ˆ‰6ÜÊvS◊≤ÜWfVÁBí”‚6WE∆ñ&6¥g2ÑÁV÷&W"ÜWfVÁBÁF&vWBÁf«VRí2áGóVˆbƒî$4µÙe5ÙıDîÙÂ2ï∂ÁV÷&W%“ó–¢‡¢µƒî$4µÙe5ÙıDîÙÂ2Ê÷Çáf«VRí”‚∆˜Fñˆ‚∂Wì◊∑f«VW“f«VS◊∑f«VW”Á∑f«VW“g3¬ˆ˜Fñˆ„‚ó–¢¬˜6V∆V7C‡¢∆'WGFˆ‚GóS“&'WGFˆ‚"6∆74Ê÷S“'&F"÷F˜vÊ∆ˆB÷'WGFˆ‚"ˆ‰6∆ñ6≥◊≤Çí”‚≤fˆñBWá˜'DvñbÇí◊“Fó6&∆VC◊∂vñdWá˜'FñÊr«¬g&÷W2Ê∆VÊwFá“FóF∆S“%6fR6Ü&R◊&VGítîbW6ñÊrFÜR7W'&VÁB÷fñWrÊB∆ñ&6≤e2#‡¢∂vñdWá˜'FñÊrÚtîbG∂vñdWá˜'E&ˆw&W77“V¢u6fRtîbw–¢¬ˆ'WGFˆ„‡¢∂∆ˆ˜F˜vÊ∆ˆEW&¬ÚÄ¢∆6∆74Ê÷S“'&F"◊7FFñ2÷F˜vÊ∆ˆB"á&Vc◊∂∆ˆ˜F˜vÊ∆ˆEW&«“F˜vÊ∆ˆC◊∂v∆¬÷6∆˜VB“G∂÷ÊñfW7CÚÊFF6WEˆñBÛÚv∆ófRw““G∑&ˆGV7DñG“÷'&ÊFVBÊvñf“FóF∆S“$F˜vÊ∆ˆBFÜR&ˆ6W76˜"÷vVÊW&FVB'&ÊFVB∆ˆ˜#‰'&ÊFVB∆ˆ˜¬ˆ‡¢í¢ÁV∆«–¢¬ˆFóc‡¢¬ˆFóc‡¢∂vñdWá˜'DW'&˜"bbÄ¢∆Fób6∆74Ê÷S“'&F"◊∆ñ&6≤÷Ê˜FR"&ñ÷∆ófS“'ˆ∆óFR#‡¢∂vñdWá˜'DW'&˜'–¢¬ˆFóc‡¢ó–¢¬˜6V7Fñˆ„‡¢¬ˆ÷ñ„‡¢¬ˆFóc‡¢êß–†