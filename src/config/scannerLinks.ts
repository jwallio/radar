import type { ExternalOpsGroup } from '../types/weather'

const NWR_BASE = 'https://radio.weatherusa.net/NWR'

export const SCANNER_LINK_GROUPS: ExternalOpsGroup[] = [
  {
    id: 'noaa-weather-radio-audio',
    title: 'NOAA Weather Radio — Direct Audio',
    items: [
      { id: 'nwr-kec56-dallas', label: 'KEC56 — Dallas / Garland, TX', url: 'https://www.weather.gov/fwd/', audioStreamUrl: `${NWR_BASE}/KEC56_3.mp3`, sourceType: 'official', region: 'Dallas-Fort Worth' },
      { id: 'nwr-kec55-fort-worth', label: 'KEC55 — Fort Worth / Crowley, TX', url: 'https://www.weather.gov/fwd/', audioStreamUrl: `${NWR_BASE}/KEC55_2.mp3`, sourceType: 'official', region: 'Dallas-Fort Worth' },
      { id: 'nwr-wxk85-okc', label: 'WXK85 — Oklahoma City, OK', url: 'https://www.weather.gov/oun/', audioStreamUrl: `${NWR_BASE}/WXK85.mp3`, sourceType: 'official', region: 'Oklahoma' },
      { id: 'nwr-wxk86-lawton', label: 'WXK86 — Lawton, OK', url: 'https://www.weather.gov/oun/', audioStreamUrl: `${NWR_BASE}/WXK86.mp3`, sourceType: 'official', region: 'Oklahoma' },
      { id: 'nwr-wxk38-amarillo', label: 'WXK38 — Amarillo, TX', url: 'https://www.weather.gov/ama/', audioStreamUrl: `${NWR_BASE}/WXK38_2.mp3`, sourceType: 'official', region: 'Texas Panhandle' },
      { id: 'nwr-kgg68-tomball', label: 'KGG68 — Tomball / Houston, TX', url: 'https://www.weather.gov/hgx/', audioStreamUrl: `${NWR_BASE}/KGG68.mp3`, sourceType: 'official', region: 'Southeast Texas' },
    ],
  },
  {
    id: 'scanner-directory-embeds',
    title: 'Scanner Directory Embeds',
    items: [
      { id: 'openmhz', label: 'OpenMHz Feeds', url: 'https://openmhz.com/systems', embedUrl: 'https://openmhz.com/systems', sourceType: 'scanner', region: 'U.S.' },
      { id: 'broadcastify-main', label: 'Broadcastify Live Audio Directory', url: 'https://www.broadcastify.com/listen/', sourceType: 'scanner', region: 'U.S. & Canada' },
    ],
  },
  {
    id: 'regional-ops',
    title: 'Regional Scanner Directories',
    items: [
      { id: 'tx-scanner-directory', label: 'Texas OpenMHz Systems', url: 'https://openmhz.com/systems?filter=texas', embedUrl: 'https://openmhz.com/systems?filter=texas', sourceType: 'community', region: 'Texas' },
      { id: 'ok-scanner-directory', label: 'Oklahoma OpenMHz Systems', url: 'https://openmhz.com/systems?filter=oklahoma', embedUrl: 'https://openmhz.com/systems?filter=oklahoma', sourceType: 'community', region: 'Oklahoma' },
    ],
  },
  {
    id: 'official-reference',
    title: 'Official Reference',
    items: [
      { id: 'noaa-weather-radio', label: 'NOAA Weather Radio Station Listing', url: 'https://www.weather.gov/nwr/station_listing', sourceType: 'official', region: 'U.S.' },
      { id: 'skywarn-groups', label: 'SKYWARN Program Directory', url: 'https://www.weather.gov/SKYWARN', sourceType: 'official', region: 'U.S.' },
    ],
  },
]