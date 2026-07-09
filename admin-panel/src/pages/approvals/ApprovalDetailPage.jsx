import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { FONTS } from '../../config/brand'
import useAuthStore from '../../store/authStore'
import ApprovalsAPI from './api/approvals.api'

// ─── Helpers ─────────────────────────────────────────────
const v   = (val, fb = '—') => (val !== null && val !== undefined && val !== '') ? val : fb
const dt  = (d) => d ? new Date(d).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' }) : '—'
const dtm = (d) => d ? new Date(d).toLocaleString('en-IN') : '—'

// ─── Constants ────────────────────────────────────────────
const STATUS_COLORS = {
  PENDING:     { bg: '#FEF9C3', color: '#92400E' },
  RECOMMENDED: { bg: '#DCFCE7', color: '#166534' },
  APPROVED:    { bg: '#D1FAE5', color: '#065F46' },
  REJECTED:    { bg: '#FEE2E2', color: '#991B1B' },
  DRAFT:       { bg: '#F3F4F6', color: '#374151' },
}
const DAYS = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday']

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
const SectionLabel = ({ title }) => (
  <div style={{ display:'flex', alignItems:'center', gap:'8px', margin:'12px 0 8px' }}>
    <div style={{ width:'3px', height:'12px', background:'#B8960C' }}/>
    <span style={{ fontSize:'9px', fontWeight:800, color:'#9E8E6E', letterSpacing:'2px', textTransform:'uppercase' }}>{title}</span>
  </div>
)
const InfoRow = ({ label, value, valueColor }) => (
  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', padding:'7px 0', borderBottom:'1px solid #F0EAE0', gap:'8px' }}>
    <span style={{ fontSize:'12px', color:'#9E8E6E', flexShrink:0 }}>{label}</span>
    <span style={{ fontSize:'12px', fontWeight:600, color:valueColor||'#1A1A2E', textAlign:'right', wordBreak:'break-word' }}>{v(value)}</span>
  </div>
)

