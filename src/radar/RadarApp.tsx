import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { CARTO_LIGHT_TILES, CITIES_GEOJSON, GRID_GEOJSON, MAP_CENTER, PRECIP_LEGEND, PRODUCT_OPTIONS, REFLECTIVITY_LEGEND, REGIONAL_BOUNDS } from './config'
import { emptyFeatureCollection, fetchHistoryCatalog, fetchRadarManifest, fetchRegionalGeography, fetchRegionalHighways, fetchRegionalWarnings, warningsFeatureCollection } from './data'
import type { RadarFrameManifest, RadarHistoryCatalog, RadarManifest, RadarProductId, RadarWarning } from './types'
import './radar.css'

const LIVE_MANIFEST_PATH = `${import.meta.env.BASE_URL}data/radar/manifest.json`
const HISTORY_CATALOG_PATH = `${import.meta.env.BASE_URL}data/radar/history/catalog.json`
const RADAR_SOURCE_ID = 'wallcloud-radar-image'
const RADAR_LAYER_ID = 'wallcloud-radar-layer'
const WARNING_SOURCE_ID = 'wallcloud-warning-source'
const WARNING_FILL_ID = 'wallcloud-warning-fill'
const WARNING_LINE_ID = 'wallcloud-warning-line'
const STATE_SOURCE_ID = 'wallcloud-state-source'
const COUNTY_SOURCE_ID = 'wallcloud-county-source'
const HIGHWAY_SOURCE_ID = 'wallcloud-highway-source'
const CITY_SOURCE_ID = 'wallcloud-city-source'
const GRID_SOURCE_ID = 'wallcloud-grid-source'

const EMPTY_STATE = emptyFeatureCollection()
const EMPTY_BOUNDS: [[number, number], [number, number]] = [[REGIONAL_BOUNDS[0], REGIONAL_BOUNDS[1]], [REGIONAL_BOUNDS[2], REGIONAL_BOUNDS[3]]]

function assetUrl(path: string, manifestPath: string): string {
  const manifestUrl = new URL(manifestPath, window.location.href)
  return new URL(path, manifestUrl).toString()
}

function frameUrl(frame: RadarFrameManifest, manifestPath: string): string {
  const manifestUrl = new URL(manifestPath, window.location.href)
  return new URL(frame.url, manifestUrl).toString()
}

function historicalManifestUrl(manifestUrl: string): string {
  const catalogUrl = new URL(HISTORY_CATALOG_PATH, window.location.href)
  return new URL(manifestUrl, catalogUrl).toString()
}

function formatEasternTime(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(date)
}

function formatEasternDateTime(value: string | null | undefined): string {
  if (!value) return 'Unknown'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Unknown'
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(date) + ' ET'
}

function ageMinutes(value: string | null | undefined): number | null {
  if (!value) return null
  const timestamp = Date.parse(value)
  if (Number.isNaN(timestamp)) return null
  return Math.max(0, Math.floor((Date.now() - timestamp) / 60_000))
}

