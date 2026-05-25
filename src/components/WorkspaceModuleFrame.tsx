import type { ReactNode } from 'react'
import { WORKSPACE_MODULE_BY_ID } from '../config/workspaceModules'
import { useWorkspaceStore } from '../state/workspaceStore'
import type { WorkspaceModuleId, WorkspaceZoneId } from '../types/weather'
import { WORKSPACE_ZONES } from '../config/workspaceModules'

interface WorkspaceModuleFrameProps {
  moduleId: WorkspaceModuleId
  children: ReactNode
  className?: string
}

export function WorkspaceModuleFrame({ moduleId, children, className = '' }: WorkspaceModuleFrameProps) {
  const module = WORKSPACE_MODULE_BY_ID.get(moduleId)
  const setModuleVisible = useWorkspaceStore((state) => state.setModuleVisible)
  const setModuleZone = useWorkspaceStore((state) => state.setModuleZone)

  if (!module) return null

  return (
    <section
      className={`workspace-module-frame module-size-${module.defaultSize} ${className}`}
      data-module-id={module.id}
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData('text/plain', module.id)
        event.dataTransfer.effectAllowed = 'move'
      }}
    >
      <header className="workspace-module-header">
        <div>
          <p className="workspace-module-kicker">{module.category}</p>
          <h2>{module.title}</h2>
        </div>
        <div className="workspace-module-actions">
          <span className="workspace-drag-handle" title="Drag module to another zone">Move</span>
          {module.isLive && <span className="workspace-module-badge live">Live</span>}
          {module.isPlaceholder && <span className="workspace-module-badge placeholder">Placeholder</span>}
          <button type="button" onClick={() => setModuleVisible(module.id, false)}>Hide</button>
        </div>
      </header>
      <div className="workspace-frame-move-controls" aria-label={`Move ${module.title}`}>
        {WORKSPACE_ZONES.map((zone) => (
          <button key={zone.id} type="button" onClick={() => setModuleZone(module.id, zone.id as WorkspaceZoneId)}>
            {zone.label}
          </button>
        ))}
      </div>
      {children}
    </section>
  )
}
