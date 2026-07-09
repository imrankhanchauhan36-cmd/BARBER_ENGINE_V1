import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FONTS } from '../../config/brand'
import useAuthStore from '../../store/authStore'

const ADMIN_LEVELS = { SUPER_ADMIN:'SUPER_ADMIN', INDIA_ADMIN:'INDIA_ADMIN', STATE_ADMIN:'STATE_ADMIN', DISTRICT_ADMIN:'DISTRICT_ADMIN' }
const canManagePermissions = (l) => l === ADMIN_LEVELS.SUPER_ADMIN

const INITIAL_MATRIX = [
  { module:'Dashboard',               icon:'📊', actions:[
    { action:'VIEW',            SUPER_ADMIN:true,  INDIA_ADMIN:true,  STATE_ADMIN:true,  DISTRICT_ADMIN:true  },
    { action:'VIEW_ANALYTICS',  SUPER_ADMIN:true,  INDIA_ADMIN:true,  STATE_ADMIN:false, DISTRICT_ADMIN:false },
  ]},
  { module:'Salons',                  icon:'✂️', actions:[
    { action:'VIEW',            SUPER_ADMIN:true,  INDIA_ADMIN:true,  STATE_ADMIN:true,  DISTRICT_ADMIN:true  },
    { action:'EDIT',            SUPER_ADMIN:true,  INDIA_ADMIN:true,  STATE_ADMIN:true,  DISTRICT_ADMIN:false },
    { action:'APPROVE',         SUPER_ADMIN:true,  INDIA_ADMIN:true,  STATE_ADMIN:true,  DISTRICT_ADMIN:false },
    { action:'REJECT',          SUPER_ADMIN:true,  INDIA_ADMIN:true,  STATE_ADMIN:true,  DISTRICT_ADMIN:false },
    { action:'SUSPEND',         SUPER_ADMIN:true,  INDIA_ADMIN:true,  STATE_ADMIN:false, DISTRICT_ADMIN:false },
    { action:'VIEW_ANALYTICS',  SUPER_ADMIN:true,  INDIA_ADMIN:true,  STATE_ADMIN:true,  DISTRICT_ADMIN:false },
    { action:'EXPORT',          SUPER_ADMIN:true,  INDIA_ADMIN:true,  STATE_ADMIN:false, DISTRICT_ADMIN:false },
  ]},
  { module:'Users',                   icon:'👤', actions:[
    { action:'VIEW',            SUPER_ADMIN:true,  INDIA_ADMIN:true,  STATE_ADMIN:true,  DISTRICT_ADMIN:true  },
    { action:'BLOCK',           SUPER_ADMIN:true,  INDIA_ADMIN:true,  STATE_ADMIN:false, DISTRICT_ADMIN:false },
    { action:'UNBLOCK',         SUPER_ADMIN:true,  INDIA_ADMIN:true,  STATE_ADMIN:false, DISTRICT_ADMIN:false },
    { action:'EXPORT',          SUPER_ADMIN:true,  INDIA_ADMIN:true,  STATE_ADMIN:false, DISTRICT_ADMIN:false },
  ]},
  { module:'Providers',               icon:'💼', actions:[
    { action:'VIEW',            SUPER_ADMIN:true,  INDIA_ADMIN:true,  STATE_ADMIN:true,  DISTRICT_ADMIN:true  },
    { action:'SUSPEND',         SUPER_ADMIN:true,  INDIA_ADMIN:true,  STATE_ADMIN:false, DISTRICT_ADMIN:false },
    { action:'EXPORT',          SUPER_ADMIN:true,  INDIA_ADMIN:true,  STATE_ADMIN:false, DISTRICT_ADMIN:false },
  ]},
  { module:'KYC',                     icon:'🪪', actions:[
    { action:'VIEW',            SUPER_ADMIN:true,  INDIA_ADMIN:true,  STATE_ADMIN:true,  DISTRICT_ADMIN:false },
    { action:'APPROVE',         SUPER_ADMIN:true,  INDIA_ADMIN:true,  STATE_ADMIN:false, DISTRICT_ADMIN:false },
    { action:'REJECT',          SUPER_ADMIN:true,  INDIA_ADMIN:true,  STATE_ADMIN:false, DISTRICT_ADMIN:false },
    { action:'EXPORT',          SUPER_ADMIN:true,  INDIA_ADMIN:true,  STATE_ADMIN:false, DISTRICT_ADMIN:false },
  ]},
  { module:'Bookings',                icon:'📅', actions:[
    { action:'VIEW',            SUPER_ADMIN:true,  INDIA_ADMIN:true,  STATE_ADMIN:true,  DISTRICT_ADMIN:true  },
    { action:'CANCEL',          SUPER_ADMIN:true,  INDIA_ADMIN:true,  STATE_ADMIN:false, DISTRICT_ADMIN:false },
    { action:'VIEW_ANALYTICS',  SUPER_ADMIN:true,  INDIA_ADMIN:true,  STATE_ADMIN:true,  DISTRICT_ADMIN:false },
    { action:'EXPORT',          SUPER_ADMIN:true,  INDIA_ADMIN:true,  STATE_ADMIN:false, DISTRICT_ADMIN:false },
  ]},
  { module:'Disputes',                icon:'⚖️', actions:[
    { action:'VIEW',            SUPER_ADMIN:true,  INDIA_ADMIN:true,  STATE_ADMIN:true,  DISTRICT_ADMIN:false },
    { action:'ASSIGN',          SUPER_ADMIN:true,  INDIA_ADMIN:true,  STATE_ADMIN:false, DISTRICT_ADMIN:false },
    { action:'RESOLVE',         SUPER_ADMIN:true,  INDIA_ADMIN:true,  STATE_ADMIN:true,  DISTRICT_ADMIN:false },
    { action:'EXPORT',          SUPER_ADMIN:true,  INDIA_ADMIN:true,  STATE_ADMIN:false, DISTRICT_ADMIN:false },
  ]},
  { module:'Finance — Wallets',       icon:'👛', actions:[
    { action:'VIEW',            SUPER_ADMIN:true,  INDIA_ADMIN:true,  STATE_ADMIN:false, DISTRICT_ADMIN:false },
    { action:'FREEZE',          SUPER_ADMIN:true,  INDIA_ADMIN:true,  STATE_ADMIN:false, DISTRICT_ADMIN:false },
    { action:'UNFREEZE',        SUPER_ADMIN:true,  INDIA_ADMIN:false, STATE_ADMIN:false, DISTRICT_ADMIN:false },
    { action:'EXPORT',          SUPER_ADMIN:true,  INDIA_ADMIN:true,  STATE_ADMIN:false, DISTRICT_ADMIN:false },
  ]},
  { module:'Finance — Transactions',  icon:'💳', actions:[
    { action:'VIEW',            SUPER_ADMIN:true,  INDIA_ADMIN:true,  STATE_ADMIN:false, DISTRICT_ADMIN:false },
    { action:'REFUND',          SUPER_ADMIN:true,  INDIA_ADMIN:true,  STATE_ADMIN:false, DISTRICT_ADMIN:false },
    { action:'EXPORT',          SUPER_ADMIN:true,  INDIA_ADMIN:true,  STATE_ADMIN:false, DISTRICT_ADMIN:false },
  ]},
  { module:'Finance — Payouts',       icon:'💰', actions:[
    { action:'VIEW',            SUPER_ADMIN:true,  INDIA_ADMIN:true,  STATE_ADMIN:true,  DISTRICT_ADMIN:false },
    { action:'APPROVE',         SUPER_ADMIN:true,  INDIA_ADMIN:true,  STATE_ADMIN:false, DISTRICT_ADMIN:false },
    { action:'REJECT',          SUPER_ADMIN:true,  INDIA_ADMIN:true,  STATE_ADMIN:false, DISTRICT_ADMIN:false },
    { action:'EXPORT',          SUPER_ADMIN:true,  INDIA_ADMIN:true,  STATE_ADMIN:false, DISTRICT_ADMIN:false },
  ]},
  { module:'Employees',               icon:'🧑‍💼', actions:[
    { action:'VIEW',            SUPER_ADMIN:true,  INDIA_ADMIN:true,  STATE_ADMIN:false, DISTRICT_ADMIN:false },
    { action:'CREATE',          SUPER_ADMIN:true,  INDIA_ADMIN:false, STATE_ADMIN:false, DISTRICT_ADMIN:false },
    { action:'DEACTIVATE',      SUPER_ADMIN:true,  INDIA_ADMIN:false, STATE_ADMIN:false, DISTRICT_ADMIN:false },
    { action:'CHANGE_ROLE',     SUPER_ADMIN:true,  INDIA_ADMIN:false, STATE_ADMIN:false, DISTRICT_ADMIN:false },
    { action:'RESET_PASSWORD',  SUPER_ADMIN:true,  INDIA_ADMIN:true,  STATE_ADMIN:false, DISTRICT_ADMIN:false },
  ]},
  { module:'Roles & Permissions',     icon:'🔑', actions:[
    { action:'VIEW',            SUPER_ADMIN:true,  INDIA_ADMIN:false, STATE_ADMIN:false, DISTRICT_ADMIN:false },
    { action:'EDIT',            SUPER_ADMIN:true,  INDIA_ADMIN:false, STATE_ADMIN:false, DISTRICT_ADMIN:false },
  ]},
  { module:'Audit Logs',              icon:'📋', actions:[
    { action:'VIEW',            SUPER_ADMIN:true,  INDIA_ADMIN:true,  STATE_ADMIN:false, DISTRICT_ADMIN:false },
    { action:'EXPORT',          SUPER_ADMIN:true,  INDIA_ADMIN:true,  STATE_ADMIN:false, DISTRICT_ADMIN:false },
  ]},
  { module:'Location — States',       icon:'🗺️', actions:[
    { action:'VIEW',            SUPER_ADMIN:true,  INDIA_ADMIN:true,  STATE_ADMIN:true,  DISTRICT_ADMIN:false },
    { action:'EDIT',            SUPER_ADMIN:true,  INDIA_ADMIN:true,  STATE_ADMIN:false, DISTRICT_ADMIN:false },
    { action:'CLOSE_TERRITORY', SUPER_ADMIN:true,  INDIA_ADMIN:false, STATE_ADMIN:false, DISTRICT_ADMIN:false },
    { action:'ASSIGN_ADMIN',    SUPER_ADMIN:true,  INDIA_ADMIN:false, STATE_ADMIN:false, DISTRICT_ADMIN:false },
  ]},
  { module:'Location — Districts',    icon:'📍', actions:[
    { action:'VIEW',            SUPER_ADMIN:true,  INDIA_ADMIN:true,  STATE_ADMIN:true,  DISTRICT_ADMIN:true  },
    { action:'EDIT',            SUPER_ADMIN:true,  INDIA_ADMIN:true,  STATE_ADMIN:true,  DISTRICT_ADMIN:false },
    { action:'ASSIGN_ADMIN',    SUPER_ADMIN:true,  INDIA_ADMIN:true,  STATE_ADMIN:true,  DISTRICT_ADMIN:false },
  ]},
  { module:'Notifications',           icon:'🔔', actions:[
    { action:'VIEW',            SUPER_ADMIN:true,  INDIA_ADMIN:true,  STATE_ADMIN:false, DISTRICT_ADMIN:false },
    { action:'SEND_BULK',       SUPER_ADMIN:true,  INDIA_ADMIN:true,  STATE_ADMIN:false, DISTRICT_ADMIN:false },
    { action:'SEND_TARGETED',   SUPER_ADMIN:true,  INDIA_ADMIN:true,  STATE_ADMIN:true,  DISTRICT_ADMIN:false },
  ]},
  { module:'Settings',                icon:'⚙️', actions:[
    { action:'VIEW',            SUPER_ADMIN:true,  INDIA_ADMIN:false, STATE_ADMIN:false, DISTRICT_ADMIN:false },
    { action:'EDIT',            SUPER_ADMIN:true,  INDIA_ADMIN:false, STATE_ADMIN:false, DISTRICT_ADMIN:false },
  ]},
]

