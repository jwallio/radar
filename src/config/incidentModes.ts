export interface IncidentModeDefinition {
  id: string
  label: string
  workspacePresetId: string
  layerPresetId: string
  regionalPackId: string
  regionalAreas: string[]
  alertViewMode: 'all' | 'warnings' | 'watches'
}

export const INCIDENT_MODES: IncidentModeDefinition[] = [
  {
    id: 'tornado-warning-ops',
    label: 'Tornado Warning Ops',
    workspacePresetId: 'tornadoOutbreak',
    layerPresetId: 'severe-weather',
    regionalPackId: 'deep-south',
    regionalAreas: ['TX', 'OK', 'AR', 'LA'],
    alertViewMode: 'warnings',
  },
  {
    id: 'flash-flood-ops',
    label: 'Flash Flood Ops',
    workspacePresetId: 'localOps',
    layerPresetId: 'severe-weather',
    regionalPackId: 'southeast',
    regionalAreas: ['NC', 'SC', 'TN', 'GA', 'AL', 'FL'],
    alertViewMode: 'warnings',
  },
  {
    id: 'night-scanner-ops',
    label: 'Night Scanner Ops',
    workspacePresetId: 'localOps',
    layerPresetId: 'clean-map',
    regionalPackId: 'mid-atlantic',
    regionalAreas: ['VA', 'DC', 'MD', 'DE', 'NJ', 'PA'],
    alertViewMode: 'all',
  },
]
