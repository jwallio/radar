import { WORKSPACE_MODULES, WORKSPACE_ZONES } from '../config/workspaceModules'
import { useWorkspaceStore } from '../state/workspaceStore'
import type { WorkspaceModuleCategory } from '../types/weather'

const categories: WorkspaceModuleCategory[] = ['alerts', 'radar', 'convective', 'operations', 'media', 'reference', 'status']

export function WorkspacePanel() {
  const preferences = useWorkspaceStore((state) => state.preferences)
  const setModuleVisible = useWorkspaceStore((state) => state.setModuleVisible)
  const setModuleZone = useWorkspaceStore((state) => state.setModuleZone)
  const resetWorkspace = useWorkspaceStore((state) => state.resetWorkspace)

  return (
    <aside className="workspace-panel" aria-label="Workspace modules">
      <div className="workspace-panel-top">
        <div>
          <p className="workspace-module-kicker">wall.cloud</p>
          <h1>Weather Workspace</h1>
        </div>
        <button type="button" onClick={resetWorkspace}>Reset</button>
      </div>
      <p className="workspace-panel-copy">Choose which modules are visible and where they dock around the map.</p>
      {categories.map((category) => {
        const modules = WORKSPACE_MODULES.filter((module) => module.category === category)
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
                  <label className="workspace-zone-picker">
                    <span>Zone</span>
                    <select data-workspace-zone={module.id} value={preference.zone} onChange={(event) => setModuleZone(module.id, event.currentTarget.value as typeof preference.zone)}>
                      {WORKSPACE_ZONES.map((zone) => <option key={zone.id} value={zone.id}>{zone.label}</option>)}
                    </select>
                  </label>
                </article>
              )
            })}
          </section>
        )
      })}
    </aside>
  )
}
