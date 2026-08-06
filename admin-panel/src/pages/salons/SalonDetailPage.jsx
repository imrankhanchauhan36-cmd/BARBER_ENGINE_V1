import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { canFreezeWallet } from '../../config/adminRoles'
import { FONTS } from '../../config/brand'
import useAuthStore from '../../store/authStore'
import FinanceAPI from '../finance/api/finance.api'
import SalonsAPI from './api/salons.api'

// ─── Helpers ─────────────────────────────────────────────
const v   = (val, fb = '—') => (val !== null && val !== undefined && val !== '') ? val : fb
const dt  = (d) => d ? new Date(d).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' }) : '—'

// ─── Constants ───────────────────────────────────────────
const STATUS_COLORS = {
  APPROVED:  { bg: '#D1FAE5', color: '#065F46' },
  PENDING:   { bg: '#FEF9C3', color: '#92400E' },
  REJECTED:  { bg: '#FEE2E2', color: '#991B1B' },
  SUSPENDED: { bg: '#F3F4F6', color: '#374151' },
  DRAFT:     { bg: '#F3F4F6', color: '#374151' },
}
const DOC_STATUS = {
  VERIFIED: { color: '#059669', bg: '#F0FDF4', label: 'VERIFIED' },
  PENDING:  { color: '#D97706', bg: '#FFFBEB', label: 'PENDING'  },
  REJECTED: { color: '#DC2626', bg: '#FEF2F2', label: 'REJECTED' },
}
const BOOKING_STATUS = {
  COMPLETED: { color: '#065F46', bg: '#D1FAE5' },
  CANCELLED: { color: '#991B1B', bg: '#FEE2E2' },
  PENDING:   { color: '#92400E', bg: '#FEF9C3' },
}
const DAYS = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday']
const TABS = ['overview','services','team','gallery','documents','bookings','reviews','wallet','location','audit']

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
  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', padding:'7px 0', borderBottom:'1px solid #F0EAE0', gap:'8px' }}>
    <span style={{ fontSize:'12px', color:'#9E8E6E', flexShrink:0 }}>{label}</span>
    <span style={{ fontSize:'12px', fontWeight:600, color:valueColor||'#1A1A2E', textAlign:'right', wordBreak:'break-word' }}>{v(value)}</span>
  </div>
)
const SLabel = ({ title }) => (
  <div style={{ display:'flex', alignItems:'center', gap:'8px', margin:'12px 0 8px' }}>
    <div style={{ width:'3px', height:'12px', background:'#B8960C' }}/>
    <span style={{ fontSize:'9px', fontWeight:800, color:'#9E8E6E', letterSpacing:'2px', textTransform:'uppercase' }}>{title}</span>
  </div>
)

