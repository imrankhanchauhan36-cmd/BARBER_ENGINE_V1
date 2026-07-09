//////////////////////////////////////////////////////
// ZEMISH — useApprovals Hook
// Saara data logic yahan hai
// UI sirf ye hook use karta hai
//////////////////////////////////////////////////////

import { useCallback, useState } from 'react'

// ─── Admin Level Constants ────────────────────────
export const ADMIN_LEVELS = {
  SUPER_ADMIN:    'SUPER_ADMIN',
  INDIA_ADMIN:    'INDIA_ADMIN',
  STATE_ADMIN:    'STATE_ADMIN',
  DISTRICT_ADMIN: 'DISTRICT_ADMIN',
}

export const canApprove   = (level) => [ADMIN_LEVELS.SUPER_ADMIN, ADMIN_LEVELS.INDIA_ADMIN, ADMIN_LEVELS.STATE_ADMIN].includes(level)
export const canRecommend = (level) => level === ADMIN_LEVELS.DISTRICT_ADMIN
export const canReject    = (level) => Object.values(ADMIN_LEVELS).includes(level)

// ─── Hook ─────────────────────────────────────────
export function useApprovals(initialData = []) {
  const [salons,  setSalons]  = useState(initialData)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState(null)
  const [toast,   setToast]   = useState(null)

  const showToast = useCallback((msg, color = '#059669') => {
    setToast({ msg, color })
    setTimeout(() => setToast(null), 3500)
  }, [])

  // ─── Approve ──────────────────────────────────
  const approve = useCallback(async (id, adminName) => {
    setLoading(true)
    try {
      // Try real API — fall back to local state update
      // await approveSalon(id)

      setSalons(prev => prev.map(s =>
        s.id === id
          ? { ...s, status: 'APPROVED', approvedBy: adminName || 'Admin', approvedAt: new Date().toISOString() }
          : s
      ))
      showToast('✓ Salon Approved Successfully', '#059669')
      return true
    } catch (err) {
      setError(err.message)
      showToast('Failed to approve salon', '#DC2626')
      return false
    } finally {
      setLoading(false)
    }
  }, [showToast])

  // ─── Reject ───────────────────────────────────
  const reject = useCallback(async (id, reason) => {
    if (!reason?.trim()) {
      showToast('⚠ Rejection reason is required', '#D97706')
      return false
    }
    setLoading(true)
    try {
      // await rejectSalon(id, reason)

      setSalons(prev => prev.map(s =>
        s.id === id
          ? { ...s, status: 'REJECTED', rejectionReason: reason }
          : s
      ))
      showToast('✕ Salon Rejected', '#DC2626')
      return true
    } catch (err) {
      setError(err.message)
      showToast('Failed to reject salon', '#DC2626')
      return false
    } finally {
      setLoading(false)
    }
  }, [showToast])

  // ─── Recommend ────────────────────────────────
  const recommend = useCallback(async (id, adminName) => {
    setLoading(true)
    try {
      // await recommendSalon(id)

      setSalons(prev => prev.map(s =>
        s.id === id
          ? { ...s, status: 'RECOMMENDED', recommendedBy: adminName || 'District Admin', recommendedAt: new Date().toISOString() }
          : s
      ))
      showToast('↑ Recommended to State Admin', '#059669')
      return true
    } catch (err) {
      setError(err.message)
      showToast('Failed to recommend salon', '#DC2626')
      return false
    } finally {
      setLoading(false)
    }
  }, [showToast])

  // ─── Verify Document ──────────────────────────
  const verifyDoc = useCallback(async (salonId, docName, status) => {
    setSalons(prev => prev.map(s =>
      s.id === salonId
        ? { ...s, documents: s.documents.map(d => d.name === docName ? { ...d, status } : d) }
        : s
    ))
    showToast(status === 'VERIFIED' ? '✓ Document Verified' : '✕ Document Rejected', status === 'VERIFIED' ? '#059669' : '#DC2626')
  }, [showToast])

  // ─── Counts ───────────────────────────────────
  const counts = {
    ALL:         salons.length,
    PENDING:     salons.filter(s => s.status === 'PENDING').length,
    RECOMMENDED: salons.filter(s => s.status === 'RECOMMENDED').length,
    APPROVED:    salons.filter(s => s.status === 'APPROVED').length,
    REJECTED:    salons.filter(s => s.status === 'REJECTED').length,
  }

  return { salons, setSalons, loading, error, toast, counts, approve, reject, recommend, verifyDoc }
}