import type { WeatherNewsGroup } from '../types/weather'

export const WEATHER_NEWS_GROUPS: WeatherNewsGroup[] = [
  {
    id: 'official-national',
    title: 'Official National Sources',
    items: [
      { id: 'noaa-news', label: 'NOAA News', url: 'https://www.noaa.gov/news', sourceType: 'official', region: 'U.S.' },
      { id: 'nws-main', label: 'National Weather Service', url: 'https://www.weather.gov/', sourceType: 'official', region: 'U.S.' },
      { id: 'nhc-advisories', label: 'NHC Advisories', url: 'https://www.nhc.noaa.gov/', sourceType: 'official', region: 'Atlantic & Pacific' },
    ],
  },
  {
    id: 'forecast-discussions',
    title: 'Forecast Discussions',
    items: [
      { id: 'wpc-discussions', label: 'WPC Forecast Discussions', url: 'https://www.wpc.ncep.noaa.gov/discussions/', sourceType: 'forecast-discussion', region: 'U.S.' },
      { id: 'nws-afd', label: 'NWS Area Forecast Discussions', url: 'https://www.weather.gov/forecastmaps', sourceType: 'forecast-discussion', region: 'Local offices' },
    ],
  },
  {
    id: 'convective-outlooks',
    title: 'Convective Outlooks & Guidance',
    items: [
      { id: 'spc-convective', label: 'SPC Convective Outlooks', url: 'https://www.spc.noaa.gov/products/outlook/', sourceType: 'outlook', region: 'U.S.' },
      { id: 'spc-mesoscale', label: 'SPC Mesoscale Discussions', url: 'https://www.spc.noaa.gov/products/md/', sourceType: 'operations', region: 'U.S.' },
    ],
  },
]
