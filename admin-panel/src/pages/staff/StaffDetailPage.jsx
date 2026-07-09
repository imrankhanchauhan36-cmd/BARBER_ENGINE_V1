import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { FONTS } from '../../config/brand'
import useAuthStore from '../../store/authStore'
import StaffAPI from './api/staff.api'

// ─── Helpers ─────────────────────────────────────────────
const v   = (val, fb = '—') => (val !== null && val !== undefined && val !== '') ? val : fb
const cap = (s) => s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : '—'
const dt  = (d) => d ? new Date(d).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' }) : '—'
const dtm = (d) => d ? new Date(d).toLocaleString('en-IN') : '—'

// ─── Constants ────────────────────────────────────────────
const ROLE_COLORS = {
  BARBER:  { bg:'#EFF6FF', color:'#1D4ED8' },
  HELPER:  { bg:'#ECFDF5', color:'#065F46' },
  MANAGER: { bg:'#F5F3FF', color:'#6D28D9' },
}

const canManage = (l) => ['INDIA', 'STATE'].includes(l)

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
function StatusModal({ staff, onConfirm, onCancel, processing }) {
  const [reason, setReason] = useState('')
  const deactivating = staff.isActive
  const canProceed   = !deactivating || reason.trim().length > 0

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.75)', zIndex:2000, display:'flex', alignItems:'center', justifyContent:'center' }}>
      <div style={{ background:'#fff', width:'440px', border:`2px solid ${deactivating?'#DC2626':'#059669'}` }}>
        <div style={{ background:deactivating?'#7F1D1D':'#064E3B', padding:'14px 18px', borderBottom:`2px solid ${deactivating?'#DC2626':'#059669'}` }}>
          <div style={{ color:'#fff', fontWeight:800, fontSize:'13px', letterSpacing:'1px' }}>{deactivating?'DEACTIVATE STAFF':'ACTIVATE STAFF'}</div>
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
            placeholder={deactivating?'Reason for deactivation...':'Why activating...'}
            style={{ width:'100%', border:'1px solid #D4C9B0', padding:'8px 12px', fontSize:'13px', fontFamily:FONTS.body, outline:'none', minHeight:'70px', resize:'vertical', boxSizing:'border-box', marginBottom:'14px' }}
          />
          <div style={{ display:'flex', gap:'8px', justifyContent:'flex-end' }}>
            <button onClick={onCancel} style={{ background:'#fff', border:'1px solid #D4C9B0', color:'#6B5E3E', padding:'8px 16px', fontSize:'11px', fontWeight:700, cursor:'pointer' }}>CANCEL</button>
            <button onClick={() => canProceed && onConfirm(!deactivating, reason)} disabled={processing}
              style={{ background:canProceed?(deactivating?'#DC2626':'#059669'):'#F5F0E8', border:'none', color:canProceed?'#fff':'#C4B49A', padding:'8px 20px', fontSize:'11px', fontWeight:800, cursor:canProceed?'pointer':'not-allowed', opacity:processing?0.7:1 }}>
              {processing?'PROCESSING...':deactivating?'⊘ DEACTIVATE':'✓ ACTIVATE'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────
export default function StaffDetailPage() {
  const { id }     = useParams()
  const navigate   = useNavigate()
  const admin      = useAuthStore(s => s.admin)
  const adminLevel = admin?.adminLevel || 'INDIA'
  const hasManage  = canManage(adminLevel)

  const [staff,      setStaff]      = useState(null)
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

  const fetchStaff = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await StaffAPI.getById(id)
      setStaff(res.data)
    } catch (err) {
      setError(err.message || 'Failed to load')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchStaff() }, [id])

  const handleStatusConfirm = async (isActive, reason) => {
    setProcessing(true)
    try {
      await StaffAPI.updateStatus(id, { isActive, reason: reason?.trim() || undefined })
      showToast(isActive ? `✓ ${cap(staff.name)} activated` : `⊘ ${cap(staff.name)} deactivated`, isActive?'#059669':'#DC2626')
      setModal(false)
      fetchStaff()
    } catch (err) {
      showToast(`⚠ ${err.message}`, '#DC2626')
    } finally {
      setProcessing(false)
    }
  }

  if (loading) return (
    <div style={{ minHeight:'100vh', background:'#F0EAE0', display:'flex', alignItems:'center', justifyContent:'center', fontFamily:FONTS.body, color:'#9E8E6E' }}>
      Loading staff...
    </div>
  )
  if (error) return (
    <div style={{ minHeight:'100vh', background:'#F0EAE0', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', fontFamily:FONTS.body, gap:'12px' }}>
      <div style={{ color:'#DC2626' }}>⚠ {error}</div>
      <button onClick={fetchStaff} style={{ background:'#1A1A2E', color:'#fff', border:'none', padding:'8px 20px', cursor:'pointer', fontWeight:700 }}>RETRY</button>
    </div>
  )
  if (!staff) return (
    <div style={{ minHeight:'100vh', background:'#F0EAE0', display:'flex', alignItems:'center', justifyContent:'center', fontFamily:FONTS.body }}>
      <div style={{ background:'#fff', border:'2px solid #D4C9B0', borderTop:'2px solid #B8960C', padding:'40px', textAlign:'center' }}>
        <div style={{ fontSize:'40px', marginBottom:'16px' }}>🔍</div>
        <div style={{ fontSize:'16px', fontWeight:800, color:'#1A1A2E', marginBottom:'8px' }}>Staff Not Found</div>
        <button onClick={() => navigate('/app/staff')} style={{ background:'#0D1B2A', color:'#B8960C', border:'none', padding:'8px 20px', fontSize:'12px', fontWeight:700, cursor:'pointer' }}>← GO BACK</button>
      </div>
    </div>
  )

  const rc   = ROLE_COLORS[staff.role] || ROLE_COLORS.BARBER
  const TABS = ['overview', 'skills', 'history', 'transfers', 'performance']

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
          <button onClick={() => navigate('/app/staff')} style={{ background:'rgba(255,255,255,0.07)', border:'1px solid rgba(255,255,255,0.1)', color:'rgba(255,255,255,0.6)', padding:'5px 10px', cursor:'pointer', fontSize:'12px', fontWeight:700 }}>← BACK</button>
          <div style={{ width:'3px', height:'16px', background:'#B8960C' }}/>
          <div>
            <div style={{ color:'#fff', fontWeight:800, fontSize:'13px', letterSpacing:'1px' }}>{cap(v(staff.name))}</div>
            <div style={{ color:'#B8960C', fontSize:'9px', letterSpacing:'1px', marginTop:'1px' }}>
              {v(staff.salon?.shopName)} • {v(staff.salon?.district?.name)} • {v(staff.salon?.state?.name)}
            </div>
          </div>
          <span style={{ fontSize:'10px', fontWeight:800, background:rc.bg, color:rc.color, padding:'3px 8px' }}>{v(staff.role)}</span>
          <span style={{ fontSize:'10px', fontWeight:800, background:staff.isActive?'#D1FAE5':'#FEE2E2', color:staff.isActive?'#065F46':'#991B1B', padding:'3px 8px' }}>
            {staff.isActive ? 'ACTIVE' : 'INACTIVE'}
          </span>
          {staff.isOwner && <span style={{ fontSize:'10px', fontWeight:800, background:'rgba(184,150,12,0.2)', color:'#B8960C', padding:'3px 8px', border:'1px solid rgba(184,150,12,0.3)' }}>★ OWNER OPERATOR</span>}
        </div>
        <div style={{ display:'flex', gap:'8px' }}>
          <button onClick={fetchStaff} style={{ background:'rgba(255,255,255,0.07)', border:'1px solid rgba(255,255,255,0.15)', color:'rgba(255,255,255,0.5)', padding:'5px 10px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>↻</button>
          {hasManage && (
            <button onClick={() => setModal(true)}
              style={{ background:staff.isActive?'rgba(220,38,38,0.2)':'rgba(5,150,105,0.2)', border:`1px solid ${staff.isActive?'rgba(220,38,38,0.5)':'rgba(5,150,105,0.5)'}`, color:staff.isActive?'#FCA5A5':'#6EE7B7', padding:'6px 12px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>
              {staff.isActive ? '⊘ DEACTIVATE' : '✓ ACTIVATE'}
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div style={{ background:'#0A1520', borderBottom:'1px solid rgba(184,150,12,0.2)', display:'flex', padding:'0 20px', overflowX:'auto' }}>
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)} style={{ padding:'10px 16px', border:'none', background:'none', cursor:'pointer', fontSize:'10px', fontWeight:tab===t?800:400, color:tab===t?'#B8960C':'rgba(255,255,255,0.35)', borderBottom:tab===t?'2px solid #B8960C':'2px solid transparent', letterSpacing:'1.5px', textTransform:'uppercase', whiteSpace:'nowrap' }}>
            {t}
            {t==='skills' && <span style={{ marginLeft:'5px', background:'rgba(184,150,12,0.3)', color:'#B8960C', fontSize:'9px', padding:'1px 5px' }}>{staff.skills?.length ?? 0}</span>}
            {t==='history' && <span style={{ marginLeft:'5px', background:'rgba(220,38,38,0.3)', color:'#FCA5A5', fontSize:'9px', padding:'1px 5px' }}>{staff.statusHistory?.length ?? 0}</span>}
            {t==='transfers' && <span style={{ marginLeft:'5px', background:'rgba(124,58,237,0.3)', color:'#C4B5FD', fontSize:'9px', padding:'1px 5px' }}>{staff.transferHistory?.length ?? 0}</span>}
          </button>
        ))}
      </div>

      {/* KPI Strip */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:'1px', background:'#D4C9B0', borderBottom:'2px solid #B8960C' }}>
        {[
          { label:'Bookings Today', value: staff.totalBookingsToday ?? 0, color:'#B8960C' },
          { label:'Chair',          value: staff.chair?.name ?? '—',       color:'#7C3AED' },
          { label:'Skills',         value: staff.skills?.length ?? 0,      color:'#2563EB' },
          { label:'Status History', value: staff.statusHistory?.length ?? 0, color:'#D97706' },
        ].map(k => (
          <div key={k.label} style={{ background:'#0D1B2A', padding:'10px 16px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
            <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.4)' }}>{k.label}</span>
            <span style={{ fontSize:'14px', fontWeight:800, color:k.color }}>{k.value}</span>
          </div>
        ))}
      </div>

      <div style={{ padding:'16px 20px' }}>

        {/* ── OVERVIEW ── */}
        {tab === 'overview' && (
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:'14px' }}>
            <BCard>
              <BCardHeader title="Staff Profile"/>
              <div style={{ padding:'14px' }}>
                <div style={{ display:'flex', alignItems:'center', gap:'12px', padding:'12px', background:'#F5F0E8', border:'1px solid #E8DFD0', borderTop:'2px solid #B8960C', marginBottom:'14px' }}>
                  <div style={{ width:'44px', height:'44px', background:staff.isOwner?'#B8960C':'#0D1B2A', display:'flex', alignItems:'center', justifyContent:'center', color:staff.isOwner?'#0D1B2A':'#B8960C', fontSize:'18px', fontWeight:800, flexShrink:0 }}>
                    {(staff.name||'?')[0].toUpperCase()}
                  </div>
                  <div>
                    <div style={{ fontSize:'15px', fontWeight:800, color:'#1A1A2E' }}>{cap(v(staff.name))}</div>
                    <div style={{ fontSize:'10px', color:'#9E8E6E', marginTop:'2px' }}>Joined {dt(staff.createdAt)}</div>
                  </div>
                </div>
                <SLabel title="Contact"/>
                <InfoRow label="Phone" value={v(staff.phone)}/>
                <SLabel title="Role"/>
                <InfoRow label="Role"           value={v(staff.role)}/>
                <InfoRow label="Owner Operator" value={staff.isOwner ? '✓ Yes' : '✗ No'} valueColor={staff.isOwner?'#B8960C':'#9E8E6E'}/>
                <InfoRow label="Status"         value={staff.isActive ? 'Active' : 'Inactive'} valueColor={staff.isActive?'#059669':'#DC2626'}/>
                <SLabel title="Activity"/>
                <InfoRow label="Bookings Today" value={staff.totalBookingsToday ?? 0}/>
                <InfoRow label="Joined"         value={dt(staff.createdAt)}/>
                <InfoRow label="Last Updated"   value={dt(staff.updatedAt)}/>
              </div>
            </BCard>

            <BCard>
              <BCardHeader title="Salon & Chair"/>
              <div style={{ padding:'14px' }}>
                {staff.salon ? (
                  <>
                    <div style={{ background:'#0D1B2A', padding:'14px', marginBottom:'14px', borderTop:'2px solid #B8960C', cursor:'pointer' }}
                      onClick={() => navigate(`/app/salons/${staff.salon.id}`)}>
                      <div style={{ fontSize:'10px', color:'rgba(255,255,255,0.4)', letterSpacing:'1px', marginBottom:'4px' }}>ASSIGNED SALON</div>
                      <div style={{ fontSize:'14px', fontWeight:800, color:'#B8960C' }}>{v(staff.salon.shopName)}</div>
                      <div style={{ fontSize:'10px', color:'rgba(255,255,255,0.5)', marginTop:'4px' }}>{v(staff.salon.district?.name)} • {v(staff.salon.state?.name)}</div>
                    </div>
                    <SLabel title="Location"/>
                    <InfoRow label="State"    value={v(staff.salon.state?.name)}/>
                    <InfoRow label="District" value={v(staff.salon.district?.name)}/>
                  </>
                ) : (
                  <div style={{ padding:'20px', textAlign:'center', color:'#9E8E6E' }}>No salon assigned</div>
                )}
                <SLabel title="Chair"/>
                {staff.chair ? (
                  <InfoRow label="Chair" value={v(staff.chair.name)} valueColor="#7C3AED"/>
                ) : (
                  <div style={{ padding:'10px', background:'#FEF9C3', border:'1px solid #FDE68A', fontSize:'11px', color:'#92400E', fontWeight:600, marginTop:'8px' }}>
                    ⚠ No chair assigned
                  </div>
                )}
              </div>
            </BCard>

            <BCard>
              <BCardHeader title="Audit Info"/>
              <div style={{ padding:'14px' }}>
                <SLabel title="Created By"/>
                <InfoRow label="Name"       value={v(staff.createdBy?.name)}/>
                <InfoRow label="Admin Level"value={v(staff.createdBy?.adminLevel)}/>
                <InfoRow label="Date"       value={dt(staff.createdAt)}/>
                <SLabel title="Last Updated By"/>
                <InfoRow label="Name"       value={v(staff.updatedBy?.name)}/>
                <InfoRow label="Admin Level"value={v(staff.updatedBy?.adminLevel)}/>
                <InfoRow label="Date"       value={dt(staff.updatedAt)}/>
                <SLabel title="Future"/>
                <div style={{ padding:'10px', background:'#FFFBEB', border:'1px solid #FDE68A', fontSize:'10px', color:'#92400E', fontWeight:600, marginTop:'4px' }}>
                  ℹ Performance, Attendance, Schedule — Part 2
                </div>
              </div>
            </BCard>
          </div>
        )}

        {/* ── SKILLS ── */}
        {tab === 'skills' && (
          <BCard>
            <BCardHeader title={`Skills (${staff.skills?.length ?? 0})`}/>
            {!staff.skills?.length ? (
              <div style={{ padding:'40px', textAlign:'center', color:'#9E8E6E' }}>No skills assigned</div>
            ) : (
              <>
                <div style={{ display:'grid', gridTemplateColumns:'1.5fr 1fr 0.8fr', padding:'8px 14px', background:'#F5F0E8', borderBottom:'1px solid #E8DFD0', gap:'8px' }}>
                  {['SERVICE','PRICE','DURATION'].map(h => (
                    <span key={h} style={{ fontSize:'9px', fontWeight:800, color:'#9E8E6E', letterSpacing:'1px' }}>{h}</span>
                  ))}
                </div>
                {staff.skills.map((sk, i) => (
                  <div key={sk.id} style={{ display:'grid', gridTemplateColumns:'1.5fr 1fr 0.8fr', padding:'12px 14px', borderBottom:'1px solid #F0EAE0', alignItems:'center', gap:'8px', background:i%2===0?'#fff':'#FDFAF6' }}>
                    <span style={{ fontSize:'13px', fontWeight:700, color:'#1A1A2E' }}>{cap(v(sk.name))}</span>
                    <span style={{ fontSize:'13px', fontWeight:700, color:'#B8960C' }}>₹{sk.price ?? 0}</span>
                    <span style={{ fontSize:'12px', color:'#6B5E3E' }}>{sk.duration ?? 0} min</span>
                  </div>
                ))}
              </>
            )}
          </BCard>
        )}

        {/* ── HISTORY ── */}
        {tab === 'history' && (
          <BCard>
            <BCardHeader title="Status History — Immutable" action={
              <span style={{ fontSize:'10px', color:'#DC2626', fontWeight:700 }}>⚠ CANNOT BE DELETED</span>
            }/>
            {!staff.statusHistory?.length ? (
              <div style={{ padding:'40px', textAlign:'center', color:'#9E8E6E' }}>No status changes recorded</div>
            ) : (
              <>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 0.6fr 0.6fr 1fr 1.5fr 1fr', padding:'8px 14px', background:'#F5F0E8', borderBottom:'1px solid #E8DFD0', gap:'8px' }}>
                  {['DATE','PREV','CURRENT','CHANGED BY','REASON','LEVEL'].map(h => (
                    <span key={h} style={{ fontSize:'9px', fontWeight:800, color:'#9E8E6E', letterSpacing:'1px' }}>{h}</span>
                  ))}
                </div>
                {staff.statusHistory.map((h, i) => (
                  <div key={i} style={{ display:'grid', gridTemplateColumns:'1fr 0.6fr 0.6fr 1fr 1.5fr 1fr', padding:'11px 14px', borderBottom:'1px solid #F0EAE0', alignItems:'center', gap:'8px', background:i%2===0?'#fff':'#FDFAF6' }}>
                    <span style={{ fontSize:'10px', color:'#6B5E3E', fontFamily:'monospace' }}>{dtm(h.changedAt)}</span>
                    <span style={{ fontSize:'11px', fontWeight:700, color:h.previousStatus?'#059669':'#DC2626' }}>{h.previousStatus ? 'ACTIVE' : 'INACTIVE'}</span>
                    <span style={{ fontSize:'11px', fontWeight:700, color:h.currentStatus?'#059669':'#DC2626' }}>{h.currentStatus ? 'ACTIVE' : 'INACTIVE'}</span>
                    <span style={{ fontSize:'11px', color:'#1A1A2E' }}>{v(h.changedBy?.name)}</span>
                    <span style={{ fontSize:'11px', color:'#6B5E3E' }}>{v(h.reason)}</span>
                    <span style={{ fontSize:'10px', color:'#B8960C', fontWeight:600 }}>{v(h.adminLevel)}</span>
                  </div>
                ))}
              </>
            )}
          </BCard>
        )}

        {/* ── TRANSFERS ── */}
        {tab === 'transfers' && (
          <BCard>
            <BCardHeader title="Transfer History — Immutable" action={
              <span style={{ fontSize:'10px', color:'#7C3AED', fontWeight:700 }}>⚠ CANNOT BE DELETED</span>
            }/>
            {!staff.transferHistory?.length ? (
              <div style={{ padding:'40px', textAlign:'center', color:'#9E8E6E' }}>
                <div style={{ fontSize:'32px', marginBottom:'12px' }}>🚚</div>
                <div style={{ fontSize:'13px' }}>No transfers recorded</div>
              </div>
            ) : (
              <>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1.2fr 1.2fr 1fr 1.5fr 0.8fr', padding:'8px 14px', background:'#F5F0E8', borderBottom:'1px solid #E8DFD0', gap:'8px' }}>
                  {['DATE','FROM SALON','TO SALON','TRANSFERRED BY','REASON','LEVEL'].map(h => (
                    <span key={h} style={{ fontSize:'9px', fontWeight:800, color:'#9E8E6E', letterSpacing:'1px' }}>{h}</span>
                  ))}
                </div>
                {staff.transferHistory.map((t, i) => (
                  <div key={i} style={{ display:'grid', gridTemplateColumns:'1fr 1.2fr 1.2fr 1fr 1.5fr 0.8fr', padding:'11px 14px', borderBottom:'1px solid #F0EAE0', alignItems:'center', gap:'8px', background:i%2===0?'#fff':'#FDFAF6' }}>
                    <span style={{ fontSize:'10px', color:'#6B5E3E', fontFamily:'monospace' }}>{dtm(t.transferredAt)}</span>
                    <span style={{ fontSize:'11px', color:'#DC2626', fontWeight:600 }}>{v(t.fromSalonId?.shopName ?? t.fromSalonId)}</span>
                    <span style={{ fontSize:'11px', color:'#059669', fontWeight:600 }}>{v(t.toSalonId?.shopName ?? t.toSalonId)}</span>
                    <span style={{ fontSize:'11px', color:'#1A1A2E' }}>{v(t.transferredBy?.name ?? t.transferredBy)}</span>
                    <span style={{ fontSize:'11px', color:'#6B5E3E' }}>{v(t.reason)}</span>
                    <span style={{ fontSize:'10px', color:'#B8960C', fontWeight:600 }}>{v(t.adminLevel)}</span>
                  </div>
                ))}
              </>
            )}
          </BCard>
        )}

        {/* ── PERFORMANCE ── */}
        {tab === 'performance' && (
          <BCard>
            <BCardHeader title="Performance"/>
            <div style={{ padding:'40px', textAlign:'center', color:'#9E8E6E', fontSize:'13px' }}>
              Performance metrics — Phase 5A Part 2 mein aayenge
              <div style={{ marginTop:'8px', fontSize:'11px', color:'#C4B49A' }}>Booking history, ratings, utilization %</div>
            </div>
          </BCard>
        )}

      </div>

      <div style={{ background:'#0D1B2A', borderTop:'2px solid #B8960C', padding:'10px 20px', display:'flex', justifyContent:'space-between', marginTop:'14px' }}>
        <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.3)' }}>ZEMISH STAFF DETAIL v1.0.0</span>
        <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.3)' }}>NATIONAL COMMAND CENTER</span>
      </div>

      {modal && (
        <StatusModal
          staff={staff}
          onConfirm={handleStatusConfirm}
          onCancel={() => setModal(false)}
          processing={processing}
        />
      )}
    </div>
  )
}