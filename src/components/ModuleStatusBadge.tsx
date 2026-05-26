import type { ModuleOperationalState } from '../types/weather'

interface ModuleStatusBadgeProps {
  state: ModuleOperationalState
  label?: string
}

const LABELS: Record<ModuleOperationalState, string> = {
  loading: 'Loading',
  ready: 'Ready',
  degraded: 'Degraded',
  disabled: 'Disabled',
}

export function ModuleStatusBadge({ state, label }: ModuleStatusBadgeProps) {
  return <span className={`module-status-badge ${state}`}>{label ?? LABELS[state]}</span>
}

interface ModuleStateNoticeProps {
  state: ModuleOperationalState
  title: string
  message: string
  onRetry?: () => void
}

export function ModuleStateNotice({ state, title, message, onRetry }: ModuleStateNoticeProps) {
  return (
    <section className={`module-state-card ${state}`}>
      <div className="module-state-top">
        <strong>{title}</strong>
        <ModuleStatusBadge state={state} />
      </div>
      <p>{message}</p>
      {state === 'degraded' && onRetry && (
        <button type="button" onClick={onRetry}>Retry refresh</button>
      )}
    </section>
  )
}