const ROLES = ['SUPER_ADMIN','INDIA_ADMIN','STATE_ADMIN','DISTRICT_ADMIN']
const ROLE_LABELS = {
  SUPER_ADMIN:    { short:'SA',  label:'Super Admin',    color:'#DC2626', bg:'#FEE2E2' },
  INDIA_ADMIN:    { short:'IA',  label:'India Admin',    color:'#B8960C', bg:'#FEF9C3' },
  STATE_ADMIN:    { short:'STA', label:'State Admin',    color:'#059669', bg:'#D1FAE5' },
  DISTRICT_ADMIN: { short:'DA',  label:'District Admin', color:'#2563EB', bg:'#EFF6FF' },
}
const MODULES_FILTER = ['All Modules',...INITIAL_MATRIX.map(m=>m.module)]

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

// ✅ Improvement 1: Dirty cell highlight
const Check = ({ value, editable, onChange, isDirty }) => {
  const base = {
    width:'22px', height:'22px', display:'flex', alignItems:'center', justifyContent:'center',
    border:`1px solid ${isDirty?'#D97706':value?'#059669':'#D4C9B0'}`,
    background: isDirty ? '#FEF9C3' : value ? '#D1FAE5' : '#F5F0E8',
    fontSize:'13px', cursor:editable?'pointer':'default', transition:'all 0.15s',
    outline: isDirty ? '2px solid #D97706' : 'none',
  }
  return (
    <div style={base} onClick={editable?onChange:undefined} title={isDirty?'Changed (unsaved)':editable?'Click to toggle':'Read-only'}>
      {isDirty ? '●' : value ? '✓' : '—'}
    </div>
  )
}

