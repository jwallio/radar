import {
  CENSUS_GEOGRAPHY_BASE,
  CENSUS_QUERY_GEOMETRY,
  CENSUS_TRANSPORTATION_BASE,
  NWS_MARINE_EVENT,
  NWS_ALERT_AREAS,
  REGIONAL_BOUNDS,
  WARNING_EVENTS,
} from './config'
import type { RadarHistoryCatalog, RadarManifest, RadarWarning, WarningsResult } from './types'

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

function emptyFeatureCollection(): GeoJSON.FeatureCollection {
  return { type: 'FeatureCollection', features: [] }
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
  const payload = await fetchJson<RadarManifest>(path, signal)
  if (!payload || typeof payload !== 'object' || !payload.products) {
    throw new Error('Radar manifest has an unsupported shape')
  }
  return payload
}

export async function fetchHistoryCatalog(path: string, signal?: AbortSignal): Promise<RadarHistoryCatalog> {
  const payload = await fetchJson<RadarHistoryCatalog>(path, signal)
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
