/** Shared map layer IDs — single source of truth for MapView and all layer hooks. */
export const MAP_LAYER_IDS = {
  alertsSource: 'nws-alerts-source',
  alertsFill: 'nws-alerts-fill',
  alertsLine: 'nws-alerts-line',
  alertsSelectedLine: 'nws-alerts-selected-line',
  alertsPulse: 'nws-alerts-warning-pulse',

  radarSource: 'rainviewer-radar-source',
  radarLayer: 'rainviewer-radar-layer',

  reportsSource: 'spc-reports-source',
  reportsLayer: 'spc-reports-layer',

  outlookSource: 'spc-day1-outlook-source',
  outlookFill: 'spc-day1-outlook-fill',
  outlookLine: 'spc-day1-outlook-line',

  watchesSource: 'spc-watches-source',
  watchesFill: 'spc-watches-fill',
  watchesLine: 'spc-watches-line',

  wwaSource: 'wwa-polygon-source',
  wwaFill: 'wwa-polygon-fill',
  wwaLine: 'wwa-polygon-line',

  spotterSource: 'spotter-network-source',
  spotterLayer: 'spotter-network-layer',
  spotterCamLayer: 'spotter-cam-layer',
} as const

export type MapLayerId = (typeof MAP_LAYER_IDS)[keyof typeof MAP_LAYER_IDS]

/** All layer IDs (non-source) — used by basemap switcher to tear down + rebuild. */
export const ALL_LAYER_IDS: readonly MapLayerId[] = [
  MAP_LAYER_IDS.radarLayer,
  MAP_LAYER_IDS.outlookFill,
  MAP_LAYER_IDS.outlookLine,
  MAP_LAYER_IDS.alertsFill,
  MAP_LAYER_IDS.alertsLine,
  MAP_LAYER_IDS.alertsSelectedLine,
  MAP_LAYER_IDS.alertsPulse,
  MAP_LAYER_IDS.reportsLayer,
  MAP_LAYER_IDS.spotterLayer,
  MAP_LAYER_IDS.spotterCamLayer,
  MAP_LAYER_IDS.watchesFill,
  MAP_LAYER_IDS.watchesLine,
  MAP_LAYER_IDS.wwaFill,
  MAP_LAYER_IDS.wwaLine,
]