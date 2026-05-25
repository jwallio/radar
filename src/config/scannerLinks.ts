import type { ExternalOpsGroup } from '../types/weather'

export const SCANNER_LINK_GROUPS: ExternalOpsGroup[] = [
  {
    id: 'public-safety-aggregators',
    title: 'Public Safety Scanner Hubs',
    items: [
      { id: 'broadcastify-main', label: 'Broadcastify Live Audio', url: 'https://www.broadcastify.com/listen/', sourceType: 'scanner', region: 'U.S. & Canada' },
      { id: 'openmhz', label: 'OpenMHz Feeds', url: 'https://openmhz.com/systems', sourceType: 'scanner', region: 'U.S.' },
    ],
  },
  {
    id: 'weather-radio',
    title: 'Weather Radio & Official Audio',
    items: [
      { id: 'noaa-weather-radio', label: 'NOAA Weather Radio (Info)', url: 'https://www.weather.gov/nwr/', sourceType: 'official', region: 'U.S.' },
      { id: 'skywarn-groups', label: 'SKYWARN Program Directory', url: 'https://www.weather.gov/SKYWARN', sourceType: 'official', region: 'U.S.' },
    ],
  },
  {
    id: 'regional-ops',
    title: 'Regional Ops Monitoring',
    items: [
      { id: 'tx-scanner-directory', label: 'Texas Scanner Directory', url: 'https://www.broadcastify.com/listen/stid/48', sourceType: 'community', region: 'Texas' },
      { id: 'ok-scanner-directory', label: 'Oklahoma Scanner Directory', url: 'https://www.broadcastify.com/listen/stid/40', sourceType: 'community', region: 'Oklahoma' },
    ],
  },
]
