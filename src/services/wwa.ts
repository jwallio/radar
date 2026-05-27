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