import { create } from 'zustand'
import { WORKSPACE_MODULES } from '../config/workspaceModules'
import { WORKSPACE_PRESET_BY_ID } from '../config/workspacePresets'
import type { WorkspaceModuleId, WorkspaceModulePreference, WorkspacePreferences, WorkspacePresetDefinition, WorkspacePresetId, WorkspaceZoneId } from '../types/weather'

const STORAGE_KEY = 'wallcloud-weather-dashboard-workspace-v1'
const moduleIds = new Set<WorkspaceModuleId>(WORKSPACE_MODULES.map((module) => module.id))
const zoneIds = new Set<WorkspaceZoneId>(['leftRail', 'rightRail', 'bottomDock', 'mapOverlay', 'focusPanel'])

type LayoutMode = 'operate' | 'edit'

export interface UserWorkspacePreset {
  id: string
  title: string
  description: string
  preferences: WorkspacePreferences
}

interface PersistedWorkspaceBlob {
  currentPresetId?: unknown
  layoutMode?: unknown
  userPresets?: unknown
  [key: string]: unknown
}

function defaultPreferences(): WorkspacePreferences {
  return WORKSPACE_MODULES.reduce((preferences, module) => {
    preferences[module.id] = { visible: module.defaultVisible, zone: module.defaultZone }
    return preferences
  }, {} as WorkspacePreferences)
}

function clonePreferences(source: WorkspacePreferences): WorkspacePreferences {
  return WORKSPACE_MODULES.reduce((output, module) => {
    const current = source[module.id]
    output[module.id] = {
      visible: current?.visible ?? module.defaultVisible,
      zone: current?.zone && zoneIds.has(current.zone) ? current.zone : module.defaultZone,
    }
    return output
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

function readWorkspaceBlob(): PersistedWorkspaceBlob {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) as PersistedWorkspaceBlob : {}
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

function readLayoutMode(raw: unknown): LayoutMode {
  return raw === 'edit' ? 'edit' : 'operate'
}

function isWorkspacePreferences(value: unknown): value is WorkspacePreferences {
  if (!value || typeof value !== 'object') return false
  return WORKSPACE_MODULES.every((module) => {
    const item = (value as Record<string, unknown>)[module.id]
    if (!item || typeof item !== 'object') return false
    const pref = item as Partial<WorkspaceModulePreference>
    return typeof pref.visible === 'boolean' && typeof pref.zone === 'string' && zoneIds.has(pref.zone)
  })
}

function readUserPresets(raw: unknown): UserWorkspacePreset[] {
  if (!Array.isArray(raw)) return []
  const parsed: UserWorkspacePreset[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const candidate = item as Partial<UserWorkspacePreset>
    if (!candidate.id || !candidate.title || !candidate.preferences) continue
    if (!isWorkspacePreferences(candidate.preferences)) continue
    parsed.push({
      id: candidate.id,
      title: candidate.title,
      description: candidate.description ?? 'Saved custom workspace preset.',
      preferences: clonePreferences(candidate.preferences),
    })
  }
  return parsed
}

function readCurrentPresetId(raw: unknown, userPresets: UserWorkspacePreset[]): string | null {
  if (typeof raw !== 'string' || raw.trim().length === 0) return null
  if (WORKSPACE_PRESET_BY_ID.has(raw as WorkspacePresetId)) return raw
  if (userPresets.some((preset) => preset.id === raw)) return raw
  return null
}

function writeWorkspaceState(
  preferences: WorkspacePreferences,
  currentPresetId: string | null,
  layoutMode: LayoutMode,
  userPresets: UserWorkspacePreset[],
): void {
  try {
    const knownOnly = Object.entries(preferences).reduce((output, [id, preference]) => {
      if (moduleIds.has(id as WorkspaceModuleId)) output[id as WorkspaceModuleId] = preference
      return output
    }, {} as WorkspacePreferences)
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        ...knownOnly,
        currentPresetId: currentPresetId ?? null,
        layoutMode,
        userPresets,
      }),
    )
  } catch {
    // Local storage can be blocked; the in-memory store still works for this session.
  }
}

function createUserPresetId(title: string): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 32) || 'custom'
  return `user-${slug}-${Date.now()}`
}

