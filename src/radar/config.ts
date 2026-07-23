import type { RadarAnalysisProductId, RadarProductId } from './types'

export const REGIONAL_BOUNDS: [number, number, number, number] = [-86.5, 32.5, -73.5, 39.5]
export const MAP_CENTER: [number, number] = [-79.45, 35.45]
export const INITIAL_VIEW_BOUNDS: [[number, number], [number, number]] = [[-84.7, 33.0], [-75.0, 37.8]]

// Keep the raster base label-free so the app's priority city/highway layers
// are the single source of truth for map text and cannot be duplicated.
export const CARTO_LIGHT_TILES = 'https://a.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}.png'

export const CENSUS_GEOGRAPHY_BASE = 'https://tigerweb.geo.census.gov/arcgis/rest/services/Generalized_ACS2024/State_County/MapServer'
export const CENSUS_TRANSPORTATION_BASE = 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Transportation/MapServer'
export const CENSUS_QUERY_GEOMETRY = REGIONAL_BOUNDS.join(',')

export const NWS_ALERT_AREAS = ['NC', 'VA', 'TN', 'SC'] as const
export const NWS_MARINE_EVENT = 'Special Marine Warning'
export const WARNING_EVENTS = [
  'Tornado Warning',
  'Severe Thunderstorm Warning',
  'Flash Flood Warning',
  'Special Marine Warning',
] as const

export const PRODUCT_OPTIONS: Array<{ id: RadarProductId; label: string }> = [
  { id: 'MergedReflectivityQCComposite', label: 'Composite Reflectivity' },
  { id: 'PrecipFlag', label: 'Precipitation Type' },
  { id: 'MultiSensor_QPE_01H_Pass1', label: '1-hour Rainfall' },
]

export const REFLECTIVITY_LEGEND = [
  { label: '70+', color: '#f7deff' },
  { label: '65', color: '#9137be' },
  { label: '60', color: '#de31a4' },
  { label: '55', color: '#bc1d43' },
  { label: '50', color: '#ef2f2b' },
  { label: '45', color: '#ff741e' },
  { label: '40', color: '#ffbf1d' },
  { label: '35', color: '#e1e41c' },
  { label: '30', color: '#74e223' },
  { label: '25', color: '#14e143' },
  { label: '20', color: '#00b84c' },
  { label: '15', color: '#197046' },
  { label: '10', color: '#8f9895' },
  { label: '5', color: '#c2c8c7' },
]

export const PRECIP_LEGEND = [
  { label: 'Rain', color: '#2dbb60' },
  { label: 'Snow', color: '#45aef0' },
  { label: 'Cool / hail', color: '#e852b1' },
]

export const RAINFALL_LEGEND = [
  { label: '50+', color: '#ab37c2' },
  { label: '25', color: '#eb3634' },
  { label: '10', color: '#ff971f' },
  { label: '5', color: '#ffdd31' },
  { label: '1', color: '#16b1e7' },
]

export type AnalysisLayerKey =
  | 'rainfall'
  | 'shearLow'
  | 'shearMid'
  | 'rotation'
  | 'hailMesh'
  | 'hailPosh'
  | 'lightning'

export interface AnalysisLayerDefinition {
  key: AnalysisLayerKey
  productId: RadarAnalysisProductId
  label: string
  note: string
  unit: string
  legend: Array<{ label: string; color: string }>
}

