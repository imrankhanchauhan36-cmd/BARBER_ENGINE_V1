import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { canApproveKYC, canRejectKYC, canViewPII as canViewPIIRole } from '../../config/adminRoles'
import { FONTS } from '../../config/brand'
import useAuthStore from '../../store/authStore'
import KYCAPI from './api/kyc.api'

// ─── Helpers ─────────────────────────────────────────────
const v   = (val, fb = '—') => (val !== null && val !== undefined && val !== '') ? val : fb
const dt  = (d) => d ? new Date(d).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' }) : '—'
const maskPhone = (p='') => p && p.length >= 4 ? p.slice(0,2)+'******'+p.slice(-2) : '******'

// ─── Constants ────────────────────────────────────────────
const STATUS_COLORS = {
  DRAFT:              { bg:'#F3F4F6', color:'#374151' },
  PENDING:            { bg:'#FEF9C3', color:'#92400E' },
  UNDER_REVIEW:       { bg:'#EFF6FF', color:'#1D4ED8' },
  PARTIALLY_VERIFIED: { bg:'#FEF3C7', color:'#92400E' },
  VERIFIED:           { bg:'#D1FAE5', color:'#065F46' },
  REJECTED:           { bg:'#FEE2E2', color:'#991B1B' },
  EXPIRED:            { bg:'#F3F4F6', color:'#374151' },
  REVERIFY_REQUIRED:  { bg:'#FEF9C3', color:'#92400E' },
}

const STATUSES = ['ALL','DRAFT','PENDING','UNDER_REVIEW','PARTIALLY_VERIFIED','VERIFIED','REJECTED','EXPIRED','REVERIFY_REQUIRED']

