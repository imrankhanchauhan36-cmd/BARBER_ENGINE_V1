import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { FONTS } from '../../config/brand'
import useAuthStore from '../../store/authStore'

const ADMIN_LEVELS = { SUPER_ADMIN:'SUPER_ADMIN', INDIA_ADMIN:'INDIA_ADMIN', STATE_ADMIN:'STATE_ADMIN', DISTRICT_ADMIN:'DISTRICT_ADMIN' }
const canBlock    = (l) => [ADMIN_LEVELS.SUPER_ADMIN, ADMIN_LEVELS.INDIA_ADMIN].includes(l)
const canViewPII  = (l) => [ADMIN_LEVELS.SUPER_ADMIN, ADMIN_LEVELS.INDIA_ADMIN].includes(l)

// ✅ Fix 4 — Safe PII masking + replaceAll
const maskPhone = (p='') => p&&p.length>=4 ? p.slice(0,2)+'******'+p.slice(-2) : '******'
const maskEmail = (e='') => { if(!e||!e.includes('@')) return '***@***'; const [u,d]=e.split('@'); return u.slice(0,2)+'***@'+d }
const fmtVerification = (v='') => v.replaceAll('_',' ')

const USERS_DB = {
  'USR001': {
    id:'USR001', name:'Rahul Verma', phone:'9812345678', email:'rahul.verma@gmail.com',
    state:'UP', district:'Hapur', city:'Hapur', pincode:'245101',
    status:'ACTIVE', verification:'KYC_VERIFIED', joinedAt:'2025-08-10',
    lastActive:'2 hrs ago', lastBooking:'2026-06-23',
    totalBookings:12, totalSpent:2840, avgSpent:237, cancelCount:1,
    blockedBy:null, blockedAt:null, blockReason:null,
    device:'Android', appVersion:'2.4.1', referredBy:'USR008',
    wallet:{ balance:250, totalCashback:420, totalRefunds:150, lastTransaction:'2026-06-23' },
    bookings:[
      { id:'BK001', salon:'Salman Salmani', service:'Haircut',       amount:150, date:'2026-06-23', status:'COMPLETED', rating:5    },
      { id:'BK005', salon:'Hair Masters',   service:'Facial',        amount:300, date:'2026-06-22', status:'COMPLETED', rating:4    },
      { id:'BK009', salon:'Fade & Blade',   service:'Beard Styling', amount:150, date:'2026-06-21', status:'REFUNDED',  rating:null },
      { id:'BK014', salon:'Smart Cuts',     service:'Haircut',       amount:180, date:'2026-06-15', status:'COMPLETED', rating:5    },
      { id:'BK020', salon:'Style Studio',   service:'Hair Color',    amount:500, date:'2026-06-10', status:'CANCELLED', rating:null },
    ],
    transactions:[
      { id:'TXN001', bookingId:'BK001', amount:150, gateway:'UPI',  date:'2026-06-23', status:'SETTLED'  },
      { id:'TXN005', bookingId:'BK005', amount:300, gateway:'UPI',  date:'2026-06-22', status:'SETTLED'  },
      { id:'TXN009', bookingId:'BK009', amount:150, gateway:'UPI',  date:'2026-06-21', status:'REFUNDED' },
      { id:'TXN014', bookingId:'BK014', amount:180, gateway:'CARD', date:'2026-06-15', status:'SETTLED'  },
    ],
    reviews:[
      { salonName:'Salman Salmani', rating:5, review:'Excellent service!',          date:'2026-06-23', bookingId:'BK001' },
      { salonName:'Hair Masters',   rating:4, review:'Good experience, will return.',date:'2026-06-22', bookingId:'BK005' },
      { salonName:'Smart Cuts',     rating:5, review:'Best haircut in town!',        date:'2026-06-15', bookingId:'BK014' },
    ],
    activity:[
      { event:'Booking Completed', detail:'Salman Salmani — Haircut',    time:'2026-06-23 10:32 AM', icon:'✓', color:'#059669' },
      { event:'Review Submitted',  detail:'5★ for Salman Salmani',       time:'2026-06-23 11:30 AM', icon:'⭐',color:'#B8960C' },
      { event:'Booking Completed', detail:'Hair Masters — Facial',       time:'2026-06-22 04:00 PM', icon:'✓', color:'#059669' },
      { event:'Booking Refunded',  detail:'Fade & Blade — ₹150',         time:'2026-06-21 05:30 PM', icon:'↩', color:'#7C3AED' },
      { event:'Booking Cancelled', detail:'Style Studio — Hair Color',   time:'2026-06-10 09:00 AM', icon:'✕', color:'#DC2626' },
      { event:'App Login',         detail:'Android — v2.4.1',            time:'2026-06-23 09:30 AM', icon:'📱',color:'#2563EB' },
    ],
    audit:[
      { date:'2026-06-23 10:32 AM', action:'Booking BK001 completed',        by:'System'      },
      { date:'2026-06-21 05:30 PM', action:'Refund processed — ₹150 BK009',  by:'System'      },
      { date:'2025-09-15 11:00 AM', action:'KYC verified',                   by:'India Admin' },
      { date:'2025-08-10 02:00 PM', action:'Account created — OTP verified', by:'System'      },
    ],
  },
  'USR007': {
    id:'USR007', name:'Suresh Kumar', phone:'9890123456', email:'suresh.kumar@gmail.com',
    state:'MH', district:'Mumbai', city:'Mumbai', pincode:'400053',
    status:'BLOCKED', verification:'UNVERIFIED', joinedAt:'2026-03-10',
    lastActive:'7 days ago', lastBooking:'2026-06-22',
    totalBookings:2, totalSpent:240, avgSpent:120, cancelCount:1,
    blockedBy:'Super Admin', blockedAt:'2026-06-18', blockReason:'Fraud complaint — chargeback',
    device:'iOS', appVersion:'2.3.8', referredBy:null,
    wallet:{ balance:0, totalCashback:0, totalRefunds:0, lastTransaction:'2026-06-10' },
    bookings:[
      { id:'BK007', salon:'The Barber Shop', service:'Haircut', amount:120, date:'2026-06-22', status:'NO_SHOW',   rating:null },
      { id:'BK015', salon:'Smart Cuts',      service:'Haircut', amount:120, date:'2026-06-10', status:'COMPLETED', rating:null },
    ],
    transactions:[
      { id:'TXN007', bookingId:'BK007', amount:120, gateway:'UPI', date:'2026-06-22', status:'FAILED'  },
      { id:'TXN015', bookingId:'BK015', amount:120, gateway:'UPI', date:'2026-06-10', status:'SETTLED' },
    ],
    reviews:[],
    activity:[
      { event:'Account Blocked', detail:'Fraud complaint — chargeback', time:'2026-06-18 02:00 PM', icon:'⊘', color:'#DC2626' },
      { event:'No Show',         detail:'The Barber Shop',              time:'2026-06-22 04:00 PM', icon:'✕', color:'#DC2626' },
    ],
    audit:[
      { date:'2026-06-18 02:00 PM', action:'Account BLOCKED — Fraud complaint', by:'Super Admin' },
      { date:'2026-06-22 04:00 PM', action:'Booking BK007 — NO_SHOW',          by:'System'      },
      { date:'2026-03-10 10:00 AM', action:'Account created — OTP verified',   by:'System'      },
    ],
  },
}

