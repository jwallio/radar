import { useState, type ReactNode } from 'react'
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
  const layoutMode = useWorkspaceStore((state) => state.layoutMode)
  const setModuleVisible = useWorkspaceStore((state) => state.setModuleVisible)
  const setModuleZone = useWorkspaceStore((state) => state.setModuleZone)
  const [isDragging, setIsDragging] = useState(false)

  if (!module) return null

  const editing = layoutMode === 'edit'

  return (
    <section
      className={`workspace-module-frame module-size-${module.defaultSize} ${className} ${editing ? 'editing' : 'operating'} ${isDragging ? 'dragging' : ''}`}
      data-module-id={module.id}
      draggable={editing}
      onDragStart={(event) => {
        if (!editing) return
        event.dataTransfer.setData('text/plain', module.id)
        event.dataTransfer.effectAllowed = 'move'
        setIsDragging(true)
      }}
      onDragEnd={() => setIsDragging(false)}
    >
      <header className="workspace-module-header">
        <div>
          <p className="workspace-module-kicker">{module.category}</p>
          <h2>{module.title}</h2>
        </div>
        <div className="workspace-module-actions">
          {editing && <span className="workspace-drag-handle" title="Drag module to another zone">Move</span>}
          {module.isLive && <span className="workspace-module-badge live">Live</span>}
          {module.isPlaceholder && <span className="workspace-module-badge placeholder">Placeholder</span>}
          {editing && <button type="button" onClick={() => setModuleVisible(module.id, false)}>Hide</button>}
        </div>
      </header>
      {editing && (
        <div className="workspace-frame-move-controls" aria-label={`Move ${module.title}`}>
          {WORKSPACE_ZONES.map((zone) => (
            <button key={zone.id} type="button" onClick={() => setModuleZone(module.id, zone.id as WorkspaceZoneId)}>
              {zone.label}
            </button>
          ))}
        </div>
      )}
      {children}
    </section>
  )
}
