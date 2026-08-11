import type { RadarAnalysisProductId, RadarProductId, RadarSourceId } from './types'

export const REGIONAL_BOUNDS: [number, number, number, number] = [-86.5, 32.5, -73.5, 39.5]
export const NATIONAL_BOUNDS: [number, number, number, number] = [-130, 20, -60, 55]
export const ATLANTIC_CARIBBEAN_BOUNDS = [-100, 12, -55, 52] as const
export const MRMS_ARCHIVE_BOUNDS = [-100, 20, -60, 52] as const
export const ERA5_PROCESSING_BOUNDS = [-130, 10, -55, 55] as const
export const MAP_VIEW_BOUNDS = [-104, 8, -51, 56] as const
export const DEFAULT_ARCHIVE_REGION_ID = 'atlantic-caribbean'
export const MRMS_ARCHIVE_START_INPUT = '2014-11-24T00:00'
export const MRMS_FULL_SUITE_START_INPUT = '2020-10-14T00:00'
export const MAP_CENTER: [number, number] = [-77.5, 32]

export type MapRegion = {
  id: string
  label: string
  bounds: readonly [number, number, number, number]
  archiveBounds?: Partial<Record<RadarSourceId, readonly [number, number, number, number]>>
}

export const MAP_REGIONS: readonly MapRegion[] = [
  { id: 'conus', label: 'Continental U.S.', bounds: NATIONAL_BOUNDS },
  { id: 'northeast', label: 'Northeast', bounds: [-82.5, 36.5, -66, 47.8] },
  { id: 'mid-atlantic', label: 'Mid-Atlantic', bounds: [-84.5, 33, -72.5, 42.5] },
  { id: 'southeast', label: 'Southeast', bounds: [-91.5, 24, -74, 37.8] },
  {
    id: 'atlantic-caribbean',
    label: 'Atlantic & Caribbean',
    bounds: ATLANTIC_CARIBBEAN_BOUNDS,
    archiveBounds: {
      mrms: MRMS_ARCHIVE_BOUNDS,
      era5: ATLANTIC_CARIBBEAN_BOUNDS,
    },
  },
  { id: 'great-lakes', label: 'Great Lakes', bounds: [-93.5, 39, -75, 49.2] },
  { id: 'central-plains', label: 'Central Plains', bounds: [-106, 34, -90, 49] },
  { id: 'southern-plains', label: 'Southern Plains', bounds: [-107, 25, -91, 38] },
  { id: 'northwest', label: 'Northwest', bounds: [-125, 40, -109, 49.5] },
  { id: 'southwest', label: 'Southwest', bounds: [-125, 30, -102, 42] },
  { id: 'north-carolina', label: 'North Carolina', bounds: REGIONAL_BOUNDS },
] as const

// Keep the raster base label-free so the app's priority city/highway layers
// are the single source of truth for map text and cannot be duplicated.
export const CARTO_LIGHT_TILES = 'https://a.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}.png'

export const CENSUS_GEOGRAPHY_BASE = 'https://tigerweb.geo.census.gov/arcgis/rest/services/Generalized_ACS2024/State_County/MapServer'
export const CENSUS_TRANSPORTATION_BASE = 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Transportation/MapServer'
export const CENSUS_QUERY_GEOMETRY = ATLANTIC_CARIBBEAN_BOUNDS.join(',')

export const NWS_ALERT_AREAS = ['NC', 'VA', 'TN', 'SC'] as const
export const NWS_MARINE_EVENT = 'Special Marine Warning'
export const WARNING_EVENTS = [
  'Tornado Warning',
  'Severe Thunderstorm Warning',
  'Flash Flood Warning',
  'Special Marine Warning',
] as const

export const PRODUCT_OPTIONS: Array<{ id: RadarProductId; label: string; source: RadarSourceId }> = [
  { id: 'MergedReflectivityQCComposite', label: 'Composite Reflectivity', source: 'mrms' },
  { id: 'PrecipFlag', label: 'Precipitation Type', source: 'mrms' },
  { id: 'MultiSensor_QPE_01H_Pass1', label: '1-hour Rainfall', source: 'mrms' },
  { id: 'NEXRADLevel2BaseReflectivity', label: 'Base Reflectivity', source: 'krax' },
  { id: 'NEXRADLevel2Velocity', label: 'Radial Velocity', source: 'krax' },
  { id: 'NEXRADLevel2CorrelationCoefficient', label: 'Correlation Coefficient (ρhv)', source: 'krax' },
  { id: 'ERA5PrecipitationType', label: 'Precipitation phase', source: 'era5' },
  { id: 'ERA5TotalPrecipitation', label: 'Total precipitation', source: 'era5' },
]

export const VELOCITY_LEGEND = [
  { label: '+50', color: '#d73027' },
  { label: '+25', color: '#fc8d59' },
  { label: '0', color: '#f7f7f7' },
  { label: '-25', color: '#91bfdb' },
  { label: '-50', color: '#4575b4' },
]

