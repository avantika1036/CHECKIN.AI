import test from 'node:test'
import assert from 'node:assert/strict'

const storage = new Map()
globalThis.sessionStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key),
}

const events = []
globalThis.window = {
  dispatchEvent: (event) => events.push(event.type),
  Event,
}

const { api, setToken } = await import('./api.js')

test('login sends credentials without an authorization header', async () => {
  const calls = []
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options })
    return new Response(JSON.stringify({ token: 'token-1' }), { status: 200 })
  }

  const result = await api.login('guard_uiet', 'secret')
  assert.deepEqual(result, { token: 'token-1' })
  assert.equal(calls[0].url, '/api/auth/login')
  assert.equal(calls[0].options.headers.Authorization, undefined)
  assert.deepEqual(JSON.parse(calls[0].options.body), { username: 'guard_uiet', password: 'secret' })
})

test('successful requests send the current bearer token', async () => {
  setToken('token-2')
  let request
  globalThis.fetch = async (url, options) => {
    request = { url, options }
    return new Response('[]', { status: 200 })
  }

  assert.deepEqual(await api.visits(), [])
  assert.equal(request.options.headers.Authorization, 'Bearer token-2')
})

test('401 responses clear the token and notify the application', async () => {
  setToken('expired-token')
  events.length = 0
  globalThis.fetch = async () => new Response(JSON.stringify({ detail: 'expired' }), { status: 401 })

  await assert.rejects(() => api.visits(), /expired/)
  assert.equal(storage.get('token'), undefined)
  assert.deepEqual(events, ['auth-expired'])
})

test('validation errors expose all Pydantic messages', async () => {
  setToken(null)
  globalThis.fetch = async () => new Response(
    JSON.stringify({ detail: [{ msg: 'name required' }, { msg: 'purpose required' }] }),
    { status: 422 },
  )

  await assert.rejects(() => api.startRun({}), /name required; purpose required/)
})