// ─── Suspend Modal ────────────────────────────────────────
function SuspendModal({ salonName, onConfirm, onCancel }) {
  const [reason, setReason] = useState('')
  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.75)', zIndex:2000, display:'flex', alignItems:'center', justifyContent:'center' }}>
      <div style={{ background:'#fff', width:'440px', border:'2px solid #DC2626' }}>
        <div style={{ background:'#7F1D1D', padding:'14px 18px', borderBottom:'2px solid #DC2626' }}>
          <div style={{ color:'#fff', fontWeight:800, fontSize:'13px', letterSpacing:'1px' }}>⊘ CONFIRM SUSPENSION</div>
        </div>
        <div style={{ padding:'20px 18px' }}>
          <div style={{ fontSize:'12px', color:'#9E8E6E', padding:'10px', background:'#F5F0E8', border:'1px solid #E8DFD0', marginBottom:'14px' }}>
            <strong>{salonName}</strong> will be suspended immediately. All bookings will be paused.
          </div>
          <label style={{ fontSize:'10px', color:'#9E8E6E', fontWeight:800, letterSpacing:'1px', display:'block', marginBottom:'6px' }}>SUSPENSION REASON (REQUIRED)</label>
          <input value={reason} onChange={e => setReason(e.target.value)} placeholder="Enter reason..."
            style={{ width:'100%', border:'1px solid #D4C9B0', padding:'8px 12px', fontSize:'13px', fontFamily:FONTS.body, outline:'none', boxSizing:'border-box', marginBottom:'14px' }}/>
          <div style={{ display:'flex', gap:'8px', justifyContent:'flex-end' }}>
            <button onClick={onCancel} style={{ background:'#fff', border:'1px solid #D4C9B0', color:'#6B5E3E', padding:'8px 16px', fontSize:'11px', fontWeight:700, cursor:'pointer' }}>CANCEL</button>
            <button onClick={() => reason.trim() && onConfirm(reason)}
              style={{ background:reason.trim()?'#DC2626':'#F5F0E8', border:'none', color:reason.trim()?'#fff':'#C4B49A', padding:'8px 20px', fontSize:'11px', fontWeight:800, cursor:reason.trim()?'pointer':'not-allowed' }}>
              ⊘ YES, SUSPEND
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────
export default function SalonDetailPage() {
  const { id }   = useParams()
  const navigate = useNavigate()
  const admin    = useAuthStore(s => s.admin)

  const [salon,       setSalon]       = useState(null)
  const [loading,     setLoading]     = useState(true)
  const [error,       setError]       = useState(null)
  const [tab,         setTab]         = useState('overview')
  const [showSuspend, setShowSuspend] = useState(false)
  const [toast,       setToast]       = useState(null)

  // Real wallet data (Finance module's confirmed-working wallet-by-salon
  // endpoint) — lazy-loaded only when the Wallet tab is opened.
  const [wallet,        setWallet]        = useState(null)
  const [walletLoading, setWalletLoading] = useState(false)
  const [walletError,   setWalletError]   = useState(null)

  const showToast = (msg, color = '#059669') => {
    setToast({ msg, color })
    setTimeout(() => setToast(null), 3000)
  }

  const fetchSalon = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await SalonsAPI.getById(id)
      setSalon(res.data)
    } catch (err) {
      setError(err.message || 'Failed to load salon')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchSalon() }, [id])

  // Lazy-fetch real wallet data (Finance module) only when the Wallet
  // tab is first opened — matches the lazy-tab-fetch pattern already
  // used elsewhere (e.g. TransactionsPage's row-expand detail fetch).
  useEffect(() => {
    if (tab !== 'wallet' || !salon?.id || wallet || walletLoading) return
    setWalletLoading(true); setWalletError(null)
    FinanceAPI.getWalletDetail(salon.id)
      .then(res => setWallet(res.data))
      .catch(err => setWalletError(err.message || 'Failed to load wallet'))
      .finally(() => setWalletLoading(false))
  }, [tab, salon?.id, wallet, walletLoading])

  // NOTE: no backend endpoint exists to suspend a salon yet — the
  // Salon model has business.isSuspended/suspendedReason fields, but
  // no route/controller writes to them. This must not fake a
  // successful suspension (an admin could believe a problem salon
  // was suspended when it's still fully live); report honestly
  // instead. Local salon state is intentionally left unchanged.
  const handleSuspend = () => {
    setShowSuspend(false)
    showToast('⚠ Not available yet — no backend endpoint exists to suspend a salon', '#DC2626')
  }

  if (loading) return (
    <div style={{ minHeight:'100vh', background:'#F0EAE0', display:'flex', alignItems:'center', justifyContent:'center', fontFamily:FONTS.body, color:'#9E8E6E', fontSize:'14px' }}>
      Loading salon...
    </div>
  )

  if (error) return (
    <div style={{ minHeight:'100vh', background:'#F0EAE0', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', fontFamily:FONTS.body, gap:'12px' }}>
      <div style={{ color:'#DC2626', fontSize:'14px' }}>⚠ {error}</div>
      <button onClick={fetchSalon} style={{ background:'#1A1A2E', color:'#fff', border:'none', padding:'8px 20px', cursor:'pointer', fontWeight:700 }}>RETRY</button>
    </div>
  )

  if (!salon) return null

  // BACKEND GAP — none of these fields exist on GET /admin/salons/:id
  // today (confirmed against controllers/salonDetail.controller.js).
  // Previously this fell back to hardcoded fake rows (fabricated
  // services/staff/documents) presented as if real; now it's a real
  // empty list, and each tab below already has (or now has) an honest
  // empty-state for it.
  const services       = salon.services      || []
  const staff          = salon.staff?.list   || []
  const gallery         = salon.media?.gallery?.length > 0 ? salon.media.gallery : []
  const documents       = salon.documents      || []
  const recentBookings  = salon.recentBookings || []
  const recentReviews   = salon.recentReviews  || []
  const audit           = salon.audit          || []

  // Approval timeline — derived only from real fields already present
  // in the backend response (approval.status/approvedAt/approvedBy/
  // rejectedAt/rejectedBy/rejectionReason, createdAt), not a fabricated
  // fixed multi-tier workflow.
  const approvalHistory = [
    { event: 'Salon Submitted', date: salon.createdAt, done: true, color: '#059669' },
    salon.approval?.status === 'APPROVED'
      ? { event: `Approved${salon.approval.approvedBy?.name ? ` by ${salon.approval.approvedBy.name}` : ''}`, date: salon.approval.approvedAt, done: true, color: '#059669' }
      : salon.approval?.status === 'REJECTED'
      ? { event: `Rejected${salon.approval.rejectionReason ? `: ${salon.approval.rejectionReason}` : ''}`, date: salon.approval.rejectedAt, done: true, color: '#DC2626' }
      : { event: `Status: ${v(salon.approval?.status, 'PENDING')}`, date: null, done: false, color: '#D97706' },
  ]

  const isIndia = admin?.adminLevel === 'INDIA'
  const st      = STATUS_COLORS[salon.approval?.status] || STATUS_COLORS.PENDING

  return (
    <div style={{ fontFamily:FONTS.body, background:'#F0EAE0', minHeight:'100vh' }}>

      {/* Toast */}
      {toast && (
        <div style={{ position:'fixed', top:'20px', right:'20px', background:toast.color, color:'#fff', padding:'12px 20px', fontSize:'13px', fontWeight:700, zIndex:9999, boxShadow:'0 4px 12px rgba(0,0,0,0.2)' }}>
          {toast.msg}
        </div>
      )}

      {/* ── Header ── */}
      <div style={{ background:'#0D1B2A', borderBottom:'2px solid #B8960C', padding:'0 20px', height:'52px', display:'flex', alignItems:'center', justifyContent:'space-between', position:'sticky', top:0, zIndex:10 }}>
        <div style={{ display:'flex', alignItems:'center', gap:'12px' }}>
          <button onClick={() => navigate('/app/salons')} style={{ background:'rgba(255,255,255,0.07)', border:'1px solid rgba(255,255,255,0.1)', color:'rgba(255,255,255,0.6)', padding:'5px 10px', cursor:'pointer', fontSize:'12px', fontWeight:700 }}>← BACK</button>
          <div style={{ width:'3px', height:'16px', background:'#B8960C' }}/>
          <div>
            <div style={{ color:'#fff', fontWeight:800, fontSize:'13px', letterSpacing:'1px' }}>{v(salon.shopName)}</div>
            <div style={{ color:'#B8960C', fontSize:'9px', letterSpacing:'1px', marginTop:'1px' }}>
              {v(salon.location?.district)} • {v(salon.location?.state)}
            </div>
          </div>
          <span style={{ fontSize:'10px', fontWeight:800, background:st.bg, color:st.color, padding:'3px 10px', letterSpacing:'0.5px' }}>{v(salon.approval?.status)}</span>
          {salon.business?.isSuspended   && <span style={{ fontSize:'10px', fontWeight:800, background:'#FEE2E2', color:'#991B1B', padding:'3px 8px' }}>SUSPENDED</span>}
          {salon.business?.isForceClosed && <span style={{ fontSize:'10px', fontWeight:800, background:'#F3F4F6', color:'#374151', padding:'3px 8px' }}>FORCE CLOSED</span>}
        </div>
        <div style={{ display:'flex', gap:'8px' }}>
          <button onClick={fetchSalon} style={{ background:'rgba(255,255,255,0.07)', border:'1px solid rgba(255,255,255,0.15)', color:'rgba(255,255,255,0.5)', padding:'6px 10px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>↻ REFRESH</button>
          <button onClick={() => navigate(`/app/salons/${id}/edit`)} style={{ background:'rgba(184,150,12,0.15)', border:'1px solid rgba(184,150,12,0.4)', color:'#B8960C', padding:'6px 12px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>✎ EDIT</button>
          <button onClick={() => navigate(`/app/salons/${id}/analytics`)} style={{ background:'rgba(5,150,105,0.15)', border:'1px solid rgba(5,150,105,0.4)', color:'#059669', padding:'6px 12px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>📊 ANALYTICS</button>
          {salon.approval?.status === 'APPROVED' && !salon.business?.isSuspended && (
            <button onClick={() => setShowSuspend(true)} style={{ background:'#DC2626', border:'none', color:'#fff', padding:'6px 12px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>⊘ SUSPEND</button>
          )}
        </div>
      </div>

      {/* ── Tabs ── */}
      <div style={{ background:'#0A1520', borderBottom:'1px solid rgba(184,150,12,0.2)', display:'flex', padding:'0 20px', overflowX:'auto' }}>
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)} style={{ padding:'10px 16px', border:'none', background:'none', cursor:'pointer', fontSize:'10px', fontWeight:tab===t?800:400, color:tab===t?'#B8960C':'rgba(255,255,255,0.35)', borderBottom:tab===t?'2px solid #B8960C':'2px solid transparent', letterSpacing:'1.5px', textTransform:'uppercase', whiteSpace:'nowrap' }}>
            {t}
          </button>
        ))}
      </div>

      {/* ── KPI Strip ── */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:'1px', background:'#D4C9B0', borderBottom:'2px solid #B8960C' }}>
        {[
          { label:'Rating',      value: salon.rating?.average > 0 ? `${salon.rating.average} ★` : 'N/A', color:'#D97706' },
          { label:'Reviews',     value: v(salon.rating?.count, 0),                                         color:'#059669' },
          { label:'Shop Open',   value: salon.business?.isShopOpen ? 'OPEN' : 'CLOSED',                   color: salon.business?.isShopOpen ? '#059669' : '#DC2626' },
          { label:'Onboarding',  value: salon.onboarding?.completed ? 'COMPLETE' : `Step ${v(salon.onboarding?.step, '?')}`, color: salon.onboarding?.completed ? '#059669' : '#D97706' },
        ].map(k => (
          <div key={k.label} style={{ background:'#0D1B2A', padding:'10px 20px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
            <span style={{ fontSize:'11px', color:'rgba(255,255,255,0.4)', letterSpacing:'0.5px' }}>{k.label}</span>
            <span style={{ fontSize:'15px', fontWeight:800, color:k.color }}>{k.value}</span>
          </div>
        ))}
      </div>

      <div style={{ padding:'16px 20px' }}>

        {/* ══ OVERVIEW ══ */}
        {tab === 'overview' && (
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:'14px' }}>

            {/* Quick Summary */}
            <div style={{ gridColumn:'1 / -1', display:'grid', gridTemplateColumns:'repeat(6,1fr)', gap:'8px' }}>
              {[
                { label:'Services',   value: services.length,                                                          icon:'✂️' },
                { label:'Staff',      value: v(salon.staff?.count, staff.length),                                      icon:'👤' },
                { label:'Chair',      value: v(salon.chairCount, '—'),                                                 icon:'💺' },
                { label:'Shop Open',  value: salon.business?.isShopOpen    ? 'YES' : 'NO', color: salon.business?.isShopOpen    ? '#059669' : '#DC2626', icon:'🏪' },
                { label:'Suspended',  value: salon.business?.isSuspended   ? 'YES' : 'NO', color: salon.business?.isSuspended   ? '#DC2626' : '#059669', icon:'⊘'  },
                { label:'Featured',   value: salon.isFeatured              ? 'YES' : 'NO', color: salon.isFeatured              ? '#B8960C' : '#9E8E6E', icon:'⭐' },
              ].map(m => (
                <div key={m.label} style={{ background:'#fff', border:'1px solid #D4C9B0', borderTop:'2px solid #B8960C', padding:'10px 12px', textAlign:'center' }}>
                  <div style={{ fontSize:'18px', marginBottom:'4px' }}>{m.icon}</div>
                  <div style={{ fontSize:'14px', fontWeight:800, color: m.color || '#1A1A2E' }}>{m.value}</div>
                  <div style={{ fontSize:'9px', color:'#9E8E6E', letterSpacing:'0.5px', marginTop:'2px', textTransform:'uppercase' }}>{m.label}</div>
                </div>
              ))}
            </div>

            {/* Basic Info */}
            <BCard>
              <BCardHeader title="Basic Information"/>
              <div style={{ padding:'14px' }}>
                <SLabel title="Salon Details"/>
                <InfoRow label="Shop Name"   value={salon.shopName}/>
                <InfoRow label="Tagline"     value={salon.tagline}/>
                <InfoRow label="Category"    value={salon.category}/>
                <InfoRow label="Tier"        value={salon.tier}/>
                <InfoRow label="Setup Type"  value={salon.setupType}/>
                <InfoRow label="Since"       value={salon.since}/>
                <InfoRow label="Experience"  value={salon.experience}/>
                <InfoRow label="Brand Name"  value={salon.brandName}/>
                <InfoRow label="Branch Code" value={salon.branchCode}/>
                <SLabel title="Dates"/>
                <InfoRow label="Created"     value={dt(salon.createdAt)}/>
                <InfoRow label="Updated"     value={dt(salon.updatedAt)}/>
                <InfoRow label="Approved On" value={dt(salon.approval?.approvedAt)} valueColor={salon.approval?.approvedAt ? '#059669' : '#D97706'}/>
                <InfoRow label="Approved By" value={salon.approval?.approvedBy?.name} valueColor={salon.approval?.approvedBy ? '#059669' : '#D97706'}/>
                <InfoRow label="Approver Level" value={salon.approval?.approvedBy?.adminLevel}/>
              </div>
            </BCard>

            {/* Owner & Contact */}
            <BCard>
              <BCardHeader title="Owner & Contact"/>
              <div style={{ padding:'14px' }}>
                <SLabel title="Owner"/>
                <InfoRow label="Name"      value={salon.owner?.name}/>
                <InfoRow label="Phone"     value={salon.owner?.phone}/>
                <InfoRow label="Email"     value={salon.owner?.email}/>
                <InfoRow label="WhatsApp"  value={salon.whatsapp}/>
                <SLabel title="Manager"/>
                <InfoRow label="Name"      value={salon.manager?.name}/>
                <InfoRow label="Phone"     value={salon.manager?.phone}/>
                <SLabel title="Location"/>
                <InfoRow label="Address"   value={salon.location?.address}/>
                <InfoRow label="Area"      value={salon.location?.area}/>
                <InfoRow label="City"      value={salon.location?.city}/>
                <InfoRow label="District"  value={salon.location?.district}/>
                <InfoRow label="State"     value={salon.location?.state}/>
                <InfoRow label="Country"   value={salon.location?.country}/>
              </div>
            </BCard>

            {/* Business & Amenities */}
            <BCard>
              <BCardHeader title="Business & Amenities"/>
              <div style={{ padding:'14px' }}>
                <SLabel title="Business Status"/>
                <InfoRow label="Shop Open"      value={salon.business?.isShopOpen    ? '✓ Yes' : '✗ No'} valueColor={salon.business?.isShopOpen    ? '#059669' : '#DC2626'}/>
                <InfoRow label="Force Closed"   value={salon.business?.isForceClosed ? '✓ Yes' : '✗ No'} valueColor={salon.business?.isForceClosed ? '#DC2626' : '#059669'}/>
                <InfoRow label="Suspended"      value={salon.business?.isSuspended   ? '✓ Yes' : '✗ No'} valueColor={salon.business?.isSuspended   ? '#DC2626' : '#059669'}/>
                {salon.business?.suspendedReason && <InfoRow label="Suspend Reason" value={salon.business.suspendedReason} valueColor="#DC2626"/>}
                {isIndia && <InfoRow label="Commission" value={salon.business?.commissionRate != null ? `${salon.business.commissionRate}%` : 'Platform Default'}/>}
                <SLabel title="Amenities"/>
                <InfoRow label="AC"           value={salon.amenities?.hasAC       ? '✓ Yes' : '✗ No'} valueColor={salon.amenities?.hasAC       ? '#059669' : '#DC2626'}/>
                <InfoRow label="Parking"      value={salon.amenities?.hasParking  ? '✓ Yes' : '✗ No'} valueColor={salon.amenities?.hasParking  ? '#059669' : '#DC2626'}/>
                <InfoRow label="WiFi"         value={salon.amenities?.hasWifi     ? '✓ Yes' : '✗ No'} valueColor={salon.amenities?.hasWifi     ? '#059669' : '#DC2626'}/>
                <InfoRow label="Restroom"     value={salon.amenities?.restroom    ? '✓ Yes' : '✗ No'} valueColor={salon.amenities?.restroom    ? '#059669' : '#DC2626'}/>
                <InfoRow label="Waiting Area" value={salon.amenities?.waitingArea ? '✓ Yes' : '✗ No'} valueColor={salon.amenities?.waitingArea ? '#059669' : '#DC2626'}/>
                <SLabel title="Staff"/>
                <InfoRow label="Staff Count"  value={v(salon.staff?.count, 0)}/>
                <InfoRow label="Male Staff"   value={salon.staff?.genderSupport?.male   ? '✓ Yes' : '✗ No'}/>
                <InfoRow label="Female Staff" value={salon.staff?.genderSupport?.female ? '✓ Yes' : '✗ No'}/>
                <InfoRow label="Chair Count"  value={v(salon.chairCount, 0)}/>
              </div>
            </BCard>

            {/* Assigned Admin + Approval History */}
            <BCard style={{ gridColumn:'1 / -1' }}>
              <BCardHeader title="Assigned Admin & Approval History"/>
              <div style={{ padding:'14px', display:'grid', gridTemplateColumns:'1fr 1fr', gap:'20px' }}>
                <div>
                  <SLabel title="Assigned Admin"/>
                  <InfoRow label="Name"       value={salon.assignedAdmin?.name}/>
                  <InfoRow label="Phone"      value={salon.assignedAdmin?.phone}/>
                  <InfoRow label="Level"      value={salon.assignedAdmin?.adminLevel}/>
                  <SLabel title="Specializations"/>
                  <InfoRow label="Types" value={salon.specializations?.length > 0 ? salon.specializations.join(', ') : '—'}/>
                  <InfoRow label="Capabilities" value={salon.capabilities?.length > 0 ? salon.capabilities.join(', ') : '—'}/>
                </div>
                <div>
                  <SLabel title="Approval Timeline"/>
                  <div style={{ position:'relative', paddingLeft:'20px', marginTop:'8px' }}>
                    <div style={{ position:'absolute', left:'7px', top:'6px', bottom:'6px', width:'2px', background:'#E8DFD0' }}/>
                    {approvalHistory.map((h, i) => (
                      <div key={i} style={{ position:'relative', marginBottom:'10px' }}>
                        <div style={{ position:'absolute', left:'-16px', top:'2px', width:'12px', height:'12px', background:h.done?h.color:'#E8DFD0', border:`2px solid ${h.done?h.color:'#D4C9B0'}`, display:'flex', alignItems:'center', justifyContent:'center' }}>
                          {h.done && <span style={{ color:'#fff', fontSize:'7px', fontWeight:800 }}>✓</span>}
                        </div>
                        <div style={{ display:'flex', justifyContent:'space-between' }}>
                          <span style={{ fontSize:'11px', color:h.done?'#1A1A2E':'#9E8E6E', fontWeight:h.done?600:400 }}>{h.event}</span>
                          <span style={{ fontSize:'10px', color:h.done?h.color:'#C4B49A' }}>{h.date ? dt(h.date) : 'Pending'}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </BCard>

            {/* Timings */}
            <BCard style={{ gridColumn:'1 / -1' }}>
              <BCardHeader title="Operating Hours"/>
              <div style={{ padding:'14px', display:'grid', gridTemplateColumns:'repeat(7,1fr)', gap:'8px' }}>
                {DAYS.map(day => {
                  const t = salon.timings?.[day]
                  if (!t) return (
                    <div key={day} style={{ textAlign:'center', padding:'10px 6px', background:'#F5F0E8', border:'1px solid #E8DFD0', borderTop:'2px solid #B8960C' }}>
                      <div style={{ fontSize:'9px', fontWeight:800, color:'#9E8E6E', letterSpacing:'1px', textTransform:'uppercase', marginBottom:'6px' }}>{day.slice(0,3).toUpperCase()}</div>
                      <div style={{ fontSize:'10px', color:'#C4B49A' }}>—</div>
                    </div>
                  )
                  return (
                    <div key={day} style={{ textAlign:'center', padding:'10px 6px', background:t.isClosed?'#FEF2F2':'#F0FDF4', border:`1px solid ${t.isClosed?'#FEE2E2':'#D1FAE5'}`, borderTop:`2px solid ${t.isClosed?'#DC2626':'#B8960C'}` }}>
                      <div style={{ fontSize:'9px', fontWeight:800, color:'#9E8E6E', letterSpacing:'1px', textTransform:'uppercase', marginBottom:'6px' }}>{day.slice(0,3).toUpperCase()}</div>
                      {t.isClosed
                        ? <div style={{ fontSize:'10px', color:'#DC2626', fontWeight:700 }}>CLOSED</div>
                        : <><div style={{ fontSize:'11px', fontWeight:700, color:'#1A1A2E' }}>{v(t.open)}</div><div style={{ fontSize:'9px', color:'#9E8E6E', margin:'2px 0' }}>to</div><div style={{ fontSize:'11px', fontWeight:700, color:'#1A1A2E' }}>{v(t.close)}</div></>
                      }
                    </div>
                  )
                })}
              </div>
            </BCard>
          </div>
        )}

        {/* ══ SERVICES ══ */}
        {tab === 'services' && (
          <BCard>
            <BCardHeader title={`Services (${services.length})`}/>
            <div style={{ display:'grid', gridTemplateColumns:'2fr 1fr 1fr 1fr', padding:'8px 16px', background:'#F5F0E8', borderBottom:'1px solid #E8DFD0', gap:'8px' }}>
              {['SERVICE NAME','PRICE','DURATION','BOOKINGS'].map(h => (
                <span key={h} style={{ fontSize:'9px', fontWeight:800, color:'#9E8E6E', letterSpacing:'1px' }}>{h}</span>
              ))}
            </div>
            {services.length === 0
              ? <div style={{ padding:'40px', textAlign:'center', color:'#9E8E6E' }}>No services added yet</div>
              : services.map((s, i) => (
              <div key={i} style={{ display:'grid', gridTemplateColumns:'2fr 1fr 1fr 1fr', padding:'12px 16px', borderBottom:'1px solid #F0EAE0', alignItems:'center', gap:'8px', background:i%2===0?'#fff':'#FDFAF6' }}>
                <span style={{ fontSize:'13px', fontWeight:600, color:'#1A1A2E' }}>{v(s.name)}</span>
                <span style={{ fontSize:'13px', fontWeight:700, color:'#B8960C' }}>{s.price != null ? `₹${s.price}` : '—'}</span>
                <span style={{ fontSize:'12px', color:'#6B5E3E' }}>{s.duration != null ? `${s.duration} min` : '—'}</span>
                <span style={{ fontSize:'13px', fontWeight:700, color:'#1A1A2E' }}>{v(s.bookings, 0)}</span>
              </div>
            ))}
          </BCard>
        )}

        {/* ══ TEAM ══ */}
        {tab === 'team' && (
          <BCard>
            <BCardHeader title={`Team (${staff.length})`}/>
            <div style={{ display:'grid', gridTemplateColumns:'2fr 1fr 1.5fr 0.8fr', padding:'8px 16px', background:'#F5F0E8', borderBottom:'1px solid #E8DFD0', gap:'8px' }}>
              {['NAME','ROLE','PHONE','STATUS'].map(h => (
                <span key={h} style={{ fontSize:'9px', fontWeight:800, color:'#9E8E6E', letterSpacing:'1px' }}>{h}</span>
              ))}
            </div>
            {staff.length === 0
              ? <div style={{ padding:'40px', textAlign:'center', color:'#9E8E6E' }}>No team members on file</div>
              : staff.map((m, i) => (
              <div key={i} style={{ display:'grid', gridTemplateColumns:'2fr 1fr 1.5fr 0.8fr', padding:'14px 16px', borderBottom:'1px solid #F0EAE0', alignItems:'center', gap:'8px', background:i%2===0?'#fff':'#FDFAF6' }}>
                <div style={{ display:'flex', alignItems:'center', gap:'10px' }}>
                  <div style={{ width:'32px', height:'32px', background:'#1A1A2E', display:'flex', alignItems:'center', justifyContent:'center', color:'#B8960C', fontSize:'13px', fontWeight:800 }}>{(v(m.name,'?'))[0]}</div>
                  <span style={{ fontSize:'13px', fontWeight:600, color:'#1A1A2E' }}>{v(m.name)}</span>
                </div>
                <span style={{ fontSize:'12px', color:'#6B5E3E' }}>{v(m.role)}</span>
                <span style={{ fontSize:'12px', color:'#1A1A2E' }}>{v(m.phone)}</span>
                <span style={{ fontSize:'10px', fontWeight:800, background:'#D1FAE5', color:'#065F46', padding:'2px 8px', display:'inline-block' }}>{v(m.status, 'ACTIVE')}</span>
              </div>
            ))}
          </BCard>
        )}

        {/* ══ GALLERY ══ */}
        {tab === 'gallery' && (
          <BCard>
            <BCardHeader title="Photo Gallery" action={
              <span style={{ fontSize:'11px', color:'#9E8E6E' }}>{v(salon.media?.galleryCount, gallery.length)} Photos</span>
            }/>
            {gallery.length === 0
              ? <div style={{ padding:'40px', textAlign:'center', color:'#9E8E6E' }}>No photos uploaded yet</div>
              : <div style={{ padding:'16px', display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:'12px' }}>
                  {gallery.map((g, i) => (
                    <div key={i} style={{ border:'1px solid #E8DFD0', borderTop:'2px solid #B8960C' }}>
                      {g.url
                        ? <img src={g.url} alt={g.caption||'gallery'} style={{ width:'100%', height:'120px', objectFit:'cover' }}/>
                        : <div style={{ background:'#F5F0E8', height:'120px', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:'8px' }}>
                            <span style={{ fontSize:'32px' }}>{g.emoji || '🖼️'}</span>
                            <span style={{ fontSize:'10px', color:'#9E8E6E', fontWeight:600 }}>{g.count ? `${g.count} photos` : '—'}</span>
                          </div>
                      }
                      <div style={{ padding:'8px 10px', borderTop:'1px solid #E8DFD0' }}>
                        <div style={{ fontSize:'11px', fontWeight:700, color:'#1A1A2E' }}>{v(g.caption || g.label)}</div>
                      </div>
                    </div>
                  ))}
                </div>
            }
          </BCard>
        )}

        {/* ══ DOCUMENTS ══ */}
        {tab === 'documents' && (
          <BCard>
            <BCardHeader title="KYC Documents" action={
              <span style={{ fontSize:'11px', color:'#9E8E6E' }}>{documents.filter(d=>d.status==='VERIFIED').length}/{documents.length} Verified</span>
            }/>
            {documents.length > 0 && (
              <div style={{ padding:'12px 16px', borderBottom:'1px solid #E8DFD0', background:'#FDFAF6' }}>
                <div style={{ display:'flex', justifyContent:'space-between', marginBottom:'6px' }}>
                  <span style={{ fontSize:'11px', color:'#9E8E6E' }}>Verification Progress</span>
                  <span style={{ fontSize:'11px', fontWeight:700, color:'#B8960C' }}>{Math.round((documents.filter(d=>d.status==='VERIFIED').length/documents.length)*100)}%</span>
                </div>
                <div style={{ height:'6px', background:'#E8DFD0' }}>
                  <div style={{ height:'100%', width:`${(documents.filter(d=>d.status==='VERIFIED').length/documents.length)*100}%`, background:'#B8960C' }}/>
                </div>
              </div>
            )}
            <div style={{ display:'grid', gridTemplateColumns:'2fr 1fr 1fr 1fr', padding:'8px 16px', background:'#F5F0E8', borderBottom:'1px solid #E8DFD0', gap:'8px' }}>
              {['DOCUMENT','STATUS','UPLOADED AT','ACTIONS'].map(h => (
                <span key={h} style={{ fontSize:'9px', fontWeight:800, color:'#9E8E6E', letterSpacing:'1px' }}>{h}</span>
              ))}
            </div>
            {documents.length === 0
              ? (
                <div style={{ padding:'40px', textAlign:'center', color:'#9E8E6E' }}>
                  <div style={{ marginBottom:'10px' }}>KYC documents aren't returned by this screen — they're managed in the KYC module.</div>
                  <button onClick={() => navigate('/app/kyc')} style={{ background:'#B8960C', color:'#0D1B2A', border:'none', padding:'8px 16px', fontSize:'11px', fontWeight:700, cursor:'pointer' }}>VIEW IN KYC MODULE ▸</button>
                </div>
              )
              : documents.map((doc, i) => {
              const ds = DOC_STATUS[doc.status] || DOC_STATUS.PENDING
              return (
                <div key={i} style={{ display:'grid', gridTemplateColumns:'2fr 1fr 1fr 1fr', padding:'13px 16px', borderBottom:'1px solid #F0EAE0', alignItems:'center', gap:'8px', background:i%2===0?'#fff':'#FDFAF6' }}>
                  <div style={{ display:'flex', alignItems:'center', gap:'10px' }}>
                    <div style={{ width:'8px', height:'8px', background:ds.color, flexShrink:0 }}/>
                    <span style={{ fontSize:'13px', color:'#1A1A2E', fontWeight:500 }}>{v(doc.name)}</span>
                  </div>
                  <span style={{ fontSize:'10px', fontWeight:800, background:ds.bg, color:ds.color, padding:'3px 8px', display:'inline-block' }}>{ds.label}</span>
                  <span style={{ fontSize:'11px', color:'#9E8E6E' }}>{v(doc.uploadedAt)}</span>
                  {/* NOTE: no backend endpoint exists to fetch/view a document file from this screen yet. */}
                  <button onClick={() => showToast('⚠ Not available yet — no backend endpoint exists to view this document', '#DC2626')} style={{ background:'#B8960C', color:'#fff', border:'none', padding:'4px 10px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>VIEW</button>
                </div>
              )
            })}
          </BCard>
        )}

        {/* ══ BOOKINGS ══ */}
        {tab === 'bookings' && (
          <BCard>
            <BCardHeader title={`Recent Bookings (${recentBookings.length})`}/>
            {recentBookings.length === 0
              ? <div style={{ padding:'40px', textAlign:'center', color:'#9E8E6E' }}>No bookings yet</div>
              : <>
                  <div style={{ display:'grid', gridTemplateColumns:'0.8fr 1.5fr 1.5fr 1fr 1fr 0.8fr', padding:'8px 16px', background:'#F5F0E8', borderBottom:'1px solid #E8DFD0', gap:'8px' }}>
                    {['BOOKING ID','CUSTOMER','SERVICE','AMOUNT','DATE','STATUS'].map(h => (
                      <span key={h} style={{ fontSize:'9px', fontWeight:800, color:'#9E8E6E', letterSpacing:'1px' }}>{h}</span>
                    ))}
                  </div>
                  {recentBookings.map((b, i) => {
                    const bs = BOOKING_STATUS[b.status] || BOOKING_STATUS.PENDING
                    return (
                      <div key={i} style={{ display:'grid', gridTemplateColumns:'0.8fr 1.5fr 1.5fr 1fr 1fr 0.8fr', padding:'11px 16px', borderBottom:'1px solid #F0EAE0', alignItems:'center', gap:'8px', background:i%2===0?'#fff':'#FDFAF6' }}>
                        <span style={{ fontSize:'10px', color:'#9E8E6E', fontFamily:'monospace' }}>{v(b.id)}</span>
                        <span style={{ fontSize:'12px', color:'#1A1A2E', fontWeight:500 }}>{v(b.customer)}</span>
                        <span style={{ fontSize:'12px', color:'#6B5E3E' }}>{v(b.service)}</span>
                        <span style={{ fontSize:'12px', fontWeight:700, color:'#B8960C' }}>{b.amount != null ? `₹${b.amount}` : '—'}</span>
                        <span style={{ fontSize:'11px', color:'#9E8E6E' }}>{v(b.date)}</span>
                        <span style={{ fontSize:'9px', fontWeight:800, background:bs.bg, color:bs.color, padding:'2px 8px', display:'inline-block' }}>{v(b.status)}</span>
                      </div>
                    )
                  })}
                </>
            }
          </BCard>
        )}

        {/* ══ REVIEWS ══ */}
        {tab === 'reviews' && (
          <div>
            <BCardHeader title={`Reviews (${recentReviews.length})`}/>
            {recentReviews.length === 0
              ? <BCard><div style={{ padding:'40px', textAlign:'center', color:'#9E8E6E' }}>No reviews yet</div></BCard>
              : recentReviews.map((r, i) => (
                  <BCard key={i} style={{ marginBottom:'10px' }}>
                    <div style={{ padding:'14px 16px' }}>
                      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:'8px' }}>
                        <div style={{ display:'flex', alignItems:'center', gap:'10px' }}>
                          <div style={{ width:'32px', height:'32px', background:'#1A1A2E', display:'flex', alignItems:'center', justifyContent:'center', color:'#B8960C', fontSize:'13px', fontWeight:800 }}>{(v(r.customer,'?'))[0]}</div>
                          <div>
                            <div style={{ fontSize:'13px', fontWeight:700, color:'#1A1A2E' }}>{v(r.customer)}</div>
                            <div style={{ fontSize:'10px', color:'#9E8E6E' }}>{v(r.date)}</div>
                          </div>
                        </div>
                        <div style={{ display:'flex', gap:'2px' }}>
                          {[1,2,3,4,5].map(star => (
                            <span key={star} style={{ color:star<=(r.rating||0)?'#B8960C':'#E8DFD0', fontSize:'16px' }}>★</span>
                          ))}
                        </div>
                      </div>
                      <p style={{ fontSize:'13px', color:'#6B5E3E', margin:0, padding:'10px 14px', background:'#F5F0E8', borderLeft:'3px solid #B8960C' }}>{v(r.comment)}</p>
                    </div>
                  </BCard>
                ))
            }
          </div>
        )}

        {/* ══ WALLET — real data from Finance module's wallet-by-salon endpoint ══ */}
        {tab === 'wallet' && (
          walletLoading ? (
            <div style={{ padding:'40px', textAlign:'center', color:'#9E8E6E' }}>Loading wallet...</div>
          ) : walletError ? (
            <div style={{ padding:'40px', textAlign:'center', color:'#DC2626' }}>{walletError}</div>
          ) : !wallet ? (
            <div style={{ padding:'40px', textAlign:'center', color:'#9E8E6E' }}>No wallet found for this salon</div>
          ) : (
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'14px' }}>
            <BCard>
              <BCardHeader title="Wallet Overview"/>
              <div style={{ padding:'14px' }}>
                <div style={{ background:'#0D1B2A', padding:'20px', marginBottom:'14px', textAlign:'center', borderTop:'2px solid #B8960C' }}>
                  <div style={{ fontSize:'11px', color:'rgba(255,255,255,0.4)', letterSpacing:'1px', marginBottom:'8px' }}>CURRENT BALANCE</div>
                  <div style={{ fontSize:'36px', fontWeight:800, color:'#B8960C' }}>₹{((wallet.availableBalanceInPaise ?? 0)/100).toLocaleString('en-IN')}</div>
                </div>
                <InfoRow label="Total Earned"    value={`₹${((wallet.lifetimeEarningsInPaise    ?? 0)/100).toLocaleString('en-IN')}`}/>
                <InfoRow label="Total Withdrawn" value={`₹${((wallet.lifetimeWithdrawalsInPaise ?? 0)/100).toLocaleString('en-IN')}`}/>
                <InfoRow label="Pending Payout"  value={`₹${((wallet.lockedBalanceInPaise        ?? 0)/100).toLocaleString('en-IN')}`} valueColor="#D97706"/>
                <InfoRow label="Wallet Status"   value={wallet.status} valueColor={wallet.status==='ACTIVE'?'#059669':wallet.status==='FROZEN'?'#2563EB':'#DC2626'}/>
              </div>
            </BCard>
            <BCard>
              <BCardHeader title="Payout Actions"/>
              <div style={{ padding:'14px' }}>
                <div style={{ background:'#FFFBEB', border:'1px solid #FDE68A', padding:'12px', marginBottom:'14px' }}>
                  <div style={{ fontSize:'11px', color:'#92400E', fontWeight:600 }}>⚠ Pending payout requires admin approval before transfer.</div>
                </div>
                <button onClick={() => navigate(`/app/finance/payouts?salonId=${salon.id}`)} style={{ width:'100%', background:'#B8960C', color:'#0D1B2A', border:'none', padding:'11px', fontSize:'12px', fontWeight:800, cursor:'pointer', marginBottom:'8px', letterSpacing:'0.5px' }}>VIEW PAYOUT REQUESTS ▸</button>
                {canFreezeWallet(admin?.adminLevel) && (wallet.status === 'ACTIVE' ? (
                  <button onClick={async () => {
                    try { await FinanceAPI.freezeWallet(wallet.id, { action:'FREEZE' }); showToast('❄ Wallet frozen', '#2563EB'); setWallet(null) }
                    catch (err) { showToast(err.message || 'Freeze failed', '#DC2626') }
                  }} style={{ width:'100%', background:'#FEF2F2', color:'#DC2626', border:'1px solid #DC2626', padding:'11px', fontSize:'12px', fontWeight:800, cursor:'pointer', letterSpacing:'0.5px' }}>⊘ FREEZE WALLET</button>
                ) : (
                  <button onClick={async () => {
                    try { await FinanceAPI.freezeWallet(wallet.id, { action:'UNFREEZE' }); showToast('✓ Wallet unfrozen', '#059669'); setWallet(null) }
                    catch (err) { showToast(err.message || 'Unfreeze failed', '#DC2626') }
                  }} style={{ width:'100%', background:'#F0FDF4', color:'#059669', border:'1px solid #059669', padding:'11px', fontSize:'12px', fontWeight:800, cursor:'pointer', letterSpacing:'0.5px' }}>✓ UNFREEZE WALLET</button>
                ))}
              </div>
            </BCard>
          </div>
          )
        )}

        {/* ══ LOCATION ══ */}
        {tab === 'location' && (
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'14px' }}>
            <BCard>
              <BCardHeader title="Location Details"/>
              <div style={{ padding:'14px' }}>
                <InfoRow label="Full Address" value={salon.location?.address}/>
                <InfoRow label="Area"         value={salon.location?.area}/>
                <InfoRow label="City"         value={salon.location?.city}/>
                <InfoRow label="District"     value={salon.location?.district}/>
                <InfoRow label="State"        value={salon.location?.state}/>
                <InfoRow label="Country"      value={salon.location?.country}/>
                <SLabel title="Coordinates"/>
                <InfoRow label="Latitude"     value={salon.location?.geo?.lat}/>
                <InfoRow label="Longitude"    value={salon.location?.geo?.lng}/>
              </div>
            </BCard>
            <BCard>
              <BCardHeader title="Map Preview"/>
              <div style={{ padding:'16px' }}>
                <div style={{ background:'#F5F0E8', border:'1px solid #E8DFD0', height:'220px', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:'8px', borderTop:'2px solid #B8960C' }}>
                  <div style={{ fontSize:'32px' }}>📍</div>
                  <div style={{ fontSize:'13px', fontWeight:700, color:'#1A1A2E' }}>{v(salon.shopName)}</div>
                  <div style={{ fontSize:'11px', color:'#9E8E6E', textAlign:'center', maxWidth:'220px' }}>{v(salon.location?.address)}</div>
                </div>
                {salon.location?.geo?.lat && (
                  <button onClick={() => window.open(`https://www.google.com/maps?q=${salon.location.geo.lat},${salon.location.geo.lng}`, '_blank')}
                    style={{ width:'100%', marginTop:'10px', background:'#B8960C', color:'#0D1B2A', border:'none', padding:'9px', fontSize:'11px', fontWeight:800, cursor:'pointer' }}>
                    OPEN IN GOOGLE MAPS ↗
                  </button>
                )}
              </div>
            </BCard>
          </div>
        )}

        {/* ══ AUDIT ══ */}
        {tab === 'audit' && (
          <BCard>
            <BCardHeader title="Audit Log — Immutable" action={<span style={{ fontSize:'10px', color:'#DC2626', fontWeight:700 }}>⚠ CANNOT BE DELETED</span>}/>
            <div style={{ display:'grid', gridTemplateColumns:'1.5fr 1.2fr 2fr 1fr', padding:'8px 16px', background:'#F5F0E8', borderBottom:'1px solid #E8DFD0', gap:'8px' }}>
              {['DATE & TIME','ADMIN','ACTION','IP'].map(h => (
                <span key={h} style={{ fontSize:'9px', fontWeight:800, color:'#9E8E6E', letterSpacing:'1px' }}>{h}</span>
              ))}
            </div>
            {audit.length === 0
              ? <div style={{ padding:'40px', textAlign:'center', color:'#9E8E6E' }}>No audit logs yet</div>
              : audit.map((a, i) => (
                  <div key={i} style={{ display:'grid', gridTemplateColumns:'1.5fr 1.2fr 2fr 1fr', padding:'11px 16px', borderBottom:'1px solid #F0EAE0', alignItems:'center', gap:'8px', background:i%2===0?'#fff':'#FDFAF6' }}>
                    <span style={{ fontSize:'11px', color:'#6B5E3E', fontFamily:'monospace' }}>{v(a.date)}</span>
                    <span style={{ fontSize:'12px', color:'#1A1A2E', fontWeight:600 }}>{v(a.admin)}</span>
                    <span style={{ fontSize:'12px', color:'#1A1A2E' }}>{v(a.action)}</span>
                    <span style={{ fontSize:'11px', color:'#C4B49A', fontStyle:'italic' }}>{v(a.ip, 'Backend')}</span>
                  </div>
                ))
            }
          </BCard>
        )}

      </div>

      {/* Footer */}
      <div style={{ background:'#0D1B2A', borderTop:'2px solid #B8960C', padding:'10px 20px', display:'flex', justifyContent:'space-between', marginTop:'14px' }}>
        <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.3)', letterSpacing:'0.5px' }}>ZEMISH SALON DETAIL v1.0.0</span>
        <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.3)', letterSpacing:'0.5px' }}>NATIONAL COMMAND CENTER</span>
      </div>

      {showSuspend && <SuspendModal salonName={v(salon.shopName)} onConfirm={handleSuspend} onCancel={() => setShowSuspend(false)}/>}
    </div>
  )
}