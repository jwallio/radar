import {
  CENSUS_GEOGRAPHY_BASE,
  CENSUS_QUERY_GEOMETRY,
  CENSUS_TRANSPORTATION_BASE,
  NWS_MARINE_EVENT,
  NWS_ALERT_AREAS,
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

export async function fetchRadarManifest(path: string, signal?: AbortSignal): Promise<RadarManifest> {
  const payload = await fetchJson<RadarManifest>(freshStaticJsonUrl(path), signal)
  if (!payload || typeof payload !== 'object' || !payload.products) {
    throw new Error('Radar manifest has an unsupported shape')
  }
  return payload
}

export async function fetchHistoryCatalog(path: string, signal?: AbortSignal): Promise<RadarHistoryCatalog> {
  const payload = await fetchJson<RadarHistoryCatalog>(freshStaticJsonUrl(path), signal)
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

function geometryIntersectsRegion(geometry: GeoJSON.Geometry): boolean {
  const positions: Array<[number, number]> = []
  const collect = (value: unknown) => {
    if (!Array.isArray(value)) return
    if (typeof value[0] === 'number' && typeof value[1] === 'number') {
      positions.push([Number(value[0]), Number(value[1])])
      return
    }
    value.forEach(collect)
  }
  const collectGeometry = (value: GeoJSON.Geometry) => {
    if (value.type === 'GeometryCollection') value.geometries.forEach(collectGeometry)
    else collect(value.coordinates)
  }
  collectGeometry(geometry)
  if (!positions.length) return false
  const longitudes = positions.map(([longitude]) => longitude)
  const latitudes = positions.map(([, latitude]) => latitude)
  return Math.max(...longitudes) >= REGIONAL_BOUNDS[0]
    && Math.min(...longitudes) <= REGIONAL_BOUNDS[2]
    && Math.max(...latitudes) >= REGIONAL_BOUNDS[1]
    && Math.min(...latitudes) <= REGIONAL_BOUNDS[3]
}

export async function fetchRegionalWarnings(signal?: AbortSignal): Promise<WarningsResult> {
  const requests = [
    ...NWS_ALERT_AREAS.map((area) => ({ label: area, area, event: undefined })),
    { label: 'marine', area: undefined, event: NWS_MARINE_EVENT },
  ]
  const results = await Promise.allSettled(requests.map(async ({ area, event }) => {
    const url = new URL('https://api.weather.gov/alerts/active')
    url.searchParams.set('status', 'actual')
    url.searchParams.set('message_type', 'alert')
    if (area) url.searchParams.set('area', area)
    if (event) url.searchParams.set('event', event)
    const payload = await fetchJson<NwsAlertResponse>(url.toString(), signal)
    return {
      url: url.toString(),
      warnings: (payload.features ?? [])
        .map((feature, index) => toWarning(feature, `${area}-${index}`, url.toString()))
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
    result.value.warnings
      .filter((warning) => request.label !== 'marine' || geometryIntersectsRegion(warning.geometry))
      .forEach((warning) => warnings.set(warning.id, warning))
  })
  return {
    warnings: Array.from(warnings.values()).sort((a, b) => (a.expires ?? '').localeCompare(b.expires ?? '')),
    fetchedAt: new Date().toISOString(),
    errors,
  }
}

function censusQueryUrl(base: string, layer: number, outFields: string): string {
  const params = new URLSearchParams({
    where: '1=1',
    geometry: CENSUS_QUERY_GEOMETRY,
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

export async function fetchRegionalGeography(signal?: AbortSignal): Promise<{
  states: GeoJSON.FeatureCollection
  counties: GeoJSON.FeatureCollection
}> {
  const [states, counties] = await Promise.all([
    fetchJson<GeoJSON.FeatureCollection>(censusQueryUrl(CENSUS_GEOGRAPHY_BASE, 7, 'NAME,STATE'), signal),
    fetchJson<GeoJSON.FeatureCollection>(censusQueryUrl(CENSUS_GEOGRAPHY_BASE, 12, 'NAME,STATE,COUNTY'), signal),
  ])
  return { states, counties }
}

export async function fetchRegionalHighways(signal?: AbortSignal): Promise<GeoJSON.FeatureCollection> {
  return fetchJson<GeoJSON.FeatureCollection>(censusQueryUrl(CENSUS_TRANSPORTATION_BASE, 0, 'NAME,BASENAME'), signal)
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
