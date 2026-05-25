import { WEATHER_NEWS_GROUPS } from '../config/weatherNews'

interface WeatherNewsPanelProps {
  embedded?: boolean
}

export function WeatherNewsPanel({ embedded = false }: WeatherNewsPanelProps) {
  const content = (
    <div className="workspace-module-body weather-news-panel">
      <h3>Weather News & Products</h3>
      {WEATHER_NEWS_GROUPS.map((group) => (
        <section key={group.id} className="weather-news-group">
          <h4>{group.title}</h4>
          {group.items.length === 0 && <p>No sources configured.</p>}
          {group.items.map((item) => (
            <a key={item.id} href={item.url} target="_blank" rel="noreferrer" className="weather-news-link-row">
              <span>{item.label}</span>
              <span className="weather-news-link-meta">
                <span className="weather-news-chip">{item.sourceType}</span>
                {item.region && <span className="weather-news-chip">{item.region}</span>}
              </span>
            </a>
          ))}
        </section>
      ))}
    </div>
  )

  return embedded ? content : <aside className="operator-rail right-rail">{content}</aside>
}
