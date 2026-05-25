import type { ReactNode } from 'react'
import { WORKSPACE_MODULE_BY_ID } from '../config/workspaceModules'
import { useWorkspaceStore } from '../state/workspaceStore'
import type { WorkspaceModuleId } from '../types/weather'

interface WorkspaceModuleFrameProps {
  moduleId: WorkspaceModuleId
  children: ReactNode
  className?: string
}

export function WorkspaceModuleFrame({ moduleId, children, className = '' }: WorkspaceModuleFrameProps) {
  const module = WORKSPACE_MODULE_BY_ID.get(moduleId)
  const setModuleVisible = useWorkspaceStore((state) => state.setModuleVisible)

  if (!module) return null

  return (
    <section className={`workspace-module-frame module-size-${module.defaultSize} ${className}`} data-module-id={module.id}>
      <header className="workspace-module-header">
        <div>
          <p className="workspace-module-kicker">{module.category}</p>
          <h2>{module.title}</h2>
        </div>
        <div className="workspace-module-actions">
          {module.isLive && <span className="workspace-module-badge live">Live</span>}
          {module.isPlaceholder && <span className="workspace-module-badge placeholder">Placeholder</span>}
          <button type="button" onClick={() => setModuleVisible(module.id, false)}>Hide</button>
        </div>
      </header>
      {children}
    </section>
  )
}
