import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FONTS } from '../../config/brand'
import useAuthStore from '../../store/authStore'

const ADMIN_LEVELS = { SUPER_ADMIN:'SUPER_ADMIN', INDIA_ADMIN:'INDIA_ADMIN', STATE_ADMIN:'STATE_ADMIN', DISTRICT_ADMIN:'DISTRICT_ADMIN' }
const canExport    = (l) => [ADMIN_LEVELS.SUPER_ADMIN, ADMIN_LEVELS.INDIA_ADMIN].includes(l)

const INITIAL_AUDIT_DATA = [
  { id:'AUD001', action:'KYC_APPROVED',        module:'KYC',       actor:'Amit Verma',     actorRole:'INDIA_ADMIN',    target:'PRV004 — Neha Sharma',       state:'DL', date:'2026-06-23 11:00', severity:'INFO',     ip:'103.21.45.12',  device:'Chrome',  os:'Windows 11', oldValue:'PENDING',  newValue:'APPROVED' },
  { id:'AUD002', action:'USER_BLOCKED',         module:'Users',     actor:'Amit Verma',     actorRole:'INDIA_ADMIN',    target:'USR007 — Suresh Kumar',      state:'MH', date:'2026-06-23 10:30', severity:'WARNING',  ip:'103.21.45.12',  device:'Chrome',  os:'Windows 11', oldValue:'ACTIVE',   newValue:'BLOCKED'  },
  { id:'AUD003', action:'WALLET_FROZEN',        module:'Finance',   actor:'Super Admin',    actorRole:'SUPER_ADMIN',    target:'WL005 — The Barber Shop',    state:'MH', date:'2026-06-22 14:00', severity:'CRITICAL', ip:'182.68.10.4',   device:'Edge',     os:'Windows 11', oldValue:'ACTIVE',   newValue:'FROZEN'   },
  { id:'AUD004', action:'DISPUTE_RESOLVED',     module:'Disputes',  actor:'Rajesh Kumar',   actorRole:'STATE_ADMIN',    target:'DSP002 — Refund Delay',      state:'GJ', date:'2026-06-22 12:00', severity:'INFO',     ip:'117.99.32.7',   device:'Safari',   os:'macOS',      oldValue:'OPEN',     newValue:'RESOLVED' },
  { id:'AUD005', action:'PROVIDER_SUSPENDED',   module:'Providers', actor:'Super Admin',    actorRole:'SUPER_ADMIN',    target:'PRV003 — Vikas Yadav',       state:'MH', date:'2026-06-22 02:00', severity:'CRITICAL', ip:'182.68.10.4',   device:'Edge',     os:'Windows 11', oldValue:'ACTIVE',   newValue:'SUSPENDED'},
  { id:'AUD006', action:'KYC_REJECTED',         module:'KYC',       actor:'Super Admin',    actorRole:'SUPER_ADMIN',    target:'KYC005 — Arjun Das',         state:'WB', date:'2026-06-21 11:00', severity:'WARNING',  ip:'182.68.10.4',   device:'Edge',     os:'Windows 11', oldValue:'PENDING',  newValue:'REJECTED' },
  { id:'AUD007', action:'EMPLOYEE_DEACTIVATED', module:'Employees', actor:'Super Admin',    actorRole:'SUPER_ADMIN',    target:'EMP008 — Deepak Yadav',      state:'RJ', date:'2026-06-21 02:00', severity:'WARNING',  ip:'182.68.10.4',   device:'Edge',     os:'Windows 11', oldValue:'ACTIVE',   newValue:'DEACTIVE' },
  { id:'AUD008', action:'SALON_APPROVED',       module:'Approvals', actor:'Rajesh Kumar',   actorRole:'STATE_ADMIN',    target:'SAL024 — Crown Cuts',        state:'UP', date:'2026-06-21 11:00', severity:'INFO',     ip:'117.99.32.7',   device:'Safari',   os:'macOS',      oldValue:'PENDING',  newValue:'APPROVED' },
  { id:'AUD009', action:'TERRITORY_CLOSED',     module:'Location',  actor:'Super Admin',    actorRole:'SUPER_ADMIN',    target:'ST014 — Haryana',            state:'HR', date:'2026-06-20 09:00', severity:'CRITICAL', ip:'182.68.10.4',   device:'Edge',     os:'Windows 11', oldValue:'OPEN',     newValue:'CLOSED'   },
  { id:'AUD010', action:'ROLE_CHANGED',         module:'Employees', actor:'Super Admin',    actorRole:'SUPER_ADMIN',    target:'EMP003 — Vikram Singh',      state:'UP', date:'2026-06-20 10:00', severity:'WARNING',  ip:'182.68.10.4',   device:'Edge',     os:'Windows 11', oldValue:'DISTRICT_ADMIN', newValue:'STATE_ADMIN' },
  { id:'AUD011', action:'BULK_EXPORT',          module:'Finance',   actor:'Amit Verma',     actorRole:'INDIA_ADMIN',    target:'Finance Report — Jun 2026',  state:null, date:'2026-06-19 09:00', severity:'INFO',     ip:'103.21.45.12',  device:'Chrome',  os:'Windows 11', oldValue:'-',        newValue:'-'        },
  { id:'AUD012', action:'FAILED_LOGIN',         module:'Auth',      actor:'Unknown',        actorRole:'UNKNOWN',        target:'EMP006 — Amit Verma',        state:null, date:'2026-06-20 07:00', severity:'WARNING',  ip:'45.112.8.91',   device:'Chrome',  os:'Android',    oldValue:'-',        newValue:'-'        },
  { id:'AUD013', action:'DISPUTE_ASSIGNED',     module:'Disputes',  actor:'Amit Verma',     actorRole:'INDIA_ADMIN',    target:'DSP001 — No Show',           state:'MH', date:'2026-06-22 10:30', severity:'INFO',     ip:'103.21.45.12',  device:'Chrome',  os:'Windows 11', oldValue:'UNASSIGNED', newValue:'Rajesh Kumar' },
  { id:'AUD014', action:'ADMIN_ASSIGNED',       module:'Location',  actor:'Super Admin',    actorRole:'SUPER_ADMIN',    target:'ST001 — Rajesh Kumar to UP', state:'UP', date:'2026-06-18 09:00', severity:'INFO',     ip:'182.68.10.4',   device:'Edge',     os:'Windows 11', oldValue:'-',        newValue:'Rajesh Kumar' },
  { id:'AUD015', action:'REFUND_INITIATED',     module:'Finance',   actor:'Amit Verma',     actorRole:'INDIA_ADMIN',    target:'BK009 — Karan Mehta ₹150',  state:'GJ', date:'2026-06-21 05:30', severity:'INFO',     ip:'103.21.45.12',  device:'Chrome',  os:'Windows 11', oldValue:'-',        newValue:'₹150'     },
  { id:'AUD016', action:'PAYMENT_FAILED',       module:'Finance',   actor:'System',         actorRole:'SYSTEM',         target:'BK007 — Suresh Kumar',       state:'MH', date:'2026-06-22 04:08', severity:'WARNING',  ip:'-',             device:'System',  os:'Server',     oldValue:'-',        newValue:'-'        },
  { id:'AUD017', action:'BOOKING_CANCELLED',    module:'Bookings',  actor:'System',         actorRole:'SYSTEM',         target:'BK004 — Deepak Gupta',       state:'UP', date:'2026-06-22 08:55', severity:'INFO',     ip:'-',             device:'System',  os:'Server',     oldValue:'CONFIRMED', newValue:'CANCELLED' },
  { id:'AUD018', action:'SALON_REJECTED',       module:'Approvals', actor:'Rajesh Kumar',   actorRole:'STATE_ADMIN',    target:'SAL031 — Quick Cuts',        state:'UP', date:'2026-06-20 03:00', severity:'WARNING',  ip:'117.99.32.7',   device:'Safari',   os:'macOS',      oldValue:'PENDING',  newValue:'REJECTED' },
  { id:'AUD019', action:'ADMIN_LOGIN',          module:'Auth',      actor:'Rajesh Kumar',   actorRole:'STATE_ADMIN',    target:'Session started — Chrome',   state:'UP', date:'2026-06-23 09:30', severity:'INFO',     ip:'117.99.32.7',   device:'Safari',   os:'macOS',      oldValue:'-',        newValue:'-'        },
  { id:'AUD020', action:'PASSWORD_RESET',       module:'Auth',      actor:'Amit Verma',     actorRole:'INDIA_ADMIN',    target:'EMP003 — Vikram Singh',      state:'UP', date:'2026-06-19 11:00', severity:'WARNING',  ip:'103.21.45.12',  device:'Chrome',  os:'Windows 11', oldValue:'-',        newValue:'-'        },
]

