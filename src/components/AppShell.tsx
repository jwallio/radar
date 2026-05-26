import { Suspense, lazy, useEffect, useMemo, useState, type DragEvent } from 'react'
import { WeatherLayerPanel } from './WeatherLayerPanel'
import { PresetBar } from './PresetBar'
import { WORKSPACE_MODULES } from '../config/workspaceModules'
import { useWorkspaceStore } from '../state/workspaceStore'
import type { WorkspaceModuleDefinition, WorkspaceModuleId, WorkspaceZoneId } from '../types/weather'
import { WorkspaceModuleFrame } from './WorkspaceModuleFrame'
import { WorkspacePanel } from './WorkspacePanel'
import { CommandBar } from './CommandBar'
import { CommandPalette, type CommandPaletteAction } from './CommandPalette'
import { useMapStore } from '../state/mapStore'
import { TextPromptDialog } from './TextPromptDialog'

const MapView = lazy(async () => import('./MapView').then((m) => ({ default: m.MapView })))
const NwsAlertsPanel = lazy(async () => import('./NwsAlertsPanel').then((m) => ({ default: m.NwsAlertsPanel })))
const LiveContextRail = lazy(async () => import('./LiveContextRail').then((m) => ({ default: m.LiveContextRail })))
const SpcPanel = lazy(async () => import('./SpcPanel').then((m) => ({ default: m.SpcPanel })))
const RadarPanel = lazy(async () => import('./RadarPanel').then((m) => ({ default: m.RadarPanel })))
const SourceHealthPanel = lazy(async () => import('./SourceHealthPanel').then((m) => ({ default: m.SourceHealthPanel })))
const LegendTimePanel = lazy(async () => import('./LegendTimePanel').then((m) => ({ default: m.LegendTimePanel })))
const WeatherNewsPanel = lazy(async () => import('./WeatherNewsPanel').then((m) => ({ default: m.WeatherNewsPanel })))
const CameraLinksPanel = lazy(async () => import('./CameraLinksPanel').then((m) => ({ default: m.CameraLinksPanel })))
const ScannerLinksPanel = lazy(async () => import('./ScannerLinksPanel').then((m) => ({ default: m.ScannerLinksPanel })))

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
  const content = (() => {
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
  })()

  return <Suspense fallback={<p className="workspace-empty-zone">Loading module...</p>}>{content}</Suspense>
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

function WorkspaceDropBoard({ activeDropZone, setActiveDropZone, activeDragModuleId, onExitEditMode }: { activeDropZone: WorkspaceZoneId | null; setActiveDropZone: (zone: WorkspaceZoneId | null) => void; activeDragModuleId: WorkspaceModuleId | null; onExitEditMode: () => void }) {
  const layoutMode = useWorkspaceStore((state) => state.layoutMode)
  const preferences = useWorkspaceStore((state) => state.preferences)
  const setModuleZone = useWorkspaceStore((state) => state.setModuleZone)

  if (layoutMode !== 'edit') return null

  const modulesByZone = WORKSPACE_MODULES.reduce((acc, module) => {
    if (!preferences[module.id]?.visible) return acc
    const zone = preferences[module.id]?.zone
    if (!zone) return acc
    acc[zone] = (acc[zone] ?? 0) + 1
    return acc
  }, {} as Partial<Record<WorkspaceZoneId, number>>)

  const onDragOver = (zone: WorkspaceZoneId, event: DragEvent<HTMLElement>) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    setActiveDropZone(zone)
  }

  const onDrop = (zone: WorkspaceZoneId, event: DragEvent<HTMLElement>) => {
    event.preventDefault()
    const moduleId = event.dataTransfer.getData('text/plain') as WorkspaceModuleId
    if (WORKSPACE_MODULES.some((module) => module.id === moduleId)) setModuleZone(moduleId, zone)
    setActiveDropZone(null)
  }

  return (
    <section className="workspace-drop-board" aria-label="Workspace drag and drop board">
      <div className="workspace-drop-board-top">
        <div>
          <h3>Drop Board</h3>
          <p>{activeDragModuleId ? `Dragging: ${WORKSPACE_MODULES.find((m) => m.id === activeDragModuleId)?.title ?? activeDragModuleId}` : 'Drag any module card into a target bin below.'}</p>
        </div>
        <button type="button" className="workspace-drop-board-exit" onClick={onExitEditMode}>Exit Edit Mode</button>
      </div>
      <div className="workspace-drop-board-grid">
        {(Object.keys(zoneLabels) as WorkspaceZoneId[]).map((zone) => (
          <article
            key={zone}
            className={`workspace-drop-bin ${activeDropZone === zone ? 'active' : ''}`}
            onDragOver={(event) => onDragOver(zone, event)}
            onDragLeave={() => setActiveDropZone(null)}
            onDrop={(event) => onDrop(zone, event)}
          >
            <div className="workspace-drop-bin-head">
              <strong>{zoneLabels[zone]}</strong>
              <span>{modulesByZone[zone] ?? 0} modules</span>
            </div>
            <p>Drop modules here</p>
          </article>
        ))}
      </div>
    </section>
  )
}

