import { useState } from 'react'

interface TextPromptDialogProps {
  open: boolean
  title: string
  label: string
  defaultValue?: string
  confirmLabel?: string
  cancelLabel?: string
  onSubmit: (value: string) => void
  onCancel: () => void
}

export function TextPromptDialog({
  open,
  title,
  label,
  defaultValue = '',
  confirmLabel = 'Save',
  cancelLabel = 'Cancel',
  onSubmit,
  onCancel,
}: TextPromptDialogProps) {
  const [value, setValue] = useState(defaultValue)

  if (!open) return null

  return (
    <div className="text-prompt-overlay" role="dialog" aria-modal="true" aria-label={title}>
      <div className="text-prompt-dialog">
        <h3>{title}</h3>
        <label>
          <span>{label}</span>
          <input value={value} onChange={(event) => setValue(event.currentTarget.value)} autoFocus />
        </label>
        <div className="text-prompt-actions">
          <button type="button" onClick={onCancel}>{cancelLabel}</button>
          <button
            type="button"
            onClick={() => {
              const normalized = value.trim()
              if (!normalized) return
              onSubmit(normalized)
            }}
            disabled={!value.trim()}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
