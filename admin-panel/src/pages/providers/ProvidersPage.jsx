import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FONTS } from '../../config/brand'
import useAuthStore from '../../store/authStore'
import ProviderAPI from './api/provider.api'

// ─── Helpers ─────────────────────────────────────────────
const v   = (val, fb = '—') => (val !== null && val !== undefined && val !== '') ? val : fb
const dt  = (d) => d ? new Date(d).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' }) : '—'
const maskPhone = (p='') => p && p.length >= 4 ? p.slice(0,2)+'******'+p.slice(-2) : '******'
const maskEmail = (e='') => {
  if (!e || !e.includes('@')) return '***@***'
  const [u, d] = e.split('@')
  return u.slice(0,2)+'***@'+d
}

// ─── Constants ────────────────────────────────────────────
const STATUS_COLORS = {
  ACTIVE:    { bg:'#D1FAE5', color:'#065F46' },
  SUSPENDED: { bg:'#FEF9C3', color:'#92400E' },
  BLOCKED:   { bg:'#FEE2E2', color:'#991B1B' },
}
const STATUSES = ['ALL', 'ACTIVE', 'SUSPENDED', 'BLOCKED']

const canExport  = (l) => ['INDIA', 'STATE'].includes(l)
const canManage  = (l) => ['INDIA', 'STATE'].includes(l)
const canViewPII = (l) => ['INDIA', 'STATE'].includes(l)

