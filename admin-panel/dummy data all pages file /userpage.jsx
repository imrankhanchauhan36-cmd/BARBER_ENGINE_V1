import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FONTS } from '../../config/brand'
import useAuthStore from '../../store/authStore'

const ADMIN_LEVELS = { SUPER_ADMIN:'SUPER_ADMIN', INDIA_ADMIN:'INDIA_ADMIN', STATE_ADMIN:'STATE_ADMIN', DISTRICT_ADMIN:'DISTRICT_ADMIN' }
const canExport   = (l) => [ADMIN_LEVELS.SUPER_ADMIN, ADMIN_LEVELS.INDIA_ADMIN, ADMIN_LEVELS.STATE_ADMIN].includes(l)
const canBlock    = (l) => [ADMIN_LEVELS.SUPER_ADMIN, ADMIN_LEVELS.INDIA_ADMIN].includes(l)
const canViewPII  = (l) => [ADMIN_LEVELS.SUPER_ADMIN, ADMIN_LEVELS.INDIA_ADMIN].includes(l)

const maskPhone = (p='') => p&&p.length>=4 ? p.slice(0,2)+'******'+p.slice(-2) : '******'
const maskEmail = (e='') => { if(!e||!e.includes('@')) return '***@***'; const [u,d]=e.split('@'); return u.slice(0,2)+'***@'+d }

const USERS_DATA = [
  { id:'USR001', name:'Rahul Verma',    phone:'9812345678', email:'rahul.verma@gmail.com',    state:'UP', district:'Hapur',       bookings:12, totalSpent:2840,  lastBooking:'2026-06-23', lastActive:'2 hrs ago',   status:'ACTIVE',    verification:'KYC_VERIFIED',  blockedBy:null,        blockedAt:null,        blockReason:null },
  { id:'USR002', name:'Amit Kumar',     phone:'9834567890', email:'amit.kumar@gmail.com',     state:'UP', district:'Noida',       bookings:7,  totalSpent:1420,  lastBooking:'2026-06-23', lastActive:'5 hrs ago',   status:'ACTIVE',    verification:'OTP_VERIFIED',  blockedBy:null,        blockedAt:null,        blockReason:null },
  { id:'USR003', name:'Vikas Singh',    phone:'9856789012', email:'vikas.singh@gmail.com',    state:'UP', district:'Lucknow',     bookings:24, totalSpent:8400,  lastBooking:'2026-06-22', lastActive:'Yesterday',   status:'ACTIVE',    verification:'KYC_VERIFIED',  blockedBy:null,        blockedAt:null,        blockReason:null },
  { id:'USR004', name:'Deepak Gupta',   phone:'9867890123', email:'deepak.gupta@gmail.com',   state:'UP', district:'Agra',        bookings:4,  totalSpent:680,   lastBooking:'2026-06-22', lastActive:'Yesterday',   status:'ACTIVE',    verification:'OTP_VERIFIED',  blockedBy:null,        blockedAt:null,        blockReason:null },
  { id:'USR005', name:'Raj Sharma',     phone:'9878901234', email:'raj.sharma@gmail.com',     state:'UP', district:'Kanpur',      bookings:18, totalSpent:4200,  lastBooking:'2026-06-22', lastActive:'Yesterday',   status:'SUSPENDED', verification:'KYC_VERIFIED',  blockedBy:'India Admin',blockedAt:'2026-06-20',blockReason:'Multiple cancellations' },
  { id:'USR006', name:'Neha Joshi',     phone:'9889012345', email:'neha.joshi@gmail.com',     state:'DL', district:'South Delhi', bookings:32, totalSpent:18400, lastBooking:'2026-06-22', lastActive:'3 hrs ago',   status:'ACTIVE',    verification:'KYC_VERIFIED',  blockedBy:null,        blockedAt:null,        blockReason:null },
  { id:'USR007', name:'Suresh Kumar',   phone:'9890123456', email:'suresh.kumar@gmail.com',   state:'MH', district:'Mumbai',      bookings:2,  totalSpent:240,   lastBooking:'2026-06-22', lastActive:'7 days ago',  status:'BLOCKED',   verification:'UNVERIFIED',    blockedBy:'Super Admin',blockedAt:'2026-06-18',blockReason:'Fraud complaint' },
  { id:'USR008', name:'Priya Patel',    phone:'9901234567', email:'priya.patel@gmail.com',    state:'RJ', district:'Jaipur',      bookings:15, totalSpent:6800,  lastBooking:'2026-06-21', lastActive:'2 days ago',  status:'ACTIVE',    verification:'KYC_VERIFIED',  blockedBy:null,        blockedAt:null,        blockReason:null },
  { id:'USR009', name:'Karan Mehta',    phone:'9812387654', email:'karan.mehta@gmail.com',    state:'GJ', district:'Ahmedabad',   bookings:8,  totalSpent:1800,  lastBooking:'2026-06-21', lastActive:'2 days ago',  status:'ACTIVE',    verification:'OTP_VERIFIED',  blockedBy:null,        blockedAt:null,        blockReason:null },
  { id:'USR010', name:'Sunita Das',     phone:'9823476541', email:'sunita.das@gmail.com',     state:'KA', district:'Bengaluru',   bookings:28, totalSpent:12400, lastBooking:'2026-06-21', lastActive:'1 hr ago',    status:'ACTIVE',    verification:'KYC_VERIFIED',  blockedBy:null,        blockedAt:null,        blockReason:null },
  { id:'USR011', name:'Arjun Nair',     phone:'9834565432', email:'arjun.nair@gmail.com',     state:'KL', district:'Kochi',       bookings:19, totalSpent:5200,  lastBooking:'2026-06-20', lastActive:'3 days ago',  status:'ACTIVE',    verification:'OTP_VERIFIED',  blockedBy:null,        blockedAt:null,        blockReason:null },
  { id:'USR012', name:'Rohan Malhotra', phone:'9845654321', email:'rohan.malhotra@gmail.com', state:'PB', district:'Chandigarh',  bookings:6,  totalSpent:1400,  lastBooking:'2026-06-20', lastActive:'10 days ago', status:'INACTIVE',  verification:'UNVERIFIED',    blockedBy:null,        blockedAt:null,        blockReason:null },
]

