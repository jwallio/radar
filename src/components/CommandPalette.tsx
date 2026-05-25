import { useMemo, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'

export interface CommandPaletteAction {
  id: string
  label: string
  detail?: string
  run: () => void
}

interface CommandPaletteProps {
  open: boolean
  onClose: () => void
  actions: CommandPaletteAction[]
}

export function CommandPalette({ open, onClose, actions }: CommandPaletteProps) {
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return actions
    return actions.filter((action) => (
      action.label.toLowerCase().includes(needle) || action.detail?.toLowerCase().includes(needle)
    ))
  }, [actions, query])

  if (!open) return null

  function execute(action: CommandPaletteAction) {
    action.run()
    onClose()
    setQuery('')
  }

  function onInputKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter') return
    const first = filtered[0]
    if (!first) return
    event.preventDefault()
    execute(first)
  }

  return (
    <div className="command-palette-overlay" role="dialog" aria-modal="true" aria-label="Command palette" onClick={onClose}>
      <section className="command-palette" onClick={(event) => event.stopPropagation()}>
        <div className="command-palette-head">
          <strong>Command Palette</strong>
          <button type="button" onClick={onClose}>Esc</button>
        </div>
        <label className="command-palette-search">
          <span>Type to filter commands</span>
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            onKeyDown={onInputKeyDown}
            placeholder="workspace, layers, preset..."
          />
        </label>
        <ul className="command-palette-list">
          {filtered.map((action) => (
            <li key={action.id}>
              <button type="button" onClick={() => execute(action)}>
                <span>{action.label}</span>
                {action.detail && <small>{action.detail}</small>}
              </button>
            </li>
          ))}
          {filtered.length === 0 && <li className="command-palette-empty">No commands match.</li>}
        </ul>
      </section>
    </div>
  )
}