export function AppShell() {
  const [activeDropZone, setActiveDropZone] = useState<WorkspaceZoneId | null>(null)
  const [activeDragModuleId, setActiveDragModuleId] = useState<WorkspaceModuleId | null>(null)
  const [activeUtilityTab, setActiveUtilityTab] = useState<UtilityTab | null>('workspace')
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [savePresetDialogOpen, setSavePresetDialogOpen] = useState(false)
  const [mapBooted, setMapBooted] = useState(false)

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
        run: () => setSavePresetDialogOpen(true),
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
  }, [applyLayerPreset, applyWorkspacePreset, resetWorkspace, setLayoutMode, toggleLayer, userPresets])


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
      {mapBooted ? (
        <Suspense fallback={<div className="map-root-wrap" />}>
          <MapView />
        </Suspense>
      ) : (
        <section className="map-boot-splash">
          <h2>Map not started</h2>
          <p>Start map rendering when you are ready. This reduces initial app load overhead.</p>
          <button type="button" onClick={() => setMapBooted(true)}>Start map</button>
        </section>
      )}
      <CommandBar
        activeUtilityTab={activeUtilityTab}
        onToggleUtilityTab={(tab) => setActiveUtilityTab((current) => (current === tab ? null : tab))}
        onCloseUtility={() => setActiveUtilityTab(null)}
        onOpenCommandPalette={() => setPaletteOpen(true)}
      />
      <div className="operator-layout" onDragStart={(event) => {
        const moduleId = event.dataTransfer?.getData('text/plain') as WorkspaceModuleId
        if (WORKSPACE_MODULES.some((module) => module.id === moduleId)) setActiveDragModuleId(moduleId)
      }} onDragEnd={() => { setActiveDragModuleId(null); setActiveDropZone(null) }}>
        <WorkspaceZone zone="leftRail" activeDropZone={activeDropZone} setActiveDropZone={setActiveDropZone} />
        <WorkspaceZone zone="rightRail" activeDropZone={activeDropZone} setActiveDropZone={setActiveDropZone} />
        <WorkspaceZone zone="bottomDock" activeDropZone={activeDropZone} setActiveDropZone={setActiveDropZone} />
        <WorkspaceZone zone="mapOverlay" activeDropZone={activeDropZone} setActiveDropZone={setActiveDropZone} />
        <WorkspaceZone zone="focusPanel" activeDropZone={activeDropZone} setActiveDropZone={setActiveDropZone} />
      </div>

      <WorkspaceDropBoard
        activeDropZone={activeDropZone}
        setActiveDropZone={setActiveDropZone}
        activeDragModuleId={activeDragModuleId}
        onExitEditMode={() => setLayoutMode('operate')}
      />

      {activeUtilityTab && (
        <aside className="utility-drawer" aria-label="Utility drawer">
          {activeUtilityTab === 'workspace' && <WorkspacePanel embedded />}
          {activeUtilityTab === 'layers' && <WeatherLayerPanel embedded />}
          {activeUtilityTab === 'help' && <UtilityHelpPanel />}
        </aside>
      )}

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} actions={commandPaletteActions} />

      <TextPromptDialog
        key={`shell-save-${savePresetDialogOpen ? 'open' : 'closed'}`}
        open={savePresetDialogOpen}
        title="Save current workspace preset"
        label="Preset name"
        defaultValue="My workspace"
        confirmLabel="Save preset"
        onCancel={() => setSavePresetDialogOpen(false)}
        onSubmit={(value) => {
          saveCurrentAsPreset(value)
          setSavePresetDialogOpen(false)
        }}
      />

      <PresetBar />
    </div>
  )
}