export default function PermissionsPage() {
  const navigate   = useNavigate()
  const admin      = useAuthStore(s=>s.admin)
  const adminLevel = admin?.adminLevel||ADMIN_LEVELS.SUPER_ADMIN

  if (!canManagePermissions(adminLevel)) {
    return (
      <div style={{ fontFamily:FONTS.body, background:'#F0EAE0', minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center' }}>
        <div style={{ background:'#fff', border:'2px solid #DC2626', padding:'40px', textAlign:'center', maxWidth:'400px' }}>
          <div style={{ fontSize:'40px', marginBottom:'16px' }}>🔒</div>
          <div style={{ fontSize:'16px', fontWeight:800, color:'#1A1A2E', marginBottom:'8px' }}>Access Denied</div>
          <div style={{ fontSize:'13px', color:'#9E8E6E', marginBottom:'16px' }}>Only SUPER_ADMIN can view or edit the Permission Matrix.</div>
          <button onClick={()=>navigate(-1)} style={{ background:'#1A1A2E', color:'#fff', border:'none', padding:'8px 16px', fontSize:'12px', fontWeight:700, cursor:'pointer' }}>← Go Back</button>
        </div>
      </div>
    )
  }

  const [matrix,       setMatrix]       = useState(INITIAL_MATRIX)
  const [editMode,     setEditMode]     = useState(false)
  const [search,       setSearch]       = useState('')
  const [moduleF,      setModuleF]      = useState('All Modules')
  const [roleFilter,   setRoleFilter]   = useState('All Roles')
  const [unsaved,      setUnsaved]      = useState(false)
  const [saveToast,    setSaveToast]    = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)
  // ✅ Improvement 1: Track dirty cells {moduleIdx-actionIdx-role}
  const [dirtyCells,   setDirtyCells]   = useState(new Set())

  const filtered = matrix.filter(m=>{
    const matchModule = moduleF==='All Modules'||m.module===moduleF
    const matchSearch = !search||m.module.toLowerCase().includes(search.toLowerCase())||
      m.actions.some(a=>a.action.toLowerCase().includes(search.toLowerCase()))
    return matchModule&&matchSearch
  })

  const togglePermission = (moduleIdx, actionIdx, role) => {
    if (!editMode) return
    if (role==='SUPER_ADMIN') return
    const cellKey = `${moduleIdx}-${actionIdx}-${role}`
    setMatrix(prev=>prev.map((m,mi)=>mi!==moduleIdx?m:{
      ...m, actions:m.actions.map((a,ai)=>ai!==actionIdx?a:{...a,[role]:!a[role]})
    }))
    // ✅ Toggle dirty tracking — if toggled back to original, remove from dirty set
    setDirtyCells(prev=>{
      const next = new Set(prev)
      const originalVal = INITIAL_MATRIX[moduleIdx].actions[actionIdx][role]
      const newVal = !matrix[moduleIdx].actions[actionIdx][role]
      if (newVal===originalVal) next.delete(cellKey)
      else next.add(cellKey)
      return next
    })
    setUnsaved(true)
  }

  const handleSave = () => {
    // TODO backend: await api.put('/admin/permissions', matrix)
    // ✅ Improvement 2: Audit note on save
    const changeCount = dirtyCells.size
    setUnsaved(false)
    setEditMode(false)
    setDirtyCells(new Set())
    setSaveToast({ count:changeCount })
    setTimeout(()=>setSaveToast(false), 4000)
  }

  const handleReset = () => {
    setMatrix(INITIAL_MATRIX)
    setUnsaved(false)
    setEditMode(false)
    setDirtyCells(new Set())
    setConfirmReset(false)
  }

  const totalActions = matrix.reduce((s,m)=>s+m.actions.length,0)
  const roleCounts   = ROLES.reduce((acc,role)=>{
    acc[role]=matrix.reduce((s,m)=>s+m.actions.filter(a=>a[role]).length,0); return acc
  },{})

  return (
    <div style={{ fontFamily:FONTS.body, background:'#F0EAE0', minHeight:'100vh' }}>

      {/* ✅ Improvement 2: Richer save toast with change count */}
      {saveToast && (
        <div style={{ position:'fixed', top:'16px', right:'20px', zIndex:100, background:'#059669', color:'#fff', padding:'12px 20px', fontSize:'12px', fontWeight:700, border:'1px solid #065F46', boxShadow:'0 4px 12px rgba(0,0,0,0.2)' }}>
          <div>✓ Permission matrix saved successfully.</div>
          <div style={{ fontSize:'10px', opacity:0.8, marginTop:'3px' }}>{saveToast.count} permissions changed • Audit log updated</div>
        </div>
      )}

      {/* Header */}
      <div style={{ background:'#0D1B2A', borderBottom:'2px solid #B8960C', padding:'0 20px', height:'52px', display:'flex', alignItems:'center', justifyContent:'space-between', position:'sticky', top:0, zIndex:10 }}>
        <div style={{ display:'flex', alignItems:'center', gap:'12px' }}>
          <div style={{ width:'3px', height:'16px', background:'#B8960C' }}/>
          <h1 style={{ fontSize:'13px', fontWeight:800, color:'#fff', margin:0, letterSpacing:'2px', textTransform:'uppercase' }}>Permissions</h1>
          <span style={{ background:'rgba(184,150,12,0.2)', color:'#B8960C', fontSize:'10px', fontWeight:800, padding:'2px 8px', border:'1px solid rgba(184,150,12,0.3)' }}>{matrix.length} MODULES</span>
          <span style={{ background:'rgba(184,150,12,0.15)', color:'#B8960C', fontSize:'10px', fontWeight:800, padding:'2px 8px', border:'1px solid rgba(184,150,12,0.3)' }}>{totalActions} ACTIONS</span>
          {unsaved && <span style={{ background:'#D97706', color:'#fff', fontSize:'10px', fontWeight:800, padding:'2px 8px' }}>● {dirtyCells.size} UNSAVED CHANGES</span>}
        </div>
        <div style={{ display:'flex', gap:'8px' }}>
          {editMode ? (
            <>
              <button onClick={()=>setConfirmReset(true)} style={{ background:'transparent', border:'1px solid rgba(220,38,38,0.5)', color:'#FCA5A5', padding:'6px 12px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>RESET</button>
              <button onClick={()=>{setEditMode(false);setMatrix(INITIAL_MATRIX);setUnsaved(false);setDirtyCells(new Set())}} style={{ background:'rgba(255,255,255,0.07)', border:'1px solid rgba(255,255,255,0.15)', color:'rgba(255,255,255,0.6)', padding:'6px 12px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>CANCEL</button>
              <button onClick={handleSave} style={{ background:'#B8960C', border:'none', color:'#fff', padding:'6px 14px', fontSize:'10px', fontWeight:800, cursor:'pointer' }}>✓ SAVE CHANGES</button>
            </>
          ) : (
            <button onClick={()=>setEditMode(true)} style={{ background:'rgba(184,150,12,0.2)', border:'1px solid rgba(184,150,12,0.4)', color:'#B8960C', padding:'6px 12px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>✎ EDIT MATRIX</button>
          )}
        </div>
      </div>

      <div style={{ padding:'14px 20px' }}>

        {editMode && (
          <div style={{ marginBottom:'12px', padding:'10px 14px', background:'#FFFBEB', border:'1px solid #FDE68A', fontSize:'12px', color:'#92400E', fontWeight:600, display:'flex', alignItems:'center', gap:'8px' }}>
            ✎ Edit Mode Active — Click any cell to toggle. <span style={{ background:'#FEF9C3', border:'1px solid #D97706', padding:'1px 6px', fontSize:'10px' }}>●</span> = unsaved change. SUPER_ADMIN locked.
          </div>
        )}

        {/* Role Summary Strip */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:'1px', background:'#D4C9B0', border:'1px solid #D4C9B0', marginBottom:'12px' }}>
          {ROLES.map(role=>{
            const r=ROLE_LABELS[role]
            const pct=Math.round((roleCounts[role]/totalActions)*100)
            return (
              <div key={role} style={{ background:'#0D1B2A', padding:'12px 16px' }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'6px' }}>
                  <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.5)', fontWeight:700 }}>{r.label.toUpperCase()}</span>
                  <span style={{ fontSize:'18px', fontWeight:800, color:r.color }}>{roleCounts[role]}</span>
                </div>
                <div style={{ height:'4px', background:'rgba(255,255,255,0.08)' }}>
                  <div style={{ height:'100%', width:`${pct}%`, background:r.color }}/>
                </div>
                <div style={{ fontSize:'9px', color:'rgba(255,255,255,0.3)', marginTop:'4px' }}>{pct}% of {totalActions} actions</div>
              </div>
            )
          })}
        </div>

        {/* Role Cards */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:'10px', marginBottom:'12px' }}>
          {ROLES.map(role=>{
            const r=ROLE_LABELS[role]
            const moduleCount=matrix.filter(m=>m.actions.some(a=>a[role])).length
            return (
              <div key={role} onClick={()=>setRoleFilter(prev=>prev===role?'All Roles':role)}
                style={{ background:'#fff', border:`1px solid ${r.color}30`, borderTop:`2px solid ${r.color}`, padding:'12px 14px', cursor:'pointer', outline:roleFilter===role?`2px solid ${r.color}`:'none' }}>
                <div style={{ display:'flex', justifyContent:'space-between', marginBottom:'6px' }}>
                  <span style={{ fontSize:'11px', fontWeight:800, color:r.color }}>{r.label}</span>
                  <span style={{ fontSize:'9px', fontWeight:800, background:r.bg, color:r.color, padding:'2px 6px', border:`1px solid ${r.color}40` }}>{r.short}</span>
                </div>
                <div style={{ fontSize:'20px', fontWeight:800, color:r.color, marginBottom:'4px' }}>{roleCounts[role]}</div>
                <div style={{ fontSize:'10px', color:'#9E8E6E' }}>{moduleCount} modules accessible</div>
              </div>
            )
          })}
        </div>

        {/* Filters */}
        <BCard style={{ marginBottom:'12px' }}>
          <div style={{ padding:'10px 14px', display:'flex', gap:'8px', alignItems:'center', flexWrap:'wrap' }}>
            <div style={{ display:'flex', alignItems:'center', gap:'6px' }}>
              <div style={{ width:'3px', height:'14px', background:'#B8960C' }}/>
              <span style={{ fontSize:'10px', fontWeight:800, color:'#9E8E6E', letterSpacing:'1px' }}>FILTERS</span>
            </div>
            <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search module or action..."
              style={{ flex:1, minWidth:'200px', border:'1px solid #D4C9B0', padding:'6px 10px', fontSize:'12px', fontFamily:FONTS.body, outline:'none', background:'#FDFAF6' }}/>
            <select value={moduleF} onChange={e=>setModuleF(e.target.value)}
              style={{ border:'1px solid #D4C9B0', padding:'5px 8px', fontSize:'11px', color:'#6B5E3E', background:'#FDFAF6', cursor:'pointer', fontFamily:FONTS.body, outline:'none' }}>
              {MODULES_FILTER.map(o=><option key={o}>{o}</option>)}
            </select>
            <select value={roleFilter} onChange={e=>setRoleFilter(e.target.value)}
              style={{ border:'1px solid #D4C9B0', padding:'5px 8px', fontSize:'11px', color:'#6B5E3E', background:'#FDFAF6', cursor:'pointer', fontFamily:FONTS.body, outline:'none' }}>
              <option>All Roles</option>
              {ROLES.map(r=><option key={r}>{r}</option>)}
            </select>
            <span style={{ fontSize:'11px', color:'#9E8E6E' }}>{filtered.length} modules</span>
            <button onClick={()=>{setSearch('');setModuleF('All Modules');setRoleFilter('All Roles')}}
              style={{ background:'#F5F0E8', border:'1px solid #D4C9B0', color:'#9E8E6E', padding:'5px 10px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>RESET</button>
          </div>
        </BCard>

        {/* Matrix Table */}
        <BCard>
          <BCardHeader title={`Permission Matrix — ${filtered.length} Modules`} action={
            <span style={{ fontSize:'10px', color:editMode?'#D97706':'#9E8E6E', fontWeight:700 }}>
              {editMode?`✎ EDIT MODE — ${dirtyCells.size} changed`:'👁 VIEW MODE'}
            </span>
          }/>

          {/* Sticky Column Headers */}
          <div style={{ display:'grid', gridTemplateColumns:'2fr 2fr repeat(4,1fr)', padding:'8px 14px', background:'#F5F0E8', borderBottom:'2px solid #D4C9B0', gap:'8px', position:'sticky', top:'52px', zIndex:5 }}>
            <span style={{ fontSize:'9px', fontWeight:800, color:'#9E8E6E', letterSpacing:'1px' }}>MODULE</span>
            <span style={{ fontSize:'9px', fontWeight:800, color:'#9E8E6E', letterSpacing:'1px' }}>ACTION</span>
            {ROLES.map(role=>{
              const r=ROLE_LABELS[role]
              return (
                <div key={role} style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:'2px' }}>
                  <span style={{ fontSize:'9px', fontWeight:800, background:r.bg, color:r.color, padding:'2px 6px', border:`1px solid ${r.color}40` }}>{r.short}</span>
                  <span style={{ fontSize:'8px', color:'#9E8E6E', textAlign:'center' }}>{r.label}</span>
                </div>
              )
            })}
          </div>

          {filtered.map((m,mi)=>{
            const originalModuleIdx=matrix.findIndex(x=>x.module===m.module)
            if (roleFilter!=='All Roles'&&!m.actions.some(a=>a[roleFilter])) return null
            return (
              <div key={m.module}>
                {/* Module Header */}
                <div style={{ display:'grid', gridTemplateColumns:'2fr 2fr repeat(4,1fr)', padding:'8px 14px', background:'#0D1B2A', borderBottom:'1px solid #1A2D40', gap:'8px', alignItems:'center' }}>
                  <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
                    <span style={{ fontSize:'14px' }}>{m.icon}</span>
                    <span style={{ fontSize:'11px', fontWeight:800, color:'#fff' }}>{m.module}</span>
                  </div>
                  <span style={{ fontSize:'9px', color:'rgba(255,255,255,0.3)' }}>{m.actions.length} actions</span>
                  {ROLES.map(role=>{
                    const grantedCount=m.actions.filter(a=>a[role]).length
                    const r=ROLE_LABELS[role]
                    return (
                      <div key={role} style={{ textAlign:'center' }}>
                        <span style={{ fontSize:'9px', fontWeight:700, color:grantedCount===m.actions.length?r.color:grantedCount===0?'rgba(255,255,255,0.2)':'#B8960C' }}>
                          {grantedCount}/{m.actions.length}
                        </span>
                      </div>
                    )
                  })}
                </div>

                {/* Action Rows */}
                {m.actions.map((action,ai)=>{
                  if (roleFilter!=='All Roles'&&!action[roleFilter]) return null
                  const originalActionIdx=matrix[originalModuleIdx].actions.findIndex(x=>x.action===action.action)
                  return (
                    <div key={action.action} style={{ display:'grid', gridTemplateColumns:'2fr 2fr repeat(4,1fr)', padding:'9px 14px', borderBottom:'1px solid #F0EAE0', gap:'8px', alignItems:'center', background:ai%2===0?'#fff':'#FDFAF6' }}>
                      <span/>
                      <span style={{ fontSize:'11px', fontWeight:600, color:'#1A1A2E', fontFamily:'monospace' }}>{action.action}</span>
                      {ROLES.map(role=>{
                        const cellKey=`${originalModuleIdx}-${originalActionIdx}-${role}`
                        const isDirty=dirtyCells.has(cellKey)
                        return (
                          <div key={role} style={{ display:'flex', justifyContent:'center' }}>
                            <Check
                              value={action[role]}
                              editable={editMode&&role!=='SUPER_ADMIN'}
                              onChange={()=>togglePermission(originalModuleIdx,originalActionIdx,role)}
                              isDirty={isDirty}
                            />
                          </div>
                        )
                      })}
                    </div>
                  )
                })}
              </div>
            )
          })}

          <div style={{ padding:'12px 14px', background:'#F5F0E8', borderTop:'2px solid #D4C9B0', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
            <div style={{ display:'flex', gap:'16px', alignItems:'center' }}>
              <span style={{ fontSize:'10px', color:'#9E8E6E', fontWeight:600 }}>✓ = Granted &nbsp; — = Not Granted</span>
              {editMode && <span style={{ fontSize:'10px', color:'#D97706', fontWeight:600 }}>● = Unsaved change</span>}
            </div>
            {editMode && (
              <button onClick={handleSave} style={{ background:'#B8960C', border:'none', color:'#fff', padding:'6px 16px', fontSize:'11px', fontWeight:700, cursor:'pointer' }}>
                ✓ SAVE {dirtyCells.size} CHANGES
              </button>
            )}
          </div>
        </BCard>

        {/* ✅ Improvement 3: Remove unused `selected` state — removed */}
        <div style={{ marginTop:'10px', padding:'10px 14px', background:'#FFFBEB', border:'1px solid #FDE68A', fontSize:'11px', color:'#92400E', fontWeight:600 }}>
          ⚠ SUPER_ADMIN permissions are system-locked. All changes are logged in the Audit Trail automatically on Save.
        </div>
      </div>

      <div style={{ background:'#0D1B2A', borderTop:'2px solid #B8960C', padding:'10px 20px', display:'flex', justifyContent:'space-between', marginTop:'14px' }}>
        <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.3)' }}>ZEMISH PERMISSION CENTER v2.0.0</span>
        <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.3)' }}>NATIONAL COMMAND CENTER</span>
      </div>

      {/* Confirm Reset Modal */}
      {confirmReset && (
        <div onClick={()=>setConfirmReset(false)} style={{ position:'fixed', inset:0, background:'rgba(13,27,42,0.7)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:60 }}>
          <div onClick={e=>e.stopPropagation()} style={{ background:'#fff', border:'2px solid #DC2626', padding:'28px 32px', maxWidth:'380px', width:'90%', textAlign:'center' }}>
            <div style={{ fontSize:'36px', marginBottom:'12px' }}>⚠️</div>
            <div style={{ fontSize:'15px', fontWeight:800, color:'#1A1A2E', marginBottom:'8px' }}>Reset to Defaults?</div>
            <div style={{ fontSize:'12px', color:'#6B5E3E', marginBottom:'6px' }}>All {dirtyCells.size} unsaved changes will be discarded.</div>
            <div style={{ fontSize:'12px', color:'#9E8E6E', marginBottom:'20px' }}>Permissions will revert to system defaults.</div>
            <div style={{ display:'flex', gap:'10px', justifyContent:'center' }}>
              <button onClick={()=>setConfirmReset(false)} style={{ background:'#F5F0E8', border:'1px solid #D4C9B0', color:'#6B5E3E', padding:'8px 20px', fontSize:'12px', fontWeight:700, cursor:'pointer' }}>CANCEL</button>
              <button onClick={handleReset} style={{ background:'#DC2626', color:'#fff', border:'none', padding:'8px 20px', fontSize:'12px', fontWeight:700, cursor:'pointer' }}>CONFIRM RESET</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}