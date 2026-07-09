import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { FONTS } from '../../config/brand'
import useAuthStore from '../../store/authStore'
import UsersAPI from './api/users.api'

// ─── Helpers ─────────────────────────────────────────────
const v   = (val, fb = '—') => (val !== null && val !== undefined && val !== '') ? val : fb
const dt  = (d) => d ? new Date(d).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' }) : '—'
const dtm = (d) => d ? new Date(d).toLocaleString('en-IN') : '—'

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

const canBlock   = (l) => ['INDIA', 'STATE'].includes(l)
const canViewPII = (l) => ['INDIA', 'STATE'].includes(l)

// ─── Components ──────────────────────────────────────────
const BCard = ({ children, style={} }) => (
  <div style={{ background:'#fff', border:'1px solid #D4C9B0', borderTop:'2px solid #B8960C', ...style }}>{children}</div>
)
const BCardHeader = ({ title, action }) => (
  <div style={{ padding:'10px 16px', borderBottom:'1px solid #E8DFD0', display:'flex', justifyContent:'space-between', alignItems:'center', background:'#FDFAF6' }}>
    <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
      <div style={{ width:'3px', height:'14px', background:'#B8960C' }}/>
      <span style={{ fontSize:'11px', fontWeight:800, color:'#1A1A2E', letterSpacing:'1px', textTransform:'uppercase' }}>{title}</span>
    </div>
    {action}
  </div>
)
const InfoRow = ({ label, value, valueColor }) => (
  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'7px 0', borderBottom:'1px solid #F0EAE0' }}>
    <span style={{ fontSize:'12px', color:'#9E8E6E' }}>{label}</span>
    <span style={{ fontSize:'12px', fontWeight:600, color:valueColor||'#1A1A2E', textAlign:'right', maxWidth:'65%' }}>{v(value)}</span>
  </div>
)
const SLabel = ({ title }) => (
  <div style={{ display:'flex', alignItems:'center', gap:'8px', margin:'12px 0 8px' }}>
    <div style={{ width:'3px', height:'12px', background:'#B8960C' }}/>
    <span style={{ fontSize:'9px', fontWeight:800, color:'#9E8E6E', letterSpacing:'2px', textTransform:'uppercase' }}>{title}</span>
  </div>
)

