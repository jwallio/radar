import type { ExternalOpsGroup } from '../types/weather'

export const CAMERA_LINK_GROUPS: ExternalOpsGroup[] = [
  {
    id: 'national-camera-networks',
    title: 'National Camera Networks',
    items: [
      { id: 'nws-webcams', label: 'NWS Webcams Directory', url: 'https://www.weather.gov/cameras', sourceType: 'official', region: 'U.S.' },
      { id: 'dot-traffic-cams', label: 'State DOT Traffic Cameras', url: 'https://ops.fhwa.dot.gov/511/', sourceType: 'official', region: 'U.S.' },
    ],
  },
  {
    id: 'storm-chase-streams',
    title: 'Storm Chaser Camera Hubs',
    items: [
      { id: 'severe-studios', label: 'SevereStudios Chaser Map', url: 'https://www.severestudios.com/', sourceType: 'community', region: 'U.S.' },
      { id: 'weathercams', label: 'WeatherCams Global Directory', url: 'https://www.weathercams.co.uk/', sourceType: 'community', region: 'Global' },
    ],
  },
  {
    id: 'regional-quick-access',
    title: 'Regional Quick Access',
    items: [
      { id: 'tx-dot-cams', label: 'TxDOT Cameras', url: 'https://its.txdot.gov/its/District/AUS/cameras', sourceType: 'camera', region: 'Texas' },
      { id: 'ok-dot-cams', label: 'OK Traffic Cameras', url: 'https://oktraffic.org/', sourceType: 'camera', region: 'Oklahoma' },
    ],
  },
]
