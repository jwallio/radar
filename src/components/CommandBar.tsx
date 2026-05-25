import { useQuery } from '@tanstack/react-query'
import { WORKSPACE_PRESETS } from '../config/workspacePresets'
import { fetchNwsAlerts } from '../services/nws'
import { useWorkspaceStore } from '../state/workspaceStore'

type UtilityTab = 'workspace' | 'layers' | 'help'

interface CommandBarProps {
  activeUtilityTab: UtilityTab | null
  onToggleUtilityTab: (tab: UtilityTab) => void
  onCloseUtility: () => void
}

export function CommandBar({ activeUtilityTab, onToggleUtilityTab, onCloseUtility }: CommandBarProps) {
  const alerts = useQuery({ queryKey: ['nws-alerts'], queryFn: fetchNwsAlerts, staleTime: 60_000 })
  const currentPresetId = useWorkspaceStore((state) => state.currentPresetId)
  const layoutMode = useWorkspaceStore((state) => state.layoutMode)
  const toggleLayoutMode = useWorkspaceStore((state) => state.toggleLayoutMode)
  const applyPreset = useWorkspaceStore((state) => state.applyPreset)
  const resetWorkspace = useWorkspaceStore((state) => state.resetWorkspace)
  const alertList = alerts.data?.alerts ?? []
  const severeCount = alertList.filter((alert) => alert.severity === 'Extreme' || alert.severity === 'Severe').length
  const presetLabel = WORKSPACE_PRESETS.find((preset) => preset.id === currentPresetId)?.title ?? 'Custom workspace'

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
      </div>
      <label className="command-preset-picker">
        <span>Preset</span>
        <select
          value={currentPresetId ?? ''}
          onChange={(event) => {
            if (event.currentTarget.value) applyPreset(event.currentTarget.value as Parameters<typeof applyPreset>[0])
          }}
        >
          <option value="">Custom</option>
          {WORKSPACE_PRESETS.map((preset) => <option key={preset.id} value={preset.id}>{preset.title}</option>)}
        </select>
      </label>
      <div className="command-actions">
        <button type="button" onClick={() => onToggleUtilityTab('workspace')} className={activeUtilityTab === 'workspace' ? 'active' : ''}>Workspace</button>
        <button type="button" onClick={() => onToggleUtilityTab('layers')} className={activeUtilityTab === 'layers' ? 'active' : ''}>Layers</button>
        <button type="button" onClick={() => onToggleUtilityTab('help')} className={activeUtilityTab === 'help' ? 'active' : ''}>Help</button>
        {activeUtilityTab && <button type="button" onClick={onCloseUtility}>Close Panel</button>}
        <button type="button" onClick={toggleLayoutMode}>{layoutMode === 'edit' ? 'Edit Mode' : 'Operate Mode'}</button>
        <button type="button" onClick={resetWorkspace}>Reset</button>
      </div>
    </header>
  )
}
