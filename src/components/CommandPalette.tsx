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
  const [activeIndex, setActiveIndex] = useState(0)

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return actions
    return actions.filter((action) => (
      action.label.toLowerCase().includes(needle) || action.detail?.toLowerCase().includes(needle)
    ))
  }, [actions, query])

  const grouped = useMemo(() => {
    const groups = new Map<string, CommandPaletteAction[]>()
    filtered.forEach((action) => {
      const key = action.detail ?? 'Other'
      const existing = groups.get(key)
      if (existing) existing.push(action)
      else groups.set(key, [action])
    })
    return [...groups.entries()]
  }, [filtered])

  if (!open) return null

  function handleClose() {
    setQuery('')
    setActiveIndex(0)
    onClose()
  }

  function execute(action: CommandPaletteAction) {
    action.run()
    handleClose()
  }

  function onInputKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((index) => (filtered.length ? (index + 1) % filtered.length : 0))
      return
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((index) => (filtered.length ? (index - 1 + filtered.length) % filtered.length : 0))
      return
    }

    if (event.key !== 'Enter') return
    const selected = filtered[activeIndex] ?? filtered[0]
    if (!selected) return
    event.preventDefault()
    execute(selected)
  }

  return (
    <div className="command-palette-overlay" role="dialog" aria-modal="true" aria-label="Command palette" onClick={handleClose}>
      <section className="command-palette" onClick={(event) => event.stopPropagation()}>
        <div className="command-palette-head">
          <strong>Command Palette</strong>
          <button type="button" onClick={handleClose}>Esc</button>
        </div>
        <label className="command-palette-search">
          <span>Type to filter commands</span>
          <input
            autoFocus
            value={query}
            onChange={(event) => {
              setQuery(event.currentTarget.value)
              setActiveIndex(0)
            }}
            onKeyDown={onInputKeyDown}
            placeholder="workspace, layers, preset..."
          />
        </label>
        <ul className="command-palette-list">
          {grouped.map(([groupName, groupActions]) => (
            <li key={groupName} className="command-palette-group">
              <p className="command-palette-group-label">{groupName}</p>
              <ul className="command-palette-group-list">
                {groupActions.map((action) => {
                  const index = filtered.findIndex((candidate) => candidate.id === action.id)
                  const isActive = index === activeIndex
                  return (
                    <li key={action.id}>
                      <button
                        type="button"
                        className={isActive ? 'active' : ''}
                        onMouseEnter={() => setActiveIndex(index)}
                        onClick={() => execute(action)}
                      >
                        <span>{action.label}</span>
                        {action.detail && <small>{action.detail}</small>}
                      </button>
                    </li>
                  )
                })}
              </ul>
            </li>
          ))}
          {filtered.length === 0 && <li className="command-palette-empty">No commands match.</li>}
        </ul>
      </section>
    </div>
  )
}
