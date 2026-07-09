import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
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
const APPROVAL_COLORS = {
  APPROVED: { bg:'#D1FAE5', color:'#065F46' },
  PENDING:  { bg:'#FEF9C3', color:'#92400E' },
  REJECTED: { bg:'#FEE2E2', color:'#991B1B' },
}

const canManage  = (l) => ['INDIA', 'STATE'].includes(l)
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

// ─── Main Page ────────────────────────────────────────────
export default function ProviderDetailPage() {
  const { id }     = useParams()
  const navigate   = useNavigate()
  const admin      = useAuthStore(s => s.admin)
  const adminLevel = admin?.adminLevel || 'INDIA'
  const hasManage  = canManage(adminLevel)
  const hasPII     = canViewPII(adminLevel)

  const [provider,   setProvider]   = useState(null)
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState(null)
  const [processing, setProcessing] = useState(false)
  const [tab,        setTab]        = useState('overview')
  const [toast,      setToast]      = useState(null)
  const [modal,      setModal]      = useState(false)

  const showToast = (msg, color = '#059669') => {
    setToast({ msg, color })
    setTimeout(() => setToast(null), 3000)
  }

  const fetchProvider = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await ProviderAPI.getById(id)
      setProvider(res.data)
    } catch (err) {
      setError(err.message || 'Failed to load')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchProvider() }, [id])

  const handleStatusConfirm = async (targetStatus, reason) => {
    setProcessing(true)
    try {
      await ProviderAPI.updateStatus(id, {
        status: targetStatus,
        reason: reason?.trim() || undefined,
      })
      const msg = targetStatus === 'ACTIVE'    ? `✓ ${v(provider.name)} restored`
                : targetStatus === 'SUSPENDED' ? `⚠ ${v(provider.name)} suspended`
                : `⊘ ${v(provider.name)} blocked`
      const color = targetStatus === 'ACTIVE' ? '#059669' : targetStatus === 'SUSPENDED' ? '#D97706' : '#DC2626'
      showToast(msg, color)
      setModal(false)
      fetchProvider()
    } catch (err) {
      showToast(`⚠ ${err.message}`, '#DC2626')
    } finally {
      setProcessing(false)
    }
  }

  if (loading) return (
    <div style={{ minHeight:'100vh', background:'#F0EAE0', display:'flex', alignItems:'center', justifyContent:'center', fontFamily:FONTS.body, color:'#9E8E6E' }}>
      Loading provider...
    </div>
  )
  if (error) return (
    <div style={{ minHeight:'100vh', background:'#F0EAE0', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', fontFamily:FONTS.body, gap:'12px' }}>
      <div style={{ color:'#DC2626' }}>⚠ {error}</div>
      <button onClick={fetchProvider} style={{ background:'#1A1A2E', color:'#fff', border:'none', padding:'8px 20px', cursor:'pointer', fontWeight:700 }}>RETRY</button>
    </div>
  )
  if (!provider) return (
    <div style={{ minHeight:'100vh', background:'#F0EAE0', display:'flex', alignItems:'center', justifyContent:'center', fontFamily:FONTS.body }}>
      <div style={{ background:'#fff', border:'2px solid #D4C9B0', borderTop:'2px solid #B8960C', padding:'40px', textAlign:'center' }}>
        <div style={{ fontSize:'40px', marginBottom:'16px' }}>🔍</div>
        <div style={{ fontSize:'16px', fontWeight:800, color:'#1A1A2E', marginBottom:'8px' }}>Provider Not Found</div>
        <button onClick={() => navigate('/app/providers')} style={{ background:'#0D1B2A', color:'#B8960C', border:'none', padding:'8px 20px', fontSize:'12px', fontWeight:700, cursor:'pointer' }}>← GO BACK</button>
      </div>
    </div>
  )

  const sc   = STATUS_COLORS[provider.accountStatus] || { bg:'#F3F4F6', color:'#374151' }
  const TABS = ['overview', 'salons', 'kyc', 'earnings']

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
          <button onClick={() => navigate('/app/providers')} style={{ background:'rgba(255,255,255,0.07)', border:'1px solid rgba(255,255,255,0.1)', color:'rgba(255,255,255,0.6)', padding:'5px 10px', cursor:'pointer', fontSize:'12px', fontWeight:700 }}>← BACK</button>
          <div style={{ width:'3px', height:'16px', background:'#B8960C' }}/>
          <div>
            <div style={{ color:'#fff', fontWeight:800, fontSize:'13px', letterSpacing:'1px' }}>{v(provider.name)}</div>
            <div style={{ color:'#B8960C', fontSize:'9px', letterSpacing:'1px', marginTop:'1px' }}>
              Provider • {provider.salonCount ?? 0} Salon(s) • Joined {dt(provider.createdAt)}
            </div>
          </div>
          <span style={{ fontSize:'10px', fontWeight:800, background:sc.bg, color:sc.color, padding:'3px 8px' }}>{v(provider.accountStatus)}</span>
        </div>
        <div style={{ display:'flex', gap:'8px' }}>
          <button onClick={fetchProvider} style={{ background:'rgba(255,255,255,0.07)', border:'1px solid rgba(255,255,255,0.15)', color:'rgba(255,255,255,0.5)', padding:'5px 10px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>↻</button>
          <button onClick={() => navigate(`/app/salons`)} style={{ background:'rgba(184,150,12,0.15)', border:'1px solid rgba(184,150,12,0.4)', color:'#B8960C', padding:'6px 12px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>
            VIEW SALONS ({provider.salonCount ?? 0})
          </button>
          {hasManage && (
            <button onClick={() => setModal(true)}
              style={{ background:provider.accountStatus==='BLOCKED'?'rgba(5,150,105,0.2)':provider.accountStatus==='SUSPENDED'?'rgba(5,150,105,0.2)':'rgba(220,38,38,0.2)', border:`1px solid ${provider.accountStatus==='ACTIVE'?'rgba(220,38,38,0.5)':'rgba(5,150,105,0.5)'}`, color:provider.accountStatus==='ACTIVE'?'#FCA5A5':'#6EE7B7', padding:'6px 12px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>
              {provider.accountStatus==='BLOCKED'?'✓ UNBLOCK':provider.accountStatus==='SUSPENDED'?'✓ UNSUSPEND':'⊘ MANAGE'}
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div style={{ background:'#0A1520', borderBottom:'1px solid rgba(184,150,12,0.2)', display:'flex', padding:'0 20px', overflowX:'auto' }}>
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)} style={{ padding:'10px 16px', border:'none', background:'none', cursor:'pointer', fontSize:'10px', fontWeight:tab===t?800:400, color:tab===t?'#B8960C':'rgba(255,255,255,0.35)', borderBottom:tab===t?'2px solid #B8960C':'2px solid transparent', letterSpacing:'1.5px', textTransform:'uppercase', whiteSpace:'nowrap' }}>
            {t}
            {t==='salons' && <span style={{ marginLeft:'5px', background:'rgba(184,150,12,0.3)', color:'#B8960C', fontSize:'9px', padding:'1px 5px' }}>{provider.salonCount ?? 0}</span>}
          </button>
        ))}
      </div>

      {/* KPI Strip */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:'1px', background:'#D4C9B0', borderBottom:'2px solid #B8960C' }}>
        {[
          { label:'Total Salons',   value: provider.salonCount ?? 0, color:'#7C3AED' },
          { label:'Wallet Balance', value: `₹${(provider.wallet?.balance ?? 0).toLocaleString('en-IN')}`, color:'#B8960C' },
          { label:'Reward Points',  value: provider.wallet?.rewardPoints ?? 0, color:'#059669' },
          { label:'Phone Verified', value: provider.verification?.phone ? '✓ YES' : '✗ NO', color: provider.verification?.phone ? '#059669' : '#DC2626' },
        ].map(k => (
          <div key={k.label} style={{ background:'#0D1B2A', padding:'10px 16px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
            <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.4)' }}>{k.label}</span>
            <span style={{ fontSize:'14px', fontWeight:800, color:k.color }}>{k.value}</span>
          </div>
        ))}
      </div>

      {/* Blocked/Suspended Banner */}
      {provider.accountStatus === 'BLOCKED' && (
        <div style={{ background:'#FEF2F2', borderBottom:'2px solid #DC2626', padding:'10px 20px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <span style={{ fontSize:'12px', color:'#991B1B', fontWeight:700 }}>⊘ ACCOUNT BLOCKED</span>
          {hasManage && <button onClick={() => setModal(true)} style={{ background:'#059669', color:'#fff', border:'none', padding:'5px 12px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>✓ UNBLOCK</button>}
        </div>
      )}
      {provider.accountStatus === 'SUSPENDED' && (
        <div style={{ background:'#FFFBEB', borderBottom:'2px solid #D97706', padding:'10px 20px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <span style={{ fontSize:'12px', color:'#92400E', fontWeight:700 }}>⚠ ACCOUNT SUSPENDED</span>
          {hasManage && <button onClick={() => setModal(true)} style={{ background:'#059669', color:'#fff', border:'none', padding:'5px 12px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>✓ REMOVE SUSPENSION</button>}
        </div>
      )}

      <div style={{ padding:'16px 20px' }}>

        {/* ── OVERVIEW ── */}
        {tab === 'overview' && (
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:'14px' }}>
            <BCard>
              <BCardHeader title="Provider Profile"/>
              <div style={{ padding:'14px' }}>
                <div style={{ display:'flex', alignItems:'center', gap:'12px', padding:'12px', background:'#F5F0E8', border:'1px solid #E8DFD0', borderTop:'2px solid #B8960C', marginBottom:'14px' }}>
                  <div style={{ width:'44px', height:'44px', background:'#0D1B2A', display:'flex', alignItems:'center', justifyContent:'center', color:'#B8960C', fontSize:'18px', fontWeight:800, flexShrink:0 }}>
                    {(provider.name||'?')[0].toUpperCase()}
                  </div>
                  <div>
                    <div style={{ fontSize:'15px', fontWeight:800, color:'#1A1A2E' }}>{v(provider.name)}</div>
                    <div style={{ fontSize:'10px', color:'#9E8E6E', marginTop:'2px' }}>Provider • Joined {dt(provider.createdAt)}</div>
                  </div>
                </div>
                <SLabel title="Contact"/>
                <InfoRow label="Phone" value={hasPII ? v(provider.phone) : maskPhone(provider.phone||'')}/>
                <InfoRow label="Email" value={hasPII ? v(provider.email) : provider.email ? maskEmail(provider.email) : '—'}/>
                <SLabel title="Account"/>
                <InfoRow label="Status"        value={v(provider.accountStatus)} valueColor={sc.color}/>
                <InfoRow label="Active"        value={provider.isActive ? '✓ Yes' : '✗ No'} valueColor={provider.isActive?'#059669':'#DC2626'}/>
                <InfoRow label="Phone Verified" value={provider.verification?.phone ? '✓ Yes' : '✗ No'} valueColor={provider.verification?.phone?'#059669':'#DC2626'}/>
                <InfoRow label="Email Verified" value={provider.verification?.email ? '✓ Yes' : '✗ No'} valueColor={provider.verification?.email?'#059669':'#DC2626'}/>
                <InfoRow label="Last Login"    value={dt(provider.lastLoginAt)}/>
                <InfoRow label="Member Since"  value={dt(provider.createdAt)}/>
              </div>
            </BCard>

            <BCard>
              <BCardHeader title="Wallet"/>
              <div style={{ padding:'14px' }}>
                <div style={{ background:'#0D1B2A', padding:'20px', marginBottom:'14px', textAlign:'center', borderTop:'2px solid #B8960C' }}>
                  <div style={{ fontSize:'10px', color:'rgba(255,255,255,0.4)', letterSpacing:'1px', marginBottom:'6px' }}>WALLET BALANCE</div>
                  <div style={{ fontSize:'32px', fontWeight:800, color:'#B8960C' }}>₹{(provider.wallet?.balance ?? 0).toLocaleString('en-IN')}</div>
                </div>
                <InfoRow label="Reward Points" value={provider.wallet?.rewardPoints ?? 0} valueColor="#B8960C"/>
                <div style={{ marginTop:'16px', padding:'10px', background:'#FFFBEB', border:'1px solid #FDE68A', fontSize:'10px', color:'#92400E', fontWeight:600 }}>
                  ℹ Earnings & payouts — Phase 7 Finance module
                </div>
              </div>
            </BCard>

            <BCard>
              <BCardHeader title="Salon Summary"/>
              <div style={{ padding:'14px' }}>
                <div style={{ background:'#0D1B2A', padding:'16px', marginBottom:'14px', textAlign:'center', borderTop:'2px solid #B8960C' }}>
                  <div style={{ fontSize:'10px', color:'rgba(255,255,255,0.4)', letterSpacing:'1px', marginBottom:'6px' }}>TOTAL SALONS</div>
                  <div style={{ fontSize:'32px', fontWeight:800, color:'#7C3AED' }}>{provider.salonCount ?? 0}</div>
                </div>
                {provider.salons?.length > 0 ? provider.salons.slice(0,3).map(s => (
                  <div key={s.id} onClick={() => navigate(`/app/salons/${s.id}`)}
                    style={{ padding:'8px 10px', background:'#F5F0E8', border:'1px solid #E8DFD0', marginBottom:'6px', cursor:'pointer' }}>
                    <div style={{ fontSize:'12px', fontWeight:700, color:'#1A1A2E' }}>{v(s.shopName)}</div>
                    <div style={{ fontSize:'10px', color:'#9E8E6E', marginTop:'2px' }}>{v(s.district?.name)} • {v(s.state?.name)}</div>
                  </div>
                )) : (
                  <div style={{ padding:'20px', textAlign:'center', color:'#9E8E6E', fontSize:'12px' }}>No salons assigned</div>
                )}
                {provider.salonCount > 3 && (
                  <div style={{ fontSize:'11px', color:'#B8960C', textAlign:'center', marginTop:'8px', cursor:'pointer' }} onClick={() => setTab('salons')}>
                    +{provider.salonCount - 3} more → View All
                  </div>
                )}
              </div>
            </BCard>
          </div>
        )}

        {/* ── SALONS ── */}
        {tab === 'salons' && (
          <BCard>
            <BCardHeader title={`Salons (${provider.salonCount ?? 0})`} action={
              <button onClick={() => navigate('/app/salons')} style={{ background:'none', border:'none', cursor:'pointer', fontSize:'11px', color:'#B8960C', fontWeight:700 }}>VIEW ALL ▸</button>
            }/>
            {!provider.salons?.length ? (
              <div style={{ padding:'40px', textAlign:'center', color:'#9E8E6E' }}>No salons assigned</div>
            ) : (
              <>
                <div style={{ display:'grid', gridTemplateColumns:'1.5fr 1fr 1fr 0.8fr 0.8fr', padding:'8px 14px', background:'#F5F0E8', borderBottom:'1px solid #E8DFD0', gap:'8px' }}>
                  {['SALON NAME','STATE','DISTRICT','STATUS','COMMISSION'].map(h => (
                    <span key={h} style={{ fontSize:'9px', fontWeight:800, color:'#9E8E6E', letterSpacing:'1px' }}>{h}</span>
                  ))}
                </div>
                {provider.salons.map((s, i) => {
                  const ac = APPROVAL_COLORS[s.approvalStatus] || { bg:'#F3F4F6', color:'#374151' }
                  return (
                    <div key={s.id} onClick={() => navigate(`/app/salons/${s.id}`)}
                      style={{ display:'grid', gridTemplateColumns:'1.5fr 1fr 1fr 0.8fr 0.8fr', padding:'12px 14px', borderBottom:'1px solid #F0EAE0', alignItems:'center', gap:'8px', background:i%2===0?'#fff':'#FDFAF6', cursor:'pointer' }}>
                      <div>
                        <div style={{ fontSize:'12px', fontWeight:700, color:'#2563EB', textDecoration:'underline' }}>{v(s.shopName)}</div>
                        <div style={{ fontSize:'10px', color:'#9E8E6E', marginTop:'2px' }}>{v(s.category)}</div>
                      </div>
                      <span style={{ fontSize:'11px', color:'#1A1A2E' }}>{v(s.state?.name)}</span>
                      <span style={{ fontSize:'11px', color:'#6B5E3E' }}>{v(s.district?.name)}</span>
                      <span style={{ fontSize:'9px', fontWeight:800, background:ac.bg, color:ac.color, padding:'2px 6px', display:'inline-block' }}>{v(s.approvalStatus)}</span>
                      <span style={{ fontSize:'11px', color:'#B8960C', fontWeight:700 }}>{s.commissionRate !== null ? `${s.commissionRate}%` : '—'}</span>
                    </div>
                  )
                })}
              </>
            )}
          </BCard>
        )}

        {/* ── KYC ── */}
        {tab === 'kyc' && (
          <BCard>
            <BCardHeader title="KYC & Documents"/>
            <div style={{ padding:'40px', textAlign:'center', color:'#9E8E6E', fontSize:'13px' }}>
              <div style={{ fontSize:'32px', marginBottom:'12px' }}>📋</div>
              KYC module — Phase 6 mein aayega
              <div style={{ marginTop:'8px', fontSize:'11px', color:'#C4B49A' }}>Aadhaar, PAN, Bank, Documents verification</div>
              <div style={{ marginTop:'12px', padding:'10px', background:'#FFFBEB', border:'1px solid #FDE68A', fontSize:'10px', color:'#92400E', fontWeight:600, maxWidth:'400px', margin:'12px auto 0' }}>
                ℹ Backend already returns kyc: {} placeholder — ready for Phase 6
              </div>
            </div>
          </BCard>
        )}

        {/* ── EARNINGS ── */}
        {tab === 'earnings' && (
          <BCard>
            <BCardHeader title="Earnings & Payouts"/>
            <div style={{ padding:'40px', textAlign:'center', color:'#9E8E6E', fontSize:'13px' }}>
              <div style={{ fontSize:'32px', marginBottom:'12px' }}>💰</div>
              Finance module — Phase 7 mein aayega
              <div style={{ marginTop:'8px', fontSize:'11px', color:'#C4B49A' }}>Revenue, Commission, Payouts, Transactions</div>
              <div style={{ marginTop:'12px', padding:'10px', background:'#FFFBEB', border:'1px solid #FDE68A', fontSize:'10px', color:'#92400E', fontWeight:600, maxWidth:'400px', margin:'12px auto 0' }}>
                ℹ Backend already returns earnings: {} placeholder — ready for Phase 7
              </div>
            </div>
          </BCard>
        )}

      </div>

      <div style={{ background:'#0D1B2A', borderTop:'2px solid #B8960C', padding:'10px 20px', display:'flex', justifyContent:'space-between', marginTop:'14px' }}>
        <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.3)' }}>ZEMISH PROVIDER DETAIL v2.0.0</span>
        <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.3)' }}>NATIONAL COMMAND CENTER</span>
      </div>

      {modal && (
        <StatusModal
          provider={provider}
          onConfirm={handleStatusConfirm}
          onCancel={() => setModal(false)}
          processing={processing}
        />
      )}
    </div>
  )
}