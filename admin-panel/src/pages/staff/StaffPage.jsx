import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FONTS } from '../../config/brand'
import useAuthStore from '../../store/authStore'
import StaffAPI from './api/staff.api'

// ─── Helpers ─────────────────────────────────────────────
const v  = (val, fb = '—') => (val !== null && val !== undefined && val !== '') ? val : fb
const cap = (s) => s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : '—'
const dt = (d) => d ? new Date(d).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' }) : '—'

// ─── Constants ────────────────────────────────────────────
const ROLE_COLORS = {
  BARBER:  { bg:'#EFF6FF', color:'#1D4ED8' },
  HELPER:  { bg:'#ECFDF5', color:'#065F46' },
  MANAGER: { bg:'#F5F3FF', color:'#6D28D9' },
}
const ROLES    = ['ALL', 'BARBER', 'HELPER', 'MANAGER']
const STATUSES = ['ALL', 'ACTIVE', 'INACTIVE']

const canManage = (l) => ['INDIA', 'STATE'].includes(l)

// ─── Status Modal ─────────────────────────────────────────
function StatusModal({ staff, onConfirm, onCancel, processing }) {
  const [reason, setReason] = useState('')
  const deactivating = staff.isActive
  const canProceed   = !deactivating || reason.trim().length > 0

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.75)', zIndex:2000, display:'flex', alignItems:'center', justifyContent:'center' }}>
      <div style={{ background:'#fff', width:'440px', border:`2px solid ${deactivating?'#DC2626':'#059669'}` }}>
        <div style={{ background:deactivating?'#7F1D1D':'#064E3B', padding:'14px 18px', borderBottom:`2px solid ${deactivating?'#DC2626':'#059669'}` }}>
          <div style={{ color:'#fff', fontWeight:800, fontSize:'13px', letterSpacing:'1px' }}>{deactivating ? 'DEACTIVATE STAFF' : 'ACTIVATE STAFF'}</div>
          <div style={{ color:'rgba(255,255,255,0.6)', fontSize:'10px', marginTop:'2px' }}>{cap(v(staff.name))} — {v(staff.role)}</div>
        </div>
        <div style={{ padding:'20px 18px' }}>
          {deactivating && (
            <div style={{ background:'#FEF2F2', border:'1px solid #FEE2E2', padding:'10px', marginBottom:'14px', fontSize:'11px', color:'#991B1B', fontWeight:600 }}>
              ⚠ Deactivating will prevent this staff from being assigned to bookings.
            </div>
          )}
          <label style={{ fontSize:'10px', color:'#9E8E6E', fontWeight:800, letterSpacing:'1px', display:'block', marginBottom:'6px' }}>
            {deactivating ? 'REASON (REQUIRED)' : 'REASON (OPTIONAL)'}
          </label>
          <textarea value={reason} onChange={e => setReason(e.target.value)}
            placeholder={deactivating ? 'Reason for deactivation...' : 'Why activating...'}
            style={{ width:'100%', border:'1px solid #D4C9B0', padding:'8px 12px', fontSize:'13px', fontFamily:FONTS.body, outline:'none', minHeight:'70px', resize:'vertical', boxSizing:'border-box', marginBottom:'14px' }}
          />
          <div style={{ display:'flex', gap:'8px', justifyContent:'flex-end' }}>
            <button onClick={onCancel} style={{ background:'#fff', border:'1px solid #D4C9B0', color:'#6B5E3E', padding:'8px 16px', fontSize:'11px', fontWeight:700, cursor:'pointer' }}>CANCEL</button>
            <button onClick={() => canProceed && onConfirm(!deactivating, reason)} disabled={processing}
              style={{ background:canProceed?(deactivating?'#DC2626':'#059669'):'#F5F0E8', border:'none', color:canProceed?'#fff':'#C4B49A', padding:'8px 20px', fontSize:'11px', fontWeight:800, cursor:canProceed?'pointer':'not-allowed', opacity:processing?0.7:1 }}>
              {processing ? 'PROCESSING...' : deactivating ? '⊘ DEACTIVATE' : '✓ ACTIVATE'}
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
  <div style={{ display:'grid', gridTemplateColumns:'1.6fr 1.2fr 1.4fr 0.8fr 0.8fr 0.8fr 0.9fr', padding:'12px 14px', borderBottom:'1px solid #F0EAE0', gap:'8px', alignItems:'center' }}>
    {Array.from({length:7}).map((_,i) => (
      <div key={i} style={{ height:'12px', background:'#E8DFD0', borderRadius:'2px', width:i===0?'80%':'60%' }}/>
    ))}
  </div>
)

