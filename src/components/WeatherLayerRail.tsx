import { useMemo } from 'react'
import { BASEMAPS } from '../config/basemaps'
import { WEATHER_LAYERS } from '../config/layers'
import { WEATHER_PRESETS } from '../config/presets'
import { useMapStore } from '../state/mapStore'
import type { BasemapMode, LayerId } from '../types/weather'

const layerGroups = [
  { label: 'Alerts', layers: WEATHER_LAYERS.filter((l) => l.id === 'nwsAlerts') },
  { label: 'Radar', layers: WEATHER_LAYERS.filter((l) => l.id === 'radar') },
  { label: 'SPC', layers: WEATHER_LAYERS.filter((l) => l.id === 'spcOutlook' || l.id === 'stormReports') },
]

function sameLayerSet(left: LayerId[], right: LayerId[]) {
  const visibleLeft = left.filter((id) => id !== 'wwaPolygons')
  const visibleRight = right.filter((id) => id !== 'wwaPolygons')
  return visibleLeft.length === visibleRight.length && visibleLeft.every((id) => visibleRight.includes(id))
}

export function WeatherLayerRail() {
  const enabledLayers = useMapStore((s) => s.enabledLayers)
  const alertViewMode = useMapStore((s) => s.alertViewMode)
  const basemapMode = useMapStore((s) => s.basemapMode)
  const toggleLayer = useMapStore((s) => s.toggleLayer)
  const setAlertViewMode = useMapStore((s) => s.setAlertViewMode)
  const setBasemapMode = useMapStore((s) => s.setBasemapMode)
  const applyPreset = useMapStore((s) => s.applyPreset)

  const activePresetId = useMemo(() => {
    return WEATHER_PRESETS.find((preset) => sameLayerSet(enabledLayers, preset.enabledLayers))?.id ?? null
  }, [enabledLayers])

  return (
    <aside className="wcc-left-rail">
      <div className="wcc-rail-section">
        <h3 className="wcc-rail-heading">Mode</h3>
        <div className="wcc-preset-buttons">
          {WEATHER_PRESETS.map((preset) => (
            <button
              key={preset.id}
              className={`wcc-preset-btn ${activePresetId === preset.id ? 'active' : ''}`}
              onClick={() => applyPreset(preset.id)}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      <div className="wcc-rail-section">
        <h3 className="wcc-rail-heading">Alert Filter</h3>
        <select
          className="wcc-alert-filter"
          value={alertViewMode}
          onChange={(e) => setAlertViewMode(e.target.value as typeof alertViewMode)}
        >
          <option value="all">All mapped alerts</option>
          <option value="warnings">Warnings only</option>
          <option value="watches">Watches only</option>
        </select>
      </div>

      <div className="wcc-rail-section">
        <h3 className="wcc-rail-heading">Basemap</h3>
        <div className="wcc-basemap-buttons">
          {BASEMAPS.map((basemap) => (
            <button
              key={basemap.id}
              type="button"
              className={`wcc-basemap-btn ${basemapMode === basemap.id ? 'active' : ''}`}
              onClick={() => setBasemapMode(basemap.id as BasemapMode)}
              disabled={!basemap.configured}
              title={basemap.description}
            >
              <span>{basemap.label}</span>
              {!basemap.configured && <em>configure env</em>}
            </button>
          ))}
        </div>
      </div>

      {layerGroups.map((group) => (
        <div key={group.label} className="wcc-rail-section">
          <h3 className="wcc-rail-heading">{group.label}</h3>
          {group.layers.map((layer) => {
            const checked = enabledLayers.includes(layer.id)
            return (
              <label key={layer.id} className="wcc-layer-toggle">
                <input type="checkbox" checked={checked} onChange={() => toggleLayer(layer.id)} />
                <span>{layer.label}</span>
              </label>
            )
          })}
        </div>
      ))}

      <div className="wcc-rail-section wcc-rail-legend">
        <h3 className="wcc-rail-heading">Legend</h3>
        <p><span className="wcc-legend-dot tornado" /> Tornado</p>
        <p><span className="wcc-legend-dot wind" /> Wind</p>
        <p><span className="wcc-legend-dot hail" /> Hail</p>
        <p className="wcc-legend-row"><span className="wcc-legend-swatch alerts" /> Alert polygon</p>
        <p className="wcc-legend-row"><span className="wcc-legend-swatch outlook" /> SPC outlook</p>
      </div>
    </aside>
  )
}