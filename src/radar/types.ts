export type RadarSourceId = 'mrms' | 'krax' | 'era5'

export type RadarProductId =
  | 'MergedReflectivityQCComposite'
  | 'PrecipFlag'
  | 'MultiSensor_QPE_01H_Pass1'
  | 'NEXRADLevel2BaseReflectivity'
  | 'NEXRADLevel2Velocity'
  | 'NEXRADLevel2CorrelationCoefficient'
  | 'ERA5PrecipitationType'
  | 'ERA5TotalPrecipitation'

export type RadarAnalysisProductId =
  | 'MultiSensor_QPE_01H_Pass1'
  | 'MergedAzShear_0-2kmAGL'
  | 'MergedAzShear_3-6kmAGL'
  | 'RotationTrack30min'
  | 'MESH'
  | 'POSH'
  | 'NLDN_CG_005min_AvgDensity'

export type RadarManifestProductId = RadarProductId | RadarAnalysisProductId

export interface RadarFrameManifest {
  id: string
  valid_time: string
  url: string
  pmtiles_url?: string
  bounds: [number, number, number, number]
  minzoom?: number
  maxzoom?: number
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
  site?: string
}

export interface RadarManifest {
  schema_version: number
  status: 'ready' | 'unavailable'
  mode?: 'live' | 'historical'
  source?: 'nexrad-level2' | 'mrms' | 'era5'
  source_type?: 'observed' | 'reanalysis'
  observed?: boolean
  site?: string
  dataset_id?: string
  label?: string
  region_id?: string
  region_label?: string
  expires_at?: string
  generated_at: string | null
  latest_valid_time: string | null
  start_time?: string | null
  end_time?: string | null
  region: { west: number; south: number; east: number; north: number }
  bounds?: [number, number, number, number]
  product: RadarProductId
  product_type?: string
  products: Partial<Record<RadarManifestProductId, RadarProductManifest>>
  frames: RadarFrameManifest[]
  sources?: Record<string, string>
  errors?: string[]
  coverage?: 'regional' | 'conus'
  delivery?: 'image' | 'pmtiles'
  variables?: string[]
  temporal_resolution?: string
  temporal_interpolation?: string
  native_resolution?: string
  rendered_resolution?: string
  provenance?: string
  methodology?: string
  era5_reconstruction_version?: number
  mrms_product_tier?: 'core' | 'full'
  mrms_archive_start?: string
  mrms_full_suite_start?: string
  mrms_full_suite?: boolean
  radar?: {
    latitude?: number
    longitude?: number
    sweep_count?: number
    field?: string
    elevation_degrees?: number
  }
}

export interface RadarHistoryEntry {
  id: string
  label: string
  start_time: string
  end_time: string
  frame_count: number
  products: RadarManifestProductId[]
  manifest_url: string
  source?: 'nexrad-level2' | 'mrms' | 'era5'
  source_type?: 'observed' | 'reanalysis'
  observed?: boolean
  temporal_resolution?: string
  native_resolution?: string
  era5_reconstruction_version?: number
  mrms_product_tier?: 'core' | 'full'
  mrms_archive_start?: string
  mrms_full_suite_start?: string
  mrms_full_suite?: boolean
  region_id?: string
  bounds?: [number, number, number, number]
  site?: string
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

export interface SurfaceObservation {
  id: string
  station: string
  name: string
  observedAt: string | null
  lon: number
  lat: number
  temperatureC: number | null
  dewpointC: number | null
  windDirectionDeg: number | null
  windSpeedKmh: number | null
  windGustKmh: number | null
  pressureHpa: number | null
  humidityPercent: number | null
  textDescription: string
}

export interface SurfaceObservationsResult {
  observations: SurfaceObservation[]
  fetchedAt: string
  errors: string[]
}

export interface BuoyObservation {
  id: string
  name: string
  observedAt: string | null
  lon: number
  lat: number
  windDirectionDeg: number | null
  windSpeedMps: number | null
  windGustMps: number | null
  waveHeightM: number | null
  dominantPeriodS: number | null
  airTemperatureC: number | null
  waterTemperatureC: number | null
  pressureHpa: number | null
}

export interface BuoyObservationsResult {
  status: 'ready' | 'unavailable'
  generatedAt: string | null
  source?: string
  stations: BuoyObservation[]
  notes?: string
}
