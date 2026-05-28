// Spotter Network live data service
// Fetches the GRLevelX placefile feed and parses into GeoJSON
//
// Feed URL: https://www.spotternetwork.org/feeds/gr.txt
// Format: GRLevelX placefile with Icon/Text/End blocks
// CORS: Access-Control-Allow-Origin: * — browser-fetchable

interface SpotterEntry {
  lat: number
  lon: number
  name: string
  timestamp: string // ISO date from feed
  heading: number | null // 0 = stationary, otherwise bearing in degrees
  phone?: string
  email?: string
  twitter?: string
  web?: string
  note?: string
  displayText: string
}

interface SpotterNetworkFeed {
  title: string
  lastFetched: string
  spotters: SpotterEntry[]
  count: number
  error?: string
}

// How stale a position report can be before marking idle
const ACTIVE_THRESHOLD_MS = 4 * 60 * 60 * 1000 // 4 hours

export type SpotterStatus = 'active' | 'idle' | 'stale'

/**
 * Parse a GRLevelX placefile body into structured entries.
 * Format: Object blocks delimited by "Object:" and "End:"
 */
function parseGrFeed(raw: string): SpotterEntry[] {
  const entries: SpotterEntry[] = []

  // Split on Object: lines, skip the header before first Object
  const blocks = raw.split(/\n(?=Object:)/)
  if (blocks.length < 2) return entries

  // First block is header (Refresh, Threshold, Title, Font, IconFile)
  // Remaining blocks start with "Object:"
  for (let i = 1; i < blocks.length; i++) {
    const block = blocks[i]

    // Extract Object line: "Object: lat,lon"
    const objMatch = block.match(/^Object:\s*([\d.-]+)\s*,\s*([\d.-]+)/m)
    if (!objMatch) continue

    const lat = parseFloat(objMatch[1])
    const lon = parseFloat(objMatch[2])

    // Extract Icon metadata (the quoted string with name/timestamp/status)
    const iconMetaMatch = block.match(/Icon:.*"(.*?)"/s)
    let name = 'Unknown'
    let timestamp = ''
    let heading: number | null = null
    let phone: string | undefined
    let email: string | undefined
    let twitter: string | undefined
    let web: string | undefined
    let note: string | undefined

    if (iconMetaMatch) {
      const meta = iconMetaMatch[1]
      const lines = meta.split('\\n')

      name = lines[0]?.trim() || 'Unknown'
      timestamp = lines[1]?.trim() || ''

      // Parse remaining metadata lines
      for (const line of lines.slice(2)) {
        const trimmed = line.trim()
        if (!trimmed) continue

        if (trimmed === 'STATIONARY') {
          heading = 0
        } else if (trimmed.startsWith('Heading:')) {
          const headingMatch = trimmed.match(/Heading:.*\((\d+)\)/)
          heading = headingMatch ? parseInt(headingMatch[1]) : null
        } else if (trimmed.startsWith('Phone:')) {
          phone = trimmed.slice(6).trim()
        } else if (trimmed.startsWith('Email:')) {
          email = trimmed.slice(6).trim()
        } else if (trimmed.startsWith('Twitter:')) {
          twitter = trimmed.slice(8).trim()
        } else if (trimmed.startsWith('Web:')) {
          web = trimmed.slice(4).trim()
        } else if (trimmed.startsWith('Note:')) {
          note = trimmed.slice(5).trim()
        } else if (trimmed.startsWith('IM:')) {
          // IM field — we skip for now
        }
      }
    }

    // Extract Text line for display text
    const textMatch = block.match(/Text:.*"(.*?)"/)
    const displayText = textMatch ? textMatch[1] : name

    entries.push({
      lat,
      lon,
      name,
      timestamp,
      heading,
      phone,
      email,
      twitter,
      web,
      note,
      displayText,
    })
  }

  return entries
}

/**
 * Determine spotter active/idle status based on timestamp recency
 */
export function spotterStatus(timestamp: string): SpotterStatus {
  if (!timestamp) return 'stale'
  try {
    const ts = new Date(timestamp).getTime()
    const now = Date.now()
    if (now - ts < ACTIVE_THRESHOLD_MS) return 'active'
    return 'idle'
  } catch {
    return 'stale'
  }
}

/**
 * Fetch and parse the Spotter Network position feed.
 * Returns GeoJSON FeatureCollection ready for MapLibre.
 */
export async function fetchSpotterNetwork(): Promise<{
  featureCollection: GeoJSON.FeatureCollection
  feed: SpotterNetworkFeed
}> {
  const sourceUrl = 'https://www.spotternetwork.org/feeds/gr.txt'

  const res = await fetch(sourceUrl, {
    headers: { Accept: 'text/plain' },
    // No CORS proxy needed — spotternetwork.org sets Access-Control-Allow-Origin: *
  })

  if (!res.ok) {
    throw new Error(`Spotter Network feed returned ${res.status}`)
  }

  const raw = await res.text()
  const spotters = parseGrFeed(raw)

  const features: GeoJSON.Feature[] = spotters.map((s) => {
    const status = spotterStatus(s.timestamp)
    const notesParts: string[] = []

    if (s.timestamp) notesParts.push(s.timestamp)
    if (s.heading !== null && s.heading !== 0) notesParts.push(`Heading: ${s.heading}°`)
    if (s.heading === 0) notesParts.push('Stationary')
    if (s.phone) notesParts.push(`Phone: ${s.phone}`)

    return {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
      properties: {
        name: s.name,
        displayText: s.displayText,
        status,
        timestamp: s.timestamp,
        heading: s.heading ?? 0,
        notes: notesParts.join(' · ') || undefined,
        phone: s.phone,
        email: s.email,
        twitter: s.twitter,
        web: s.web,
        note: s.note,
        hasLiveCam: 0, // gr.txt doesn't carry streamer info; resolved separately
        streamerId: '',
      },
    }
  })

  return {
    featureCollection: {
      type: 'FeatureCollection',
      features,
    },
    feed: {
      title: 'Spotter Network Positions',
      lastFetched: new Date().toISOString(),
      spotters,
      count: spotters.length,
    },
  }
}