import { LIVE_CONTEXT_MODULES } from '../config/liveContext'

export function LiveContextRail() {
  return (
    <aside className="operator-rail right-rail">
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
    </aside>
  )
}
