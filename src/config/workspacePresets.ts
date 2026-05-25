import type { WorkspacePresetDefinition, WorkspacePreferences, WorkspaceZoneId } from '../types/weather'

const hiddenZone: WorkspaceZoneId = 'rightRail'

function preferences(overrides: Partial<WorkspacePreferences>): WorkspacePreferences {
  return {
    alerts: { visible: true, zone: 'leftRail' },
    liveContext: { visible: true, zone: 'rightRail' },
    spc: { visible: true, zone: 'bottomDock' },
    radar: { visible: true, zone: 'bottomDock' },
    cameras: { visible: false, zone: hiddenZone },
    scanners: { visible: false, zone: hiddenZone },
    weatherNews: { visible: false, zone: 'focusPanel' },
    sourceHealth: { visible: true, zone: 'mapOverlay' },
    legendTime: { visible: true, zone: 'mapOverlay' },
    ...overrides,
  }
}

export const WORKSPACE_PRESETS: WorkspacePresetDefinition[] = [
  {
    id: 'severeNowcast',
    title: 'Severe Weather Nowcast',
    description: 'Balanced alert, SPC, radar, and live-context view for active severe weather monitoring.',
    preferences: preferences({}),
  },
  {
    id: 'tornadoOutbreak',
    title: 'Tornado Outbreak Mode',
    description: 'Elevates SPC, radar, alerts, cameras, scanners, and local context for fast severe-weather triage.',
    preferences: preferences({
      cameras: { visible: true, zone: 'rightRail' },
      scanners: { visible: true, zone: 'bottomDock' },
      weatherNews: { visible: true, zone: 'focusPanel' },
      spc: { visible: true, zone: 'bottomDock' },
      radar: { visible: true, zone: 'bottomDock' },
    }),
  },
  {
    id: 'cleanRadar',
    title: 'Clean Radar Mode',
    description: 'Keeps radar and critical alerts available while reducing placeholder and secondary modules.',
    preferences: preferences({
      alerts: { visible: true, zone: 'rightRail' },
      liveContext: { visible: false, zone: 'rightRail' },
      spc: { visible: false, zone: 'bottomDock' },
      radar: { visible: true, zone: 'bottomDock' },
      sourceHealth: { visible: false, zone: 'mapOverlay' },
      legendTime: { visible: true, zone: 'mapOverlay' },
    }),
  },
  {
    id: 'localOps',
    title: 'Local Ops Mode',
    description: 'Prioritizes alerts, live context, scanners, and source status for local operations desks.',
    preferences: preferences({
      radar: { visible: true, zone: 'bottomDock' },
      spc: { visible: true, zone: 'focusPanel' },
      scanners: { visible: true, zone: 'rightRail' },
      sourceHealth: { visible: true, zone: 'mapOverlay' },
    }),
  },
  {
    id: 'sourceHealth',
    title: 'Source Health View',
    description: 'Surfaces status and map context modules while keeping core weather feeds reachable.',
    preferences: preferences({
      alerts: { visible: true, zone: 'leftRail' },
      radar: { visible: true, zone: 'bottomDock' },
      spc: { visible: true, zone: 'rightRail' },
      liveContext: { visible: false, zone: 'rightRail' },
      sourceHealth: { visible: true, zone: 'focusPanel' },
      legendTime: { visible: true, zone: 'mapOverlay' },
    }),
  },
]

export const WORKSPACE_PRESET_BY_ID = new Map(WORKSPACE_PRESETS.map((preset) => [preset.id, preset]))
