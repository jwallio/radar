export type RadarProductId = 'MergedReflectivityQCComposite' | 'PrecipFlag'

export interface RadarFrameManifest {
  id: string
  valid_time: string
  url: string
  bounds: [number, number, number, number]
  source_valid_time?: string
}

export interface RadarProductManifest {
  label: string
  status: 'ready' | 'unavailable' | 'partial'
  frames: RadarFrameManifest[]
  source_url?: string
  notes?: string
  loop_url?: string
  loop_frame_count?: number
  loop_size_bytes?: number
}

export interface RadarManifest {
  schema_version: number
  status: 'ready' | 'unavailable'
  mode?: 'live' | 'historical'
  dataset_id?: string
  label?: string
  generated_at: string | null
  latest_valid_time: string | null
  start_time?: string | null
  end_time?: string | null
  region: { west: number; south: number; east: number; north: number }
  product: RadarProductId
  products: Partial<Record<RadarProductId, RadarProductManifest>>
  frames: RadarFrameManifest[]
  sources?: Record<string, string>
  errors?: string[]
}

export interface RadarHistoryEntry {
  id: string
  label: string
  start_time: string
  end_time: string
  frame_count: number
  products: RadarProductId[]
  manifest_url: string
}

export interface RadarHistoryCatalog {
  schema_version: number
  generated_at: string | null
  datasets: RadarHistoryEntry[]
}

export interface RadarWarning {
  id: string
  event: 'Tornado Warning' | 'Severe Thunderstorm Warning' | 'Flash Flood Warning' | 'Special Marine Warning'
  issuingOffice: string
  areaDesc: string
  effective: string | null
  expires: string | null
  headline: string
  geometry: GeoJSON.Geometry
  sourceUrl: string
}

export interface WarningsResult {
  warnings: RadarWarning[]
  fetchedAt: string
  errors: string[]
}
