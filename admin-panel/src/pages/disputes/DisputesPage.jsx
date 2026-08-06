import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { canAssignDispute, canExport, canResolveDispute } from '../../config/adminRoles'
import { FONTS } from '../../config/brand'
import useAuthStore from '../../store/authStore'

// NOTE: this file previously defined its own ADMIN_LEVELS scheme
// (SUPER_ADMIN/INDIA_ADMIN/STATE_ADMIN/DISTRICT_ADMIN) that did not
// match the real system (admin.adminLevel is always INDIA/STATE/
// DISTRICT — confirmed via config/adminRoles.js and every other
// admin-panel module). That meant canResolve/canAssign/canExport
// silently evaluated false for every real admin, and the
// DISTRICT-admin lockout below never actually triggered. Now using
// the same real, shared permission helpers every other module uses.
const canResolve = canResolveDispute
const canAssign  = canAssignDispute

// BACKEND GAP: no /admin/disputes endpoint exists anywhere in the backend
// (confirmed — no model, route, or controller). There is no real data to
// seed this list with, so it starts empty rather than showing fabricated
// dispute records.

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
  NO_SHOW:        'No Show',
  REFUND_DELAY:   'Refund Delay',
  SERVICE_QUALITY:'Service Quality',
  FRAUD:          'Fraud',
  OVERCHARGE:     'Overcharge',
}

const STATES   = ['All States']
const STATUSES = ['ALL','OPEN','IN_REVIEW','RESOLVED','CLOSED']
const TYPES    = ['ALL','NO_SHOW','REFUND_DELAY','SERVICE_QUALITY','FRAUD','OVERCHARGE']
const PRIORITIES = ['ALL','CRITICAL','HIGH','MEDIUM','LOW']

function ResolveModal({ dispute, onConfirm, onCancel }) {
  const [resolution, setResolution] = useState('')
  const [action, setAction] = useState('RESOLVED')
  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.75)', zIndex:2000, display:'flex', alignItems:'center', justifyContent:'center' }}>
      <div style={{ background:'#fff', width:'480px', border:'2px solid #059669' }}>
        <div style={{ background:'#064E3B', padding:'14px 18px', borderBottom:'2px solid #059669' }}>
          <div style={{ color:'#fff', fontWeight:800, fontSize:'13px', letterSpacing:'1px' }}>✓ RESOLVE DISPUTE</div>
          <div style={{ color:'rgba(255,255,255,0.6)', fontSize:'10px', marginTop:'2px' }}>{dispute.id} — {dispute.customer}</div>
        </div>
        <div style={{ padding:'20px 18px' }}>
          <div style={{ marginBottom:'14px' }}>
            <label style={{ fontSize:'10px', color:'#9E8E6E', fontWeight:800, letterSpacing:'1px', display:'block', marginBottom:'6px' }}>RESOLUTION ACTION</label>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'8px' }}>
              {[
                { val:'RESOLVED', label:'✓ Mark Resolved', color:'#059669' },
                { val:'CLOSED',   label:'✗ Close Dispute', color:'#374151' },
              ].map(a=>(
                <button key={a.val} onClick={()=>setAction(a.val)}
                  style={{ padding:'10px', border:`2px solid ${action===a.val?a.color:'#E8DFD0'}`, background:action===a.val?`${a.color}15`:'#fff', color:action===a.val?a.color:'#9E8E6E', fontSize:'11px', fontWeight:700, cursor:'pointer' }}>
                  {a.label}
                </button>
              ))}
            </div>
          </div>
          <label style={{ fontSize:'10px', color:'#9E8E6E', fontWeight:800, letterSpacing:'1px', display:'block', marginBottom:'6px' }}>RESOLUTION NOTES (REQUIRED)</label>
          <textarea value={resolution} onChange={e=>setResolution(e.target.value)} placeholder="Describe the resolution..."
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
  <div style={{ padding:'10px 14px', borderBottom:'1px solid #E8DFD0', display:'flex', justifyContent:'space-between', alignItems:'center', background:'#FDFAF6' }}>
    <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
      <div style={{ width:'3px', height:'14px', background:'#B8960C' }}/>
      <span style={{ fontSize:'12px', fontWeight:700, color:'#1A1A2E', letterSpacing:'0.5px', textTransform:'uppercase' }}>{title}</span>
    </div>
    {action}
  </div>
)

