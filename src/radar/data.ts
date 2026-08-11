import {
  CENSUS_GEOGRAPHY_BASE,
  CENSUS_TRANSPORTATION_BASE,
  NWS_ALERT_AREAS,
  NATIONAL_BOUNDS,
  REGIONAL_BOUNDS,
  WARNING_EVENTS,
} from './config'
import type {
  BuoyObservation,
  BuoyObservationsResult,
  RadarHistoryCatalog,
  RadarManifest,
  RadarWarning,
  SurfaceObservation,
  SurfaceObservationsResult,
  WarningsResult,
} from './types'

const REQUEST_TIMEOUT_MS = 20_000
const IEM_WARNING_ARCHIVE_URL = 'https://mesonet.agron.iastate.edu/cgi-bin/request/gis/watchwarn.py'

interface NwsAlertFeature {
  id?: string
  geometry?: GeoJSON.Geometry | null
  properties?: {
    event?: string
    senderName?: string
    areaDesc?: string
    effective?: string | null
    expires?: string | null
    headline?: string
    sent?: string | null
    '@id'?: string
  }
}

interface NwsAlertResponse {
  features?: NwsAlertFeature[]
}

interface NwsStationFeature {
  id?: string
  geometry?: { type: 'Point'; coordinates: [number, number] } | null
  properties?: {
    stationIdentifier?: string
    name?: string
  }
}

interface NwsStationResponse {
  features?: NwsStationFeature[]
}

interface NwsQuantity {
  value?: number | null
  unitCode?: string | null
}

interface NwsObservationResponse {
  properties?: {
    timestamp?: string | null
    textDescription?: string | null
    temperature?: NwsQuantity | null
    dewpoint?: NwsQuantity | null
    windDirection?: NwsQuantity | null
    windSpeed?: NwsQuantity | null
    windGust?: NwsQuantity | null
    barometricPressure?: NwsQuantity | null
    relativeHumidity?: NwsQuantity | null
  }
}

interface BuoyFeedPayload {
  status: 'ready' | 'unavailable'
  generated_at?: string | null
  source?: string
  stations?: Array<Record<string, unknown>>
  notes?: string
}

function emptyFeatureCollection(): GeoJSON.FeatureCollection {
  return { type: 'FeatureCollection', features: [] }
}

function freshStaticJsonUrl(path: string): string {
  const url = new URL(path, window.location.href)
  url.searchParams.set('_wallcloud_refresh', Date.now().toString())
  return url.toString()
}

async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  const relayAbort = () => controller.abort()
  signal?.addEventListener('abort', relayAbort, { once: true })
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      cache: 'no-store',
      headers: { Accept: 'application/geo+json, application/json' },
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return await response.json() as T
  } finally {
    window.clearTimeout(timeout)
    signal?.removeEventListener('abort', relayAbort)
  }
}

async function fetchText(url: string, signal?: AbortSignal): Promise<string> {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  const relayAbort = () => controller.abort()
  signal?.addEventListener('abort', relayAbort, { once: true })
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      cache: 'no-store',
      headers: { Accept: 'application/vnd.google-earth.kml+xml, text/xml' },
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return await response.text()
  } finally {
    window.clearTimeout(timeout)
    signal?.removeEventListener('abort', relayAbort)
  }
}

export async function fetchRadarManifest(path: string, signal?: AbortSignal): Promise<RadarManifest> {
  const payload = await fetchJson<RadarManifest>(freshStaticJsonUrl(path), signal)
  if (!payload || typeof payload !== 'object' || !payload.products) {
    throw new Error('Radar manifest has an unsupported shape')
  }
  return payload
}

export async function fetchHistoryCatalog(path: string, signal?: AbortSignal): Promise<RadarHistoryCatalog> {
  let payload: RadarHistoryCatalog
  try {
    payload = await fetchJson<RadarHistoryCatalog>(freshStaticJsonUrl(path), signal)
  } catch (error) {
    if (error instanceof Error && error.message === 'HTTP 404') {
      return { schema_version: 1, generated_at: null, datasets: [] }
    }
    throw error
  }
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.datasets)) {
    throw new Error('Historical radar catalog has an unsupported shape')
  }
  return payload
}

function isSupportedWarning(event: string | undefined): event is RadarWarning['event'] {
  return Boolean(event && (WARNING_EVENTS as readonly string[]).includes(event))
}

