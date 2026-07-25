interface Env {
  CONTROL_BUCKET: R2Bucket
  POLLING_CONTROL_TOKEN?: string
  ALLOWED_ORIGIN?: string
  CONTROL_OBJECT_KEY?: string
  ADMIN_SERVICE_URL?: string
  ADMIN_SERVICE_TOKEN?: string
}

interface PollingState {
  enabled: boolean
  updated_at: string | null
}

const DEFAULT_STATE: PollingState = { enabled: false, updated_at: null }

function allowedOrigin(request: Request, env: Env): string | null {
  const origin = request.headers.get('Origin')
  const configured = env.ALLOWED_ORIGIN?.trim() || 'https://radar.wall.cloud'
  if (!origin || origin === configured) return origin ? configured : null
  return null
}

function corsHeaders(request: Request, env: Env): Headers {
  const headers = new Headers({
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Max-Age': '600',
    'Cache-Control': 'no-store',
    Vary: 'Origin',
  })
  const origin = allowedOrigin(request, env)
  if (origin) headers.set('Access-Control-Allow-Origin', origin)
  return headers
}

function jsonResponse(request: Request, env: Env, body: unknown, status = 200): Response {
  const headers = corsHeaders(request, env)
  headers.set('Content-Type', 'application/json; charset=utf-8')
  return new Response(JSON.stringify(body), { status, headers })
}

function objectKey(env: Env): string {
  return env.CONTROL_OBJECT_KEY?.trim() || 'control/polling.json'
}

async function readState(env: Env): Promise<PollingState> {
  const object = await env.CONTROL_BUCKET.get(objectKey(env))
  if (!object) return DEFAULT_STATE
  try {
    const parsed = await object.json<Partial<PollingState>>()
    if (typeof parsed.enabled !== 'boolean') throw new Error('enabled must be boolean')
    return {
      enabled: parsed.enabled,
      updated_at: typeof parsed.updated_at === 'string' ? parsed.updated_at : null,
    }
  } catch {
    throw new Error('Stored polling state is invalid')
  }
}

function hasValidToken(request: Request, env: Env): boolean {
  const expected = env.POLLING_CONTROL_TOKEN?.trim()
  if (!expected) return false
  const authorization = request.headers.get('Authorization') || ''
  return authorization === `Bearer ${expected}`
}

async function proxyAdmin(env: Env, path: string, method: string, body?: unknown): Promise<{ status: number; body: unknown }> {
  const baseUrl = env.ADMIN_SERVICE_URL?.trim().replace(/\/+$/, '')
  const token = env.ADMIN_SERVICE_TOKEN?.trim()
  if (!baseUrl || !token) return { status: 503, body: { error: 'Admin service is not configured' } }
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await response.text()
  let parsed: unknown = { error: text || `Admin service returned HTTP ${response.status}` }
  try { parsed = JSON.parse(text) } catch { /* preserve the text fallback */ }
  return { status: response.status, body: parsed }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const isHistoryCollection = url.pathname === '/history/jobs'
    const isHistoryItem = url.pathname.startsWith('/history/jobs/')
    if (url.pathname !== '/control/status' && url.pathname !== '/control/polling' && !isHistoryCollection && !isHistoryItem) {
      return jsonResponse(request, env, { error: 'Not found' }, 404)
    }
    if (request.method === 'OPTIONS') {
      if (request.headers.get('Origin') && !allowedOrigin(request, env)) return jsonResponse(request, env, { error: 'Origin not allowed' }, 403)
      return new Response(null, { status: 204, headers: corsHeaders(request, env) })
    }
    if (request.method === 'GET' && url.pathname === '/control/status') {
      try {
        return jsonResponse(request, env, await readState(env))
      } catch (error) {
        return jsonResponse(request, env, { error: error instanceof Error ? error.message : 'Control state unavailable' }, 503)
      }
    }
    if (request.method === 'GET' && isHistoryItem) {
      if (!hasValidToken(request, env)) return jsonResponse(request, env, { error: 'Unauthorized' }, 401)
      const proxied = await proxyAdmin(env, url.pathname, 'GET')
      return jsonResponse(request, env, proxied.body, proxied.status)
    }
    if (request.method !== 'POST' || (url.pathname !== '/control/polling' && !isHistoryCollection)) {
      return jsonResponse(request, env, { error: 'Method not allowed' }, 405)
    }
    if (request.headers.get('Origin') && !allowedOrigin(request, env)) return jsonResponse(request, env, { error: 'Origin not allowed' }, 403)
    if (!hasValidToken(request, env)) return jsonResponse(request, env, { error: 'Unauthorized' }, 401)
    let payload: { enabled?: unknown }
    try {
      payload = await request.json<{ enabled?: unknown }>()
    } catch {
      return jsonResponse(request, env, { error: 'Request body must be JSON' }, 400)
    }
    if (isHistoryCollection) {
      const proxied = await proxyAdmin(env, '/history/jobs', 'POST', payload)
      return jsonResponse(request, env, proxied.body, proxied.status)
    }
    if (typeof payload.enabled !== 'boolean') return jsonResponse(request, env, { error: 'enabled must be a boolean' }, 400)
    if (env.ADMIN_SERVICE_URL?.trim()) {
      const proxied = await proxyAdmin(env, '/control/live', 'POST', payload)
      return jsonResponse(request, env, proxied.body, proxied.status)
    }
    const state: PollingState = { enabled: payload.enabled, updated_at: new Date().toISOString() }
    await env.CONTROL_BUCKET.put(objectKey(env), JSON.stringify(state), {
      httpMetadata: { contentType: 'application/json', cacheControl: 'no-store, max-age=0' },
    })
    return jsonResponse(request, env, state)
  },
}
