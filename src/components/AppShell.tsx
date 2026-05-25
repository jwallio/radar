import { NwsAlertsPanel } from './NwsAlertsPanel'
import { SpcPanel } from './SpcPanel'
import { RadarPanel } from './RadarPanel'
import { MapView } from './MapView'
import { WeatherLayerPanel } from './WeatherLayerPanel'
import { PresetBar } from './PresetBar'
import { LiveContextRail } from './LiveContextRail'
import { WORKSPACE_MODULES } from '../config/workspaceModules'
import { useWorkspaceStore } from '../state/workspaceStore'
import type { WorkspaceModuleDefinition, WorkspaceModuleId, WorkspaceZoneId } from '../types/weather'
import { WorkspaceModuleFrame } from './WorkspaceModuleFrame'
import { WorkspacePanel } from './WorkspacePanel'

const zoneLabels: Record<WorkspaceZoneId, string> = {
  leftRail: 'Left rail',
  rightRail: 'Right rail',
  bottomDock: 'Bottom dock',
  mapOverlay: 'Map overlay',
  focusPanel: 'Focus panel',
}

const zoneClassNames: Record<WorkspaceZoneId, string> = {
  leftRail: 'side-panel left-panel',
  rightRail: 'operator-rail right-rail',
  bottomDock: 'operator-dock',
  mapOverlay: '',
  focusPanel: '',
}

function PlaceholderModule({ module }: { module: WorkspaceModuleDefinition }) {
  return (
    <div className="workspace-module-body">
      <p>{module.description}</p>
      <p className="workspace-placeholder-note">Placeholder module. This build provides configuration only; no embedded live feed is active.</p>
    </div>
  )
}

function ModuleContent({ moduleId }: { moduleId: WorkspaceModuleId }) {
  if (moduleId === 'alerts') return <NwsAlertsPanel embedded />
  if (moduleId === 'liveContext') return <LiveContextRail embedded />
  if (moduleId === 'spc') return <SpcPanel />
  if (moduleId === 'radar') return <RadarPanel />
  const module = WORKSPACE_MODULES.find((item) => item.id === moduleId)
  return module ? <PlaceholderModule module={module} /> : null
}

function WorkspaceZone({ zone }: { zone: WorkspaceZoneId }) {
  const preferences = useWorkspaceStore((state) => state.preferences)
  const modules = WORKSPACE_MODULES.filter((module) => preferences[module.id]?.visible && preferences[module.id]?.zone === zone)
  if (modules.length === 0) return null

  return (
    <aside className={`workspace-zone workspace-zone-${zone} ${zoneClassNames[zone]}`} aria-label={zoneLabels[zone]}>
      {modules.map((module) => (
        <WorkspaceModuleFrame key={module.id} moduleId={module.id}>
          <ModuleContent moduleId={module.id} />
        </WorkspaceModuleFrame>
      ))}
    </aside>
  )
}

export function AppShell() {
  return (
    <div className="app-shell">
      <MapView />
      <div className="operator-layout">
        <WorkspaceZone zone="leftRail" />
        <WorkspaceZone zone="rightRail" />
        <WorkspaceZone zone="bottomDock" />
        <WorkspaceZone zone="mapOverlay" />
        <WorkspaceZone zone="focusPanel" />
      </div>
      <WorkspacePanel />
      <WeatherLayerPanel />
      <PresetBar />
    </div>
  )
}
