import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FONTS } from '../../config/brand'
import useAuthStore from '../../store/authStore'
import UsersAPI from './api/users.api'

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
  ACTIVE:    { bg: '#D1FAE5', color: '#065F46' },
  SUSPENDED: { bg: '#FEF9C3', color: '#92400E' },
  BLOCKED:   { bg: '#FEE2E2', color: '#991B1B' },
}
const ROLE_COLORS = {
  USER:       { bg: '#EFF6FF', color: '#1D4ED8' },
  OWNER:      { bg: '#F5F3FF', color: '#6D28D9' },
  BARBER:     { bg: '#ECFDF5', color: '#065F46' },
  FIELD_STAFF:{ bg: '#FEF9C3', color: '#92400E' },
}

const ROLES    = ['ALL', 'USER', 'OWNER', 'BARBER', 'FIELD_STAFF']
const STATUSES = ['ALL', 'ACTIVE', 'SUSPENDED', 'BLOCKED']

const canBlock   = (l) => ['INDIA', 'STATE'].includes(l)
const canViewPII = (l) => ['INDIA', 'STATE'].includes(l)
const canExport  = (l) => ['INDIA', 'STATE'].includes(l)

// ─── Components ──────────────────────────────────────────
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
const Sel = ({ value, onChange, options }) => (
  <select value={value} onChange={e => onChange(e.target.value)}
    style={{ fontSize:'11px', border:'1px solid #D4C9B0', padding:'5px 8px', color:'#6B5E3E', background:'#FDFAF6', cursor:'pointer', fontFamily:FONTS.body, outline:'none' }}>
    {options.map(o => <option key={o}>{o}</option>)}
  </select>
)

