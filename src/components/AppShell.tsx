import { useState, type DragEvent } from 'react'
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
import { CommandBar } from './CommandBar'
import { SourceHealthPanel } from './SourceHealthPanel'

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
  if (moduleId === 'sourceHealth') return <SourceHealthPanel />
  const module = WORKSPACE_MODULES.find((item) => item.id === moduleId)
  return module ? <PlaceholderModule module={module} /> : null
}

function WorkspaceZone({ zone, activeDropZone, setActiveDropZone }: { zone: WorkspaceZoneId; activeDropZone: WorkspaceZoneId | null; setActiveDropZone: (zone: WorkspaceZoneId | null) => void }) {
  const preferences = useWorkspaceStore((state) => state.preferences)
  const setModuleZone = useWorkspaceStore((state) => state.setModuleZone)
  const modules = WORKSPACE_MODULES.filter((module) => preferences[module.id]?.visible && preferences[module.id]?.zone === zone)

  function handleDragOver(event: DragEvent<HTMLElement>) {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    setActiveDropZone(zone)
  }

  function handleDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault()
    const moduleId = event.dataTransfer.getData('text/plain') as WorkspaceModuleId
    if (WORKSPACE_MODULES.some((module) => module.id === moduleId)) setModuleZone(moduleId, zone)
    setActiveDropZone(null)
  }

  return (
    <aside
      className={`workspace-zone workspace-zone-${zone} ${zoneClassNames[zone]} ${activeDropZone === zone ? 'drop-active' : ''} ${modules.length === 0 ? 'empty' : ''}`}
      aria-label={zoneLabels[zone]}
      data-workspace-zone-target={zone}
      onDragOver={handleDragOver}
      onDragLeave={() => setActiveDropZone(null)}
      onDrop={handleDrop}
    >
      {modules.length === 0 && <p className="workspace-empty-zone">Drop modules here</p>}
      {modules.map((module) => (
        <WorkspaceModuleFrame key={module.id} moduleId={module.id}>
          <ModuleContent moduleId={module.id} />
        </WorkspaceModuleFrame>
      ))}
    </aside>
  )
}

export function AppShell() {
  const [workspacePanelOpen, setWorkspacePanelOpen] = useState(true)
  const [activeDropZone, setActiveDropZone] = useState<WorkspaceZoneId | null>(null)

  return (
    <div className="app-shell">
      <MapView />
      <CommandBar workspacePanelOpen={workspacePanelOpen} onToggleWorkspacePanel={() => setWorkspacePanelOpen((open) => !open)} />
      <div className="operator-layout">
        <WorkspaceZone zone="leftRail" activeDropZone={activeDropZone} setActiveDropZone={setActiveDropZone} />
        <WorkspaceZone zone="rightRail" activeDropZone={activeDropZone} setActiveDropZone={setActiveDropZone} />
        <WorkspaceZone zone="bottomDock" activeDropZone={activeDropZone} setActiveDropZone={setActiveDropZone} />
        <WorkspaceZone zone="mapOverlay" activeDropZone={activeDropZone} setActiveDropZone={setActiveDropZone} />
        <WorkspaceZone zone="focusPanel" activeDropZone={activeDropZone} setActiveDropZone={setActiveDropZone} />
      </div>
      {workspacePanelOpen && <WorkspacePanel />}
      <WeatherLayerPanel />
      <PresetBar />
    </div>
  )
}