function createMapSources(map: maplibregl.Map): void {
  map.addSource(STATE_SOURCE_ID, { type: 'geojson', data: EMPTY_STATE })
  map.addLayer({
    id: 'wallcloud-state-fill',
    type: 'fill',
    source: STATE_SOURCE_ID,
    paint: { 'fill-color': '#f7f8f7', 'fill-opacity': 0.03 },
  })
  map.addLayer({
    id: 'wallcloud-state-line',
    type: 'line',
    source: STATE_SOURCE_ID,
    paint: { 'line-color': '#202a31', 'line-opacity': 0.9, 'line-width': 1.45 },
  })

  map.addSource(COUNTY_SOURCE_ID, { type: 'geojson', data: EMPTY_STATE })
  map.addLayer({
    id: 'wallcloud-county-line',
    type: 'line',
    source: COUNTY_SOURCE_ID,
    paint: { 'line-color': '#7f8b94', 'line-opacity': 0.58, 'line-width': 0.58 },
  })

  map.addSource(GRID_SOURCE_ID, { type: 'geojson', data: GRID_GEOJSON })
  map.addLayer({
    id: 'wallcloud-coordinate-grid',
    type: 'line',
    source: GRID_SOURCE_ID,
    paint: {
      'line-color': '#71808b',
      'line-opacity': 0.28,
      'line-width': 0.7,
      'line-dasharray': [2, 4],
    },
  })

  map.addSource(HIGHWAY_SOURCE_ID, { type: 'geojson', data: EMPTY_STATE })
  map.addLayer({
    id: 'wallcloud-highway-line',
    type: 'line',
    source: HIGHWAY_SOURCE_ID,
    layout: { visibility: 'none' },
    paint: { 'line-color': '#b27436', 'line-opacity': 0.68, 'line-width': 1.15 },
  })
  map.addLayer({
    id: 'wallcloud-highway-label',
    type: 'symbol',
    source: HIGHWAY_SOURCE_ID,
    layout: {
      visibility: 'none',
      'symbol-placement': 'line',
      'text-field': ['coalesce', ['get', 'NAME'], ['get', 'BASENAME'], ''],
      'text-size': 10,
      'text-font': ['Open Sans Regular'],
      'symbol-spacing': 500,
    },
    paint: { 'text-color': '#845324', 'text-halo-color': '#ffffff', 'text-halo-width': 1.3 },
  })

  map.addSource(CITY_SOURCE_ID, { type: 'geojson', data: CITIES_GEOJSON })
  map.addLayer({
    id: 'wallcloud-city-dot',
    type: 'circle',
    source: CITY_SOURCE_ID,
    paint: {
      'circle-radius': ['case', ['get', 'primary'], 4.2, 2.8],
      'circle-color': ['case', ['get', 'primary'], '#1d2830', '#60707a'],
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 1.2,
      'circle-opacity': 0.94,
    },
  })
  map.addLayer({
    id: 'wallcloud-city-label',
    type: 'symbol',
    source: CITY_SOURCE_ID,
    layout: {
      'text-field': ['get', 'label'],
      'text-size': ['case', ['get', 'primary'], 11, 9],
      'text-offset': [0.7, 0],
      'text-anchor': 'left',
      'text-allow-overlap': false,
      'text-ignore-placement': false,
    },
    paint: { 'text-color': ['case', ['get', 'primary'], '#172129', '#53616a'], 'text-halo-color': '#ffffff', 'text-halo-width': 1.55 },
  })

  map.addSource(WARNING_SOURCE_ID, { type: 'geojson', data: EMPTY_STATE })
  map.addLayer({
    id: WARNING_FILL_ID,
    type: 'fill',
    source: WARNING_SOURCE_ID,
    paint: {
      'fill-color': [
        'match', ['get', 'event'],
        'Tornado Warning', '#f1465d',
        'Severe Thunderstorm Warning', '#f4a340',
        'Flash Flood Warning', '#5cc47f',
        'Special Marine Warning', '#f3cf54',
        '#e8edf0',
      ],
      'fill-opacity': ['case', ['==', ['get', 'id'], '__none__'], 0.12, 0.14],
    },
  })
  map.addLayer({
    id: WARNING_LINE_ID,
    type: 'line',
    source: WARNING_SOURCE_ID,
    paint: {
      'line-color': [
        'match', ['get', 'event'],
        'Tornado Warning', '#f1465d',
        'Severe Thunderstorm Warning', '#f4a340',
        'Flash Flood Warning', '#5cc47f',
        'Special Marine Warning', '#f3cf54',
        '#e8edf0',
      ],
      'line-width': 1.8,
      'line-opacity': 0.88,
    },
  })
}

function setLayerVisibility(map: maplibregl.Map, ids: string[], visible: boolean): void {
  ids.forEach((id) => {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none')
  })
}

function productFrames(manifest: RadarManifest | null, productId: RadarProductId): RadarFrameManifest[] {
  return manifest?.products[productId]?.frames ?? (productId === 'MergedReflectivityQCComposite' ? manifest?.frames ?? [] : [])
}

