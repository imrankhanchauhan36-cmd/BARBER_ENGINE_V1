import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FONTS } from '../../config/brand'
import useAuthStore from '../../store/authStore'

const ADMIN_LEVELS = { SUPER_ADMIN:'SUPER_ADMIN', INDIA_ADMIN:'INDIA_ADMIN', STATE_ADMIN:'STATE_ADMIN', DISTRICT_ADMIN:'DISTRICT_ADMIN' }
const canCreate    = (l) => [ADMIN_LEVELS.SUPER_ADMIN, ADMIN_LEVELS.INDIA_ADMIN].includes(l)
const canEdit      = (l) => [ADMIN_LEVELS.SUPER_ADMIN, ADMIN_LEVELS.INDIA_ADMIN].includes(l)
const canDeactivate= (l) => l === ADMIN_LEVELS.SUPER_ADMIN

const EMPLOYEES_DATA = [
  { id:'EMP000', name:'National Super Admin', email:'superadmin@zemish.in', phone:'9800000000', role:'SUPER_ADMIN',    state:null, district:null,      status:'ACTIVE',   joinedAt:'2023-01-01', lastLogin:'2026-06-23 07:00', loginCount:2840 },
  { id:'EMP001', name:'Rajesh Kumar',         email:'rajesh.kumar@zemish.in',phone:'9812345678', role:'STATE_ADMIN',    state:'UP', district:null,      status:'ACTIVE',   joinedAt:'2024-01-15', lastLogin:'2026-06-23 09:30', loginCount:842  },
  { id:'EMP002', name:'Priya Desai',          email:'priya.desai@zemish.in', phone:'9834567890', role:'STATE_ADMIN',    state:'MH', district:null,      status:'ACTIVE',   joinedAt:'2024-02-01', lastLogin:'2026-06-23 08:45', loginCount:720  },
  { id:'EMP003', name:'Vikram Singh',         email:'vikram.singh@zemish.in',phone:'9856789012', role:'DISTRICT_ADMIN', state:'UP', district:'Lucknow', status:'ACTIVE',   joinedAt:'2024-03-01', lastLogin:'2026-06-22 11:00', loginCount:580  },
  { id:'EMP004', name:'Rahul Mehta',          email:'rahul.mehta@zemish.in', phone:'9867890123', role:'DISTRICT_ADMIN', state:'UP', district:'Noida',   status:'ACTIVE',   joinedAt:'2024-03-15', lastLogin:'2026-06-23 10:15', loginCount:490  },
  { id:'EMP005', name:'Sanjay Mehta',         email:'sanjay.mehta@zemish.in',phone:'9878901234', role:'DISTRICT_ADMIN', state:'MH', district:'Mumbai',  status:'ACTIVE',   joinedAt:'2024-04-01', lastLogin:'2026-06-22 04:00', loginCount:410  },
  { id:'EMP006', name:'Amit Verma',           email:'amit.verma@zemish.in',  phone:'9889012345', role:'INDIA_ADMIN',    state:null, district:null,      status:'ACTIVE',   joinedAt:'2023-12-01', lastLogin:'2026-06-23 07:30', loginCount:1240 },
  { id:'EMP007', name:'Neha Sharma',          email:'neha.sharma@zemish.in', phone:'9890123456', role:'DISTRICT_ADMIN', state:'KA', district:'Bengaluru',status:'ACTIVE',  joinedAt:'2024-05-01', lastLogin:'2026-06-21 03:00', loginCount:320  },
  { id:'EMP008', name:'Deepak Yadav',         email:'deepak.yadav@zemish.in',phone:'9901234567', role:'DISTRICT_ADMIN', state:'RJ', district:'Jaipur',  status:'INACTIVE', joinedAt:'2024-06-01', lastLogin:'2026-05-10 09:00', loginCount:180  },
  { id:'EMP009', name:'Sunita Patel',         email:'sunita.patel@zemish.in',phone:'9812387654', role:'STATE_ADMIN',    state:'GJ', district:null,      status:'ACTIVE',   joinedAt:'2024-07-01', lastLogin:'2026-06-23 06:00', loginCount:380  },
  { id:'EMP010', name:'Ravi Kumar',           email:'ravi.kumar@zemish.in',  phone:'9823476541', role:'DISTRICT_ADMIN', state:'TN', district:'Chennai', status:'INACTIVE', joinedAt:'2024-08-01', lastLogin:'2026-04-20 10:00', loginCount:120  },
]

