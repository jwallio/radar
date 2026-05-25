import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchNwsAlertCounts, fetchNwsAlerts, fetchNwsAlertsByEvent } from '../services/nws'
import { fetchSpcDay1Outlook, fetchSpcReports } from '../services/spc'
import { fetchOpsAiSummary } from '../services/aiSummary'

interface WeatherNewsPanelProps {
  embedded?: boolean
}

interface NewsCard {
  id: string
  source: string
  headline: string
  summary: string
  updated: string | null
  priority: number
}

function formatTime(value: string | null | undefined): string {
  if (!value) return 'Unknown'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

export function WeatherNewsPanel({ embedded = false }: WeatherNewsPanelProps) {
  const alerts = useQuery({ queryKey: ['nws-alerts'], queryFn: fetchNwsAlerts, staleTime: 60_000, refetchInterval: 120_000 })
  const alertCounts = useQuery({ queryKey: ['nws-alert-counts'], queryFn: fetchNwsAlertCounts, staleTime: 60_000, refetchInterval: 120_000 })
  const tornadoWarnings = useQuery({ queryKey: ['nws-alerts-tornado-warning'], queryFn: () => fetchNwsAlertsByEvent('Tornado Warning'), staleTime: 60_000, refetchInterval: 120_000 })
  const severeThunderstormWarnings = useQuery({ queryKey: ['nws-alerts-severe-thunderstorm-warning'], queryFn: () => fetchNwsAlertsByEvent('Severe Thunderstorm Warning'), staleTime: 60_000, refetchInterval: 120_000 })
  const flashFloodWarnings = useQuery({ queryKey: ['nws-alerts-flash-flood-warning'], queryFn: () => fetchNwsAlertsByEvent('Flash Flood Warning'), staleTime: 60_000, refetchInterval: 120_000 })
  const reports = useQuery({ queryKey: ['spc-reports'], queryFn: fetchSpcReports, staleTime: 120_000, refetchInterval: 180_000 })
  const outlook = useQuery({ queryKey: ['spc-day1-outlook'], queryFn: fetchSpcDay1Outlook, staleTime: 180_000, refetchInterval: 240_000 })

  const alertItems = alerts.data?.alerts ?? []
  const severeCount = alertItems.filter((a) => a.severity === 'Severe' || a.severity === 'Extreme').length
  const reportsData = reports.data?.reports ?? []
  const tornadoCount = reportsData.filter((r) => r.type === 'tornado').length
  const outlookFeatures = outlook.data?.featureCollection.features.length ?? 0

  const aiSummary = useQuery({
    queryKey: ['ops-ai-summary', alertItems.length, severeCount, reportsData.length, tornadoCount, outlookFeatures],
    queryFn: () => fetchOpsAiSummary({
      alertCount: alertItems.length,
      severeCount,
      reportCount: reportsData.length,
      tornadoCount,
      outlookFeatureCount: outlookFeatures,
    }),
    staleTime: 60_000,
    refetchInterval: 120_000,
    enabled: !!alerts.data && !!reports.data && !!outlook.data,
  })

  const cards = useMemo<NewsCard[]>(() => {
    const next: NewsCard[] = [
      {
        id: 'ai-ops-summary',
        source: aiSummary.data?.model ? `AI Ops Summary (${aiSummary.data.model})` : 'AI Ops Summary',
        headline: severeCount > 0 ? 'Severe-weather escalation detected' : 'Baseline weather operations posture',
        summary: aiSummary.data?.summary ?? 'Generating AI summary...',
        updated: aiSummary.data?.generatedAt ?? null,
        priority: 0,
      },
      {
        id: 'nws-alerts-live',
        source: 'NWS Alerts Feed',
        headline: `${alertItems.length} active alerts • ${severeCount} severe/extreme`,
        summary: alerts.data?.error
          ? `Feed issue: ${alerts.data.error.kind} (${alerts.data.error.message})`
          : 'Live CAP/GeoJSON alert feed integrated into dashboard state.',
        updated: alerts.data?.updated ?? null,
        priority: 1,
      },
      {
        id: 'nws-alert-counts',
        source: 'NWS Active Count Feed',
        headline: `National active alerts: ${alertCounts.data?.total ?? 0}`,
        summary: alertCounts.data?.error
          ? `Feed issue: ${alertCounts.data.error.kind} (${alertCounts.data.error.message})`
          : `Land: ${alertCounts.data?.land ?? 0} • Marine: ${alertCounts.data?.marine ?? 0}`,
        updated: alertCounts.data?.fetchedAt ?? null,
        priority: 2,
      },
      {
        id: 'nws-tornado-warning-feed',
        source: 'NWS Tornado Warning Feed',
        headline: `${tornadoWarnings.data?.alerts.length ?? 0} active tornado warnings`,
        summary: tornadoWarnings.data?.error
          ? `Feed issue: ${tornadoWarnings.data.error.kind} (${tornadoWarnings.data.error.message})`
          : 'Event-filtered alert feed focused on tornado warnings.',
        updated: tornadoWarnings.data?.updated ?? null,
        priority: 3,
      },
      {
        id: 'nws-severe-thunderstorm-warning-feed',
        source: 'NWS Severe Thunderstorm Warning Feed',
        headline: `${severeThunderstormWarnings.data?.alerts.length ?? 0} active severe thunderstorm warnings`,
        summary: severeThunderstormWarnings.data?.error
          ? `Feed issue: ${severeThunderstormWarnings.data.error.kind} (${severeThunderstormWarnings.data.error.message})`
          : 'Event-filtered feed for severe thunderstorm warning volume tracking.',
        updated: severeThunderstormWarnings.data?.updated ?? null,
        priority: 4,
      },
      {
        id: 'nws-flash-flood-warning-feed',
        source: 'NWS Flash Flood Warning Feed',
        headline: `${flashFloodWarnings.data?.alerts.length ?? 0} active flash flood warnings`,
        summary: flashFloodWarnings.data?.error
          ? `Feed issue: ${flashFloodWarnings.data.error.kind} (${flashFloodWarnings.data.error.message})`
          : 'Event-filtered feed for flash flood warning monitoring.',
        updated: flashFloodWarnings.data?.updated ?? null,
        priority: 5,
      },
      {
        id: 'spc-reports-live',
        source: 'SPC Reports Feed',
        headline: `${reportsData.length} reports today • ${tornadoCount} tornado`,
        summary: reports.data?.error
          ? `Feed issue: ${reports.data.error.kind} (${reports.data.error.message})`
          : 'Raw tornado/wind/hail reports parsed live from SPC daily report feed.',
        updated: reports.data?.fetchedAt ?? null,
        priority: 6,
      },
      {
        id: 'spc-outlook-live',
        source: 'SPC Outlook Feed',
        headline: `${outlookFeatures} Day 1 outlook features`,
        summary: outlook.data?.error
          ? `Feed issue: ${outlook.data.error.kind} (${outlook.data.error.message})`
          : 'GeoJSON convective outlook polygons are active and map-wired.',
        updated: outlook.data?.fetchedAt ?? null,
        priority: 7,
      },
    ]

    return next.sort((a, b) => a.priority - b.priority)
  }, [
    aiSummary.data,
    severeCount,
    alertItems.length,
    alerts.data,
    alertCounts.data,
    tornadoWarnings.data,
    severeThunderstormWarnings.data,
    flashFloodWarnings.data,
    reportsData.length,
    tornadoCount,
    reports.data,
    outlookFeatures,
    outlook.data,
  ])

  const loading = alerts.isLoading
    || alertCounts.isLoading
    || tornadoWarnings.isLoading
    || severeThunderstormWarnings.isLoading
    || flashFloodWarnings.isLoading
    || reports.isLoading
    || outlook.isLoading
    || aiSummary.isLoading

  const content = (
    <div className="workspace-module-body weather-news-panel">
      <h3>Integrated Live Weather Feed</h3>
      <p className="weather-news-meta">Sources: NWS national + event filters, SPC reports/outlook, LLM ops summary</p>
      <p className="weather-news-meta">Auto refresh: NWS 2m • SPC 3-4m • AI summary 2m</p>
      {loading && <p className="weather-news-meta">Refreshing feeds...</p>}
      <div className="weather-news-live-list">
        {cards.map((card) => (
          <article key={card.id} className="weather-news-live-card">
            <div className="weather-news-live-top">
              <strong>{card.headline}</strong>
              <span className="weather-news-chip">{card.source}</span>
            </div>
            <p>{card.summary}</p>
            <p className="weather-news-meta">Updated: {formatTime(card.updated)}</p>
          </article>
        ))}
      </div>
    </div>
  )

  return embedded ? content : <aside className="operator-rail right-rail">{content}</aside>
}
