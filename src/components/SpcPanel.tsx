import { useQuery } from '@tanstack/react-query'
import { fetchSpcDay1Outlook, fetchSpcReports } from '../services/spc'

function formatTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

function shortText(value: string, max = 88): string {
  if (!value) return ''
  return value.length > max ? `${value.slice(0, max)}...` : value
}

export function SpcPanel() {
  const reportsQuery = useQuery({
    queryKey: ['spc-reports'],
    queryFn: fetchSpcReports,
    staleTime: 120_000,
  })
  const outlookQuery = useQuery({
    queryKey: ['spc-day1-outlook'],
    queryFn: fetchSpcDay1Outlook,
    staleTime: 180_000,
  })

  const reports = reportsQuery.data?.reports ?? []
  const byType = reportsQuery.data?.byType
  const recent = reports.slice(0, 8)
  const outlookFeatures = outlookQuery.data?.featureCollection.features.length ?? 0

  return (
    <section className="panel-block">
      <h3>SPC Severe Context</h3>
      <p className="spc-meta-row">Reports source: {reportsQuery.data?.sourceUrl ?? 'Unavailable'}</p>
      <p className="spc-meta-row">Reports updated: {reportsQuery.data ? formatTime(reportsQuery.data.fetchedAt) : 'Pending'}</p>
      <p className="spc-meta-row">Outlook source: {outlookQuery.data?.sourceUrl ?? 'Unavailable'}</p>
      <p className="spc-meta-row">Outlook updated: {outlookQuery.data ? formatTime(outlookQuery.data.fetchedAt) : 'Pending'}</p>

      {reportsQuery.isLoading && <p className="spc-status">Loading SPC reports...</p>}
      {reportsQuery.data?.error && (
        <p className="spc-status spc-error">Reports status: {reportsQuery.data.error.kind} ({reportsQuery.data.error.message})</p>
      )}
      {outlookQuery.isLoading && <p className="spc-status">Loading Day 1 outlook...</p>}
      {outlookQuery.data?.error && (
        <p className="spc-status spc-error">Outlook status: {outlookQuery.data.error.kind} ({outlookQuery.data.error.message})</p>
      )}

      <div className="spc-count-row">
        <span className="spc-count-badge tornado">Tornado: {byType?.tornado ?? 0}</span>
        <span className="spc-count-badge wind">Wind: {byType?.wind ?? 0}</span>
        <span className="spc-count-badge hail">Hail: {byType?.hail ?? 0}</span>
      </div>

      <p className="spc-meta-row">Day 1 outlook features: {outlookFeatures}</p>

      {recent.length === 0 && !reportsQuery.isLoading && !reportsQuery.data?.error && (
        <p className="spc-status">No storm reports found in current SPC feed.</p>
      )}

      {recent.length > 0 && (
        <div className="spc-report-list">
          {recent.map((report) => (
            <div key={report.id} className="spc-report-row">
              <div className="spc-report-top">
                <span className={`spc-type-badge ${report.type}`}>{report.type}</span>
                <span>{report.time}</span>
              </div>
              <p>{report.location}, {report.state}</p>
              <p>Magnitude: {report.magnitude ?? 'N/A'}</p>
              <p className="spc-remarks">{shortText(report.remarks)}</p>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}