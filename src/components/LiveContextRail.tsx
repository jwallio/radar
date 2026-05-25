import { LIVE_CONTEXT_MODULES } from '../config/liveContext'

interface LiveContextRailProps { embedded?: boolean }

export function LiveContextRail({ embedded = false }: LiveContextRailProps) {
  const content = (
    <>
      <h2>Live Context</h2>
      {LIVE_CONTEXT_MODULES.map((module) => (
        <section key={module.id} className="context-card">
          <h3>{module.title}</h3>
          {module.items.length === 0 && <p className="context-empty">{module.emptyMessage}</p>}
          {module.items.length > 0 && (
            <ul>
              {module.items.map((item) => (
                <li key={item.id}>
                  <a href={item.url} target="_blank" rel="noreferrer">{item.label}</a>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </>
  )

  return embedded ? <div className="workspace-module-body">{content}</div> : <aside className="operator-rail right-rail">{content}</aside>
}
