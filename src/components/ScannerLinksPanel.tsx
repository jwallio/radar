import { SCANNER_LINK_GROUPS } from '../config/scannerLinks'

interface ScannerLinksPanelProps {
  embedded?: boolean
}

export function ScannerLinksPanel({ embedded = false }: ScannerLinksPanelProps) {
  const content = (
    <div className="workspace-module-body external-links-panel">
      <h3>Scanner Links</h3>
      {SCANNER_LINK_GROUPS.map((group) => (
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
