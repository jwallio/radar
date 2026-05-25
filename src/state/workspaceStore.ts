import { create } from 'zustand'
import { WORKSPACE_MODULES } from '../config/workspaceModules'
import { WORKSPACE_PRESET_BY_ID } from '../config/workspacePresets'
import type { WorkspaceModuleId, WorkspaceModulePreference, WorkspacePreferences, WorkspacePresetId, WorkspaceZoneId } from '../types/weather'

const STORAGE_KEY = 'wallcloud-weather-dashboard-workspace-v1'
const moduleIds = new Set<WorkspaceModuleId>(WORKSPACE_MODULES.map((module) => module.id))
const zoneIds = new Set<WorkspaceZoneId>(['leftRail', 'rightRail', 'bottomDock', 'mapOverlay', 'focusPanel'])

function defaultPreferences(): WorkspacePreferences {
  return WORKSPACE_MODULES.reduce((preferences, module) => {
    preferences[module.id] = { visible: module.defaultVisible, zone: module.defaultZone }
    return preferences
  }, {} as WorkspacePreferences)
}

function normalizePreference(moduleId: WorkspaceModuleId, value: unknown): WorkspaceModulePreference {
  const fallback = WORKSPACE_MODULES.find((module) => module.id === moduleId)
  const parsed = value && typeof value === 'object' ? value as Partial<WorkspaceModulePreference> : {}
  return {
    visible: typeof parsed.visible === 'boolean' ? parsed.visible : fallback?.defaultVisible ?? true,
    zone: parsed.zone && zoneIds.has(parsed.zone) ? parsed.zone : fallback?.defaultZone ?? 'leftRail',
  }
}

function readWorkspacePreferences(): WorkspacePreferences {
  const defaults = defaultPreferences()
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaults
    const parsed = JSON.parse(raw) as Record<string, unknown>
    for (const module of WORKSPACE_MODULES) {
      defaults[module.id] = normalizePreference(module.id, parsed[module.id])
    }
    return defaults
  } catch {
    return defaults
  }
}

function readPresetId(raw: unknown): WorkspacePresetId | null {
  return typeof raw === 'string' && WORKSPACE_PRESET_BY_ID.has(raw as WorkspacePresetId) ? raw as WorkspacePresetId : null
}

function writeWorkspacePreferences(preferences: WorkspacePreferences, currentPresetId?: WorkspacePresetId | null): void {
  try {
    const knownOnly = Object.entries(preferences).reduce((output, [id, preference]) => {
      if (moduleIds.has(id as WorkspaceModuleId)) output[id as WorkspaceModuleId] = preference
      return output
    }, {} as WorkspacePreferences)
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...knownOnly, currentPresetId: currentPresetId ?? null }))
  } catch {
    // Local storage can be blocked; the in-memory store still works for this session.
  }
}

interface WorkspaceState {
  preferences: WorkspacePreferences
  currentPresetId: WorkspacePresetId | null
  setModuleVisible: (moduleId: WorkspaceModuleId, visible: boolean) => void
  setModuleZone: (moduleId: WorkspaceModuleId, zone: WorkspaceZoneId) => void
  applyPreset: (presetId: WorkspacePresetId) => void
  resetWorkspace: () => void
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  preferences: readWorkspacePreferences(),
  currentPresetId: (() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      return raw ? readPresetId((JSON.parse(raw) as { currentPresetId?: unknown }).currentPresetId) : null
    } catch {
      return null
    }
  })(),
  setModuleVisible: (moduleId, visible) => set((state) => {
    const next = { ...state.preferences, [moduleId]: { ...state.preferences[moduleId], visible } }
    writeWorkspacePreferences(next, state.currentPresetId)
    return { preferences: next, currentPresetId: state.currentPresetId }
  }),
  setModuleZone: (moduleId, zone) => set((state) => {
    if (!zoneIds.has(zone)) return state
    const next = { ...state.preferences, [moduleId]: { ...state.preferences[moduleId], zone } }
    writeWorkspacePreferences(next, state.currentPresetId)
    return { preferences: next, currentPresetId: state.currentPresetId }
  }),
  applyPreset: (presetId) => set(() => {
    const preset = WORKSPACE_PRESET_BY_ID.get(presetId)
    if (!preset) return {}
    writeWorkspacePreferences(preset.preferences, presetId)
    return { preferences: preset.preferences, currentPresetId: presetId }
  }),
  resetWorkspace: () => set(() => {
    const next = defaultPreferences()
    writeWorkspacePreferences(next, null)
    return { preferences: next, currentPresetId: null }
  }),
}))
