import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { WORKSPACE_PRESETS } from '../config/workspacePresets'
import { INCIDENT_MODES } from '../config/incidentModes'
import { fetchNwsAlerts } from '../services/nws'
import { useWorkspaceStore } from '../state/workspaceStore'
import { useMapStore } from '../state/mapStore'

type UtilityTab = 'workspace' | 'layers' | 'help'

interface CommandBarProps {
  activeUtilityTab: UtilityTab | null
  onToggleUtilityTab: (tab: UtilityTab) => void
  onCloseUtility: () => void
  onOpenCommandPalette: () => void
}

export function CommandBar({ activeUtilityTab, onToggleUtilityTab, onCloseUtility, onOpenCommandPalette }: CommandBarProps) {
  const alerts = useQuery({ queryKey: ['nws-alerts'], queryFn: fetchNwsAlerts, staleTime: 60_000 })
  const currentPresetId = useWorkspaceStore((state) => state.currentPresetId)
  const layoutMode = useWorkspaceStore((state) => state.layoutMode)
  const toggleLayoutMode = useWorkspaceStore((state) => state.toggleLayoutMode)
  const applyWorkspacePreset = useWorkspaceStore((state) => state.applyPreset)
  const userPresets = useWorkspaceStore((state) => state.userPresets)
  const resetWorkspace = useWorkspaceStore((state) => state.resetWorkspace)
  const layoutLocked = useWorkspaceStore((state) => state.layoutLocked)
  const toggleLayoutLocked = useWorkspaceStore((state) => state.toggleLayoutLocked)
  const pinnedPresetIds = useWorkspaceStore((state) => state.pinnedPresetIds)

  const applyLayerPreset = useMapStore((state) => state.applyPreset)
  const setRegionalFocus = useMapStore((state) => state.setRegionalFocus)
  const setAlertViewMode = useMapStore((state) => state.setAlertViewMode)

  const alertList = alerts.data?.alerts ?? []
  const severeCount = alertList.filter((alert) => alert.severity === 'Extreme' || alert.severity === 'Severe').length
  const presetLabel = WORKSPACE_PRESETS.find((preset) => preset.id === currentPresetId)?.title
    ?? userPresets.find((preset) => preset.id === currentPresetId)?.title
    ?? 'Custom workspace'

  const pinnedPresets = useMemo(() => {
    const all = [
      ...WORKSPACE_PRESETS.map((preset) => ({ id: preset.id, title: preset.title })),
      ...userPresets.map((preset) => ({ id: preset.id, title: `★ ${preset.title}` })),
    ]
    return pinnedPresetIds
      .map((id) => all.find((preset) => preset.id === id))
      .filter((item): item is { id: string; title: string } => Boolean(item))
  }, [pinnedPresetIds, userPresets])

  return (
    <header className="command-bar">
      <div className="command-identity">
        <strong>wall.cloud</strong>
        <span>Weather workspace for U.S. operations</span>
      </div>
      <div className="command-status">
        <span className="workspace-module-badge live">LIVE</span>
        <span>{alerts.isLoading ? 'Alerts loading' : `${alertList.length} alerts`}</span>
        <span>{severeCount} severe+</span>
        <span>{presetLabel}</span>
        <span>{layoutLocked ? 'Layout locked' : 'Layout unlocked'}</span>
      </div>
      <label className="command-preset-picker">
        <span>Preset</span>
        <select
          value={currentPresetId ?? ''}
          onChange={(event) => {
            if (event.currentTarget.value) applyWorkspacePreset(event.currentTarget.value)
          }}
        >
          <option value="">Custom</option>
          {WORKSPACE_PRESETS.map((preset) => <option key={preset.id} value={preset.id}>{preset.title}</option>)}
          {userPresets.map((preset) => <option key={preset.id} value={preset.id}>★ {preset.title}</option>)}
        </select>
      </label>
      <div className="command-actions">
        <button type="button" onClick={onOpenCommandPalette}>⌘/Ctrl+K</button>
        <button type="button" onClick={() => onToggleUtilityTab('workspace')} className={activeUtilityTab === 'workspace' ? 'active' : ''}>Workspace</button>
        <button type="button" onClick={() => onToggleUtilityTab('layers')} className={activeUtilityTab === 'layers' ? 'active' : ''}>Layers</button>
        <button type="button" onClick={() => onToggleUtilityTab('help')} className={activeUtilityTab === 'help' ? 'active' : ''}>Help</button>
        {activeUtilityTab && <button type="button" onClick={onCloseUtility}>Close Panel</button>}
        <button type="button" onClick={toggleLayoutMode}>{layoutMode === 'edit' ? 'Edit Mode' : 'Operate Mode'}</button>
        <button type="button" onClick={toggleLayoutLocked}>{layoutLocked ? 'Unlock Layout' : 'Lock Layout'}</button>
        <button type="button" onClick={resetWorkspace}>Reset</button>
      </div>
      {pinnedPresets.length > 0 && (
        <div className="command-pinned-presets" aria-label="Pinned ops layouts">
          <span>Ops layouts</span>
          {pinnedPresets.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className={currentPresetId === preset.id ? 'active' : ''}
              onClick={() => applyWorkspacePreset(preset.id)}
            >
              {preset.title}
            </button>
          ))}
        </div>
      )}
      <div className="command-incident-modes" aria-label="Incident modes">
        <span>Incident mode</span>
        {INCIDENT_MODES.map((mode) => (
          <button
            key={mode.id}
            type="button"
            onClick={() => {
              applyWorkspacePreset(mode.workspacePresetId)
              applyLayerPreset(mode.layerPresetId)
              setRegionalFocus(mode.regionalPackId, mode.regionalAreas)
              setAlertViewMode(mode.alertViewMode)
            }}
          >
            {mode.label}
          </button>
        ))}
      </div>
    </header>
  )
}
