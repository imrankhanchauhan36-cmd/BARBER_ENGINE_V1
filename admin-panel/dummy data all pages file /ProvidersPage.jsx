import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FONTS } from '../../config/brand'
import useAuthStore from '../../store/authStore'

const ADMIN_LEVELS = { SUPER_ADMIN:'SUPER_ADMIN', INDIA_ADMIN:'INDIA_ADMIN', STATE_ADMIN:'STATE_ADMIN', DISTRICT_ADMIN:'DISTRICT_ADMIN' }
const canExport    = (l) => [ADMIN_LEVELS.SUPER_ADMIN, ADMIN_LEVELS.INDIA_ADMIN, ADMIN_LEVELS.STATE_ADMIN].includes(l)
const canSuspend   = (l) => [ADMIN_LEVELS.SUPER_ADMIN, ADMIN_LEVELS.INDIA_ADMIN, ADMIN_LEVELS.STATE_ADMIN].includes(l)
const canViewPII   = (l) => [ADMIN_LEVELS.SUPER_ADMIN, ADMIN_LEVELS.INDIA_ADMIN].includes(l)

const maskPhone = (p='') => p&&p.length>=4 ? p.slice(0,2)+'******'+p.slice(-2) : '******'
const maskEmail = (e='') => { if(!e||!e.includes('@')) return '***@***'; const [u,d]=e.split('@'); return u.slice(0,2)+'***@'+d }

const PROVIDERS_DATA = [
  { id:'PRV001', name:'Salman Khan',    phone:'9971038586', email:'salman@gmail.com',   state:'UP', district:'Hapur',       salons:1, activeSalons:1, totalBookings:842,  totalRevenue:184500, joinedAt:'2024-02-01', status:'ACTIVE',   kyc:'VERIFIED',   lastActive:'2 hrs ago'   },
  { id:'PRV002', name:'Priya Verma',    phone:'9812345678', email:'priya@studio.com',   state:'UP', district:'Lucknow',     salons:2, activeSalons:2, totalBookings:1280, totalRevenue:284500, joinedAt:'2024-03-01', status:'ACTIVE',   kyc:'VERIFIED',   lastActive:'Yesterday'   },
  { id:'PRV003', name:'Vikas Yadav',    phone:'9812378456', email:'vikas@barber.com',   state:'MH', district:'Mumbai',      salons:1, activeSalons:0, totalBookings:350,  totalRevenue:42000,  joinedAt:'2024-01-15', status:'SUSPENDED',kyc:'VERIFIED',   lastActive:'7 days ago'  },
  { id:'PRV004', name:'Neha Sharma',    phone:'9845678901', email:'neha@salon.com',     state:'DL', district:'South Delhi', salons:3, activeSalons:3, totalBookings:2180, totalRevenue:520000, joinedAt:'2023-12-01', status:'ACTIVE',   kyc:'VERIFIED',   lastActive:'1 hr ago'    },
  { id:'PRV005', name:'Raj Patel',      phone:'9856789123', email:'raj@style.com',      state:'GJ', district:'Ahmedabad',   salons:1, activeSalons:1, totalBookings:420,  totalRevenue:84000,  joinedAt:'2024-05-01', status:'ACTIVE',   kyc:'PENDING',    lastActive:'3 hrs ago'   },
  { id:'PRV006', name:'Kavita Singh',   phone:'9867890234', email:'kavita@glow.com',    state:'RJ', district:'Jaipur',      salons:2, activeSalons:1, totalBookings:780,  totalRevenue:148000, joinedAt:'2024-04-01', status:'ACTIVE',   kyc:'VERIFIED',   lastActive:'2 days ago'  },
  { id:'PRV007', name:'Rohit Mehta',    phone:'9878901345', email:'rohit@cuts.com',     state:'KA', district:'Bengaluru',   salons:1, activeSalons:1, totalBookings:640,  totalRevenue:128000, joinedAt:'2024-06-01', status:'ACTIVE',   kyc:'VERIFIED',   lastActive:'4 hrs ago'   },
  { id:'PRV008', name:'Sunita Nair',    phone:'9889012456', email:'sunita@bella.com',   state:'KL', district:'Kochi',       salons:1, activeSalons:1, totalBookings:480,  totalRevenue:96000,  joinedAt:'2024-07-01', status:'ACTIVE',   kyc:'VERIFIED',   lastActive:'Yesterday'   },
  { id:'PRV009', name:'Deepak Kumar',   phone:'9890123567', email:'deepak@fade.com',    state:'TN', district:'Chennai',     salons:1, activeSalons:0, totalBookings:280,  totalRevenue:56000,  joinedAt:'2024-08-01', status:'INACTIVE', kyc:'REJECTED',   lastActive:'30 days ago' },
  { id:'PRV010', name:'Anjali Gupta',   phone:'9901234678', email:'anjali@luxe.com',    state:'MP', district:'Bhopal',      salons:1, activeSalons:1, totalBookings:180,  totalRevenue:36000,  joinedAt:'2024-09-01', status:'ACTIVE',   kyc:'PENDING',    lastActive:'5 hrs ago'   },
]