function toWarning(feature: NwsAlertFeature, fallbackId: string, sourceUrl: string): RadarWarning | null {
  const properties = feature.properties ?? {}
  if (!isSupportedWarning(properties.event) || !feature.geometry) return null
  return {
    id: feature.id ?? properties['@id'] ?? fallbackId,
    event: properties.event,
    issuingOffice: properties.senderName ?? 'National Weather Service',
    areaDesc: properties.areaDesc ?? 'Area not provided',
    effective: properties.effective ?? properties.sent ?? null,
    expires: properties.expires ?? null,
    headline: properties.headline ?? `${properties.event} in effect`,
    geometry: feature.geometry,
    sourceUrl,
  }
}

export async function fetchRegionalWarnings(signal?: AbortSignal): Promise<WarningsResult> {
  const requests = WARNING_EVENTS.map((event) => ({ label: event, event }))
  const results = await Promise.allSettled(requests.map(async ({ event }) => {
    const url = new URL('https://api.weather.gov/alerts/active')
    url.searchParams.set('status', 'actual')
    url.searchParams.set('message_type', 'alert')
    url.searchParams.set('event', event)
    const payload = await fetchJson<NwsAlertResponse>(url.toString(), signal)
    return {
      url: url.toString(),
      warnings: (payload.features ?? [])
        .map((feature, index) => toWarning(feature, `${event}-${index}`, url.toString()))
        .filter((warning): warning is RadarWarning => Boolean(warning)),
    }
  }))

  const warnings = new Map<string, RadarWarning>()
  const errors: string[] = []
  results.forEach((result, index) => {
    const request = requests[index]
    if (result.status === 'rejected') {
      errors.push(`${request.label}: ${result.reason instanceof Error ? result.reason.message : 'request failed'}`)
      return
    }
    result.value.warnings.forEach((warning) => warnings.set(warning.id, warning))
  })
  return {
    warnings: Array.from(warnings.values()).sort((a, b) => (a.expires ?? '').localeCompare(b.expires ?? '')),
    fetchedAt: new Date().toISOString(),
    errors,
  }
}

function historicalWarningAtUrl(validAt: string): string {
  const url = new URL(IEM_WARNING_ARCHIVE_URL)
  url.searchParams.set('accept', 'kml')
  url.searchParams.set('at', validAt)
  url.searchParams.set('timeopt', '2')
  url.searchParams.set('limit0', '1')
  url.searchParams.set('limit1', '1')
  return url.toString()
}

function historicalWarningWindowUrl(start: string, end: string): string {
  const url = new URL(IEM_WARNING_ARCHIVE_URL)
  url.searchParams.set('accept', 'kml')
  url.searchParams.set('sts', start)
  url.searchParams.set('ets', end)
  url.searchParams.set('timeopt', '1')
  url.searchParams.set('limit0', '1')
  url.searchParams.set('limit1', '1')
  return url.toString()
}

function kmlElementText(parent: Element, localName: string): string | null {
  const element = Array.from(parent.getElementsByTagNameNS('*', localName))[0]
  const value = element?.textContent?.trim()
  return value || null
}

function parseKmlRing(value: string): Array<[number, number]> | null {
  const ring = value.trim().split(/\s+/).flatMap((tuple) => {
    const [longitude, latitude] = tuple.split(',').map(Number)
    return Number.isFinite(longitude) && Number.isFinite(latitude)
      ? [[longitude, latitude] as [number, number]]
      : []
  })
  if (ring.length < 3) return null
  const first = ring[0]
  const last = ring[ring.length - 1]
  if (first[0] !== last[0] || first[1] !== last[1]) ring.push(first)
  return ring.length >= 4 ? ring : null
}

function parseKmlGeometry(placemark: Element): GeoJSON.Geometry | null {
  const polygons = Array.from(placemark.getElementsByTagNameNS('*', 'Polygon')).flatMap((polygon) => {
    const boundary = Array.from(polygon.getElementsByTagNameNS('*', 'outerBoundaryIs'))[0] ?? polygon
    const coordinates = kmlElementText(boundary, 'coordinates')
    const ring = coordinates ? parseKmlRing(coordinates) : null
    return ring ? [ring] : []
  })
  if (!polygons.length) return null
  if (polygons.length === 1) return { type: 'Polygon', coordinates: [polygons[0]] }
  return { type: 'MultiPolygon', coordinates: polygons.map((ring) => [ring]) }
}

