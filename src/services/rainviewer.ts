import { SOURCE_LINKS } from '../config/links'
import { fetchJsonSafe } from './fetchJson'
import type { RainViewerFrame, RainViewerRadarState } from '../types/weather'

interface RainViewerResponse {
  host?: string
  version?: string
  generated?: number
  radar?: {
    past?: Array<{ time?: number; path?: string }>
    nowcast?: Array<{ time?: number; path?: string }>
  }
}

function toFrame(
  frame: { time?: number; path?: string },
  kind: 'past' | 'nowcast',
  host: string,
): RainViewerFrame | null {
  if (!frame.path || !frame.time) return null
  const time = frame.time
  const timestampIso = new Date(time * 1000).toISOString()
  return {
    id: `${kind}-${time}`,
    time,
    timestampIso,
    path: frame.path,
    kind,
    tileUrlTemplate: `${host}${frame.path}/256/{z}/{x}/{y}/2/1_1.png`,
  }
}

export async function fetchRainViewerMetadata(): Promise<RainViewerRadarState> {
  const url = SOURCE_LINKS.find((link) => link.id === 'rainviewer-radar')?.url
  if (!url) throw new Error('RainViewer URL missing')
  const result = await fetchJsonSafe<RainViewerResponse>(url)

  if (result.error) {
    return {
      provider: 'rainviewer',
      providerLabel: 'RainViewer',
      version: null,
      generated: null,
      host: '',
      frames: [],
      latestFrame: null,
      sourceUrl: url,
      healthMessage: 'RainViewer radar metadata is unreachable.',
      error: result.error,
    }
  }

  const payload = result.data
  const host = payload?.host ?? ''
  const pastFrames = (payload?.radar?.past ?? [])
    .map((frame) => toFrame(frame, 'past', host))
    .filter((frame): frame is RainViewerFrame => Boolean(frame))
  const nowcastFrames = (payload?.radar?.nowcast ?? [])
    .map((frame) => toFrame(frame, 'nowcast', host))
    .filter((frame): frame is RainViewerFrame => Boolean(frame))
  const frames = [...pastFrames, ...nowcastFrames].sort((a, b) => a.time - b.time)
  const latestFrame = frames.length > 0 ? frames[frames.length - 1] : null

  return {
    provider: 'rainviewer',
    providerLabel: 'RainViewer',
    version: payload?.version ?? null,
    generated: payload?.generated ?? null,
    host,
    frames,
    latestFrame,
    sourceUrl: url,
    healthMessage: latestFrame ? 'RainViewer radar ready.' : 'RainViewer metadata returned no frames.',
  }
}

