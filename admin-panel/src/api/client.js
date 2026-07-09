//////////////////////////////////////////////////////
// BARBER ENGINE V1
// admin-panel/src/api/client.js
// Enterprise API Engine — Central HTTP Client
// 
// Features:
//   ✅ Auto Bearer Token
//   ✅ Auto Refresh on 401
//   ✅ Single-flight refresh queue
//   ✅ Abort Controller
//   ✅ Request ID
//   ✅ Timeout
//   ✅ Standard response parser
//   ✅ File upload support
//   ✅ Global error handler
//////////////////////////////////////////////////////

import ENV from '../config/env'

const BASE_URL = `${ENV.API_URL}/api`
const TIMEOUT  = 30_000 // 30s

// ─── Refresh Queue (single-flight) ───────────────────────
let _isRefreshing  = false
let _refreshQueue  = []

function processQueue(error, token = null) {
  _refreshQueue.forEach(({ resolve, reject }) => {
    if (error) reject(error)
    else resolve(token)
  })
  _refreshQueue = []
}

// ─── Token Refresh ────────────────────────────────────────
async function refreshAccessToken() {
  const res  = await fetch(`${BASE_URL}/admin-auth/refresh`, {
    method:      'POST',
    credentials: 'include',
  })
  const data = await res.json()

  if (!res.ok || !data.data?.accessToken) {
    throw new Error('Session expired')
  }

  // Update store
  const { default: useAuthStore } = await import('../store/authStore')
  useAuthStore.getState().setSession({
    token:       data.data.accessToken,
    admin:       data.data.admin,
    permissions: Array.isArray(data.data.permissions) ? data.data.permissions : [],
    scope: {
      countryRef:  data.data.admin?.countryRef  || null,
      stateRef:    data.data.admin?.stateRef    || null,
      districtRef: data.data.admin?.districtRef || null,
      cityRef:     data.data.admin?.cityRef     || null,
    },
  })

  return data.data.accessToken
}

// ─── Core Request Function ────────────────────────────────
async function request(method, path, options = {}) {
  const {
    body       = null,
    params     = null,
    signal     = null,
    isUpload   = false,
    isDownload = false,
  } = options

  // Get token from store
  const { default: useAuthStore } = await import('../store/authStore')
  const token = useAuthStore.getState().token

  // Build URL
  let url = `${BASE_URL}${path}`
  if (params) {
    const qs = new URLSearchParams(
      Object.fromEntries(
        Object.entries(params).filter(([, v]) => v !== null && v !== undefined && v !== '')
      )
    ).toString()
    if (qs) url += `?${qs}`
  }

  // Build headers
  const headers = {}
  if (token) headers['Authorization'] = `Bearer ${token}`
  if (!isUpload) headers['Content-Type'] = 'application/json'
  headers['X-Request-ID'] = crypto.randomUUID()

  // Abort controller + timeout
  const controller  = new AbortController()
  const timeoutId   = setTimeout(() => controller.abort(), TIMEOUT)
  const fetchSignal = signal
    ? anySignal([signal, controller.signal])
    : controller.signal

  try {
    const res = await fetch(url, {
      method,
      headers,
      credentials: 'include',
      signal:      fetchSignal,
      body: isUpload
        ? body
        : body ? JSON.stringify(body) : null,
    })

    clearTimeout(timeoutId)

    // ── 401 → Refresh & Retry ──────────────────────────
    if (res.status === 401) {
      if (_isRefreshing) {
        return new Promise((resolve, reject) => {
          _refreshQueue.push({ resolve, reject })
        }).then(newToken => request(method, path, { ...options, _retried: true }))
      }

      _isRefreshing = true

      try {
        await refreshAccessToken()
        processQueue(null)
        return request(method, path, { ...options, _retried: true })
      } catch (err) {
        processQueue(err)
        // Force logout
        const store = useAuthStore.getState()
        store.clearSession()
        window.location.href = '/login'
        throw err
      } finally {
        _isRefreshing = false
      }
    }

    // ── Download ───────────────────────────────────────
    if (isDownload) {
      const blob = await res.blob()
      return { success: true, data: blob }
    }

    // ── Parse JSON ────────────────────────────────────
    const data = await res.json()

    if (!res.ok) {
      const err = new Error(data.message || 'Request failed')
      err.status  = res.status
      err.code    = data.code
      err.errors  = data.errors
      err.data    = data
      throw err
    }

    return data

  } catch (err) {
    clearTimeout(timeoutId)

    if (err.name === 'AbortError') {
      const e  = new Error('Request timeout or cancelled')
      e.code   = 'ABORTED'
      throw e
    }

    throw err
  }
}

// ─── anySignal helper ─────────────────────────────────────
function anySignal(signals) {
  const controller = new AbortController()
  signals.forEach(s => {
    if (s.aborted) controller.abort()
    else s.addEventListener('abort', () => controller.abort())
  })
  return controller.signal
}

// ─── Public API ───────────────────────────────────────────

const apiClient = {
  get:    (path, params, opts)  => request('GET',    path, { ...opts, params }),
  post:   (path, body, opts)    => request('POST',   path, { ...opts, body }),
  put:    (path, body, opts)    => request('PUT',    path, { ...opts, body }),
  patch:  (path, body, opts)    => request('PATCH',  path, { ...opts, body }),
  delete: (path, opts)          => request('DELETE', path, { ...opts }),

  upload: (path, formData, opts) =>
    request('POST', path, { ...opts, body: formData, isUpload: true }),

  download: (path, params, opts) =>
    request('GET', path, { ...opts, params, isDownload: true }),
}

export default apiClient