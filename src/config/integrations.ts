function parseFlag(value: string | undefined, fallback: boolean): boolean {
  if (value == null) return fallback
  const normalized = value.trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false
  return fallback
}

export const INTEGRATION_FLAGS = {
  embeddedCameras: parseFlag(import.meta.env.VITE_ENABLE_EMBEDDED_CAMERAS as string | undefined, false),
  embeddedStreamers: parseFlag(import.meta.env.VITE_ENABLE_EMBEDDED_STREAMERS as string | undefined, true),
  aiNewsSummary: parseFlag(import.meta.env.VITE_ENABLE_AI_NEWS_SUMMARY as string | undefined, false),
  spotterMapOverlays: parseFlag(import.meta.env.VITE_ENABLE_SPOTTER_MAP_OVERLAYS as string | undefined, true),
  embeddedScanners: parseFlag(import.meta.env.VITE_ENABLE_EMBEDDED_SCANNERS as string | undefined, true),
}
