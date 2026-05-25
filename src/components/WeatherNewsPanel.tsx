import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchNwsAlerts } from '../services/nws'
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
        id: 'spc-reports-live',
        source: 'SPC Reports Feed',
        headline: `${reportsData.length} reports today • ${tornadoCount} tornado`,
        summary: reports.data?.error
          ? `Feed issue: ${reports.data.error.kind} (${reports.data.error.message})`
          : 'Raw tornado/wind/hail reports parsed live from SPC daily report feed.',
        updated: reports.data?.fetchedAt ?? null,
        priority: 2,
      },
      {
        id: 'spc-outlook-live',
        source: 'SPC Outlook Feed',
        headline: `${outlookFeatures} Day 1 outlook features`,
        summary: outlook.data?.error
          ? `Feed issue: ${outlook.data.error.kind} (${outlook.data.error.message})`
          : 'GeoJSON convective outlook polygons are active and map-wired.',
        updated: outlook.data?.fetchedAt ?? null,
        priority: 3,
      },
    ]

    return next.sort((a, b) => a.priority - b.priority)
  }, [aiSummary.data, alertItems.length, severeCount, reportsData.length, tornadoCount, outlookFeatures, alerts.data, reports.data, outlook.data])

  const loading = alerts.isLoading || reports.isLoading || outlook.isLoading || aiSummary.isLoading

  const content = (
    <div className="workspace-module-body weather-news-panel">
      <h3>Integrated Live Weather Feed</h3>
      <p className="weather-news-meta">Auto refresh: Alerts 2m • SPC reports 3m • Outlook 4m</p>
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
