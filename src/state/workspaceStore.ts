import { create } from 'zustand'
import { WORKSPACE_MODULES } from '../config/workspaceModules'
import { WORKSPACE_PRESET_BY_ID } from '../config/workspacePresets'
import type { WorkspaceModuleId, WorkspaceModulePreference, WorkspacePreferences, WorkspacePresetId, WorkspaceZoneId } from '../types/weather'

const STORAGE_KEY = 'wallcloud-weather-dashboard-workspace-v1'
const moduleIds = new Set<WorkspaceModuleId>(WORKSPACE_MODULES.map((module) => module.id))
const zoneIds = new Set<WorkspaceZoneId>(['leftRail', 'rightRail', 'bottomDock', 'mapOverlay', 'focusPanel'])

type LayoutMode = 'operate' | 'edit'

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

function readWorkspaceBlob(): Record<string, unknown> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

function readWorkspacePreferences(): WorkspacePreferences {
  const defaults = defaultPreferences()
  const parsed = readWorkspaceBlob()
  for (const module of WORKSPACE_MODULES) {
    defaults[module.id] = normalizePreference(module.id, parsed[module.id])
  }
  return defaults
}

function readPresetId(raw: unknown): WorkspacePresetId | null {
  return typeof raw === 'string' && WORKSPACE_PRESET_BY_ID.has(raw as WorkspacePresetId) ? raw as WorkspacePresetId : null
}

function readLayoutMode(raw: unknown): LayoutMode {
  return raw === 'edit' ? 'edit' : 'operate'
}

function writeWorkspaceState(preferences: WorkspacePreferences, currentPresetId: WorkspacePresetId | null, layoutMode: LayoutMode): void {
  try {
    const knownOnly = Object.entries(preferences).reduce((output, [id, preference]) => {
      if (moduleIds.has(id as WorkspaceModuleId)) output[id as WorkspaceModuleId] = preference
      return output
    }, {} as WorkspacePreferences)
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...knownOnly, currentPresetId: currentPresetId ?? null, layoutMode }))
  } catch {
    // Local storage can be blocked; the in-memory store still works for this session.
  }
}

interface WorkspaceState {
  preferences: WorkspacePreferences
  currentPresetId: WorkspacePresetId | null
  layoutMode: LayoutMode
  setLayoutMode: (mode: LayoutMode) => void
  toggleLayoutMode: () => void
  setModuleVisible: (moduleId: WorkspaceModuleId, visible: boolean) => void
  setModuleZone: (moduleId: WorkspaceModuleId, zone: WorkspaceZoneId) => void
  applyPreset: (presetId: WorkspacePresetId) => void
  resetWorkspace: () => void
}

const initialBlob = readWorkspaceBlob()

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  preferences: readWorkspacePreferences(),
  currentPresetId: readPresetId(initialBlob.currentPresetId),
  layoutMode: readLayoutMode(initialBlob.layoutMode),
  setLayoutMode: (mode) => set((state) => {
    writeWorkspaceState(state.preferences, state.currentPresetId, mode)
    return { layoutMode: mode }
  }),
  toggleLayoutMode: () => set((state) => {
    const layoutMode: LayoutMode = state.layoutMode === 'edit' ? 'operate' : 'edit'
    writeWorkspaceState(state.preferences, state.currentPresetId, layoutMode)
    return { layoutMode }
  }),
  setModuleVisible: (moduleId, visible) => set((state) => {
    const next = { ...state.preferences, [moduleId]: { ...state.preferences[moduleId], visible } }
    writeWorkspaceState(next, state.currentPresetId, state.layoutMode)
    return { preferences: next, currentPresetId: state.currentPresetId }
  }),
  setModuleZone: (moduleId, zone) => set((state) => {
    if (!zoneIds.has(zone)) return state
    const next = { ...state.preferences, [moduleId]: { ...state.preferences[moduleId], zone } }
    writeWorkspaceState(next, state.currentPresetId, state.layoutMode)
    return { preferences: next, currentPresetId: state.currentPresetId }
  }),
  applyPreset: (presetId) => set((state) => {
    const preset = WORKSPACE_PRESET_BY_ID.get(presetId)
    if (!preset) return {}
    writeWorkspaceState(preset.preferences, presetId, state.layoutMode)
    return { preferences: preset.preferences, currentPresetId: presetId }
  }),
  resetWorkspace: () => set((state) => {
    const next = defaultPreferences()
    writeWorkspaceState(next, null, state.layoutMode)
    return { preferences: next, currentPresetId: null }
  }),
}))
