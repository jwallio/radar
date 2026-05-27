import { SOURCE_LINKS } from '../config/links'
import { fetchJsonSafe } from './fetchJson'
import type { SafeFetchError } from '../types/weather'

interface WwaFeature {
  geometry?: GeoJSON.Geometry | null
  properties?: {
    prod_type?: string
    phenom?: string
    sig?: string
    issuance?: string
    expiration?: string
    url?: string
    wfo?: string
    event?: string
  }
}

interface WwaResponse {
  type: string
  features?: WwaFeature[]
}

export interface WwaWatch {
  id: string
  type: 'tornado' | 'severe-thunderstorm'
  label: string
  wfo: string | null
  eventNumber: string | null
  issued: string | null
  expires: string | null
  geometry: GeoJSON.Geometry
}

export interface WwaState {
  watches: WwaWatch[]
  sourceUrl: string
  fetchedAt: string
  error?: SafeFetchError
}

function isWatchFeature(feature: WwaFeature): boolean {
  const props = feature.properties
  if (!props) return false
  const prodType = (props.prod_type ?? '').toLowerCase()
  return prodType.includes('tornado watch') || prodType.includes('severe thunderstorm watch')
}

function toWatch(feature: WwaFeature, index: number): WwaWatch | null {
  const props = feature.properties
  const geometry = feature.geometry
  if (!props || !geometry) return null

  const prodType = (props.prod_type ?? '').toLowerCase()
  const watchType: 'tornado' | 'severe-thunderstorm' = prodType.includes('tornado')
    ? 'tornado'
    : 'severe-thunderstorm'

  return {
    id: props.url ?? `wwa-watch-${index}`,
    type: watchType,
    label: props.prod_type ?? 'Unknown Watch',
    wfo: props.wfo ?? null,
    eventNumber: props.event ?? null,
    issued: props.issuance ?? null,
    expires: props.expiration ?? null,
    geometry,
  }
}

export async function fetchWwaWatches(): Promise<WwaState> {
  // Use the WWA MapServer WatchesWarnings layer filtered to polygon features
  const baseUrl =
    SOURCE_LINKS.find((link) => link.id === 'wwa-polygons')?.url ??
    'https://mapservices.weather.noaa.gov/eventdriven/rest/services/WWA/watch_warn_adv/MapServer/1/query'

  // Only fetch features with polygon geometry that are SPC watches
  const url = `${baseUrl}?where=prod_type%20LIKE%20'%25Watch%25'&outFields=prod_type,phenom,sig,issuance,expiration,url,wfo,event&f=geojson&returnGeometry=true&resultRecordCount=100`

  const fetchedAt = new Date().toISOString()
  const result = await fetchJsonSafe<WwaResponse>(url, {
    headers: { Accept: 'application/geo+json, application/json' },
  })

  if (result.error) {
    return { watches: [], sourceUrl: url, fetchedAt, error: result.error }
  }

  const features = result.data?.features ?? []
  const watches = features
    .filter(isWatchFeature)
    .map((feature, index) => toWatch(feature, index))
    .filter((w): w is WwaWatch => w !== null)

  return { watches, sourceUrl: url, fetchedAt }
}

// ---- Warning polygons (guaranteed geometry) ----

export interface WwaWarning {
  id: string
  type: string // prod_type, e.g. "Tornado Warning", "Severe Thunderstorm Warning"
  severity: 'Extreme' | 'Severe' | 'Moderate' | 'Minor'
  issued: string | null
  expires: string | null
  geometry: GeoJSON.Geometry
}

export interface WwaWarningsState {
  warnings: WwaWarning[]
  sourceUrl: string
  fetchedAt: string
  error?: SafeFetchError
}

const WARNING_SEVERITY_MAP: Record<string, WwaWarning['severity']> = {
  'tornado warning': 'Extreme',
  'severe thunderstorm warning': 'Severe',
  'flash flood warning': 'Severe',
  'extreme wind warning': 'Extreme',
}

function severityFor(prodType: string): WwaWarning['severity'] {
  const key = prodType.toLowerCase()
  return WARNING_SEVERITY_MAP[key] ?? 'Moderate'
}

function toWarning(feature: WwaFeature, index: number): WwaWarning | null {
  const props = feature.properties
  const geometry = feature.geometry
  if (!props || !geometry) return null

  const prodType = props.prod_type ?? 'Unknown'

  return {
    id: props.url ?? `wwa-warning-${index}`,
    type: prodType,
    severity: severityFor(prodType),
    issued: props.issuance ?? null,
    expires: props.expiration ?? null,
    geometry,
  }
}

export async function fetchWwaWarnings(): Promise<WwaWarningsState> {
  const baseUrl =
    SOURCE_LINKS.find((link) => link.id === 'wwa-polygons')?.url ??
    'https://mapservices.weather.noaa.gov/eventdriven/rest/services/WWA/watch_warn_adv/MapServer/1/query'

  const url = `${baseUrl}?where=prod_type%20LIKE%20'%25Warning%25'&outFields=prod_type,issuance,expiration,url&f=geojson&returnGeometry=true&resultRecordCount=500`

  const fetchedAt = new Date().toISOString()
  const result = await fetchJsonSafe<WwaResponse>(url, {
    headers: { Accept: 'application/geo+json, application/json' },
  })

  if (result.error) {
    return { warnings: [], sourceUrl: url, fetchedAt, error: result.error }
  }

  const features = result.data?.features ?? []
  const warnings = features
    .filter((f) => {
      const t = (f.properties?.prod_type ?? '').toLowerCase()
      return t.includes('warning') && !t.includes('watch')
    })
    .map((feature, index) => toWarning(feature, index))
    .filter((w): w is WwaWarning => w !== null)

  return { warnings, sourceUrl: url, fetchedAt }
}