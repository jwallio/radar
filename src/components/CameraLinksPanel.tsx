import { CAMERA_LINK_GROUPS } from '../config/cameraLinks'
import { INTEGRATION_FLAGS } from '../config/integrations'
import { ModuleStateNotice, ModuleStatusBadge } from './ModuleStatusBadge'

interface CameraLinksPanelProps {
  embedded?: boolean
}

export function CameraLinksPanel({ embedded = false }: CameraLinksPanelProps) {
  const disabled = !INTEGRATION_FLAGS.embeddedCameras

  const content = (
    <div className="workspace-module-body external-links-panel">
      <div className="module-title-row">
        <h3>Weather Cameras</h3>
        <ModuleStatusBadge state={disabled ? 'disabled' : 'ready'} />
      </div>
      {disabled && (
        <ModuleStateNotice
          state="disabled"
          title="Embedded cameras disabled"
          message="Enable VITE_ENABLE_EMBEDDED_CAMERAS=true to render camera integrations in this module."
        />
      )}
      {!disabled && CAMERA_LINK_GROUPS.map((group) => (
        <section key={group.id} className="external-links-group">
          <h4>{group.title}</h4>
          {group.items.map((item) => (
            <a key={item.id} href={item.url} target="_blank" rel="noreferrer" className="external-links-row">
              <span>{item.label}</span>
              <span className="external-links-meta">
                <span className="external-links-chip">{item.sourceType}</span>
                {item.region && <span className="external-links-chip">{item.region}</span>}
              </span>
            </a>
          ))}
        </section>
      ))}
    </div>
  )

  return embedded ? content : <aside className="operator-rail right-rail">{content}</aside>
}
