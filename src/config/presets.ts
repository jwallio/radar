import type { LayerPreset } from '../types/weather'

export const WEATHER_PRESETS: LayerPreset[] = [
  {
    id: 'radar-only',
    label: 'Radar Only',
    enabledLayers: ['radar'],
  },
  {
    id: 'severe-weather',
    label: 'Severe Weather',
    enabledLayers: ['nwsAlerts', 'spcOutlook', 'stormReports', 'radar'],
  },
  {
    id: 'spc-outlook',
    label: 'SPC Outlook',
    enabledLayers: ['spcOutlook', 'stormReports'],
  },
  {
    id: 'clean-map',
    label: 'Clean Map',
    enabledLayers: [],
  },
]