const STATUS_COLORS = {
  ACTIVE:    { bg:'#D1FAE5', color:'#065F46' },
  SUSPENDED: { bg:'#FEF9C3', color:'#92400E' },
  BLOCKED:   { bg:'#FEE2E2', color:'#991B1B' },
  INACTIVE:  { bg:'#F3F4F6', color:'#374151' },
}
const VERIFY_COLORS = {
  KYC_VERIFIED: { bg:'#D1FAE5', color:'#065F46', label:'KYC ✓'  },
  OTP_VERIFIED: { bg:'#EFF6FF', color:'#1D4ED8', label:'OTP ✓'  },
  UNVERIFIED:   { bg:'#FEE2E2', color:'#991B1B', label:'UNVERIFIED' },
}

const STATES   = ['All States',   ...new Set(USERS_DATA.map(u=>u.state))]
const STATUSES = ['ALL','ACTIVE','SUSPENDED','BLOCKED','INACTIVE']
const DATES    = ['All Time','Today','Last 7 Days','Last 30 Days']
const TODAY='2026-06-23', LAST7='2026-06-16', LAST30='2026-05-24'

// Block Modal
function BlockModal({ user, onConfirm, onCancel }) {
  const [reason, setReason] = useState('')
  const isBlocked    = user.status === 'BLOCKED'
  const isSuspended  = user.status === 'SUSPENDED'
  const actionLabel  = isBlocked ? '✓ UNBLOCK' : isSuspended ? '✓ REMOVE SUSPENSION' : '⊘ BLOCK'
  const headerLabel  = isBlocked ? 'UNBLOCK USER' : isSuspended ? 'REMOVE SUSPENSION' : 'BLOCK USER'
  const headerColor  = isBlocked||isSuspended ? '#064E3B' : '#7F1D1D'
  const borderColor  = isBlocked||isSuspended ? '#059669' : '#DC2626'
  const btnColor     = isBlocked||isSuspended ? '#059669' : '#DC2626'
  const canProceed   = isBlocked||isSuspended ? true : reason.trim().length > 0
  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.75)', zIndex:2000, display:'flex', alignItems:'center', justifyContent:'center' }}>
      <div style={{ background:'#fff', width:'440px', border:`2px solid ${borderColor}` }}>
        <div style={{ background:headerColor, padding:'14px 18px', borderBottom:`2px solid ${borderColor}` }}>
          <div style={{ color:'#fff', fontWeight:800, fontSize:'13px', letterSpacing:'1px' }}>{headerLabel}</div>
          <div style={{ color:'rgba(255,255,255,0.6)', fontSize:'10px', marginTop:'2px' }}>{user.name} — {user.id}</div>
        </div>
        <div style={{ padding:'20px 18px' }}>
          {!isBlocked && !isSuspended && (
            <div style={{ background:'#FEF2F2', border:'1px solid #FEE2E2', padding:'10px', marginBottom:'14px', fontSize:'11px', color:'#991B1B', fontWeight:600 }}>
              ⚠ Blocking will prevent user from making new bookings.
            </div>
          )}
          {isSuspended && (
            <div style={{ background:'#FFFBEB', border:'1px solid #FDE68A', padding:'10px', marginBottom:'14px', fontSize:'11px', color:'#92400E', fontWeight:600 }}>
              ⚠ Removing suspension will restore user to ACTIVE status.
            </div>
          )}
          <label style={{ fontSize:'10px', color:'#9E8E6E', fontWeight:800, letterSpacing:'1px', display:'block', marginBottom:'6px' }}>
            {isBlocked||isSuspended ? 'REASON (OPTIONAL)' : 'BLOCK REASON (REQUIRED)'}
          </label>
          <textarea value={reason} onChange={e=>setReason(e.target.value)} placeholder={isBlocked?'Why unblocking...':isSuspended?'Why removing suspension...':'Reason for blocking...'}
            style={{ width:'100%', border:'1px solid #D4C9B0', padding:'8px 12px', fontSize:'13px', fontFamily:FONTS.body, outline:'none', minHeight:'70px', resize:'vertical', boxSizing:'border-box', marginBottom:'14px' }}/>
          <div style={{ display:'flex', gap:'8px', justifyContent:'flex-end' }}>
            <button onClick={onCancel} style={{ background:'#fff', border:'1px solid #D4C9B0', color:'#6B5E3E', padding:'8px 16px', fontSize:'11px', fontWeight:700, cursor:'pointer' }}>CANCEL</button>
            <button onClick={()=>canProceed&&onConfirm(reason,user.status)}
              style={{ background:canProceed?btnColor:'#F5F0E8', border:'none', color:canProceed?'#fff':'#C4B49A', padding:'8px 20px', fontSize:'11px', fontWeight:800, cursor:canProceed?'pointer':'not-allowed' }}>
              {actionLabel}
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