const ROLE_COLORS = {
  SUPER_ADMIN:    { bg:'#FEF2F2', color:'#991B1B', border:'#DC2626' },
  INDIA_ADMIN:    { bg:'#F5F3FF', color:'#5B21B6', border:'#7C3AED' },
  STATE_ADMIN:    { bg:'#EFF6FF', color:'#1D4ED8', border:'#2563EB' },
  DISTRICT_ADMIN: { bg:'#F0FDF4', color:'#065F46', border:'#059669' },
}
const STATUS_COLORS = {
  ACTIVE:   { bg:'#D1FAE5', color:'#065F46' },
  INACTIVE: { bg:'#F3F4F6', color:'#374151' },
}

const ROLES    = ['ALL','SUPER_ADMIN','INDIA_ADMIN','STATE_ADMIN','DISTRICT_ADMIN']
const STATUSES = ['ALL','ACTIVE','INACTIVE']
const STATES   = ['All States', ...new Set(EMPLOYEES_DATA.filter(e=>e.state).map(e=>e.state))]

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

export default function EmployeesPage() {
  const navigate   = useNavigate()
  const admin      = useAuthStore(s=>s.admin)
  const adminLevel = admin?.adminLevel||ADMIN_LEVELS.SUPER_ADMIN
  const hasCreate  = canCreate(adminLevel)
  const hasEdit    = canEdit(adminLevel)
  const hasDeact   = canDeactivate(adminLevel)

  // Only SUPER + INDIA can access
  if (![ADMIN_LEVELS.SUPER_ADMIN, ADMIN_LEVELS.INDIA_ADMIN].includes(adminLevel)) {
    return (
      <div style={{ fontFamily:FONTS.body, background:'#F0EAE0', minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center' }}>
        <div style={{ background:'#fff', border:'2px solid #DC2626', padding:'40px', textAlign:'center', maxWidth:'400px' }}>
          <div style={{ fontSize:'40px', marginBottom:'16px' }}>🔒</div>
          <div style={{ fontSize:'16px', fontWeight:800, color:'#1A1A2E', marginBottom:'8px' }}>Access Denied</div>
          <div style={{ fontSize:'13px', color:'#9E8E6E' }}>Only SUPER_ADMIN and INDIA_ADMIN can manage employees.</div>
        </div>
      </div>
    )
  }

  const [search,  setSearch]   = useState('')
  const [role,    setRole]     = useState('ALL')
  const [status,  setStatus]   = useState('ALL')
  const [stateF,  setStateF]   = useState('All States')
  const [page,    setPage]     = useState(1)
  const [toast,   setToast]    = useState(null)
  const [employees,setEmployees]= useState(EMPLOYEES_DATA)
  const PER_PAGE = 8

  const showToast = (msg,color) => { setToast({msg,color}); setTimeout(()=>setToast(null),3000) }

  const handleDeactivate = (e) => {
    setEmployees(prev=>prev.map(emp=>emp.id===e.id?{ ...emp, status:emp.status==='ACTIVE'?'INACTIVE':'ACTIVE' }:emp))
    showToast(e.status==='ACTIVE'?`⊘ ${e.name} deactivated`:`✓ ${e.name} reactivated`, e.status==='ACTIVE'?'#DC2626':'#059669')
  }

  const filtered = employees.filter(e=>{
    const q=search.toLowerCase()
    const matchSearch = !search||e.name.toLowerCase().includes(q)||e.email.toLowerCase().includes(q)||e.id.toLowerCase().includes(q)
    const matchRole   = role==='ALL'||e.role===role
    const matchStatus = status==='ALL'||e.status===status
    const matchState  = stateF==='All States'||e.state===stateF
    return matchSearch&&matchRole&&matchStatus&&matchState
  })

  const totalPages = Math.ceil(filtered.length/PER_PAGE)

  // ✅ Fix 2 — Auto page reset when filtered results shrink
  useState(()=>{ if(page>totalPages&&totalPages>0) setPage(totalPages) }, [filtered.length])

  const paginated  = filtered.slice((page-1)*PER_PAGE,page*PER_PAGE)

  const counts = {
    total:    employees.length,
    active:   employees.filter(e=>e.status==='ACTIVE').length,
    inactive: employees.filter(e=>e.status==='INACTIVE').length,
    byRole: {
      INDIA_ADMIN:    employees.filter(e=>e.role==='INDIA_ADMIN').length,
      STATE_ADMIN:    employees.filter(e=>e.role==='STATE_ADMIN').length,
      DISTRICT_ADMIN: employees.filter(e=>e.role==='DISTRICT_ADMIN').length,
    }
  }

  return (
    <div style={{ fontFamily:FONTS.body, background:'#F0EAE0', minHeight:'100vh' }}>
      {toast && <div style={{ position:'fixed', top:'20px', right:'20px', background:toast.color, color:'#fff', padding:'12px 20px', fontSize:'13px', fontWeight:700, zIndex:9999, boxShadow:'0 4px 12px rgba(0,0,0,0.2)' }}>{toast.msg}</div>}

      {/* Header */}
      <div style={{ background:'#0D1B2A', borderBottom:'2px solid #B8960C', padding:'0 20px', height:'52px', display:'flex', alignItems:'center', justifyContent:'space-between', position:'sticky', top:0, zIndex:10 }}>
        <div style={{ display:'flex', alignItems:'center', gap:'12px' }}>
          <div style={{ width:'3px', height:'16px', background:'#B8960C' }}/>
          <h1 style={{ fontSize:'13px', fontWeight:800, color:'#fff', margin:0, letterSpacing:'2px', textTransform:'uppercase' }}>Employees</h1>
          <span style={{ background:'rgba(184,150,12,0.2)', color:'#B8960C', fontSize:'10px', fontWeight:800, padding:'2px 8px', border:'1px solid rgba(184,150,12,0.3)' }}>{employees.length} TOTAL</span>
          {counts.inactive>0 && <span style={{ background:'rgba(220,38,38,0.2)', color:'#FCA5A5', fontSize:'10px', fontWeight:800, padding:'2px 8px', border:'1px solid rgba(220,38,38,0.3)' }}>⊘ {counts.inactive} INACTIVE</span>}
        </div>
        <div style={{ display:'flex', gap:'8px' }}>
          <button onClick={()=>navigate('/app/roles')} style={{ background:'rgba(124,58,237,0.15)', border:'1px solid rgba(124,58,237,0.4)', color:'#C4B5FD', padding:'6px 12px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>ROLES ▸</button>
          {hasCreate && (
            <button onClick={()=>navigate('/app/employees/create')} style={{ background:'#B8960C', border:'none', color:'#0D1B2A', padding:'6px 14px', fontSize:'10px', fontWeight:800, cursor:'pointer' }}>+ ADD EMPLOYEE</button>
          )}
        </div>
      </div>

      <div style={{ padding:'14px 20px' }}>

        {/* Summary Strip */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:'1px', background:'#D4C9B0', border:'1px solid #D4C9B0', marginBottom:'12px' }}>
          {[
            { label:'Total Employees',  value:counts.total,                   color:'#B8960C' },
            { label:'Active',           value:counts.active,                  color:'#059669' },
            { label:'India Admins',     value:counts.byRole.INDIA_ADMIN,      color:'#7C3AED' },
            { label:'State Admins',     value:counts.byRole.STATE_ADMIN,      color:'#2563EB' },
            { label:'District Admins',  value:counts.byRole.DISTRICT_ADMIN,   color:'#059669' },
          ].map(m=>(
            <div key={m.label} style={{ background:'#0D1B2A', padding:'12px 16px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <span style={{ fontSize:'11px', color:'rgba(255,255,255,0.4)' }}>{m.label}</span>
              <span style={{ fontSize:'18px', fontWeight:800, color:m.color }}>{m.value}</span>
            </div>
          ))}
        </div>

        {/* Stats Cards */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:'10px', marginBottom:'12px' }}>
          {[
            { label:'All',      count:employees.length,    color:'#1A1A2E', f:'ALL'      },
            { label:'Active',   count:counts.active,       color:'#059669', f:'ACTIVE'   },
            { label:'Inactive', count:counts.inactive,     color:'#DC2626', f:'INACTIVE' },
            { label:'State Admins',count:counts.byRole.STATE_ADMIN,color:'#2563EB',f:'STATE_ADMIN'},
          ].map(s=>(
            <div key={s.label} onClick={()=>{s.f==='STATE_ADMIN'?setRole(s.f):setStatus(s.f);setPage(1)}}
              style={{ background:'#fff', border:`1px solid ${s.color}30`, borderTop:`2px solid ${s.color}`, padding:'10px', cursor:'pointer', textAlign:'center' }}>
              <div style={{ fontSize:'20px', fontWeight:800, color:s.color }}>{s.count}</div>
              <div style={{ fontSize:'9px', color:'#9E8E6E', textTransform:'uppercase', letterSpacing:'0.5px', marginTop:'2px' }}>{s.label}</div>
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
            <input value={search} onChange={e=>{setSearch(e.target.value);setPage(1)}} placeholder="Search name, email, employee ID..."
              style={{ flex:1, minWidth:'200px', border:'1px solid #D4C9B0', padding:'6px 10px', fontSize:'12px', fontFamily:FONTS.body, outline:'none', background:'#FDFAF6' }}/>
            {[
              { val:role,   set:v=>{setRole(v);setPage(1)},   opts:ROLES    },
              { val:status, set:v=>{setStatus(v);setPage(1)}, opts:STATUSES },
              { val:stateF, set:v=>{setStateF(v);setPage(1)}, opts:STATES   },
            ].map((f,i)=>(
              <select key={i} value={f.val} onChange={e=>f.set(e.target.value)}
                style={{ border:'1px solid #D4C9B0', padding:'5px 8px', fontSize:'11px', color:'#6B5E3E', background:'#FDFAF6', cursor:'pointer', fontFamily:FONTS.body, outline:'none' }}>
                {f.opts.map(o=><option key={o}>{o}</option>)}
              </select>
            ))}
            <span style={{ fontSize:'11px', color:'#9E8E6E' }}>{filtered.length} results</span>
            <button onClick={()=>{setSearch('');setRole('ALL');setStatus('ALL');setStateF('All States');setPage(1)}}
              style={{ background:'#F5F0E8', border:'1px solid #D4C9B0', color:'#9E8E6E', padding:'5px 10px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>RESET</button>
          </div>
        </BCard>

        {/* Table */}
        <BCard>
          <BCardHeader title={`Employee Registry (${filtered.length})`} action={
            <span style={{ fontSize:'11px', color:'#9E8E6E' }}>Page {page} of {totalPages||1}</span>
          }/>
          <div style={{ display:'grid', gridTemplateColumns:'0.7fr 1.4fr 1.8fr 1fr 1fr 0.6fr 0.9fr 0.7fr 0.8fr', padding:'8px 14px', background:'#F5F0E8', borderBottom:'1px solid #E8DFD0', gap:'8px' }}>
            {['EMP ID','NAME','EMAIL','ROLE','ASSIGNED TO','LOGINS','LAST LOGIN','STATUS','ACTIONS'].map(h=>(
              <span key={h} style={{ fontSize:'9px', fontWeight:800, color:'#9E8E6E', letterSpacing:'1px' }}>{h}</span>
            ))}
          </div>

          {paginated.length===0
            ?<div style={{ padding:'40px', textAlign:'center', color:'#9E8E6E' }}>No employees found</div>
            :paginated.map((e,i)=>{
              const rc=ROLE_COLORS[e.role]||ROLE_COLORS.DISTRICT_ADMIN
              const sc=STATUS_COLORS[e.status]||STATUS_COLORS.INACTIVE
              const assignedTo = e.role==='INDIA_ADMIN'?'PAN India':e.role==='STATE_ADMIN'?`${e.state}`:`${e.district}, ${e.state}`
              return (
                <div key={e.id} onClick={()=>navigate(`/app/employees/${e.id}`)}
                  style={{ display:'grid', gridTemplateColumns:'0.7fr 1.4fr 1.8fr 1fr 1fr 0.6fr 0.9fr 0.7fr 0.8fr', padding:'10px 14px', borderBottom:'1px solid #F0EAE0', alignItems:'center', gap:'8px', background:e.status==='INACTIVE'?'#F5F0E8':i%2===0?'#fff':'#FDFAF6', cursor:'pointer' }}>
                  <span style={{ fontSize:'10px', color:'#9E8E6E', fontFamily:'monospace', fontWeight:600 }}>{e.id}</span>
                  <div style={{ display:'flex', alignItems:'center', gap:'6px' }}>
                    <div style={{ width:'26px', height:'26px', background:'#0D1B2A', display:'flex', alignItems:'center', justifyContent:'center', color:'#B8960C', fontSize:'10px', fontWeight:800, flexShrink:0 }}>{e.name[0]}</div>
                    <div>
                      <div style={{ fontSize:'12px', fontWeight:700, color:'#1A1A2E' }}>{e.name}</div>
                      <div style={{ fontSize:'10px', color:'#9E8E6E' }}>{e.phone}</div>
                    </div>
                  </div>
                  <span style={{ fontSize:'11px', color:'#6B5E3E' }}>{e.email}</span>
                  <span style={{ fontSize:'9px', fontWeight:800, background:rc.bg, color:rc.color, border:`1px solid ${rc.border}`, padding:'2px 6px', display:'inline-block' }}>{e.role.replace('_',' ')}</span>
                  <span style={{ fontSize:'11px', color:'#6B5E3E' }}>{assignedTo}</span>
                  <span style={{ fontSize:'12px', fontWeight:700, color:'#7C3AED', textAlign:'center' }}>{e.loginCount}</span>
                  <span style={{ fontSize:'10px', color:'#9E8E6E' }}>{e.lastLogin.split(' ')[0]}</span>
                  <span style={{ fontSize:'9px', fontWeight:800, background:sc.bg, color:sc.color, padding:'2px 6px', display:'inline-block' }}>{e.status}</span>
                  <div onClick={ev=>ev.stopPropagation()} style={{ display:'flex', gap:'3px' }}>
                    {hasEdit && (
                      <button onClick={()=>navigate(`/app/employees/${e.id}`)} style={{ background:'#F5F0E8', border:'1px solid #D4C9B0', color:'#6B5E3E', padding:'4px 6px', fontSize:'9px', fontWeight:700, cursor:'pointer' }}>EDIT</button>
                    )}
                    {hasDeact && (
                      <button onClick={()=>handleDeactivate(e)}
                        style={{ background:e.status==='ACTIVE'?'#FEF2F2':'#F0FDF4', border:`1px solid ${e.status==='ACTIVE'?'#DC2626':'#059669'}`, color:e.status==='ACTIVE'?'#DC2626':'#059669', padding:'4px 6px', fontSize:'9px', fontWeight:700, cursor:'pointer' }}>
                        {e.status==='ACTIVE'?'⊘':'✓'}
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
        <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.3)' }}>ZEMISH EMPLOYEE REGISTRY v1.0.0</span>
        <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.3)' }}>NATIONAL COMMAND CENTER</span>
      </div>
    </div>
  )
}