// One small wrapper around fetch. The login token lives in sessionStorage (cleared when the tab closes).
let token = sessionStorage.getItem('token')

export function setToken(t) {
  token = t
  t ? sessionStorage.setItem('token', t) : sessionStorage.removeItem('token')
}

async function req(method, path, body) {
  const res = await fetch('/api' + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (res.status === 401 && path !== '/auth/login') {
    setToken(null)
    window.dispatchEvent(new Event('auth-expired'))
  }
  if (!res.ok) {
    let detail = res.statusText
    try {
      const j = await res.json()
      detail = Array.isArray(j.detail) ? j.detail.map((d) => d.msg).join('; ') : j.detail || detail
    } catch { /* body was not JSON */ }
    throw new Error(detail)
  }
  return res.json()
}

export const api = {
  login: (username, password) => req('POST', '/auth/login', { username, password }),
  startRun: (body) => req('POST', '/runs', body),
  answer: (id, body) => req('POST', `/runs/${id}/answer`, body),
  hosts: () => req('GET', '/hosts'),
  visits: (status) => req('GET', '/visits' + (status ? `?status=${status}` : '')),
  decide: (id, approve) => req('POST', `/visits/${id}/decision`, { approve }),
  autoclose: () => req('POST', '/visits/autoclose'),
  audit: () => req('GET', '/audit'),
  verifyAudit: () => req('GET', '/audit/verify'),
  notifications: () => req('GET', '/notifications'),
}
