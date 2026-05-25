import { create } from 'zustand'
import { WEATHER_LAYERS } from '../config/layers'
import { WEATHER_PRESETS } from '../config/presets'
import { readStorage, writeStorage } from '../app/storage'
import type { LayerId } from '../types/weather'

interface PersistedMapState { enabledLayers: LayerId[] }

interface MapState {
  enabledLayers: LayerId[]
  alertViewMode: 'all' | 'warnings' | 'watches'
  selectedAlertId: string | null
  zoomRequestAlertId: string | null
  zoomRequestNonce: number
  selectedRadarFrameTime: number | null
  radarOpacity: number
  radarPlaying: boolean
  radarFrameIntervalMs: number
  selectedLiveStreamerId: string | null
  toggleLayer: (layerId: LayerId) => void
  setAlertViewMode: (mode: 'all' | 'warnings' | 'watches') => void
  applyPreset: (presetId: string) => void
  selectAlert: (alertId: string | null) => void
  requestZoomToAlert: (alertId: string) => void
  setSelectedRadarFrameTime: (time: number | null) => void
  setRadarOpacity: (opacity: number) => void
  setRadarPlaying: (playing: boolean) => void
  toggleRadarPlaying: () => void
  setRadarFrameIntervalMs: (intervalMs: number) => void
  setSelectedLiveStreamerId: (streamerId: string | null) => void
}

const defaultLayers = WEATHER_LAYERS.filter((layer) => layer.defaultEnabled).map((layer) => layer.id)
const persisted = readStorage<PersistedMapState>({ enabledLayers: defaultLayers })

export const useMapStore = create<MapState>((set) => ({
  enabledLayers: persisted.enabledLayers,
  alertViewMode: 'all',
  selectedAlertId: null,
  zoomRequestAlertId: null,
  zoomRequestNonce: 0,
  selectedRadarFrameTime: null,
  radarOpacity: 0.65,
  radarPlaying: false,
  radarFrameIntervalMs: 750,
  selectedLiveStreamerId: null,
  toggleLayer: (layerId) => set((state) => {
    const enabled = state.enabledLayers.includes(layerId)
    const enabledLayers = enabled ? state.enabledLayers.filter((id) => id !== layerId) : [...state.enabledLayers, layerId]
    writeStorage({ enabledLayers })
    return { enabledLayers }
  }),
  setAlertViewMode: (mode) => set(() => ({ alertViewMode: mode })),
  applyPreset: (presetId) => set(() => {
    const preset = WEATHER_PRESETS.find((item) => item.id === presetId)
    const enabledLayers = preset ? preset.enabledLayers : defaultLayers
    writeStorage({ enabledLayers })
    return { enabledLayers }
  }),
  selectAlert: (alertId) => set(() => ({ selectedAlertId: alertId, zoomRequestAlertId: null })),
  requestZoomToAlert: (alertId) => set((state) => ({ selectedAlertId: alertId, zoomRequestAlertId: alertId, zoomRequestNonce: state.zoomRequestNonce + 1 })),
  setSelectedRadarFrameTime: (time) => set(() => ({ selectedRadarFrameTime: time })),
  setRadarOpacity: (opacity) => set(() => ({ radarOpacity: Math.max(0, Math.min(1, opacity)) })),
  setRadarPlaying: (playing) => set(() => ({ radarPlaying: playing })),
  toggleRadarPlaying: () => set((state) => ({ radarPlaying: !state.radarPlaying })),
  setRadarFrameIntervalMs: (intervalMs) => set(() => ({ radarFrameIntervalMs: Math.max(250, Math.min(2500, intervalMs)) })),
  setSelectedLiveStreamerId: (streamerId) => set(() => ({ selectedLiveStreamerId: streamerId })),
}))
