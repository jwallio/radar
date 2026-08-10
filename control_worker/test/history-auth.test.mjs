import assert from 'node:assert/strict'
import test from 'node:test'

import worker from '../src/index.ts'

const WORKER_URL = 'https://control.example.test'
const ALLOWED_ORIGIN = 'https://radar.wall.cloud'
const ADMIN_SERVICE_URL = 'https://admin.example.test'
const ADMIN_SERVICE_TOKEN = 'internal-service-token'
const originalFetch = globalThis.fetch

function workerEnv() {
  return {
    ALLOWED_ORIGIN,
    ADMIN_SERVICE_URL,
    ADMIN_SERVICE_TOKEN,
  }
}

function historyRequest(source, bounds) {
  return new Request(`${WORKER_URL}/history/jobs`, {
    method: 'POST',
    headers: { Origin: ALLOWED_ORIGIN, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      source,
      start: '2026-07-28T16:00:00Z',
      end: '2026-07-28T17:00:00Z',
      max_frames: 2,
      ...(bounds ? { bounds } : {}),
    }),
  })
}

function mockAdminFetch(calls) {
  globalThis.fetch = async (input, init) => {
    calls.push({
      url: String(input),
      authorization: new Headers(init?.headers).get('Authorization'),
      body: init?.body ? JSON.parse(String(init.body)) : null,
    })
    return Response.json({ job_id: 'job-1', status: 'queued' }, { status: 202 })
  }
}

test.after(() => {
  globalThis.fetch = originalFetch
})

test('public history authorization boundary', async (t) => {
  await t.test('MRMS starts without a visitor key and uses the internal service token', async () => {
    const calls = []
    mockAdminFetch(calls)

    const response = await worker.fetch(historyRequest('mrms', [-100, 20, -60, 52]), workerEnv())

    assert.equal(response.status, 202)
    assert.equal(calls.length, 1)
    assert.equal(calls[0].url, `${ADMIN_SERVICE_URL}/history/jobs`)
    assert.equal(calls[0].authorization, `Bearer ${ADMIN_SERVICE_TOKEN}`)
    assert.equal(calls[0].body.source, 'mrms')
  })

  await t.test('ERA5 Atlantic and Caribbean bounds start without a visitor key', async () => {
    const calls = []
    mockAdminFetch(calls)

    const bounds = [-100, 12, -55, 52]
    const response = await worker.fetch(historyRequest('era5', bounds), workerEnv())

    assert.equal(response.status, 202)
    assert.equal(calls.length, 1)
    assert.deepEqual(calls[0].body.bounds, bounds)
  })

  await t.test('ERA5 still rejects bounds outside its processing domain', async () => {
    const calls = []
    mockAdminFetch(calls)

    const response = await worker.fetch(historyRequest('era5', [-100, 9, -55, 52]), workerEnv())

    assert.equal(response.status, 400)
    assert.match((await response.json()).error, /ERA5 processing domain/)
    assert.equal(calls.length, 0)
  })

  await t.test('KRAX still requires the owner key', async () => {
    const calls = []
    mockAdminFetch(calls)

    const response = await worker.fetch(historyRequest('krax'), workerEnv())

    assert.equal(response.status, 401)
    assert.equal(calls.length, 0)
  })

  await t.test('live polling changes still require the owner key', async () => {
    const calls = []
    mockAdminFetch(calls)
    const request = new Request(`${WORKER_URL}/control/polling`, {
      method: 'POST',
      headers: { Origin: ALLOWED_ORIGIN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    })

    const response = await worker.fetch(request, workerEnv())

    assert.equal(response.status, 401)
    assert.equal(calls.length, 0)
  })
})