export default function UsersPage() {
  const navigate   = useNavigate()
  const admin      = useAuthStore(s=>s.admin)
  const adminLevel = admin?.adminLevel||ADMIN_LEVELS.SUPER_ADMIN
  const hasExport  = canExport(adminLevel)
  const hasBlock   = canBlock(adminLevel)
  const hasPII     = canViewPII(adminLevel)

  const scope = adminLevel===ADMIN_LEVELS.STATE_ADMIN?'YOUR STATE':adminLevel===ADMIN_LEVELS.DISTRICT_ADMIN?'YOUR DISTRICT':'PAN INDIA'

  // ✅ Fix 2 — DISTRICT_ADMIN access denied
  if (adminLevel === ADMIN_LEVELS.DISTRICT_ADMIN) {
    return (
      <div style={{ fontFamily:FONTS.body, background:'#F0EAE0', minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center' }}>
        <div style={{ background:'#fff', border:'2px solid #DC2626', padding:'40px', textAlign:'center', maxWidth:'400px' }}>
          <div style={{ fontSize:'40px', marginBottom:'16px' }}>🔒</div>
          <div style={{ fontSize:'16px', fontWeight:800, color:'#1A1A2E', marginBottom:'8px' }}>Access Denied</div>
          <div style={{ fontSize:'13px', color:'#9E8E6E', marginBottom:'16px' }}>DISTRICT_ADMIN does not have access to Users module.</div>
          <div style={{ fontSize:'11px', color:'#DC2626', fontWeight:600 }}>Required: SUPER_ADMIN / INDIA_ADMIN / STATE_ADMIN</div>
        </div>
      </div>
    )
  }

  const [search,     setSearch]     = useState('')
  const [status,     setStatus]     = useState('ALL')
  const [stateF,     setStateF]     = useState('All States')
  const [dateF,      setDateF]      = useState('All Time')
  const [page,       setPage]       = useState(1)
  const [toast,      setToast]      = useState(null)
  const [users,      setUsers]      = useState(USERS_DATA)
  const [blockModal, setBlockModal] = useState(null)
  const PER_PAGE = 8

  const showToast = (msg,color) => { setToast({msg,color}); setTimeout(()=>setToast(null),3000) }

  const handleBlockConfirm = (reason, currentStatus) => {
    const u = blockModal
    const newStatus = (currentStatus==='BLOCKED'||currentStatus==='SUSPENDED') ? 'ACTIVE' : 'BLOCKED'
    setUsers(prev=>prev.map(usr=>usr.id===u.id?{
      ...usr,
      status: newStatus,
      blockedBy: newStatus==='ACTIVE' ? null : `${adminLevel}`,
      blockedAt: newStatus==='ACTIVE' ? null : new Date().toISOString().split('T')[0],
      blockReason: newStatus==='ACTIVE' ? null : reason
    }:usr))
    const msg = currentStatus==='BLOCKED' ? `✓ ${u.name} unblocked`
              : currentStatus==='SUSPENDED' ? `✓ ${u.name} suspension removed`
              : `⊘ ${u.name} blocked`
    showToast(msg, newStatus==='ACTIVE'?'#059669':'#DC2626')
    setBlockModal(null)
  }

  const filterByDate = (u) => {
    if (dateF==='All Time')     return true
    if (dateF==='Today')        return u.lastBooking===TODAY
    if (dateF==='Last 7 Days')  return u.lastBooking>=LAST7
    if (dateF==='Last 30 Days') return u.lastBooking>=LAST30
    return true
  }

  // ✅ Fix 3 — STATE_ADMIN scope filter
  const scopedUsers = adminLevel===ADMIN_LEVELS.STATE_ADMIN
    ? users.filter(u => u.state === (admin?.stateRef || u.state))
    : users

  const filtered = scopedUsers.filter(u=>{
    const q=search.toLowerCase()
    const matchSearch=!search||u.name.toLowerCase().includes(q)||u.phone.includes(q)||u.email.toLowerCase().includes(q)||u.id.toLowerCase().includes(q)
    const matchStatus=status==='ALL'||u.status===status
    const matchState=stateF==='All States'||u.state===stateF
    return matchSearch&&matchStatus&&matchState&&filterByDate(u)
  })

  const totalPages=Math.ceil(filtered.length/PER_PAGE)
  const paginated=filtered.slice((page-1)*PER_PAGE,page*PER_PAGE)

  const counts={
    ALL:scopedUsers.length,
    ACTIVE:scopedUsers.filter(u=>u.status==='ACTIVE').length,
    SUSPENDED:scopedUsers.filter(u=>u.status==='SUSPENDED').length,
    BLOCKED:scopedUsers.filter(u=>u.status==='BLOCKED').length,
    INACTIVE:scopedUsers.filter(u=>u.status==='INACTIVE').length,
  }
  const totalSpent=scopedUsers.filter(u=>u.status==='ACTIVE').reduce((a,u)=>a+u.totalSpent,0)
  const totalBookings=scopedUsers.reduce((a,u)=>a+u.bookings,0)
  const avgSpent=counts.ACTIVE>0?Math.round(totalSpent/counts.ACTIVE):0

  return (
    <div style={{ fontFamily:FONTS.body, background:'#F0EAE0', minHeight:'100vh' }}>
      {toast && <div style={{ position:'fixed', top:'20px', right:'20px', background:toast.color, color:'#fff', padding:'12px 20px', fontSize:'13px', fontWeight:700, zIndex:9999, boxShadow:'0 4px 12px rgba(0,0,0,0.2)' }}>{toast.msg}</div>}

      {/* Header */}
      <div style={{ background:'#0D1B2A', borderBottom:'2px solid #B8960C', padding:'0 20px', height:'52px', display:'flex', alignItems:'center', justifyContent:'space-between', position:'sticky', top:0, zIndex:10 }}>
        <div style={{ display:'flex', alignItems:'center', gap:'12px' }}>
          <div style={{ width:'3px', height:'16px', background:'#B8960C' }}/>
          <h1 style={{ fontSize:'13px', fontWeight:800, color:'#fff', margin:0, letterSpacing:'2px', textTransform:'uppercase' }}>Users</h1>
          <span style={{ background:'rgba(184,150,12,0.2)', color:'#B8960C', fontSize:'10px', fontWeight:800, padding:'2px 8px', border:'1px solid rgba(184,150,12,0.3)' }}>{users.length} TOTAL</span>
          <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.35)' }}>|</span>
          <span style={{ fontSize:'10px', color:'#B8960C', fontWeight:600 }}>Viewing: {scope}</span>
          {counts.BLOCKED>0 && <span style={{ background:'rgba(220,38,38,0.2)', color:'#FCA5A5', fontSize:'10px', fontWeight:800, padding:'2px 8px', border:'1px solid rgba(220,38,38,0.3)' }}>⊘ {counts.BLOCKED} BLOCKED</span>}
          {counts.SUSPENDED>0 && <span style={{ background:'rgba(234,179,8,0.2)', color:'#FDE68A', fontSize:'10px', fontWeight:800, padding:'2px 8px', border:'1px solid rgba(234,179,8,0.3)' }}>⚠ {counts.SUSPENDED} SUSPENDED</span>}
          {!hasPII && <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.3)', fontStyle:'italic' }}>PII masked</span>}
        </div>
        <div style={{ display:'flex', gap:'8px' }}>
          {hasExport
            ?<button style={{ background:'rgba(255,255,255,0.07)', border:'1px solid rgba(255,255,255,0.15)', color:'rgba(255,255,255,0.6)', padding:'6px 12px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>↓ EXPORT</button>
            :<div style={{ background:'rgba(220,38,38,0.1)', border:'1px solid rgba(220,38,38,0.2)', color:'rgba(220,38,38,0.5)', padding:'6px 12px', fontSize:'10px', fontWeight:700 }}>⊘ NO EXPORT</div>
          }
        </div>
      </div>

      <div style={{ padding:'14px 20px' }}>

        {/* Summary Strip */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:'1px', background:'#D4C9B0', border:'1px solid #D4C9B0', marginBottom:'12px' }}>
          {[
            { label:'Total Users',    value:users.length,                             color:'#B8960C' },
            { label:'Total Bookings', value:totalBookings.toLocaleString('en-IN'),    color:'#059669' },
            { label:'Total Spent',    value:`₹${totalSpent.toLocaleString('en-IN')}`, color:'#2563EB' },
            { label:'Avg Spend/User', value:`₹${avgSpent}`,                           color:'#D97706' },
          ].map(m=>(
            <div key={m.label} style={{ background:'#0D1B2A', padding:'12px 16px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <span style={{ fontSize:'11px', color:'rgba(255,255,255,0.4)' }}>{m.label}</span>
              <span style={{ fontSize:'18px', fontWeight:800, color:m.color }}>{m.value}</span>
            </div>
          ))}
        </div>

        {/* Stats Cards */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:'10px', marginBottom:'12px' }}>
          {[
            { label:'Total',     count:counts.ALL,       color:'#1A1A2E', f:'ALL'       },
            { label:'Active',    count:counts.ACTIVE,    color:'#059669', f:'ACTIVE'    },
            { label:'Suspended', count:counts.SUSPENDED, color:'#D97706', f:'SUSPENDED' },
            { label:'Blocked',   count:counts.BLOCKED,   color:'#DC2626', f:'BLOCKED'   },
            { label:'Inactive',  count:counts.INACTIVE,  color:'#374151', f:'INACTIVE'  },
          ].map(s=>(
            <div key={s.label} onClick={()=>{setStatus(s.f);setPage(1)}}
              style={{ background:status===s.f?s.color:'#fff', border:`1px solid ${s.color}30`, borderTop:`2px solid ${s.color}`, padding:'10px', cursor:'pointer', textAlign:'center' }}>
              <div style={{ fontSize:'20px', fontWeight:800, color:status===s.f?'#fff':s.color }}>{s.count}</div>
              <div style={{ fontSize:'9px', color:status===s.f?'rgba(255,255,255,0.8)':'#9E8E6E', textTransform:'uppercase', letterSpacing:'0.5px', marginTop:'2px' }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* Filters */}
        <BCard style={{ marginBottom:'12px' }}>
          <div style={{ padding:'10px 14px', display:'flex', gap:'8px', alignItems:'center', flexWrap:'wrap' }}>
            <div style={{ display:'flex', alignItems:'center', gap:'6px' }}>
              <div style={{ width:'3px', height:'14px', background:'#B8960C' }}/>
              <span style={{ fontSize:'10px', fontWeight:800, color:'#9E8E6E', letterSpacing:'1px' }}>FILTERS</span>
            </div>
            <input value={search} onChange={e=>{setSearch(e.target.value);setPage(1)}} placeholder="Search name, phone, email, user ID..."
              style={{ flex:1, minWidth:'200px', border:'1px solid #D4C9B0', padding:'6px 10px', fontSize:'12px', fontFamily:FONTS.body, outline:'none', background:'#FDFAF6' }}/>
            {[
              { val:status, set:v=>{setStatus(v);setPage(1)}, opts:STATUSES },
              { val:stateF, set:v=>{setStateF(v);setPage(1)}, opts:STATES   },
              { val:dateF,  set:v=>{setDateF(v);setPage(1)},  opts:DATES    },
            ].map((f,i)=>(
              <select key={i} value={f.val} onChange={e=>f.set(e.target.value)}
                style={{ border:'1px solid #D4C9B0', padding:'5px 8px', fontSize:'11px', color:'#6B5E3E', background:'#FDFAF6', cursor:'pointer', fontFamily:FONTS.body, outline:'none' }}>
                {f.opts.map(o=><option key={o}>{o}</option>)}
              </select>
            ))}
            <span style={{ fontSize:'11px', color:'#9E8E6E' }}>{filtered.length} results</span>
            <button onClick={()=>{setSearch('');setStatus('ALL');setStateF('All States');setDateF('All Time');setPage(1)}}
              style={{ background:'#F5F0E8', border:'1px solid #D4C9B0', color:'#9E8E6E', padding:'5px 10px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>RESET</button>
          </div>
        </BCard>

        {/* Table */}
        <BCard>
          <BCardHeader title={`User Registry (${filtered.length})`} action={
            <span style={{ fontSize:'11px', color:'#9E8E6E' }}>Page {page} of {totalPages||1}</span>
          }/>
          <div style={{ display:'grid', gridTemplateColumns:'0.6fr 1.3fr 1fr 1.4fr 0.4fr 0.5fr 0.6fr 0.8fr 0.7fr 0.8fr 0.8fr', padding:'8px 14px', background:'#F5F0E8', borderBottom:'1px solid #E8DFD0', gap:'6px' }}>
            {['ID','NAME','PHONE','EMAIL','ST','BOOKINGS','SPENT','LAST ACTIVE','VERIFY','STATUS','ACTIONS'].map(h=>(
              <span key={h} style={{ fontSize:'9px', fontWeight:800, color:'#9E8E6E', letterSpacing:'1px' }}>{h}</span>
            ))}
          </div>

          {paginated.length===0
            ?<div style={{ padding:'40px', textAlign:'center', color:'#9E8E6E' }}>No users found</div>
            :paginated.map((u,i)=>{
              const sc=STATUS_COLORS[u.status]||STATUS_COLORS.INACTIVE
              const vc=VERIFY_COLORS[u.verification]||VERIFY_COLORS.UNVERIFIED
              return (
                <div key={u.id} onClick={()=>navigate(`/app/users/${u.id}`)}
                  style={{ display:'grid', gridTemplateColumns:'0.6fr 1.3fr 1fr 1.4fr 0.4fr 0.5fr 0.6fr 0.8fr 0.7fr 0.8fr 0.8fr', padding:'10px 14px', borderBottom:'1px solid #F0EAE0', alignItems:'center', gap:'6px', background:u.status==='BLOCKED'?'#FEF2F2':u.status==='SUSPENDED'?'#FFFBEB':i%2===0?'#fff':'#FDFAF6', cursor:'pointer' }}>
                  <span style={{ fontSize:'10px', color:'#9E8E6E', fontFamily:'monospace', fontWeight:600 }}>{u.id}</span>
                  <div style={{ display:'flex', alignItems:'center', gap:'6px' }}>
                    <div style={{ width:'26px', height:'26px', background:'#0D1B2A', display:'flex', alignItems:'center', justifyContent:'center', color:'#B8960C', fontSize:'10px', fontWeight:800, flexShrink:0 }}>{u.name[0]}</div>
                    <div>
                      <div style={{ fontSize:'12px', fontWeight:700, color:'#1A1A2E' }}>{u.name}</div>
                      <div style={{ fontSize:'10px', color:'#9E8E6E' }}>{u.district}</div>
                    </div>
                  </div>
                  {/* PII Masking */}
                  <span style={{ fontSize:'11px', color:'#6B5E3E', fontFamily:'monospace' }}>{hasPII?u.phone:maskPhone(u.phone)}</span>
                  <span style={{ fontSize:'11px', color:'#6B5E3E' }}>{hasPII?u.email:maskEmail(u.email)}</span>
                  <span style={{ fontSize:'11px', fontWeight:700, color:'#B8960C' }}>{u.state}</span>
                  <span style={{ fontSize:'13px', fontWeight:700, color:'#7C3AED', textAlign:'center' }}>{u.bookings}</span>
                  <span style={{ fontSize:'11px', fontWeight:700, color:'#059669' }}>₹{u.totalSpent.toLocaleString('en-IN')}</span>
                  <span style={{ fontSize:'10px', color:u.lastActive.includes('hr')?'#059669':u.lastActive.includes('day')?'#D97706':'#9E8E6E' }}>{u.lastActive}</span>
                  <span style={{ fontSize:'9px', fontWeight:800, background:vc.bg, color:vc.color, padding:'2px 5px', display:'inline-block' }}>{vc.label}</span>
                  <span style={{ fontSize:'9px', fontWeight:800, background:sc.bg, color:sc.color, padding:'2px 5px', display:'inline-block' }}>{u.status}</span>
                  <div onClick={e=>e.stopPropagation()}>
                    {hasBlock && (
                      <button onClick={()=>setBlockModal(u)}
                        style={{ background:u.status==='BLOCKED'?'#059669':u.status==='SUSPENDED'?'#D97706':'#DC2626', color:'#fff', border:'none', padding:'4px 7px', fontSize:'9px', fontWeight:700, cursor:'pointer' }}>
                        {u.status==='BLOCKED'?'UNBLOCK':u.status==='SUSPENDED'?'UNSUSPEND':'⊘ BLOCK'}
                      </button>
                    )}
                  </div>
                </div>
              )
            })
          }

          <div style={{ padding:'12px 14px', borderTop:'1px solid #E8DFD0', display:'flex', justifyContent:'space-between', alignItems:'center', background:'#FDFAF6' }}>
            <span style={{ fontSize:'11px', color:'#9E8E6E' }}>Showing {filtered.length===0?0:((page-1)*PER_PAGE)+1}–{Math.min(page*PER_PAGE,filtered.length)} of {filtered.length}</span>
            <div style={{ display:'flex', gap:'4px' }}>
              <button onClick={()=>setPage(p=>Math.max(1,p-1))} disabled={page===1}
                style={{ background:page===1?'#F5F0E8':'#1A1A2E', color:page===1?'#C4B49A':'#fff', border:'1px solid #D4C9B0', padding:'5px 10px', fontSize:'11px', fontWeight:700, cursor:page===1?'not-allowed':'pointer' }}>← PREV</button>
              {Array.from({length:totalPages},(_,i)=>i+1).map(p=>(
                <button key={p} onClick={()=>setPage(p)} style={{ background:p===page?'#B8960C':'#fff', color:p===page?'#fff':'#6B5E3E', border:'1px solid #D4C9B0', padding:'5px 10px', fontSize:'11px', fontWeight:700, cursor:'pointer' }}>{p}</button>
              ))}
              <button onClick={()=>setPage(p=>Math.min(totalPages,p+1))} disabled={page===totalPages||totalPages===0}
                style={{ background:(page===totalPages||totalPages===0)?'#F5F0E8':'#1A1A2E', color:(page===totalPages||totalPages===0)?'#C4B49A':'#fff', border:'1px solid #D4C9B0', padding:'5px 10px', fontSize:'11px', fontWeight:700, cursor:(page===totalPages||totalPages===0)?'not-allowed':'pointer' }}>NEXT →</button>
            </div>
          </div>
        </BCard>
      </div>

      <div style={{ background:'#0D1B2A', borderTop:'2px solid #B8960C', padding:'10px 20px', display:'flex', justifyContent:'space-between', marginTop:'14px' }}>
        <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.3)' }}>ZEMISH USER REGISTRY v2.0.0</span>
        <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.3)' }}>NATIONAL COMMAND CENTER</span>
      </div>

      {blockModal && <BlockModal user={blockModal} onConfirm={handleBlockConfirm} onCancel={()=>setBlockModal(null)}/>}
    </div>
  )
}