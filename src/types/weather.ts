export type LayerId = 'nwsAlerts' | 'wwaPolygons' | 'radar' | 'spcOutlook' | 'stormReports'

export interface LayerDefinition { id: LayerId; label: string; description: string; defaultEnabled: boolean }
export interface LayerPreset { id: string; label: string; enabledLayers: LayerId[] }
export interface SourceLink { id: string; label: string; url: string }

export interface SafeFetchError { kind: 'network' | 'http' | 'invalid-content-type' | 'invalid-json'; message: string; status?: number; contentType?: string; bodyPreview?: string }
export interface SafeFetchResult<T> { data?: T; error?: SafeFetchError }

export type AlertSeverity = 'Extreme' | 'Severe' | 'Moderate' | 'Minor' | 'Unknown'
export type AlertGeometryStatus = 'mapped' | 'unmapped'

export interface WeatherAlert {
  id: string; event: string; severity: AlertSeverity; headline: string; description: string; areaDesc: string
  effective: string | null; onset: string | null; expires: string | null; sent: string | null
  status: string | null; messageType: string | null; urgency: string | null; certainty: string | null
  affectedZones: string[]; geometry: GeoJSON.Geometry | null; geometryStatus: AlertGeometryStatus; sourceUrl: string
}

export interface RainViewerFrame { id: string; time: number; timestampIso: string; path: string; kind: 'past' | 'nowcast'; tileUrlTemplate: string }
export interface RainViewerRadarState { version: string | null; generated: number | null; host: string; frames: RainViewerFrame[]; latestFrame: RainViewerFrame | null; sourceUrl: string; error?: SafeFetchError }

export type SpcReportType = 'tornado' | 'wind' | 'hail'
export interface SpcStormReport { id: string; type: SpcReportType; time: string; magnitude: string | null; location: string; county: string; state: string; lat: number; lon: number; remarks: string }
export interface SpcReportsState { reports: SpcStormReport[]; byType: Record<SpcReportType, number>; sourceUrl: string; fetchedAt: string; error?: SafeFetchError | { kind: 'parse'; message: string; bodyPreview?: string } }
export interface SpcOutlookState { sourceUrl: string; fetchedAt: string; featureCollection: GeoJSON.FeatureCollection; error?: SafeFetchError }

export type LiveContextModuleType = 'cams' | 'chasers' | 'spotters' | 'news' | 'scanner'
export interface LiveContextItem { id: string; label: string; url?: string; description?: string; location?: string }
export interface LiveContextModule { id: string; title: string; type: LiveContextModuleType; items: LiveContextItem[]; emptyMessage: string }
