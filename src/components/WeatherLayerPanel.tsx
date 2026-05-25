import { useEffect, useMemo, useState } from 'react'
import { WEATHER_LAYERS } from '../config/layers'
import { useMapStore } from '../state/mapStore'

const layerShortcutMap: Record<string, (typeof WEATHER_LAYERS)[number]['id']> = {
  '1': 'nwsAlerts',
  '2': 'radar',
  '3': 'spcOutlook',
  '4': 'stormReports',
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName.toLowerCase()
  return tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable
}

interface WeatherLayerPanelProps {
  embedded?: boolean
}

export function WeatherLayerPanel({ embedded = false }: WeatherLayerPanelProps) {
  const enabledLayers = useMapStore((state) => state.enabledLayers)
  const alertViewMode = useMapStore((state) => state.alertViewMode)
  const toggleLayer = useMapStore((state) => state.toggleLayer)
  const setAlertViewMode = useMapStore((state) => state.setAlertViewMode)
  const applyPreset = useMapStore((state) => state.applyPreset)

  const [query, setQuery] = useState('')

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return

      const layerId = layerShortcutMap[event.key]
      if (layerId) {
        event.preventDefault()
        toggleLayer(layerId)
        return
      }

      if (event.key.toLowerCase() === 's') {
        event.preventDefault()
        applyPreset('severe-weather')
        return
      }

      if (event.key.toLowerCase() === 'c') {
        event.preventDefault()
        applyPreset('clean-map')
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [applyPreset, toggleLayer])

  const filteredLayers = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return WEATHER_LAYERS
    return WEATHER_LAYERS.filter((layer) => (
      layer.label.toLowerCase().includes(needle) || layer.description.toLowerCase().includes(needle)
    ))
  }, [query])

  const content = (
    <>
      <label className="layer-search">
        <span>Filter layers</span>
        <input value={query} onChange={(event) => setQuery(event.currentTarget.value)} placeholder="alerts, radar..." />
      </label>
      <div className="layer-alert-filter">
        <span>Alert map filter</span>
        <select value={alertViewMode} onChange={(event) => setAlertViewMode(event.currentTarget.value as typeof alertViewMode)}>
          <option value="all">All mapped alerts</option>
          <option value="warnings">Warnings only</option>
          <option value="watches">Watches only</option>
        </select>
      </div>
      <ul>
        {filteredLayers.map((layer) => {
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
      <section className="layer-legend">
        <h4>Map legend</h4>
        <p><span className="legend-dot legend-tornado" /> Tornado reports</p>
        <p><span className="legend-dot legend-wind" /> Wind reports</p>
        <p><span className="legend-dot legend-hail" /> Hail reports</p>
        <p><span className="legend-swatch legend-alert" /> NWS alert polygons</p>
        <p><span className="legend-swatch legend-outlook" /> SPC Day 1 outlook polygons</p>
      </section>
      <section className="layer-shortcuts">
        <h4>Shortcuts</h4>
        <p>1 alerts • 2 radar • 3 SPC outlook • 4 reports</p>
        <p>S severe-weather preset • C clean-map preset</p>
      </section>
    </>
  )

  if (embedded) {
    return (
      <section className="layer-panel embedded">
        <div className="layer-panel-top"><h3>Weather Layers</h3></div>
        {content}
      </section>
    )
  }

  return (
    <aside className="layer-panel">
      <div className="layer-panel-top"><h3>Weather Layers</h3></div>
      {content}
    </aside>
  )
}