// ─── Confirm Modal ────────────────────────────────────────
function ConfirmModal({ action, salonName, reason, onConfirm, onCancel }) {
  const isApprove   = action === 'APPROVE'
  const isRecommend = action === 'RECOMMEND'
  const color = isApprove ? '#B8960C' : isRecommend ? '#059669' : '#DC2626'
  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.75)', zIndex:2000, display:'flex', alignItems:'center', justifyContent:'center' }}>
      <div style={{ background:'#fff', width:'420px', border:`2px solid ${color}` }}>
        <div style={{ background: isApprove?'#0D1B2A':isRecommend?'#064E3B':'#7F1D1D', padding:'14px 18px', borderBottom:`2px solid ${color}` }}>
          <div style={{ color:'#fff', fontWeight:800, fontSize:'13px', letterSpacing:'1px' }}>
            {isApprove ? '✓ CONFIRM APPROVAL' : isRecommend ? '↑ CONFIRM RECOMMENDATION' : '✕ CONFIRM REJECTION'}
          </div>
        </div>
        <div style={{ padding:'20px 18px' }}>
          <div style={{ fontSize:'12px', color:'#9E8E6E', padding:'10px', background:'#F5F0E8', border:'1px solid #E8DFD0', marginBottom:'16px' }}>
            <strong>{v(salonName)}</strong>
          </div>
          {!isApprove && !isRecommend && reason && (
            <div style={{ fontSize:'12px', color:'#DC2626', marginBottom:'12px', padding:'8px', background:'#FEF2F2', border:'1px solid #FEE2E2' }}>
              Reason: {reason}
            </div>
          )}
          <div style={{ display:'flex', gap:'8px', justifyContent:'flex-end' }}>
            <button onClick={onCancel} style={{ background:'#fff', border:'1px solid #D4C9B0', color:'#6B5E3E', padding:'8px 16px', fontSize:'11px', fontWeight:700, cursor:'pointer' }}>CANCEL</button>
            <button onClick={onConfirm} style={{ background:color, border:'none', color:isApprove?'#0D1B2A':'#fff', padding:'8px 20px', fontSize:'11px', fontWeight:800, cursor:'pointer' }}>
              {isApprove ? '✓ YES, APPROVE' : isRecommend ? '↑ YES, RECOMMEND' : '✕ YES, REJECT'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────
export default function ApprovalDetailPage() {
  const { id }   = useParams()
  const navigate = useNavigate()
  const admin    = useAuthStore(s => s.admin)
  const adminLevel = admin?.adminLevel || 'INDIA'

  const [salon,      setSalon]      = useState(null)
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState(null)
  const [processing, setProcessing] = useState(false)
  const [tab,        setTab]        = useState('overview')
  const [reason,     setReason]     = useState('')
  const [confirm,    setConfirm]    = useState(null)
  const [toast,      setToast]      = useState(null)

  const showToast = (msg, color = '#059669') => {
    setToast({ msg, color })
    setTimeout(() => setToast(null), 3000)
  }

  const fetchSalon = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await ApprovalsAPI.getById(id)
      setSalon(res.data)
    } catch (err) {
      setError(err.message || 'Failed to load')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchSalon() }, [id])

  const handleApprove = async () => {
    setProcessing(true)
    try {
      await ApprovalsAPI.updateStatus(id, { status: 'APPROVED' })
      showToast('✓ Salon Approved', '#059669')
      fetchSalon()
    } catch (err) {
      showToast(`⚠ ${err.message}`, '#DC2626')
    } finally {
      setProcessing(false)
      setConfirm(null)
    }
  }

  const handleReject = async () => {
    if (!reason.trim()) { showToast('⚠ Rejection reason required', '#D97706'); return }
    setProcessing(true)
    try {
      await ApprovalsAPI.updateStatus(id, { status: 'REJECTED', rejectionReason: reason })
      showToast('✕ Salon Rejected', '#DC2626')
      fetchSalon()
    } catch (err) {
      showToast(`⚠ ${err.message}`, '#DC2626')
    } finally {
      setProcessing(false)
      setConfirm(null)
    }
  }

  const handleConfirm = () => {
    if (confirm === 'APPROVE') handleApprove()
    else handleReject()
  }

  const canRecommend = adminLevel === 'DISTRICT'
  const canApprove   = ['INDIA', 'STATE'].includes(adminLevel)

  // ── Loading ──
  if (loading) return (
    <div style={{ minHeight:'100vh', background:'#F0EAE0', display:'flex', alignItems:'center', justifyContent:'center', fontFamily:FONTS.body, color:'#9E8E6E' }}>
      Loading salon...
    </div>
  )

  if (error) return (
    <div style={{ minHeight:'100vh', background:'#F0EAE0', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', fontFamily:FONTS.body, gap:'12px' }}>
      <div style={{ color:'#DC2626' }}>⚠ {error}</div>
      <button onClick={fetchSalon} style={{ background:'#1A1A2E', color:'#fff', border:'none', padding:'8px 20px', cursor:'pointer', fontWeight:700 }}>RETRY</button>
    </div>
  )

  if (!salon) return null

  const st = STATUS_COLORS[salon.approval?.status] || STATUS_COLORS.PENDING
  const approvalStatus = salon.approval?.status

  const TABS = ['overview', 'documents', 'timeline', 'activity', 'location']

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
          <button onClick={() => navigate('/app/approvals')} style={{ background:'rgba(255,255,255,0.07)', border:'1px solid rgba(255,255,255,0.1)', color:'rgba(255,255,255,0.6)', padding:'5px 10px', cursor:'pointer', fontSize:'12px', fontWeight:700 }}>← BACK</button>
          <div style={{ width:'3px', height:'16px', background:'#B8960C' }}/>
          <div>
            <div style={{ color:'#fff', fontWeight:800, fontSize:'13px', letterSpacing:'1px' }}>{v(salon.shopName)}</div>
            <div style={{ color:'#B8960C', fontSize:'9px', letterSpacing:'1px', marginTop:'1px' }}>
              {v(salon.location?.district)}, {v(salon.location?.state)} • SALON REVIEW
            </div>
          </div>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:'10px' }}>
          <span style={{ fontSize:'10px', fontWeight:800, background:st.bg, color:st.color, padding:'4px 12px', letterSpacing:'1px' }}>{v(approvalStatus)}</span>
          <button onClick={fetchSalon} style={{ background:'rgba(255,255,255,0.07)', border:'1px solid rgba(255,255,255,0.15)', color:'rgba(255,255,255,0.5)', padding:'5px 10px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>↻</button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ background:'#0A1520', borderBottom:'1px solid rgba(184,150,12,0.2)', display:'flex', padding:'0 20px' }}>
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)} style={{ padding:'11px 18px', border:'none', background:'none', cursor:'pointer', fontSize:'10px', fontWeight:tab===t?800:400, color:tab===t?'#B8960C':'rgba(255,255,255,0.35)', borderBottom:tab===t?'2px solid #B8960C':'2px solid transparent', letterSpacing:'1.5px', textTransform:'uppercase' }}>
            {t}
          </button>
        ))}
      </div>

      <div style={{ padding:'16px 20px', maxWidth:'1200px', paddingBottom:'80px' }}>

        {/* ══ OVERVIEW ══ */}
        {tab === 'overview' && (
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:'14px' }}>

            <BCard>
              <BCardHeader title="Basic Information"/>
              <div style={{ padding:'14px' }}>
                <SectionLabel title="Salon Details"/>
                <InfoRow label="Shop Name"   value={salon.shopName}/>
                <InfoRow label="Brand Name"  value={salon.brandName}/>
                <InfoRow label="Branch Code" value={salon.branchCode}/>
                <InfoRow label="Category"    value={salon.category}/>
                <InfoRow label="Tier"        value={salon.tier}/>
                <InfoRow label="Setup Type"  value={salon.setupType}/>
                <InfoRow label="Since"       value={salon.since}/>
                <InfoRow label="Experience"  value={salon.experience}/>
                <InfoRow label="Tagline"     value={salon.tagline}/>
                <SectionLabel title="Dates"/>
                <InfoRow label="Submitted"   value={dt(salon.createdAt)}/>
                <InfoRow label="Approved On" value={dt(salon.approval?.approvedAt)} valueColor={salon.approval?.approvedAt?'#059669':'#9E8E6E'}/>
                <InfoRow label="Approved By" value={salon.approval?.approvedBy?.name} valueColor={salon.approval?.approvedBy?'#059669':'#9E8E6E'}/>
                <InfoRow label="Rejected By" value={salon.approval?.rejectedBy?.name} valueColor={salon.approval?.rejectedBy?'#DC2626':'#9E8E6E'}/>
                <InfoRow label="Rejection Reason" value={salon.approval?.rejectionReason} valueColor="#DC2626"/>
              </div>
            </BCard>

            <BCard>
              <BCardHeader title="Owner & Contact"/>
              <div style={{ padding:'14px' }}>
                <SectionLabel title="Owner"/>
                <InfoRow label="Name"     value={salon.owner?.name}/>
                <InfoRow label="Phone"    value={salon.owner?.phone}/>
                <InfoRow label="Email"    value={salon.owner?.email}/>
                <InfoRow label="WhatsApp" value={salon.whatsapp}/>
                <SectionLabel title="Manager"/>
                <InfoRow label="Name"     value={salon.manager?.name}/>
                <InfoRow label="Phone"    value={salon.manager?.phone}/>
                <SectionLabel title="Staff"/>
                <InfoRow label="Count"        value={salon.staff?.count}/>
                <InfoRow label="Male Staff"   value={salon.staff?.genderSupport?.male   ? '✓ Yes' : '✗ No'}/>
                <InfoRow label="Female Staff" value={salon.staff?.genderSupport?.female ? '✓ Yes' : '✗ No'}/>
              </div>
            </BCard>

            <BCard>
              <BCardHeader title="Amenities & Assignment"/>
              <div style={{ padding:'14px' }}>
                <SectionLabel title="Amenities"/>
                <InfoRow label="AC"           value={salon.amenities?.hasAC       ? '✓ Yes' : '✗ No'} valueColor={salon.amenities?.hasAC       ? '#059669' : '#DC2626'}/>
                <InfoRow label="Parking"      value={salon.amenities?.hasParking  ? '✓ Yes' : '✗ No'} valueColor={salon.amenities?.hasParking  ? '#059669' : '#DC2626'}/>
                <InfoRow label="WiFi"         value={salon.amenities?.hasWifi     ? '✓ Yes' : '✗ No'} valueColor={salon.amenities?.hasWifi     ? '#059669' : '#DC2626'}/>
                <InfoRow label="Restroom"     value={salon.amenities?.restroom    ? '✓ Yes' : '✗ No'} valueColor={salon.amenities?.restroom    ? '#059669' : '#DC2626'}/>
                <InfoRow label="Waiting Area" value={salon.amenities?.waitingArea ? '✓ Yes' : '✗ No'} valueColor={salon.amenities?.waitingArea ? '#059669' : '#DC2626'}/>
                <SectionLabel title="Assignment"/>
                <InfoRow label="Assigned To"  value={salon.assignedAdmin?.name}/>
                <InfoRow label="Admin Level"  value={salon.assignedAdmin?.adminLevel}/>
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

        {/* ══ DOCUMENTS ══ */}
        {tab === 'documents' && (
          <BCard>
            <BCardHeader title="KYC Documents"/>
            <div style={{ padding:'40px', textAlign:'center', color:'#9E8E6E', fontSize:'13px' }}>
              Documents — KYC module se aayenge (Phase 8)
            </div>
          </BCard>
        )}

        {/* ══ TIMELINE ══ */}
        {tab === 'timeline' && (
          <BCard>
            <BCardHeader title="Approval Timeline"/>
            <div style={{ padding:'24px 20px' }}>
              <div style={{ position:'relative', paddingLeft:'32px' }}>
                <div style={{ position:'absolute', left:'11px', top:'12px', bottom:'12px', width:'2px', background:'#E8DFD0' }}/>
                {[
                  { event:'Salon Registered',       done: true,  time: dt(salon.createdAt),             by: salon.owner?.name },
                  { event:'Documents Uploaded',      done: true,  time: '—',                             by: salon.owner?.name },
                  { event:'Assigned to Admin',       done: !!salon.assignedAdmin, time: '—',             by: 'System' },
                  { event:'District Review',         done: ['APPROVED','REJECTED'].includes(approvalStatus), time: '—', by: salon.assignedAdmin?.name },
                  { event:'Salon Approved',          done: approvalStatus === 'APPROVED', time: dt(salon.approval?.approvedAt), by: salon.approval?.approvedBy?.name },
                ].map((t, i) => (
                  <div key={i} style={{ position:'relative', marginBottom:'24px' }}>
                    <div style={{ position:'absolute', left:'-24px', top:'4px', width:'22px', height:'22px', background:t.done?'#B8960C':'#F5F0E8', border:`2px solid ${t.done?'#B8960C':'#D4C9B0'}`, display:'flex', alignItems:'center', justifyContent:'center' }}>
                      {t.done ? <span style={{ color:'#fff', fontSize:'11px', fontWeight:800 }}>✓</span> : <span style={{ color:'#D4C9B0', fontSize:'10px' }}>○</span>}
                    </div>
                    <div style={{ background:t.done?'#FDFAF6':'#F5F0E8', border:`1px solid ${t.done?'#D4C9B0':'#E8DFD0'}`, borderLeft:`3px solid ${t.done?'#B8960C':'#D4C9B0'}`, padding:'12px 16px' }}>
                      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
                        <div>
                          <div style={{ fontSize:'13px', fontWeight:t.done?700:400, color:t.done?'#1A1A2E':'#9E8E6E' }}>{t.event}</div>
                          <div style={{ fontSize:'11px', color:'#9E8E6E', marginTop:'3px' }}>By: {v(t.by)}</div>
                        </div>
                        {t.done && t.time !== '—'
                          ? <span style={{ fontSize:'11px', color:'#B8960C', fontWeight:600, background:'rgba(184,150,12,0.1)', padding:'3px 8px' }}>{t.time}</span>
                          : <span style={{ fontSize:'10px', color:'#C4B49A', fontStyle:'italic' }}>{t.done ? 'Done' : 'Awaiting...'}</span>
                        }
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </BCard>
        )}

        {/* ══ ACTIVITY ══ */}
        {tab === 'activity' && (
          <BCard>
            <BCardHeader title="Activity Log — Immutable Audit Trail" action={
              <span style={{ fontSize:'10px', color:'#DC2626', fontWeight:700 }}>⚠ CANNOT BE DELETED</span>
            }/>
            <div style={{ display:'grid', gridTemplateColumns:'1.2fr 1fr 1.5fr', padding:'8px 16px', background:'#F5F0E8', borderBottom:'1px solid #E8DFD0', gap:'8px' }}>
              {['DATE & TIME','ADMIN','ACTION'].map(h => (
                <span key={h} style={{ fontSize:'9px', fontWeight:800, color:'#9E8E6E', letterSpacing:'1px' }}>{h}</span>
              ))}
            </div>
            {[
              { date: dt(salon.createdAt),              admin: v(salon.owner?.name),                action: 'Salon Registered' },
              { date: '—',                               admin: 'System',                            action: 'Assigned to District Admin' },
              salon.approval?.approvedAt ? { date: dt(salon.approval.approvedAt), admin: v(salon.approval.approvedBy?.name), action: 'Salon APPROVED' } : null,
              salon.approval?.rejectedAt ? { date: dt(salon.approval.rejectedAt), admin: v(salon.approval.rejectedBy?.name), action: `Salon REJECTED — ${v(salon.approval.rejectionReason)}` } : null,
            ].filter(Boolean).map((a, i) => (
              <div key={i} style={{ display:'grid', gridTemplateColumns:'1.2fr 1fr 1.5fr', padding:'11px 16px', borderBottom:'1px solid #F0EAE0', alignItems:'center', gap:'8px', background:i%2===0?'#fff':'#FDFAF6' }}>
                <span style={{ fontSize:'11px', color:'#6B5E3E', fontFamily:'monospace' }}>{a.date}</span>
                <span style={{ fontSize:'12px', color:'#1A1A2E', fontWeight:600 }}>{a.admin}</span>
                <span style={{ fontSize:'12px', color:'#1A1A2E' }}>{a.action}</span>
              </div>
            ))}
            <div style={{ padding:'8px 16px', background:'#FFFBEB', borderTop:'1px solid #FDE68A', fontSize:'10px', color:'#92400E', fontWeight:600 }}>
              ⚠ Full audit logs — Audit module se aayenge (Phase 14)
            </div>
          </BCard>
        )}

        {/* ══ LOCATION ══ */}
        {tab === 'location' && (
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'14px' }}>
            <BCard>
              <BCardHeader title="Location Details"/>
              <div style={{ padding:'14px' }}>
                <InfoRow label="Address"  value={salon.location?.address}/>
                <InfoRow label="Area"     value={salon.location?.area}/>
                <InfoRow label="City"     value={salon.location?.city}/>
                <InfoRow label="District" value={salon.location?.district}/>
                <InfoRow label="State"    value={salon.location?.state}/>
                <InfoRow label="Country"  value={salon.location?.country}/>
                <SectionLabel title="Coordinates"/>
                <InfoRow label="Latitude"  value={salon.location?.geo?.lat}/>
                <InfoRow label="Longitude" value={salon.location?.geo?.lng}/>
              </div>
            </BCard>
            <BCard>
              <BCardHeader title="Map Preview"/>
              <div style={{ padding:'16px' }}>
                <div style={{ background:'#F5F0E8', border:'1px solid #E8DFD0', height:'220px', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', borderTop:'2px solid #B8960C' }}>
                  <div style={{ fontSize:'32px', marginBottom:'12px' }}>📍</div>
                  <div style={{ fontSize:'13px', fontWeight:700, color:'#1A1A2E', marginBottom:'4px' }}>{v(salon.shopName)}</div>
                  <div style={{ fontSize:'11px', color:'#9E8E6E', textAlign:'center', maxWidth:'200px' }}>{v(salon.location?.address)}</div>
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

      </div>

      {/* Sticky Footer */}
      <div style={{ position:'sticky', bottom:0, background:'#0D1B2A', borderTop:'2px solid #B8960C', padding:'12px 20px', display:'flex', alignItems:'center', justifyContent:'space-between', zIndex:10 }}>
        <div style={{ flex:1, marginRight:'16px' }}>
          <input value={reason} onChange={e => setReason(e.target.value)}
            placeholder="Rejection reason (required if rejecting)..."
            style={{ width:'100%', background:'rgba(255,255,255,0.07)', border:'1px solid rgba(184,150,12,0.3)', color:'rgba(255,255,255,0.7)', padding:'8px 12px', fontSize:'12px', fontFamily:FONTS.body, outline:'none', boxSizing:'border-box' }}
          />
        </div>
        <div style={{ display:'flex', gap:'8px', flexShrink:0 }}>
          <button onClick={() => navigate('/app/approvals')} style={{ background:'rgba(255,255,255,0.07)', border:'1px solid rgba(255,255,255,0.15)', color:'rgba(255,255,255,0.5)', padding:'8px 16px', fontSize:'11px', fontWeight:700, cursor:'pointer' }}>CANCEL</button>
          {/* REJECT — sirf tab jab APPROVED ho */}
          {approvalStatus !== 'REJECTED' && (
            <button onClick={() => setConfirm('REJECT')} disabled={processing}
              style={{ background:'#7F1D1D', border:'1px solid #DC2626', color:'#FCA5A5', padding:'8px 16px', fontSize:'11px', fontWeight:800, cursor:'pointer' }}>✕ REJECT</button>
          )}
          {/* RECOMMEND — sirf DISTRICT + PENDING */}
          {canRecommend && approvalStatus === 'PENDING' && (
            <button onClick={() => setConfirm('RECOMMEND')} disabled={processing}
              style={{ background:'#064E3B', border:'1px solid #059669', color:'#6EE7B7', padding:'8px 16px', fontSize:'11px', fontWeight:800, cursor:'pointer' }}>↑ RECOMMEND</button>
          )}
          {/* APPROVE — sirf tab jab APPROVED nahi ho */}
          {canApprove && approvalStatus !== 'APPROVED' && (
            <button onClick={() => setConfirm('APPROVE')} disabled={processing}
              style={{ background:'#B8960C', border:'none', color:'#0D1B2A', padding:'8px 20px', fontSize:'11px', fontWeight:800, cursor:processing?'not-allowed':'pointer', opacity:processing?0.7:1 }}>
              {processing ? 'PROCESSING...' : '✓ APPROVE'}
            </button>
          )}
        </div>
      </div>

      {confirm && (
        <ConfirmModal
          action={confirm}
          salonName={salon.shopName}
          reason={reason}
          onCancel={() => setConfirm(null)}
          onConfirm={handleConfirm}
        />
      )}
    </div>
  )
}