import { useEffect } from 'react'
import maplibregl from 'maplibre-gl'
import { MAP_LAYER_IDS } from '../config/mapLayerIds'

const ids = MAP_LAYER_IDS

interface UseMapInteractionsParams {
  mapRef: React.MutableRefObject<maplibregl.Map | null>
  alertsEnabled: boolean
  selectAlert: (id: string) => void
  requestZoomToAlert: (id: string) => void
  onHoveredAlertChange: (id: string | null) => void
}

export function useMapInteractions({ mapRef, alertsEnabled, selectAlert, requestZoomToAlert, onHoveredAlertChange }: UseMapInteractionsParams) {
  useEffect(() => {
    const map = mapRef.current
    if (!map || !alertsEnabled) return

    const onMove = (e: maplibregl.MapMouseEvent) => {
      const layers = [ids.alertsPulse, ids.alertsLine, ids.alertsFill].filter((id) => !!map.getLayer(id))
      if (!layers.length) return
      const f = map.queryRenderedFeatures(e.point, { layers })
      const id = (f[0]?.properties?.id as string | undefined) ?? null
      onHoveredAlertChange(id)
      map.getCanvas().style.cursor = id ? 'pointer' : ''
    }

    const onClick = (e: maplibregl.MapMouseEvent) => {
      const layers = [ids.alertsPulse, ids.alertsLine, ids.alertsFill].filter((id) => !!map.getLayer(id))
      if (!layers.length) return
      const f = map.queryRenderedFeatures(e.point, { layers })
      const id = (f[0]?.properties?.id as string | undefined) ?? null
      if (!id) return
      selectAlert(id)
      requestZoomToAlert(id)
    }

    const onOut = () => {
      onHoveredAlertChange(null)
      map.getCanvas().style.cursor = ''
    }

    map.on('mousemove', onMove)
    map.on('click', onClick)
    map.on('mouseout', onOut)

    return () => {
      map.off('mousemove', onMove)
      map.off('click', onClick)
      map.off('mouseout', onOut)
    }
  }, [alertsEnabled, selectAlert, requestZoomToAlert, onHoveredAlertChange])
}