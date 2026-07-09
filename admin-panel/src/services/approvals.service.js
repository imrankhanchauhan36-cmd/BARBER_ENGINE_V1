//////////////////////////////////////////////////////
// ZEMISH — Approvals Service
// Saari API calls yahan hain
// Abhi dummy data — backend connect karne par
// sirf yahi file change karni hogi
//////////////////////////////////////////////////////

import ENV from '../config/env'

const BASE = `${ENV.API_URL}/api/admin`

const getHeaders = () => {
  const token = localStorage.getItem('admin_token')
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
  }
}

// ─── GET: Approval Queue ───────────────────────────
export const fetchApprovals = async ({ status = 'ALL', page = 1, limit = 20, search = '' } = {}) => {
  // TODO: Uncomment when backend ready
  // const params = new URLSearchParams({ page, limit, ...(status !== 'ALL' && { status }), ...(search && { search }) })
  // const res = await fetch(`${BASE}/salons?${params}`, { headers: getHeaders() })
  // return res.json()

  // DUMMY — remove when backend ready
  return { success: true, data: [], total: 0 }
}

// ─── GET: Single Salon Detail ─────────────────────
export const fetchApprovalById = async (id) => {
  // TODO: Uncomment when backend ready
  // const res = await fetch(`${BASE}/salons/${id}`, { headers: getHeaders() })
  // return res.json()

  // DUMMY — remove when backend ready
  return { success: true, data: null }
}

// ─── PATCH: Approve Salon ─────────────────────────
export const approveSalon = async (id) => {
  const res = await fetch(`${BASE}/salons/${id}/status`, {
    method:  'PATCH',
    headers: getHeaders(),
    body:    JSON.stringify({ status: 'APPROVED' }),
  })
  return res.json()
}

// ─── PATCH: Reject Salon ──────────────────────────
export const rejectSalon = async (id, rejectionReason) => {
  const res = await fetch(`${BASE}/salons/${id}/status`, {
    method:  'PATCH',
    headers: getHeaders(),
    body:    JSON.stringify({ status: 'REJECTED', rejectionReason }),
  })
  return res.json()
}

// ─── PATCH: Recommend Salon ───────────────────────
export const recommendSalon = async (id) => {
  // TODO: Add backend route when ready
  // const res = await fetch(`${BASE}/salons/${id}/recommend`, {
  //   method: 'PATCH', headers: getHeaders(),
  // })
  // return res.json()

  return { success: true }
}

// ─── PATCH: Verify Document ───────────────────────
export const verifyDocument = async (salonId, docType, status) => {
  // TODO: Add backend route when ready
  return { success: true }
}