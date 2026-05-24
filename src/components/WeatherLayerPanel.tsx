import { WEATHER_LAYERS } from '../config/layers'
import { useMapStore } from '../state/mapStore'

export function WeatherLayerPanel() {
  const enabledLayers = useMapStore((state) => state.enabledLayers)
  const toggleLayer = useMapStore((state) => state.toggleLayer)

  return (
    <aside className="layer-panel">
      <h3>Weather Layers</h3>
      <ul>
        {WEATHER_LAYERS.map((layer) => {
          const checked = enabledLayers.includes(layer.id)
          return (
            <li key={layer.id}>
              <label>
                <input type="checkbox" checked={checked} onChange={() => toggleLayer(layer.id)} />
                <span>{layer.label}</span>
              </label>
            </li>
          )
        })}
      </ul>
    </aside>
  )
}

