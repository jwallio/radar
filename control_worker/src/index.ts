interface WorkerEnv extends Env {
  POLLING_CONTROL_TOKEN?: string
  ADMIN_SERVICE_TOKEN?: string
}

interface PollingState {
  enabled: boolean
  updated_at: string | null
}

interface FocusPollingState extends PollingState {
  expires_at: string | null
  region_id: string | null
  region_label: string | null
  bounds: [number, number, number, number] | null
}

type JsonObject = Record<string, unknown>

const DEFAULT_STATE: PollingState = { enabled: false, updated_at: null }
const DEFAULT_FOCUS_STATE: FocusPollingState = {
  enabled: false,
  updated_at: null,
  expires_at: null,
  region_id: null,
  region_label: null,
  bounds: null,
}
const CONUS_BOUNDS = [-130, 20, -60, 55] as const
const FOCUS_MAX_LONGITUDE_SPAN = 25
const FOCUS_MAX_LATITUDE_SPAN = 20
const FOCUS_MAX_HOURS = 24

function allowedOrigin(request: Request, env: WorkerEnv): string | null {
  const origin = request.headers.get('Origin')
  const configured = env.ALLOWED_ORIGIN?.trim() || 'https://radar.wall.cloud'
  if (!origin || origin === configured) return origin ? configured : null
  return null
}

