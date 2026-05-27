import { fetchRainViewerMetadata } from './rainviewer'
import { fetchJsonSafe } from './fetchJson'
import type { RadarFrame, RadarProvider, RadarState } from '../types/weather'

interface Level2MetadataResponse {
  generated?: number | string
  updated?: number | string
  sourceUrl?: string
  healthMessage?: string
  frame?: Partial<RadarFrame> & { tileUrl?: string }
  frames?: Array<Partial<RadarFrame> & { tileUrl?: string }>
}

const defaultStation = (import.meta.env.VITE_LEVEL2_RADAR_STATION as string | undefined)?.trim() || 'KTLX'
const defaultProduct = (import.meta.env.VITE_LEVEL2_RADAR_PRODUCT as string | undefined)?.trim() || 'ref'
const metadataUrl = (import.meta.env.VITE_LEVEL2_RADAR_METADATA_URL as string | undefined)?.trim()
const tileTemplate = (import.meta.env.VITE_LEVEL2_RADAR_TILE_TEMPLATE as string | undefined)?.trim()

function normalizeTime(value: number | string | undefined): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value > 10_000_000_000 ? Math.floor(value / 1000) : value
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    if (!Number.isNaN(parsed)) return Math.floor(parsed / 1000)
    const numeric = Number(value)
    if (Number.isFinite(numeric)) return numeric > 10_000_000_000 ? Math.floor(numeric / 1000) : numeric
  }
  return Math.floor(Date.now() / 1000)
}

function expandTemplate(templateValue: string): string {
  return templateValue
    .replaceAll('{station}', defaultStation)
    .replaceAll('{product}', defaultProduct)
}

function toLevel2Frame(frame: Partial<RadarFrame> & { tileUrl?: string }, index: number, fallbackTime: number): RadarFrame | null {
  const tileUrlTemplate = frame.tileUrlTemplate ?? frame.tileUrl ?? (tileTemplate ? expandTemplate(tileTemplate) : '')
  if (!tileUrlTemplate) return null
  const time = normalizeTime(frame.time ?? fallbackTime)
  return {
    id: frame.id ?? `level2-${time}-${index}`,
    time,
    timestampIso: frame.timestampIso ?? new Date(time * 1000).toISOString(),
    path: frame.path ?? `${defaultStation}/${defaultProduct}`,
    kind: 'level2',
    tileUrlTemplate,
    label: frame.label ?? `${defaultStation} ${defaultProduct.toUpperCase()}`,
  }
}

export async function fetchLevel2RadarMetadata(): Promise<RadarState> {
  const fallbackSource = metadataUrl || tileTemplate || 'Level2 radar backend not configured'

  if (!metadataUrl && !tileTemplate) {
    return {
      provider: 'level2',
      providerLabel: 'Level2 radar',
      version: null,
      generated: null,
      host: '',
      frames: [],
      latestFrame: null,
      sourceUrl: fallbackSource,
      healthMessage: 'Configure VITE_LEVEL2_RADAR_METADATA_URL or VITE_LEVEL2_RADAR_TILE_TEMPLATE to enable Level2 radar.',
      error: { kind: 'config', message: 'Level2 radar backend is not configured.' },
    }
  }

  if (!metadataUrl && tileTemplate) {
    const time = Math.floor(Date.now() / 1000)
    const frame = toLevel2Frame({}, 0, time)
    return {
      provider: 'level2',
      providerLabel: 'Level2 radar',
      version: null,
      generated: time,
      host: '',
      frames: frame ? [frame] : [],
      latestFrame: frame,
      sourceUrl: tileTemplate,
      healthMessage: `Using configured Level2 tile template for ${defaultStation} ${defaultProduct.toUpperCase()}.`,
    }
  }

  const activeMetadataUrl = metadataUrl ?? ''
  const result = await fetchJsonSafe<Level2MetadataResponse>(activeMetadataUrl)
  if (result.error) {
    return {
      provider: 'level2',
      providerLabel: 'Level2 radar',
      version: null,
      generated: null,
      host: '',
      frames: [],
      latestFrame: null,
      sourceUrl: activeMetadataUrl,
      healthMessage: 'Level2 radar metadata endpoint is unreachable; switch to RainViewer fallback.',
      error: result.error,
    }
  }

  const payload = result.data ?? {}
  const generated = normalizeTime(payload.generated ?? payload.updated)
  const rawFrames = payload.frames ?? (payload.frame ? [payload.frame] : [])
  const frames = rawFrames
    .map((frame, index) => toLevel2Frame(frame, index, generated))
    .filter((frame): frame is RadarFrame => Boolean(frame))
    .sort((a, b) => a.time - b.time)
  const latestFrame = frames.length > 0 ? frames[frames.length - 1] : null

  return {
    provider: 'level2',
    providerLabel: 'Level2 radar',
    version: null,
    generated,
    host: '',
    frames,
    latestFrame,
    sourceUrl: payload.sourceUrl ?? activeMetadataUrl,
    healthMessage: payload.healthMessage ?? (latestFrame ? `Level2 ${latestFrame.label ?? 'radar'} ready.` : 'Level2 metadata returned no frames.'),
    error: latestFrame ? undefined : { kind: 'config', message: 'Level2 metadata returned no usable radar frames.' },
  }
}

export async function fetchRadarMetadata(provider: RadarProvider): Promise<RadarState> {
  if (provider === 'level2') return fetchLevel2RadarMetadata()
  return fetchRainViewerMetadata()
}
