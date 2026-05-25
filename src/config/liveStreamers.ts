import type { LiveStreamer, SpotterNetworkLocation } from '../types/weather'

export const LIVE_STREAMERS: LiveStreamer[] = [
  {
    id: 'reed-timmer',
    label: 'Reed Timmer Live Chasing',
    youtubeChannelUrl: 'https://www.youtube.com/@ReedTimmerWx',
    youtubeEmbedUrl: 'https://www.youtube.com/embed/live_stream?channel=UCV6hWxB0-u_IX7X8f6vF4Hw',
    region: 'Plains',
    isLiveByDefault: true,
  },
  {
    id: 'ryan-hall',
    label: 'Ryan Hall, Y\'all',
    youtubeChannelUrl: 'https://www.youtube.com/@RyanHallYall',
    youtubeEmbedUrl: 'https://www.youtube.com/embed/live_stream?channel=UCJHAT3Uvv-g3I8H3GhHWV7w',
    region: 'CONUS',
  },
  {
    id: 'max-velocity',
    label: 'Max Velocity',
    youtubeChannelUrl: 'https://www.youtube.com/@MaxVelocityWX',
    youtubeEmbedUrl: 'https://www.youtube.com/embed/live_stream?channel=UCxX9wt5FWQUAAz4UrysqK9A',
    region: 'CONUS',
  },
]

export const SPOTTER_NETWORK_LOCATIONS: SpotterNetworkLocation[] = [
  {
    id: 'sn-ama-001',
    callsign: 'SN-AMA-001',
    lat: 35.221,
    lon: -101.831,
    region: 'TX Panhandle',
    status: 'active',
    notes: 'Tracking supercell east of Amarillo',
    streamerId: 'reed-timmer',
    hasLiveCam: true,
  },
  {
    id: 'sn-okc-017',
    callsign: 'SN-OKC-017',
    lat: 35.467,
    lon: -97.516,
    region: 'Central Oklahoma',
    status: 'active',
    notes: 'Mobile spotter net check-in',
    hasLiveCam: false,
  },
  {
    id: 'sn-wic-004',
    callsign: 'SN-WIC-004',
    lat: 37.687,
    lon: -97.33,
    region: 'South Central Kansas',
    status: 'idle',
    notes: 'Staged for possible activation',
    streamerId: 'max-velocity',
    hasLiveCam: true,
  },
]
