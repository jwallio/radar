import type { SpcStormReport, WeatherAlert } from '../types/weather'
import type { WwaWatch } from '../services/wwa'

type Bounds = [[number, number], [number, number]]

function extendBounds(bounds: Bounds | null, lon: number, lat: number): Bounds {
  if (!bounds) return [[lon, lat], [lon, lat]]
  return [[Math.min(bounds[0][0], lon), Math.min(bounds[0][1], lat)], [Math.max(bounds[1][0], lon), Math.max(bounds[1][1], lat)]]
}

function coordinatesBounds(coordinates: number[][][] | number[][][][]): Bounds | null {
  let bounds: Bounds | null = null
  for (const ringLike of coordinates) {
    for (const ring of ringLike as number[][]) {
      const pair = ring as unknown as [number, number]
      bounds = extendBounds(bounds, pair[0], pair[1])
    }
  }
  return bounds
}

export function boundsFromGeometry(geometry: GeoJSON.Geometry | null): Bounds | null {
  if (!geometry) return null
  if (geometry.type === 'Polygon') return coordinatesBounds(geometry.coordinates)
  if (geometry.type === 'MultiPolygon') return coordinatesBounds(geometry.coordinates)
  return null
}

export function boundsFromGeometries(geometries: Array<GeoJSON.Geometry | null | undefined>): Bounds | null {
  let bounds: Bounds | null = null
  for (const geometry of geometries) {
    const current = boundsFromGeometry(geometry ?? null)
    if (!current) continue
    bounds = extendBounds(bounds, current[0][0], current[0][1])
    bounds = extendBounds(bounds, current[1][0], current[1][1])
  }
  return bounds
}

export function featureCollectionFromAlerts(alerts: WeatherAlert[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: alerts.filter((a) => a.geometryStatus === 'mapped' && a.geometry).map((a) => ({ type: 'Feature', geometry: a.geometry as GeoJSON.Geometry, properties: { id: a.id, event: a.event, severity: a.severity, urgency: a.urgency ?? '', certainty: a.certainty ?? '', areaDesc: a.areaDesc, headline: a.headline, expires: a.expires ?? '', effective: a.effective ?? '' } })),
  }
}

export function featureCollectionFromSpcReports(reports: SpcStormReport[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: reports.map((r) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [r.lon, r.lat] }, properties: { id: r.id, type: r.type, location: r.location, state: r.state, magnitude: r.magnitude ?? '' } })),
  }
}

export function featureCollectionFromWatches(watches: WwaWatch[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: watches.map((w) => ({
      type: 'Feature',
      geometry: w.geometry,
      properties: {
        id: w.id,
        type: w.type,
        label: w.label,
        wfo: w.wfo ?? '',
        eventNumber: w.eventNumber ?? '',
        issued: w.issued ?? '',
        expires: w.expires ?? '',
      },
    })),
  }
}