function freshWarningPanel(warning: RadarWarning | null, onClose: () => void): ReactElement | null {
  if (!warning) return null
  return (
    <section className="radar-warning-panel" aria-live="polite">
      <div className="radar-warning-panel-top">
        <div>
          <span className="radar-panel-kicker">Active NWS warning</span>
          <h2>{warning.event}</h2>
        </div>
        <button type="button" className="radar-icon-button" onClick={onClose} aria-label="Close warning details">×</button>
      </div>
      <p className="radar-warning-headline">{warning.headline}</p>
      <dl>
        <div><dt>Office</dt><dd>{warning.issuingOffice}</dd></div>
        <div><dt>Area</dt><dd>{warning.areaDesc}</dd></div>
        <div><dt>Effective</dt><dd>{formatEasternDateTime(warning.effective)}</dd></div>
        <div><dt>Expires</dt><dd>{formatEasternDateTime(warning.expires)}</dd></div>
      </dl>
    </section>
  )
}

function RadarLegend({ productId }: { productId: RadarProductId }) {
  const entries = productId === 'PrecipFlag' ? PRECIP_LEGEND : REFLECTIVITY_LEGEND
  return (
    <aside className="radar-legend" aria-label={`${productId === 'PrecipFlag' ? 'Precipitation type' : 'Reflectivity'} legend`}>
      <div className="radar-legend-heading">{productId === 'PrecipFlag' ? 'TYPE' : 'dBZ'}</div>
      <div className="radar-legend-swatches">
        {entries.map((entry) => <span key={entry.label} style={{ backgroundColor: entry.color }} title={entry.label} />)}
      </div>
      <div className="radar-legend-labels">
        {entries.map((entry) => <span key={entry.label}>{entry.label}</span>)}
      </div>
    </aside>
  )
}