interface WorkspaceState {
  preferences: WorkspacePreferences
  currentPresetId: string | null
  layoutMode: LayoutMode
  userPresets: UserWorkspacePreset[]
  setLayoutMode: (mode: LayoutMode) => void
  toggleLayoutMode: () => void
  setModuleVisible: (moduleId: WorkspaceModuleId, visible: boolean) => void
  setModuleZone: (moduleId: WorkspaceModuleId, zone: WorkspaceZoneId) => void
  applyPreset: (presetId: string) => void
  saveCurrentAsPreset: (title: string) => void
  deleteUserPreset: (presetId: string) => void
  resetWorkspace: () => void
}

const initialBlob = readWorkspaceBlob()
const initialUserPresets = readUserPresets(initialBlob.userPresets)

function findPresetById(presetId: string, userPresets: UserWorkspacePreset[]): WorkspacePresetDefinition | UserWorkspacePreset | null {
  const builtIn = WORKSPACE_PRESET_BY_ID.get(presetId as WorkspacePresetId)
  if (builtIn) return builtIn
  return userPresets.find((preset) => preset.id === presetId) ?? null
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  preferences: readWorkspacePreferences(),
  currentPresetId: readCurrentPresetId(initialBlob.currentPresetId, initialUserPresets),
  layoutMode: readLayoutMode(initialBlob.layoutMode),
  userPresets: initialUserPresets,
  setLayoutMode: (mode) => set((state) => {
    writeWorkspaceState(state.preferences, state.currentPresetId, mode, state.userPresets)
    return { layoutMode: mode }
  }),
  toggleLayoutMode: () => set((state) => {
    const layoutMode: LayoutMode = state.layoutMode === 'edit' ? 'operate' : 'edit'
    writeWorkspaceState(state.preferences, state.currentPresetId, layoutMode, state.userPresets)
    return { layoutMode }
  }),
  setModuleVisible: (moduleId, visible) => set((state) => {
    const next = { ...state.preferences, [moduleId]: { ...state.preferences[moduleId], visible } }
    writeWorkspaceState(next, state.currentPresetId, state.layoutMode, state.userPresets)
    return { preferences: next, currentPresetId: state.currentPresetId }
  }),
  setModuleZone: (moduleId, zone) => set((state) => {
    if (!zoneIds.has(zone)) return state
    const next = { ...state.preferences, [moduleId]: { ...state.preferences[moduleId], zone } }
    writeWorkspaceState(next, state.currentPresetId, state.layoutMode, state.userPresets)
    return { preferences: next, currentPresetId: state.currentPresetId }
  }),
  applyPreset: (presetId) => set((state) => {
    const preset = findPresetById(presetId, state.userPresets)
    if (!preset) return state
    const preferences = clonePreferences(preset.preferences)
    writeWorkspaceState(preferences, presetId, state.layoutMode, state.userPresets)
    return { preferences, currentPresetId: presetId }
  }),
  saveCurrentAsPreset: (title) => set((state) => {
    const normalized = title.trim()
    if (!normalized) return state
    const existing = state.userPresets.find((preset) => preset.title.toLowerCase() === normalized.toLowerCase())
    const presetId = existing?.id ?? createUserPresetId(normalized)
    const nextPreset: UserWorkspacePreset = {
      id: presetId,
      title: normalized,
      description: 'Saved custom workspace preset.',
      preferences: clonePreferences(state.preferences),
    }
    const userPresets = existing
      ? state.userPresets.map((preset) => (preset.id === existing.id ? nextPreset : preset))
      : [nextPreset, ...state.userPresets]
    writeWorkspaceState(state.preferences, nextPreset.id, state.layoutMode, userPresets)
    return { userPresets, currentPresetId: nextPreset.id }
  }),
  deleteUserPreset: (presetId) => set((state) => {
    const userPresets = state.userPresets.filter((preset) => preset.id !== presetId)
    const currentPresetId = state.currentPresetId === presetId ? null : state.currentPresetId
    writeWorkspaceState(state.preferences, currentPresetId, state.layoutMode, userPresets)
    return { userPresets, currentPresetId }
  }),
  resetWorkspace: () => set((state) => {
    const next = defaultPreferences()
    writeWorkspaceState(next, null, state.layoutMode, state.userPresets)
    return { preferences: next, currentPresetId: null }
  }),
}))
