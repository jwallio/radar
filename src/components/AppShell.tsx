import { useEffect, useMemo, useState, type DragEvent } from 'react'
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
import { WeatherNewsPanel } from './WeatherNewsPanel'
import { LegendTimePanel } from './LegendTimePanel'
import { CameraLinksPanel } from './CameraLinksPanel'
import { ScannerLinksPanel } from './ScannerLinksPanel'
import { CommandPalette, type CommandPaletteAction } from './CommandPalette'
import { useMapStore } from '../state/mapStore'

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

type UtilityTab = 'workspace' | 'layers' | 'help'

function PlaceholderModule({ module }: { module: WorkspaceModuleDefinition }) {
  return (
    <div className="workspace-module-body">
      <p>{module.description}</p>
      <p className="workspace-placeholder-note">Placeholder module. This build provides configuration only; no embedded live feed is active.</p>
    </div>
  )
}

function UtilityHelpPanel() {
  return (
    <section className="utility-help-panel">
      <h3>Help & Shortcuts</h3>
      <p>Ctrl/Cmd+K opens command palette. Esc closes palette or utility panel.</p>
      <p>Use Edit Mode to move/hide modules; switch back to Operate Mode for live monitoring.</p>
      <p>Layer shortcuts: 1 alerts, 2 radar, 3 SPC outlook, 4 reports.</p>
      <p>Preset shortcuts: S severe-weather, C clean-map.</p>
    </section>
  )
}

function ModuleContent({ moduleId }: { moduleId: WorkspaceModuleId }) {
  if (moduleId === 'alerts') return <NwsAlertsPanel embedded />
  if (moduleId === 'liveContext') return <LiveContextRail embedded />
  if (moduleId === 'spc') return <SpcPanel />
  if (moduleId === 'radar') return <RadarPanel />
  if (moduleId === 'sourceHealth') return <SourceHealthPanel />
  if (moduleId === 'legendTime') return <LegendTimePanel />
  if (moduleId === 'weatherNews') return <WeatherNewsPanel />
  if (moduleId === 'cameras') return <CameraLinksPanel />
  if (moduleId === 'scanners') return <ScannerLinksPanel />
  const module = WORKSPACE_MODULES.find((item) => item.id === moduleId)
  return module ? <PlaceholderModule module={module} /> : null
}

