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
  if (!value) return 'â€”'
  const date = new Date(value)
  if (NumbÛŞúöÚ$z{-®éÜj×–öâ’Óâ÷F–öâç6÷W&6RÓÓÒ6÷W&6T–B’æÖ‚†÷F–öâ’Óâ°¢6öç7B7FGW2ÒÖæ–fW7Còç&öGV7G5¶÷F–öâæ–EÓòç7FGW0¢6öç7B&VG’Ò÷F–öâæ–BÓÓÒtÖW&vVE&VfÆV7F—f—G•46ö×÷6—FRrÇÂ7FGW2ÓÓÒw&VG’rÇÂ7FGW2ÓÓÒw'F–Âp¢&WGW&âÆ÷F–öâ¶W“×¶÷F–öâæ–GÒfÇVS×¶÷F–öâæ–GÒF—6&ÆVC×²&VG—Óç¶÷F–öâæÆ&VÇ×·&VG’òrr¢r+rVæf–Æ&ÆRwÓÂö÷F–öãà¢Ò—Ğ¢Â÷6VÆV7Cà¢ÂöF—cà ¢²$4„•dUôôäÅ’bb—4W&RbbÃà¢Ç6V7F–öâ6Æ74æÖSÒ'&F"×öÆÆ–ærÖ6öçG&öÂ&F"Öfö7W2Ö6öçG&öÂ"&–ÖÆ&VÃÒ%7F÷&Òfö7W2&F"6öçG&öÂ#à¢ÆF—cà¢Ç7â6Æ74æÖSÒ'&F"ÖÆ–W"×6V7F–öâÖ†VF–ær#äÕ$Õ27F÷&Òfö7W3Â÷7ãà¢Ç7G&öæsç°¢Æ—fUöÆÆ–æt6öæf–wW&V@¢òtFÖ–â6öçG&öÂVæf–Æ&ÆRp¢¢fö7W46öçG&öÃòæVæ&ÆV@¢òG¶fö7W46öçG&öÂç&Vv–öåöÆ&VÂóòu6VÆV7FVB&Vv–öâwÒ—27F—fV ¢¢u7F÷&Òfö7W2—2öfbp¢ÓÂ÷7G&öæsà¢Ç6ÖÆÃç°¢Æ—fUöÆÆ–æt6öæf–wW&V@¢òuF†RFÖ–æ—7G&F÷"6öçG&öÂ6W'f–6R—2æ÷B6öæf–wW&VB–âF†—2'V–ÆBâp¢¢fö7W46öçG&öÃòæVæ&ÆV@¢òf—fRÖÖ–çWFR&Vv–öæÂF–ÆW2VçF–ÂG¶f÷&ÖDV7FW&äFFUF–ÖR†fö7W46öçG&öÂæW‡—&W5öB—Òæ ¢¢töæR6VÆV7FVB&Vv–öâBF–ÖR+rWFöÖF–6ÆÇ’W‡—&W2gFW""†÷W'2âp¢ÓÂ÷6ÖÆÃà¢ÂöF—cà¢ÆÆ&VÂ6Æ74æÖSÒ'&F"Öfö7W2×&Vv–öâ#à¢fö7W2&Vv–öà¢Ç6VÆV7@¢fÇVS×¶fö7W5&Vv–öä–GĞ¢F—6&ÆVC×²Æ—fUöÆÆ–æt6öæf–wW&VBÇÂfö7W46öçG&öÄ'W7—Ğ¢öä6†ævS×²†WfVçB’Óâ6WDfö7W5&Vv–öä–B†WfVçBçF&vWBçfÇVR—Ğ¢à¢´Ôõ$Tt”ôå2æf–ÇFW"‚‡&Vv–öâ’Óâ&Vv–öâæ–BÓÒv6öçW2r’æÖ‚‡&Vv–öâ’Óâ€¢Æ÷F–öâ¶W“×·&Vv–öâæ–GÒfÇVS×·&Vv–öâæ–GÓç·&Vv–öâæÆ&VÇÓÂö÷F–öãà¢’—Ğ¢Â÷6VÆV7Cà¢ÂöÆ&VÃà¢ÆF—b6Æ74æÖSÒ'&F"Öfö7W2Ö7F–öç2#à¢Æ'WGFöà¢G—SÒ&'WGFöâ ¢6Æ74æÖS×¶&F"×öÆÆ–ær×FövvÆRG¶fö7W46öçG&öÃòæVæ&ÆVBòvVæ&ÆVBr¢rwÖĞ¢F—6&ÆVC×²Æ—fUöÆÆ–æt6öæf–wW&VBÇÂfö7W46öçG&öÄ'W7’ÇÂfö7W46öçG&öÂÓÓÒçVÆÇĞ¢öä6Æ–6³×²‚’Óâ²fö–B6†ævTfö7W57FFR‡G'VR’×Ğ¢à¢¶fö7W46öçG&öÄ'W7¢òu6f–æ~(
bp¢¢fö7W46öçG&öÃòæVæ&ÆVBbbfö7W46öçG&öÂç&Vv–öåö–BÓÓÒfö7W5&Vv–öâæ–@¢òtW‡FVæBfö7W2"†÷W'2p¢¢fö7W46öçG&öÃòæVæ&ÆV@¢ò7v—F6‚fö7W2FòG¶fö7W5&Vv–öâæÆ&VÇÖ ¢¢7F—fFRG¶fö7W5&Vv–öâæÆ&VÇÖĞ¢Âö'WGFöãà¢¶fö7W46öçG&öÃòæVæ&ÆVBbb€¢Æ'WGFöà¢G—SÒ&'WGFöâ ¢6Æ74æÖSÒ'&F"×öÆÆ–ær×FövvÆR&F"Öfö7W2Ööfb ¢F—6&ÆVC×¶fö7W46öçG&öÄ'W7—Ğ¢öä6Æ–6³×²‚’Óâ²fö–B6†ævTfö7W57FFR†fÇ6R’×Ğ¢à¢GW&âöfb7F÷&Òfö7W0¢Âö'WGFöãà¢—Ğ¢ÂöF—cà¢Â÷6V7F–öãà¢¶fö7W46öçG&öÄW'&÷"bbÇ6Æ74æÖSÒ'&F"Öf–VÆBÖæ÷FRW'&÷"#å7F÷&Òfö7W26öçG&öÃ¢¶fö7W46öçG&öÄW'&÷'ÓÂ÷çĞ ¢Ç6V7F–öâ6Æ74æÖSÒ'&F"×öÆÆ–ærÖ6öçG&öÂ"&–ÖÆ&VÃÒ$Æ—fR&F"fVVB6öçG&öÂ#à¢ÆF—cà¢Ç7â6Æ74æÖSÒ'&F"ÖÆ–W"×6V7F–öâÖ†VF–ær#äÆ—fRÆWfVÂ”’fVVCÂ÷7ãà¢Ç7G&öæsç²Æ—fUöÆÆ–æt6öæf–wW&VBòtFÖ–â6öçG&öÂVæf–Æ&ÆRr¢öÆÆ–æt6öçG&öÃòæVæ&ÆVBòtÆ—fRÆWfVÂ”’—2öâr¢tÆ—fRÆWfVÂ”’—2öfbwÓÂ÷7G&öæsà¢Ç6ÖÆÃç²Æ—fUöÆÆ–æt6öæf–wW&VBòuF†RFÖ–æ—7G&F÷"6öçG&öÂ6W'f–6R—2æ÷B6öæf–wW&VB–âF†—2'V–ÆBâr¢tFÖ–æ—7G&F÷"ÖöæÇ’RÖÖ–çWFRöÆÆ–ærâ&6†—fR'&÷w6–ær&VÖ–ç2V&Æ–2âwÓÂ÷6ÖÆÃà¢ÂöF—cà¢Æ'WGFöà¢G—SÒ&'WGFöâ ¢6Æ74æÖS×¶&F"×öÆÆ–ær×FövvÆRG·öÆÆ–æt6öçG&öÃòæVæ&ÆVBòvVæ&ÆVBr¢rwÖĞ¢&–×&W76VC×·öÆÆ–æt6öçG&öÃòæVæ&ÆVBÓÓÒG'VWĞ¢F—6&ÆVC×²Æ—fUöÆÆ–æt6öæf–wW&VBÇÂöÆÆ–æt6öçG&öÄ'W7’ÇÂöÆÆ–æt6öçG&öÂÓÓÒçVÆÇĞ¢öä6Æ–6³×²‚’Óâ²fö–B6†ævUöÆÆ–æu7FFR‡öÆÆ–æt6öçG&öÃòæVæ&ÆVBÓÒG'VR’×Ğ¢à¢·öÆÆ–æt6öçG&öÄ'W7’òu6f–æ~(
br¢öÆÆ–æt6öçG&öÃòæVæ&ÆVBòuGW&âöfbÆ—fRÆWfVÂ”’„FÖ–â’r¢uGW&âöâÆ—fRÆWfVÂ”’„FÖ–â’wĞ¢Âö'WGFöãà¢Â÷6V7F–öãà¢·öÆÆ–æt6öçG&öÄW'&÷"bbÇ6Æ74æÖSÒ'&F"Öf–VÆBÖæ÷FRW'&÷"#äÆ—fRfVVB6öçG&öÃ¢·öÆÆ–æt6öçG&öÄW'&÷'ÓÂ÷çĞ¢ÂóçĞ ¢Ç6V7F–öâ6Æ74æÖSÒ'&F"Ö†—7F÷'’×&WVW7B"&–ÖÆ&VÃ×¶&6†—fRG·6÷W&6TÆ&VÇÒ6²&WVW7FÓà¢ÆF—b6Æ74æÖSÒ'&F"ÖÆ–W"×6V7F–öâÖ†VF–ær#ävVæW&FR&6†—fRÇ6ÖÆÃäV7FW&âF–ÖR+r¶—4·&‚òvFÖ–â¶W’r¢wV&Æ–2wÓÂ÷6ÖÆÃãÂöF—cà¢ÆF—b6Æ74æÖSÒ'&F"Ö†—7F÷'’Öf–VÆG2#à¢ÆÆ&VÃå7F'CÆ–çWBG—SÒ&FFWF–ÖRÖÆö6Â"Ö–ã×·6÷W&6T–BÓÓÒv×&×2ròÕ$Õ5ô$4„•dUõ5D%Eô”åUB¢VæFVf–æVGÒ7FW×¶—4W&Rò3c¢cÒfÇVS×¶†—7F÷'•7F'GÒöä6†ævS×²†WfVçB’Óâ²6WD†—7F÷'•7F'B†WfVçBçF&vWBçfÇVR“²6WD†—7F÷'•&WVW7DW'&÷"†çVÆÂ’×ÒóãÂöÆ&VÃà¢ÆÆ&VÃäVæCÆ–çWBG—SÒ&FFWF–ÖRÖÆö6Â"Ö–ã×·6÷W&6T–BÓÓÒv×&×2ròÕ$Õ5ô$4„•dUõ5D%Eô”åUB¢VæFVf–æVGÒ7FW×¶—4W&Rò3c¢cÒfÇVS×¶†—7F÷'”VæGÒöä6†ævS×²†WfVçB’Óâ²6WD†—7F÷'”VæB†WfVçBçF&vWBçfÇVR“²6WD†—7F÷'•&WVW7DW'&÷"†çVÆÂ’×ÒóãÂöÆ&VÃà¢ÂöF—cà¢¶—4W&RbbÇ6Æ74æÖSÒ'&F"Öf–VÆBÖæ÷FR#åv†öÆR†÷W'2öæÇ’+rf–Æ&ÆRg&öÒ“CãÂ÷çĞ¢²—4·&‚bb€¢ÆÆ&VÂ6Æ74æÖSÒ'&F"Ö†—7F÷'’×&Vv–öâ#à¢&Vv–öà¢Ç6VÆV7BfÇVS×¶†—7F÷'•&Vv–öä–GÒöä6†ævS×²†WfVçB’Óâ²6WD†—7F÷'•&Vv–öä–B†WfVçBçF&vWBçfÇVR“²6WD†—7F÷'•&WVW7DW'&÷"†çVÆÂ’×Óà¢Æ÷F–öâfÇVSÒ&7W'&VçB×f–Wr#ä7W'&VçBÖf–WsÂö÷F–öãà¢´Ôõ$Tt”ôå2æÖ‚‡&Vv–öâ’Óâ€¢Æ÷F–öâ¶W“×·&Vv–öâæ–GÒfÇVS×·&Vv–öâæ–GÓç·&Vv–öâæÆ&VÇÓÂö÷F–öãà¢’—Ğ¢Â÷6VÆV7Cà¢ÂöÆ&VÃà¢—Ğ¢Æ'WGFöà¢G—SÒ&'WGFöâ ¢6Æ74æÖSÒ'&F"Ö†—7F÷'’×&WVW7BÖ'WGFöâ ¢F—6&ÆVC×²Æ—fUöÆÆ–æt6öæf–wW&VBÇÂ†—7F÷'•&WVW7D'W7’ÇÂ†—7F÷'•7F'BÇÂ†—7F÷'”VæBÇÂ&ööÆVâ††—7F÷'”6÷fW&vTVçG'’—Ğ¢öä6Æ–6³×²‚’Óâ²fö–B&WVW7D†—7F÷&–6ÄÆö÷‚’×Ğ¢à¢¶†—7F÷'•&WVW7D'W7’òu7F'F–æ~(
br¢†—7F÷'”6÷fW&vTVçG'’òtÇ&VG’vVæW&FVBr¢tvVæW&FR6²wĞ¢Âö'WGFöãà¢¶†—7F÷'”6÷fW&vTVçG'’bbÇ6Æ74æÖSÒ'&F"Öf–VÆBÖæ÷FR"&öÆSÒ'7FGW2#äÇ&VG’f–Æ&ÆS¢¶†—7F÷'”VçG'”Æ&VÂ††—7F÷'”6÷fW&vTVçG'’—Òâ6VÆV7B—B&÷fR÷"W‡FVæBF†R&ævRãÂ÷çĞ¢²Æ—fUöÆÆ–æt6öæf–wW&VBbbÇ6Æ74æÖSÒ'&F"Öf–VÆBÖæ÷FR#ävVæW&F÷"Væf–Æ&ÆR–âF†—2'V–ÆBãÂ÷çĞ¢¶†—7F÷'”¦ö%7FGW2bbÇ6Æ74æÖS×¶&F"Öf–VÆBÖæ÷FRG¶†—7F÷'”¦ö%7FGW2ç7FGW2ÓÓÒvf–ÆVBròvW'&÷"r¢rwÖÒ&öÆSÒ'7FGW2#ä¦ö"¶†—7F÷'”¦ö%7FGW2ç7FGW7×¶†—7F÷'”¦ö%7FGW2ç7FvRò+rG¶†—7F÷'”¦ö%7FGW2ç7FvWÖ¢†—7F÷'”¦ö%7FGW2æÖW76vRò+rG¶†—7F÷'”¦ö%7FGW2æÖW76vWÖ¢rwÓÂ÷çĞ¢¶†—7F÷'•&WVW7DW'&÷"bbÇ6Æ74æÖSÒ'&F"Öf–VÆBÖæ÷FRW'&÷"#ç¶†—7F÷'•&WVW7DW'&÷'ÓÂ÷çĞ¢Â÷6V7F–öãà ¢¶æÇ—6—5Æ–&6´f–Æ&ÆRbbÆF—b6Æ74æÖSÒ'&F"ÖÆ–W"ÖÆ—7B#à¢ÆF—b6Æ74æÖSÒ'&F"ÖÆ–W"×6V7F–öâÖ†VF–ær#äÕ$Õ2&öGV7G3ÂöF—cà¢´äÅ•4•5ôÄ”U%ôDTd”ä•D”ôå2æf–ÇFW"‚†FVf–æ—F–öâ’ÓâFVf–æ—F–öâæ¶W’ÓÒw&–æfÆÂr’æÖ‚†FVf–æ—F–öâ’Óâ°¢6öç7B&öGV7BÒÖæ–fW7Còç&öGV7G5¶FVf–æ—F–öâç&öGV7D–EĞ¢6öç7B&VG’Ò&öGV7Còç7FGW2ÓÓÒw&VG’rÇÂ&öGV7Còç7FGW2ÓÓÒw'F–Âp¢6öç7Bæ÷FRÒ&VG’òFVf–æ—F–öâææ÷FR¢&öGV7Còææ÷FW2óòtæ÷B–æ6ÇVFVB–âF†—2&6†—fR6²p¢&WGW&â€¢ÆÆ&VÂ¶W“×¶FVf–æ—F–öâæ¶W—Ò6Æ74æÖSÒ'&F"ÖÆ–W"×&÷r#à¢Æ–çWBG—SÒ&6†V6¶&÷‚"6†V6¶VC×¶Æ–W'5¶FVf–æ—F–öâæ¶W•×Òöä6†ævS×²‚’ÓâFövvÆTÆ–W"†FVf–æ—F–öâæ¶W’—ÒF—6&ÆVC×²&VG—Òóà¢Ç7â6Æ74æÖSÒ'&F"Ö6†V6¶&÷‚"&–Ö†–FFVãÒ'G'VR"óà¢Ç7ããÇ7G&öæsç¶FVf–æ—F–öâæÆ&VÇÓÂ÷7G&öæsãÇ6ÖÆÃç¶æ÷FWÓÂ÷6ÖÆÃãÂ÷7ãà¢ÂöÆ&VÃà¢¢Ò—Ğ¢ÂöF—cçĞ ¢ÆF—b6Æ74æÖSÒ'&F"ÖÆ–W"ÖÆ—7B#à¢ÆF—b6Æ74æÖSÒ'&F"ÖÆ–W"×6V7F–öâÖ†VF–ær#äÖ÷fW&Æ—3ÂöF—cà¢²…°¢²w&F"rÂt&6†—fRÆ–W"uÒÀ¢²v6÷VçF–W2rÂt6÷VçF–W2uÒÀ¢²v6—F–W2rÂt6—F–W2uÒÀ¢²v†–v‡v—2rÂ†–v‡v—4ÆöF–æròt†–v‡v—2†ÆöF–æ~(
b’r¢t†–v‡v—2uÒÀ¢Ò2'&“Å¶¶W–öbG—VöbÆ–W'2Â7G&–æuÓâ’æÖ‚…¶¶W’ÂÆ&VÅÒ’Óâ€¢ÆÆ&VÂ¶W“×¶¶W—Ò6Æ74æÖSÒ'&F"ÖÆ–W"×&÷r#à¢Æ–çWBG—SÒ&6†V6¶&÷‚"6†V6¶VC×¶Æ–W'5¶¶W•×Òöä6†ævS×²‚’ÓâFövvÆTÆ–W"†¶W’—ÒF—6&ÆVC×¶¶W’ÓÓÒwv&æ–æw2rbb—4†—7F÷&–6ÇÒóà¢Ç7â6Æ74æÖSÒ'&F"Ö6†V6¶&÷‚"&–Ö†–FFVãÒ'G'VR"óà¢Ç7ããÇ7G&öæsç¶Æ&VÇÓÂ÷7G&öæsãÂ÷7ãà¢ÂöÆ&VÃà¢’—Ğ¢ÂöF—cà ¢ÆÆ&VÂ6Æ74æÖSÒ'&F"Öf–VÆBÖÆ&VÂ"‡FÖÄf÷#Ò'&F"Ö÷6—G’#ä&6†—fRÆ–W"÷6—G’Æ÷WGWCç´ÖF‚ç&÷VæB‡&F$÷6—G’¢—ÒSÂö÷WGWCãÂöÆ&VÃà¢Æ–çWB–CÒ'&F"Ö÷6—G’"6Æ74æÖSÒ'&F"×&ævR"G—SÒ'&ævR"Ö–ãÒ#ã""ÖƒÒ#"7FWÒ#ãR"fÇVS×·&F$÷6—G—Òöä6†ævS×²†WfVçB’Óâ6WE&F$÷6—G’„çVÖ&W"†WfVçBçF&vWBçfÇVR’—Òóà¢¶†–v‡v—4W'&÷"bbÇ6Æ74æÖSÒ'&F"Öf–VÆBÖæ÷FRW'&÷"#ä†–v‡v’÷fW&Æ’Væf–Æ&ÆS¢¶†–v‡v—4W'&÷'ÓÂ÷çĞ¢·v&æ–ætW'&÷'2æÆVæwF‚âbbÇ6Æ74æÖSÒ'&F"Öf–VÆBÖæ÷FRW'&÷"#äåu3¢6†÷v–ærF†RÆ7B7V66W76gVÂ&Vv–öæÂ&W7VÇBv†W&Rf–Æ&ÆRãÂ÷çĞ¢·7W&f6TW'&÷"bbÇ6Æ74æÖSÒ'&F"Öf–VÆBÖæ÷FRW'&÷"#å7W&f6Rö'6W'fF–öç3¢·7W&f6TW'&÷'ÓÂ÷çĞ¢¶'V÷”W'&÷"bbÇ6Æ74æÖSÒ'&F"Öf–VÆBÖæ÷FRW'&÷"#ä'V÷—3¢¶'V÷”W'&÷'ÓÂ÷çĞ¢Ç6Æ74æÖSÒ'&F"×6÷W&6RÖæ÷FR#ç¶—4W&RòtU$RòT4Õtb+r†÷W&Ç’ã#\+&VæÇ—6—2+r–çFW'öÆFVBF—7Æ’+ræ÷B&F"r¢—4·&‚òtäôäU…$BÆWfVÂ”’+rµ$‚r¢äôÕ$Õ2+rG´Õ$Õ5ô$4„•dUõ5D%Eô”åUBç6Æ–6RƒÂ—Ò²+rgVÆÂ7V—FRG´Õ$Õ5ôeTÄÅõ5T•DUõ5D%Eô”åUBç6Æ–6RƒÂ—Ò¶ÓÂ÷à¢Âö6–FSà ¢¶g&W6…v&æ–æuæVÂ‡6VÆV7FVEv&æ–ærÂ‚’Óâ6WE6VÆV7FVEv&æ–æt–B†çVÆÂ’—Ğ¢Å&F$ö'6W'fF–öåæVÀ¢ö'6W'fF–öã×·6VÆV7FVDö'6W'fF–öçĞ¢'V÷“×·6VÆV7FVD'V÷—Ğ¢öä6Æ÷6S×²‚’Óâ°¢6WE6VÆV7FVDö'6W'fF–öä–B†çVÆÂ¢6WE6VÆV7FVD'V÷”–B†çVÆÂ¢×Ğ¢óà ¢Ç6V7F–öâ6Æ74æÖS×¶&F"×F–ÖVÆ–æRG¶g&ÖW2æÆVæwF‚Â"òw6–ævÆRÖg&ÖRr¢rwÖÒ&–ÖÆ&VÃÒ%&F"æ–ÖF–öâ6öçG&öÇ2#à¢ÆF—b6Æ74æÖSÒ'&F"×F–ÖVÆ–æR×F÷#à¢ÆF—cà¢Ç7â6Æ74æÖSÒ'&F"×æVÂÖ¶–6¶W"#åF–ÖVÆ–æSÂ÷7ãà¢Ç7G&öæsç¶7F—fTg&ÖRòf÷&ÖDV7FW&äFFUF–ÖR†7F—fTg&ÖRçfÆ–E÷F–ÖR’¢tæòg&ÖR6VÆV7FVBwÓÂ÷7G&öæsà¢ÂöF—cà¢Ç7â6Æ74æÖSÒ'&F"Ög&ÖRÖ6÷VçB#ç¶g&ÖW2æÆVæwF‚ÓÓÒòsg&ÖR+rv—F–ærr¢g&ÖW2æÆVæwF‚òG¶7F—fT–æFW‚²ÒòG¶g&ÖW2æÆVæwF‡Ö¢sg&ÖW2wÓÂ÷7ãà¢ÂöF—cà¢Æ–çW@¢6Æ74æÖSÒ'&F"×F–ÖVÆ–æR×&ævR ¢G—SÒ'&ævR ¢Ö–ãÒ# ¢Öƒ×´ÖF‚æÖ‚†g&ÖW2æÆVæwF‚ÒÂ—Ğ¢7FWÒ# ¢fÇVS×¶7F—fT–æFW‡Ğ¢F—6&ÆVC×¶g&ÖW2æÆVæwF‚Â'Ğ¢öä6†ævS×²†WfVçB’Óâ°¢6WEÆ––ær†fÇ6R¢6WDg&ÖT–æFW‚„çVÖ&W"†WfVçBçF&vWBçfÇVR’¢×Ğ¢&–ÖÆ&VÃÒ%&F"g&ÖRF–ÖVÆ–æR ¢óà¢ÆF—b6Æ74æÖSÒ'&F"×F–ÖVÆ–æRÖVæGö–çG2#ãÇ7ãç¶f÷&ÖDV7FW&åF–ÖR†g&ÖW5³ÓòçfÆ–E÷F–ÖR—ÒUCÂ÷7ããÇ7ãç¶ÆFW7Dg&ÖRòG¶f÷&ÖDV7FW&åF–ÖR†ÆFW7Dg&ÖRçfÆ–E÷F–ÖR—ÒUB+rG¶—4†—7F÷&–6ÂòvVæBr¢vÆFW7BwÖ¢tÆFW7BVæf–Æ&ÆRwÓÂ÷7ããÂöF—cà¢ÆF—b6Æ74æÖSÒ'&F"Ö6öçG&öÂ×&÷r"FF×Æ–&6²ÖÖöFS×¶—4W&Ròw&VæÇ—6—2r¢vö'6W'fVBwÒFF×Æ–&6²Ög3×·Æ–&6´g7Óà¢ÆF—b6Æ74æÖSÒ'&F"×G&ç7÷'BÖ6öçG&öÂ#à¢Æ'WGFöâG—SÒ&'WGFöâ"öä6Æ–6³×²‚’Óâ²6WEÆ––ær†fÇ6R“²6WDg&ÖT–æFW‚‚†–æFW‚’ÓâÖF‚æÖ‚ƒÂ–æFW‚Ò’’×ÒF—6&ÆVC×²g&ÖW2æÆVæwF‚ÇÂ7F—fT–æFW‚ÓÓÒÓî(’Ç7ãå&Wf–÷W3Â÷7ããÂö'WGFöãà¢Æ'WGFöâG—SÒ&'WGFöâ"6Æ74æÖSÒ'&F"×Æ’Ö'WGFöâ"öä6Æ–6³×²‚’Óâ6WEÆ––ær‚‡fÇVR’ÓâfÇVR—ÒF—6&ÆVC×¶g&ÖW2æÆVæwF‚Â'ÒF—FÆS×¶g&ÖW2æÆVæwF‚Â"òuv—F–ærf÷"BÆV7BGvò&F"g&ÖW2r¢VæFVf–æVGÓç·Æ––ærò~)Ù®)Ù¢W6Rr¢~)kbÆ’wÓÂö'WGFöãà¢Æ'WGFöâG—SÒ&'WGFöâ"öä6Æ–6³×²‚’Óâ²6WEÆ––ær†fÇ6R“²6WDg&ÖT–æFW‚‚†–æFW‚’ÓâÖF‚æÖ–â†g&ÖW2æÆVæwF‚ÒÂ–æFW‚²’’×ÒF—6&ÆVC×²g&ÖW2æÆVæwF‚ÇÂ7F—fT–æFW‚ÓÓÒg&ÖW2æÆVæwF‚ÒÓãÇ7ãäæW‡CÂ÷7ãâ(£Âö'WGFöãà¢ÂöF—cà¢ÆF—b6Æ74æÖSÒ'&F"×Æ–&6²Ö÷F–öç2#à¢Ç7â6Æ74æÖS×¶&F"Öö'6W'fVBÖ&FvRG¶—4W&Ròw&VæÇ—6—2r¢rwÖÒF—FÆS×¶—4W&Ròt†÷W&Ç’U$R&VæÇ—6—2&V6öç7G'V7F–öâ(	BÆ–æV&Ç’–çFW'öÆFVBF—7Æ’Âæ÷Bö'6W'fVB&F"r¢Æ–&6²F—7Æ—2W†7Bö'6W'fVBG·6÷W&6TÆ&VÇÒg&ÖW6Óç¶—4W&Ròt–çFW'öÆFVB&VæÇ—6—2r¢tö'6W'fVBwÓÂ÷7ãà¢Ç7â6Æ74æÖSÒ'&F"Ög2ÖÆ&VÂ#äe3Â÷7ãà¢ÆF—b6Æ74æÖSÒ'&F"×7VVBÖ6öçG&öÂ"&öÆSÒ&w&÷W"&–ÖÆ&VÃÒ%Æ–&6²&FR–âg&ÖW2W"6V6öæB#à¢µÄ”$4µôe5ôõD”ôå2æÖ‚‡fÇVR’ÓâÆ'WGFöâ¶W“×·fÇVWÒG—SÒ&'WGFöâ"6Æ74æÖS×·Æ–&6´g2ÓÓÒfÇVRòv7F—fRr¢rwÒ&–×&W76VC×·Æ–&6´g2ÓÓÒfÇVWÒ&–ÖÆ&VÃ×¶G·fÇVWÒg&ÖW2W"6V6öæFÒF—6&ÆVC×¶g&ÖW2æÆVæwF‚Â'Òöä6Æ–6³×²‚’Óâ6WEÆ–&6´g2‡fÇVR—Óç·fÇVWÓÂö'WGFöãâ—Ğ¢ÂöF—cà¢Ç6VÆV7@¢6Æ74æÖSÒ'&F"ÖÖö&–ÆR×7VVBÖ6öçG&öÂ ¢&–ÖÆ&VÃÒ%Æ–&6²&FR–âg&ÖW2W"6V6öæB ¢fÇVS×·Æ–&6´g7Ğ¢F—6&ÆVC×¶g&ÖW2æÆVæwF‚Â'Ğ¢F—FÆS×¶g&ÖW2æÆVæwF‚Â"òuv—F–ærf÷"BÆV7BGvò&F"g&ÖW2r¢VæFVf–æVGĞ¢öä6†ævS×²†WfVçB’Óâ6WEÆ–&6´g2„çVÖ&W"†WfVçBçF&vWBçfÇVR’2‡G—VöbÄ”$4µôe5ôõD”ôå2•¶çVÖ&W%Ò—Ğ¢à¢µÄ”$4µôe5ôõD”ôå2æÖ‚‡fÇVR’ÓâÆ÷F–öâ¶W“×·fÇVWÒfÇVS×·fÇVWÓç·fÇVWÒg3Âö÷F–öãâ—Ğ¢Â÷6VÆV7Cà¢Æ'WGFöâG—SÒ&'WGFöâ"6Æ74æÖSÒ'&F"ÖF÷væÆöBÖ'WGFöâ"öä6Æ–6³×²‚’Óâ²fö–BW‡÷'Dv–b‚’×ÒF—6&ÆVC×¶v–dW‡÷'F–ærÇÂg&ÖW2æÆVæwF‡ÒF—FÆSÒ%6fR6†&R×&VG’t”bW6–ærF†R7W'&VçBÖf–WræBÆ–&6²e2#à¢¶v–dW‡÷'F–æròt”bG¶v–dW‡÷'E&öw&W77ÒV¢u6fRt”bwĞ¢Âö'WGFöãà¢¶Æö÷F÷væÆöEW&Âò€¢Æ6Æ74æÖSÒ'&F"×7FF–2ÖF÷væÆöB"‡&Vc×¶Æö÷F÷væÆöEW&ÇÒF÷væÆöC×¶vÆÂÖ6Æ÷VBÒG¶Öæ–fW7CòæFF6WEö–BóòvÆ—fRwÒÒG·&öGV7D–GÒÖ'&æFVBæv–fÒF—FÆSÒ$F÷væÆöBF†R&ö6W76÷"ÖvVæW&FVB'&æFVBÆö÷#ä'&æFVBÆö÷Âöà¢’¢çVÆÇĞ¢ÂöF—cà¢ÂöF—cà¢¶v–dW‡÷'DW'&÷"bb€¢ÆF—b6Æ74æÖSÒ'&F"×Æ–&6²Öæ÷FR"&–ÖÆ—fSÒ'öÆ—FR#à¢¶v–dW‡÷'DW'&÷'Ğ¢ÂöF—cà¢—Ğ¢Â÷6V7F–öãà¢ÂöÖ–ãà¢ÂöF—cà¢§Ğ