// ─── Status Modal ─────────────────────────────────────────
function StatusModal({ provider, onConfirm, onCancel, processing }) {
  const [newStatus, setNewStatus] = useState('SUSPENDED')
  const [reason,    setReason]    = useState('')

  const isBlocked   = provider.accountStatus === 'BLOCKED'
  const isSuspended = provider.accountStatus === 'SUSPENDED'
  const restoring   = isBlocked || isSuspended
  const targetStatus = restoring ? 'ACTIVE' : newStatus

  const borderColor = restoring ? '#059669' : newStatus === 'SUSPENDED' ? '#D97706' : '#DC2626'
  const headerColor = restoring ? '#064E3B' : newStatus === 'SUSPENDED' ? '#78350F' : '#7F1D1D'
  const btnColor    = restoring ? '#059669' : newStatus === 'SUSPENDED' ? '#D97706' : '#DC2626'
  const headerLabel = restoring
    ? (isBlocked ? 'UNBLOCK PROVIDER' : 'REMOVE SUSPENSION')
    : (newStatus === 'SUSPENDED' ? 'SUSPEND PROVIDER' : 'BLOCK PROVIDER')
  const actionLabel = restoring
    ? (isBlocked ? '✓ UNBLOCK' : '✓ REMOVE SUSPENSION')
    : (newStatus === 'SUSPENDED' ? '⚠ SUSPEND' : '⊘ BLOCK')
  const canProceed = restoring ? true : reason.trim().length > 0

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.75)', zIndex:2000, display:'flex', alignItems:'center', justifyContent:'center' }}>
      <div style={{ background:'#fff', width:'460px', border:`2px solid ${borderColor}` }}>
        <div style={{ background:headerColor, padding:'14px 18px', borderBottom:`2px solid ${borderColor}` }}>
          <div style={{ color:'#fff', fontWeight:800, fontSize:'13px', letterSpacing:'1px' }}>{headerLabel}</div>
          <div style={{ color:'rgba(255,255,255,0.6)', fontSize:'10px', marginTop:'2px' }}>{v(provider.name)} — {v(provider.phone)}</div>
        </div>
        <div style={{ padding:'20px 18px' }}>
          {!restoring && (
            <div style={{ marginBottom:'14px' }}>
              <label style={{ fontSize:'10px', color:'#9E8E6E', fontWeight:800, letterSpacing:'1px', display:'block', marginBottom:'8px' }}>ACTION</label>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'8px' }}>
                <button onClick={() => setNewStatus('SUSPENDED')}
                  style={{ padding:'10px', border:`2px solid ${newStatus==='SUSPENDED'?'#D97706':'#E8DFD0'}`, background:newStatus==='SUSPENDED'?'#FFFBEB':'#fff', cursor:'pointer', textAlign:'left' }}>
                  <div style={{ fontSize:'12px', fontWeight:800, color:'#D97706' }}>⚠ SUSPEND</div>
                  <div style={{ fontSize:'10px', color:'#9E8E6E', marginTop:'3px' }}>Temporary restriction</div>
                </button>
                <button onClick={() => setNewStatus('BLOCKED')}
                  style={{ padding:'10px', border:`2px solid ${newStatus==='BLOCKED'?'#DC2626':'#E8DFD0'}`, background:newStatus==='BLOCKED'?'#FEF2F2':'#fff', cursor:'pointer', textAlign:'left' }}>
                  <div style={{ fontSize:'12px', fontWeight:800, color:'#DC2626' }}>⊘ BLOCK</div>
                  <div style={{ fontSize:'10px', color:'#9E8E6E', marginTop:'3px' }}>Permanent action</div>
                </button>
              </div>
            </div>
          )}
          <label style={{ fontSize:'10px', color:'#9E8E6E', fontWeight:800, letterSpacing:'1px', display:'block', marginBottom:'6px' }}>
            {restoring ? 'REASON (OPTIONAL)' : 'REASON (REQUIRED)'}
          </label>
          <textarea value={reason} onChange={e => setReason(e.target.value)}
            placeholder={restoring ? 'Why restoring...' : newStatus === 'SUSPENDED' ? 'Reason for suspension...' : 'Reason for blocking...'}
            style={{ width:'100%', border:'1px solid #D4C9B0', padding:'8px 12px', fontSize:'13px', fontFamily:FONTS.body, outline:'none', minHeight:'70px', resize:'vertical', boxSizing:'border-box', marginBottom:'14px' }}
          />
          <div style={{ display:'flex', gap:'8px', justifyContent:'flex-end' }}>
            <button onClick={onCancel} style={{ background:'#fff', border:'1px solid #D4C9B0', color:'#6B5E3E', padding:'8px 16px', fontSize:'11px', fontWeight:700, cursor:'pointer' }}>CANCEL</button>
            <button onClick={() => canProceed && onConfirm(targetStatus, reason)} disabled={processing}
              style={{ background:canProceed?btnColor:'#F5F0E8', border:'none', color:canProceed?'#fff':'#C4B49A', padding:'8px 20px', fontSize:'11px', fontWeight:800, cursor:canProceed?'pointer':'not-allowed', opacity:processing?0.7:1 }}>
              {processing ? 'PROCESSING...' : actionLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
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

const SkeletonRow = () => (
  <div style={{ display:'grid', gridTemplateColumns:'1.6fr 1.2fr 1.4fr 0.6fr 0.6fr 0.8fr 0.8fr 0.9fr', padding:'12px 14px', borderBottom:'1px solid #F0EAE0', gap:'8px', alignItems:'center' }}>
    {Array.from({length:8}).map((_,i) => (
      <div key={i} style={{ height:'12px', background:'#E8DFD0', borderRadius:'2px', width:i===0?'80%':'60%', animation:'pulse 1.5s ease-in-out infinite' }}/>
    ))}
  </div>
)

// ─── Main Page ────────────────────────────────────────────
export default function ProvidersPage() {
  const navigate   = useNavigate()
  const admin      = useAuthStore(s => s.admin)
  const adminLevel = admin?.adminLevel || 'INDIA'

  const hasExport  = canExport(adminLevel)
  const hasManage  = canManage(adminLevel)
  const hasPII     = canViewPII(adminLevel)

  const scope = adminLevel === 'STATE'    ? `State: ${admin?.stateRef?.name || '—'}`
              : adminLevel === 'DISTRICT' ? `District: ${admin?.districtRef?.name || '—'}`
              : 'PAN INDIA'

  const [providers,  setProviders]  = useState([])
  const [summary,    setSummary]    = useState(null)
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState(null)
  const [processing, setProcessing] = useState(false)
  const [pagination, setPagination] = useState({ page:1, limit:20, total:0, totalPages:1 })
  const [search,     setSearch]     = useState('')
  const [status,     setStatus]     = useState('ALL')
  const [page,       setPage]       = useState(1)
  const [toast,      setToast]      = useState(null)
  const [modal,      setModal]      = useState(null)

  const showToast = (msg, color = '#059669') => {
    setToast({ msg, color })
    setTimeout(() => setToast(null), 3000)
  }

  const fetchProviders = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = {
        page, limit: 20,
        ...(search && { search }),
        ...(status !== 'ALL' && { status }),
      }
      const [res, sumRes] = await Promise.all([
        ProviderAPI.getAll(params),
        ProviderAPI.getSummary(),
      ])
      setProviders(res.data || [])
      if (res.pagination) setPagination(res.pagination)
      if (sumRes.data)    setSummary(sumRes.data)
    } catch (err) {
      setError(err.message || 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [page, status, search])

  useEffect(() => { fetchProviders() }, [fetchProviders])

  const handleStatusConfirm = async (targetStatus, reason) => {
    const p = modal
    setProcessing(true)
    try {
      await ProviderAPI.updateStatus(p.id, {
        status: targetStatus,
        reason: reason?.trim() || undefined,
      })
      const msg = targetStatus === 'ACTIVE'    ? `✓ ${v(p.name)} restored`
                : targetStatus === 'SUSPENDED' ? `⚠ ${v(p.name)} suspended`
                : `⊘ ${v(p.name)} blocked`
      const color = targetStatus === 'ACTIVE' ? '#059669' : targetStatus === 'SUSPENDED' ? '#D97706' : '#DC2626'
      showToast(msg, color)
      setModal(null)
      fetchProviders()
    } catch (err) {
      showToast(`⚠ ${err.message}`, '#DC2626')
    } finally {
      setProcessing(false)
    }
  }

  const resetFilters = () => { setSearch(''); setStatus('ALL'); setPage(1) }
  const total     = pagination.total || 0
  const blocked   = summary?.blocked   ?? 0
  const suspended = summary?.suspended ?? 0

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
          <h1 style={{ fontSize:'13px', fontWeight:800, color:'#fff', margin:0, letterSpacing:'2px' }}>PROVIDER REGISTRY</h1>
          <span style={{ background:'rgba(184,150,12,0.2)', color:'#B8960C', fontSize:'10px', fontWeight:800, padding:'2px 8px', border:'1px solid rgba(184,150,12,0.3)' }}>
            {loading ? '...' : `${total} TOTAL`}
          </span>
          <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.35)' }}>|</span>
          <span style={{ fontSize:'10px', color:'#B8960C', fontWeight:600 }}>Viewing: {scope}</span>
          {blocked   > 0 && <span style={{ background:'rgba(220,38,38,0.2)',   color:'#FCA5A5', fontSize:'10px', fontWeight:800, padding:'2px 8px', border:'1px solid rgba(220,38,38,0.3)'  }}>⊘ {blocked} BLOCKED</span>}
          {suspended > 0 && <span style={{ background:'rgba(234,179,8,0.2)',   color:'#FDE68A', fontSize:'10px', fontWeight:800, padding:'2px 8px', border:'1px solid rgba(234,179,8,0.3)'  }}>⚠ {suspended} SUSPENDED</span>}
          {!hasPII && <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.3)', fontStyle:'italic' }}>PII masked</span>}
        </div>
        <div style={{ display:'flex', gap:'8px' }}>
          <button onClick={() => navigate('/app/kyc')} style={{ background:'rgba(217,119,6,0.15)', border:'1px solid rgba(217,119,6,0.4)', color:'#FDE68A', padding:'6px 12px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>KYC QUEUE ▸</button>
          {hasExport
            ? <button onClick={() => showToast('Export — Coming Soon', '#D97706')} style={{ background:'rgba(255,255,255,0.07)', border:'1px solid rgba(255,255,255,0.15)', color:'rgba(255,255,255,0.6)', padding:'6px 12px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>↓ EXPORT</button>
            : <div style={{ background:'rgba(220,38,38,0.1)', border:'1px solid rgba(220,38,38,0.2)', color:'rgba(220,38,38,0.5)', padding:'6px 12px', fontSize:'10px', fontWeight:700 }}>⊘ NO EXPORT</div>
          }
          <button onClick={resetFilters} style={{ background:'rgba(255,255,255,0.07)', border:'1px solid rgba(255,255,255,0.15)', color:'rgba(255,255,255,0.6)', padding:'6px 12px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>RESET</button>
          <button onClick={fetchProviders} style={{ background:'#B8960C', border:'none', color:'#0D1B2A', padding:'6px 14px', fontSize:'10px', fontWeight:800, cursor:'pointer' }}>↻ REFRESH</button>
        </div>
      </div>

      <div style={{ padding:'14px 20px' }}>

        {error && (
          <div style={{ background:'#FEE2E2', border:'1px solid #DC2626', borderLeft:'4px solid #DC2626', padding:'10px 14px', marginBottom:'12px', fontSize:'13px', color:'#991B1B', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
            <span>⚠ {error}</span>
            <button onClick={fetchProviders} style={{ background:'#DC2626', border:'none', color:'#fff', cursor:'pointer', fontWeight:700, padding:'4px 10px', fontSize:'11px' }}>RETRY</button>
          </div>
        )}

        {/* Summary Strip */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:'1px', background:'#D4C9B0', border:'1px solid #D4C9B0', marginBottom:'12px' }}>
          {[
            { label:'Total Providers', value: loading ? '...' : summary?.total              ?? 0, color:'#B8960C' },
            { label:'Active',          value: loading ? '...' : summary?.active             ?? 0, color:'#059669' },
            { label:'Blocked',         value: loading ? '...' : summary?.blocked            ?? 0, color:'#DC2626' },
            { label:'Total Salons',    value: loading ? '...' : summary?.salons?.total      ?? 0, color:'#7C3AED' },
            { label:'Active Salons',   value: loading ? '...' : summary?.salons?.active     ?? 0, color:'#2563EB' },
          ].map(m => (
            <div key={m.label} style={{ background:'#0D1B2A', padding:'12px 16px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <span style={{ fontSize:'11px', color:'rgba(255,255,255,0.4)' }}>{m.label}</span>
              <span style={{ fontSize:'18px', fontWeight:800, color:m.color }}>{m.value}</span>
            </div>
          ))}
        </div>

        {/* Stats Cards */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:'10px', marginBottom:'12px' }}>
          {[
            { label:'Total',     color:'#1A1A2E', f:'ALL',       count: summary?.total     ?? 0 },
            { label:'Active',    color:'#059669', f:'ACTIVE',    count: summary?.active    ?? 0 },
            { label:'Suspended', color:'#D97706', f:'SUSPENDED', count: summary?.suspended ?? 0 },
            { label:'Blocked',   color:'#DC2626', f:'BLOCKED',   count: summary?.blocked   ?? 0 },
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
              onKeyDown={e => e.key === 'Enter' && fetchProviders()}
              placeholder="Search name, phone, email... (Press Enter)"
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
            title={`Provider Registry (${total})`}
            action={<span style={{ fontSize:'11px', color:'#9E8E6E' }}>Page {page} of {pagination.totalPages || 1}</span>}
          />
          <div style={{ display:'grid', gridTemplateColumns:'1.6fr 1.2fr 1.4fr 0.6fr 0.6fr 0.8fr 0.8fr 0.9fr', padding:'8px 14px', background:'#F5F0E8', borderBottom:'1px solid #E8DFD0', gap:'8px' }}>
            {['NAME','PHONE','EMAIL','SALONS','STATUS','VERIFIED','JOINED','ACTIONS'].map(h => (
              <span key={h} style={{ fontSize:'9px', fontWeight:800, color:'#9E8E6E', letterSpacing:'1px' }}>{h}</span>
            ))}
          </div>

          {loading && Array.from({length:6}).map((_,i) => <SkeletonRow key={i}/>)}

          {!loading && providers.length === 0 && !error && (
            <div style={{ padding:'60px', textAlign:'center' }}>
              <div style={{ fontSize:'32px', marginBottom:'12px' }}>⊙</div>
              <div style={{ fontSize:'14px', fontWeight:700, color:'#1A1A2E', marginBottom:'6px' }}>No Providers Found</div>
              <div style={{ fontSize:'12px', color:'#9E8E6E' }}>Try changing filters or search term</div>
            </div>
          )}

          {!loading && providers.map((p, i) => {
            const sc = STATUS_COLORS[p.accountStatus] || { bg:'#F3F4F6', color:'#374151' }
            const rowBg = p.accountStatus === 'BLOCKED'   ? '#FEF2F2'
                        : p.accountStatus === 'SUSPENDED' ? '#FFFBEB'
                        : i%2===0 ? '#fff' : '#FDFAF6'
            return (
              <div key={p.id} style={{ display:'grid', gridTemplateColumns:'1.6fr 1.2fr 1.4fr 0.6fr 0.6fr 0.8fr 0.8fr 0.9fr', padding:'10px 14px', borderBottom:'1px solid #F0EAE0', alignItems:'center', gap:'8px', background:rowBg }}>

                {/* Name */}
                <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
                  <div style={{ width:'28px', height:'28px', background:'#0D1B2A', display:'flex', alignItems:'center', justifyContent:'center', color:'#B8960C', fontSize:'11px', fontWeight:800, flexShrink:0 }}>
                    {(p.name || '?')[0].toUpperCase()}
                  </div>
                  <div>
                    <div style={{ fontSize:'12px', fontWeight:700, color:'#1A1A2E' }}>{v(p.name)}</div>
                    <div style={{ fontSize:'10px', color:'#9E8E6E', marginTop:'1px' }}>{dt(p.createdAt)}</div>
                  </div>
                </div>

                {/* Phone */}
                <div style={{ fontSize:'11px', color:'#1A1A2E', fontFamily:'monospace' }}>
                  {hasPII ? v(p.phone) : maskPhone(p.phone || '')}
                </div>

                {/* Email */}
                <div style={{ fontSize:'11px', color:'#6B5E3E', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                  {hasPII ? v(p.email) : p.email ? maskEmail(p.email) : '—'}
                </div>

                {/* Salons */}
                <div style={{ textAlign:'center' }}>
                  <div style={{ fontSize:'14px', fontWeight:800, color:'#7C3AED' }}>{p.salonCount ?? 0}</div>
                  <div style={{ fontSize:'9px', color:'#9E8E6E' }}>salons</div>
                </div>

                {/* Status */}
                <span style={{ fontSize:'9px', fontWeight:800, background:sc.bg, color:sc.color, padding:'2px 6px', display:'inline-block' }}>
                  {v(p.accountStatus)}
                </span>

                {/* Verified */}
                <div style={{ display:'flex', gap:'4px' }}>
                  <span style={{ fontSize:'9px', color: p.verification?.phone ? '#059669' : '#DC2626', fontWeight:700 }}>{p.verification?.phone ? '📱✓' : '📱✗'}</span>
                  <span style={{ fontSize:'9px', color: p.verification?.email ? '#059669' : '#DC2626', fontWeight:700 }}>{p.verification?.email ? '✉✓' : '✉✗'}</span>
                </div>

                {/* Joined */}
                <div style={{ fontSize:'10px', color:'#9E8E6E' }}>{dt(p.createdAt)}</div>

                {/* Actions */}
                <div style={{ display:'flex', gap:'3px' }}>
                  <button onClick={() => navigate(`/app/providers/${p.id}`)}
                    style={{ background:'#1A1A2E', color:'#fff', border:'none', padding:'4px 7px', fontSize:'9px', fontWeight:700, cursor:'pointer' }}>VIEW</button>
                  {hasManage && (
                    <button onClick={() => setModal(p)}
                      style={{ background: p.accountStatus==='BLOCKED'?'#059669':p.accountStatus==='SUSPENDED'?'#D97706':'#DC2626', color:'#fff', border:'none', padding:'4px 7px', fontSize:'9px', fontWeight:700, cursor:'pointer' }}>
                      {p.accountStatus==='BLOCKED'?'UNBLOCK':p.accountStatus==='SUSPENDED'?'UNSUSPEND':'MANAGE'}
                    </button>
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
                const total = pagination.totalPages || 1
                const delta = 2
                const pages = []
                const left  = Math.max(2, page - delta)
                const right = Math.min(total - 1, page + delta)
                pages.push(1)
                if (left > 2) pages.push('...')
                for (let i = left; i <= right; i++) pages.push(i)
                if (right < total - 1) pages.push('...')
                if (total > 1) pages.push(total)
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
      </div>

      <div style={{ background:'#0D1B2A', borderTop:'2px solid #B8960C', padding:'10px 20px', display:'flex', justifyContent:'space-between', marginTop:'14px' }}>
        <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.3)' }}>ZEMISH PROVIDER REGISTRY v2.0.0</span>
        <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.3)' }}>NATIONAL COMMAND CENTER</span>
      </div>

      {modal && (
        <StatusModal
          provider={modal}
          onConfirm={handleStatusConfirm}
          onCancel={() => setModal(null)}
          processing={processing}
        />
      )}
    </div>
  )
}