const SEVERITY_COLORS = {
  CRITICAL: { bg:'#FEE2E2', color:'#991B1B', border:'#DC2626' },
  WARNING:  { bg:'#FEF9C3', color:'#92400E', border:'#D97706' },
  INFO:     { bg:'#EFF6FF', color:'#1D4ED8', border:'#2563EB' },
}
const MODULE_COLORS = {
  KYC:       '#059669', Finance:'#B8960C', Disputes:'#7C3AED',
  Providers: '#D97706', Employees:'#2563EB', Location:'#374151',
  Approvals: '#059669', Users:'#DC2626', Auth:'#DC2626', Bookings:'#2563EB',
}

const MODULES    = ['ALL','KYC','Finance','Disputes','Providers','Employees','Location','Approvals','Users','Auth','Bookings']
const SEVERITIES = ['ALL','CRITICAL','WARNING','INFO']
const ROLES      = ['ALL','SUPER_ADMIN','INDIA_ADMIN','STATE_ADMIN','SYSTEM']
const STATES_F   = ['All States','UP','MH','DL','GJ','WB','RJ','HR','KA','KL']
const DATES      = ['All Time','Today','Last 7 Days','Last 30 Days']
const TODAY='2026-06-23', LAST7='2026-06-16', LAST30='2026-05-24'
const CRITICAL_ALERT_THRESHOLD = 3

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

