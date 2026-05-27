import type { LiveContextModule } from '../types/weather'

export const LIVE_CONTEXT_MODULES: LiveContextModule[] = [
  { id: 'live-cams', title: 'Live Weather Cams', type: 'cams', emptyMessage: 'No camera feeds configured yet.', items: [{ id: 'cam-okc', label: 'OKC Metro Cam Network', url: 'https://www.weather.gov/oun/cams' }] },
  { id: 'storm-chasers', title: 'Storm Chaser Streams', type: 'chasers', emptyMessage: 'No storm chaser streams configured yet.', items: [{ id: 'chaser-1', label: 'Community Chaser List', url: 'https://www.youtube.com/results?search_query=live+storm+chasing' }] },
  { id: 'spotter-network', title: 'Spotter Network', type: 'spotters', emptyMessage: 'Spotter markers appear directly on the map when overlays are enabled. Hover CAM markers for details or live-viewer handoff.', items: [] },
  { id: 'trending-weather-news', title: 'Trending Weather News', type: 'news', emptyMessage: 'No trending news feed configured yet.', items: [{ id: 'news-noaa', label: 'NOAA News', url: 'https://www.noaa.gov/news' }] },
  { id: 'openmhz-scanner', title: 'OpenMHz Scanner Feeds', type: 'scanner', emptyMessage: 'No scanner feed configured yet.', items: [{ id: 'scanner-directory', label: 'OpenMHz Feed Directory', url: 'https://openmhz.com/' }] },
]
