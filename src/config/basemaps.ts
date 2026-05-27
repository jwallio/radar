import type { BasemapMode } from '../types/weather'

export interface BasemapDefinition {
  id: BasemapMode
  label: string
  description: string
  tiles: string[]
  configured: boolean
}

const blackTiles = ['https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png']

function template(value: string | undefined): string[] {
  const trimmed = value?.trim()
  return trimmed ? [trimmed] : []
}

export const BASEMAPS: BasemapDefinition[] = [
  {
    id: 'black',
    label: 'Black ops',
    description: 'High-contrast dark basemap for weather-first operations.',
    tiles: blackTiles,
    configured: true,
  },
  {
    id: 'bingRoad',
    label: 'Bing road',
    description: 'Configured Bing road/streets tile source.',
    tiles: template(import.meta.env.VITE_BING_ROAD_TILE_TEMPLATE as string | undefined),
    configured: Boolean((import.meta.env.VITE_BING_ROAD_TILE_TEMPLATE as string | undefined)?.trim()),
  },
  {
    id: 'bingAerial',
    label: 'Bing aerial',
    description: 'Configured Bing aerial/satellite tile source.',
    tiles: template(import.meta.env.VITE_BING_AERIAL_TILE_TEMPLATE as string | undefined),
    configured: Boolean((import.meta.env.VITE_BING_AERIAL_TILE_TEMPLATE as string | undefined)?.trim()),
  },
  {
    id: 'googleRoad',
    label: 'Google road',
    description: 'Configured Google road tile source; use official/session-backed templates only.',
    tiles: template(import.meta.env.VITE_GOOGLE_ROAD_TILE_TEMPLATE as string | undefined),
    configured: Boolean((import.meta.env.VITE_GOOGLE_ROAD_TILE_TEMPLATE as string | undefined)?.trim()),
  },
  {
    id: 'googleSatellite',
    label: 'Google satellite',
    description: 'Configured Google satellite tile source; use official/session-backed templates only.',
    tiles: template(import.meta.env.VITE_GOOGLE_SATELLITE_TILE_TEMPLATE as string | undefined),
    configured: Boolean((import.meta.env.VITE_GOOGLE_SATELLITE_TILE_TEMPLATE as string | undefined)?.trim()),
  },
]

export function getBasemap(mode: BasemapMode): BasemapDefinition {
  const candidate = BASEMAPS.find((item) => item.id === mode)
  return candidate?.configured ? candidate : BASEMAPS[0]
}
