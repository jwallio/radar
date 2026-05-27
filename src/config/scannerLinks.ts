import type { ExternalOpsGroup } from '../types/weather'

const NWR_BASE = 'https://radio.weatherusa.net/NWR'

export const SCANNER_LINK_GROUPS: ExternalOpsGroup[] = [
  {
    id: 'openmhz-state-systems',
    title: 'OpenMHz — State Systems',
    items: [
      { id: 'openmhz-tx', label: 'Texas Public Safety Systems', url: 'https://openmhz.com/systems?filter=texas', embedUrl: 'https://openmhz.com/systems?filter=texas', sourceType: 'scanner', region: 'Texas' },
      { id: 'openmhz-ok', label: 'Oklahoma Public Safety Systems', url: 'https://openmhz.com/systems?filter=oklahoma', embedUrl: 'https://openmhz.com/systems?filter=oklahoma', sourceType: 'scanner', region: 'Oklahoma' },
      { id: 'openmhz-ks', label: 'Kansas Public Safety Systems', url: 'https://openmhz.com/systems?filter=kansas', embedUrl: 'https://openmhz.com/systems?filter=kansas', sourceType: 'scanner', region: 'Kansas' },
      { id: 'openmhz-mo', label: 'Missouri Public Safety Systems', url: 'https://openmhz.com/systems?filter=missouri', embedUrl: 'https://openmhz.com/systems?filter=missouri', sourceType: 'scanner', region: 'Missouri' },
      { id: 'openmhz-ne', label: 'Nebraska Public Safety Systems', url: 'https://openmhz.com/systems?filter=nebraska', embedUrl: 'https://openmhz.com/systems?filter=nebraska', sourceType: 'scanner', region: 'Nebraska' },
      { id: 'openmhz-ar', label: 'Arkansas Public Safety Systems', url: 'https://openmhz.com/systems?filter=arkansas', embedUrl: 'https://openmhz.com/systems?filter=arkansas', sourceType: 'scanner', region: 'Arkansas' },
      { id: 'openmhz-la', label: 'Louisiana Public Safety Systems', url: 'https://openmhz.com/systems?filter=louisiana', embedUrl: 'https://openmhz.com/systems?filter=louisiana', sourceType: 'scanner', region: 'Louisiana' },
    ],
  },
  {
    id: 'openmhz-national',
    title: 'OpenMHz — All Systems',
    items: [
      { id: 'openmhz', label: 'OpenMHz — Browse All Systems', url: 'https://openmhz.com/systems', embedUrl: 'https://openmhz.com/systems', sourceType: 'scanner', region: 'U.S.' },
    ],
  },
  {
    id: 'noaa-weather-radio-audio',
    title: 'NOAA Weather Radio — Direct Audio',
    items: [
      { id: 'nwr-kec56-dallas', label: 'KEC56 — Dallas, TX', url: 'https://www.weather.gov/fwd/', audioStreamUrl: `${NWR_BASE}/KEC56_3.mp3`, sourceType: 'official', region: 'Dallas-Fort Worth' },
      { id: 'nwr-kec55-fort-worth', label: 'KEC55 — Fort Worth, TX', url: 'https://www.weather.gov/fwd/', audioStreamUrl: `${NWR_BASE}/KEC55_2.mp3`, sourceType: 'official', region: 'Dallas-Fort Worth' },
      { id: 'nwr-wxk85-okc', label: 'WXK85 — Oklahoma City, OK', url: 'https://www.weather.gov/oun/', audioStreamUrl: `${NWR_BASE}/WXK85.mp3`, sourceType: 'official', region: 'Oklahoma' },
      { id: 'nwr-wxk86-lawton', label: 'WXK86 — Lawton, OK', url: 'https://www.weather.gov/oun/', audioStreamUrl: `${NWR_BASE}/WXK86.mp3`, sourceType: 'official', region: 'Oklahoma' },
      { id: 'nwr-wxk38-amarillo', label: 'WXK38 — Amarillo, TX', url: 'https://www.weather.gov/ama/', audioStreamUrl: `${NWR_BASE}/WXK38_2.mp3`, sourceType: 'official', region: 'Texas Panhandle' },
      { id: 'nwr-kgg68-tomball', label: 'KGG68 — Houston, TX', url: 'https://www.weather.gov/hgx/', audioStreamUrl: `${NWR_BASE}/KGG68.mp3`, sourceType: 'official', region: 'Southeast Texas' },
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