// Builds a compact pagination range like [1, 2, 3, '...', 50]
function getPaginationRange(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const pages = new Set([1, 2, total - 1, total, current - 1, current, current + 1])
  const valid = [...pages].filter(p => p >= 1 && p <= total).sort((a, b) => a - b)
  const result = []
  let prev = null
  for (const p of valid) {
    if (prev !== null && p - prev > 1) result.push('...')
    result.push(p)
    prev = p
  }
  return result
}

export default function AuditLogsPage() {
  const navigate   = useNavigate()
  const admin      = useAuthStore(s=>s.admin)
  const adminLevel = admin?.adminLevel||ADMIN_LEVELS.SUPER_ADMIN
  const hasExport  = canExport(adminLevel)

  if (![ADMIN_LEVELS.SUPER_ADMIN, ADMIN_LEVELS.INDIA_ADMIN].includes(adminLevel)) {
    return (
      <div style={{ fontFamily:FONTS.body, background:'#F0EAE0', minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center' }}>
        <div style={{ background:'#fff', border:'2px solid #DC2626', padding:'40px', textAlign:'center', maxWidth:'400px' }}>
          <div style={{ fontSize:'40px', marginBottom:'16px' }}>🔒</div>
          <div style={{ fontSize:'16px', fontWeight:800, color:'#1A1A2E', marginBottom:'8px' }}>Access Denied</div>
          <div style={{ fontSize:'13px', color:'#9E8E6E' }}>Only SUPER_ADMIN and INDIA_ADMIN can view Audit Logs.</div>
          <button onClick={()=>navigate(-1)} style={{ marginTop:'16px', background:'#1A1A2E', color:'#fff', border:'none', padding:'8px 16px', fontSize:'12px', fontWeight:700, cursor:'pointer' }}>← Go Back</button>
        </div>
      </div>
    )
  }

  const [auditData, setAuditData] = useState(INITIAL_AUDIT_DATA)
  const [search,   setSearch]   = useState('')
  const [module,   setModule]   = useState('ALL')
  const [severity, setSeverity] = useState('ALL')
  const [role,     setRole]     = useState('ALL')
  const [stateF,   setStateF]   = useState('All States')
  const [dateF,    setDateF]    = useState('All Time')
  const [page,     setPage]     = useState(1)
  const [selected, setSelected] = useState(null)
  const PER_PAGE = 10

  const filterByDate = (a) => {
    const d = a.date.split(' ')[0]
    if (dateF==='All Time')    return true
    if (dateF==='Today')       return d===TODAY
    if (dateF==='Last 7 Days') return d>=LAST7
    if (dateF==='Last 30 Days')return d>=LAST30
    return true
  }

  const filtered = auditData.filter(a=>{
    const q=search.toLowerCase()
    const matchSearch   = !search||a.id.toLowerCase().includes(q)||a.action.toLowerCase().includes(q)||a.actor.toLowerCase().includes(q)||a.target.toLowerCase().includes(q)
    const matchModule   = module==='ALL'  ||a.module  ===module
    const matchSeverity = severity==='ALL'||a.severity===severity
    const matchRole     = role==='ALL'    ||a.actorRole===role
    const matchState    = stateF==='All States'||a.state===stateF
    return matchSearch&&matchModule&&matchSeverity&&matchRole&&matchState&&filterByDate(a)
  })

  const totalPages = Math.ceil(filtered.length/PER_PAGE)
  const paginated  = filtered.slice((page-1)*PER_PAGE,page*PER_PAGE)
  const paginationRange = getPaginationRange(page, totalPages || 1)

  const counts = {
    total:    auditData.length,
    critical: auditData.filter(a=>a.severity==='CRITICAL').length,
    warning:  auditData.filter(a=>a.severity==='WARNING').length,
    info:     auditData.filter(a=>a.severity==='INFO').length,
  }

  const handleExport = () => {
    const ts = new Date().toISOString().slice(0,16).replace('T',' ')
    const newLog = {
      id: `AUD${String(auditData.length + 1).padStart(3,'0')}`,
      action:'AUDIT_EXPORT', module:'Finance',
      actor: admin?.name || 'Amit Verma', actorRole: adminLevel,
      target: `audit_export_${ts.slice(0,10)}.csv`,
      state:null, date: ts, severity:'INFO',
      ip:'—', device:'Chrome', os:'Windows 11', oldValue:'-', newValue:'-',
    }
    setAuditData(prev => [newLog, ...prev])
  }

  return (
    <div style={{ fontFamily:FONTS.body, background:'#F0EAE0', minHeight:'100vh' }}>

      {/* Header */}
      <div style={{ background:'#0D1B2A', borderBottom:'2px solid #B8960C', padding:'0 20px', height:'52px', display:'flex', alignItems:'center', justifyContent:'space-between', position:'sticky', top:0, zIndex:10 }}>
        <div style={{ display:'flex', alignItems:'center', gap:'12px' }}>
          <div style={{ width:'3px', height:'16px', background:'#B8960C' }}/>
          <h1 style={{ fontSize:'13px', fontWeight:800, color:'#fff', margin:0, letterSpacing:'2px', textTransform:'uppercase' }}>Audit Logs</h1>
          <span style={{ background:'rgba(184,150,12,0.2)', color:'#B8960C', fontSize:'10px', fontWeight:800, padding:'2px 8px', border:'1px solid rgba(184,150,12,0.3)' }}>{auditData.length} TOTAL</span>
          <span style={{ background:'rgba(220,38,38,0.2)', color:'#FCA5A5', fontSize:'10px', fontWeight:800, padding:'2px 8px', border:'1px solid rgba(220,38,38,0.3)' }}>⚠ IMMUTABLE</span>
          {counts.critical>0 && <span style={{ background:'#DC2626', color:'#fff', fontSize:'10px', fontWeight:800, padding:'2px 8px' }}>🔴 {counts.critical} CRITICAL</span>}
        </div>
        <div style={{ display:'flex', gap:'8px' }}>
          {hasExport && <button onClick={handleExport} style={{ background:'rgba(255,255,255,0.07)', border:'1px solid rgba(255,255,255,0.15)', color:'rgba(255,255,255,0.6)', padding:'6px 12px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>↓ EXPORT</button>}
        </div>
      </div>

      <div style={{ padding:'14px 20px' }}>

        {/* Critical Alert Banner */}
        {counts.critical > CRITICAL_ALERT_THRESHOLD && (
          <div style={{ marginBottom:'12px', padding:'10px 14px', background:'#DC2626', color:'#fff', fontSize:'12px', fontWeight:700, display:'flex', alignItems:'center', gap:'8px', border:'1px solid #991B1B' }}>
            <span style={{ fontSize:'16px' }}>⚠</span>
            High Critical Activity Detected — {counts.critical} critical events recorded. Review immediately.
          </div>
        )}

        {/* Summary Strip */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:'1px', background:'#D4C9B0', border:'1px solid #D4C9B0', marginBottom:'12px' }}>
          {[
            { label:'Total Logs',    value:counts.total,    color:'#B8960C' },
            { label:'Critical',      value:counts.critical, color:'#DC2626' },
            { label:'Warnings',      value:counts.warning,  color:'#D97706' },
            { label:'Info',          value:counts.info,     color:'#2563EB' },
          ].map(m=>(
            <div key={m.label} style={{ background:'#0D1B2A', padding:'12px 16px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <span style={{ fontSize:'11px', color:'rgba(255,255,255,0.4)' }}>{m.label}</span>
              <span style={{ fontSize:'20px', fontWeight:800, color:m.color }}>{m.value}</span>
            </div>
          ))}
        </div>

        {/* Severity cards */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:'10px', marginBottom:'12px' }}>
          {[
            { label:'Critical Events', count:counts.critical, color:'#DC2626', f:'CRITICAL', desc:'Wallet freeze, Suspensions, Territory close' },
            { label:'Warnings',        count:counts.warning,  color:'#D97706', f:'WARNING',  desc:'Blocks, Rejections, Failed logins, Role changes' },
            { label:'Info',            count:counts.info,     color:'#2563EB', f:'INFO',     desc:'Approvals, Assignments, Exports, Resolutions' },
          ].map(s=>(
            <div key={s.f} onClick={()=>{setSeverity(s.f==='ALL'?'ALL':s.f);setPage(1)}}
              style={{ background:severity===s.f?s.color:'#fff', border:`1px solid ${s.color}30`, borderTop:`2px solid ${s.color}`, padding:'12px 14px', cursor:'pointer' }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'4px' }}>
                <span style={{ fontSize:'12px', fontWeight:700, color:severity===s.f?'#fff':s.color }}>{s.label}</span>
                <span style={{ fontSize:'22px', fontWeight:800, color:severity===s.f?'#fff':s.color }}>{s.count}</span>
              </div>
              <div style={{ fontSize:'10px', color:severity===s.f?'rgba(255,255,255,0.7)':'#9E8E6E' }}>{s.desc}</div>
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
            <input value={search} onChange={e=>{setSearch(e.target.value);setPage(1)}} placeholder="Search action, actor, target, audit ID..."
              style={{ flex:1, minWidth:'200px', border:'1px solid #D4C9B0', padding:'6px 10px', fontSize:'12px', fontFamily:FONTS.body, outline:'none', background:'#FDFAF6' }}/>
            {[
              { val:module,   set:v=>{setModule(v);setPage(1)},   opts:MODULES    },
              { val:severity, set:v=>{setSeverity(v);setPage(1)}, opts:SEVERITIES },
              { val:role,     set:v=>{setRole(v);setPage(1)},     opts:ROLES      },
              { val:stateF,   set:v=>{setStateF(v);setPage(1)},   opts:STATES_F   },
              { val:dateF,    set:v=>{setDateF(v);setPage(1)},    opts:DATES      },
            ].map((f,i)=>(
              <select key={i} value={f.val} onChange={e=>f.set(e.target.value)}
                style={{ border:'1px solid #D4C9B0', padding:'5px 8px', fontSize:'11px', color:'#6B5E3E', background:'#FDFAF6', cursor:'pointer', fontFamily:FONTS.body, outline:'none' }}>
                {f.opts.map(o=><option key={o}>{o}</option>)}
              </select>
            ))}
            <span style={{ fontSize:'11px', color:'#9E8E6E' }}>{filtered.length} results</span>
            <button onClick={()=>{setSearch('');setModule('ALL');setSeverity('ALL');setRole('ALL');setStateF('All States');setDateF('All Time');setPage(1)}}
              style={{ background:'#F5F0E8', border:'1px solid #D4C9B0', color:'#9E8E6E', padding:'5px 10px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>RESET</button>
          </div>
        </BCard>

        {/* Table */}
        <BCard>
          <BCardHeader title={`Audit Trail (${filtered.length})`} action={
            <div style={{ display:'flex', gap:'8px', alignItems:'center' }}>
              <span style={{ fontSize:'10px', color:'#DC2626', fontWeight:700 }}>⚠ IMMUTABLE — Cannot be deleted</span>
              <span style={{ fontSize:'11px', color:'#9E8E6E' }}>Page {page}/{totalPages||1}</span>
            </div>
          }/>
          <div style={{ display:'grid', gridTemplateColumns:'0.7fr 0.7fr 1.4fr 1.2fr 0.8fr 1.8fr 0.6fr 0.7fr', padding:'8px 14px', background:'#F5F0E8', borderBottom:'1px solid #E8DFD0', gap:'8px' }}>
            {['AUDIT ID','MODULE','ACTION','ACTOR','ROLE','TARGET','SEVERITY','DATE'].map(h=>(
              <span key={h} style={{ fontSize:'9px', fontWeight:800, color:'#9E8E6E', letterSpacing:'1px' }}>{h}</span>
            ))}
          </div>

          {paginated.length===0
            ?<div style={{ padding:'40px', textAlign:'center', color:'#9E8E6E' }}>No audit logs found</div>
            :paginated.map((a,i)=>{
              const sc=SEVERITY_COLORS[a.severity]||SEVERITY_COLORS.INFO
              const mc=MODULE_COLORS[a.module]||'#9E8E6E'
              return (
                <div key={a.id} style={{ display:'grid', gridTemplateColumns:'0.7fr 0.7fr 1.4fr 1.2fr 0.8fr 1.8fr 0.6fr 0.7fr', padding:'10px 14px', borderBottom:'1px solid #F0EAE0', alignItems:'center', gap:'8px', background:a.severity==='CRITICAL'?'#FEF2F2':a.severity==='WARNING'?'#FFFBEB':i%2===0?'#fff':'#FDFAF6' }}>
                  <span onClick={()=>setSelected(a)} style={{ fontSize:'10px', color:'#B8960C', fontFamily:'monospace', fontWeight:700, cursor:'pointer', textDecoration:'underline' }}>{a.id}</span>
                  <span style={{ fontSize:'10px', fontWeight:700, color:mc }}>{a.module}</span>
                  <span style={{ fontSize:'11px', fontWeight:600, color:'#1A1A2E' }}>{a.action.replace(/_/g,' ')}</span>
                  <div>
                    <div style={{ fontSize:'12px', fontWeight:600, color:'#1A1A2E' }}>{a.actor}</div>
                  </div>
                  <span style={{ fontSize:'9px', fontWeight:700, color:'#6B5E3E' }}>{a.actorRole.replace(/_/g,' ')}</span>
                  <span style={{ fontSize:'11px', color:'#6B5E3E' }}>{a.target}</span>
                  <span style={{ fontSize:'9px', fontWeight:800, background:sc.bg, color:sc.color, border:`1px solid ${sc.border}`, padding:'2px 5px', display:'inline-block' }}>{a.severity}</span>
                  <div>
                    <div style={{ fontSize:'10px', color:'#6B5E3E' }}>{a.date.split(' ')[0]}</div>
                    <div style={{ fontSize:'9px', color:'#9E8E6E' }}>{a.date.split(' ')[1]}</div>
                  </div>
                </div>
              )
            })
          }

          <div style={{ padding:'12px 14px', borderTop:'1px solid #E8DFD0', display:'flex', justifyContent:'space-between', alignItems:'center', background:'#FDFAF6' }}>
            <div style={{ display:'flex', gap:'8px', alignItems:'center' }}>
              <span style={{ fontSize:'11px', color:'#9E8E6E' }}>Showing {filtered.length===0?0:((page-1)*PER_PAGE)+1}–{Math.min(page*PER_PAGE,filtered.length)} of {filtered.length}</span>
              <span style={{ fontSize:'10px', color:'#DC2626', fontWeight:600 }}>• No deletions allowed</span>
            </div>
            <div style={{ display:'flex', gap:'4px' }}>
              <button onClick={()=>setPage(p=>Math.max(1,p-1))} disabled={page===1}
                style={{ background:page===1?'#F5F0E8':'#1A1A2E', color:page===1?'#C4B49A':'#fff', border:'1px solid #D4C9B0', padding:'5px 10px', fontSize:'11px', fontWeight:700, cursor:page===1?'not-allowed':'pointer' }}>← PREV</button>
              {paginationRange.map((p,idx)=> p==='...'
                ? <span key={`ellipsis-${idx}`} style={{ padding:'5px 6px', fontSize:'11px', color:'#9E8E6E' }}>…</span>
                : <button key={p} onClick={()=>setPage(p)} style={{ background:p===page?'#B8960C':'#fff', color:p===page?'#fff':'#6B5E3E', border:'1px solid #D4C9B0', padding:'5px 10px', fontSize:'11px', fontWeight:700, cursor:'pointer' }}>{p}</button>
              )}
              <button onClick={()=>setPage(p=>Math.min(totalPages,p+1))} disabled={page===totalPages||totalPages===0}
                style={{ background:(page===totalPages||totalPages===0)?'#F5F0E8':'#1A1A2E', color:(page===totalPages||totalPages===0)?'#C4B49A':'#fff', border:'1px solid #D4C9B0', padding:'5px 10px', fontSize:'11px', fontWeight:700, cursor:(page===totalPages||totalPages===0)?'not-allowed':'pointer' }}>NEXT →</button>
            </div>
          </div>
        </BCard>

        <div style={{ marginTop:'10px', padding:'10px 14px', background:'#FFFBEB', border:'1px solid #FDE68A', fontSize:'11px', color:'#92400E', fontWeight:600 }}>
          ⚠ Audit logs are immutable system records. No records can be modified, deleted, or backdated. All admin actions are permanently logged.
        </div>
      </div>

      <div style={{ background:'#0D1B2A', borderTop:'2px solid #B8960C', padding:'10px 20px', display:'flex', justifyContent:'space-between', marginTop:'14px' }}>
        <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.3)' }}>ZEMISH AUDIT CENTER v1.0.0</span>
        <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.3)' }}>NATIONAL COMMAND CENTER</span>
      </div>

      {/* Audit Detail Drawer */}
      {selected && (
        <div onClick={()=>setSelected(null)} style={{ position:'fixed', inset:0, background:'rgba(13,27,42,0.6)', display:'flex', justifyContent:'flex-end', zIndex:50 }}>
          <div onClick={e=>e.stopPropagation()} style={{ width:'380px', maxWidth:'100%', height:'100%', background:'#FDFAF6', borderLeft:'3px solid #B8960C', overflowY:'auto', boxShadow:'-8px 0 24px rgba(0,0,0,0.2)' }}>
            <div style={{ background:'#0D1B2A', padding:'16px 20px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <div>
                <div style={{ fontSize:'10px', color:'#B8960C', fontWeight:800, letterSpacing:'1px' }}>AUDIT DETAILS</div>
                <div style={{ fontSize:'15px', color:'#fff', fontWeight:800, fontFamily:'monospace' }}>{selected.id}</div>
              </div>
              <button onClick={()=>setSelected(null)} style={{ background:'transparent', border:'none', color:'#fff', fontSize:'18px', cursor:'pointer' }}>✕</button>
            </div>

            <div style={{ padding:'18px 20px' }}>
              <div style={{ marginBottom:'14px' }}>
                <span style={{ fontSize:'9px', fontWeight:800, background:(SEVERITY_COLORS[selected.severity]||SEVERITY_COLORS.INFO).bg, color:(SEVERITY_COLORS[selected.severity]||SEVERITY_COLORS.INFO).color, border:`1px solid ${(SEVERITY_COLORS[selected.severity]||SEVERITY_COLORS.INFO).border}`, padding:'3px 8px' }}>{selected.severity}</span>
                <span style={{ marginLeft:'8px', fontSize:'9px', fontWeight:700, color:MODULE_COLORS[selected.module]||'#9E8E6E' }}>{selected.module}</span>
              </div>

              <div style={{ fontSize:'15px', fontWeight:700, color:'#1A1A2E', marginBottom:'18px' }}>{selected.action.replace(/_/g,' ')}</div>

              {[
                ['Actor', selected.actor],
                ['Actor Role', selected.actorRole.replace(/_/g,' ')],
                ['Target', selected.target],
                ['State', selected.state || '—'],
                ['Old Value', selected.oldValue],
                ['New Value', selected.newValue],
              ].map(([label,val])=>(
                <div key={label} style={{ display:'flex', justifyContent:'space-between', padding:'8px 0', borderBottom:'1px solid #E8DFD0' }}>
                  <span style={{ fontSize:'11px', color:'#9E8E6E', fontWeight:700 }}>{label}</span>
                  <span style={{ fontSize:'12px', color:'#1A1A2E', fontWeight:600, textAlign:'right', maxWidth:'200px' }}>{val}</span>
                </div>
              ))}

              <div style={{ marginTop:'18px', marginBottom:'8px', display:'flex', alignItems:'center', gap:'6px' }}>
                <div style={{ width:'3px', height:'12px', background:'#B8960C' }}/>
                <span style={{ fontSize:'10px', fontWeight:800, color:'#9E8E6E', letterSpacing:'1px' }}>DEVICE & NETWORK</span>
              </div>
              {[
                ['IP Address', selected.ip],
                ['Device', selected.device],
                ['OS', selected.os],
              ].map(([label,val])=>(
                <div key={label} style={{ display:'flex', justifyContent:'space-between', padding:'8px 0', borderBottom:'1px solid #E8DFD0' }}>
                  <span style={{ fontSize:'11px', color:'#9E8E6E', fontWeight:700 }}>{label}</span>
                  <span style={{ fontSize:'12px', color:'#1A1A2E', fontWeight:600, fontFamily: label==='IP Address' ? 'monospace' : FONTS.body }}>{val}</span>
                </div>
              ))}

              <div style={{ marginTop:'18px', display:'flex', justifyContent:'space-between', padding:'8px 0' }}>
                <span style={{ fontSize:'11px', color:'#9E8E6E', fontWeight:700 }}>Timestamp</span>
                <span style={{ fontSize:'12px', color:'#1A1A2E', fontWeight:600 }}>{selected.date}</span>
              </div>

              <div style={{ marginTop:'16px', padding:'10px 12px', background:'#FFFBEB', border:'1px solid #FDE68A', fontSize:'10px', color:'#92400E', fontWeight:600 }}>
                ⚠ This record is immutable and cannot be edited or deleted.
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}