export const ANALYSIS_LAYER_DEFINITIONS: AnalysisLayerDefinition[] = [
  {
    key: 'rainfall',
    productId: 'MultiSensor_QPE_01H_Pass1',
    label: 'Rainfall accumulation',
    note: 'MRMS 1-hour QPE · latest analysis',
    unit: 'mm',
    legend: [
      { label: '50+', color: '#ab37c2' },
      { label: '25', color: '#eb3634' },
      { label: '10', color: '#ff971f' },
      { label: '5', color: '#ffdd31' },
      { label: '1', color: '#16b1e7' },
    ],
  },
  {
    key: 'shearLow',
    productId: 'MergedAzShear_0-2kmAGL',
    label: 'Low-level azimuthal shear',
    note: 'MRMS 0–2 km · latest analysis',
    unit: '0.001 s⁻¹',
    legend: [
      { label: '8+', color: '#ca2cb4' },
      { label: '6', color: '#ef3e2f' },
      { label: '4', color: '#ffb51e' },
      { label: '2', color: '#bee032' },
      { label: '0.5', color: '#45d5cc' },
    ],
  },
  {
    key: 'shearMid',
    productId: 'MergedAzShear_3-6kmAGL',
    label: 'Mid-level azimuthal shear',
    note: 'MRMS 3–6 km · latest analysis',
    unit: '0.001 s⁻¹',
    legend: [
      { label: '8+', color: '#cd31ad' },
      { label: '6', color: '#ff7f23' },
      { label: '4', color: '#eed636' },
      { label: '2', color: '#35c67e' },
      { label: '0.5', color: '#5bcfe9' },
    ],
  },
  {
    key: 'rotation',
    productId: 'RotationTrack30min',
    label: 'Rotation tracks',
    note: 'MRMS 30-minute track · latest analysis',
    unit: '0.001 s⁻¹',
    legend: [
      { label: '8+', color: '#b62bb7' },
      { label: '6', color: '#f13634' },
      { label: '4', color: '#ffa91c' },
      { label: '2', color: '#cee12d' },
      { label: '0.5', color: '#4bcdd4' },
    ],
  },
  {
    key: 'hailMesh',
    productId: 'MESH',
    label: 'MESH hail',
    note: 'Estimated maximum hail size · latest analysis',
    unit: 'mm',
    legend: [
      { label: '75+', color: '#6930af' },
      { label: '50', color: '#cf2aaa' },
      { label: '30', color: '#ee372f' },
      { label: '20', color: '#ff9b1d' },
      { label: '10', color: '#ffd52c' },
    ],
  },
  {
    key: 'hailPosh',
    productId: 'POSH',
    label: 'POSH hail probability',
    note: 'Severe hail probability · latest analysis',
    unit: '%',
    legend: [
      { label: '90+', color: '#cf2aaa' },
      { label: '70', color: '#ee372f' },
      { label: '50', color: '#ff9b1d' },
      { label: '30', color: '#ffd52c' },
      { label: '10', color: '#ffec59' },
    ],
  },
  {
    key: 'lightning',
    productId: 'NLDN_CG_005min_AvgDensity',
    label: 'Lightning',
    note: 'NLDN cloud-to-ground density · 5 min',
    unit: 'flashes/km²/min',
    legend: [
      { label: '1+', color: '#682cb0' },
      { label: '0.5', color: '#d227a7' },
      { label: '0.25', color: '#ef3a2f' },
      { label: '0.1', color: '#ff9a1d' },
      { label: '0.01', color: '#fff689' },
    ],
  },
]

export interface CityDefinition {
  id: string
  label: string
  lon: number
  lat: number
  primary?: boolean
}

export const CITIES: CityDefinition[] = [
  { id: 'raleigh', label: 'Raleigh', lon: -78.6382, lat: 35.7796, primary: true },
  { id: 'durham', label: 'Durham', lon: -78.8986, lat: 36.0001, primary: true },
  { id: 'charlotte', label: 'Charlotte', lon: -80.8431, lat: 35.2271, primary: true },
  { id: 'greensboro', label: 'Greensboro', lon: -79.7910, lat: 36.0726, primary: true },
  { id: 'winston-salem', label: 'Winston-Salem', lon: -80.2442, lat: 36.0999, primary: true },
  { id: 'fayetteville', label: 'Fayetteville', lon: -78.8784, lat: 35.0527, primary: true },
  { id: 'wilmington', label: 'Wilmington', lon: -77.9447, lat: 34.2257, primary: true },
  { id: 'asheville', label: 'Asheville', lon: -82.5515, lat: 35.5951, primary: true },
  { id: 'greenville', label: 'Greenville', lon: -77.3664, lat: 35.6127, primary: true },
  { id: 'rocky-mount', label: 'Rocky Mount', lon: -77.7905, lat: 35.9382, primary: true },
  { id: 'new-bern', label: 'New Bern', lon: -77.0447, lat: 35.1085, primary: true },
  { id: 'richmond', label: 'Richmond', lon: -77.4360, lat: 37.5407 },
  { id: 'knoxville', label: 'Knoxville', lon: -83.9207, lat: 35.9606 },
  { id: 'columbia', label: 'Columbia', lon: -81.0348, lat: 34.0007 },
]

export const CITIES_GEOJSON: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: CITIES.map((city) => ({
    type: 'Feature',
    id: city.id,
    geometry: { type: 'Point', coordinates: [city.lon, city.lat] },
    properties: { id: city.id, label: city.label, primary: Boolean(city.primary) },
  })),
}

const gridFeatures: GeoJSON.Feature[] = []
for (let longitude = -86; longitude <= -74; longitude += 1) {
  gridFeatures.push({
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: [[longitude, REGIONAL_BOUNDS[1]], [longitude, REGIONAL_BOUNDS[3]]] },
    properties: { axis: 'longitude', value: longitude },
  })
}
for (let latitude = 33; latitude <= 39; latitude += 1) {
  gridFeatures.push({
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: [[REGIONAL_BOUNDS[0], latitude], [REGIONAL_BOUNDS[2], latitude]] },
    properties: { axis: 'latitude', value: latitude },
  })
}

export const GRID_GEOJSON: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: gridFeatures,
}