const STATUS_COLORS = {
  ACTIVE:    { bg:'#D1FAE5', color:'#065F46' },
  SUSPENDED: { bg:'#FEF9C3', color:'#92400E' },
  BLOCKED:   { bg:'#FEE2E2', color:'#991B1B' },
  INACTIVE:  { bg:'#F3F4F6', color:'#374151' },
}
const BOOKING_STATUS = {
  COMPLETED: { bg:'#D1FAE5', color:'#065F46' },
  CANCELLED: { bg:'#FEE2E2', color:'#991B1B' },
  REFUNDED:  { bg:'#F5F3FF', color:'#5B21B6' },
  NO_SHOW:   { bg:'#F3F4F6', color:'#374151' },
  UPCOMING:  { bg:'#EFF6FF', color:'#1D4ED8' },
}
const TXN_STATUS = {
  SETTLED:  { bg:'#D1FAE5', color:'#065F46' },
  REFUNDED: { bg:'#F5F3FF', color:'#5B21B6' },
  FAILED:   { bg:'#FEE2E2', color:'#991B1B' },
}
const VERIFY_COLORS = {
  KYC_VERIFIED: { bg:'#D1FAE5', color:'#065F46' },
  OTP_VERIFIED: { bg:'#EFF6FF', color:'#1D4ED8' },
  UNVERIFIED:   { bg:'#FEE2E2', color:'#991B1B' },
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
const SLabel = ({ title }) => (
  <div style={{ display:'flex', alignItems:'center', gap:'8px', margin:'12px 0 8px' }}>
    <div style={{ width:'3px', height:'12px', background:'#B8960C' }}/>
    <span style={{ fontSize:'9px', fontWeight:800, color:'#9E8E6E', letterSpacing:'2px', textTransform:'uppercase' }}>{title}</span>
  </div>
)

// ✅ Fix 2 — Not Found component
const NotFound = ({ onBack }) => (
  <div style={{ fontFamily:FONTS.body, background:'#F0EAE0', minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center' }}>
    <div style={{ background:'#fff', border:'2px solid #D4C9B0', borderTop:'2px solid #B8960C', padding:'40px', textAlign:'center', maxWidth:'400px' }}>
      <div style={{ fontSize:'40px', marginBottom:'16px' }}>🔍</div>
      <div style={{ fontSize:'16px', fontWeight:800, color:'#1A1A2E', marginBottom:'8px' }}>User Not Found</div>
      <div style={{ fontSize:'13px', color:'#9E8E6E', marginBottom:'16px' }}>This user ID does not exist in the system.</div>
      <button onClick={onBack} style={{ background:'#0D1B2A', color:'#B8960C', border:'none', padding:'8px 20px', fontSize:'12px', fontWeight:700, cursor:'pointer' }}>← GO BACK</button>
    </div>
  </div>
)

const AccessDenied = ({ msg, onBack }) => (
  <div style={{ fontFamily:FONTS.body, background:'#F0EAE0', minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center' }}>
    <div style={{ background:'#fff', border:'2px solid #DC2626', padding:'40px', textAlign:'center', maxWidth:'400px' }}>
      <div style={{ fontSize:'40px', marginBottom:'16px' }}>🔒</div>
      <div style={{ fontSize:'16px', fontWeight:800, color:'#1A1A2E', marginBottom:'8px' }}>Access Denied</div>
      <div style={{ fontSize:'13px', color:'#9E8E6E', marginBottom:'16px' }}>{msg}</div>
      <button onClick={onBack} style={{ background:'#0D1B2A', color:'#B8960C', border:'none', padding:'8px 20px', fontSize:'12px', fontWeight:700, cursor:'pointer' }}>← GO BACK</button>
    </div>
  </div>
)

export default function UserDetailPage() {
  const { id }     = useParams()
  const navigate   = useNavigate()
  const admin      = useAuthStore(s=>s.admin)
  const adminLevel = admin?.adminLevel||ADMIN_LEVELS.SUPER_ADMIN
  const hasBlock   = canBlock(adminLevel)
  const hasPII     = canViewPII(adminLevel)

  // ✅ Fix 2 — Invalid ID check
  const rawUser = USERS_DB[id]
  if (!rawUser) return <NotFound onBack={()=>navigate('/app/users')}/>

  // ✅ Fix 1 — DISTRICT_ADMIN block
  if (adminLevel===ADMIN_LEVELS.DISTRICT_ADMIN) {
    return <AccessDenied msg="DISTRICT_ADMIN does not have access to User Details." onBack={()=>navigate(-1)}/>
  }

  // ✅ Fix 1 — STATE_ADMIN scope validation
  if (adminLevel===ADMIN_LEVELS.STATE_ADMIN && admin?.stateRef && rawUser.state!==admin.stateRef) {
    return <AccessDenied msg={`STATE_ADMIN can only view users from their assigned state.`} onBack={()=>navigate('/app/users')}/>
  }

  const [tab,   setTab]   = useState('overview')
  const [toast, setToast] = useState(null)
  const [user,  setUser]  = useState(rawUser)

  const showToast = (msg,color) => { setToast({msg,color}); setTimeout(()=>setToast(null),3000) }

  // ✅ Fix 3 — Block/Unblock appends to audit
  const handleBlock = () => {
    const isActive  = user.status==='ACTIVE'
    const newStatus = isActive ? 'BLOCKED' : 'ACTIVE'
    const now       = new Date().toLocaleString('en-IN',{hour12:false}).replace(',','')
    const auditEntry = {
      date:   now,
      action: isActive ? `Account BLOCKED by admin` : `Account UNBLOCKED by admin`,
      by:     adminLevel,
    }
    setUser(u=>({
      ...u,
      status:    newStatus,
      blockedBy: isActive ? adminLevel : null,
      blockedAt: isActive ? '2026-06-23' : null,
      blockReason: null,
      audit: [auditEntry, ...u.audit],
    }))
    showToast(isActive?`⊘ ${user.name} blocked`:`✓ ${user.name} unblocked`, isActive?'#DC2626':'#059669')
  }

  const sc  = STATUS_COLORS[user.status]||STATUS_COLORS.INACTIVE
  const vc  = VERIFY_COLORS[user.verification]||VERIFY_COLORS.UNVERIFIED
  // ✅ Fix 3 - wallet tab added
  const TABS = ['overview','bookings','transactions','wallet','reviews','activity','audit']

  const avgRating = user.reviews.length>0
    ? (user.reviews.reduce((a,r)=>a+r.rating,0)/user.reviews.length).toFixed(1) : '—'

  return (
    <div style={{ fontFamily:FONTS.body, background:'#F0EAE0', minHeight:'100vh' }}>

      {toast && <div style={{ position:'fixed', top:'20px', right:'20px', background:toast.color, color:'#fff', padding:'12px 20px', fontSize:'13px', fontWeight:700, zIndex:9999, boxShadow:'0 4px 12px rgba(0,0,0,0.2)' }}>{toast.msg}</div>}

      {/* Header */}
      <div style={{ background:'#0D1B2A', borderBottom:'2px solid #B8960C', padding:'0 20px', height:'52px', display:'flex', alignItems:'center', justifyContent:'space-between', position:'sticky', top:0, zIndex:10 }}>
        <div style={{ display:'flex', alignItems:'center', gap:'12px' }}>
          <button onClick={()=>navigate('/app/users')} style={{ background:'rgba(255,255,255,0.07)', border:'1px solid rgba(255,255,255,0.1)', color:'rgba(255,255,255,0.6)', padding:'5px 10px', cursor:'pointer', fontSize:'12px', fontWeight:700 }}>← BACK</button>
          <div style={{ width:'3px', height:'16px', background:'#B8960C' }}/>
          <div>
            <div style={{ color:'#fff', fontWeight:800, fontSize:'13px', letterSpacing:'1px' }}>{user.name}</div>
            <div style={{ color:'#B8960C', fontSize:'9px', letterSpacing:'1px', marginTop:'1px' }}>{user.id} • {user.district}, {user.state} • Joined {user.joinedAt}</div>
          </div>
          <span style={{ fontSize:'10px', fontWeight:800, background:sc.bg, color:sc.color, padding:'3px 8px' }}>{user.status}</span>
          <span style={{ fontSize:'10px', fontWeight:800, background:vc.bg, color:vc.color, padding:'3px 8px' }}>{fmtVerification(user.verification)}</span>
        </div>
        <div style={{ display:'flex', gap:'8px' }}>
          {hasBlock && (
            <button onClick={handleBlock}
              style={{ background:user.status==='BLOCKED'?'rgba(5,150,105,0.2)':'rgba(220,38,38,0.2)', border:`1px solid ${user.status==='BLOCKED'?'rgba(5,150,105,0.5)':'rgba(220,38,38,0.5)'}`, color:user.status==='BLOCKED'?'#6EE7B7':'#FCA5A5', padding:'6px 12px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>
              {user.status==='BLOCKED'?'✓ UNBLOCK':'⊘ BLOCK USER'}
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div style={{ background:'#0A1520', borderBottom:'1px solid rgba(184,150,12,0.2)', display:'flex', padding:'0 20px', overflowX:'auto' }}>
        {TABS.map(t=>(
          <button key={t} onClick={()=>setTab(t)} style={{ padding:'10px 16px', border:'none', background:'none', cursor:'pointer', fontSize:'10px', fontWeight:tab===t?800:400, color:tab===t?'#B8960C':'rgba(255,255,255,0.35)', borderBottom:tab===t?'2px solid #B8960C':'2px solid transparent', letterSpacing:'1.5px', textTransform:'uppercase', whiteSpace:'nowrap' }}>
            {t}
            {t==='bookings'&&<span style={{ marginLeft:'5px', background:'rgba(184,150,12,0.3)', color:'#B8960C', fontSize:'9px', padding:'1px 5px' }}>{user.bookings.length}</span>}
            {t==='reviews'&&<span style={{ marginLeft:'5px', background:'rgba(184,150,12,0.3)', color:'#B8960C', fontSize:'9px', padding:'1px 5px' }}>{user.reviews.length}</span>}
            {t==='audit'&&<span style={{ marginLeft:'5px', background:'rgba(220,38,38,0.3)', color:'#FCA5A5', fontSize:'9px', padding:'1px 5px' }}>{user.audit.length}</span>}
          </button>
        ))}
      </div>

      {/* KPI Strip */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:'1px', background:'#D4C9B0', borderBottom:'2px solid #B8960C' }}>
        {[
          { label:'Total Bookings',  value:user.totalBookings,                           color:'#B8960C' },
          { label:'Total Spent',     value:`₹${user.totalSpent.toLocaleString('en-IN')}`,color:'#059669' },
          { label:'Avg Spend',       value:`₹${user.avgSpent}`,                          color:'#2563EB' },
          { label:'Avg Rating Given',value:avgRating==='—'?'—':`${avgRating}★`,         color:'#D97706' },
          { label:'Last Active',     value:user.lastActive,                              color:'#9E8E6E' },
        ].map(k=>(
          <div key={k.label} style={{ background:'#0D1B2A', padding:'10px 16px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
            <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.4)' }}>{k.label}</span>
            <span style={{ fontSize:'14px', fontWeight:800, color:k.color }}>{k.value}</span>
          </div>
        ))}
      </div>

      {user.status==='BLOCKED' && (
        <div style={{ background:'#FEF2F2', borderBottom:'2px solid #DC2626', padding:'10px 20px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <span style={{ fontSize:'12px', color:'#991B1B', fontWeight:700 }}>⊘ BLOCKED — {user.blockReason||'Admin action'} • By {user.blockedBy} on {user.blockedAt}</span>
          {hasBlock && <button onClick={handleBlock} style={{ background:'#059669', color:'#fff', border:'none', padding:'5px 12px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>✓ UNBLOCK</button>}
        </div>
      )}

      <div style={{ padding:'16px 20px' }}>

        {/* OVERVIEW */}
        {tab==='overview' && (
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:'14px' }}>
            <BCard>
              <BCardHeader title="User Profile"/>
              <div style={{ padding:'14px' }}>
                <div style={{ display:'flex', alignItems:'center', gap:'12px', padding:'12px', background:'#F5F0E8', border:'1px solid #E8DFD0', borderTop:'2px solid #B8960C', marginBottom:'14px' }}>
                  <div style={{ width:'44px', height:'44px', background:'#0D1B2A', display:'flex', alignItems:'center', justifyContent:'center', color:'#B8960C', fontSize:'18px', fontWeight:800, flexShrink:0 }}>{user.name[0]}</div>
                  <div>
                    <div style={{ fontSize:'15px', fontWeight:800, color:'#1A1A2E' }}>{user.name}</div>
                    <div style={{ fontSize:'10px', color:'#9E8E6E', marginTop:'2px' }}>Joined {user.joinedAt}</div>
                  </div>
                </div>
                <SLabel title="Contact"/>
                <InfoRow label="Phone"  value={hasPII?user.phone:maskPhone(user.phone)}/>
                <InfoRow label="Email"  value={hasPII?user.email:maskEmail(user.email)}/>
                <SLabel title="Location"/>
                <InfoRow label="District" value={user.district}/>
                <InfoRow label="State"    value={user.state}/>
                <InfoRow label="Pincode"  value={hasPII?user.pincode:'XXXXXX'}/>
                <SLabel title="Account"/>
                <InfoRow label="Status"       value={user.status}                      valueColor={sc.color}/>
                <InfoRow label="Verification" value={fmtVerification(user.verification)} valueColor={vc.color}/>
              </div>
            </BCard>

            <BCard>
              <BCardHeader title="Booking Stats"/>
              <div style={{ padding:'14px' }}>
                <div style={{ background:'#0D1B2A', padding:'16px', marginBottom:'14px', textAlign:'center', borderTop:'2px solid #B8960C' }}>
                  <div style={{ fontSize:'10px', color:'rgba(255,255,255,0.4)', letterSpacing:'1px', marginBottom:'6px' }}>TOTAL SPENT</div>
                  <div style={{ fontSize:'28px', fontWeight:800, color:'#B8960C' }}>₹{user.totalSpent.toLocaleString('en-IN')}</div>
                </div>
                <InfoRow label="Total Bookings"    value={user.totalBookings}/>
                <InfoRow label="Completed"         value={user.bookings.filter(b=>b.status==='COMPLETED').length} valueColor="#059669"/>
                <InfoRow label="Cancelled"         value={user.cancelCount}  valueColor="#DC2626"/>
                <InfoRow label="Avg Spend/Booking" value={`₹${user.avgSpent}`}/>
                <InfoRow label="Last Booking"      value={user.lastBooking}/>
                <InfoRow label="Reviews Given"     value={user.reviews.length}/>
                <InfoRow label="Avg Rating Given"  value={avgRating==='—'?'—':`${avgRating}★`} valueColor="#B8960C"/>
              </div>
            </BCard>

            <BCard>
              <BCardHeader title="App & Block Info"/>
              <div style={{ padding:'14px' }}>
                <SLabel title="Device"/>
                <InfoRow label="Device"      value={user.device}/>
                <InfoRow label="App Version" value={user.appVersion}/>
                <InfoRow label="Last Active" value={user.lastActive}/>
                <InfoRow label="Referred By" value={user.referredBy||'Direct'}/>
                <SLabel title="Block History"/>
                {user.blockedBy ? (
                  <>
                    <InfoRow label="Blocked By"   value={user.blockedBy}   valueColor="#DC2626"/>
                    <InfoRow label="Blocked At"   value={user.blockedAt}   valueColor="#DC2626"/>
                    <InfoRow label="Block Reason" value={user.blockReason||'Admin action'} valueColor="#DC2626"/>
                  </>
                ) : (
                  <div style={{ padding:'10px', textAlign:'center', color:'#059669', fontSize:'12px', fontWeight:600 }}>✓ No block history</div>
                )}
              </div>
            </BCard>
          </div>
        )}

        {/* BOOKINGS */}
        {tab==='bookings' && (
          <BCard>
            <BCardHeader title={`Booking History (${user.bookings.length})`}/>
            <div style={{ display:'grid', gridTemplateColumns:'0.8fr 1.5fr 1.2fr 0.8fr 0.8fr 0.8fr 0.6fr', padding:'8px 14px', background:'#F5F0E8', borderBottom:'1px solid #E8DFD0', gap:'8px' }}>
              {['BOOKING ID','SALON','SERVICE','AMOUNT','DATE','STATUS','RATING'].map(h=>(
                <span key={h} style={{ fontSize:'9px', fontWeight:800, color:'#9E8E6E', letterSpacing:'1px' }}>{h}</span>
              ))}
            </div>
            {user.bookings.map((b,i)=>{
              const bs=BOOKING_STATUS[b.status]||BOOKING_STATUS.UPCOMING
              return (
                <div key={b.id} onClick={()=>navigate(`/app/bookings/${b.id}`)}
                  style={{ display:'grid', gridTemplateColumns:'0.8fr 1.5fr 1.2fr 0.8fr 0.8fr 0.8fr 0.6fr', padding:'11px 14px', borderBottom:'1px solid #F0EAE0', alignItems:'center', gap:'8px', background:i%2===0?'#fff':'#FDFAF6', cursor:'pointer' }}>
                  <span style={{ fontSize:'10px', color:'#9E8E6E', fontFamily:'monospace' }}>{b.id}</span>
                  <span style={{ fontSize:'12px', fontWeight:700, color:'#1A1A2E' }}>{b.salon}</span>
                  <span style={{ fontSize:'11px', color:'#6B5E3E' }}>{b.service}</span>
                  <span style={{ fontSize:'12px', fontWeight:700, color:'#B8960C' }}>₹{b.amount}</span>
                  <span style={{ fontSize:'11px', color:'#9E8E6E' }}>{b.date}</span>
                  <span style={{ fontSize:'9px', fontWeight:800, background:bs.bg, color:bs.color, padding:'2px 6px', display:'inline-block' }}>{b.status.replace('_',' ')}</span>
                  <span style={{ fontSize:'12px', color:b.rating?'#B8960C':'#C4B49A' }}>{b.rating?`${b.rating}★`:'—'}</span>
                </div>
              )
            })}
          </BCard>
        )}

        {/* TRANSACTIONS */}
        {tab==='transactions' && (
          <BCard>
            <BCardHeader title={`Transaction History (${user.transactions.length})`}/>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 0.8fr 0.7fr 0.8fr 0.8fr', padding:'8px 14px', background:'#F5F0E8', borderBottom:'1px solid #E8DFD0', gap:'8px' }}>
              {['TXN ID','BOOKING ID','AMOUNT','GATEWAY','DATE','STATUS'].map(h=>(
                <span key={h} style={{ fontSize:'9px', fontWeight:800, color:'#9E8E6E', letterSpacing:'1px' }}>{h}</span>
              ))}
            </div>
            {user.transactions.map((t,i)=>{
              const ts=TXN_STATUS[t.status]||TXN_STATUS.SETTLED
              return (
                <div key={t.id} onClick={()=>navigate(`/app/finance/transactions/${t.id}`)}
                  style={{ display:'grid', gridTemplateColumns:'1fr 1fr 0.8fr 0.7fr 0.8fr 0.8fr', padding:'11px 14px', borderBottom:'1px solid #F0EAE0', alignItems:'center', gap:'8px', background:i%2===0?'#fff':'#FDFAF6', cursor:'pointer' }}>
                  <span style={{ fontSize:'10px', color:'#9E8E6E', fontFamily:'monospace' }}>{t.id}</span>
                  <span style={{ fontSize:'10px', color:'#2563EB', fontFamily:'monospace', textDecoration:'underline' }}>{t.bookingId}</span>
                  <span style={{ fontSize:'12px', fontWeight:700, color:'#B8960C' }}>₹{t.amount}</span>
                  <span style={{ fontSize:'11px', color:'#6B5E3E' }}>{t.gateway}</span>
                  <span style={{ fontSize:'11px', color:'#9E8E6E' }}>{t.date}</span>
                  <span style={{ fontSize:'9px', fontWeight:800, background:ts.bg, color:ts.color, padding:'2px 6px', display:'inline-block' }}>{t.status}</span>
                </div>
              )
            })}
          </BCard>
        )}

        {/* ✅ Fix 3 — WALLET TAB */}
        {tab==='wallet' && (
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'14px' }}>
            <BCard>
              <BCardHeader title="Wallet Overview"/>
              <div style={{ padding:'14px' }}>
                <div style={{ background:'#0D1B2A', padding:'20px', marginBottom:'14px', textAlign:'center', borderTop:'2px solid #B8960C' }}>
                  <div style={{ fontSize:'10px', color:'rgba(255,255,255,0.4)', letterSpacing:'1px', marginBottom:'6px' }}>WALLET BALANCE</div>
                  <div style={{ fontSize:'32px', fontWeight:800, color:'#B8960C' }}>₹{user.wallet.balance.toLocaleString('en-IN')}</div>
                </div>
                <InfoRow label="Total Cashback Earned" value={`₹${user.wallet.totalCashback}`}  valueColor="#059669"/>
                <InfoRow label="Total Refunds Received"value={`₹${user.wallet.totalRefunds}`}   valueColor="#7C3AED"/>
                <InfoRow label="Last Transaction"      value={user.wallet.lastTransaction}/>
              </div>
            </BCard>
            <BCard>
              <BCardHeader title="Wallet Activity"/>
              <div style={{ padding:'16px' }}>
                <div style={{ background:'#FFFBEB', border:'1px solid #FDE68A', padding:'12px', fontSize:'11px', color:'#92400E', fontWeight:600, marginBottom:'14px' }}>
                  ℹ User wallet is informational only. No manual balance editing allowed.
                </div>
                {[
                  { label:'Current Balance',  val:`₹${user.wallet.balance}`,       color:'#B8960C' },
                  { label:'Cashback Credits', val:`₹${user.wallet.totalCashback}`,  color:'#059669' },
                  { label:'Refunds Credited', val:`₹${user.wallet.totalRefunds}`,   color:'#7C3AED' },
                  { label:'Total Lifetime',   val:`₹${user.wallet.balance+user.wallet.totalCashback+user.wallet.totalRefunds}`, color:'#2563EB' },
                ].map(r=>(
                  <div key={r.label} style={{ display:'flex', justifyContent:'space-between', padding:'8px 0', borderBottom:'1px solid #F0EAE0' }}>
                    <span style={{ fontSize:'12px', color:'#9E8E6E' }}>{r.label}</span>
                    <span style={{ fontSize:'13px', fontWeight:800, color:r.color }}>{r.val}</span>
                  </div>
                ))}
              </div>
            </BCard>
          </div>
        )}

        {/* REVIEWS */}
        {tab==='reviews' && (
          <BCard>
            <BCardHeader title={`Reviews Given (${user.reviews.length})`}/>
            {user.reviews.length===0
              ?<div style={{ padding:'40px', textAlign:'center', color:'#9E8E6E' }}>No reviews yet</div>
              :user.reviews.map((r,i)=>(
                <div key={i} style={{ padding:'14px 16px', borderBottom:'1px solid #F0EAE0', background:i%2===0?'#fff':'#FDFAF6' }}>
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'8px' }}>
                    <div>
                      <span style={{ fontSize:'13px', fontWeight:700, color:'#1A1A2E' }}>{r.salonName}</span>
                      <span style={{ fontSize:'10px', color:'#9E8E6E', marginLeft:'10px' }}>{r.date}</span>
                    </div>
                    <div style={{ display:'flex', gap:'2px' }}>
                      {[1,2,3,4,5].map(s=><span key={s} style={{ color:s<=r.rating?'#B8960C':'#E8DFD0', fontSize:'16px' }}>★</span>)}
                    </div>
                  </div>
                  <div style={{ padding:'10px', background:'#F5F0E8', border:'1px solid #E8DFD0', borderLeft:'3px solid #B8960C', fontSize:'13px', color:'#6B5E3E' }}>"{r.review}"</div>
                </div>
              ))
            }
          </BCard>
        )}

        {/* ACTIVITY */}
        {tab==='activity' && (
          <BCard>
            <BCardHeader title="Activity Timeline"/>
            <div style={{ padding:'20px' }}>
              <div style={{ position:'relative', paddingLeft:'30px' }}>
                <div style={{ position:'absolute', left:'10px', top:'10px', bottom:'10px', width:'2px', background:'#E8DFD0' }}/>
                {user.activity.map((a,i)=>(
                  <div key={i} style={{ position:'relative', marginBottom:'16px' }}>
                    <div style={{ position:'absolute', left:'-24px', top:'2px', width:'20px', height:'20px', background:a.color, display:'flex', alignItems:'center', justifyContent:'center', fontSize:'10px' }}>
                      <span style={{ color:'#fff', fontWeight:800 }}>{a.icon}</span>
                    </div>
                    <div style={{ background:'#FDFAF6', border:'1px solid #D4C9B0', borderLeft:`3px solid ${a.color}`, padding:'10px 14px' }}>
                      <div style={{ display:'flex', justifyContent:'space-between' }}>
                        <span style={{ fontSize:'13px', fontWeight:700, color:'#1A1A2E' }}>{a.event}</span>
                        <span style={{ fontSize:'10px', color:'#9E8E6E' }}>{a.time}</span>
                      </div>
                      <div style={{ fontSize:'11px', color:'#9E8E6E', marginTop:'3px' }}>{a.detail}</div>
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
            {user.audit.map((a,i)=>(
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
        <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.3)' }}>ZEMISH USER DETAIL v2.0.0</span>
        <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.3)' }}>NATIONAL COMMAND CENTER</span>
      </div>
    </div>
  )
}