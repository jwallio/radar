import { WEATHER_PRESETS } from '../config/presets'
import { useMapStore } from '../state/mapStore'

export function PresetBar() {
  const applyPreset = useMapStore((state) => state.applyPreset)

  return (
    <nav className="preset-bar" aria-label="Weather presets">
      {WEATHER_PRESETS.map((preset) => (
        <button key={preset.id} onClick={() => applyPreset(preset.id)}>
          {preset.label}
        </button>
      ))}
    </nav>
  )
}