// ─── Block Modal ──────────────────────────────────────────
function BlockModal({ user, onConfirm, onCancel, processing }) {
  const [reason, setReason] = useState('')
  const isBlocked   = user.accountStatus === 'BLOCKED'
  const isSuspended = user.accountStatus === 'SUSPENDED'
  const actionLabel = isBlocked ? '✓ UNBLOCK' : isSuspended ? '✓ REMOVE SUSPENSION' : '⊘ BLOCK'
  const headerLabel = isBlocked ? 'UNBLOCK USER' : isSuspended ? 'REMOVE SUSPENSION' : 'BLOCK USER'
  const headerColor = isBlocked || isSuspended ? '#064E3B' : '#7F1D1D'
  const borderColor = isBlocked || isSuspended ? '#059669' : '#DC2626'
  const btnColor    = isBlocked || isSuspended ? '#059669' : '#DC2626'
  const canProceed  = isBlocked || isSuspended ? true : reason.trim().length > 0

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.75)', zIndex:2000, display:'flex', alignItems:'center', justifyContent:'center' }}>
      <div style={{ background:'#fff', width:'440px', border:`2px solid ${borderColor}` }}>
        <div style={{ background:headerColor, padding:'14px 18px', borderBottom:`2px solid ${borderColor}` }}>
          <div style={{ color:'#fff', fontWeight:800, fontSize:'13px', letterSpacing:'1px' }}>{headerLabel}</div>
          <div style={{ color:'rgba(255,255,255,0.6)', fontSize:'10px', marginTop:'2px' }}>{v(user.name)} — {v(user.phone)}</div>
        </div>
        <div style={{ padding:'20px 18px' }}>
          {!isBlocked && !isSuspended && (
            <div style={{ background:'#FEF2F2', border:'1px solid #FEE2E2', padding:'10px', marginBottom:'14px', fontSize:'11px', color:'#991B1B', fontWeight:600 }}>
              ⚠ Blocking will prevent user from making new bookings.
            </div>
          )}
          <label style={{ fontSize:'10px', color:'#9E8E6E', fontWeight:800, letterSpacing:'1px', display:'block', marginBottom:'6px' }}>
            {isBlocked || isSuspended ? 'REASON (OPTIONAL)' : 'BLOCK REASON (REQUIRED)'}
          </label>
          <textarea value={reason} onChange={e => setReason(e.target.value)}
            placeholder={isBlocked ? 'Why unblocking...' : isSuspended ? 'Why removing suspension...' : 'Reason for blocking...'}
            style={{ width:'100%', border:'1px solid #D4C9B0', padding:'8px 12px', fontSize:'13px', fontFamily:FONTS.body, outline:'none', minHeight:'70px', resize:'vertical', boxSizing:'border-box', marginBottom:'14px' }}
          />
          <div style={{ display:'flex', gap:'8px', justifyContent:'flex-end' }}>
            <button onClick={onCancel} style={{ background:'#fff', border:'1px solid #D4C9B0', color:'#6B5E3E', padding:'8px 16px', fontSize:'11px', fontWeight:700, cursor:'pointer' }}>CANCEL</button>
            <button onClick={() => canProceed && onConfirm(reason)} disabled={processing}
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
export default function UserDetailPage() {
  const { id }     = useParams()
  const navigate   = useNavigate()
  const admin      = useAuthStore(s => s.admin)
  const adminLevel = admin?.adminLevel || 'INDIA'

  const hasBlock   = canBlock(adminLevel)
  const hasPII     = canViewPII(adminLevel)

  const [user,       setUser]       = useState(null)
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState(null)
  const [processing, setProcessing] = useState(false)
  const [tab,        setTab]        = useState('overview')
  const [toast,      setToast]      = useState(null)
  const [blockModal, setBlockModal] = useState(false)

  const showToast = (msg, color = '#059669') => {
    setToast({ msg, color })
    setTimeout(() => setToast(null), 3000)
  }

  const fetchUser = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await UsersAPI.getById(id)
      setUser(res.data)
    } catch (err) {
      setError(err.message || 'Failed to load')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchUser() }, [id])

  const handleBlockConfirm = async (reason) => {
    if (!user) return
    const isBlocked   = user.accountStatus === 'BLOCKED'
    const isSuspended = user.accountStatus === 'SUSPENDED'
    const newStatus   = (isBlocked || isSuspended) ? 'ACTIVE' : 'BLOCKED'

    if (!isBlocked && !isSuspended && !reason?.trim()) {
      showToast('⚠ Reason required', '#D97706')
      return
    }

    setProcessing(true)
    try {
      await UsersAPI.updateStatus(id, {
        status: newStatus,
        reason: reason?.trim() || undefined,
      })
      const msg = isBlocked   ? `✓ ${user.name} unblocked`
                : isSuspended ? `✓ ${user.name} suspension removed`
                : `⊘ ${user.name} blocked`
      showToast(msg, newStatus === 'ACTIVE' ? '#059669' : '#DC2626')
      setBlockModal(false)
      fetchUser()
    } catch (err) {
      showToast(`⚠ ${err.message}`, '#DC2626')
    } finally {
      setProcessing(false)
    }
  }

  // ── Loading ──
  if (loading) return (
    <div style={{ minHeight:'100vh', background:'#F0EAE0', display:'flex', alignItems:'center', justifyContent:'center', fontFamily:FONTS.body, color:'#9E8E6E' }}>
      Loading user...
    </div>
  )

  if (error) return (
    <div style={{ minHeight:'100vh', background:'#F0EAE0', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', fontFamily:FONTS.body, gap:'12px' }}>
      <div style={{ color:'#DC2626' }}>⚠ {error}</div>
      <button onClick={fetchUser} style={{ background:'#1A1A2E', color:'#fff', border:'none', padding:'8px 20px', cursor:'pointer', fontWeight:700 }}>RETRY</button>
    </div>
  )

  if (!user) return (
    <div style={{ minHeight:'100vh', background:'#F0EAE0', display:'flex', alignItems:'center', justifyContent:'center', fontFamily:FONTS.body }}>
      <div style={{ background:'#fff', border:'2px solid #D4C9B0', borderTop:'2px solid #B8960C', padding:'40px', textAlign:'center' }}>
        <div style={{ fontSize:'40px', marginBottom:'16px' }}>🔍</div>
        <div style={{ fontSize:'16px', fontWeight:800, color:'#1A1A2E', marginBottom:'8px' }}>User Not Found</div>
        <button onClick={() => navigate('/app/users')} style={{ background:'#0D1B2A', color:'#B8960C', border:'none', padding:'8px 20px', fontSize:'12px', fontWeight:700, cursor:'pointer' }}>← GO BACK</button>
      </div>
    </div>
  )

  const sc = STATUS_COLORS[user.accountStatus] || STATUS_COLORS.ACTIVE
  const rc = ROLE_COLORS[user.role]            || ROLE_COLORS.USER

  const TABS = ['overview', 'bookings', 'wallet', 'reviews', 'activity', 'audit']

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
          <button onClick={() => navigate('/app/users')} style={{ background:'rgba(255,255,255,0.07)', border:'1px solid rgba(255,255,255,0.1)', color:'rgba(255,255,255,0.6)', padding:'5px 10px', cursor:'pointer', fontSize:'12px', fontWeight:700 }}>← BACK</button>
          <div style={{ width:'3px', height:'16px', background:'#B8960C' }}/>
          <div>
            <div style={{ color:'#fff', fontWeight:800, fontSize:'13px', letterSpacing:'1px' }}>{v(user.name)}</div>
            <div style={{ color:'#B8960C', fontSize:'9px', letterSpacing:'1px', marginTop:'1px' }}>
              {v(user.role)} • Joined {dt(user.createdAt)}
            </div>
          </div>
          <span style={{ fontSize:'10px', fontWeight:800, background:sc.bg, color:sc.color, padding:'3px 8px' }}>{v(user.accountStatus)}</span>
          <span style={{ fontSize:'10px', fontWeight:800, background:rc.bg, color:rc.color, padding:'3px 8px' }}>{v(user.role)}</span>
        </div>
        <div style={{ display:'flex', gap:'8px' }}>
          <button onClick={fetchUser} style={{ background:'rgba(255,255,255,0.07)', border:'1px solid rgba(255,255,255,0.15)', color:'rgba(255,255,255,0.5)', padding:'5px 10px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>↻</button>
          {hasBlock && (
            <button onClick={() => setBlockModal(true)}
              style={{ background: user.accountStatus==='BLOCKED'?'rgba(5,150,105,0.2)':user.accountStatus==='SUSPENDED'?'rgba(217,119,6,0.2)':'rgba(220,38,38,0.2)', border:`1px solid ${user.accountStatus==='BLOCKED'?'rgba(5,150,105,0.5)':user.accountStatus==='SUSPENDED'?'rgba(217,119,6,0.5)':'rgba(220,38,38,0.5)'}`, color:user.accountStatus==='BLOCKED'?'#6EE7B7':user.accountStatus==='SUSPENDED'?'#FDE68A':'#FCA5A5', padding:'6px 12px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>
              {user.accountStatus==='BLOCKED'?'✓ UNBLOCK':user.accountStatus==='SUSPENDED'?'✓ UNSUSPEND':'⊘ BLOCK USER'}
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div style={{ background:'#0A1520', borderBottom:'1px solid rgba(184,150,12,0.2)', display:'flex', padding:'0 20px', overflowX:'auto' }}>
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)} style={{ padding:'10px 16px', border:'none', background:'none', cursor:'pointer', fontSize:'10px', fontWeight:tab===t?800:400, color:tab===t?'#B8960C':'rgba(255,255,255,0.35)', borderBottom:tab===t?'2px solid #B8960C':'2px solid transparent', letterSpacing:'1.5px', textTransform:'uppercase', whiteSpace:'nowrap' }}>
            {t}
          </button>
        ))}
      </div>

      {/* KPI Strip */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:'1px', background:'#D4C9B0', borderBottom:'2px solid #B8960C' }}>
        {[
          { label:'Wallet Balance',  value: `₹${(user.wallet?.balance||0).toLocaleString('en-IN')}`, color:'#B8960C' },
          { label:'Reward Points',   value: user.wallet?.rewardPoints || 0,                           color:'#059669' },
          { label:'Phone Verified',  value: user.verification?.phone ? '✓ YES' : '✗ NO',             color: user.verification?.phone ? '#059669' : '#DC2626' },
          { label:'Email Verified',  value: user.verification?.email ? '✓ YES' : '✗ NO',             color: user.verification?.email ? '#059669' : '#DC2626' },
          { label:'Last Login',      value: dt(user.lastLoginAt),                                     color:'#9E8E6E' },
        ].map(k => (
          <div key={k.label} style={{ background:'#0D1B2A', padding:'10px 16px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
            <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.4)' }}>{k.label}</span>
            <span style={{ fontSize:'14px', fontWeight:800, color:k.color }}>{k.value}</span>
          </div>
        ))}
      </div>

      {/* Blocked Banner */}
      {user.accountStatus === 'BLOCKED' && (
        <div style={{ background:'#FEF2F2', borderBottom:'2px solid #DC2626', padding:'10px 20px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <span style={{ fontSize:'12px', color:'#991B1B', fontWeight:700 }}>
            ⊘ ACCOUNT BLOCKED
          </span>
          {hasBlock && (
            <button onClick={() => setBlockModal(true)} style={{ background:'#059669', color:'#fff', border:'none', padding:'5px 12px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>✓ UNBLOCK</button>
          )}
        </div>
      )}

      <div style={{ padding:'16px 20px' }}>

        {/* ══ OVERVIEW ══ */}
        {tab === 'overview' && (
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:'14px' }}>

            <BCard>
              <BCardHeader title="User Profile"/>
              <div style={{ padding:'14px' }}>
                <div style={{ display:'flex', alignItems:'center', gap:'12px', padding:'12px', background:'#F5F0E8', border:'1px solid #E8DFD0', borderTop:'2px solid #B8960C', marginBottom:'14px' }}>
                  <div style={{ width:'44px', height:'44px', background:'#0D1B2A', display:'flex', alignItems:'center', justifyContent:'center', color:'#B8960C', fontSize:'18px', fontWeight:800, flexShrink:0 }}>
                    {(user.name||'?')[0].toUpperCase()}
                  </div>
                  <div>
                    <div style={{ fontSize:'15px', fontWeight:800, color:'#1A1A2E' }}>{v(user.name)}</div>
                    <div style={{ fontSize:'10px', color:'#9E8E6E', marginTop:'2px' }}>Joined {dt(user.createdAt)}</div>
                  </div>
                </div>
                <SLabel title="Contact"/>
                <InfoRow label="Phone"  value={hasPII ? v(user.phone) : maskPhone(user.phone||'')}/>
                <InfoRow label="Email"  value={hasPII ? v(user.email) : user.email ? maskEmail(user.email) : '—'}/>
                <SLabel title="Account"/>
                <InfoRow label="Role"          value={v(user.role)}/>
                <InfoRow label="Status"        value={v(user.accountStatus)} valueColor={sc.color}/>
                <InfoRow label="Active"        value={user.isActive ? '✓ Yes' : '✗ No'} valueColor={user.isActive?'#059669':'#DC2626'}/>
                <InfoRow label="Phone Verified" value={user.verification?.phone ? '✓ Yes' : '✗ No'} valueColor={user.verification?.phone?'#059669':'#DC2626'}/>
                <InfoRow label="Email Verified" value={user.verification?.email ? '✓ Yes' : '✗ No'} valueColor={user.verification?.email?'#059669':'#DC2626'}/>
                <InfoRow label="Last Login"    value={dt(user.lastLoginAt)}/>
                <InfoRow label="Joined"        value={dt(user.createdAt)}/>
              </div>
            </BCard>

            <BCard>
              <BCardHeader title="Wallet & Rewards"/>
              <div style={{ padding:'14px' }}>
                <div style={{ background:'#0D1B2A', padding:'20px', marginBottom:'14px', textAlign:'center', borderTop:'2px solid #B8960C' }}>
                  <div style={{ fontSize:'10px', color:'rgba(255,255,255,0.4)', letterSpacing:'1px', marginBottom:'6px' }}>WALLET BALANCE</div>
                  <div style={{ fontSize:'32px', fontWeight:800, color:'#B8960C' }}>₹{(user.wallet?.balance||0).toLocaleString('en-IN')}</div>
                </div>
                <InfoRow label="Reward Points" value={user.wallet?.rewardPoints||0} valueColor="#B8960C"/>
                <div style={{ marginTop:'16px' }}/>
                <SLabel title="Stats"/>
                <InfoRow label="Total Bookings" value="—" />
                <InfoRow label="Total Spent"    value="—" />
                <div style={{ marginTop:'12px', padding:'10px', background:'#FFFBEB', border:'1px solid #FDE68A', fontSize:'10px', color:'#92400E', fontWeight:600 }}>
                  ℹ Booking stats — Phase 5 mein aayenge
                </div>
              </div>
            </BCard>

            <BCard>
              <BCardHeader title="Block History"/>
              <div style={{ padding:'14px' }}>
                <div style={{ background:'#FFFBEB', border:'1px solid #FDE68A', padding:'10px', marginBottom:'14px', fontSize:'10px', color:'#92400E', fontWeight:600 }}>
                  ℹ Block audit — AuditLog module Phase 14 mein aayega
                </div>
                <InfoRow label="Current Status" value={v(user.accountStatus)} valueColor={sc.color}/>
                <InfoRow label="Is Active"      value={user.isActive ? '✓ Yes' : '✗ No'} valueColor={user.isActive?'#059669':'#DC2626'}/>
                {hasBlock && (
                  <div style={{ marginTop:'16px' }}>
                    <button onClick={() => setBlockModal(true)}
                      style={{ width:'100%', background:user.accountStatus==='BLOCKED'?'#059669':user.accountStatus==='SUSPENDED'?'#D97706':'#DC2626', color:'#fff', border:'none', padding:'10px', fontSize:'11px', fontWeight:800, cursor:'pointer' }}>
                      {user.accountStatus==='BLOCKED'?'✓ UNBLOCK USER':user.accountStatus==='SUSPENDED'?'✓ REMOVE SUSPENSION':'⊘ BLOCK USER'}
                    </button>
                  </div>
                )}
              </div>
            </BCard>
          </div>
        )}

        {/* ══ BOOKINGS ══ */}
        {tab === 'bookings' && (
          <BCard>
            <BCardHeader title="Booking History"/>
            <div style={{ padding:'40px', textAlign:'center', color:'#9E8E6E', fontSize:'13px' }}>
              Bookings — Phase 5 mein dedicated API se aayenge
              <div style={{ marginTop:'8px', fontSize:'11px', color:'#C4B49A' }}>GET /api/admin/users/{id}/bookings</div>
            </div>
          </BCard>
        )}

        {/* ══ WALLET ══ */}
        {tab === 'wallet' && (
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'14px' }}>
            <BCard>
              <BCardHeader title="Wallet Overview"/>
              <div style={{ padding:'14px' }}>
                <div style={{ background:'#0D1B2A', padding:'20px', marginBottom:'14px', textAlign:'center', borderTop:'2px solid #B8960C' }}>
                  <div style={{ fontSize:'10px', color:'rgba(255,255,255,0.4)', letterSpacing:'1px', marginBottom:'6px' }}>WALLET BALANCE</div>
                  <div style={{ fontSize:'32px', fontWeight:800, color:'#B8960C' }}>₹{(user.wallet?.balance||0).toLocaleString('en-IN')}</div>
                </div>
                <InfoRow label="Reward Points" value={user.wallet?.rewardPoints||0} valueColor="#B8960C"/>
              </div>
            </BCard>
            <BCard>
              <BCardHeader title="Wallet Info"/>
              <div style={{ padding:'14px' }}>
                <div style={{ background:'#FFFBEB', border:'1px solid #FDE68A', padding:'12px', fontSize:'11px', color:'#92400E', fontWeight:600, marginBottom:'14px' }}>
                  ℹ Wallet transactions — Phase 6 mein dedicated API se aayenge
                </div>
                <InfoRow label="Current Balance"  value={`₹${(user.wallet?.balance||0).toLocaleString('en-IN')}`} valueColor="#B8960C"/>
                <InfoRow label="Reward Points"    value={user.wallet?.rewardPoints||0} valueColor="#059669"/>
              </div>
            </BCard>
          </div>
        )}

        {/* ══ REVIEWS ══ */}
        {tab === 'reviews' && (
          <BCard>
            <BCardHeader title="Reviews Given"/>
            <div style={{ padding:'40px', textAlign:'center', color:'#9E8E6E', fontSize:'13px' }}>
              Reviews — Phase 7 mein dedicated API se aayenge
              <div style={{ marginTop:'8px', fontSize:'11px', color:'#C4B49A' }}>GET /api/admin/users/{id}/reviews</div>
            </div>
          </BCard>
        )}

        {/* ══ ACTIVITY ══ */}
        {tab === 'activity' && (
          <BCard>
            <BCardHeader title="Activity Timeline"/>
            <div style={{ padding:'40px', textAlign:'center', color:'#9E8E6E', fontSize:'13px' }}>
              Activity log — Phase 9 mein aayega
              <div style={{ marginTop:'8px', fontSize:'11px', color:'#C4B49A' }}>GET /api/admin/users/{id}/activity</div>
            </div>
          </BCard>
        )}

        {/* ══ AUDIT ══ */}
        {tab === 'audit' && (
          <BCard>
            <BCardHeader title="Audit Log — Immutable" action={
              <span style={{ fontSize:'10px', color:'#DC2626', fontWeight:700 }}>⚠ CANNOT BE DELETED</span>
            }/>
            <div style={{ padding:'40px', textAlign:'center', color:'#9E8E6E', fontSize:'13px' }}>
              Audit logs — AuditLog module Phase 14 mein aayenge
              <div style={{ marginTop:'8px', fontSize:'11px', color:'#C4B49A' }}>GET /api/admin/users/{id}/audit</div>
            </div>
          </BCard>
        )}

      </div>

      <div style={{ background:'#0D1B2A', borderTop:'2px solid #B8960C', padding:'10px 20px', display:'flex', justifyContent:'space-between', marginTop:'14px' }}>
        <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.3)' }}>ZEMISH USER DETAIL v2.0.0</span>
        <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.3)' }}>NATIONAL COMMAND CENTER</span>
      </div>

      {blockModal && (
        <BlockModal
          user={user}
          onConfirm={handleBlockConfirm}
          onCancel={() => setBlockModal(false)}
          processing={processing}
        />
      )}
    </div>
  )
}