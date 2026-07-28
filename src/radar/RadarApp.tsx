import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import maplibregl from 'maplibre-gl'
import { PMTiles, Protocol } from 'pmtiles'
import 'maplibre-gl/dist/maplibre-gl.css'
import { ANALYSIS_LAYER_DEFINITIONS, CARTO_LIGHT_TILES, CITIES, CITIES_GEOJSON, CORRELATION_LEGEND, GRID_GEOJSON, MAP_CENTER, MAP_REGIONS, NATIONAL_BOUNDS, PRECIP_LEGEND, PRODUCT_OPTIONS, RAINFALL_LEGEND, REFLECTIVITY_LEGEND, REGIONAL_BOUNDS, VELOCITY_LEGEND, type AnalysisLayerKey } from './config'
import { emptyFeatureCollection, fetchBuoyObservations, fetchHistoryCatalog, fetchRadarManifest, fetchRegionalGeography, fetchRegionalHighways, fetchRegionalSurfaceObservations, fetchRegionalWarnings, warningsFeatureCollection } from './data'
import { encodeGif, GIF_HEIGHT_LIMIT, GIF_WIDTH_LIMIT, LATEST_FRAME_HOLD_MS } from './gif'
import type { BuoyObservation, RadarFrameManifest, RadarHistoryCatalog, RadarManifest, RadarManifestProductId, RadarProductId, RadarSourceId, RadarWarning, SurfaceObservation } from './types'
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
}
const FOCUS_MANIFEST_PATH = `${RADAR_DATA_BASE_URL}radar/focus/manifest.json`
const HISTORY_CATALOG_PATHS: Record<RadarSourceId, string> = {
  mrms: `${RADAR_DATA_BASE_URL}radar/history/catalog.json`,
  krax: `${RADAR_DATA_BASE_URL}radar/krax/history/catalog.json`,
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
  source?: string
  dataset_id?: string
  manifest_url?: string
  message?: string
  execution?: string
}

function initialMapZoom(): number {
  if (window.innerWidth <= 680) return 2.55
  if (window.innerWidth <= 1024) return 2.8
  return 3.25
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
}, token: string): Promise<HistoryJobStatus> {
  const response = await fetch(`${RADAR_CONTROL_API_URL}/history/jobs`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
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
    filter: ['!=', ['…23231 tokens truncated…_Pass1' && <p className="radar-field-note">MRMS one-hour quantitative precipitation estimate in millimeters.</p>}
          {productId === 'NEXRADLevel2BaseReflectivity' && <p className="radar-field-note">Level II reflectivity from the lowest available elevation sweep. Coverage and beam height vary with range from the radar.</p>}
          {productId === 'NEXRADLevel2Velocity' && <p className="radar-field-note">Radial velocity in meters per second from the lowest sweep. Positive and negative motion are shown with a diverging palette.</p>}
          {productId === 'NEXRADLevel2CorrelationCoefficient' && <p className="radar-field-note">Correlation coefficient (ρhv) from the lowest sweep. Lower values can help identify non-meteorological echoes.</p>}

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

          <section className="radar-history-request" aria-label={`Historical ${sourceLabel} radar request`}>
            <div className="radar-layer-section-heading">Historical GIF maker <small>{isKrax ? 'Level II' : 'MRMS regional'} · Eastern Time · owner key required</small></div>
            <div className="radar-history-fields">
              <label>Start<input type="datetime-local" value={historyStart} onChange={(event) => setHistoryStart(event.target.value)} /></label>
              <label>End<input type="datetime-local" value={historyEnd} onChange={(event) => setHistoryEnd(event.target.value)} /></label>
            </div>
            {!isKrax && (
              <label className="radar-history-region">
                Export region
                <select value={historyRegionId} onChange={(event) => setHistoryRegionId(event.target.value)}>
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
              disabled={!livePollingConfigured || historyRequestBusy || !historyStart || !historyEnd}
              onClick={() => { void requestHistoricalLoop() }}
            >
              {historyRequestBusy ? 'Starting job…' : 'Generate historical loop'}
            </button>
            {!livePollingConfigured && <p className="radar-field-note">The Cloud Run historical service is not configured in this build.</p>}
            {historyJobStatus && <p className={`radar-field-note ${historyJobStatus.status === 'failed' ? 'error' : ''}`} role="status">History job {historyJobStatus.status}{historyJobStatus.message ? ` · ${historyJobStatus.message}` : ''}</p>}
            {historyRequestError && <p className="radar-field-note error">Historical job: {historyRequestError}</p>}
          </section>

          <div className="radar-layer-list">
            <div className="radar-layer-section-heading">Storm analysis <small>{stormAnalysisAvailable ? 'latest generated analysis' : 'MRMS mosaic only'}</small></div>
            {!stormAnalysisAvailable && <p className="radar-field-note">Storm Analysis unavailable with Level II — select the MRMS national mosaic.</p>}
            {stormAnalysisAvailable && ANALYSIS_LAYER_DEFINITIONS.filter((definition) => definition.key !== 'rainfall').map((definition) => {
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
              ['cities', 'Cities', 'Priority U.S. cities'],
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
          <div className="radar-control-row" data-playback-mode="observed" data-playback-fps={playbackFps}>
            <div className="radar-transport-control">
              <button type="button" onClick={() => { setPlaying(false); setFrameIndex((index) => Math.max(0, index - 1)) }} disabled={!frames.length || activeIndex === 0}>‹ <span>Previous</span></button>
              <button type="button" className="radar-play-button" onClick={() => setPlaying((value) => !value)} disabled={frames.length < 2} title={frames.length < 2 ? 'Waiting for at least two radar frames' : undefined}>{playing ? '❚❚ Pause' : '▶ Play'}</button>
              <button type="button" onClick={() => { setPlaying(false); setFrameIndex((index) => Math.min(frames.length - 1, index + 1)) }} disabled={!frames.length || activeIndex === frames.length - 1}><span>Next</span> ›</button>
            </div>
            <div className="radar-playback-options">
              <span className="radar-observed-badge" title={`Playback displays exact observed ${sourceLabel} frames`}>Observed</span>
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
          {(gifExportError || (activeAge !== null && !isLatest && !isHistorical)) && (
            <div className="radar-playback-note" aria-live="polite">
              {gifExportError ?? `Playback frame · latest observation is ${Math.max(0, latestAge ?? 0)} min old`}
            </div>
          )}
        </section>
      </main>
    </div>
  )
}