export function RadarApp() {
  const mapContainer = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const warningsRef = useRef<Map<string, RadarWarning>>(new Map())
  const [mapReady, setMapReady] = useState(false)
  const [mapError, setMapError] = useState<string | null>(null)
  const [manifest, setManifest] = useState<RadarManifest | null>(null)
  const [manifestError, setManifestError] = useState<string | null>(null)
  const [manifestPath, setManifestPath] = useState(LIVE_MANIFEST_PATH)
  const [historyCatalog, setHistoryCatalog] = useState<RadarHistoryCatalog | null>(null)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [datasetId, setDatasetId] = useState('live')
  const [productId, setProductId] = useState<RadarProductId>('MergedReflectivityQCComposite')
  const [frameIndex, setFrameIndex] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState<0.5 | 1 | 2>(1)
  const [radarOpacity, setRadarOpacity] = useState(0.96)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [layers, setLayers] = useState({ radar: true, warnings: true, counties: true, cities: true, highways: false })
  const [warnings, setWarnings] = useState<RadarWarning[]>([])
  const [warningStatus, setWarningStatus] = useState<'loading' | 'ready' | 'degraded'>('loading')
  const [warningErrors, setWarningErrors] = useState<string[]>([])
  const [selectedWarningId, setSelectedWarningId] = useState<string | null>(null)
  const [states, setStates] = useState<GeoJSON.FeatureCollection>(EMPTY_STATE)
  const [counties, setCounties] = useState<GeoJSON.FeatureCollection>(EMPTY_STATE)
  const [geographyError, setGeographyError] = useState<string | null>(null)
  const [highways, setHighways] = useState<GeoJSON.FeatureCollection>(EMPTY_STATE)
  const [highwaysLoading, setHighwaysLoading] = useState(false)
  const [highwaysError, setHighwaysError] = useState<string | null>(null)

  const frames = useMemo(() => productFrames(manifest, productId), [manifest, productId])
  const activeIndex = frames.length ? Math.min(Math.max(frameIndex, 0), frames.length - 1) : 0
  const activeFrame = frames[activeIndex] ?? null
  const latestFrame = frames[frames.length - 1] ?? null
  const selectedWarning = selectedWarningId ? warnings.find((warning) => warning.id === selectedWarningId) ?? null : null
  const isHistorical = manifest?.mode === 'historical' || datasetId !== 'live'
  const latestAge = ageMinutes(manifest?.latest_valid_time)
  const activeAge = ageMinutes(activeFrame?.valid_time)
  const isLatest = Boolean(activeFrame && latestFrame && activeFrame.id === latestFrame.id)
  const freshnessLabel = !activeFrame
    ? 'DATA UNAVAILABLE'
    : isHistorical
      ? 'HISTORICAL'
    : !isLatest
      ? 'PLAYBACK'
      : latestAge === null || latestAge <= 8
        ? 'LIVE'
        : `${latestAge} MIN OLD`

  useEffect(() => {
    let cancelled = false
    fetchHistoryCatalog(HISTORY_CATALOG_PATH)
      .then((catalog) => {
        if (!cancelled) {
          setHistoryCatalog(catalog)
          setHistoryError(null)
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) setHistoryError(error instanceof Error ? error.message : 'Historical catalog request failed')
      })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    let cancelled = false
    const historyEntry = historyCatalog?.datasets.find((dataset) => dataset.id === datasetId)
    const nextManifestPath = datasetId === 'live'
      ? LIVE_MANIFEST_PATH
      : historyEntry
        ? historicalManifestUrl(historyEntry.manifest_url)
        : null
    const load = async () => {
      if (!nextManifestPath) {
        if (!cancelled) setManifestError('The selected historical loop is no longer in the catalog')
        return
      }
      try {
        const next = await fetchRadarManifest(nextManifestPath)
        if (!cancelled) {
          setManifest(next)
          setManifestPath(nextManifestPath)
          setFrameIndex(Math.max(productFrames(next, productId).length - 1, 0))
          setPlaying(false)
          setManifestError(null)
        }
      } catch (error) {
        if (!cancelled) setManifestError(error instanceof Error ? error.message : 'Manifest request failed')
      }
    }
    void load()
    const refresh = datasetId === 'live' ? window.setInterval(() => { void load() }, 300_000) : null
    return () => {
      cancelled = true
      if (refresh !== null) window.clearInterval(refresh)
    }
  }, [datasetId, historyCatalog, productId])

  useEffect(() => {
    if (!playing || frames.length < 2) return
    const delay = 900 / speed + (activeIndex === frames.length - 1 ? 650 : 0)
    const timer = window.setTimeout(() => {
      setFrameIndex((index) => index >= frames.length - 1 ? 0 : index + 1)
    }, delay)
    return () => window.clearTimeout(timer)
  }, [activeIndex, frames.length, playing, speed])

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const result = await fetchRegionalWarnings()
        if (cancelled) return
        if (!result.errors.length || result.warnings.length > 0) {
          setWarnings(result.warnings)
          warningsRef.current = new Map(result.warnings.map((warning) => [warning.id, warning]))
        }
        setWarningErrors(result.errors)
        setWarningStatus(result.errors.length ? 'degraded' : 'ready')
      } catch (error) {
        if (!cancelled) {
          setWarningErrors([error instanceof Error ? error.message : 'NWS request failed'])
          setWarningStatus('degraded')
        }
      }
    }
    void load()
    const refresh = window.setInterval(() => { void load() }, 60_000)
    return () => {
      cancelled = true
      window.clearInterval(refresh)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    fetchRegionalGeography(controller.signal)
      .then((result) => {
        if (cancelled) return
        setStates(result.states)
        setCounties(result.counties)
        setGeographyError(null)
      })
      .catch((error: unknown) => {
        if (!cancelled && error instanceof Error && error.name !== 'AbortError') setGeographyError(error.message)
      })
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [])

  useEffect(() => {
    if (!layers.highways || highways.features.length || highwaysLoading) return
    let cancelled = false
    const controller = new AbortController()
    fetchRegionalHighways(controller.signal)
      .then((result) => {
        if (!cancelled) {
          setHighways(result)
          setHighwaysError(null)
        }
      })
      .catch((error: unknown) => {
        if (!cancelled && error instanceof Error && error.name !== 'AbortError') setHighwaysError(error.message)
      })
      .finally(() => {
        if (!cancelled) setHighwaysLoading(false)
      })
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [highways.features.length, highwaysLoading, layers.highways])

  useEffect(() => {
    if (!mapContainer.current || mapRef.current) return
    const map = new maplibregl.Map({
      container: mapContainer.current,
      style: {
        version: 8,
        sources: {
          basemap: { type: 'raster', tiles: [CARTO_LIGHT_TILES], tileSize: 256, attribution: '© OpenStreetMap contributors © CARTO' },
        },
        layers: [{ id: 'wallcloud-basemap', type: 'raster', source: 'basemap', paint: { 'raster-opacity': 1 } }],
      },
      center: MAP_CENTER,
      zoom: 6.25,
      minZoom: 5.2,
      maxZoom: 12,
      maxBounds: [[REGIONAL_BOUNDS[0] - 1, REGIONAL_BOUNDS[1] - 1], [REGIONAL_BOUNDS[2] + 1, REGIONAL_BOUNDS[3] + 1]],
      attributionControl: false,
    })
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right')
    map.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: '© OpenStreetMap contributors © CARTO · NOAA MRMS · NWS' }), 'bottom-right')
    map.on('load', () => {
      createMapSources(map)
      map.fitBounds(EMPTY_BOUNDS, { padding: { top: 24, right: 24, bottom: 210, left: 24 }, duration: 0 })
      map.resize()
      setMapReady(true)
    })
    map.on('click', WARNING_FILL_ID, (event) => {
      const feature = event.features?.[0]
      const id = feature?.properties?.id ?? feature?.id
      if (id) setSelectedWarningId(String(id))
    })
    map.on('mouseenter', WARNING_FILL_ID, () => { map.getCanvas().style.cursor = 'pointer' })
    map.on('mouseleave', WARNING_FILL_ID, () => { map.getCanvas().style.cursor = '' })
    map.on('error', (event) => {
      if (event.error?.message && !event.error.message.toLowerCase().includes('tile')) setMapError(event.error.message)
    })
    const resizeObserver = new ResizeObserver(() => map.resize())
    resizeObserver.observe(mapContainer.current)
    mapRef.current = map
    return () => {
      resizeObserver.disconnect()
      map.remove()
      mapRef.current = null
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    const source = map.getSource(RADAR_SOURCE_ID) as maplibregl.ImageSource | undefined
    if (activeFrame && !source) {
      const bounds = activeFrame.bounds
      map.addSource(RADAR_SOURCE_ID, {
        type: 'image',
        url: frameUrl(activeFrame, manifestPath),
        coordinates: [[bounds[0], bounds[3]], [bounds[2], bounds[3]], [bounds[2], bounds[1]], [bounds[0], bounds[1]]],
      })
      map.addLayer({
        id: RADAR_LAYER_ID,
        type: 'raster',
        source: RADAR_SOURCE_ID,
        paint: { 'raster-opacity': radarOpacity, 'raster-fade-duration': 0, 'raster-resampling': 'nearest' },
      }, map.getLayer('wallcloud-state-fill') ? 'wallcloud-state-fill' : undefined)
    } else if (source && activeFrame) {
      const bounds = activeFrame.bounds
      source.updateImage({
        url: frameUrl(activeFrame, manifestPath),
        coordinates: [[bounds[0], bounds[3]], [bounds[2], bounds[3]], [bounds[2], bounds[1]], [bounds[0], bounds[1]]],
      })
    }
    if (activeFrame) {
      const preload = frames.slice(Math.max(0, activeIndex - 2), Math.min(frames.length, activeIndex + 3))
      preload.forEach((frame) => {
        const image = new Image()
        image.src = frameUrl(frame, manifestPath)
      })
    }
  }, [activeFrame, activeIndex, frames, manifestPath, mapReady, radarOpacity])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    if (map.getLayer(RADAR_LAYER_ID)) map.setPaintProperty(RADAR_LAYER_ID, 'raster-opacity', radarOpacity)
    setLayerVisibility(map, [RADAR_LAYER_ID], layers.radar && Boolean(activeFrame))
    setLayerVisibility(map, ['wallcloud-county-line'], layers.counties)
    setLayerVisibility(map, ['wallcloud-city-dot', 'wallcloud-city-label'], layers.cities)
    setLayerVisibility(map, ['wallcloud-highway-line', 'wallcloud-highway-label'], layers.highways)
    setLayerVisibility(map, [WARNING_FILL_ID, WARNING_LINE_ID], layers.warnings && !isHistorical)
  }, [activeFrame, isHistorical, layers, mapReady, radarOpacity])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    const stateSource = map.getSource(STATE_SOURCE_ID) as maplibregl.GeoJSONSource | undefined
    const countySource = map.getSource(COUNTY_SOURCE_ID) as maplibregl.GeoJSONSource | undefined
    const highwaySource = map.getSource(HIGHWAY_SOURCE_ID) as maplibregl.GeoJSONSource | undefined
    const citySource = map.getSource(CITY_SOURCE_ID) as maplibregl.GeoJSONSource | undefined
    const warningSource = map.getSource(WARNING_SOURCE_ID) as maplibregl.GeoJSONSource | undefined
    stateSource?.setData(states)
    countySource?.setData(counties)
    highwaySource?.setData(highways)
    citySource?.setData(CITIES_GEOJSON)
    warningSource?.setData(warningsFeatureCollection(warnings))
    if (map.getLayer(WARNING_FILL_ID)) {
      map.setPaintProperty(WARNING_FILL_ID, 'fill-opacity', ['case', ['==', ['get', 'id'], selectedWarningId ?? '__none__'], 0.25, 0.13])
    }
    if (map.getLayer(WARNING_LINE_ID)) {
      map.setPaintProperty(WARNING_LINE_ID, 'line-width', ['case', ['==', ['get', 'id'], selectedWarningId ?? '__none__'], 3.4, 1.8])
    }
  }, [counties, highways, mapReady, selectedWarningId, states, warnings])

  const selectedProduct = manifest?.products[productId]
  const dataUnavailable = !manifest || manifest.status !== 'ready' || !activeFrame
  const dataStale = !isHistorical && latestAge !== null && latestAge > 15
  const loopDownloadUrl = selectedProduct?.loop_url ? assetUrl(selectedProduct.loop_url, manifestPath) : null

  const toggleLayer = (key: keyof typeof layers) => {
    if (key === 'highways' && !layers.highways) setHighwaysLoading(true)
    setLayers((current) => ({ ...current, [key]: !current[key] }))
  }

  return (
    <div className="radar-app">
      <header className="radar-header">
        <div className="radar-brand-lockup">
          <span className="radar-mark" aria-hidden="true"><i /><i /><i /></span>
          <div>
            <div className="radar-product-name">Wall Cloud Radar</div>
            <div className="radar-region-name">North Carolina <span>/ {isHistorical ? 'archive loop' : 'regional view'}</span></div>
          </div>
        </div>
        <div className="radar-header-status">
          <div className={`radar-freshness ${freshnessLabel === 'LIVE' ? 'live' : freshnessLabel === 'HISTORICAL' ? 'historical' : freshnessLabel === 'DATA UNAVAILABLE' ? 'unavailable' : ''}`}>
            <span className="radar-status-dot" /> {freshnessLabel}
          </div>
          <div className="radar-valid-time">{formatEasternTime(activeFrame?.valid_time)} ET</div>
        </div>
        <div className="radar-header-actions">
          <span className="radar-warning-count">{isHistorical ? manifest?.label ?? 'Historical loop' : `${warnings.length} active warning${warnings.length === 1 ? '' : 's'}`}</span>
          <button type="button" className="radar-settings-button" onClick={() => setSettingsOpen((open) => !open)} aria-expanded={settingsOpen}>
            <span className="radar-sliders-icon" aria-hidden="true">☷</span> Layers
          </button>
        </div>
      </header>

      <main className="radar-map-area">
        <div ref={mapContainer} className="radar-map" aria-label="Interactive North Carolina radar map" />

        <div className="radar-map-badge">
          <span>{isHistorical ? 'MRMS archive' : 'MRMS live'}</span>
          <span className="radar-badge-divider" />
          <span>{selectedProduct?.label ?? 'Composite Reflectivity'}</span>
        </div>

        {(manifestError || mapError) && (
          <div className="radar-data-strip degraded" role="status">
            <strong>Map data issue</strong>
            <span>{manifestError ?? mapError}</span>
          </div>
        )}

        {dataStale && !manifestError && !mapError && (
          <div className="radar-data-strip stale" role="status">
            <strong>Stale radar</strong>
            <span>Latest generated observation is {latestAge} min old.</span>
          </div>
        )}

        {dataUnavailable && (
          <div className="radar-unavailable" role="status">
            <div className="radar-unavailable-icon">◎</div>
            <strong>Radar imagery unavailable</strong>
            <span>{isHistorical ? 'That historical pack has no usable radar frames.' : 'The map is ready. Run the MRMS processor or wait for the next generated data artifact.'}</span>
            {manifest?.errors?.[0] && <small>{manifest.errors[0]}</small>}
          </div>
        )}

        {geographyError && <div className="radar-data-strip geography-warning">Boundary data unavailable · radar remains available</div>}

        <RadarLegend productId={productId} />

        <aside className={`radar-settings ${settingsOpen ? 'open' : ''}`} aria-label="Radar controls and layers">
          <div className="radar-settings-head">
            <div>
              <span className="radar-panel-kicker">Display</span>
              <h2>Layers & product</h2>
            </div>
            <button type="button" className="radar-icon-button radar-mobile-close" onClick={() => setSettingsOpen(false)} aria-label="Close layers panel">×</button>
          </div>

          <label className="radar-field-label" htmlFor="radar-dataset">Loop source</label>
          <select
            id="radar-dataset"
            className="radar-select"
            value={datasetId}
            onChange={(event) => {
              const nextDatasetId = event.target.value
              setDatasetId(nextDatasetId)
              setLayers((current) => ({ ...current, warnings: nextDatasetId === 'live' }))
              setSelectedWarningId(null)
              setProductId('MergedReflectivityQCComposite')
              setPlaying(false)
            }}
          >
            <option value="live">Live / recent radar</option>
            {(historyCatalog?.datasets.length ?? 0) > 0 && (
              <optgroup label="Historical loops">
                {historyCatalog?.datasets.map((dataset) => (
                  <option key={dataset.id} value={dataset.id}>{dataset.label}</option>
                ))}
              </optgroup>
            )}
          </select>
          {!historyCatalog?.datasets.length && <p className="radar-field-note">No historical packs are generated yet. Use the historical Python command documented in the README.</p>}
          {historyError && <p className="radar-field-note error">Historical catalog unavailable: {historyError}</p>}

          <label className="radar-field-label" htmlFor="radar-product">Product</label>
          <select
            id="radar-product"
            className="radar-select"
            value={productId}
            onChange={(event) => {
              const nextProduct = event.target.value as RadarProductId
              setProductId(nextProduct)
              setFrameIndex(Math.max(productFrames(manifest, nextProduct).length - 1, 0))
              setPlaying(false)
            }}
          >
            {PRODUCT_OPTIONS.map((option) => {
              const status = manifest?.products[option.id]?.status
              const ready = option.id === 'MergedReflectivityQCComposite' || status === 'ready' || status === 'partial'
              return <option key={option.id} value={option.id} disabled={!ready}>{option.label}{ready ? '' : ' · processor needed'}</option>
            })}
          </select>
          {productId === 'PrecipFlag' && <p className="radar-field-note">MRMS flag classes are shown only where the official PrecipFlag product decodes successfully.</p>}

          <div className="radar-layer-list">
            {([
              ['radar', 'Radar', 'MRMS raster frame'],
              ['warnings', 'Warnings', isHistorical ? 'Unavailable for historical playback' : warningStatus === 'degraded' ? 'NWS refresh degraded' : 'NWS active polygons'],
              ['counties', 'Counties', 'Census boundary overlay'],
              ['cities', 'Cities', 'Priority NC locations'],
              ['highways', 'Highways', highwaysLoading ? 'Loading on demand…' : 'Census interstate overlay'],
            ] as Array<[keyof typeof layers, string, string]>).map(([key, label, note]) => (
              <label key={key} className="radar-layer-row">
                <input type="checkbox" checked={layers[key]} onChange={() => toggleLayer(key)} disabled={key === 'warnings' && isHistorical} />
                <span className="radar-checkbox" aria-hidden="true" />
                <span><strong>{label}</strong><small>{note}</small></span>
              </label>
            ))}
          </div>

          <label className="radar-field-label" htmlFor="radar-opacity">Radar opacity <output>{Math.round(radarOpacity * 100)}%</output></label>
          <input id="radar-opacity" className="radar-range" type="range" min="0.2" max="1" step="0.05" value={radarOpacity} onChange={(event) => setRadarOpacity(Number(event.target.value))} />
          {highwaysError && <p className="radar-field-note error">Highway overlay unavailable: {highwaysError}</p>}
          {warningErrors.length > 0 && <p className="radar-field-note error">NWS: showing the last successful regional result where available.</p>}
          <p className="radar-source-note">Radar: NOAA/NCEP MRMS · alerts: National Weather Service · boundaries: U.S. Census TIGERweb</p>
        </aside>

        {freshWarningPanel(selectedWarning, () => setSelectedWarningId(null))}

        <section className="radar-timeline" aria-label="Radar animation controls">
          <div className="radar-timeline-top">
            <div>
              <span className="radar-panel-kicker">Timeline</span>
              <strong>{activeFrame ? formatEasternDateTime(activeFrame.valid_time) : 'No frame selected'}</strong>
            </div>
            <span className="radar-frame-count">{frames.length ? `${activeIndex + 1} / ${frames.length}` : '0 frames'}</span>
          </div>
          <input
            className="radar-timeline-range"
            type="range"
            min="0"
            max={Math.max(frames.length - 1, 0)}
            step="1"
            value={activeIndex}
            disabled={frames.length < 2}
            onChange={(event) => {
              setPlaying(false)
              setFrameIndex(Number(event.target.value))
            }}
            aria-label="Radar frame timeline"
          />
          <div className="radar-timeline-endpoints"><span>{formatEasternTime(frames[0]?.valid_time)} ET</span><span>{latestFrame ? `${formatEasternTime(latestFrame.valid_time)} ET · ${isHistorical ? 'end' : 'latest'}` : 'Latest unavailable'}</span></div>
          <div className="radar-control-row">
            <button type="button" onClick={() => { setPlaying(false); setFrameIndex((index) => Math.max(0, index - 1)) }} disabled={!frames.length || activeIndex === 0}>‹ <span>Previous</span></button>
            <button type="button" className="radar-play-button" onClick={() => setPlaying((value) => !value)} disabled={frames.length < 2}>{playing ? '❚❚ Pause' : '▶ Play'}</button>
            <button type="button" onClick={() => { setPlaying(false); setFrameIndex((index) => Math.min(frames.length - 1, index + 1)) }} disabled={!frames.length || activeIndex === frames.length - 1}><span>Next</span> ›</button>
            <div className="radar-speed-control" role="group" aria-label="Playback speed">
              {[0.5, 1, 2].map((value) => <button key={value} type="button" className={speed === value ? 'active' : ''} onClick={() => setSpeed(value as 0.5 | 1 | 2)}>{value}×</button>)}
            </div>
            {loopDownloadUrl ? (
              <a className="radar-download-button" href={loopDownloadUrl} download={`wall-cloud-${manifest?.dataset_id ?? 'live'}-${productId}.gif`}>Save GIF</a>
            ) : (
              <span className="radar-download-unavailable" title="Run the updated Python processor to generate a GIF">GIF unavailable</span>
            )}
          </div>
          {activeAge !== null && !isLatest && !isHistorical && <div className="radar-playback-note">Playback frame · latest observation is {Math.max(0, latestAge ?? 0)} min old</div>}
        </section>
      </main>
    </div>
  )
}
