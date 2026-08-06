import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { canAssignDispute, canResolveDispute } from '../../config/adminRoles'
import { FONTS } from '../../config/brand'
import useAuthStore from '../../store/authStore'

// NOTE: see DisputesPage.jsx for why the previous local ADMIN_LEVELS
// scheme (SUPER_ADMIN/INDIA_ADMIN/STATE_ADMIN/DISTRICT_ADMIN) was
// wrong — it never matched real admin.adminLevel values (INDIA/
// STATE/DISTRICT), so every permission check here silently evaluated
// false/true incorrectly for every real admin.
const canResolve = canResolveDispute
const canAssign  = canAssignDispute

// BACKEND GAP: no /admin/disputes endpoint exists anywhere in the backend
// (confirmed — no model, route, or controller). There is no real dispute
// record to look up, so every id resolves to the NotFound state below
// rather than a fabricated record.
const DISPUTES_DB = {}

const STATUS_COLORS = {
  OPEN:      { bg:'#FEF2F2', color:'#991B1B' },
  IN_REVIEW: { bg:'#FEF9C3', color:'#92400E' },
  RESOLVED:  { bg:'#D1FAE5', color:'#065F46' },
  CLOSED:    { bg:'#F3F4F6', color:'#374151' },
}
const PRIORITY_COLORS = {
  CRITICAL: { bg:'#FEE2E2', color:'#991B1B', border:'#DC2626' },
  HIGH:     { bg:'#FEF2F2', color:'#B91C1C', border:'#EF4444' },
  MEDIUM:   { bg:'#FFFBEB', color:'#92400E', border:'#D97706' },
  LOW:      { bg:'#F0FDF4', color:'#065F46', border:'#059669' },
}
const TYPE_LABELS = {
  NO_SHOW:'No Show', REFUND_DELAY:'Refund Delay',
  SERVICE_QUALITY:'Service Quality', FRAUD:'Fraud', OVERCHARGE:'Overcharge',
}

function ResolveModal({ dispute, onConfirm, onCancel }) {
  const [resolution, setResolution] = useState('')
  const [action, setAction] = useState('RESOLVED')
  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.75)', zIndex:2000, display:'flex', alignItems:'center', justifyContent:'center' }}>
      <div style={{ background:'#fff', width:'480px', border:'2px solid #059669' }}>
        <div style={{ background:'#064E3B', padding:'14px 18px', borderBottom:'2px solid #059669' }}>
          <div style={{ color:'#fff', fontWeight:800, fontSize:'13px', letterSpacing:'1px' }}>✓ RESOLVE DISPUTE</div>
          <div style={{ color:'rgba(255,255,255,0.6)', fontSize:'10px', marginTop:'2px' }}>{dispute.id} — {dispute.customer.name}</div>
        </div>
        <div style={{ padding:'20px 18px' }}>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'8px', marginBottom:'14px' }}>
            {[{val:'RESOLVED',label:'✓ Mark Resolved',color:'#059669'},{val:'CLOSED',label:'✗ Close',color:'#374151'}].map(a=>(
              <button key={a.val} onClick={()=>setAction(a.val)}
                style={{ padding:'10px', border:`2px solid ${action===a.val?a.color:'#E8DFD0'}`, background:action===a.val?`${a.color}15`:'#fff', color:action===a.val?a.color:'#9E8E6E', fontSize:'11px', fontWeight:700, cursor:'pointer' }}>
                {a.label}
              </button>
            ))}
          </div>
          <label style={{ fontSize:'10px', color:'#9E8E6E', fontWeight:800, letterSpacing:'1px', display:'block', marginBottom:'6px' }}>RESOLUTION NOTES (REQUIRED)</label>
          <textarea value={resolution} onChange={e=>setResolution(e.target.value)} placeholder="Describe resolution..."
            style={{ width:'100%', border:'1px solid #D4C9B0', padding:'8px 12px', fontSize:'13px', fontFamily:FONTS.body, outline:'none', minHeight:'80px', resize:'vertical', boxSizing:'border-box', marginBottom:'14px' }}/>
          <div style={{ display:'flex', gap:'8px', justifyContent:'flex-end' }}>
            <button onClick={onCancel} style={{ background:'#fff', border:'1px solid #D4C9B0', color:'#6B5E3E', padding:'8px 16px', fontSize:'11px', fontWeight:700, cursor:'pointer' }}>CANCEL</button>
            <button onClick={()=>resolution.trim()&&onConfirm(action,resolution)}
              style={{ background:resolution.trim()?'#059669':'#F5F0E8', border:'none', color:resolution.trim()?'#fff':'#C4B49A', padding:'8px 20px', fontSize:'11px', fontWeight:800, cursor:resolution.trim()?'pointer':'not-allowed' }}>
              ✓ CONFIRM
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
    <span style={{ fontSize:'12px', fontWeight:600, color:valueColor||'#1A1A2E', textAlign:'right', maxWidth:'65%' }}>{value}</span>
  </div>
)