function WorkspaceZone({ zone, activeDropZone, setActiveDropZone }: { zone: WorkspaceZoneId; activeDropZone: WorkspaceZoneId | null; setActiveDropZone: (zone: WorkspaceZoneId | null) => void }) {
  const preferences = useWorkspaceStore((state) => state.preferences)
  const layoutMode = useWorkspaceStore((state) => state.layoutMode)
  const setModuleZone = useWorkspaceStore((state) => state.setModuleZone)
  const modules = WORKSPACE_MODULES.filter((module) => preferences[module.id]?.visible && preferences[module.id]?.zone === zone)

  function handleDragOver(event: DragEvent<HTMLElement>) {
    if (layoutMode !== 'edit') return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    setActiveDropZone(zone)
  }

  function handleDrop(event: DragEvent<HTMLElement>) {
    if (layoutMode !== 'edit') return
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
  const [activeDropZone, setActiveDropZone] = useState<WorkspaceZoneId | null>(null)
  const [activeUtilityTab, setActiveUtilityTab] = useState<UtilityTab | null>('workspace')
  const [paletteOpen, setPaletteOpen] = useState(false)

  const toggleLayer = useMapStore((state) => state.toggleLayer)
  const applyLayerPreset = useMapStore((state) => state.applyPreset)
  const applyWorkspacePreset = useWorkspaceStore((state) => state.applyPreset)
  const userPresets = useWorkspaceStore((state) => state.userPresets)
  const saveCurrentAsPreset = useWorkspaceStore((state) => state.saveCurrentAsPreset)
  const setLayoutMode = useWorkspaceStore((state) => state.setLayoutMode)
  const resetWorkspace = useWorkspaceStore((state) => state.resetWorkspace)

  const commandPaletteActions = useMemo<CommandPaletteAction[]>(() => {
    const baseActions: CommandPaletteAction[] = [
      { id: 'utility-workspace', label: 'Open workspace panel', detail: 'Utility: Workspace', run: () => setActiveUtilityTab('workspace') },
      { id: 'utility-layers', label: 'Open layers panel', detail: 'Utility: Layers', run: () => setActiveUtilityTab('layers') },
      { id: 'utility-help', label: 'Open help panel', detail: 'Utility: Help', run: () => setActiveUtilityTab('help') },
      {
        id: 'workspace-save-current',
        label: 'Save current workspace preset',
        detail: 'Custom presets',
        run: () => {
          const name = window.prompt('Save current workspace as preset:', 'My workspace')
          if (name) saveCurrentAsPreset(name)
        },
      },
      { id: 'layout-operate', label: 'Switch to Operate mode', detail: 'Workspace layout', run: () => setLayoutMode('operate') },
      { id: 'layout-edit', label: 'Switch to Edit mode', detail: 'Workspace layout', run: () => setLayoutMode('edit') },
      { id: 'workspace-preset-severe', label: 'Workspace preset: Severe Weather Nowcast', detail: 'Apply workspace preset', run: () => applyWorkspacePreset('severeNowcast') },
      { id: 'workspace-preset-clean', label: 'Workspace preset: Clean Radar Mode', detail: 'Apply workspace preset', run: () => applyWorkspacePreset('cleanRadar') },
      { id: 'workspace-reset', label: 'Reset workspace to defaults', detail: 'Workspace reset', run: () => resetWorkspace() },
      { id: 'layer-preset-severe', label: 'Layer preset: Severe Weather', detail: 'Map layers', run: () => applyLayerPreset('severe-weather') },
      { id: 'layer-preset-clean', label: 'Layer preset: Clean Map', detail: 'Map layers', run: () => applyLayerPreset('clean-map') },
      { id: 'toggle-alerts', label: 'Toggle layer: Alerts', detail: 'Shortcut 1', run: () => toggleLayer('nwsAlerts') },
      { id: 'toggle-radar', label: 'Toggle layer: Radar', detail: 'Shortcut 2', run: () => toggleLayer('radar') },
      { id: 'toggle-spc', label: 'Toggle layer: SPC outlook', detail: 'Shortcut 3', run: () => toggleLayer('spcOutlook') },
      { id: 'toggle-reports', label: 'Toggle layer: Storm reports', detail: 'Shortcut 4', run: () => toggleLayer('stormReports') },
    ]

    const dynamicUserPresetActions: CommandPaletteAction[] = userPresets.map((preset) => ({
      id: `workspace-user-preset-${preset.id}`,
      label: `Workspace preset: ${preset.title}`,
      detail: 'Apply custom preset',
      run: () => applyWorkspacePreset(preset.id),
    }))

    return [...dynamicUserPresetActions, ...baseActions]
  }, [applyLayerPreset, applyWorkspacePreset, resetWorkspace, saveCurrentAsPreset, setLayoutMode, toggleLayer, userPresets])


  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase()
      const metaK = (event.metaKey || event.ctrlKey) && key === 'k'

      if (metaK) {
        event.preventDefault()
        setPaletteOpen((open) => !open)
        return
      }

      if (key === 'escape') {
        if (paletteOpen) setPaletteOpen(false)
        else setActiveUtilityTab(null)
      }

      if (event.shiftKey && key === 'l') {
        event.preventDefault()
        setActiveUtilityTab((tab) => (tab === 'layers' ? null : 'layers'))
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [paletteOpen])

  return (
    <div className="app-shell">
      <MapView />
      <CommandBar
        activeUtilityTab={activeUtilityTab}
        onToggleUtilityTab={(tab) => setActiveUtilityTab((current) => (current === tab ? null : tab))}
        onCloseUtility={() => setActiveUtilityTab(null)}
        onOpenCommandPalette={() => setPaletteOpen(true)}
      />
      <div className="operator-layout">
        <WorkspaceZone zone="leftRail" activeDropZone={activeDropZone} setActiveDropZone={setActiveDropZone} />
        <WorkspaceZone zone="rightRail" activeDropZone={activeDropZone} setActiveDropZone={setActiveDropZone} />
        <WorkspaceZone zone="bottomDock" activeDropZone={activeDropZone} setActiveDropZone={setActiveDropZone} />
        <WorkspaceZone zone="mapOverlay" activeDropZone={activeDropZone} setActiveDropZone={setActiveDropZone} />
        <WorkspaceZone zone="focusPanel" activeDropZone={activeDropZone} setActiveDropZone={setActiveDropZone} />
      </div>

      {activeUtilityTab && (
        <aside className="utility-drawer" aria-label="Utility drawer">
          {activeUtilityTab === 'workspace' && <WorkspacePanel embedded />}
          {activeUtilityTab === 'layers' && <WeatherLayerPanel embedded />}
          {activeUtilityTab === 'help' && <UtilityHelpPanel />}
        </aside>
      )}

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} actions={commandPaletteActions} />

      <PresetBar />
    </div>
  )
}