export default function DisputesPage() {
  const navigate    = useNavigate()
  const admin       = useAuthStore(s=>s.admin)
  const adminLevel  = admin?.adminLevel||'INDIA'
  const hasResolve  = canResolve(adminLevel)
  const hasAssign   = canAssign(adminLevel)
  const hasExport   = canExport(adminLevel)

  const scope = adminLevel==='STATE'?'YOUR STATE':'PAN INDIA'

  const [search,       setSearch]       = useState('')
  const [status,       setStatus]       = useState('ALL')
  const [type,         setType]         = useState('ALL')
  const [priority,     setPriority]     = useState('ALL')
  const [stateF,       setStateF]       = useState('All States')
  const [page,         setPage]         = useState(1)
  const [toast,        setToast]        = useState(null)
  const [resolveModal, setResolveModal] = useState(null)
  // No real backend to fetch from (see handleAssign/handleResolve
  // below) — kept as state (not a plain const) so this can be swapped
  // for a real setDisputes(...) the moment a real endpoint exists,
  // without restructuring this component again.
  const [disputes]     = useState([])
  const PER_PAGE = 8

  const showToast = (msg,color) => { setToast({msg,color}); setTimeout(()=>setToast(null),3000) }

  // ✅ Fix 2 — Scope guard helper
  const isOwnScope = (d) => {
    if (adminLevel!=='STATE') return true
    if (!admin?.stateRef) return false
    return d.state===admin.stateRef
  }

  // BACKEND GAP: no /admin/disputes endpoint exists anywhere in the
  // backend (confirmed — no model, route, or controller). This page
  // is fully mock data. These actions used to silently mutate local
  // React state and show a fake success toast, which would mislead
  // an admin into believing a real dispute was assigned/resolved.
  // Report honestly instead — no state mutation, no fake success.
  const handleAssign = (d) => {
    if (!isOwnScope(d)) { showToast('⊘ Access denied — Not your state', '#DC2626'); return }
    showToast('⚠ Not available yet — no backend endpoint exists for disputes', '#DC2626')
  }
  const handleResolve = () => {
    const d = resolveModal
    if (!isOwnScope(d)) { showToast('⊘ Access denied — Not your state', '#DC2626'); setResolveModal(null); return }
    showToast('⚠ Not available yet — no backend endpoint exists for disputes', '#DC2626')
    setResolveModal(null)
  }

  const scopedDisputes = adminLevel==='STATE' && admin?.stateRef
    ? disputes.filter(d=>d.state===admin.stateRef)
    : disputes

  const stateOptions = adminLevel==='STATE' && admin?.stateRef
    ? ['All States', admin.stateRef]
    : STATES

  const filtered = scopedDisputes.filter(d=>{
    const q=search.toLowerCase()
    const matchSearch  = !search||d.id.toLowerCase().includes(q)||d.customer.toLowerCase().includes(q)||d.salon.toLowerCase().includes(q)||d.bookingId.toLowerCase().includes(q)
    const matchStatus  = status==='ALL'||d.status===status
    const matchType    = type==='ALL'||d.type===type
    const matchPriority= priority==='ALL'||d.priority===priority
    const matchState   = stateF==='All States'||d.state===stateF
    return matchSearch&&matchStatus&&matchType&&matchPriority&&matchState
  })

  const totalPages = Math.ceil(filtered.length/PER_PAGE)
  const paginated  = filtered.slice((page-1)*PER_PAGE,page*PER_PAGE)

  const counts = {
    ALL:       scopedDisputes.length,
    OPEN:      scopedDisputes.filter(d=>d.status==='OPEN').length,
    IN_REVIEW: scopedDisputes.filter(d=>d.status==='IN_REVIEW').length,
    RESOLVED:  scopedDisputes.filter(d=>d.status==='RESOLVED').length,
    CLOSED:    scopedDisputes.filter(d=>d.status==='CLOSED').length,
  }
  const criticalCount = scopedDisputes.filter(d=>d.priority==='CRITICAL'&&d.status==='OPEN').length

  // DISTRICT admin access denied — moved after all hooks above (was
  // previously an early return before them, a latent rules-of-hooks
  // violation that ESLint now flags directly).
  if (adminLevel==='DISTRICT') {
    return (
      <div style={{ fontFamily:FONTS.body, background:'#F0EAE0', minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center' }}>
        <div style={{ background:'#fff', border:'2px solid #DC2626', padding:'40px', textAlign:'center', maxWidth:'400px' }}>
          <div style={{ fontSize:'40px', marginBottom:'16px' }}>🔒</div>
          <div style={{ fontSize:'16px', fontWeight:800, color:'#1A1A2E', marginBottom:'8px' }}>Access Denied</div>
          <div style={{ fontSize:'13px', color:'#9E8E6E' }}>DISTRICT admins do not have access to the Disputes module.</div>
          <div style={{ fontSize:'11px', color:'#DC2626', fontWeight:600, marginTop:'8px' }}>Required: INDIA / STATE</div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ fontFamily:FONTS.body, background:'#F0EAE0', minHeight:'100vh' }}>

      {toast && <div style={{ position:'fixed', top:'20px', right:'20px', background:toast.color, color:'#fff', padding:'12px 20px', fontSize:'13px', fontWeight:700, zIndex:9999, boxShadow:'0 4px 12px rgba(0,0,0,0.2)' }}>{toast.msg}</div>}

      {/* Header */}
      <div style={{ background:'#0D1B2A', borderBottom:'2px solid #B8960C', padding:'0 20px', height:'52px', display:'flex', alignItems:'center', justifyContent:'space-between', position:'sticky', top:0, zIndex:10 }}>
        <div style={{ display:'flex', alignItems:'center', gap:'12px' }}>
          <div style={{ width:'3px', height:'16px', background:'#B8960C' }}/>
          <h1 style={{ fontSize:'13px', fontWeight:800, color:'#fff', margin:0, letterSpacing:'2px', textTransform:'uppercase' }}>Disputes</h1>
          <span style={{ background:'rgba(184,150,12,0.2)', color:'#B8960C', fontSize:'10px', fontWeight:800, padding:'2px 8px', border:'1px solid rgba(184,150,12,0.3)' }}>{scopedDisputes.length} TOTAL</span>
          <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.35)' }}>|</span>
          <span style={{ fontSize:'10px', color:'#B8960C', fontWeight:600 }}>Viewing: {scope}</span>
          {counts.OPEN>0 && <span style={{ background:'rgba(220,38,38,0.2)', color:'#FCA5A5', fontSize:'10px', fontWeight:800, padding:'2px 8px', border:'1px solid rgba(220,38,38,0.3)' }}>⚠ {counts.OPEN} OPEN</span>}
          {criticalCount>0 && <span style={{ background:'#DC2626', color:'#fff', fontSize:'10px', fontWeight:800, padding:'2px 8px' }}>🔴 {criticalCount} CRITICAL</span>}
        </div>
        <div style={{ display:'flex', gap:'8px' }}>
          {hasExport && <button onClick={()=>showToast('Export — Coming Soon', '#D97706')} style={{ background:'rgba(255,255,255,0.07)', border:'1px solid rgba(255,255,255,0.15)', color:'rgba(255,255,255,0.6)', padding:'6px 12px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>↓ EXPORT</button>}
        </div>
      </div>

      <div style={{ padding:'14px 20px' }}>

        {/* BACKEND GAP — no /admin/disputes endpoint exists anywhere in the
            backend (no model, route, or controller). This screen shows real
            (empty) state, not fabricated dispute records. */}
        <div style={{ marginBottom:'12px', padding:'10px 14px', background:'#FEF2F2', border:'1px solid #FEE2E2', fontSize:'12px', color:'#991B1B', fontWeight:600 }}>
          ⚠ BACKEND GAP — Disputes has no backend implementation yet (no model, route, or controller). This screen reflects real (empty) state until a backend endpoint exists.
        </div>

        {/* Summary Strip */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:'1px', background:'#D4C9B0', border:'1px solid #D4C9B0', marginBottom:'12px' }}>
          {[
            { label:'Total',     value:counts.ALL,                                              color:'#B8960C' },
            { label:'Open',      value:counts.OPEN,                                             color:'#DC2626' },
            { label:'In Review', value:counts.IN_REVIEW,                                        color:'#D97706' },
            { label:'Resolved',  value:counts.RESOLVED,                                         color:'#059669' },
            { label:'Dispute Amt',value:`₹${scopedDisputes.reduce((a,d)=>a+d.amount,0).toLocaleString('en-IN')}`, color:'#7C3AED' },
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
            { label:'All',       count:counts.ALL,       color:'#1A1A2E', f:'ALL'       },
            { label:'Open',      count:counts.OPEN,      color:'#DC2626', f:'OPEN'      },
            { label:'In Review', count:counts.IN_REVIEW, color:'#D97706', f:'IN_REVIEW' },
            { label:'Resolved',  count:counts.RESOLVED,  color:'#059669', f:'RESOLVED'  },
            { label:'Closed',    count:counts.CLOSED,    color:'#374151', f:'CLOSED'    },
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
            <input value={search} onChange={e=>{setSearch(e.target.value);setPage(1)}} placeholder="Search dispute ID, customer, salon, booking..."
              style={{ flex:1, minWidth:'180px', border:'1px solid #D4C9B0', padding:'6px 10px', fontSize:'12px', fontFamily:FONTS.body, outline:'none', background:'#FDFAF6' }}/>
            {[
              { val:status,   set:v=>{setStatus(v);setPage(1)},   opts:STATUSES    },
              { val:type,     set:v=>{setType(v);setPage(1)},     opts:TYPES       },
              { val:priority, set:v=>{setPriority(v);setPage(1)}, opts:PRIORITIES  },
              { val:stateF,   set:v=>{setStateF(v);setPage(1)},   opts:stateOptions},
            ].map((f,i)=>(
              <select key={i} value={f.val} onChange={e=>f.set(e.target.value)}
                style={{ border:'1px solid #D4C9B0', padding:'5px 8px', fontSize:'11px', color:'#6B5E3E', background:'#FDFAF6', cursor:'pointer', fontFamily:FONTS.body, outline:'none' }}>
                {f.opts.map(o=><option key={o}>{o}</option>)}
              </select>
            ))}
            <span style={{ fontSize:'11px', color:'#9E8E6E' }}>{filtered.length} results</span>
            <button onClick={()=>{setSearch('');setStatus('ALL');setType('ALL');setPriority('ALL');setStateF('All States');setPage(1)}}
              style={{ background:'#F5F0E8', border:'1px solid #D4C9B0', color:'#9E8E6E', padding:'5px 10px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>RESET</button>
          </div>
        </BCard>

        {/* Table */}
        <BCard>
          <BCardHeader title={`Dispute Queue (${filtered.length})`} action={
            <span style={{ fontSize:'11px', color:'#9E8E6E' }}>Page {page} of {totalPages||1}</span>
          }/>
          <div style={{ display:'grid', gridTemplateColumns:'0.7fr 0.7fr 1.2fr 1.2fr 1.2fr 0.7fr 0.7fr 0.7fr 0.7fr 1.2fr', padding:'8px 14px', background:'#F5F0E8', borderBottom:'1px solid #E8DFD0', gap:'8px' }}>
            {['DSP ID','BOOKING','CUSTOMER','SALON','TYPE','AMT','STATE','PRIORITY','STATUS','ACTIONS'].map(h=>(
              <span key={h} style={{ fontSize:'9px', fontWeight:800, color:'#9E8E6E', letterSpacing:'1px' }}>{h}</span>
            ))}
          </div>

          {paginated.length===0
            ?<div style={{ padding:'40px', textAlign:'center', color:'#9E8E6E' }}>No disputes found — backend not implemented yet</div>
            :paginated.map((d,i)=>{
              const sc=STATUS_COLORS[d.status]||STATUS_COLORS.OPEN
              const pc=PRIORITY_COLORS[d.priority]||PRIORITY_COLORS.LOW
              return (
                <div key={d.id} style={{ display:'grid', gridTemplateColumns:'0.7fr 0.7fr 1.2fr 1.2fr 1.2fr 0.7fr 0.7fr 0.7fr 0.7fr 1.2fr', padding:'11px 14px', borderBottom:'1px solid #F0EAE0', alignItems:'center', gap:'8px', background:d.priority==='CRITICAL'&&d.status==='OPEN'?'#FEF2F2':i%2===0?'#fff':'#FDFAF6' }}>
                  <span style={{ fontSize:'10px', color:'#9E8E6E', fontFamily:'monospace', fontWeight:600 }}>{d.id}</span>
                  <button onClick={()=>navigate(`/app/bookings/${d.bookingId}`)} style={{ background:'none', border:'none', cursor:'pointer', padding:0, textAlign:'left' }}>
                    <span style={{ fontSize:'10px', color:'#2563EB', textDecoration:'underline', fontFamily:'monospace' }}>{d.bookingId}</span>
                  </button>
                  <div>
                    <div style={{ fontSize:'12px', fontWeight:600, color:'#1A1A2E' }}>{d.customer}</div>
                    <div style={{ fontSize:'10px', color:'#9E8E6E' }}>By: {d.raisedBy}</div>
                  </div>
                  <span style={{ fontSize:'11px', color:'#6B5E3E' }}>{d.salon}</span>
                  <span style={{ fontSize:'10px', fontWeight:700, color:'#7C3AED' }}>{TYPE_LABELS[d.type]||d.type}</span>
                  <span style={{ fontSize:'12px', fontWeight:700, color:'#B8960C' }}>₹{d.amount}</span>
                  <span style={{ fontSize:'11px', color:'#6B5E3E', fontWeight:600 }}>{d.state}</span>
                  <span style={{ fontSize:'9px', fontWeight:800, background:pc.bg, color:pc.color, border:`1px solid ${pc.border}`, padding:'2px 5px', display:'inline-block' }}>{d.priority}</span>
                  <span style={{ fontSize:'9px', fontWeight:800, background:sc.bg, color:sc.color, padding:'2px 5px', display:'inline-block' }}>{d.status.replace('_',' ')}</span>
                  <div style={{ display:'flex', gap:'3px', flexDirection:'column' }}>
                    {d.status==='OPEN' && hasAssign && (
                      <button onClick={()=>handleAssign(d)} style={{ background:'#2563EB', color:'#fff', border:'none', padding:'4px 8px', fontSize:'9px', fontWeight:700, cursor:'pointer' }}>ASSIGN TO ME</button>
                    )}
                    {(d.status==='OPEN'||d.status==='IN_REVIEW') && hasResolve && (
                      <button onClick={()=>setResolveModal(d)} style={{ background:'#059669', color:'#fff', border:'none', padding:'4px 8px', fontSize:'9px', fontWeight:700, cursor:'pointer' }}>✓ RESOLVE</button>
                    )}
                    {d.status==='RESOLVED'&&d.resolution && (
                      <span style={{ fontSize:'9px', color:'#059669', fontStyle:'italic' }}>
                        {d.resolution.length>25?d.resolution.slice(0,25)+'...':d.resolution}
                      </span>
                    )}
                    {d.status==='CLOSED' && (
                      <span style={{ fontSize:'9px', color:'#374151' }}>Closed</span>
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
        <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.3)' }}>ZEMISH DISPUTE CENTER v1.0.0</span>
        <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.3)' }}>NATIONAL COMMAND CENTER</span>
      </div>

      {resolveModal && <ResolveModal dispute={resolveModal} onConfirm={handleResolve} onCancel={()=>setResolveModal(null)}/>}
    </div>
  )
}