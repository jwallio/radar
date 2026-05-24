import type { SourceLink } from '../types/weather'

export const SOURCE_LINKS: SourceLink[] = [
  {
    id: 'nws-alerts',
    label: 'NWS Active Alerts',
    url: 'https://api.weather.gov/alerts/active?status=actual&message_type=alert',
  },
  {
    id: 'wwa-polygons',
    label: 'WWA Polygons',
    url: 'https://mapservices.weather.noaa.gov/eventdriven/rest/services/WWA/watch_warn_adv/MapServer/1/query',
  },
  {
    id: 'rainviewer-radar',
    label: 'RainViewer Radar Metadata',
    url: 'https://api.rainviewer.com/public/weather-maps.json',
  },
  {
    id: 'spc-reports',
    label: 'SPC Reports (today_raw.csv)',
    url: 'https://www.spc.noaa.gov/climo/reports/today_raw.csv',
  },
  {
    id: 'spc-day1-outlook',
    label: 'SPC Day 1 Categorical Outlook',
    url: 'https://mapservices.weather.noaa.gov/vector/rest/services/outlooks/SPC_wx_outlks/MapServer/1/query?where=1%3D1&outFields=*&f=geojson&returnGeometry=true',
  },
]