const STATUS_COLORS = {
  ACTIVE:    { bg:'#D1FAE5', color:'#065F46' },
  SUSPENDED: { bg:'#FEF9C3', color:'#92400E' },
  INACTIVE:  { bg:'#F3F4F6', color:'#374151' },
  BLOCKED:   { bg:'#FEE2E2', color:'#991B1B' },
}
const KYC_COLORS = {
  VERIFIED: { bg:'#D1FAE5', color:'#065F46' },
  PENDING:  { bg:'#FEF9C3', color:'#92400E' },
  REJECTED: { bg:'#FEE2E2', color:'#991B1B' },
}

const ALL_STATES = ['All States', ...new Set(PROVIDERS_DATA.map(p=>p.state))]
const STATUSES = ['ALL','ACTIVE','SUSPENDED','INACTIVE','BLOCKED']
const KYC_LIST = ['ALL','VERIFIED','PENDING','REJECTED']

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

export default function ProvidersPage() {
  const navigate   = useNavigate()
  const admin      = useAuthStore(s=>s.admin)
  const adminLevel = admin?.adminLevel||ADMIN_LEVELS.SUPER_ADMIN
  const hasExport  = canExport(adminLevel)
  const hasSuspend = canSuspend(adminLevel)
  const hasPII     = canViewPII(adminLevel)

  // ✅ Fix 4 — STATE_ADMIN sees only own state in dropdown
  const stateOptions = adminLevel===ADMIN_LEVELS.STATE_ADMIN && admin?.stateRef
    ? ['All States', admin.stateRef]
    : ALL_STATES

  const scope = adminLevel===ADMIN_LEVELS.STATE_ADMIN?'YOUR STATE':adminLevel===ADMIN_LEVELS.DISTRICT_ADMIN?'YOUR DISTRICT':'PAN INDIA'

  const [search,  setSearch]   = useState('')
  const [status,  setStatus]   = useState('ALL')
  const [kyc,     setKyc]      = useState('ALL')
  const [stateF,  setStateF]   = useState('All States')
  const [page,    setPage]     = useState(1)
  const [toast,   setToast]    = useState(null)
  const [providers,setProviders]= useState(PROVIDERS_DATA)
  const PER_PAGE = 8

  const showToast = (msg,color) => { setToast({msg,color}); setTimeout(()=>setToast(null),3000) }

  // ✅ Fix 3 — Audit trail on suspend/activate
  const handleSuspend = (p) => {
    const isSuspended = p.status==='SUSPENDED'
    const newStatus   = isSuspended ? 'ACTIVE' : 'SUSPENDED'
    const auditEntry  = {
      action: isSuspended ? 'PROVIDER_ACTIVATED' : 'PROVIDER_SUSPENDED',
      by:     adminLevel,
      date:   new Date().toLocaleString('en-IN',{hour12:false}),
    }
    setProviders(prev=>prev.map(pr=>pr.id===p.id
      ? { ...pr, status:newStatus, _audit:[auditEntry,...(pr._audit||[])] }
      : pr
    ))
    showToast(isSuspended?`✓ ${p.name} activated`:`⚠ ${p.name} suspended`, isSuspended?'#059669':'#D97706')
  }

  // DISTRICT_ADMIN → access denied
  if (adminLevel===ADMIN_LEVELS.DISTRICT_ADMIN) {
    return (
      <div style={{ fontFamily:FONTS.body, background:'#F0EAE0', minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center' }}>
        <div style={{ background:'#fff', border:'2px solid #DC2626', padding:'40px', textAlign:'center', maxWidth:'400px' }}>
          <div style={{ fontSize:'40px', marginBottom:'16px' }}>🔒</div>
          <div style={{ fontSize:'16px', fontWeight:800, color:'#1A1A2E', marginBottom:'8px' }}>Access Denied</div>
          <div style={{ fontSize:'13px', color:'#9E8E6E', marginBottom:'16px' }}>DISTRICT_ADMIN does not have access to Providers module.</div>
          <div style={{ fontSize:'11px', color:'#DC2626', fontWeight:600 }}>Required: SUPER_ADMIN / INDIA_ADMIN / STATE_ADMIN</div>
        </div>
      </div>
    )
  }

  // ✅ Fix 1 — Secure STATE_ADMIN scope (no stateRef fallback)
  const scopedProviders = adminLevel===ADMIN_LEVELS.STATE_ADMIN
    ? providers.filter(p => admin?.stateRef && p.state===admin.stateRef)
    : providers

  const filtered = scopedProviders.filter(p=>{
    const q=search.toLowerCase()
    const matchSearch = !search||p.name.toLowerCase().includes(q)||p.phone.includes(q)||p.email.toLowerCase().includes(q)||p.id.toLowerCase().includes(q)
    const matchStatus = status==='ALL'||p.status===status
    const matchKyc    = kyc==='ALL'||p.kyc===kyc
    const matchState  = stateF==='All States'||p.state===stateF
    return matchSearch&&matchStatus&&matchKyc&&matchState
  })

  const totalPages = Math.ceil(filtered.length/PER_PAGE)
  const paginated  = filtered.slice((page-1)*PER_PAGE,page*PER_PAGE)

  const counts = {
    ALL:       scopedProviders.length,
    ACTIVE:    scopedProviders.filter(p=>p.status==='ACTIVE').length,
    SUSPENDED: scopedProviders.filter(p=>p.status==='SUSPENDED').length,
    INACTIVE:  scopedProviders.filter(p=>p.status==='INACTIVE').length,
    BLOCKED:   scopedProviders.filter(p=>p.status==='BLOCKED').length,
  }
  const kycPending  = scopedProviders.filter(p=>p.kyc==='PENDING').length
  const totalRevenue= scopedProviders.reduce((a,p)=>a+p.totalRevenue,0)
  const totalSalons = scopedProviders.reduce((a,p)=>a+p.salons,0)

  return (
    <div style={{ fontFamily:FONTS.body, background:'#F0EAE0', minHeight:'100vh' }}>

      {toast && <div style={{ position:'fixed', top:'20px', right:'20px', background:toast.color, color:'#fff', padding:'12px 20px', fontSize:'13px', fontWeight:700, zIndex:9999, boxShadow:'0 4px 12px rgba(0,0,0,0.2)' }}>{toast.msg}</div>}

      {/* Header */}
      <div style={{ background:'#0D1B2A', borderBottom:'2px solid #B8960C', padding:'0 20px', height:'52px', display:'flex', alignItems:'center', justifyContent:'space-between', position:'sticky', top:0, zIndex:10 }}>
        <div style={{ display:'flex', alignItems:'center', gap:'12px' }}>
          <div style={{ width:'3px', height:'16px', background:'#B8960C' }}/>
          <h1 style={{ fontSize:'13px', fontWeight:800, color:'#fff', margin:0, letterSpacing:'2px', textTransform:'uppercase' }}>Providers</h1>
          <span style={{ background:'rgba(184,150,12,0.2)', color:'#B8960C', fontSize:'10px', fontWeight:800, padding:'2px 8px', border:'1px solid rgba(184,150,12,0.3)' }}>{scopedProviders.length} TOTAL</span>
          <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.35)' }}>|</span>
          <span style={{ fontSize:'10px', color:'#B8960C', fontWeight:600 }}>Viewing: {scope}</span>
          {kycPending>0 && <span style={{ background:'rgba(217,119,6,0.2)', color:'#FDE68A', fontSize:'10px', fontWeight:800, padding:'2px 8px', border:'1px solid rgba(217,119,6,0.3)' }}>⚠ {kycPending} KYC PENDING</span>}
          {counts.SUSPENDED>0 && <span style={{ background:'rgba(220,38,38,0.2)', color:'#FCA5A5', fontSize:'10px', fontWeight:800, padding:'2px 8px', border:'1px solid rgba(220,38,38,0.3)' }}>⊘ {counts.SUSPENDED} SUSPENDED</span>}
          {!hasPII && <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.3)', fontStyle:'italic' }}>PII masked</span>}
        </div>
        <div style={{ display:'flex', gap:'8px' }}>
          <button onClick={()=>navigate('/app/kyc')} style={{ background:'rgba(217,119,6,0.15)', border:'1px solid rgba(217,119,6,0.4)', color:'#FDE68A', padding:'6px 12px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>KYC QUEUE ▸</button>
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
            { label:'Total Providers', value:scopedProviders.length,                        color:'#B8960C' },
            { label:'Total Salons',    value:totalSalons,                                   color:'#7C3AED' },
            { label:'Total Revenue',   value:`₹${(totalRevenue/100000).toFixed(1)}L`,       color:'#059669' },
            { label:'KYC Pending',     value:kycPending,                                    color:'#D97706' },
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
            { label:'Inactive',  count:counts.INACTIVE,  color:'#374151', f:'INACTIVE'  },
            { label:'Blocked',   count:counts.BLOCKED,   color:'#DC2626', f:'BLOCKED'   },
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
            <input value={search} onChange={e=>{setSearch(e.target.value);setPage(1)}} placeholder="Search name, phone, email, provider ID..."
              style={{ flex:1, minWidth:'200px', border:'1px solid #D4C9B0', padding:'6px 10px', fontSize:'12px', fontFamily:FONTS.body, outline:'none', background:'#FDFAF6' }}/>
            {[
              { val:status, set:v=>{setStatus(v);setPage(1)}, opts:STATUSES  },
              { val:kyc,    set:v=>{setKyc(v);setPage(1)},    opts:KYC_LIST  },
              { val:stateF, set:v=>{setStateF(v);setPage(1)}, opts:stateOptions },
            ].map((f,i)=>(
              <select key={i} value={f.val} onChange={e=>f.set(e.target.value)}
                style={{ border:'1px solid #D4C9B0', padding:'5px 8px', fontSize:'11px', color:'#6B5E3E', background:'#FDFAF6', cursor:'pointer', fontFamily:FONTS.body, outline:'none' }}>
                {f.opts.map(o=><option key={o}>{o}</option>)}
              </select>
            ))}
            <span style={{ fontSize:'11px', color:'#9E8E6E' }}>{filtered.length} results</span>
            <button onClick={()=>{setSearch('');setStatus('ALL');setKyc('ALL');setStateF('All States');setPage(1)}}
              style={{ background:'#F5F0E8', border:'1px solid #D4C9B0', color:'#9E8E6E', padding:'5px 10px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>RESET</button>
          </div>
        </BCard>

        {/* Table */}
        <BCard>
          <BCardHeader title={`Provider Registry (${filtered.length})`} action={
            <span style={{ fontSize:'11px', color:'#9E8E6E' }}>Page {page} of {totalPages||1}</span>
          }/>
          <div style={{ display:'grid', gridTemplateColumns:'0.7fr 1.3fr 1fr 1.4fr 0.4fr 0.5fr 0.6fr 0.8fr 0.7fr 0.7fr 0.7fr 0.8fr', padding:'8px 14px', background:'#F5F0E8', borderBottom:'1px solid #E8DFD0', gap:'6px' }}>
            {['ID','NAME','PHONE','EMAIL','ST','SALONS','REVENUE','LAST ACTIVE','KYC','STATUS','JOINED','ACTIONS'].map(h=>(
              <span key={h} style={{ fontSize:'9px', fontWeight:800, color:'#9E8E6E', letterSpacing:'1px' }}>{h}</span>
            ))}
          </div>

          {paginated.length===0
            ?<div style={{ padding:'40px', textAlign:'center', color:'#9E8E6E' }}>No providers found</div>
            :paginated.map((p,i)=>{
              const sc=STATUS_COLORS[p.status]||STATUS_COLORS.INACTIVE
              const kc=KYC_COLORS[p.kyc]||KYC_COLORS.PENDING
              return (
                <div key={p.id} onClick={()=>navigate(`/app/providers/${p.id}`)}
                  style={{ display:'grid', gridTemplateColumns:'0.7fr 1.3fr 1fr 1.4fr 0.4fr 0.5fr 0.6fr 0.8fr 0.7fr 0.7fr 0.7fr 0.8fr', padding:'10px 14px', borderBottom:'1px solid #F0EAE0', alignItems:'center', gap:'6px', background:p.status==='SUSPENDED'?'#FFFBEB':i%2===0?'#fff':'#FDFAF6', cursor:'pointer' }}>
                  <span style={{ fontSize:'10px', color:'#9E8E6E', fontFamily:'monospace', fontWeight:600 }}>{p.id}</span>
                  <div style={{ display:'flex', alignItems:'center', gap:'6px' }}>
                    <div style={{ width:'26px', height:'26px', background:'#0D1B2A', display:'flex', alignItems:'center', justifyContent:'center', color:'#B8960C', fontSize:'10px', fontWeight:800, flexShrink:0 }}>{p.name[0]}</div>
                    <div>
                      <div style={{ fontSize:'12px', fontWeight:700, color:'#1A1A2E' }}>{p.name}</div>
                      <div style={{ fontSize:'10px', color:'#9E8E6E' }}>{p.district}</div>
                    </div>
                  </div>
                  <span style={{ fontSize:'11px', color:'#6B5E3E', fontFamily:'monospace' }}>{hasPII?p.phone:maskPhone(p.phone)}</span>
                  <span style={{ fontSize:'11px', color:'#6B5E3E' }}>{hasPII?p.email:maskEmail(p.email)}</span>
                  <span style={{ fontSize:'11px', fontWeight:700, color:'#B8960C' }}>{p.state}</span>
                  <div style={{ textAlign:'center' }}>
                    <div style={{ fontSize:'13px', fontWeight:800, color:'#7C3AED' }}>{p.salons}</div>
                    <div style={{ fontSize:'9px', color:'#9E8E6E' }}>{p.activeSalons} active</div>
                  </div>
                  <span style={{ fontSize:'11px', fontWeight:700, color:'#059669' }}>₹{(p.totalRevenue/1000).toFixed(0)}K</span>
                  <span style={{ fontSize:'10px', color:p.lastActive.includes('hr')?'#059669':p.lastActive.includes('day')?'#D97706':'#9E8E6E' }}>{p.lastActive}</span>
                  <span style={{ fontSize:'9px', fontWeight:800, background:kc.bg, color:kc.color, padding:'2px 5px', display:'inline-block' }}>{p.kyc}</span>
                  <span style={{ fontSize:'9px', fontWeight:800, background:sc.bg, color:sc.color, padding:'2px 5px', display:'inline-block' }}>{p.status}</span>
                  <span style={{ fontSize:'10px', color:'#9E8E6E' }}>{p.joinedAt}</span>
                  <div onClick={e=>e.stopPropagation()} style={{ display:'flex', gap:'3px' }}>
                    <button onClick={()=>navigate(`/app/salons?provider=${p.id}`)} style={{ background:'#F5F0E8', border:'1px solid #D4C9B0', color:'#6B5E3E', padding:'4px 6px', fontSize:'9px', fontWeight:700, cursor:'pointer' }}>SALONS</button>
                    {hasSuspend && (
                      <button onClick={()=>handleSuspend(p)}
                        style={{ background:p.status==='SUSPENDED'?'#059669':'#D97706', color:'#fff', border:'none', padding:'4px 6px', fontSize:'9px', fontWeight:700, cursor:'pointer' }}>
                        {p.status==='SUSPENDED'?'ACTIVATE':'SUSPEND'}
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
        <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.3)' }}>ZEMISH PROVIDER REGISTRY v1.0.0</span>
        <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.3)' }}>NATIONAL COMMAND CENTER</span>
      </div>
    </div>
  )
}