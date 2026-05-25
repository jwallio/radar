import { useMemo, useState } from 'react'
import { WORKSPACE_MODULES, WORKSPACE_ZONES } from '../config/workspaceModules'
import { WORKSPACE_PRESETS } from '../config/workspacePresets'
import { useWorkspaceStore } from '../state/workspaceStore'
import type { WorkspaceModuleCategory } from '../types/weather'

const categories: WorkspaceModuleCategory[] = ['alerts', 'radar', 'convective', 'operations', 'media', 'reference', 'status']
const helpStorageKey = 'wallcloud-weather-dashboard-workspace-help-dismissed'

function readHelpDismissed(): boolean {
  try {
    return localStorage.getItem(helpStorageKey) === 'true'
  } catch {
    return false
  }
}

interface WorkspacePanelProps {
  embedded?: boolean
}

export function WorkspacePanel({ embedded = false }: WorkspacePanelProps) {
  const [query, setQuery] = useState('')
  const [helpDismissed, setHelpDismissed] = useState(readHelpDismissed)
  const preferences = useWorkspaceStore((state) => state.preferences)
  const layoutMode = useWorkspaceStore((state) => state.layoutMode)
  const currentPresetId = useWorkspaceStore((state) => state.currentPresetId)
  const setModuleVisible = useWorkspaceStore((state) => state.setModuleVisible)
  const setModuleZone = useWorkspaceStore((state) => state.setModuleZone)
  const applyPreset = useWorkspaceStore((state) => state.applyPreset)
  const userPresets = useWorkspaceStore((state) => state.userPresets)
  const saveCurrentAsPreset = useWorkspaceStore((state) => state.saveCurrentAsPreset)
  const renameUserPreset = useWorkspaceStore((state) => state.renameUserPreset)
  const deleteUserPreset = useWorkspaceStore((state) => state.deleteUserPreset)
  const resetWorkspace = useWorkspaceStore((state) => state.resetWorkspace)

  const filteredModules = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return WORKSPACE_MODULES
    return WORKSPACE_MODULES.filter((module) => (
      module.title.toLowerCase().includes(needle)
      || module.description.toLowerCase().includes(needle)
      || module.category.toLowerCase().includes(needle)
    ))
  }, [query])

  const hiddenModules = useMemo(() => WORKSPACE_MODULES.filter((module) => !preferences[module.id]?.visible), [preferences])

  const content = (
    <>
      <div className="workspace-panel-top">
        <div>
          <p className="workspace-module-kicker">wall.cloud</p>
          <h1>Weather Workspace</h1>
        </div>
        <button type="button" onClick={resetWorkspace}>Reset</button>
      </div>
      <p className="workspace-panel-copy">Customize your weather monitoring workspace.</p>
      {!helpDismissed && (
        <section className="workspace-help-card">
          <div>
            <h2>First run guide</h2>
            <p>Use Edit Mode to move and hide modules. Switch back to Operate Mode for a cleaner live workflow.</p>
          </div>
          <button
            type="button"
            onClick={() => {
              setHelpDismissed(true)
              try {
                localStorage.setItem(helpStorageKey, 'true')
              } catch {
                // no-op
              }
            }}
          >
            Got it
          </button>
        </section>
      )}

      {hiddenModules.length > 0 && (
        <section className="workspace-hidden-tray">
          <h2>Hidden modules</h2>
          <div className="workspace-hidden-buttons">
            {hiddenModules.map((module) => (
              <button key={module.id} type="button" onClick={() => setModuleVisible(module.id, true)}>
                Show {module.title}
              </button>
            ))}
          </div>
        </section>
      )}

      <label className="workspace-search">
        <span>Search modules</span>
        <input
          value={query}
          onInput={(event) => setQuery(event.currentTarget.value)}
          onChange={(event) => setQuery(event.currentTarget.value)}
          placeholder="alerts, radar, source..."
        />
      </label>
      <section className="workspace-preset-list">
        <h2>Presets</h2>
        <select
          data-workspace-preset-select
          value={currentPresetId ?? ''}
          onChange={(event) => {
            if (event.currentTarget.value) applyPreset(event.currentTarget.value)
          }}
        >
          <option value="">Custom workspace</option>
          {WORKSPACE_PRESETS.map((preset) => <option key={preset.id} value={preset.id}>{preset.title}</option>)}
          {userPresets.map((preset) => <option key={preset.id} value={preset.id}>★ {preset.title}</option>)}
        </select>
        <div className="workspace-preset-buttons">
          <button
            type="button"
            onClick={() => {
              const name = window.prompt('Save current workspace as preset:', 'My workspace')
              if (name) saveCurrentAsPreset(name)
            }}
          >
            Save current preset
          </button>
          {WORKSPACE_PRESETS.map((preset) => (
            <button key={preset.id} type="button" data-workspace-preset={preset.id} onClick={() => applyPreset(preset.id)}>
              {preset.title}
            </button>
          ))}
          {userPresets.map((preset) => (
            <button key={preset.id} type="button" onClick={() => applyPreset(preset.id)}>
              ★ {preset.title}
            </button>
          ))}
        </div>
        {userPresets.length > 0 && (
          <div className="workspace-user-presets">
            {userPresets.map((preset) => (
              <div key={preset.id} className="workspace-user-preset-row">
                <span>{preset.title}</span>
                <div className="workspace-user-preset-actions">
                  <button
                    type="button"
                    onClick={() => {
                      const name = window.prompt('Rename preset:', preset.title)
                      if (name) renameUserPreset(preset.id, name)
                    }}
                  >
                    Rename
                  </button>
                  <button type="button" onClick={() => deleteUserPreset(preset.id)}>Delete</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
      {categories.map((category) => {
        const modules = filteredModules.filter((module) => module.category === category)
        if (modules.length === 0) return null
        return (
          <section key={category} className="workspace-library-group">
            <h2>{category}</h2>
            {modules.map((module) => {
              const preference = preferences[module.id]
              return (
                <article key={module.id} className="workspace-library-item" data-workspace-module-control={module.id}>
                  <div className="workspace-library-title">
                    <strong>{module.title}</strong>
                    <label>
                      <input
                        type="checkbox"
                        data-workspace-visible={module.id}
                        checked={preference.visible}
                        onChange={(event) => setModuleVisible(module.id, event.currentTarget.checked)}
                      />
                      {preference.visible ? 'Shown' : 'Hidden'}
                    </label>
                  </div>
                  <p>{module.description}</p>
                  {module.isPlaceholder && <p className="workspace-placeholder-note">Placeholder: no embedded live feed is claimed yet.</p>}
                  {layoutMode === 'edit' && (
                    <label className="workspace-zone-picker">
                      <span>Zone</span>
                      <select data-workspace-zone={module.id} value={preference.zone} onChange={(event) => setModuleZone(module.id, event.currentTarget.value as typeof preference.zone)}>
                        {WORKSPACE_ZONES.map((zone) => <option key={zone.id} value={zone.id}>{zone.label}</option>)}
                      </select>
                    </label>
                  )}
                </article>
              )
            })}
          </section>
        )
      })}
    </>
  )

  if (embedded) return <div className="workspace-panel embedded">{content}</div>
  return <aside className="workspace-panel" aria-label="Workspace modules">{content}</aside>
}
