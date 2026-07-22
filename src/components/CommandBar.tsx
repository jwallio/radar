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
  const setLayoutMode = useWorkspaceStore((state) => state.setLayoutMode)
  const applyWorkspacePreset = useWorkspaceStore((state) => state.applyPreset)
  const userPresets = useWorkspaceStore((state) => state.userPresets)

  const applyLayerPreset = useMapStore((state) => state.applyPreset)
  const setRegionalFocus = useMapStore((state) => state.setRegionalFocus)
  const setAlertViewMode = useMapStore((state) => state.setAlertViewMode)
  const setActiveIncidentMode = useMapStore((state) => state.setActiveIncidentMode)
  const activeIncidentModeId = useMapStore((state) => state.activeIncidentModeId)
  const activeIncidentModeAppliedAt = useMapStore((state) => state.activeIncidentModeAppliedAt)

  const alertList = alerts.data?.alerts ?? []
  const severeCount = alertList.filter((alert) => alert.severity === 'Extreme' || alert.severity === 'Severe').length
  const presetLabel = WORKSPACE_PRESETS.find((preset) => preset.id === currentPresetId)?.title
    ?? userPresets.find((preset) => preset.id === currentPresetId)?.title
    ?? 'Custom'

  const activeIncidentModeLabel = useMemo(
    () => INCIDENT_MODES.find((mode) => mode.id === activeIncidentModeId)?.label ?? null,
    [activeIncidentModeId],
  )

  const activeIncidentModeAppliedLabel = useMemo(() => {
    if (!activeIncidentModeAppliedAt) return null
    try {
      return new Date(activeIncidentModeAppliedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    } catch {
      return null
    }
  }, [activeIncidentModeAppliedAt])

  return (
    <header className="command-bar">
      {/* Left: brand + alert stats */}
      <div className="command-identity">
        <strong>wall.cloud</strong>
        <span className="command-alert-stat">
          {alerts.isLoading ? 'loading...' : `${alertList.length} alerts`}
          {severeCount > 0 && <span className="command-alert-severe"> · {severeCount} severe</span>}
        </span>
      </div>

      {/* Center: incident mode chips + active mode indicator */}
      <div className="command-incident-row">
        {INCIDENT_MODES.map((mode) => (
          <button
            key={mode.id}
            type="button"
            className={`command-incident-chip ${activeIncidentModeId === mode.id ? 'active' : ''}`}
            onClick={() => {
              applyWorkspacePreset(mode.workspacePresetId)
              applyLayerPreset(mode.layerPresetId)
              setRegionalFocus(mode.regionalPackId, mode.regionalAreas)
              setAlertViewMode(mode.alertViewMode)
              setActiveIncidentMode(mode.id)
            }}
          >
            {mode.label}
          </button>
        ))}
        {activeIncidentModeLabel && (
          <span className="command-incident-active-label">
            Active: {activeIncidentModeLabel}{activeIncidentModeAppliedLabel ? ` · ${activeIncidentModeAppliedLabel}` : ''}
          </span>
        )}
      </div>

      {/* Right: preset picker + mode toggle + utility */}
      <div className="command-actions">
        <select
          className="command-preset-select"
          value={currentPresetId ?? ''}
          onChange={(event) => {
            if (event.currentTarget.value) applyWorkspacePreset(event.currentTarget.value)
            setActiveIncidentMode(null)
          }}
        >
          <option value="">{presetLabel}</option>
          <optgroup label="Built-in">
            {WORKSPACE_PRESETS.map((preset) => <option key={preset.id} value={preset.id}>{preset.title}</option>)}
          </optgroup>
          {userPresets.length > 0 && (
            <optgroup label="Saved">
              {userPresets.map((preset) => <option key={preset.id} value={preset.id}>★ {preset.title}</option>)}
            </optgroup>
          )}
        </select>

        <button
          type="button"
          className={`command-mode-toggle ${layoutMode === 'edit' ? 'edit-mode' : ''}`}
          onClick={() => setLayoutMode(layoutMode === 'edit' ? 'operate' : 'edit')}
        >
          {layoutMode === 'edit' ? 'Exit Edit' : 'Edit Layout'}
        </button>

        <button type="button" className="command-palette-btn" onClick={onOpenCommandPalette}>
          ⌘K
        </button>

        <div className="command-utility-group">
          <button
            type="button"
            className={activeUtilityTab === 'workspace' ? 'active' : ''}
            onClick={() => onToggleUtilityTab('workspace')}
          >
            Workspace
          </button>
          {activeUtilityTab && (
            <button type="button" onClick={onCloseUtility}>✕</button>
          )}
        </div>
      </div>
    </header>
  )
}
