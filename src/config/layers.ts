import type { LayerDefinition } from '../types/weather'

export const WEATHER_LAYERS: LayerDefinition[] = [
  {
    id: 'nwsAlerts',
    label: 'NWS Alerts',
    description: 'National Weather Service active alerts feed',
    defaultEnabled: true,
  },
  {
    id: 'wwaPolygons',
    label: 'WWA Polygons',
    description: 'Watch/warning/advisory polygons',
    defaultEnabled: false,
  },
  {
    id: 'radar',
    label: 'Radar',
    description: 'RainViewer radar metadata and frames',
    defaultEnabled: true,
  },
  {
    id: 'spcOutlook',
    label: 'SPC Outlook',
    description: 'Storm Prediction Center outlook context',
    defaultEnabled: true,
  },
  {
    id: 'stormReports',
    label: 'Storm Reports',
    description: 'SPC daily local storm reports',
    defaultEnabled: true,
  },
  {
    id: 'spcWatches',
    label: 'SPC Watches',
    description: 'Active tornado and severe thunderstorm watch polygons from WWA service',
    defaultEnabled: true,
  },
]

