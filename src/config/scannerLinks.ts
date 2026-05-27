import type { ExternalOpsGroup } from '../types/weather'

export const SCANNER_LINK_GROUPS: ExternalOpsGroup[] = [
  {
    id: 'public-safety-aggregators',
    title: 'Public Safety Scanner Hubs',
    items: [
      { id: 'openmhz', label: 'OpenMHz Feeds', url: 'https://openmhz.com/systems', embedUrl: 'https://openmhz.com/systems', sourceType: 'scanner', region: 'U.S.' },
      { id: 'broadcastify-main', label: 'Broadcastify Live Audio Directory', url: 'https://www.broadcastify.com/listen/', sourceType: 'scanner', region: 'U.S. & Canada' },
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
      { id: 'tx-scanner-directory', label: 'Texas OpenMHz Systems', url: 'https://openmhz.com/systems?filter=texas', embedUrl: 'https://openmhz.com/systems?filter=texas', sourceType: 'community', region: 'Texas' },
      { id: 'ok-scanner-directory', label: 'Oklahoma OpenMHz Systems', url: 'https://openmhz.com/systems?filter=oklahoma', embedUrl: 'https://openmhz.com/systems?filter=oklahoma', sourceType: 'community', region: 'Oklahoma' },
    ],
  },
]
