import { SOURCE_LINKS } from '../config/links'
import { fetchJsonSafe } from './fetchJson'
import type { AlertSeverity, SafeFetchError, WeatherAlert } from '../types/weather'

interface NwsAlertFeature {
  id?: string
  geometry?: GeoJSON.Geometry | null
  properties?: {
    event?: string
    severity?: string
    headline?: string
    description?: string
    areaDesc?: string
    effective?: string
    onset?: string
    expires?: string
    sent?: string
    status?: string
    messageType?: string
    urgency?: string
    certainty?: string
    affectedZones?: string[]
    '@id'?: string
  }
}

interface NwsAlertsResponse {
  title?: string
  updated?: string
  features?: NwsAlertFeature[]
}

interface NwsAlertCountsResponse {
  total?: number
  land?: number
  marine?: number
}

export interface NwsAlertsResult {
  alerts: WeatherAlert[]
  updated: string | null
  sourceUrl: string
  error?: SafeFetchError
}

export interface NwsAlertCountsResult {
  sourceUrl: string
  fetchedAt: string
  total: number
  land: number
  marine: number
  error?: SafeFetchError
}

const severityOrder: Record<AlertSeverity, number> = {
  Extreme: 0,
  Severe: 1,
  Moderate: 2,
  Minor: 3,
  Unknown: 4,
}

function normalizeSeverity(input?: string): AlertSeverity {
  if (!input) return 'Unknown'
  if (input === 'Extreme' || input === 'Severe' || input === 'Moderate' || input === 'Minor') return input
  return 'Unknown'
}

function isMappableGeometry(geometry: GeoJSON.Geometry | null | undefined): boolean {
  if (!geometry) return false
  return geometry.type === 'Polygon' || geometry.type === 'MultiPolygon'
}

function toTime(value: string | null): number {
  if (!value) return Number.MAX_SAFE_INTEGER
  const time = Date.parse(value)
  return Number.isFinite(time) ? time : Number.MAX_SAFE_INTEGER
}

function toAlert(feature: NwsAlertFeature, fallbackId: string, sourceUrl: string): WeatherAlert {
  const props = feature.properties ?? {}
  const severity = normalizeSeverity(props.severity)
  const geometry = feature.geometry ?? null
  const id = feature.id ?? props['@id'] ?? fallbackId

  return {
    id,
    event: props.event ?? 'Unspecified Alert',
    severity,
    headline: props.headline ?? 'No headline provided',
    description: props.description ?? '',
    areaDesc: props.areaDesc ?? 'Unknown area',
    effective: props.effective ?? null,
    onset: props.onset ?? null,
    expires: props.expires ?? null,
    sent: props.sent ?? null,
    status: props.status ?? null,
    messageType: props.messageType ?? null,
    urgency: props.urgency ?? null,
    certainty: props.certainty ?? null,
    affectedZones: props.affectedZones ?? [],
    geometry,
    geometryStatus: isMappableGeometry(geometry) ? 'mapped' : 'unmapped',
    sourceUrl,
  }
}

async function fetchNwsAlertsFromUrl(url: string): Promise<NwsAlertsResult> {
  const result = await fetchJsonSafe<NwsAlertsResponse>(url, {
    headers: {
      Accept: 'application/geo+json, application/json',
    },
  })

  if (result.error) {
    return { alerts: [], updated: null, sourceUrl: url, error: result.error }
  }

  const payload = result.data
  const alerts = (payload?.features ?? []).map((feature, index) => toAlert(feature, `nws-${index}`, url))
  alerts.sort((a, b) => {
    const severityDelta = severityOrder[a.severity] - severityOrder[b.severity]
    if (severityDelta !== 0) return severityDelta
    return toTime(a.expires) - toTime(b.expires)
  })

  return {
    alerts,
    updated: payload?.updated ?? null,
    sourceUrl: url,
  }
}

export async function fetchNwsAlerts(): Promise<NwsAlertsResult> {
  const url = SOURCE_LINKS.find((link) => link.id === 'nws-alerts')?.url
  if (!url) throw new Error('NWS alerts URL missing')
  return fetchNwsAlertsFromUrl(url)
}

export async function fetchNwsAlertsByEvent(event: string): Promise<NwsAlertsResult> {
  const url = `https://api.weather.gov/alerts/active?status=actual&message_type=alert&event=${encodeURIComponent(event)}`
  return fetchNwsAlertsFromUrl(url)
}

export async function fetchNwsAlertCounts(): Promise<NwsAlertCountsResult> {
  const sourceUrl = 'https://api.weather.gov/alerts/active/count'
  const fetchedAt = new Date().toISOString()
  const result = await fetchJsonSafe<NwsAlertCountsResponse>(sourceUrl, {
    headers: { Accept: 'application/ld+json, application/json' },
  })

  if (result.error) return { sourceUrl, fetchedAt, total: 0, land: 0, marine: 0, error: result.error }

  return {
    sourceUrl,
    fetchedAt,
    total: Number(result.data?.total ?? 0),
    land: Number(result.data?.land ?? 0),
    marine: Number(result.data?.marine ?? 0),
  }
}