function corsHeaders(request: Request, env: WorkerEnv): Headers {
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

function jsonResponse(request: Request, env: WorkerEnv, body: unknown, status = 200): Response {
  const headers = corsHeaders(request, env)
  headers.set('Content-Type', 'application/json; charset=utf-8')
  return new Response(JSON.stringify(body), { status, headers })
}

function controlObjectKey(env: WorkerEnv): string {
  return env.CONTROL_OBJECT_KEY?.trim() || 'control/polling.json'
}

function focusObjectKey(env: WorkerEnv): string {
  return env.FOCUS_CONTROL_OBJECT_KEY?.trim() || 'control/focus.json'
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function optionalTimestamp(value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${field} must be an ISO-8601 timestamp`)
  }
  return value
}

function parseBounds(value: unknown): [number, number, number, number] {
  if (!Array.isArray(value) || value.length !== 4) {
    throw new Error('bounds must be [west, south, east, north]')
  }
  const bounds = value.map(Number)
  if (!bounds.every(Number.isFinite)) throw new Error('bounds values must be numeric')
  const [west, south, east, north] = bounds
  if (west >= east || south >= north) throw new Error('bounds have an invalid geographic order')
  if (
    west < CONUS_BOUNDS[0]
    || south < CONUS_BOUNDS[1]
    || east > CONUS_BOUNDS[2]
    || north > CONUS_BOUNDS[3]
  ) {
    throw new Error('bounds must remain inside the CONUS processing domain')
  }
  if (east - west > FOCUS_MAX_LONGITUDE_SPAN || north - south > FOCUS_MAX_LATITUDE_SPAN) {
    throw new Error(
      `Storm focus is limited to ${FOCUS_MAX_LONGITUDE_SPAN}° longitude by ${FOCUS_MAX_LATITUDE_SPAN}° latitude`,
    )
  }
  return [west, south, east, north]
}

function normalizeRegionId(value: unknown): string {
  const regionId = String(value ?? 'focus')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(regionId)) throw new Error('region_id is invalid')
  return regionId
}

function normalizeRegionLabel(value: unknown, regionId: string): string {
  const fallback = regionId.split('-').map((part) => part ? `${part[0].toUpperCase()}${part.slice(1)}` : '').join(' ')
  const regionLabel = String(value ?? fallback).trim().replace(/\s+/g, ' ')
  if (!regionLabel || regionLabel.length > 64) throw new Error('region_label must contain 1 to 64 characters')
  return regionLabel
}

function focusStateFromRequest(payload: JsonObject): FocusPollingState {
  if (typeof payload.enabled !== 'boolean') throw new Error('enabled must be a boolean')
  const updatedAt = new Date().toISOString()
  if (!payload.enabled) return { ...DEFAULT_FOCUS_STATE, updated_at: updatedAt }
  const bounds = parseBounds(payload.bounds)
  const regionId = normalizeRegionId(payload.region_id)
  const regionLabel = normalizeRegionLabel(payload.region_label, regionId)
  const durationHours = payload.duration_hours === undefined ? 12 : Number(payload.duration_hours)
  if (!Number.isInteger(durationHours) || durationHours < 1 || durationHours > FOCUS_MAX_HOURS) {
    throw new Error(`duration_hours must be between 1 and ${FOCUS_MAX_HOURS}`)
  }
  return {
    enabled: true,
    updated_at: updatedAt,
    expires_at: new Date(Date.now() + durationHours * 60 * 60 * 1000).toISOString(),
    region_id: regionId,
    region_label: regionLabel,
    bounds,
  }
}

function parseStoredFocusState(value: unknown): FocusPollingState {
  if (!isJsonObject(value) || typeof value.enabled !== 'boolean') {
    throw new Error('Stored focus polling state is invalid')
  }
  const updatedAt = optionalTimestamp(value.updated_at, 'updated_at')
  if (!value.enabled) return { ...DEFAULT_FOCUS_STATE, updated_at: updatedAt }
  const bounds = parseBounds(value.bounds)
  const regionId = normalizeRegionId(value.region_id)
  const regionLabel = normalizeRegionLabel(value.region_label, regionId)
  const expiresAt = optionalTimestamp(value.expires_at, 'expires_at')
  if (!expiresAt) throw new Error('Stored focus polling state has no expiration')
  return {
    enabled: Date.parse(expiresAt) > Date.now(),
    updated_at: updatedAt,
    expires_at: expiresAt,
    region_id: regionId,
    region_label: regionLabel,
    bounds,
  }
}

async function readState(env: WorkerEnv): Promise<PollingState> {
  const object = await env.CONTROL_BUCKET.get(controlObjectKey(env))
  if (!object) return DEFAULT_STATE
  const parsed = await object.json<unknown>()
  if (!isJsonObject(parsed) || typeof parsed.enabled !== 'boolean') {
    throw new Error('Stored polling state is invalid')
  }
  return {
    enabled: parsed.enabled,
    updated_at: optionalTimestamp(parsed.updated_at, 'updated_at'),
  }
}

async function readFocusState(env: WorkerEnv): Promise<FocusPollingState> {
  const object = await env.CONTROL_BUCKET.get(focusObjectKey(env))
  if (!object) return DEFAULT_FOCUS_STATE
  return parseStoredFocusState(await object.json<unknown>())
}

async function constantTimeEqual(provided: string, expected: string): Promise<boolean> {
  const encoder = new TextEncoder()
  const [providedHash, expectedHash] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(provided)),
    crypto.subtle.digest('SHA-256', encoder.encode(expected)),
  ])
  return crypto.subtle.timingSafeEqual(providedHash, expectedHash)
}

async function hasValidToken(request: Request, env: WorkerEnv): Promise<boolean> {
  const expected = env.POLLING_CONTROL_TOKEN?.trim()
  if (!expected) return false
  const authorization = request.headers.get('Authorization') || ''
  return constantTimeEqual(authorization, `Bearer ${expected}`)
}

async function proxyAdmin(
  env: WorkerEnv,
  path: string,
  method: string,
  body?: JsonObject,
): Promise<{ status: number; body: unknown }> {
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
  try { parsed = JSON.parse(text) } catch { /* preserve the bounded text fallback */ }
  return { status: response.status, body: parsed }
}

async function parseRequestBody(request: Request): Promise<JsonObject> {
  const payload = await request.json<unknown>()
  if (!isJsonObject(payload)) throw new Error('Request body must be a JSON object')
  return payload
}

async function handleRequest(request: Request, env: WorkerEnv): Promise<Response> {
  const url = new URL(request.url)
  const isHistoryCollection = url.pathname === '/history/jobs'
  const isHistoryItem = url.pathname.startsWith('/history/jobs/')
  const knownPath = [
    '/control/status',
    '/control/polling',
    '/focus/status',
    '/focus/polling',
  ].includes(url.pathname) || isHistoryCollection || isHistoryItem
  if (!knownPath) return jsonResponse(request, env, { error: 'Not found' }, 404)

  if (request.method === 'OPTIONS') {
    if (request.headers.get('Origin') && !allowedOrigin(request, env)) {
      return jsonResponse(request, env, { error: 'Origin not allowed' }, 403)
    }
    return new Response(null, { status: 204, headers: corsHeaders(request, env) })
  }
  if (request.method === 'GET' && url.pathname === '/control/status') {
    return jsonResponse(request, env, await readState(env))
  }
  if (request.method === 'GET' && url.pathname === '/focus/status') {
    return jsonResponse(request, env, await readFocusState(env))
  }
  if (request.method === 'GET' && isHistoryItem) {
    const proxied = await proxyAdmin(env, url.pathname, 'GET')
    return jsonResponse(request, env, proxied.body, proxied.status)
  }

  const isMutation = request.method === 'POST'
    && (url.pathname === '/control/polling' || url.pathname === '/focus/polling' || isHistoryCollection)
  if (!isMutation) return jsonResponse(request, env, { error: 'Method not allowed' }, 405)
  if (request.headers.get('Origin') && !allowedOrigin(request, env)) {
    return jsonResponse(request, env, { error: 'Origin not allowed' }, 403)
  }
  if (!await hasValidToken(request, env)) return jsonResponse(request, env, { error: 'Unauthorized' }, 401)

  let payload: JsonObject
  try {
    payload = await parseRequestBody(request)
  } catch (error) {
    return jsonResponse(
      request,
      env,
      { error: error instanceof Error ? error.message : 'Request body must be JSON' },
      400,
    )
  }
  if (isHistoryCollection) {
    const proxied = await proxyAdmin(env, '/history/jobs', 'POST', payload)
    return jsonResponse(request, env, proxied.body, proxied.status)
  }
  if (url.pathname === '/focus/polling') {
    let state: FocusPollingState
    try {
      state = focusStateFromRequest(payload)
    } catch (error) {
      return jsonResponse(request, env, { error: error instanceof Error ? error.message : 'Invalid focus state' }, 400)
    }
    if (env.ADMIN_SERVICE_URL?.trim()) {
      const proxied = await proxyAdmin(env, '/control/focus', 'POST', payload)
      return jsonResponse(request, env, proxied.body, proxied.status)
    }
    await env.CONTROL_BUCKET.put(focusObjectKey(env), JSON.stringify(state), {
      httpMetadata: { contentType: 'application/json', cacheControl: 'no-store, max-age=0' },
    })
    return jsonResponse(request, env, state)
  }

  if (typeof payload.enabled !== 'boolean') {
    return jsonResponse(request, env, { error: 'enabled must be a boolean' }, 400)
  }
  if (env.ADMIN_SERVICE_URL?.trim()) {
    const proxied = await proxyAdmin(env, '/control/live', 'POST', payload)
    return jsonResponse(request, env, proxied.body, proxied.status)
  }
  const state: PollingState = { enabled: payload.enabled, updated_at: new Date().toISOString() }
  await env.CONTROL_BUCKET.put(controlObjectKey(env), JSON.stringify(state), {
    httpMetadata: { contentType: 'application/json', cacheControl: 'no-store, max-age=0' },
  })
  return jsonResponse(request, env, state)
}

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    try {
      return await handleRequest(request, env)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      console.error(JSON.stringify({ message: 'control request failed', error: message, path: new URL(request.url).pathname }))
      return jsonResponse(request, env, { error: 'Control service unavailable' }, 503)
    }
  },
} satisfies ExportedHandler<WorkerEnv>
