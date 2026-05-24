import type { SpcStormReport, WeatherAlert } from '../types/weather'

type Bounds = [[number, number], [number, number]]

function extendBounds(bounds: Bounds | null, lon: number, lat: number): Bounds {
  if (!bounds) return [[lon, lat], [lon, lat]]
  return [
    [Math.min(bounds[0][0], lon), Math.min(bounds[0][1], lat)],
    [Math.max(bounds[1][0], lon), Math.max(bounds[1][1], lat)],
  ]
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

export function featureCollectionFromAlerts(alerts: WeatherAlert[]): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = alerts
    .filter((alert) => alert.geometryStatus === 'mapped' && alert.geometry)
    .map((alert) => ({
      type: 'Feature',
      geometry: alert.geometry as GeoJSON.Geometry,
      properties: {
        id: alert.id,
        event: alert.event,
        severity: alert.severity,
      },
    }))

  return {
    type: 'FeatureCollection',
    features,
  }
}

export function featureCollectionFromSpcReports(reports: SpcStormReport[]): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = reports.map((report) => ({
    type: 'Feature',
    geometry: {
      type: 'Point',
      coordinates: [report.lon, report.lat],
    },
    properties: {
      id: report.id,
      type: report.type,
      location: report.location,
      state: report.state,
      magnitude: report.magnitude ?? '',
    },
  }))

  return {
    type: 'FeatureCollection',
    features,
  }
}