// ─── Block Modal ──────────────────────────────────────────
function BlockModal({ user, onConfirm, onCancel, processing }) {
  const [reason,    setReason]    = useState('')
  const [newStatus, setNewStatus] = useState('BLOCKED')

  const isBlocked   = user.accountStatus === 'BLOCKED'
  const isSuspended = user.accountStatus === 'SUSPENDED'
  const isActive    = user.accountStatus === 'ACTIVE'

  // If already blocked/suspended → restore to ACTIVE
  const restoring   = isBlocked || isSuspended
  const targetStatus = restoring ? 'ACTIVE' : newStatus

  const borderColor = restoring ? '#059669' : newStatus === 'SUSPENDED' ? '#D97706' : '#DC2626'
  const headerColor = restoring ? '#064E3B' : newStatus === 'SUSPENDED' ? '#78350F'  : '#7F1D1D'
  const btnColor    = restoring ? '#059669' : newStatus === 'SUSPENDED' ? '#D97706'  : '#DC2626'
  const headerLabel = restoring
    ? (isBlocked ? 'UNBLOCK USER' : 'REMOVE SUSPENSION')
    : (newStatus === 'SUSPENDED' ? 'SUSPEND USER' : 'BLOCK USER')
  const actionLabel = restoring
    ? (isBlocked ? '✓ UNBLOCK' : '✓ REMOVE SUSPENSION')
    : (newStatus === 'SUSPENDED' ? '⚠ SUSPEND' : '⊘ BLOCK')

  const canProceed = restoring ? true : reason.trim().length > 0

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.75)', zIndex:2000, display:'flex', alignItems:'center', justifyContent:'center' }}>
      <div style={{ background:'#fff', width:'460px', border:`2px solid ${borderColor}` }}>
        <div style={{ background:headerColor, padding:'14px 18px', borderBottom:`2px solid ${borderColor}` }}>
          <div style={{ color:'#fff', fontWeight:800, fontSize:'13px', letterSpacing:'1px' }}>{headerLabel}</div>
          <div style={{ color:'rgba(255,255,255,0.6)', fontSize:'10px', marginTop:'2px' }}>{v(user.name)} — {v(user.phone)}</div>
        </div>
        <div style={{ padding:'20px 18px' }}>

          {/* Action Selector — only for ACTIVE users */}
          {isActive && (
            <div style={{ marginBottom:'14px' }}>
              <label style={{ fontSize:'10px', color:'#9E8E6E', fontWeight:800, letterSpacing:'1px', display:'block', marginBottom:'8px' }}>ACTION</label>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'8px' }}>
                <button onClick={() => setNewStatus('SUSPENDED')}
                  style={{ padding:'10px', border:`2px solid ${newStatus==='SUSPENDED'?'#D97706':'#E8DFD0'}`, background:newStatus==='SUSPENDED'?'#FFFBEB':'#fff', cursor:'pointer', textAlign:'left' }}>
                  <div style={{ fontSize:'12px', fontWeight:800, color:'#D97706' }}>⚠ SUSPEND</div>
                  <div style={{ fontSize:'10px', color:'#9E8E6E', marginTop:'3px' }}>Temporary — user can be restored</div>
                </button>
                <button onClick={() => setNewStatus('BLOCKED')}
                  style={{ padding:'10px', border:`2px solid ${newStatus==='BLOCKED'?'#DC2626':'#E8DFD0'}`, background:newStatus==='BLOCKED'?'#FEF2F2':'#fff', cursor:'pointer', textAlign:'left' }}>
                  <div style={{ fontSize:'12px', fontWeight:800, color:'#DC2626' }}>⊘ BLOCK</div>
                  <div style={{ fontSize:'10px', color:'#9E8E6E', marginTop:'3px' }}>Permanent — severe action</div>
                </button>
              </div>
            </div>
          )}

          {/* Warning */}
          {!restoring && (
            <div style={{ background: newStatus==='SUSPENDED'?'#FFFBEB':'#FEF2F2', border:`1px solid ${newStatus==='SUSPENDED'?'#FDE68A':'#FEE2E2'}`, padding:'10px', marginBottom:'14px', fontSize:'11px', color:newStatus==='SUSPENDED'?'#92400E':'#991B1B', fontWeight:600 }}>
              {newStatus==='SUSPENDED'
                ? '⚠ Suspending will temporarily restrict user access. Can be removed later.'
                : '⊘ Blocking will permanently prevent user from making bookings.'}
            </div>
          )}
          {restoring && isSuspended && (
            <div style={{ background:'#FFFBEB', border:'1px solid #FDE68A', padding:'10px', marginBottom:'14px', fontSize:'11px', color:'#92400E', fontWeight:600 }}>
              ⚠ Removing suspension will restore user to ACTIVE status.
            </div>
          )}

          <label style={{ fontSize:'10px', color:'#9E8E6E', fontWeight:800, letterSpacing:'1px', display:'block', marginBottom:'6px' }}>
            {restoring ? 'REASON (OPTIONAL)' : 'REASON (REQUIRED)'}
          </label>
          <textarea value={reason} onChange={e => setReason(e.target.value)}
            placeholder={
              isBlocked   ? 'Why unblocking...' :
              isSuspended ? 'Why removing suspension...' :
              newStatus==='SUSPENDED' ? 'Reason for suspension...' :
              'Reason for blocking...'
            }
            style={{ width:'100%', border:'1px solid #D4C9B0', padding:'8px 12px', fontSize:'13px', fontFamily:FONTS.body, outline:'none', minHeight:'70px', resize:'vertical', boxSizing:'border-box', marginBottom:'14px' }}
          />
          <div style={{ display:'flex', gap:'8px', justifyContent:'flex-end' }}>
            <button onClick={onCancel} style={{ background:'#fff', border:'1px solid #D4C9B0', color:'#6B5E3E', padding:'8px 16px', fontSize:'11px', fontWeight:700, cursor:'pointer' }}>CANCEL</button>
            <button onClick={() => canProceed && onConfirm(reason, targetStatus)} disabled={processing}
              style={{ background:canProceed?btnColor:'#F5F0E8', border:'none', color:canProceed?'#fff':'#C4B49A', padding:'8px 20px', fontSize:'11px', fontWeight:800, cursor:canProceed?'pointer':'not-allowed', opacity:processing?0.7:1 }}>
              {processing ? 'PROCESSING...' : actionLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────
export default function UsersPage() {
  const navigate   = useNavigate()
  const admin      = useAuthStore(s => s.admin)
  const adminLevel = admin?.adminLevel || 'INDIA'

  const hasBlock   = canBlock(adminLevel)
  const hasPII     = canViewPII(adminLevel)
  const hasExport  = canExport(adminLevel)

  const scope = adminLevel === 'STATE'    ? `State: ${admin?.stateRef?.name || '—'}`
              : adminLevel === 'DISTRICT' ? `District: ${admin?.districtRef?.name || '—'}`
              : 'PAN INDIA'

  const [users,       setUsers]       = useState([])
  const [summary,     setSummary]     = useState(null)
  const [loading,     setLoading]     = useState(true)
  const [error,       setError]       = useState(null)
  const [processing,  setProcessing]  = useState(false)
  const [pagination,  setPagination]  = useState({ page:1, limit:20, total:0, totalPages:1 })
  const [search,      setSearch]      = useState('')
  const [role,        setRole]        = useState('ALL')
  const [status,      setStatus]      = useState('ALL')
  const [page,        setPage]        = useState(1)
  const [toast,       setToast]       = useState(null)
  const [blockModal,  setBlockModal]  = useState(null)

  const showToast = (msg, color = '#059669') => {
    setToast({ msg, color })
    setTimeout(() => setToast(null), 3000)
  }

  const fetchUsers = useCallback(async () => {
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
        UsersAPI.getAll(params),
        UsersAPI.getSummary(),
      ])
      setUsers(res.data || [])
      if (res.pagination) setPagination(res.pagination)
      if (sumRes.data)    setSummary(sumRes.data)
    } catch (err) {
      setError(err.message || 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [page, role, status, search])

  useEffect(() => { fetchUsers() }, [fetchUsers])

  const handleBlockConfirm = async (reason, targetStatus) => {
    const u = blockModal

    if (!['ACTIVE', 'SUSPENDED', 'BLOCKED'].includes(targetStatus)) {
      showToast('⚠ Invalid status', '#D97706')
      return
    }

    const restoring = ['BLOCKED', 'SUSPENDED'].includes(u.accountStatus)
    if (!restoring && !reason?.trim()) {
      showToast('⚠ Reason required', '#D97706')
      return
    }

    setProcessing(true)
    try {
      await UsersAPI.updateStatus(u.id, {
        status: targetStatus,
        reason: reason?.trim() || undefined,
      })
      const msg = targetStatus === 'ACTIVE'     ? `✓ ${u.name} restored to active`
                : targetStatus === 'SUSPENDED'  ? `⚠ ${u.name} suspended`
                : `⊘ ${u.name} blocked`
      const color = targetStatus === 'ACTIVE' ? '#059669' : targetStatus === 'SUSPENDED' ? '#D97706' : '#DC2626'
      showToast(msg, color)
      setBlockModal(null)
      fetchUsers()
    } catch (err) {
      showToast(`⚠ ${err.message}`, '#DC2626')
    } finally {
      setProcessing(false)
    }
  }

  const resetFilters = () => { setSearch(''); setRole('ALL'); setStatus('ALL'); setPage(1) }

  const total     = pagination.total || 0
  const blocked   = users.filter(u => u.accountStatus === 'BLOCKED').length
  const suspended = users.filter(u => u.accountStatus === 'SUSPENDED').length

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
          <h1 style={{ fontSize:'13px', fontWeight:800, color:'#fff', margin:0, letterSpacing:'2px' }}>USERS REGISTRY</h1>
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
          {hasExport
            ? <button onClick={() => showToast('Export — Coming Soon', '#D97706')} style={{ background:'rgba(255,255,255,0.07)', border:'1px solid rgba(255,255,255,0.15)', color:'rgba(255,255,255,0.6)', padding:'6px 12px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>↓ EXPORT</button>
            : <div style={{ background:'rgba(220,38,38,0.1)', border:'1px solid rgba(220,38,38,0.2)', color:'rgba(220,38,38,0.5)', padding:'6px 12px', fontSize:'10px', fontWeight:700 }}>⊘ NO EXPORT</div>
          }
          <button onClick={resetFilters} style={{ background:'rgba(255,255,255,0.07)', border:'1px solid rgba(255,255,255,0.15)', color:'rgba(255,255,255,0.6)', padding:'6px 12px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>RESET</button>
          <button onClick={fetchUsers} style={{ background:'#B8960C', border:'none', color:'#0D1B2A', padding:'6px 14px', fontSize:'10px', fontWeight:800, cursor:'pointer' }}>↻ REFRESH</button>
        </div>
      </div>

      <div style={{ padding:'14px 20px' }}>

        {error && (
          <div style={{ background:'#FEE2E2', border:'1px solid #DC2626', borderLeft:'4px solid #DC2626', padding:'10px 14px', marginBottom:'12px', fontSize:'13px', color:'#991B1B' }}>
            ⚠ {error} — <button onClick={fetchUsers} style={{ background:'none', border:'none', color:'#DC2626', cursor:'pointer', fontWeight:700, textDecoration:'underline' }}>Retry</button>
          </div>
        )}

        {/* Summary Strip */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:'1px', background:'#D4C9B0', border:'1px solid #D4C9B0', marginBottom:'12px' }}>
          {[
            { label:'Total Users',  value: loading ? '...' : summary?.total     ?? total,     color:'#B8960C' },
            { label:'Blocked',      value: loading ? '...' : summary?.blocked    ?? 0,         color:'#DC2626' },
            { label:'Suspended',    value: loading ? '...' : summary?.suspended  ?? 0,         color:'#D97706' },
            { label:'Active',       value: loading ? '...' : summary?.active     ?? 0,         color:'#059669' },
          ].map(m => (
            <div key={m.label} style={{ background:'#0D1B2A', padding:'12px 16px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <span style={{ fontSize:'11px', color:'rgba(255,255,255,0.4)' }}>{m.label}</span>
              <span style={{ fontSize:'18px', fontWeight:800, color:m.color }}>{m.value}</span>
            </div>
          ))}
        </div>

        {/* Stats */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:'10px', marginBottom:'12px' }}>
          {[
            { label:'Total',     count: summary?.total     ?? total, color:'#1A1A2E', f:'ALL',        isRole: false },
            { label:'Active',    count: summary?.active    ?? 0,     color:'#065F46', f:'ACTIVE',     isRole: false },
            { label:'Suspended', count: summary?.suspended ?? 0,     color:'#D97706', f:'SUSPENDED',  isRole: false },
            { label:'Blocked',   count: summary?.blocked   ?? 0,     color:'#DC2626', f:'BLOCKED',    isRole: false },
            { label:'Owners',    count: summary?.byRole?.owners ?? 0,color:'#6D28D9', f:'OWNER',      isRole: true  },
          ].map(s => (
            <div key={s.label}
              onClick={() => { s.isRole ? (setRole('OWNER'), setStatus('ALL')) : (setStatus(s.f), setRole('ALL')); setPage(1) }}
              style={{ background: (!s.isRole && status===s.f) || (s.isRole && role==='OWNER') ? s.color : '#fff', border:`1px solid ${s.color}30`, borderTop:`2px solid ${s.color}`, padding:'12px 14px', cursor:'pointer', textAlign:'center' }}>
              <div style={{ fontSize:'22px', fontWeight:800, color: (!s.isRole && status===s.f) || (s.isRole && role==='OWNER') ? '#fff' : s.color }}>
                {loading ? '...' : s.count}
              </div>
              <div style={{ fontSize:'9px', color: (!s.isRole && status===s.f) || (s.isRole && role==='OWNER') ? 'rgba(255,255,255,0.8)' : '#9E8E6E', textTransform:'uppercase', letterSpacing:'0.5px', marginTop:'2px' }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* Filters */}
        <BCard style={{ marginBottom:'12px' }}>
          <BCardHeader title="Filters" action={<span style={{ fontSize:'11px', color:'#B8960C', fontWeight:700, cursor:'pointer' }} onClick={resetFilters}>RESET ALL</span>}/>
          <div style={{ padding:'12px 14px', display:'flex', gap:'8px', alignItems:'center', flexWrap:'wrap' }}>
            <input value={search} onChange={e => setSearch(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && fetchUsers()}
              placeholder="Search name, phone, email... (Press Enter)"
              style={{ flex:1, minWidth:'240px', border:'1px solid #D4C9B0', padding:'6px 10px', fontSize:'12px', fontFamily:FONTS.body, outline:'none', background:'#FDFAF6' }}
            />
            <Sel value={role}   onChange={v => { setRole(v);   setPage(1) }} options={ROLES}    />
            <Sel value={status} onChange={v => { setStatus(v); setPage(1) }} options={STATUSES} />
            <span style={{ fontSize:'11px', color:'#9E8E6E', fontWeight:600 }}>{loading ? 'Loading...' : `${total} results`}</span>
          </div>
        </BCard>

        {/* Table */}
        <BCard>
          <BCardHeader
            title={`User Registry (${total})`}
            action={<span style={{ fontSize:'11px', color:'#9E8E6E' }}>Page {page} of {pagination.totalPages || 1}</span>}
          />
          <div style={{ display:'grid', gridTemplateColumns:'1.8fr 1.2fr 1.5fr 0.7fr 0.8fr 0.8fr 0.8fr 0.8fr 1fr', padding:'8px 14px', background:'#F5F0E8', borderBottom:'1px solid #E8DFD0', gap:'8px' }}>
            {['NAME','PHONE','EMAIL','ROLE','STATUS','WALLET','POINTS','VERIFIED','ACTIONS'].map(h => (
              <span key={h} style={{ fontSize:'9px', fontWeight:800, color:'#9E8E6E', letterSpacing:'1px' }}>{h}</span>
            ))}
          </div>

          {loading && <div style={{ padding:'40px', textAlign:'center', color:'#9E8E6E' }}>Loading users...</div>}
          {!loading && users.length === 0 && !error && (
            <div style={{ padding:'40px', textAlign:'center', color:'#9E8E6E' }}>No users found</div>
          )}

          {!loading && users.map((u, i) => {
            const st = STATUS_COLORS[u.accountStatus] || STATUS_COLORS.ACTIVE
            const rt = ROLE_COLORS[u.role]            || ROLE_COLORS.USER
            const rowBg = u.accountStatus === 'BLOCKED'   ? '#FEF2F2'
                        : u.accountStatus === 'SUSPENDED' ? '#FFFBEB'
                        : i%2===0 ? '#fff' : '#FDFAF6'
            return (
              <div key={u.id} style={{ display:'grid', gridTemplateColumns:'1.8fr 1.2fr 1.5fr 0.7fr 0.8fr 0.8fr 0.8fr 0.8fr 1fr', padding:'10px 14px', borderBottom:'1px solid #F0EAE0', alignItems:'center', gap:'8px', background:rowBg }}>

                {/* Name */}
                <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
                  <div style={{ width:'26px', height:'26px', background:'#0D1B2A', display:'flex', alignItems:'center', justifyContent:'center', color:'#B8960C', fontSize:'10px', fontWeight:800, flexShrink:0 }}>
                    {(u.name||'?')[0].toUpperCase()}
                  </div>
                  <div>
                    <div style={{ fontSize:'12px', fontWeight:700, color:'#1A1A2E' }}>{v(u.name)}</div>
                    <div style={{ fontSize:'10px', color:'#9E8E6E', marginTop:'1px' }}>{dt(u.createdAt)}</div>
                  </div>
                </div>

                {/* Phone — PII masked for DISTRICT */}
                <div style={{ fontSize:'11px', color:'#1A1A2E', fontFamily:'monospace' }}>
                  {hasPII ? v(u.phone) : maskPhone(u.phone || '')}
                </div>

                {/* Email — PII masked for DISTRICT */}
                <div style={{ fontSize:'11px', color:'#6B5E3E', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                  {hasPII ? v(u.email) : u.email ? maskEmail(u.email) : '—'}
                </div>

                {/* Role */}
                <span style={{ fontSize:'9px', fontWeight:700, background:rt.bg, color:rt.color, padding:'2px 6px', display:'inline-block' }}>{v(u.role)}</span>

                {/* Status */}
                <span style={{ fontSize:'9px', fontWeight:800, background:st.bg, color:st.color, padding:'2px 6px', display:'inline-block' }}>{v(u.accountStatus)}</span>

                {/* Wallet */}
                <div style={{ fontSize:'11px', color:'#059669', fontWeight:600 }}>₹{(u.wallet?.balance||0).toLocaleString('en-IN')}</div>

                {/* Points */}
                <div style={{ fontSize:'11px', color:'#B8960C', fontWeight:600 }}>{u.wallet?.rewardPoints||0}</div>

                {/* Verified */}
                <div style={{ display:'flex', gap:'4px' }}>
                  <span style={{ fontSize:'9px', color: u.verification?.phone ? '#059669' : '#DC2626', fontWeight:700 }}>{u.verification?.phone ? '📱✓' : '📱✗'}</span>
                  <span style={{ fontSize:'9px', color: u.verification?.email ? '#059669' : '#DC2626', fontWeight:700 }}>{u.verification?.email ? '✉✓' : '✉✗'}</span>
                </div>

                {/* Actions */}
                <div style={{ display:'flex', gap:'3px' }}>
                  <button onClick={() => navigate(`/app/users/${u.id}`)}
                    style={{ background:'#1A1A2E', color:'#fff', border:'none', padding:'4px 7px', fontSize:'9px', fontWeight:700, cursor:'pointer' }}>VIEW</button>
                  {hasBlock && (
                    <button onClick={() => setBlockModal(u)}
                      style={{ background: u.accountStatus==='BLOCKED'?'#059669':u.accountStatus==='SUSPENDED'?'#D97706':'#DC2626', color:'#fff', border:'none', padding:'4px 7px', fontSize:'9px', fontWeight:700, cursor:'pointer' }}>
                      {u.accountStatus==='BLOCKED'?'UNBLOCK':u.accountStatus==='SUSPENDED'?'UNSUSPEND':'BLOCK'}
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
              {Array.from({ length: Math.min(pagination.totalPages||1, 10) }, (_,i) => i+1).map(p => (
                <button key={p} onClick={() => setPage(p)}
                  style={{ background:p===page?'#B8960C':'#fff', color:p===page?'#fff':'#6B5E3E', border:'1px solid #D4C9B0', padding:'5px 10px', fontSize:'11px', fontWeight:700, cursor:'pointer' }}>{p}</button>
              ))}
              <button onClick={() => setPage(p => Math.min(pagination.totalPages||1, p+1))} disabled={page===pagination.totalPages}
                style={{ background:page===pagination.totalPages?'#F5F0E8':'#1A1A2E', color:page===pagination.totalPages?'#C4B49A':'#fff', border:'1px solid #D4C9B0', padding:'5px 10px', fontSize:'11px', fontWeight:700, cursor:page===pagination.totalPages?'not-allowed':'pointer' }}>NEXT →</button>
            </div>
          </div>
        </BCard>
      </div>

      <div style={{ background:'#0D1B2A', borderTop:'2px solid #B8960C', padding:'10px 20px', display:'flex', justifyContent:'space-between', marginTop:'14px' }}>
        <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.3)' }}>ZEMISH USER REGISTRY v2.0.0</span>
        <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.3)' }}>NATIONAL COMMAND CENTER</span>
      </div>

      {blockModal && (
        <BlockModal
          user={blockModal}
          onConfirm={handleBlockConfirm}
          onCancel={() => setBlockModal(null)}
          processing={processing}
        />
      )}
    </div>
  )
}