const NotFound = ({onBack}) => (
  <div style={{ fontFamily:FONTS.body, background:'#F0EAE0', minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center' }}>
    <div style={{ background:'#fff', border:'2px solid #D4C9B0', borderTop:'2px solid #B8960C', padding:'40px', textAlign:'center', maxWidth:'400px' }}>
      <div style={{ fontSize:'40px', marginBottom:'16px' }}>🔍</div>
      <div style={{ fontSize:'16px', fontWeight:800, color:'#1A1A2E', marginBottom:'8px' }}>Dispute Not Found</div>
      <div style={{ fontSize:'12px', color:'#9E8E6E', marginBottom:'16px' }}>BACKEND GAP — Disputes has no backend implementation yet, so no dispute record can be loaded.</div>
      <button onClick={onBack} style={{ background:'#0D1B2A', color:'#B8960C', border:'none', padding:'8px 20px', fontSize:'12px', fontWeight:700, cursor:'pointer' }}>← GO BACK</button>
    </div>
  </div>
)

export default function DisputeDetailPage() {
  const { id }     = useParams()
  const navigate   = useNavigate()
  const admin      = useAuthStore(s=>s.admin)
  const adminLevel = admin?.adminLevel||'INDIA'
  const hasResolve = canResolve(adminLevel)
  const hasAssign  = canAssign(adminLevel)

  const rawDispute = DISPUTES_DB[id]

  const [tab,          setTab]          = useState('overview')
  const [toast,        setToast]        = useState(null)
  const [resolveModal, setResolveModal] = useState(false)
  // No real backend to persist to (see handleAssign/handleResolve
  // below) — kept as state, not a plain const, so this can be swapped
  // for a real fetched+updated record the moment a real endpoint
  // exists, without restructuring this component again.
  const [dispute]      = useState(rawDispute)

  // Both early returns moved after all hooks above — they previously sat
  // before the useState calls, a latent rules-of-hooks violation that
  // ESLint now flags directly.
  if (!dispute) return <NotFound onBack={()=>navigate('/app/disputes')}/>
  if (adminLevel==='DISTRICT') return (
    <div style={{ fontFamily:FONTS.body, background:'#F0EAE0', minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center' }}>
      <div style={{ background:'#fff', border:'2px solid #DC2626', padding:'40px', textAlign:'center', maxWidth:'400px' }}>
        <div style={{ fontSize:'40px', marginBottom:'16px' }}>🔒</div>
        <div style={{ fontSize:'16px', fontWeight:800, color:'#1A1A2E', marginBottom:'8px' }}>Access Denied</div>
        <button onClick={()=>navigate(-1)} style={{ background:'#0D1B2A', color:'#B8960C', border:'none', padding:'8px 20px', fontSize:'12px', fontWeight:700, cursor:'pointer', marginTop:'8px' }}>← GO BACK</button>
      </div>
    </div>
  )

  const showToast = (msg,color) => { setToast({msg,color}); setTimeout(()=>setToast(null),3000) }

  const isOwnScope = () => {
    if (adminLevel!=='STATE') return true
    if (!admin?.stateRef) return false
    return dispute.state===admin.stateRef
  }

  // BACKEND GAP: no /admin/disputes endpoint exists anywhere in the
  // backend. These actions used to silently mutate local React state
  // (including fabricating an audit-log entry) and show a fake
  // success toast — misleading, since nothing was actually recorded
  // anywhere. Report honestly instead.
  const handleAssign = () => {
    if (!isOwnScope()) { showToast('⊘ Not your state', '#DC2626'); return }
    showToast('⚠ Not available yet — no backend endpoint exists for disputes', '#DC2626')
  }

  const handleResolve = () => {
    if (!isOwnScope()) { showToast('⊘ Not your state', '#DC2626'); setResolveModal(false); return }
    showToast('⚠ Not available yet — no backend endpoint exists for disputes', '#DC2626')
    setResolveModal(false)
  }

  const sc = STATUS_COLORS[dispute.status]||STATUS_COLORS.OPEN
  const pc = PRIORITY_COLORS[dispute.priority]||PRIORITY_COLORS.LOW
  const TABS = ['overview','details','timeline','audit']

  return (
    <div style={{ fontFamily:FONTS.body, background:'#F0EAE0', minHeight:'100vh' }}>
      {toast && <div style={{ position:'fixed', top:'20px', right:'20px', background:toast.color, color:'#fff', padding:'12px 20px', fontSize:'13px', fontWeight:700, zIndex:9999, boxShadow:'0 4px 12px rgba(0,0,0,0.2)' }}>{toast.msg}</div>}

      {/* Header */}
      <div style={{ background:'#0D1B2A', borderBottom:'2px solid #B8960C', padding:'0 20px', height:'52px', display:'flex', alignItems:'center', justifyContent:'space-between', position:'sticky', top:0, zIndex:10 }}>
        <div style={{ display:'flex', alignItems:'center', gap:'12px' }}>
          <button onClick={()=>navigate('/app/disputes')} style={{ background:'rgba(255,255,255,0.07)', border:'1px solid rgba(255,255,255,0.1)', color:'rgba(255,255,255,0.6)', padding:'5px 10px', cursor:'pointer', fontSize:'12px', fontWeight:700 }}>← BACK</button>
          <div style={{ width:'3px', height:'16px', background:'#B8960C' }}/>
          <div>
            <div style={{ color:'#fff', fontWeight:800, fontSize:'13px', letterSpacing:'1px' }}>{dispute.id} — {TYPE_LABELS[dispute.type]}</div>
            <div style={{ color:'#B8960C', fontSize:'9px', letterSpacing:'1px', marginTop:'1px' }}>{dispute.customer.name} • {dispute.salon.name} • {dispute.raisedAt}</div>
          </div>
          <span style={{ fontSize:'10px', fontWeight:800, background:sc.bg, color:sc.color, padding:'3px 8px' }}>{dispute.status.replace('_',' ')}</span>
          <span style={{ fontSize:'10px', fontWeight:800, background:pc.bg, color:pc.color, border:`1px solid ${pc.border}`, padding:'3px 8px' }}>{dispute.priority}</span>
        </div>
        <div style={{ display:'flex', gap:'8px' }}>
          <button onClick={()=>navigate(`/app/bookings/${dispute.bookingId}`)} style={{ background:'rgba(184,150,12,0.15)', border:'1px solid rgba(184,150,12,0.4)', color:'#B8960C', padding:'6px 12px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>VIEW BOOKING</button>
          {dispute.status==='OPEN' && hasAssign && (
            <button onClick={handleAssign} style={{ background:'rgba(37,99,235,0.2)', border:'1px solid rgba(37,99,235,0.5)', color:'#93C5FD', padding:'6px 12px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>ASSIGN TO ME</button>
          )}
          {(dispute.status==='OPEN'||dispute.status==='IN_REVIEW') && hasResolve && (
            <button onClick={()=>setResolveModal(true)} style={{ background:'rgba(5,150,105,0.2)', border:'1px solid rgba(5,150,105,0.5)', color:'#6EE7B7', padding:'6px 12px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>✓ RESOLVE</button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div style={{ background:'#0A1520', borderBottom:'1px solid rgba(184,150,12,0.2)', display:'flex', padding:'0 20px' }}>
        {TABS.map(t=>(
          <button key={t} onClick={()=>setTab(t)} style={{ padding:'10px 18px', border:'none', background:'none', cursor:'pointer', fontSize:'10px', fontWeight:tab===t?800:400, color:tab===t?'#B8960C':'rgba(255,255,255,0.35)', borderBottom:tab===t?'2px solid #B8960C':'2px solid transparent', letterSpacing:'1.5px', textTransform:'uppercase' }}>
            {t}
          </button>
        ))}
      </div>

      {/* KPI Strip */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:'1px', background:'#D4C9B0', borderBottom:'2px solid #B8960C' }}>
        {[
          { label:'Dispute ID',    value:dispute.id,                     color:'#B8960C' },
          { label:'Type',          value:TYPE_LABELS[dispute.type],      color:'#7C3AED' },
          { label:'Amount',        value:`₹${dispute.booking.amount}`,   color:'#DC2626' },
          { label:'Raised By',     value:dispute.raisedBy,               color:'#2563EB' },
          { label:'Assigned To',   value:dispute.assignedTo||'Unassigned',color:dispute.assignedTo?'#059669':'#D97706' },
        ].map(k=>(
          <div key={k.label} style={{ background:'#0D1B2A', padding:'10px 16px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
            <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.4)' }}>{k.label}</span>
            <span style={{ fontSize:'13px', fontWeight:800, color:k.color }}>{k.value}</span>
          </div>
        ))}
      </div>

      {dispute.status==='RESOLVED' && (
        <div style={{ background:'#F0FDF4', borderBottom:'2px solid #059669', padding:'10px 20px' }}>
          <span style={{ fontSize:'12px', color:'#065F46', fontWeight:700 }}>✓ RESOLVED — {dispute.resolution}</span>
        </div>
      )}

      <div style={{ padding:'16px 20px' }}>

        {/* OVERVIEW */}
        {tab==='overview' && (
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:'14px' }}>
            <BCard>
              <BCardHeader title="Dispute Info"/>
              <div style={{ padding:'14px' }}>
                <InfoRow label="Dispute ID"  value={dispute.id}/>
                <InfoRow label="Type"        value={TYPE_LABELS[dispute.type]} valueColor="#7C3AED"/>
                <InfoRow label="Priority"    value={dispute.priority}          valueColor={pc.color}/>
                <InfoRow label="Status"      value={dispute.status.replace('_',' ')} valueColor={sc.color}/>
                <InfoRow label="Raised By"   value={dispute.raisedBy}/>
                <InfoRow label="Raised At"   value={dispute.raisedAt}/>
                <InfoRow label="Assigned To" value={dispute.assignedTo||'Unassigned'} valueColor={dispute.assignedTo?'#059669':'#D97706'}/>
                <div style={{ marginTop:'12px', padding:'10px', background:'#F5F0E8', border:'1px solid #E8DFD0', borderLeft:'3px solid #B8960C', fontSize:'12px', color:'#6B5E3E' }}>
                  {dispute.description}
                </div>
              </div>
            </BCard>

            <BCard>
              <BCardHeader title="Customer & Salon"/>
              <div style={{ padding:'14px' }}>
                <div style={{ fontSize:'10px', fontWeight:800, color:'#9E8E6E', letterSpacing:'1px', marginBottom:'8px' }}>CUSTOMER</div>
                <InfoRow label="Name"           value={dispute.customer.name}/>
                <InfoRow label="Phone"          value={dispute.customer.phone}/>
                <InfoRow label="Total Bookings" value={dispute.customer.totalBookings}/>
                <div style={{ height:'1px', background:'#E8DFD0', margin:'12px 0' }}/>
                <div style={{ fontSize:'10px', fontWeight:800, color:'#9E8E6E', letterSpacing:'1px', marginBottom:'8px' }}>SALON</div>
                <InfoRow label="Salon Name" value={dispute.salon.name}/>
                <InfoRow label="Phone"      value={dispute.salon.phone}/>
                <InfoRow label="District"   value={dispute.salon.district}/>
                <InfoRow label="State"      value={dispute.salon.state}/>
              </div>
            </BCard>

            <BCard>
              <BCardHeader title="Booking & Payment"/>
              <div style={{ padding:'14px' }}>
                <div style={{ background:'#0D1B2A', padding:'14px', marginBottom:'14px', textAlign:'center', borderTop:'2px solid #B8960C' }}>
                  <div style={{ fontSize:'10px', color:'rgba(255,255,255,0.4)', letterSpacing:'1px', marginBottom:'4px' }}>DISPUTED AMOUNT</div>
                  <div style={{ fontSize:'28px', fontWeight:800, color:'#B8960C' }}>₹{dispute.booking.amount}</div>
                </div>
                <InfoRow label="Booking ID"    value={dispute.bookingId}/>
                <InfoRow label="Service"       value={dispute.booking.service}/>
                <InfoRow label="Date"          value={`${dispute.booking.date} ${dispute.booking.time}`}/>
                <InfoRow label="Payment Mode"  value={dispute.booking.paymentMode}/>
                <InfoRow label="TXN ID"        value={dispute.payment.txnId}/>
                <InfoRow label="Payment Status"value={dispute.payment.status}
                  valueColor={dispute.payment.status==='SETTLED'?'#059669':dispute.payment.status==='REFUNDED'?'#7C3AED':'#DC2626'}/>
              </div>
            </BCard>
          </div>
        )}

        {/* DETAILS — Evidence */}
        {tab==='details' && (
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'14px' }}>
            <BCard>
              <BCardHeader title="Evidence Submitted"/>
              <div style={{ padding:'14px' }}>
                {dispute.evidence.map((e,i)=>(
                  <div key={i} style={{ display:'flex', gap:'10px', padding:'10px 0', borderBottom:'1px solid #F0EAE0' }}>
                    <div style={{ width:'20px', height:'20px', background:'#2563EB', display:'flex', alignItems:'center', justifyContent:'center', color:'#fff', fontSize:'10px', fontWeight:800, flexShrink:0 }}>{i+1}</div>
                    <span style={{ fontSize:'12px', color:'#1A1A2E' }}>{e}</span>
                  </div>
                ))}
                <div style={{ marginTop:'12px', padding:'10px', background:'#FFFBEB', border:'1px solid #FDE68A', fontSize:'11px', color:'#92400E', fontWeight:600 }}>
                  ℹ Actual files/screenshots available in backend storage. Admin to review before resolving.
                </div>
              </div>
            </BCard>

            <BCard>
              <BCardHeader title="Resolution Actions"/>
              <div style={{ padding:'14px' }}>
                {dispute.status==='RESOLVED' ? (
                  <div style={{ background:'#F0FDF4', border:'1px solid #D1FAE5', padding:'14px', borderLeft:'3px solid #059669' }}>
                    <div style={{ fontSize:'11px', fontWeight:800, color:'#065F46', marginBottom:'6px' }}>✓ RESOLVED</div>
                    <div style={{ fontSize:'12px', color:'#1A1A2E' }}>{dispute.resolution}</div>
                    <div style={{ fontSize:'10px', color:'#9E8E6E', marginTop:'6px' }}>By {dispute.assignedTo} on {dispute.resolvedAt}</div>
                  </div>
                ) : (
                  <>
                    {[
                      { label:'Issue Refund',    desc:'Process full/partial refund to customer',color:'#7C3AED' },
                      { label:'Warn Provider',   desc:'Send warning notice to salon/provider',  color:'#D97706' },
                      { label:'Suspend Salon',   desc:'Suspend salon pending investigation',    color:'#DC2626' },
                      { label:'Close as Invalid',desc:'Close dispute — complaint not valid',    color:'#374151' },
                    ].map(a=>(
                      <div key={a.label} style={{ padding:'10px', background:'#F5F0E8', border:`1px solid ${a.color}30`, borderLeft:`3px solid ${a.color}`, marginBottom:'8px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                        <div>
                          <div style={{ fontSize:'11px', fontWeight:700, color:a.color }}>{a.label}</div>
                          <div style={{ fontSize:'10px', color:'#9E8E6E', marginTop:'2px' }}>{a.desc}</div>
                        </div>
                      </div>
                    ))}
                    {hasResolve && (
                      <button onClick={()=>setResolveModal(true)} style={{ width:'100%', marginTop:'8px', background:'#059669', color:'#fff', border:'none', padding:'10px', fontSize:'12px', fontWeight:800, cursor:'pointer' }}>✓ RESOLVE DISPUTE</button>
                    )}
                  </>
                )}
              </div>
            </BCard>
          </div>
        )}

        {/* TIMELINE */}
        {tab==='timeline' && (
          <BCard>
            <BCardHeader title="Dispute Timeline"/>
            <div style={{ padding:'24px 20px' }}>
              <div style={{ position:'relative', paddingLeft:'32px' }}>
                <div style={{ position:'absolute', left:'12px', top:'10px', bottom:'10px', width:'2px', background:'#E8DFD0' }}/>
                {dispute.timeline.map((t,i)=>(
                  <div key={i} style={{ position:'relative', marginBottom:'20px' }}>
                    <div style={{ position:'absolute', left:'-23px', top:'2px', width:'20px', height:'20px', background:t.done?t.color:'#E8DFD0', border:`2px solid ${t.done?t.color:'#D4C9B0'}`, display:'flex', alignItems:'center', justifyContent:'center' }}>
                      {t.done && <span style={{ color:'#fff', fontSize:'10px', fontWeight:800 }}>✓</span>}
                    </div>
                    <div style={{ background:t.done?'#FDFAF6':'#F5F0E8', border:`1px solid ${t.done?'#D4C9B0':'#E8DFD0'}`, borderLeft:`3px solid ${t.done?t.color:'#D4C9B0'}`, padding:'10px 14px' }}>
                      <div style={{ display:'flex', justifyContent:'space-between' }}>
                        <span style={{ fontSize:'13px', fontWeight:700, color:t.done?'#1A1A2E':'#9E8E6E' }}>{t.event}</span>
                        <div style={{ textAlign:'right' }}>
                          <span style={{ fontSize:'10px', color:t.done?t.color:'#C4B49A', fontWeight:600 }}>{t.time}</span>
                          <div style={{ fontSize:'10px', color:'#9E8E6E' }}>By: {t.by}</div>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </BCard>
        )}

        {/* AUDIT */}
        {tab==='audit' && (
          <BCard>
            <BCardHeader title="Audit Log — Immutable" action={
              <span style={{ fontSize:'10px', color:'#DC2626', fontWeight:700 }}>⚠ CANNOT BE DELETED</span>
            }/>
            <div style={{ display:'grid', gridTemplateColumns:'1.5fr 2.5fr 1fr', padding:'8px 14px', background:'#F5F0E8', borderBottom:'1px solid #E8DFD0', gap:'8px' }}>
              {['DATE & TIME','ACTION','BY'].map(h=>(
                <span key={h} style={{ fontSize:'9px', fontWeight:800, color:'#9E8E6E', letterSpacing:'1px' }}>{h}</span>
              ))}
            </div>
            {dispute.audit.map((a,i)=>(
              <div key={i} style={{ display:'grid', gridTemplateColumns:'1.5fr 2.5fr 1fr', padding:'11px 14px', borderBottom:'1px solid #F0EAE0', alignItems:'center', gap:'8px', background:i%2===0?'#fff':'#FDFAF6' }}>
                <span style={{ fontSize:'11px', color:'#6B5E3E', fontFamily:'monospace' }}>{a.date}</span>
                <span style={{ fontSize:'12px', color:'#1A1A2E' }}>{a.action}</span>
                <span style={{ fontSize:'11px', color:'#B8960C', fontWeight:600 }}>{a.by}</span>
              </div>
            ))}
            <div style={{ padding:'8px 14px', background:'#FFFBEB', borderTop:'1px solid #FDE68A', fontSize:'10px', color:'#92400E', fontWeight:600 }}>
              ⚠ Audit logs are immutable. No records can be modified or deleted.
            </div>
          </BCard>
        )}
      </div>

      <div style={{ background:'#0D1B2A', borderTop:'2px solid #B8960C', padding:'10px 20px', display:'flex', justifyContent:'space-between', marginTop:'14px' }}>
        <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.3)' }}>ZEMISH DISPUTE DETAIL v1.0.0</span>
        <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.3)' }}>NATIONAL COMMAND CENTER</span>
      </div>

      {resolveModal && <ResolveModal dispute={dispute} onConfirm={handleResolve} onCancel={()=>setResolveModal(false)}/>}
    </div>
  )
}