// ─── Main Page ────────────────────────────────────────────
export default function StaffPage() {
  const navigate   = useNavigate()
  const admin      = useAuthStore(s => s.admin)
  const adminLevel = admin?.adminLevel || 'INDIA'
  const hasManage  = canManage(adminLevel)

  const scope = adminLevel === 'STATE'    ? `State: ${admin?.stateRef?.name || '—'}`
              : adminLevel === 'DISTRICT' ? `District: ${admin?.districtRef?.name || '—'}`
              : 'PAN INDIA'

  const [staff,      setStaff]      = useState([])
  const [summary,    setSummary]    = useState(null)
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState(null)
  const [processing, setProcessing] = useState(false)
  const [pagination, setPagination] = useState({ page:1, limit:20, total:0, totalPages:1 })
  const [search,     setSearch]     = useState('')
  const [role,       setRole]       = useState('ALL')
  const [status,     setStatus]     = useState('ALL')
  const [page,       setPage]       = useState(1)
  const [toast,      setToast]      = useState(null)
  const [modal,      setModal]      = useState(null)

  const showToast = (msg, color = '#059669') => {
    setToast({ msg, color })
    setTimeout(() => setToast(null), 3000)
  }

  const fetchStaff = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = {
        page, limit: 20,
        ...(search && { search }),
        ...(role   !== 'ALL' && { role }),
        ...(status !== 'ALL' && { status }),
      }
      const [res, sumRes] = await Promise.all([
        StaffAPI.getAll(params),
        StaffAPI.getSummary(),
      ])
      setStaff(res.data || [])
      if (res.pagination) setPagination(res.pagination)
      if (sumRes.data)    setSummary(sumRes.data)
    } catch (err) {
      setError(err.message || 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [page, role, status, search])

  useEffect(() => { fetchStaff() }, [fetchStaff])

  const handleStatusConfirm = async (isActive, reason) => {
    const s = modal
    setProcessing(true)
    try {
      await StaffAPI.updateStatus(s.id, {
        isActive,
        reason: reason?.trim() || undefined,
      })
      showToast(
        isActive ? `✓ ${cap(s.name)} activated` : `⊘ ${cap(s.name)} deactivated`,
        isActive ? '#059669' : '#DC2626'
      )
      setModal(null)
      fetchStaff()
    } catch (err) {
      showToast(`⚠ ${err.message}`, '#DC2626')
    } finally {
      setProcessing(false)
    }
  }

  const resetFilters = () => { setSearch(''); setRole('ALL'); setStatus('ALL'); setPage(1) }
  const total = pagination.total || 0

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
          <h1 style={{ fontSize:'13px', fontWeight:800, color:'#fff', margin:0, letterSpacing:'2px' }}>STAFF REGISTRY</h1>
          <span style={{ background:'rgba(184,150,12,0.2)', color:'#B8960C', fontSize:'10px', fontWeight:800, padding:'2px 8px', border:'1px solid rgba(184,150,12,0.3)' }}>
            {loading ? '...' : `${total} TOTAL`}
          </span>
          <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.35)' }}>|</span>
          <span style={{ fontSize:'10px', color:'#B8960C', fontWeight:600 }}>Viewing: {scope}</span>
          {summary && summary.inactive > 0 && (
            <span style={{ background:'rgba(220,38,38,0.2)', color:'#FCA5A5', fontSize:'10px', fontWeight:800, padding:'2px 8px', border:'1px solid rgba(220,38,38,0.3)' }}>
              ⊘ {summary.inactive} INACTIVE
            </span>
          )}
        </div>
        <div style={{ display:'flex', gap:'8px' }}>
          <button onClick={resetFilters} style={{ background:'rgba(255,255,255,0.07)', border:'1px solid rgba(255,255,255,0.15)', color:'rgba(255,255,255,0.6)', padding:'6px 12px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>RESET</button>
          <button onClick={fetchStaff}   style={{ background:'#B8960C', border:'none', color:'#0D1B2A', padding:'6px 14px', fontSize:'10px', fontWeight:800, cursor:'pointer' }}>↻ REFRESH</button>
        </div>
      </div>

      <div style={{ padding:'14px 20px' }}>

        {error && (
          <div style={{ background:'#FEE2E2', border:'1px solid #DC2626', borderLeft:'4px solid #DC2626', padding:'10px 14px', marginBottom:'12px', fontSize:'13px', color:'#991B1B', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
            <span>⚠ {error}</span>
            <button onClick={fetchStaff} style={{ background:'#DC2626', border:'none', color:'#fff', cursor:'pointer', fontWeight:700, padding:'4px 10px', fontSize:'11px' }}>RETRY</button>
          </div>
        )}

        {/* Summary Strip */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:'1px', background:'#D4C9B0', border:'1px solid #D4C9B0', marginBottom:'12px' }}>
          {[
            { label:'Total Staff',       value: loading ? '...' : summary?.total            ?? 0, color:'#B8960C' },
            { label:'Active',            value: loading ? '...' : summary?.active           ?? 0, color:'#059669' },
            { label:'Inactive',          value: loading ? '...' : summary?.inactive         ?? 0, color:'#DC2626' },
            { label:'With Chair',        value: loading ? '...' : summary?.withChair        ?? 0, color:'#7C3AED' },
            { label:'Owner Operators (Barbers)', value: loading ? '...' : summary?.ownerOperators ?? 0, color:'#D97706' },
          ].map(m => (
            <div key={m.label} style={{ background:'#0D1B2A', padding:'12px 16px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <span style={{ fontSize:'11px', color:'rgba(255,255,255,0.4)' }}>{m.label}</span>
              <span style={{ fontSize:'18px', fontWeight:800, color:m.color }}>{m.value}</span>
            </div>
          ))}
        </div>

        {/* Role Cards */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:'10px', marginBottom:'12px' }}>
          {[
            { label:'Barbers',  color:'#1D4ED8', f:'BARBER',  count: summary?.byRole?.barbers  ?? 0 },
            { label:'Helpers',  color:'#065F46', f:'HELPER',  count: summary?.byRole?.helpers  ?? 0 },
            { label:'Managers', color:'#6D28D9', f:'MANAGER', count: summary?.byRole?.managers ?? 0 },
          ].map(s => (
            <div key={s.label} onClick={() => { setRole(s.f); setPage(1) }}
              style={{ background:role===s.f?s.color:'#fff', border:`1px solid ${s.color}30`, borderTop:`2px solid ${s.color}`, padding:'12px', cursor:'pointer', textAlign:'center' }}>
              <div style={{ fontSize:'24px', fontWeight:800, color:role===s.f?'#fff':s.color }}>{loading ? '...' : s.count}</div>
              <div style={{ fontSize:'10px', color:role===s.f?'rgba(255,255,255,0.8)':'#9E8E6E', textTransform:'uppercase', letterSpacing:'0.5px', marginTop:'2px' }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* Filters */}
        <BCard style={{ marginBottom:'12px' }}>
          <BCardHeader title="Filters" action={<span style={{ fontSize:'11px', color:'#B8960C', fontWeight:700, cursor:'pointer' }} onClick={resetFilters}>RESET ALL</span>}/>
          <div style={{ padding:'12px 14px', display:'flex', gap:'8px', alignItems:'center', flexWrap:'wrap' }}>
            <input value={search} onChange={e => setSearch(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && fetchStaff()}
              placeholder="Search name, phone, salon name... (Press Enter)"
              style={{ flex:1, minWidth:'240px', border:'1px solid #D4C9B0', padding:'6px 10px', fontSize:'12px', fontFamily:FONTS.body, outline:'none', background:'#FDFAF6' }}
            />
            {[
              { val:role,   set:v => { setRole(v);   setPage(1) }, opts:ROLES    },
              { val:status, set:v => { setStatus(v); setPage(1) }, opts:STATUSES },
            ].map((f,i) => (
              <select key={i} value={f.val} onChange={e => f.set(e.target.value)}
                style={{ border:'1px solid #D4C9B0', padding:'5px 8px', fontSize:'11px', color:'#6B5E3E', background:'#FDFAF6', cursor:'pointer', fontFamily:FONTS.body, outline:'none' }}>
                {f.opts.map(o => <option key={o}>{o}</option>)}
              </select>
            ))}
            <span style={{ fontSize:'11px', color:'#9E8E6E', fontWeight:600 }}>{loading ? 'Loading...' : `${total} results`}</span>
          </div>
        </BCard>

        {/* Table */}
        <BCard>
          <BCardHeader
            title={`Staff Registry (${total})`}
            action={<span style={{ fontSize:'11px', color:'#9E8E6E' }}>Page {page} of {pagination.totalPages || 1}</span>}
          />
          <div style={{ display:'grid', gridTemplateColumns:'1.6fr 1.2fr 1.4fr 0.8fr 0.7fr 0.8fr 0.9fr', padding:'8px 14px', background:'#F5F0E8', borderBottom:'1px solid #E8DFD0', gap:'8px' }}>
            {['NAME','PHONE','SALON','ROLE','STATUS','SKILLS','ACTIONS'].map(h => (
              <span key={h} style={{ fontSize:'9px', fontWeight:800, color:'#9E8E6E', letterSpacing:'1px' }}>{h}</span>
            ))}
          </div>

          {loading && Array.from({length:6}).map((_,i) => <SkeletonRow key={i}/>)}

          {!loading && staff.length === 0 && !error && (
            <div style={{ padding:'60px', textAlign:'center' }}>
              <div style={{ fontSize:'32px', marginBottom:'12px' }}>👤</div>
              <div style={{ fontSize:'14px', fontWeight:700, color:'#1A1A2E', marginBottom:'6px' }}>No Staff Found</div>
              <div style={{ fontSize:'12px', color:'#9E8E6E' }}>Try changing filters or search term</div>
            </div>
          )}

          {!loading && staff.map((s, i) => {
            const rc = ROLE_COLORS[s.role] || ROLE_COLORS.BARBER
            return (
              <div key={s.id} style={{ display:'grid', gridTemplateColumns:'1.6fr 1.2fr 1.4fr 0.8fr 0.7fr 0.8fr 0.9fr', padding:'10px 14px', borderBottom:'1px solid #F0EAE0', alignItems:'center', gap:'8px', background: !s.isActive ? '#FEF2F2' : i%2===0 ? '#fff' : '#FDFAF6' }}>

                {/* Name */}
                <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
                  <div style={{ width:'28px', height:'28px', background: s.isOwner ? '#B8960C' : '#0D1B2A', display:'flex', alignItems:'center', justifyContent:'center', color: s.isOwner ? '#0D1B2A' : '#B8960C', fontSize:'11px', fontWeight:800, flexShrink:0 }}>
                    {(s.name || '?')[0].toUpperCase()}
                  </div>
                  <div>
                    <div style={{ fontSize:'12px', fontWeight:700, color:'#1A1A2E' }}>{cap(v(s.name))}</div>
                    <div style={{ fontSize:'10px', color:'#9E8E6E', marginTop:'1px' }}>{dt(s.createdAt)}</div>
                  </div>
                </div>

                {/* Phone */}
                <div style={{ fontSize:'11px', color:'#1A1A2E', fontFamily:'monospace' }}>{v(s.phone)}</div>

                {/* Salon */}
                <div>
                  <div style={{ fontSize:'11px', fontWeight:600, color:'#1A1A2E' }}>{v(s.salon?.shopName)}</div>
                  <div style={{ fontSize:'10px', color:'#9E8E6E' }}>{v(s.salon?.district?.name)} • {v(s.salon?.state?.name)}</div>
                </div>

                {/* Role */}
                <span style={{ fontSize:'9px', fontWeight:700, background:rc.bg, color:rc.color, padding:'2px 6px', display:'inline-block' }}>
                  {v(s.role)}
                  {s.isOwner && <span style={{ marginLeft:'4px', fontSize:'8px' }}>★</span>}
                </span>

                {/* Status */}
                <span style={{ fontSize:'9px', fontWeight:800, background:s.isActive?'#D1FAE5':'#FEE2E2', color:s.isActive?'#065F46':'#991B1B', padding:'2px 6px', display:'inline-block' }}>
                  {s.isActive ? 'ACTIVE' : 'INACTIVE'}
                </span>

                {/* Skills count */}
                <span style={{ fontSize:'12px', fontWeight:700, color:'#7C3AED' }}>
                  {s.skills?.length ?? 0} skills
                </span>

                {/* Actions */}
                <div style={{ display:'flex', gap:'3px' }}>
                  <button onClick={() => navigate(`/app/staff/${s.id}`)}
                    style={{ background:'#1A1A2E', color:'#fff', border:'none', padding:'4px 7px', fontSize:'9px', fontWeight:700, cursor:'pointer' }}>VIEW</button>
                  {hasManage && (
                    <button onClick={() => setModal(s)}
                      style={{ background:s.isActive?'#DC2626':'#059669', color:'#fff', border:'none', padding:'4px 7px', fontSize:'9px', fontWeight:700, cursor:'pointer' }}>
                      {s.isActive ? 'DEACT' : 'ACT'}
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
        <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.3)' }}>ZEMISH STAFF REGISTRY v1.0.0</span>
        <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.3)' }}>NATIONAL COMMAND CENTER</span>
      </div>

      {modal && (
        <StatusModal
          staff={modal}
          onConfirm={handleStatusConfirm}
          onCancel={() => setModal(null)}
          processing={processing}
        />
      )}
    </div>
  )
}