function stableWarningFingerprint(value: string): string {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

function parseHistoricalWarnings(kml: string, sourceUrl: string): RadarWarning[] {
  const document = new DOMParser().parseFromString(kml, 'application/xml')
  if (document.documentElement?.localName !== 'kml' || document.getElementsByTagNameNS('*', 'parsererror').length) {
    throw new Error('Historical warning archive returned invalid KML')
  }
  return Array.from(document.getElementsByTagNameNS('*', 'Placemark')).flatMap((placemark, index) => {
    const name = kmlElementText(placemark, 'name') ?? ''
    const event = WARNING_EVENTS.find((candidate) => name.toLowerCase().includes(candidate.toLowerCase()))
    const geometry = event ? parseKmlGeometry(placemark) : null
    if (!event || !geometry) return []
    const baseId = name.split(/\s+/)[0] || `${event}-${index}`
    const effective = kmlElementText(placemark, 'begin')
    const expires = kmlElementText(placemark, 'end')
    // The archive can emit multiple geometry fragments for one VTEC event.
    // Keep each distinct geometry/validity interval instead of overwriting it.
    const id = `${baseId}-${stableWarningFingerprint(JSON.stringify({ effective, expires, geometry }))}`
    const issuingOffice = baseId.split('.')[0] || 'National Weather Service'
    return [{
      id,
      event,
      issuingOffice,
      areaDesc: name,
      effective,
      expires,
      headline: name,
      geometry,
      sourceUrl,
    }]
  })
}

export async function fetchHistoricalWarningsAt(validAt: string, signal?: AbortSignal): Promise<WarningsResult> {
  const sourceUrl = historicalWarningAtUrl(validAt)
  const warnings = parseHistoricalWarnings(await fetchText(sourceUrl, signal), sourceUrl)
  return { warnings, fetchedAt: new Date().toISOString(), errors: [] }
}

export async function fetchHistoricalWarningsWindow(start: string, end: string, signal?: AbortSignal): Promise<WarningsResult> {
  // IEM's start-time window does not include an event beginning exactly at its end.
  // Query both MRMS frame boundaries so the first and final frame are complete.
  const requests = [
    { label: 'historical warning window', url: historicalWarningWindowUrl(start, end) },
    { label: 'historical warnings active at loop start', url: historicalWarningAtUrl(start) },
    { label: 'historical warnings active at final frame', url: historicalWarningAtUrl(end) },
  ]
  const results = await Promise.allSettled(requests.map(async ({ url }) => {
    const warnings = parseHistoricalWarnings(await fetchText(url, signal), url)
    return { warnings }
  }))
  const warningMap = new Map<string, RadarWarning>()
  const errors: string[] = []
  results.forEach((result, index) => {
    const request = requests[index]
    if (result.status === 'rejected') {
      errors.push(`${request.label}: ${result.reason instanceof Error ? result.reason.message : 'request failed'}`)
      return
    }
    result.value.warnings.forEach((warning) => warningMap.set(warning.id, warning))
  })
  return {
    warnings: Array.from(warningMap.values()).sort((a, b) => (a.effective ?? '').localeCompare(b.effective ?? '')),
    fetchedAt: new Date().toISOString(),
    errors,
  }
}

export function warningsAtTime(warnings: RadarWarning[], validTime: string | null | undefined): RadarWarning[] {
  if (!validTime) return []
  const timestamp = Date.parse(validTime)
  if (!Number.isFinite(timestamp)) return []
  return warnings.filter((warning) => {
    const effective = warning.effective ? Date.parse(warning.effective) : Number.NEGATIVE_INFINITY
    const expires = warning.expires ? Date.parse(warning.expires) : Number.POSITIVE_INFINITY
    return effective <= timestamp && timestamp < expires
  })
}

function censusQueryUrl(
  base: string,
  layer: number,
  outFields: string,
  bounds: readonly [number, number, number, number],
): string {
  const params = new URLSearchParams({
    where: '1=1',
    geometry: bounds.join(','),
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields,
    returnGeometry: 'true',
    outSR: '4326',
    f: 'geojson',
  })
  return `${base}/${layer}/query?${params.toString()}`
}

export async function fetchRegionalGeography(
  signal?: AbortSignal,
  countyBounds: readonly [number, number, number, number] | null = NATIONAL_BOUNDS,
): Promise<{
  states: GeoJSON.FeatureCollection
  counties: GeoJSON.FeatureCollection
}> {
  const [states, counties] = await Promise.all([
    fetchJson<GeoJSON.FeatureCollection>(censusQueryUrl(CENSUS_GEOGRAPHY_BASE, 7, 'NAME,STATE', NATIONAL_BOUNDS), signal),
    countyBounds
      ? fetchJson<GeoJSON.FeatureCollection>(censusQueryUrl(CENSUS_GEOGRAPHY_BASE, 12, 'NAME,STATE,COUNTY', countyBounds), signal)
      : Promise.resolve(emptyFeatureCollection()),
  ])
  return { states, counties }
}

export async function fetchRegionalHighways(
  signal?: AbortSignal,
  bounds: readonly [number, number, number, number] = REGIONAL_BOUNDS,
): Promise<GeoJSON.FeatureCollection> {
  return fetchJson<GeoJSON.FeatureCollection>(
    censusQueryUrl(CENSUS_TRANSPORTATION_BASE, 0, 'NAME,BASENAME', bounds),
    signal,
  )
}

function quantityValue(quantity: NwsQuantity | null | undefined): number | null {
  const value = quantity?.value
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function windSpeedKmh(quantity: NwsQuantity | null | undefined): number | null {
  const value = quantityValue(quantity)
  if (value === null) return null
  const unit = quantity?.unitCode?.toLowerCase() ?? ''
  return unit.includes('m_s') || unit.includes('m/s') ? value * 3.6 : value
}

function pressureHpa(quantity: NwsQuantity | null | undefined): number | null {
  const value = quantityValue(quantity)
  if (value === null) return null
  const unit = quantity?.unitCode?.toLowerCase() ?? ''
  return unit.includes('pa') && !unit.includes('hpa') ? value / 100 : value
}

function stationInRegion(feature: NwsStationFeature): boolean {
  const coordinates = feature.geometry?.coordinates
  if (!coordinates) return false
  const [lon, lat] = coordinates
  return lon >= REGIONAL_BOUNDS[0] && lon <= REGIONAL_BOUNDS[2]
    && lat >= REGIONAL_BOUNDS[1] && lat <= REGIONAL_BOUNDS[3]
}

function chooseSurfaceStations(features: NwsStationFeature[], limit = 48): NwsStationFeature[] {
  const unique = new Map<string, NwsStationFeature>()
  features
    .filter(stationInRegion)
    .forEach((feature) => {
      const id = feature.properties?.stationIdentifier ?? feature.id
      if (id && !unique.has(id)) unique.set(id, feature)
    })

  const candidates = Array.from(unique.values()).sort((a, b) => {
    const aAirport = (a.properties?.stationIdentifier ?? '').startsWith('K') ? 0 : 1
    const bAirport = (b.properties?.stationIdentifier ?? '').startsWith('K') ? 0 : 1
    return aAirport - bAirport
  })
  const selected: NwsStationFeature[] = []
  const buckets = new Set<string>()
  for (const station of candidates) {
    const [lon, lat] = station.geometry?.coordinates ?? [0, 0]
    const bucket = `${Math.floor((lon - REGIONAL_BOUNDS[0]) / 1.25)}:${Math.floor((lat - REGIONAL_BOUNDS[1]) / 1)}`
    if (buckets.has(bucket)) continue
    buckets.add(bucket)
    selected.push(station)
    if (selected.length >= limit) return selected
  }
  return selected.concat(candidates.filter((station) => !selected.includes(station))).slice(0, limit)
}

async function fetchLatestSurfaceObservation(station: NwsStationFeature, signal?: AbortSignal): Promise<SurfaceObservation> {
  const stationId = station.properties?.stationIdentifier ?? station.id
  if (!stationId) throw new Error('NWS station has no identifier')
  const response = await fetchJson<NwsObservationResponse>(
    `https://api.weather.gov/stations/${encodeURIComponent(stationId)}/observations/latest`,
    signal,
  )
  const properties = response.properties ?? {}
  const coordinates = station.geometry?.coordinates
  if (!coordinates) throw new Error(`NWS station ${stationId} has no coordinates`)
  return {
    id: stationId,
    station: stationId,
    name: station.properties?.name ?? stationId,
    observedAt: properties.timestamp ?? null,
    lon: coordinates[0],
    lat: coordinates[1],
    temperatureC: quantityValue(properties.temperature),
    dewpointC: quantityValue(properties.dewpoint),
    windDirectionDeg: quantityValue(properties.windDirection),
    windSpeedKmh: windSpeedKmh(properties.windSpeed),
    windGustKmh: windSpeedKmh(properties.windGust),
    pressureHpa: pressureHpa(properties.barometricPressure),
    humidityPercent: quantityValue(properties.relativeHumidity),
    textDescription: properties.textDescription ?? 'Observation available',
  }
}

export async function fetchRegionalSurfaceObservations(signal?: AbortSignal): Promise<SurfaceObservationsResult> {
  const stationResults = await Promise.allSettled(
    NWS_ALERT_AREAS.map(async (state) => fetchJson<NwsStationResponse>(
      `https://api.weather.gov/stations?state=${state}&limit=500`,
      signal,
    )),
  )
  const errors: string[] = []
  const stationFeatures: NwsStationFeature[] = []
  stationResults.forEach((result, index) => {
    if (result.status === 'rejected') {
      errors.push(`NWS stations ${NWS_ALERT_AREAS[index]}: ${result.reason instanceof Error ? result.reason.message : 'request failed'}`)
    } else {
      stationFeatures.push(...(result.value.features ?? []))
    }
  })

  const observations = await Promise.allSettled(
    chooseSurfaceStations(stationFeatures).map((station) => fetchLatestSurfaceObservation(station, signal)),
  )
  const ready: SurfaceObservation[] = []
  observations.forEach((result) => {
    if (result.status === 'fulfilled') ready.push(result.value)
    else errors.push(`NWS observation: ${result.reason instanceof Error ? result.reason.message : 'request failed'}`)
  })
  return { observations: ready, fetchedAt: new Date().toISOString(), errors: errors.slice(0, 12) }
}

export async function fetchBuoyObservations(path: string, signal?: AbortSignal): Promise<BuoyObservationsResult> {
  const payload = await fetchJson<BuoyFeedPayload>(path, signal)
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.stations)) {
    throw new Error('Buoy observation feed has an unsupported shape')
  }
  const numberValue = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null
  const value = (station: Record<string, unknown>, camel: string, snake: string): unknown => station[camel] ?? station[snake]
  const stations: BuoyObservation[] = payload.stations
    .map((station) => ({
      id: String(station.id ?? ''),
      name: String(station.name ?? station.id ?? 'NOAA buoy'),
      observedAt: typeof value(station, 'observedAt', 'observed_at') === 'string' ? String(value(station, 'observedAt', 'observed_at')) : null,
      lon: numberValue(station.lon) ?? 0,
      lat: numberValue(station.lat) ?? 0,
      windDirectionDeg: numberValue(value(station, 'windDirectionDeg', 'wind_direction_deg')),
      windSpeedMps: numberValue(value(station, 'windSpeedMps', 'wind_speed_mps')),
      windGustMps: numberValue(value(station, 'windGustMps', 'wind_gust_mps')),
      waveHeightM: numberValue(value(station, 'waveHeightM', 'wave_height_m')),
      dominantPeriodS: numberValue(value(station, 'dominantPeriodS', 'dominant_period_s')),
      airTemperatureC: numberValue(value(station, 'airTemperatureC', 'air_temp_c')),
      waterTemperatureC: numberValue(value(station, 'waterTemperatureC', 'water_temp_c')),
      pressureHpa: numberValue(value(station, 'pressureHpa', 'pressure_hpa')),
    }))
    .filter((station) => station.id && station.lon >= REGIONAL_BOUNDS[0] && station.lon <= REGIONAL_BOUNDS[2] && station.lat >= REGIONAL_BOUNDS[1] && station.lat <= REGIONAL_BOUNDS[3])
  return {
    status: payload.status,
    generatedAt: payload.generated_at ?? null,
    source: payload.source,
    stations,
    notes: payload.notes,
  }
}

export function warningsFeatureCollection(warnings: RadarWarning[]): GeoJSON.FeatureCollection {
  if (!warnings.length) return emptyFeatureCollection()
  return {
    type: 'FeatureCollection',
    features: warnings.map((warning) => ({
      type: 'Feature',
      id: warning.id,
      geometry: warning.geometry,
      properties: {
        id: warning.id,
        event: warning.event,
        issuingOffice: warning.issuingOffice,
        areaDesc: warning.areaDesc,
        effective: warning.effective ?? '',
        expires: warning.expires ?? '',
        headline: warning.headline,
      },
    })),
  }
}

export { emptyFeatureCollection }
