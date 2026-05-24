import type { SafeFetchResult } from '../types/weather'

function previewText(value: string): string {
  return value.replace(/\s+/g, ' ').slice(0, 220)
}

export async function fetchJsonSafe<T>(url: string, init?: RequestInit): Promise<SafeFetchResult<T>> {
  try {
    const response = await fetch(url, init)
    const contentType = response.headers.get('content-type') ?? ''
    const text = await response.text()

    if (!response.ok) {
      return {
        error: {
          kind: 'http',
          message: `Request failed: ${response.status}`,
          status: response.status,
          contentType,
          bodyPreview: previewText(text),
        },
      }
    }

    const looksLikeJson = contentType.includes('application/json') || text.trim().startsWith('{') || text.trim().startsWith('[')
    if (!looksLikeJson) {
      return {
        error: {
          kind: 'invalid-content-type',
          message: 'Response is not JSON',
          contentType,
          bodyPreview: previewText(text),
        },
      }
    }

    try {
      const data = JSON.parse(text) as T
      return { data }
    } catch {
      return {
        error: {
          kind: 'invalid-json',
          message: 'Failed to parse JSON response',
          contentType,
          bodyPreview: previewText(text),
        },
      }
    }
  } catch (error) {
    return {
      error: {
        kind: 'network',
        message: error instanceof Error ? error.message : 'Unknown network error',
      },
    }
  }
}

