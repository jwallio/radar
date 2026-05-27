import { useEffect, useRef } from 'react'
import type { WeatherAlert } from '../types/weather'

const SEVERE_EVENTS = ['tornado warning', 'severe thunderstorm warning', 'flash flood warning', 'extreme wind warning']

function isSignificantAlert(alert: WeatherAlert): boolean {
  const event = alert.event.toLowerCase()
  return (
    SEVERE_EVENTS.some((e) => event.includes(e)) ||
    alert.severity === 'Extreme'
  )
}

function playAlertBeep() {
  try {
    const ctx = new AudioContext()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()

    osc.type = 'square'
    osc.frequency.setValueAtTime(880, ctx.currentTime)
    osc.frequency.setValueAtTime(1100, ctx.currentTime + 0.08)

    gain.gain.setValueAtTime(0.15, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3)

    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start(ctx.currentTime)
    osc.stop(ctx.currentTime + 0.3)
  } catch {
    // Audio not available — silently skip
  }
}

function sendBrowserNotification(title: string, body: string) {
  try {
    if (!('Notification' in window) || Notification.permission !== 'granted') return
    new Notification(title, { body, icon: '/vite.svg', tag: 'nws-alert' })
  } catch {
    // Notification not available
  }
}

interface UseAlertNotificationsParams {
  alerts: WeatherAlert[]
  alertsEnabled: boolean
}

export function useAlertNotifications({ alerts, alertsEnabled }: UseAlertNotificationsParams) {
  const notifiedIds = useRef<Set<string>>(new Set())
  const permissionRequested = useRef(false)

  // Request notification permission on first mount
  useEffect(() => {
    if (permissionRequested.current) return
    permissionRequested.current = true

    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => undefined)
    }
  }, [])

  // Watch for new significant alerts
  useEffect(() => {
    if (!alertsEnabled || alerts.length === 0) return

    const significant = alerts.filter(isSignificantAlert)

    for (const alert of significant) {
      if (notifiedIds.current.has(alert.id)) continue
      notifiedIds.current.add(alert.id)

      // Play audio beep
      playAlertBeep()

      // Send browser notification
      const title = `${alert.event} — ${alert.severity}`
      const body = alert.areaDesc
      sendBrowserNotification(title, body)
    }
  }, [alerts, alertsEnabled])

  // Prune notified set to keep it from growing unbounded
  useEffect(() => {
    if (alerts.length === 0 && notifiedIds.current.size > 0) {
      notifiedIds.current = new Set()
    }
  }, [alerts])
}