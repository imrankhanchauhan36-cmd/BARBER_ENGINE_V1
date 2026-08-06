//////////////////////////////////////////////////////
// BARBER ENGINE V1
// admin-panel/src/pages/finance/payouts/PayoutsPage.jsx
// Real API — verified against backend controllers + new detail endpoint
//////////////////////////////////////////////////////

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { canApprovePayout, canExport, canRejectPayout, canViewPayouts } from '../../../config/adminRoles'
import { FONTS } from '../../../config/brand'
import useAuthStore from '../../../store/authStore'
import FinanceAPI from '../api/finance.api'

// Real, shared permission helpers (see adminRoles.js) replacing this file's
// previous local ADMIN_LEVELS scheme (SUPER_ADMIN/INDIA_ADMIN/STATE_ADMIN/
// DISTRICT_ADMIN), which never matched real admin.adminLevel values
// (INDIA/STATE/DISTRICT) — canView() always evaluated false, so every real
// admin saw "Access Denied" on this page regardless of actual permission.
const canView    = canViewPayouts
const canApprove = canApprovePayout
const canReject  = canRejectPayout

const p2r = (v) => ((v ?? 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
const fmt = (v) => '₹' + p2r(v)

const STATUS_COLORS = {
  REQUESTED:  { bg:'#FEF9C3', color:'#92400E', border:'#D97706' },
  PROCESSING: { bg:'#EDE9FE', color:'#5B21B6', border:'#7C3AED' },
  PAID:       { bg:'#D1FAE5', color:'#065F46', border:'#059669' },
  FAILED:     { bg:'#FEE2E2', color:'#991B1B', border:'#DC2626' },
  REJECTED:   { bg:'#FEE2E2', color:'#991B1B', border:'#DC2626' },
  CANCELLED:  { bg:'#F3F4F6', color:'#374151', border:'#9CA3AF' },
}
const STATUS_ICONS = { REQUESTED:'🕐', PROCESSING:'⚙️', PAID:'💚', FAILED:'⚠️', REJECTED:'❌', CANCELLED:'✕' }

const KYC_STATUS_COLORS = {
  APPROVED: '#059669', PENDING: '#D97706', REJECTED: '#DC2626', DRAFT: '#9E8E6E',
}

const STATUSES = ['ALL','REQUESTED','PROCESSING','PAID','REJECTED','FAILED','CANCELLED']
const DATES    = ['All Time','Today','Last 7 Days','Last 30 Days']
const PER_PAGE = 20

function getPaginationRange(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const pages = new Set([1, 2, total-1, total, current-1, current, current+1])
  const valid = [...pages].filter(p => p >= 1 && p <= total).sort((a,b) => a-b)
  const result = []
  let prev = null
  for (const p of valid) {
    if (prev !== null && p - prev > 1) result.push('...')
    result.push(p)
    prev = p
  }
  return result
}

function downloadCsv(rows, filename) {
  if (!rows.length) return
  const headers = ['Payout ID','Salon','Owner','Phone','City','Amount','Status','UTR','Provider','Admin Note','Requested At','Approved At']
  const escape = (v) => {
    const s = String(v ?? '')
    return /[",\n]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s
  }
  const lines = [headers.join(',')]
  rows.forEach(p => {
    lines.push([
      p.id, p.salon?.name || '', p.owner?.name || '', p.owner?.phone || '', p.salon?.city || '',
      ((p.amountInPaise ?? 0)/100).toFixed(2), p.status, p.utr || '', p.provider || 'MANUAL',
      p.adminNote || '',
      p.createdAt ? new Date(p.createdAt).toLocaleString('en-IN') : '',
      p.approvedAt ? new Date(p.approvedAt).toLocaleString('en-IN') : '',
    ].map(escape).join(','))
  })
  const blob = new Blob([lines.join('\n')], { type:'text/csv;charset=utf-8;' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href = url; a.download = filename
  document.body.appendChild(a); a.click(); document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

const BCard = ({ children, style={} }) => (
  <div style={{ background:'#fff', border:'1px solid #D4C9B0', borderTop:'2px solid #B8960C', ...style }}>{children}</div>
)
const BCardHeader = ({ title, action }) => (
  <div style={{ padding:'10px 14px', borderBottom:'1px solid #E8DFD0', display:'flex', justifyContent:'space-between', alignItems:'center', background:'#FDFAF6' }}>
    <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
      <div style={{ width:'3px', height:'14px', background:'#B8960C' }}/>
      <span style={{ fontSize:'12px', fontWeight:700, color:'#1A1A2E', letterSpacing:'0.5px', textTransform:'uppercase' }}>{title}</span>
    </div>
    {action}
  </div>
)
const Row = ({ label, value, mono=false, color='#1A1A2E' }) => (
  <div style={{ display:'flex', justifyContent:'space-between', padding:'8px 0', borderBottom:'1px solid #E8DFD0' }}>
    <span style={{ fontSize:'11px', color:'#9E8E6E', fontWeight:700 }}>{label}</span>
    <span style={{ fontSize:'12px', color, fontWeight:600, textAlign:'right', maxWidth:'220px', fontFamily:mono?'monospace':FONTS.body, wordBreak:'break-all' }}>{value ?? '—'}</span>
  </div>
)

export default function PayoutsPage() {
  const navigate   = useNavigate()
  const admin      = useAuthStore(s => s.admin)
  const adminLevel = admin?.adminLevel || 'DISTRICT'
  const hasView    = canView(adminLevel)

  const [payouts,       setPayouts]       = useState([])
  const [summary,       setSummary]       = useState(null)
  const [loading,       setLoading]       = useState(true)
  const [error,         setError]         = useState(null)
  const [total,         setTotal]         = useState(0)
  const [page,          setPage]          = useState(1)
  const [search,        setSearch]        = useState('')
  const [status,        setStatus]        = useState('ALL')
  const [dateF,         setDateF]         = useState('All Time')
  const [selectedId,    setSelectedId]    = useState(null)   // just the id — detail is fetched fresh
  const [detail,        setDetail]        = useState(null)   // full joined detail from new endpoint
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError,   setDetailError]   = useState(null)
  const [confirmAction, setConfirmAction] = useState(null)
  const [utrInput,      setUtrInput]      = useState('')
  const [noteInput,     setNoteInput]     = useState('')
  const [actionLoading, setActionLoading] = useState(false)
  const [toast,         setToast]         = useState(null)

  const showToast = (msg, color='#059669') => {
    setToast({ msg, color })
    setTimeout(() => setToast(null), 3500)
  }

  const scopeLabel = adminLevel === 'STATE' && admin?.stateRef ? `SCOPED: ${admin.stateRef}` : null

  const fetchPayouts = useCallback(async () => {
    try {
      setLoading(true); setError(null)
      const params = { page, limit: PER_PAGE }
      if (status !== 'ALL') params.status = status
      const res = await FinanceAPI.getPayouts(params)
      setPayouts(res.data || [])
      setTotal(res.pagination?.total || 0)
    } catch (err) {
      setError(err.message || 'Failed to fetch payouts')
    } finally { setLoading(false) }
  }, [page, status])

  const fetchSummary = useCallback(async () => {
    try { const res = await FinanceAPI.getPayoutSummary(); setSummary(res.data) } catch {}
  }, [])

  useEffect(() => { fetchPayouts() }, [fetchPayouts])
  useEffect(() => { fetchSummary() }, [fetchSummary])

  // ── Open drawer: fetch the real joined detail (Owner/KYC/Bank/Wallet) ──
  const openDetail = async (payoutId) => {
    setSelectedId(payoutId)
    setDetail(null); setDetailError(null); setDetailLoading(true)
    try {
      const res = await FinanceAPI.getPayoutDetail(payoutId)
      setDetail(res.data)
    } catch (err) {
      setDetailError(err.message || 'Failed to load payout detail')
    } finally { setDetailLoading(false) }
  }
  const closeDetail = () => { setSelectedId(null); setDetail(null); setDetailError(null) }

  const dateRange = useMemo(() => {
    if (dateF === 'All Time') return null
    const now = Date.now()
    const today = new Date().setHours(0,0,0,0)
    if (dateF === 'Today')        return { from: today }
    if (dateF === 'Last 7 Days')  return { from: now - 7*86400000 }
    if (dateF === 'Last 30 Days') return { from: now - 30*86400000 }
    return null
  }, [dateF])

  const filtered = payouts.filter(p => {
    const matchSearch = !search ||
      (p.salon?.name || '').toLowerCase().includes(search.toLowerCase()) ||
      (p.owner?.name || '').toLowerCase().includes(search.toLowerCase()) ||
      (p.owner?.phone || '').includes(search) ||
      String(p.id || '').toLowerCase().includes(search.toLowerCase()) ||
      (p.utr || '').toLowerCase().includes(search.toLowerCase())
    const matchDate = !dateRange || (p.createdAt && new Date(p.createdAt).getTime() >= dateRange.from)
    return matchSearch && matchDate
  })

  const totalPages      = Math.ceil(total / PER_PAGE)
  const paginationRange = getPaginationRange(page, totalPages || 1)

  const counts = {
    total:         summary?.total      ?? 0,
    requested:     summary?.requested  ?? 0,
    processing:    summary?.processing ?? 0,
    paid:          summary?.paid       ?? 0,
    rejected:      summary?.rejected   ?? 0,
    failed:        summary?.failed     ?? 0,
    totalPaid:     summary?.totalPaidInPaise      ?? 0,
    totalPending:  summary?.totalRequestedInPaise ?? 0,
  }

  const openConfirm = (type, payout) => {
    setUtrInput(''); setNoteInput('')
    setConfirmAction({ type, payout })
  }

  const handleApprove = async (payout) => {
    try {
      setActionLoading(true)
      await FinanceAPI.approvePayout(payout.id, {
        utr:       utrInput.trim()  || undefined,
        adminNote: noteInput.trim() || undefined,
      })
      showToast(`✓ Payout approved & paid — ${fmt(payout.amountInPaise)}`)
      setConfirmAction(null); closeDetail()
      fetchPayouts(); fetchSummary()
    } catch (err) {
      showToast(err.message || 'Approval failed', '#DC2626')
    } finally { setActionLoading(false) }
  }

  const handleReject = async (payout) => {
    if (!noteInput.trim()) { showToast('Admin note is required to reject', '#DC2626'); return }
    try {
      setActionLoading(true)
      await FinanceAPI.rejectPayout(payout.id, { adminNote: noteInput.trim() })
      showToast('Payout rejected — funds released to available balance', '#D97706')
      setConfirmAction(null); closeDetail()
      fetchPayouts(); fetchSummary()
    } catch (err) {
      showToast(err.message || 'Rejection failed', '#DC2626')
    } finally { setActionLoading(false) }
  }

  const handleExport = () => {
    if (!filtered.length) { showToast('No rows to export', '#DC2626'); return }
    const stamp = new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')
    downloadCsv(filtered, `payouts-current-view-${stamp}.csv`)
    showToast(`Exported ${filtered.length} rows (current view)`, '#1D4ED8')
  }

  if (!hasView) {
    return (
      <div style={{ fontFamily:FONTS.body, background:'#F0EAE0', minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center' }}>
        <div style={{ background:'#fff', border:'2px solid #DC2626', padding:'40px', textAlign:'center', maxWidth:'400px' }}>
          <div style={{ fontSize:'40px', marginBottom:'16px' }}>🔒</div>
          <div style={{ fontSize:'16px', fontWeight:800, color:'#1A1A2E', marginBottom:'8px' }}>Access Denied</div>
          <div style={{ fontSize:'13px', color:'#9E8E6E' }}>{adminLevel} does not have access to Payouts.</div>
          <button onClick={() => navigate(-1)} style={{ marginTop:'16px', background:'#1A1A2E', color:'#fff', border:'none', padding:'8px 16px', fontSize:'12px', fontWeight:700, cursor:'pointer' }}>← Go Back</button>
        </div>
      </div>
    )
  }

  return (
    <div style={{ fontFamily:FONTS.body, background:'#F0EAE0', minHeight:'100vh' }}>

      {toast && (
        <div style={{ position:'fixed', top:'20px', right:'20px', background:toast.color, color:'#fff', padding:'12px 20px', fontSize:'13px', fontWeight:700, zIndex:9999, boxShadow:'0 4px 12px rgba(0,0,0,0.2)' }}>
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <div style={{ background:'#0D1B2A', borderBottom:'2px solid #B8960C', padding:'0 20px', height:'52px', display:'flex', alignItems:'center', justifyContent:'space-between', position:'sticky', top:0, zIndex:10 }}>
        <div style={{ display:'flex', alignItems:'center', gap:'12px' }}>
          <div style={{ width:'3px', height:'16px', background:'#B8960C' }}/>
          <h1 style={{ fontSize:'13px', fontWeight:800, color:'#fff', margin:0, letterSpacing:'2px', textTransform:'uppercase' }}>Payouts</h1>
          <span style={{ background:'rgba(184,150,12,0.2)', color:'#B8960C', fontSize:'10px', fontWeight:800, padding:'2px 8px', border:'1px solid rgba(184,150,12,0.3)' }}>{counts.total} TOTAL</span>
          {scopeLabel && <span style={{ background:'rgba(37,99,235,0.25)', color:'#93C5FD', fontSize:'10px', fontWeight:800, padding:'2px 8px', border:'1px solid rgba(37,99,235,0.4)' }}>📍 {scopeLabel}</span>}
          {counts.requested > 0 && <span style={{ background:'#D97706', color:'#fff', fontSize:'10px', fontWeight:800, padding:'2px 8px' }}>🕐 {counts.requested} PENDING</span>}
        </div>
        <div style={{ display:'flex', gap:'8px' }}>
          <button onClick={() => navigate('/app/finance/wallets')} style={{ background:'rgba(255,255,255,0.07)', border:'1px solid rgba(255,255,255,0.15)', color:'rgba(255,255,255,0.5)', padding:'6px 12px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>WALLETS ▸</button>
          <button onClick={() => { fetchPayouts(); fetchSummary() }} style={{ background:'rgba(255,255,255,0.07)', border:'1px solid rgba(255,255,255,0.15)', color:'rgba(255,255,255,0.6)', padding:'6px 12px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>↻ REFRESH</button>
          {canExport(adminLevel) && <button onClick={handleExport} style={{ background:'rgba(255,255,255,0.07)', border:'1px solid rgba(255,255,255,0.15)', color:'rgba(255,255,255,0.6)', padding:'6px 12px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>↓ EXPORT (VIEW)</button>}
        </div>
      </div>

      <div style={{ padding:'14px 20px' }}>

        {adminLevel === 'STATE' && admin?.stateRef && (
          <div style={{ marginBottom:'12px', padding:'10px 14px', background:'#EFF6FF', border:'1px solid #BFDBFE', fontSize:'12px', color:'#1D4ED8', fontWeight:600 }}>
            📍 You are viewing payouts scoped to your territory: <strong>{admin.stateRef}</strong>
          </div>
        )}

        {/* Summary Strip */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:'1px', background:'#D4C9B0', border:'1px solid #D4C9B0', marginBottom:'12px' }}>
          {[
            { label:'Total Payouts',    value: counts.total,             color:'#B8960C' },
            { label:'Paid Amount',      value: fmt(counts.totalPaid),    color:'#059669' },
            { label:'Pending Amount',   value: fmt(counts.totalPending), color:'#D97706' },
            { label:'Rejected',         value: counts.rejected,          color:'#DC2626' },
          ].map(m => (
            <div key={m.label} style={{ background:'#0D1B2A', padding:'12px 16px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <span style={{ fontSize:'11px', color:'rgba(255,255,255,0.4)' }}>{m.label}</span>
              <span style={{ fontSize:typeof m.value==='string'?'14px':'20px', fontWeight:800, color:m.color }}>{m.value}</span>
            </div>
          ))}
        </div>

        {/* Status Cards */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:'10px', marginBottom:'12px' }}>
          {[
            { label:'Requested',  count:counts.requested,  f:'REQUESTED',  color:'#D97706', desc:'Awaiting approval' },
            { label:'Processing', count:counts.processing, f:'PROCESSING', color:'#7C3AED', desc:'In flight (transient)' },
            { label:'Paid',       count:counts.paid,       f:'PAID',       color:'#2563EB', desc:'Successfully disbursed' },
            { label:'Rejected',   count:counts.rejected,   f:'REJECTED',   color:'#DC2626', desc:'Declined' },
            { label:'Failed',     count:counts.failed,     f:'FAILED',     color:'#991B1B', desc:'Gateway failed' },
          ].map(s => (
            <div key={s.f} onClick={() => { setStatus(status===s.f?'ALL':s.f); setPage(1) }}
              style={{ background:status===s.f?s.color:'#fff', border:`1px solid ${s.color}30`, borderTop:`2px solid ${s.color}`, padding:'12px 14px', cursor:'pointer' }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'4px' }}>
                <span style={{ fontSize:'11px', fontWeight:700, color:status===s.f?'#fff':s.color }}>{s.label}</span>
                <span style={{ fontSize:'22px', fontWeight:800, color:status===s.f?'#fff':s.color }}>{s.count}</span>
              </div>
              <div style={{ fontSize:'10px', color:status===s.f?'rgba(255,255,255,0.7)':'#9E8E6E' }}>{s.desc}</div>
            </div>
          ))}
        </div>

        {/* Filters */}
        <BCard style={{ marginBottom:'12px' }}>
          <div style={{ padding:'10px 14px', display:'flex', gap:'8px', alignItems:'center', flexWrap:'wrap' }}>
            <div style={{ display:'flex', alignItems:'center', gap:'6px' }}>
              <div style={{ width:'3px', height:'14px', background:'#B8960C' }}/>
              <span style={{ fontSize:'10px', fontWeight:800, color:'#9E8E6E', letterSpacing:'1px' }}>FILTERS</span>
            </div>
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search salon, owner, phone, payout ID, UTR..."
              style={{ flex:1, minWidth:'220px', border:'1px solid #D4C9B0', padding:'6px 10px', fontSize:'12px', fontFamily:FONTS.body, outline:'none', background:'#FDFAF6' }}/>
            <select value={status} onChange={e => { setStatus(e.target.value); setPage(1) }}
              style={{ border:'1px solid #D4C9B0', padding:'5px 8px', fontSize:'11px', color:'#6B5E3E', background:'#FDFAF6', cursor:'pointer', fontFamily:FONTS.body, outline:'none' }}>
              {STATUSES.map(o => <option key={o}>{o}</option>)}
            </select>
            <select value={dateF} onChange={e => setDateF(e.target.value)}
              title="Filters within the currently loaded page — backend doesn't support server-side date filtering on this endpoint"
              style={{ border:'1px solid #D4C9B0', padding:'5px 8px', fontSize:'11px', color:'#6B5E3E', background:'#FDFAF6', cursor:'pointer', fontFamily:FONTS.body, outline:'none' }}>
              {DATES.map(o => <option key={o}>{o}</option>)}
            </select>
            <span style={{ fontSize:'11px', color:'#9E8E6E' }}>{filtered.length} results (this page)</span>
            <button onClick={() => { setSearch(''); setStatus('ALL'); setDateF('All Time'); setPage(1) }}
              style={{ background:'#F5F0E8', border:'1px solid #D4C9B0', color:'#9E8E6E', padding:'5px 10px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>RESET</button>
          </div>
        </BCard>

        {/* Table */}
        <BCard>
          <BCardHeader title={`Payout Requests (${total})`} action={<span style={{ fontSize:'11px', color:'#9E8E6E' }}>Page {page}/{totalPages||1}</span>}/>

          <div style={{ display:'grid', gridTemplateColumns:'0.7fr 1.4fr 1.2fr 0.8fr 0.9fr 0.9fr 1fr 0.9fr', padding:'8px 14px', background:'#F5F0E8', borderBottom:'1px solid #E8DFD0', gap:'8px' }}>
            {['PAYOUT ID','SALON','OWNER','AMOUNT','STATUS','UTR','DATE','ACTIONS'].map(h => (
              <span key={h} style={{ fontSize:'9px', fontWeight:800, color:'#9E8E6E', letterSpacing:'1px' }}>{h}</span>
            ))}
          </div>

          {loading ? (
            <div style={{ padding:'40px', textAlign:'center', color:'#9E8E6E' }}>Loading payouts...</div>
          ) : error ? (
            <div style={{ padding:'40px', textAlign:'center', color:'#DC2626' }}>{error}</div>
          ) : filtered.length === 0 ? (
            <div style={{ padding:'40px', textAlign:'center', color:'#9E8E6E' }}>No payout records found</div>
          ) : filtered.map((p, i) => {
            const sc = STATUS_COLORS[p.status] || STATUS_COLORS.REQUESTED
            return (
              <div key={p.id} style={{ display:'grid', gridTemplateColumns:'0.7fr 1.4fr 1.2fr 0.8fr 0.9fr 0.9fr 1fr 0.9fr', padding:'10px 14px', borderBottom:'1px solid #F0EAE0', alignItems:'center', gap:'8px',
                background: p.status==='REJECTED'?'#FEF2F2' : p.status==='REQUESTED'?'#FFFBEB' : i%2===0?'#fff':'#FDFAF6'
              }}>
                <span onClick={() => openDetail(p.id)} style={{ fontSize:'10px', color:'#B8960C', fontFamily:'monospace', fontWeight:700, cursor:'pointer', textDecoration:'underline' }}>
                  {String(p.id).slice(-8)}
                </span>
                <div>
                  <div style={{ fontSize:'12px', fontWeight:700, color:'#1A1A2E' }}>{p.salon?.name || '—'}</div>
                  <div style={{ fontSize:'10px', color:'#9E8E6E' }}>{p.salon?.city || ''}</div>
                </div>
                <div>
                  <div style={{ fontSize:'11px', fontWeight:600, color:'#1A1A2E' }}>{p.owner?.name || '—'}</div>
                  <div style={{ fontSize:'10px', color:'#9E8E6E' }}>{p.owner?.phone || ''}</div>
                </div>
                <span style={{ fontSize:'12px', fontWeight:800, color:'#059669' }}>{fmt(p.amountInPaise)}</span>
                <span style={{ fontSize:'9px', fontWeight:800, background:sc.bg, color:sc.color, border:`1px solid ${sc.border}`, padding:'2px 6px', display:'inline-block', whiteSpace:'nowrap' }}>
                  {STATUS_ICONS[p.status]} {p.status}
                </span>
                <span style={{ fontSize:'10px', color:'#6B5E3E', fontFamily:'monospace' }}>{p.utr || '—'}</span>
                <span style={{ fontSize:'10px', color:'#9E8E6E' }}>{p.createdAt ? new Date(p.createdAt).toLocaleDateString('en-IN') : '—'}</span>
                <div style={{ display:'flex', gap:'4px' }}>
                  <button onClick={() => openDetail(p.id)} style={{ background:'#1A1A2E', color:'#fff', border:'none', padding:'4px 8px', fontSize:'9px', fontWeight:700, cursor:'pointer' }}>VIEW</button>
                  {canApprove(adminLevel) && p.status === 'REQUESTED' && (
                    <button onClick={() => openConfirm('APPROVE', p)} style={{ background:'#059669', color:'#fff', border:'none', padding:'4px 8px', fontSize:'9px', fontWeight:700, cursor:'pointer' }}>✓</button>
                  )}
                  {canReject(adminLevel) && p.status === 'REQUESTED' && (
                    <button onClick={() => openConfirm('REJECT', p)} style={{ background:'#DC2626', color:'#fff', border:'none', padding:'4px 8px', fontSize:'9px', fontWeight:700, cursor:'pointer' }}>✕</button>
                  )}
                </div>
              </div>
            )
          })}

          <div style={{ padding:'12px 14px', borderTop:'1px solid #E8DFD0', display:'flex', justifyContent:'space-between', alignItems:'center', background:'#FDFAF6' }}>
            <span style={{ fontSize:'11px', color:'#9E8E6E' }}>Showing {total===0?0:((page-1)*PER_PAGE)+1}–{Math.min(page*PER_PAGE,total)} of {total}</span>
            <div style={{ display:'flex', gap:'4px' }}>
              <button onClick={() => setPage(p => Math.max(1,p-1))} disabled={page===1}
                style={{ background:page===1?'#F5F0E8':'#1A1A2E', color:page===1?'#C4B49A':'#fff', border:'1px solid #D4C9B0', padding:'5px 10px', fontSize:'11px', fontWeight:700, cursor:page===1?'not-allowed':'pointer' }}>← PREV</button>
              {paginationRange.map((p, idx) => p==='...'
                ? <span key={`e-${idx}`} style={{ padding:'5px 6px', fontSize:'11px', color:'#9E8E6E' }}>…</span>
                : <button key={p} onClick={() => setPage(p)}
                    style={{ background:p===page?'#B8960C':'#fff', color:p===page?'#fff':'#6B5E3E', border:'1px solid #D4C9B0', padding:'5px 10px', fontSize:'11px', fontWeight:700, cursor:'pointer' }}>{p}</button>
              )}
              <button onClick={() => setPage(p => Math.min(totalPages,p+1))} disabled={page===totalPages||totalPages===0}
                style={{ background:(page===totalPages||totalPages===0)?'#F5F0E8':'#1A1A2E', color:(page===totalPages||totalPages===0)?'#C4B49A':'#fff', border:'1px solid #D4C9B0', padding:'5px 10px', fontSize:'11px', fontWeight:700, cursor:(page===totalPages||totalPages===0)?'not-allowed':'pointer' }}>NEXT →</button>
            </div>
          </div>
        </BCard>

        <div style={{ marginTop:'10px', padding:'10px 14px', background:'#FFFBEB', border:'1px solid #FDE68A', fontSize:'11px', color:'#92400E', fontWeight:600 }}>
          ⚠ {canApprove(adminLevel) ? 'You have APPROVE and REJECT permissions. All wallet movements are recorded in the Wallet Ledger.' : 'You have VIEW ONLY access. Contact an INDIA admin to approve payouts.'}
        </div>
      </div>

      <div style={{ background:'#0D1B2A', borderTop:'2px solid #B8960C', padding:'10px 20px', display:'flex', justifyContent:'space-between', marginTop:'14px' }}>
        <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.3)' }}>BARBER ENGINE FINANCE CENTER v1.0.0</span>
        <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.3)' }}>NATIONAL COMMAND CENTER</span>
      </div>

      {/* Confirm Modal */}
      {confirmAction && (
        <div onClick={() => !actionLoading && setConfirmAction(null)} style={{ position:'fixed', inset:0, background:'rgba(13,27,42,0.7)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:60 }}>
          <div onClick={e => e.stopPropagation()} style={{ background:'#fff', border:`2px solid ${confirmAction.type==='APPROVE'?'#059669':'#DC2626'}`, padding:'28px 32px', maxWidth:'440px', width:'90%' }}>
            <div style={{ textAlign:'center' }}>
              <div style={{ fontSize:'36px', marginBottom:'12px' }}>{confirmAction.type==='APPROVE'?'✅':'❌'}</div>
              <div style={{ fontSize:'15px', fontWeight:800, color:'#1A1A2E', marginBottom:'8px' }}>{confirmAction.type==='APPROVE' ? 'Approve & Pay Out?' : 'Reject Payout?'}</div>
              <div style={{ fontSize:'12px', color:'#6B5E3E', marginBottom:'6px' }}>{confirmAction.payout.salon?.name}</div>
              <div style={{ fontSize:'18px', fontWeight:800, color:'#059669', marginBottom:'16px' }}>{fmt(confirmAction.payout.amountInPaise)}</div>
            </div>

            {confirmAction.type === 'APPROVE' ? (
              <>
                <label style={{ display:'block', fontSize:'10px', fontWeight:800, color:'#9E8E6E', marginBottom:'4px' }}>UTR NUMBER <span style={{ fontWeight:400 }}>(recommended)</span></label>
                <input value={utrInput} onChange={e => setUtrInput(e.target.value)} placeholder="e.g. UTR1234567890"
                  style={{ width:'100%', border:'1px solid #D4C9B0', padding:'8px 10px', fontSize:'12px', fontFamily:'monospace', outline:'none', marginBottom:'12px', boxSizing:'border-box' }}/>
                <label style={{ display:'block', fontSize:'10px', fontWeight:800, color:'#9E8E6E', marginBottom:'4px' }}>ADMIN NOTE (OPTIONAL)</label>
                <textarea value={noteInput} onChange={e => setNoteInput(e.target.value)} rows={2}
                  style={{ width:'100%', border:'1px solid #D4C9B0', padding:'8px 10px', fontSize:'12px', fontFamily:FONTS.body, outline:'none', resize:'vertical', boxSizing:'border-box' }}/>
              </>
            ) : (
              <>
                <label style={{ display:'block', fontSize:'10px', fontWeight:800, color:'#9E8E6E', marginBottom:'4px' }}>REASON FOR REJECTION <span style={{ color:'#DC2626' }}>*</span></label>
                <textarea value={noteInput} onChange={e => setNoteInput(e.target.value)} rows={3} placeholder="Required"
                  style={{ width:'100%', border:'1px solid #D4C9B0', padding:'8px 10px', fontSize:'12px', fontFamily:FONTS.body, outline:'none', resize:'vertical', boxSizing:'border-box' }}/>
                <div style={{ fontSize:'10px', color:'#9E8E6E', marginTop:'8px' }}>Funds are automatically released back to the salon's available wallet balance.</div>
              </>
            )}

            <div style={{ display:'flex', gap:'10px', justifyContent:'center', marginTop:'20px' }}>
              <button onClick={() => setConfirmAction(null)} disabled={actionLoading} style={{ background:'#F5F0E8', border:'1px solid #D4C9B0', color:'#6B5E3E', padding:'8px 20px', fontSize:'12px', fontWeight:700, cursor:'pointer' }}>CANCEL</button>
              <button onClick={() => confirmAction.type==='APPROVE' ? handleApprove(confirmAction.payout) : handleReject(confirmAction.payout)}
                disabled={actionLoading || (confirmAction.type==='REJECT' && !noteInput.trim())}
                style={{ background:confirmAction.type==='APPROVE'?'#059669':'#DC2626', color:'#fff', border:'none', padding:'8px 20px', fontSize:'12px', fontWeight:700, cursor:'pointer', opacity:(actionLoading || (confirmAction.type==='REJECT' && !noteInput.trim()))?0.6:1 }}>
                {actionLoading ? 'Processing...' : `CONFIRM ${confirmAction.type}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Detail Drawer — real joined data (Salon/Owner/KYC/Bank/Wallet) */}
      {selectedId && (
        <div onClick={closeDetail} style={{ position:'fixed', inset:0, background:'rgba(13,27,42,0.6)', display:'flex', justifyContent:'flex-end', zIndex:50 }}>
          <div onClick={e => e.stopPropagation()} style={{ width:'460px', maxWidth:'100%', height:'100%', background:'#FDFAF6', borderLeft:'3px solid #B8960C', overflowY:'auto', boxShadow:'-8px 0 24px rgba(0,0,0,0.2)' }}>

            <div style={{ background:'#0D1B2A', padding:'16px 20px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <div>
                <div style={{ fontSize:'10px', color:'#B8960C', fontWeight:800, letterSpacing:'1px' }}>PAYOUT DETAILS</div>
                <div style={{ fontSize:'13px', color:'#fff', fontWeight:800, fontFamily:'monospace' }}>{String(selectedId).slice(-12)}</div>
              </div>
              <button onClick={closeDetail} style={{ background:'transparent', border:'none', color:'#fff', fontSize:'18px', cursor:'pointer' }}>✕</button>
            </div>

            {detailLoading ? (
              <div style={{ padding:'60px 20px', textAlign:'center', color:'#9E8E6E', fontSize:'13px' }}>Loading payout detail...</div>
            ) : detailError ? (
              <div style={{ padding:'60px 20px', textAlign:'center', color:'#DC2626', fontSize:'13px' }}>{detailError}</div>
            ) : detail && (
              <div style={{ padding:'18px 20px' }}>

                {/* Status + Amount */}
                <div style={{ marginBottom:'14px', display:'flex', gap:'8px', alignItems:'center' }}>
                  <span style={{ fontSize:'9px', fontWeight:800, background:(STATUS_COLORS[detail.status]||STATUS_COLORS.REQUESTED).bg, color:(STATUS_COLORS[detail.status]||STATUS_COLORS.REQUESTED).color, border:`1px solid ${(STATUS_COLORS[detail.status]||STATUS_COLORS.REQUESTED).border}`, padding:'3px 8px' }}>
                    {STATUS_ICONS[detail.status]} {detail.status}
                  </span>
                  <span style={{ fontSize:'18px', fontWeight:800, color:'#059669' }}>{fmt(detail.amountInPaise)}</span>
                </div>

                {/* Section 1 — Salon */}
                <div style={{ marginBottom:'8px', display:'flex', alignItems:'center', gap:'6px' }}>
                  <div style={{ width:'3px', height:'12px', background:'#B8960C' }}/>
                  <span style={{ fontSize:'10px', fontWeight:800, color:'#9E8E6E', letterSpacing:'1px' }}>SALON</span>
                </div>
                <Row label="Salon Name" value={detail.salon?.name} />
                <Row label="Owner"      value={detail.owner?.name} />
                <Row label="Phone"      value={detail.owner?.phone} />
                <Row label="Address"    value={detail.salon?.address} />
                <Row label="City"       value={detail.salon?.city} />
                <Row label="KYC Status" value={detail.kyc?.status || 'NOT SUBMITTED'} color={KYC_STATUS_COLORS[detail.kyc?.status] || '#9E8E6E'} />
                <Row label="Bank Verified" value={detail.kyc?.bankVerified ? '✓ Verified' : detail.kyc?.bankVerificationStatus || 'Not Verified'} color={detail.kyc?.bankVerified ? '#059669' : '#D97706'} />
                <Row label="Wallet Available" value={fmt(detail.wallet?.availableBalanceInPaise)} color="#059669" />
                <Row label="Wallet Locked"    value={fmt(detail.wallet?.lockedBalanceInPaise)} color="#DC2626" />

                {/* Section 2 — Request */}
                <div style={{ marginTop:'18px', marginBottom:'8px', display:'flex', alignItems:'center', gap:'6px' }}>
                  <div style={{ width:'3px', height:'12px', background:'#B8960C' }}/>
                  <span style={{ fontSize:'10px', fontWeight:800, color:'#9E8E6E', letterSpacing:'1px' }}>REQUEST</span>
                </div>
                <Row label="Amount" value={fmt(detail.amountInPaise)} />
                <Row label="Provider" value={detail.provider || 'MANUAL'} />
                <Row label="Requested At" value={detail.createdAt ? new Date(detail.createdAt).toLocaleString('en-IN') : '—'} />
                <Row label="Approved At" value={detail.approvedAt ? new Date(detail.approvedAt).toLocaleString('en-IN') : '—'} />
                <Row label="Approved By" value={detail.approvedBy?.name || '—'} />
                <Row label="Admin Note" value={detail.adminNote || '—'} />
                {detail.failureReason && <Row label="Failure Reason" value={detail.failureReason} color="#DC2626" />}

                {/* Section 3 — Bank */}
                <div style={{ marginTop:'18px', marginBottom:'8px', display:'flex', alignItems:'center', gap:'6px' }}>
                  <div style={{ width:'3px', height:'12px', background:'#B8960C' }}/>
                  <span style={{ fontSize:'10px', fontWeight:800, color:'#9E8E6E', letterSpacing:'1px' }}>BANK (FROM KYC)</span>
                </div>
                {detail.kyc?.bank ? (
                  <>
                    <Row label="Account Holder" value={detail.kyc.bank.accountHolder} />
                    <Row label="Account Number" value={detail.kyc.bank.maskedAccount} mono />
                    <Row label="IFSC"           value={detail.kyc.bank.ifsc} mono />
                    <Row label="Bank Name"      value={detail.kyc.bank.bankName} />
                  </>
                ) : (
                  <div style={{ padding:'10px 0', fontSize:'11px', color:'#9E8E6E' }}>No KYC/bank record found for this owner.</div>
                )}

                {/* UTR — separate, from payout not KYC */}
                <div style={{ marginTop:'12px' }}>
                  <Row label="UTR Number" value={detail.utr || '—'} mono />
                </div>

                {/* Real audit — links to real Wallet Ledger, not a fake client-side log */}
                {detail.salon?.id && (
                  <button onClick={() => navigate(`/app/finance/wallets/${detail.salon.id}`)}
                    style={{ width:'100%', marginTop:'18px', background:'#1A1A2E', color:'#fff', border:'none', padding:'10px', fontSize:'11px', fontWeight:700, cursor:'pointer' }}>
                    📋 VIEW AUDIT TRAIL IN WALLET LEDGER →
                  </button>
                )}

                {canApprove(adminLevel) && detail.status === 'REQUESTED' && (
                  <div style={{ marginTop:'14px', display:'flex', gap:'10px' }}>
                    <button onClick={() => openConfirm('APPROVE', { id: selectedId, salon: detail.salon, amountInPaise: detail.amountInPaise })}
                      style={{ flex:1, background:'#059669', color:'#fff', border:'none', padding:'10px', fontSize:'12px', fontWeight:700, cursor:'pointer' }}>✓ APPROVE</button>
                    <button onClick={() => openConfirm('REJECT', { id: selectedId, salon: detail.salon, amountInPaise: detail.amountInPaise })}
                      style={{ flex:1, background:'#DC2626', color:'#fff', border:'none', padding:'10px', fontSize:'12px', fontWeight:700, cursor:'pointer' }}>✕ REJECT</button>
                  </div>
                )}

                {!canApprove(adminLevel) && (
                  <div style={{ marginTop:'16px', padding:'10px 12px', background:'#EFF6FF', border:'1px solid #BFDBFE', fontSize:'10px', color:'#1D4ED8', fontWeight:600 }}>
                    👁 View Only — Contact an INDIA admin to approve.
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}