export const CORRELATION_LEGEND = [
  { label: '1.00', color: '#0a777b' },
  { label: '0.98', color: '#35a7a1' },
  { label: '0.95', color: '#91d4c7' },
  { label: '0.90', color: '#d5eee7' },
  { label: '0.80', color: '#f3f5f4' },
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

export const ERA5_PHASE_LEGEND = [
  { label: 'Rain', color: '#f5de2d' },
  { label: 'Snow', color: '#379de9' },
  { label: 'Freezing rain', color: '#eb36af' },
  { label: 'Mixed', color: '#9c52cd' },
  { label: 'Ice pellets', color: '#b7912c' },
]

export const ERA5_TOTAL_PRECIPITATION_LEGEND = [
  { label: '25+', color: '#e12b36' },
  { label: '10', color: '#ff891f' },
  { label: '5', color: '#f6e036' },
  { label: '1', color: '#2bbe5c' },
  { label: '0.1', color: '#25d3bf' },
  { label: '0.01', color: '#4ab7e8' },
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
  { id: 'greenville', label: 'Greenville', lon: -77.3664, lat: 35.6127 },
  { id: 'rocky-mount', label: 'Rocky Mount', lon: -77.7905, lat: 35.9382 },
  { id: 'new-bern', label: 'New Bern', lon: -77.0447, lat: 35.1085 },
  { id: 'richmond', label: 'Richmond', lon: -77.4360, lat: 37.5407 },
  { id: 'knoxville', label: 'Knoxville', lon: -83.9207, lat: 35.9606 },
  { id: 'columbia', label: 'Columbia', lon: -81.0348, lat: 34.0007 },
  { id: 'atlanta', label: 'Atlanta', lon: -84.3880, lat: 33.7490, primary: true },
  { id: 'boston', label: 'Boston', lon: -71.0589, lat: 42.3601, primary: true },
  { id: 'new-york', label: 'New York', lon: -74.0060, lat: 40.7128, primary: true },
  { id: 'philadelphia', label: 'Philadelphia', lon: -75.1652, lat: 39.9526 },
  { id: 'baltimore', label: 'Baltimore', lon: -76.6122, lat: 39.2904, primary: true },
  { id: 'washington', label: 'Washington', lon: -77.0369, lat: 38.9072, primary: true },
  { id: 'miami', label: 'Miami', lon: -80.1918, lat: 25.7617, primary: true },
  { id: 'havana', label: 'Havana', lon: -82.3666, lat: 23.1136, primary: true },
  { id: 'nassau', label: 'Nassau', lon: -77.3554, lat: 25.0443, primary: true },
  { id: 'kingston', label: 'Kingston', lon: -76.7936, lat: 17.9712 },
  { id: 'santo-domingo', label: 'Santo Domingo', lon: -69.9312, lat: 18.4861, primary: true },
  { id: 'port-au-prince', label: 'Port-au-Prince', lon: -72.3074, lat: 18.5944 },
  { id: 'san-juan', label: 'San Juan', lon: -66.1057, lat: 18.4655, primary: true },
  { id: 'tampa', label: 'Tampa', lon: -82.4572, lat: 27.9506 },
  { id: 'nashville', label: 'Nashville', lon: -86.7816, lat: 36.1627, primary: true },
  { id: 'birmingham', label: 'Birmingham', lon: -86.8025, lat: 33.5207 },
  { id: 'new-orleans', label: 'New Orleans', lon: -90.0715, lat: 29.9511, primary: true },
  { id: 'chicago', label: 'Chicago', lon: -87.6298, lat: 41.8781, primary: true },
  { id: 'detroit', label: 'Detroit', lon: -83.0458, lat: 42.3314 },
  { id: 'minneapolis', label: 'Minneapolis', lon: -93.2650, lat: 44.9778, primary: true },
  { id: 'st-louis', label: 'St. Louis', lon: -90.1994, lat: 38.6270 },
  { id: 'kansas-city', label: 'Kansas City', lon: -94.5786, lat: 39.0997, primary: true },
  { id: 'oklahoma-city', label: 'Oklahoma City', lon: -97.5164, lat: 35.4676 },
  { id: 'dallas', label: 'Dallas', lon: -96.7970, lat: 32.7767, primary: true },
  { id: 'houston', label: 'Houston', lon: -95.3698, lat: 29.7604, primary: true },
  { id: 'denver', label: 'Denver', lon: -104.9903, lat: 39.7392, primary: true },
  { id: 'phoenix', label: 'Phoenix', lon: -112.0740, lat: 33.4484, primary: true },
  { id: 'salt-lake-city', label: 'Salt Lake City', lon: -111.8910, lat: 40.7608 },
  { id: 'los-angeles', label: 'Los Angeles', lon: -118.2437, lat: 34.0522, primary: true },
  { id: 'san-francisco', label: 'San Francisco', lon: -122.4194, lat: 37.7749 },
  { id: 'portland', label: 'Portland', lon: -122.6765, lat: 45.5231 },
  { id: 'seattle', label: 'Seattle', lon: -122.3321, lat: 47.6062, primary: true },
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
for (let longitude = -100; longitude <= -55; longitude += 5) {
  gridFeatures.push({
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: [[longitude, MAP_VIEW_BOUNDS[1]], [longitude, MAP_VIEW_BOUNDS[3]]] },
    properties: { axis: 'longitude', value: longitude },
  })
}
for (let latitude = 10; latitude <= 55; latitude += 5) {
  gridFeatures.push({
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: [[MAP_VIEW_BOUNDS[0], latitude], [MAP_VIEW_BOUNDS[2], latitude]] },
    properties: { axis: 'latitude', value: latitude },
  })
}

export const GRID_GEOJSON: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: gridFeatures,
}