// ─── Reject Modal ─────────────────────────────────────────
function RejectModal({ kyc, onConfirm, onCancel, processing }) {
  const [reason, setReason] = useState('')
  const valid = reason.trim().length >= 10

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.75)', zIndex:2000, display:'flex', alignItems:'center', justifyContent:'center' }}>
      <div style={{ background:'#fff', width:'440px', border:'2px solid #DC2626' }}>
        <div style={{ background:'#7F1D1D', padding:'14px 18px', borderBottom:'2px solid #DC2626' }}>
          <div style={{ color:'#fff', fontWeight:800, fontSize:'13px', letterSpacing:'1px' }}>✗ REJECT KYC</div>
          <div style={{ color:'rgba(255,255,255,0.6)', fontSize:'10px', marginTop:'2px' }}>{v(kyc.owner?.name)} — {kyc.id}</div>
        </div>
        <div style={{ padding:'20px 18px' }}>
          <div style={{ background:'#FEF2F2', border:'1px solid #FEE2E2', padding:'10px', marginBottom:'14px', fontSize:'11px', color:'#991B1B', fontWeight:600 }}>
            ⚠ Rejection reason will be sent to provider. They can resubmit after correction.
          </div>
          <label style={{ fontSize:'10px', color:'#9E8E6E', fontWeight:800, letterSpacing:'1px', display:'block', marginBottom:'6px' }}>
            REJECTION REASON (REQUIRED — min 10 chars)
          </label>
          <textarea value={reason} onChange={e => setReason(e.target.value)}
            placeholder="e.g. Aadhaar photo mismatch, PAN number unclear..."
            style={{ width:'100%', border:`1px solid ${valid?'#D4C9B0':'#FCA5A5'}`, padding:'8px 12px', fontSize:'13px', fontFamily:FONTS.body, outline:'none', minHeight:'80px', resize:'vertical', boxSizing:'border-box', marginBottom:'6px' }}
          />
          <div style={{ fontSize:'10px', color:valid?'#059669':'#9E8E6E', marginBottom:'14px' }}>{reason.trim().length}/500 chars {valid ? '✓' : `(need ${10 - reason.trim().length} more)`}</div>
          <div style={{ display:'flex', gap:'8px', justifyContent:'flex-end' }}>
            <button onClick={onCancel} style={{ background:'#fff', border:'1px solid #D4C9B0', color:'#6B5E3E', padding:'8px 16px', fontSize:'11px', fontWeight:700, cursor:'pointer' }}>CANCEL</button>
            <button onClick={() => valid && onConfirm(reason.trim())} disabled={!valid || processing}
              style={{ background:valid?'#DC2626':'#F5F0E8', border:'none', color:valid?'#fff':'#C4B49A', padding:'8px 20px', fontSize:'11px', fontWeight:800, cursor:valid?'pointer':'not-allowed', opacity:processing?0.7:1 }}>
              {processing ? 'PROCESSING...' : '✗ CONFIRM REJECT'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Doc Badge ────────────────────────────────────────────
const DocBadge = ({ label, verified }) => (
  <div style={{ display:'flex', alignItems:'center', gap:'3px', padding:'2px 6px', background:verified?'#D1FAE5':'#FEE2E2', border:`1px solid ${verified?'#059669':'#DC2626'}` }}>
    <span style={{ fontSize:'9px', fontWeight:800, color:verified?'#065F46':'#991B1B' }}>{verified?'✓':'✗'} {label}</span>
  </div>
)

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

const SkeletonRow = () => (
  <div style={{ display:'grid', gridTemplateColumns:'1.2fr 1.4fr 1fr 0.8fr 1.4fr 0.8fr 1fr', padding:'12px 14px', borderBottom:'1px solid #F0EAE0', gap:'8px', alignItems:'center' }}>
    {Array.from({length:7}).map((_,i) => (
      <div key={i} style={{ height:'12px', background:'#E8DFD0', borderRadius:'2px', width:i===0?'80%':'60%' }}/>
    ))}
  </div>
)

// ─── Main Page ────────────────────────────────────────────
export default function KYCPage() {
  const navigate   = useNavigate()
  const admin      = useAuthStore(s => s.admin)
  const adminLevel = admin?.adminLevel || 'INDIA'

  const hasApprove = canApproveKYC(adminLevel)
  const hasReject  = canRejectKYC(adminLevel)
  const hasPII     = canViewPIIRole(adminLevel)

  const scope = adminLevel === 'STATE'    ? `State: ${admin?.stateRef?.name || '—'}`
              : adminLevel === 'DISTRICT' ? `District: ${admin?.districtRef?.name || '—'}`
              : 'PAN INDIA'

  const [kycs,        setKycs]        = useState([])
  const [summary,     setSummary]     = useState(null)
  const [loading,     setLoading]     = useState(true)
  const [error,       setError]       = useState(null)
  const [processing,  setProcessing]  = useState(false)
  const [pagination,  setPagination]  = useState({ page:1, limit:20, total:0, totalPages:1 })
  const [search,      setSearch]      = useState('')
  const [status,      setStatus]      = useState('ALL')
  const [page,        setPage]        = useState(1)
  const [toast,       setToast]       = useState(null)
  const [rejectModal, setRejectModal] = useState(null)

  const showToast = (msg, color = '#059669') => {
    setToast({ msg, color })
    setTimeout(() => setToast(null), 3500)
  }

  const fetchKYC = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = {
        page, limit: 20,
        ...(search && { search }),
        ...(status !== 'ALL' && { status }),
      }
      const [res, sumRes] = await Promise.all([
        KYCAPI.getAll(params),
        KYCAPI.getSummary(),
      ])
      setKycs(res.data || [])
      if (res.pagination) setPagination(res.pagination)
      if (sumRes.data)    setSummary(sumRes.data)
    } catch (err) {
      setError(err.message || 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [page, status, search])

  useEffect(() => { fetchKYC() }, [fetchKYC])

  const handleApprove = async (kyc) => {
    setProcessing(true)
    try {
      await KYCAPI.approve(kyc.id, {})
      showToast(`✓ KYC approved — ${v(kyc.owner?.name)}`, '#059669')
      fetchKYC()
    } catch (err) {
      showToast(`⚠ ${err.message}`, '#DC2626')
    } finally {
      setProcessing(false)
    }
  }

  const handleReject = async (reason) => {
    const kyc = rejectModal
    setProcessing(true)
    try {
      await KYCAPI.reject(kyc.id, { reason })
      showToast(`✗ KYC rejected — ${v(kyc.owner?.name)}`, '#DC2626')
      setRejectModal(null)
      fetchKYC()
    } catch (err) {
      showToast(`⚠ ${err.message}`, '#DC2626')
    } finally {
      setProcessing(false)
    }
  }

  const resetFilters = () => { setSearch(''); setStatus('ALL'); setPage(1) }
  const total    = pagination.total || 0
  const pending  = summary?.pending  ?? 0
  const rejected = summary?.rejected ?? 0

  return (
    <div style={{ fontFamily:FONTS.body, background:'#F0EAE0', minHeight:'100vh' }}>
      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}`}</style>

      {toast && (
        <div style={{ position:'fixed', top:'20px', right:'20px', background:toast.color, color:'#fff', padding:'12px 20px', fontSize:'13px', fontWeight:700, zIndex:9999, boxShadow:'0 4px 12px rgba(0,0,0,0.2)' }}>
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <div style={{ background:'#0D1B2A', borderBottom:'2px solid #B8960C', padding:'0 20px', height:'52px', display:'flex', alignItems:'center', justifyContent:'space-between', position:'sticky', top:0, zIndex:10 }}>
        <div style={{ display:'flex', alignItems:'center', gap:'12px' }}>
          <div style={{ width:'3px', height:'16px', background:'#B8960C' }}/>
          <h1 style={{ fontSize:'13px', fontWeight:800, color:'#fff', margin:0, letterSpacing:'2px' }}>KYC QUEUE</h1>
          <span style={{ background:'rgba(184,150,12,0.2)', color:'#B8960C', fontSize:'10px', fontWeight:800, padding:'2px 8px', border:'1px solid rgba(184,150,12,0.3)' }}>
            {loading ? '...' : `${total} TOTAL`}
          </span>
          <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.35)' }}>|</span>
          <span style={{ fontSize:'10px', color:'#B8960C', fontWeight:600 }}>Viewing: {scope}</span>
          {pending  > 0 && <span style={{ background:'rgba(217,119,6,0.2)',  color:'#FDE68A', fontSize:'10px', fontWeight:800, padding:'2px 8px', border:'1px solid rgba(217,119,6,0.3)'  }}>⚠ {pending} PENDING</span>}
          {rejected > 0 && <span style={{ background:'rgba(220,38,38,0.2)',  color:'#FCA5A5', fontSize:'10px', fontWeight:800, padding:'2px 8px', border:'1px solid rgba(220,38,38,0.3)'  }}>✗ {rejected} REJECTED</span>}
          {!hasPII && <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.3)', fontStyle:'italic' }}>PII masked</span>}
        </div>
        <div style={{ display:'flex', gap:'8px' }}>
          <button onClick={() => navigate('/app/providers')} style={{ background:'rgba(255,255,255,0.07)', border:'1px solid rgba(255,255,255,0.15)', color:'rgba(255,255,255,0.5)', padding:'6px 12px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>PROVIDERS ▸</button>
          <button onClick={resetFilters}  style={{ background:'rgba(255,255,255,0.07)', border:'1px solid rgba(255,255,255,0.15)', color:'rgba(255,255,255,0.6)', padding:'6px 12px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>RESET</button>
          <button onClick={fetchKYC}      style={{ background:'#B8960C', border:'none', color:'#0D1B2A', padding:'6px 14px', fontSize:'10px', fontWeight:800, cursor:'pointer' }}>↻ REFRESH</button>
        </div>
      </div>

      <div style={{ padding:'14px 20px' }}>

        {error && (
          <div style={{ background:'#FEE2E2', border:'1px solid #DC2626', borderLeft:'4px solid #DC2626', padding:'10px 14px', marginBottom:'12px', fontSize:'13px', color:'#991B1B', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
            <span>⚠ {error}</span>
            <button onClick={fetchKYC} style={{ background:'#DC2626', border:'none', color:'#fff', cursor:'pointer', fontWeight:700, padding:'4px 10px', fontSize:'11px' }}>RETRY</button>
          </div>
        )}

        {/* Summary Strip */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(6,1fr)', gap:'1px', background:'#D4C9B0', border:'1px solid #D4C9B0', marginBottom:'12px' }}>
          {[
            { label:'Total',            value: loading ? '...' : summary?.total            ?? 0, color:'#B8960C' },
            { label:'Pending',          value: loading ? '...' : summary?.pending          ?? 0, color:'#D97706' },
            { label:'Under Review',     value: loading ? '...' : summary?.underReview      ?? 0, color:'#2563EB' },
            { label:'Verified',         value: loading ? '...' : summary?.verified         ?? 0, color:'#059669' },
            { label:'Rejected',         value: loading ? '...' : summary?.rejected         ?? 0, color:'#DC2626' },
            { label:'Manual Queue',     value: loading ? '...' : summary?.manualReviewQueue?? 0, color:'#7C3AED' },
          ].map(m => (
            <div key={m.label} style={{ background:'#0D1B2A', padding:'10px 14px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.4)' }}>{m.label}</span>
              <span style={{ fontSize:'16px', fontWeight:800, color:m.color }}>{m.value}</span>
            </div>
          ))}
        </div>

        {/* Stats Cards */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:'10px', marginBottom:'12px' }}>
          {[
            { label:'All',          color:'#1A1A2E', f:'ALL',       count: summary?.total    ?? 0 },
            { label:'Pending',      color:'#D97706', f:'PENDING',   count: summary?.pending  ?? 0 },
            { label:'Verified',     color:'#059669', f:'VERIFIED',  count: summary?.verified ?? 0 },
            { label:'Rejected',     color:'#DC2626', f:'REJECTED',  count: summary?.rejected ?? 0 },
          ].map(s => (
            <div key={s.label} onClick={() => { setStatus(s.f); setPage(1) }}
              style={{ background:status===s.f?s.color:'#fff', border:`1px solid ${s.color}30`, borderTop:`2px solid ${s.color}`, padding:'12px', cursor:'pointer', textAlign:'center' }}>
              <div style={{ fontSize:'22px', fontWeight:800, color:status===s.f?'#fff':s.color }}>{loading ? '...' : s.count}</div>
              <div style={{ fontSize:'9px', color:status===s.f?'rgba(255,255,255,0.8)':'#9E8E6E', textTransform:'uppercase', letterSpacing:'0.5px', marginTop:'2px' }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* Filters */}
        <BCard style={{ marginBottom:'12px' }}>
          <BCardHeader title="Filters" action={<span style={{ fontSize:'11px', color:'#B8960C', fontWeight:700, cursor:'pointer' }} onClick={resetFilters}>RESET ALL</span>}/>
          <div style={{ padding:'12px 14px', display:'flex', gap:'8px', alignItems:'center', flexWrap:'wrap' }}>
            <input value={search} onChange={e => setSearch(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && fetchKYC()}
              placeholder="Search provider name, phone, email... (Enter)"
              style={{ flex:1, minWidth:'240px', border:'1px solid #D4C9B0', padding:'6px 10px', fontSize:'12px', fontFamily:FONTS.body, outline:'none', background:'#FDFAF6' }}
            />
            <select value={status} onChange={e => { setStatus(e.target.value); setPage(1) }}
              style={{ border:'1px solid #D4C9B0', padding:'5px 8px', fontSize:'11px', color:'#6B5E3E', background:'#FDFAF6', cursor:'pointer', fontFamily:FONTS.body, outline:'none' }}>
              {STATUSES.map(s => <option key={s}>{s}</option>)}
            </select>
            <span style={{ fontSize:'11px', color:'#9E8E6E', fontWeight:600 }}>{loading ? 'Loading...' : `${total} results`}</span>
          </div>
        </BCard>

        {/* Table */}
        <BCard>
          <BCardHeader
            title={`KYC Queue (${total})`}
            action={<span style={{ fontSize:'11px', color:'#9E8E6E' }}>Page {page} of {pagination.totalPages || 1}</span>}
          />
          <div style={{ display:'grid', gridTemplateColumns:'1.4fr 1.2fr 0.8fr 1fr 1.4fr 0.8fr 1.2fr', padding:'8px 14px', background:'#F5F0E8', borderBottom:'1px solid #E8DFD0', gap:'8px' }}>
            {['PROVIDER','PHONE','LEVEL','SUBMITTED','VERIFICATION','STATUS','ACTIONS'].map(h => (
              <span key={h} style={{ fontSize:'9px', fontWeight:800, color:'#9E8E6E', letterSpacing:'1px' }}>{h}</span>
            ))}
          </div>

          {loading && Array.from({length:6}).map((_,i) => <SkeletonRow key={i}/>)}

          {!loading && kycs.length === 0 && !error && (
            <div style={{ padding:'60px', textAlign:'center' }}>
              <div style={{ fontSize:'32px', marginBottom:'12px' }}>📋</div>
              <div style={{ fontSize:'14px', fontWeight:700, color:'#1A1A2E', marginBottom:'6px' }}>No KYC Applications</div>
              <div style={{ fontSize:'12px', color:'#9E8E6E', marginBottom:'16px' }}>Jab owners KYC submit karenge tab yahan dikhega</div>
              <div style={{ fontSize:'11px', color:'#B8960C', fontWeight:600, padding:'8px 16px', background:'rgba(184,150,12,0.1)', border:'1px solid rgba(184,150,12,0.3)', display:'inline-block' }}>
                ℹ Backend ready — waiting for owner submissions
              </div>
            </div>
          )}

          {!loading && kycs.map((k, i) => {
            const sc = STATUS_COLORS[k.status] || STATUS_COLORS.PENDING
            const rowBg = k.status === 'REJECTED' ? '#FEF2F2'
                        : k.status === 'VERIFIED'  ? '#F0FDF4'
                        : k.status === 'UNDER_REVIEW' ? '#EFF6FF'
                        : i%2===0 ? '#fff' : '#FDFAF6'

            const vf = k.verification || {}
            const level = k.verificationLevel ?? 0

            return (
              <div key={k.id} style={{ display:'grid', gridTemplateColumns:'1.4fr 1.2fr 0.8fr 1fr 1.4fr 0.8fr 1.2fr', padding:'10px 14px', borderBottom:'1px solid #F0EAE0', alignItems:'center', gap:'8px', background:rowBg }}>

                {/* Provider */}
                <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
                  <div style={{ width:'28px', height:'28px', background:'#0D1B2A', display:'flex', alignItems:'center', justifyContent:'center', color:'#B8960C', fontSize:'11px', fontWeight:800, flexShrink:0 }}>
                    {(k.owner?.name || '?')[0].toUpperCase()}
                  </div>
                  <div>
                    <div style={{ fontSize:'12px', fontWeight:700, color:'#1A1A2E' }}>{v(k.owner?.name)}</div>
                    <div style={{ fontSize:'10px', color:'#9E8E6E' }}>{v(k.owner?.accountStatus)}</div>
                  </div>
                </div>

                {/* Phone */}
                <div style={{ fontSize:'11px', color:'#1A1A2E', fontFamily:'monospace' }}>
                  {hasPII ? v(k.owner?.phone) : maskPhone(k.owner?.phone || '')}
                </div>

                {/* Level */}
                <div style={{ textAlign:'center' }}>
                  <div style={{ fontSize:'16px', fontWeight:800, color:'#7C3AED' }}>{level}/7</div>
                  <div style={{ fontSize:'9px', color:'#9E8E6E' }}>level</div>
                </div>

                {/* Submitted */}
                <div style={{ fontSize:'10px', color:'#6B5E3E' }}>{dt(k.submittedAt)}</div>

                {/* Verification badges */}
                <div style={{ display:'flex', gap:'2px', flexWrap:'wrap' }}>
                  <DocBadge label="Phone"   verified={vf.phone}   />
                  <DocBadge label="PAN"     verified={vf.pan}     />
                  <DocBadge label="Aadhaar" verified={vf.aadhaar} />
                  <DocBadge label="Bank"    verified={vf.bank}    />
                </div>

                {/* Status */}
                <span style={{ fontSize:'9px', fontWeight:800, background:sc.bg, color:sc.color, padding:'2px 6px', display:'inline-block' }}>
                  {v(k.status)}
                </span>

                {/* Actions */}
                <div style={{ display:'flex', gap:'3px', flexDirection:'column' }}>
                  <button onClick={() => navigate(`/app/kyc/${k.id}`)}
                    style={{ background:'#1A1A2E', color:'#fff', border:'none', padding:'4px 8px', fontSize:'9px', fontWeight:700, cursor:'pointer' }}>VIEW</button>
                  {['PENDING','UNDER_REVIEW','PARTIALLY_VERIFIED'].includes(k.status) && hasApprove && (
                    <button onClick={() => handleApprove(k)} disabled={processing}
                      style={{ background:'#059669', color:'#fff', border:'none', padding:'4px 8px', fontSize:'9px', fontWeight:700, cursor:'pointer', opacity:processing?0.7:1 }}>✓ APPROVE</button>
                  )}
                  {['PENDING','UNDER_REVIEW'].includes(k.status) && hasReject && (
                    <button onClick={() => setRejectModal(k)}
                      style={{ background:'#DC2626', color:'#fff', border:'none', padding:'4px 8px', fontSize:'9px', fontWeight:700, cursor:'pointer' }}>✗ REJECT</button>
                  )}
                </div>
              </div>
            )
          })}

          {/* Pagination */}
          <div style={{ padding:'12px 14px', borderTop:'1px solid #E8DFD0', display:'flex', justifyContent:'space-between', alignItems:'center', background:'#FDFAF6' }}>
            <span style={{ fontSize:'11px', color:'#9E8E6E' }}>
              {total === 0 ? 'No results' : `Showing ${((page-1)*20)+1}–${Math.min(page*20, total)} of ${total}`}
            </span>
            <div style={{ display:'flex', gap:'4px' }}>
              <button onClick={() => setPage(p => Math.max(1, p-1))} disabled={page===1}
                style={{ background:page===1?'#F5F0E8':'#1A1A2E', color:page===1?'#C4B49A':'#fff', border:'1px solid #D4C9B0', padding:'5px 10px', fontSize:'11px', fontWeight:700, cursor:page===1?'not-allowed':'pointer' }}>← PREV</button>
              {(() => {
                const tot = pagination.totalPages || 1
                const delta = 2
                const pages = []
                const left  = Math.max(2, page - delta)
                const right = Math.min(tot - 1, page + delta)
                pages.push(1)
                if (left > 2) pages.push('...')
                for (let i = left; i <= right; i++) pages.push(i)
                if (right < tot - 1) pages.push('...')
                if (tot > 1) pages.push(tot)
                return pages.map((p, i) => p === '...'
                  ? <span key={`e${i}`} style={{ padding:'5px 6px', fontSize:'11px', color:'#9E8E6E' }}>...</span>
                  : <button key={p} onClick={() => setPage(p)}
                      style={{ background:p===page?'#B8960C':'#fff', color:p===page?'#fff':'#6B5E3E', border:'1px solid #D4C9B0', padding:'5px 10px', fontSize:'11px', fontWeight:700, cursor:'pointer' }}>{p}</button>
                )
              })()}
              <button onClick={() => setPage(p => Math.min(pagination.totalPages||1, p+1))} disabled={page===pagination.totalPages}
                style={{ background:page===pagination.totalPages?'#F5F0E8':'#1A1A2E', color:page===pagination.totalPages?'#C4B49A':'#fff', border:'1px solid #D4C9B0', padding:'5px 10px', fontSize:'11px', fontWeight:700, cursor:page===pagination.totalPages?'not-allowed':'pointer' }}>NEXT →</button>
            </div>
          </div>
        </BCard>

        {!hasApprove && (
          <div style={{ marginTop:'10px', padding:'10px 14px', background:'#FEF2F2', border:'1px solid #FEE2E2', fontSize:'11px', color:'#991B1B', fontWeight:600 }}>
            ⊘ {adminLevel} — View Only. KYC Approval requires INDIA / STATE admin.
          </div>
        )}
      </div>

      <div style={{ background:'#0D1B2A', borderTop:'2px solid #B8960C', padding:'10px 20px', display:'flex', justifyContent:'space-between', marginTop:'14px' }}>
        <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.3)' }}>ZEMISH KYC QUEUE v2.0.0</span>
        <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.3)' }}>NATIONAL COMMAND CENTER</span>
      </div>

      {rejectModal && (
        <RejectModal
          kyc={rejectModal}
          onConfirm={handleReject}
          onCancel={() => setRejectModal(null)}
          processing={processing}
        />
      )}
    </div>
  )
}