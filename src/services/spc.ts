import { SOURCE_LINKS } from '../config/links'
import { fetchJsonSafe } from './fetchJson'
import type { SpcOutlookState, SpcReportType, SpcReportsState, SpcStormReport } from '../types/weather'

interface SectionDef {
  headerPrefix: string
  type: SpcReportType
}

const sectionDefs: SectionDef[] = [
  { headerPrefix: 'Raw Tornado LSR', type: 'tornado' },
  { headerPrefix: 'Raw Wind/Gust LSR', type: 'wind' },
  { headerPrefix: 'Raw Hail LSR', type: 'hail' },
]

function emptyCounts(): Record<SpcReportType, number> {
  return { tornado: 0, wind: 0, hail: 0 }
}

function splitCsvLine(line: string): string[] {
  const fields: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]

    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"'
        i += 1
      } else {
        inQuotes = !inQuotes
      }
      continue
    }

    if (ch === ',' && !inQuotes) {
      fields.push(current)
      current = ''
      continue
    }

    current += ch
  }

  fields.push(current)
  return fields.map((field) => field.trim())
}

function reportFromRow(type: SpcReportType, row: string, index: number): SpcStormReport | null {
  const cols = splitCsvLine(row)
  if (cols.length < 8) return null

  const time = cols[0] ?? ''
  const magnitude = cols[1] ? cols[1] : null
  const location = cols[2] ?? ''
  const county = cols[3] ?? ''
  const state = cols[4] ?? ''
  const lat = Number(cols[5])
  const lon = Number(cols[6])
  const remarks = cols.slice(7).join(', ')

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null

  return {
    id: `${type}-${time}-${state}-${index}`,
    type,
    time,
    magnitude,
    location,
    county,
    state,
    lat,
    lon,
    remarks,
  }
}

function parseSpcReports(csvText: string): SpcStormReport[] {
  const lines = csvText.split(/\r?\n/)
  const reports: SpcStormReport[] = []

  for (const section of sectionDefs) {
    const startIndex = lines.findIndex((line) => line.startsWith(section.headerPrefix))
    if (startIndex < 0) continue

    for (let i = startIndex + 2; i < lines.length; i += 1) {
      const line = lines[i]?.trim() ?? ''
      if (!line) continue
      if (line.startsWith('Raw ')) break
      if (line.startsWith('Time,')) continue

      const report = reportFromRow(section.type, line, i)
      if (report) reports.push(report)
    }
  }

  return reports
}

export async function fetchSpcReports(): Promise<SpcReportsState> {
  const url = SOURCE_LINKS.find((link) => link.id === 'spc-reports')?.url
  if (!url) throw new Error('SPC reports URL missing')

  const fetchedAt = new Date().toISOString()

  try {
    const response = await fetch(url)
    const text = await response.text()

    if (!response.ok) {
      return {
        reports: [],
        byType: emptyCounts(),
        sourceUrl: url,
        fetchedAt,
        error: {
          kind: 'http',
          message: `Request failed: ${response.status}`,
          status: response.status,
          contentType: response.headers.get('content-type') ?? undefined,
          bodyPreview: text.slice(0, 220),
        },
      }
    }

    const reports = parseSpcReports(text)
    const byType = reports.reduce(
      (acc, report) => {
        acc[report.type] += 1
        return acc
      },
      emptyCounts(),
    )

    return {
      reports,
      byType,
      sourceUrl: url,
      fetchedAt,
    }
  } catch (error) {
    return {
      reports: [],
      byType: emptyCounts(),
      sourceUrl: url,
      fetchedAt,
      error: {
        kind: 'network',
        message: error instanceof Error ? error.message : 'Unknown network error',
      },
    }
  }
}

export async function fetchSpcDay1Outlook(): Promise<SpcOutlookState> {
  const url = SOURCE_LINKS.find((link) => link.id === 'spc-day1-outlook')?.url
  if (!url) throw new Error('SPC Day 1 outlook URL missing')

  const fetchedAt = new Date().toISOString()
  const result = await fetchJsonSafe<GeoJSON.FeatureCollection>(url)

  if (result.error) {
    return {
      sourceUrl: url,
      fetchedAt,
      featureCollection: { type: 'FeatureCollection', features: [] },
      error: result.error,
    }
  }

  const featureCollection = result.data
  if (!featureCollection || featureCollection.type !== 'FeatureCollection' || !Array.isArray(featureCollection.features)) {
    return {
      sourceUrl: url,
      fetchedAt,
      featureCollection: { type: 'FeatureCollection', features: [] },
      error: {
        kind: 'invalid-json',
        message: 'Day 1 outlook response is not a GeoJSON FeatureCollection',
      },
    }
  }

  return {
    sourceUrl: url,
    fetchedAt,
    featureCollection,
  }
}