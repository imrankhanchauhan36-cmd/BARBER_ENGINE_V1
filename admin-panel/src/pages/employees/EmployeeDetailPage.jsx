import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { FONTS } from '../../config/brand'
import useAuthStore from '../../store/authStore'

const ADMIN_LEVELS  = { SUPER_ADMIN:'SUPER_ADMIN', INDIA_ADMIN:'INDIA_ADMIN', STATE_ADMIN:'STATE_ADMIN', DISTRICT_ADMIN:'DISTRICT_ADMIN' }
const canEdit       = (l) => [ADMIN_LEVELS.SUPER_ADMIN, ADMIN_LEVELS.INDIA_ADMIN].includes(l)
const canDeactivate = (l) => l === ADMIN_LEVELS.SUPER_ADMIN
const canChangeRole = (l) => l === ADMIN_LEVELS.SUPER_ADMIN

const EMPLOYEES_DB = {
  'EMP000': {
    id:'EMP000', name:'National Super Admin', email:'superadmin@zemish.in', phone:'9800000000',
    role:'SUPER_ADMIN', state:null, district:null, status:'ACTIVE',
    joinedAt:'2023-01-01', lastLogin:'2026-06-23 07:00', loginCount:2840,
    permissions:['ALL_ACCESS'],
    loginHistory:[
      { date:'2026-06-23 07:00', ip:'103.x.x.x', device:'Chrome / Mac',    status:'SUCCESS' },
      { date:'2026-06-22 08:00', ip:'103.x.x.x', device:'Chrome / Mac',    status:'SUCCESS' },
      { date:'2026-06-21 07:30', ip:'103.x.x.x', device:'Safari / iPhone', status:'SUCCESS' },
    ],
    audit:[
      { date:'2026-06-23 07:00', action:'Login — Chrome/Mac',              by:'System'      },
      { date:'2023-01-01 10:00', action:'Super Admin account created',     by:'System'      },
    ],
  },
  'EMP006': {
    id:'EMP006', name:'Amit Verma', email:'amit.verma@zemish.in', phone:'9889012345',
    role:'INDIA_ADMIN', state:null, district:null, status:'ACTIVE',
    joinedAt:'2023-12-01', lastLogin:'2026-06-23 07:30', loginCount:1240,
    permissions:['VIEW_ALL','APPROVE_KYC','RESOLVE_DISPUTES','MANAGE_PROVIDERS','FREEZE_WALLET','EXPORT'],
    loginHistory:[
      { date:'2026-06-23 07:30', ip:'182.x.x.x', device:'Chrome / Windows', status:'SUCCESS' },
      { date:'2026-06-22 09:00', ip:'182.x.x.x', device:'Chrome / Windows', status:'SUCCESS' },
      { date:'2026-06-21 08:45', ip:'182.x.x.x', device:'Firefox / Windows',status:'SUCCESS' },
      { date:'2026-06-20 07:00', ip:'45.x.x.x',  device:'Unknown',          status:'FAILED'  },
    ],
    audit:[
      { date:'2026-06-23 07:30', action:'Login — Chrome/Windows',          by:'System'      },
      { date:'2026-06-20 07:00', action:'Failed login attempt — blocked',  by:'System'      },
      { date:'2026-06-18 11:00', action:'KYC approved — PRV004',          by:'Amit Verma'  },
      { date:'2023-12-01 09:00', action:'India Admin account created',     by:'Super Admin' },
    ],
  },
  'EMP001': {
    id:'EMP001', name:'Rajesh Kumar', email:'rajesh.kumar@zemish.in', phone:'9812345678',
    role:'STATE_ADMIN', state:'UP', district:null, status:'ACTIVE',
    joinedAt:'2024-01-15', lastLogin:'2026-06-23 09:30', loginCount:842,
    permissions:['VIEW_STATE','APPROVE_SALONS','MANAGE_DISTRICTS','EXPORT_STATE'],
    loginHistory:[
      { date:'2026-06-23 09:30', ip:'49.x.x.x',  device:'Chrome / Android', status:'SUCCESS' },
      { date:'2026-06-22 10:00', ip:'49.x.x.x',  device:'Chrome / Android', status:'SUCCESS' },
      { date:'2026-06-21 09:00', ip:'49.x.x.x',  device:'Safari / iPhone',  status:'SUCCESS' },
    ],
    audit:[
      { date:'2026-06-23 09:30', action:'Login — Chrome/Android',          by:'System'      },
      { date:'2026-06-22 11:00', action:'Salon approved — SAL024',        by:'Rajesh Kumar' },
      { date:'2024-01-15 09:00', action:'State Admin account created',    by:'India Admin' },
    ],
  },
  'EMP008': {
    id:'EMP008', name:'Deepak Yadav', email:'deepak.yadav@zemish.in', phone:'9901234567',
    role:'DISTRICT_ADMIN', state:'RJ', district:'Jaipur', status:'INACTIVE',
    joinedAt:'2024-06-01', lastLogin:'2026-05-10 09:00', loginCount:180,
    deactivatedBy:'Super Admin', deactivatedAt:'2026-05-15', deactivateReason:'Performance issues — repeated complaints',
    permissions:['VIEW_DISTRICT','RECOMMEND_SALONS'],
    loginHistory:[
      { date:'2026-05-10 09:00', ip:'117.x.x.x', device:'Chrome / Windows', status:'SUCCESS' },
      { date:'2026-05-08 10:00', ip:'117.x.x.x', device:'Chrome / Windows', status:'SUCCESS' },
    ],
    audit:[
      { date:'2026-05-15 02:00', action:'Account DEACTIVATED — Performance issues', by:'Super Admin' },
      { date:'2026-05-10 09:00', action:'Login — Chrome/Windows',                  by:'System'      },
      { date:'2024-06-01 09:00', action:'District Admin account created',          by:'India Admin' },
    ],
  },
}

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

const NotFound = ({onBack}) => (
  <div style={{ fontFamily:FONTS.body, background:'#F0EAE0', minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center' }}>
    <div style={{ background:'#fff', border:'2px solid #D4C9B0', borderTop:'2px solid #B8960C', padding:'40px', textAlign:'center', maxWidth:'400px' }}>
      <div style={{ fontSize:'40px', marginBottom:'16px' }}>🔍</div>
      <div style={{ fontSize:'16px', fontWeight:800, color:'#1A1A2E', marginBottom:'8px' }}>Employee Not Found</div>
      <button onClick={onBack} style={{ background:'#0D1B2A', color:'#B8960C', border:'none', padding:'8px 20px', fontSize:'12px', fontWeight:700, cursor:'pointer' }}>← GO BACK</button>
    </div>
  </div>
)

export default function EmployeeDetailPage() {
  const { id }     = useParams()
  const navigate   = useNavigate()
  const admin      = useAuthStore(s=>s.admin)
  const adminLevel = admin?.adminLevel||ADMIN_LEVELS.SUPER_ADMIN
  const hasEdit    = canEdit(adminLevel)
  const hasDeact   = canDeactivate(adminLevel)
  const hasRoleChg = canChangeRole(adminLevel)

  if (![ADMIN_LEVELS.SUPER_ADMIN, ADMIN_LEVELS.INDIA_ADMIN].includes(adminLevel)) {
    return (
      <div style={{ fontFamily:FONTS.body, background:'#F0EAE0', minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center' }}>
        <div style={{ background:'#fff', border:'2px solid #DC2626', padding:'40px', textAlign:'center', maxWidth:'400px' }}>
          <div style={{ fontSize:'40px', marginBottom:'16px' }}>🔒</div>
          <div style={{ fontSize:'16px', fontWeight:800, color:'#1A1A2E', marginBottom:'8px' }}>Access Denied</div>
          <div style={{ fontSize:'13px', color:'#9E8E6E' }}>Only SUPER_ADMIN and INDIA_ADMIN can view employee details.</div>
          <button onClick={()=>navigate(-1)} style={{ background:'#0D1B2A', color:'#B8960C', border:'none', padding:'8px 20px', fontSize:'12px', fontWeight:700, cursor:'pointer', marginTop:'16px' }}>← GO BACK</button>
        </div>
      </div>
    )
  }

  const rawEmp = EMPLOYEES_DB[id]
  if (!rawEmp) return <NotFound onBack={()=>navigate('/app/employees')}/>

  const [tab,  setTab]  = useState('overview')
  const [toast,setToast]= useState(null)
  const [emp,  setEmp]  = useState(rawEmp)
  const [editingRole, setEditingRole] = useState(false)
  const [newRole,     setNewRole]     = useState(rawEmp.role)

  // ✅ Fix 1 — after useState so emp is defined
  const isSelf     = admin?.id===emp.id || admin?.email===emp.email
  const isSuperEmp = emp.role===ADMIN_LEVELS.SUPER_ADMIN

  const showToast = (msg,color) => { setToast({msg,color}); setTimeout(()=>setToast(null),3000) }

  const handleDeactivate = () => {
    const isActive = emp.status==='ACTIVE'
    const auditEntry = { date:new Date().toLocaleString('en-IN',{hour12:false}), action:isActive?'Account DEACTIVATED by admin':'Account REACTIVATED by admin', by:adminLevel }
    setEmp(e=>({ ...e, status:isActive?'INACTIVE':'ACTIVE', deactivatedBy:isActive?adminLevel:null, deactivatedAt:isActive?new Date().toISOString().split('T')[0]:null, audit:[auditEntry,...e.audit] }))
    showToast(isActive?`⊘ ${emp.name} deactivated`:`✓ ${emp.name} reactivated`, isActive?'#DC2626':'#059669')
  }

  const handleRoleChange = () => {
    if (newRole===emp.role) { setEditingRole(false); return }
    const auditEntry = { date:new Date().toLocaleString('en-IN',{hour12:false}), action:`Role changed: ${emp.role} → ${newRole}`, by:adminLevel }
    setEmp(e=>({ ...e, role:newRole, audit:[auditEntry,...e.audit] }))
    showToast(`✓ Role updated to ${newRole}`, '#059669')
    setEditingRole(false)
  }

  const sc  = STATUS_COLORS[emp.status]||STATUS_COLORS.INACTIVE
  const rc  = ROLE_COLORS[emp.role]||ROLE_COLORS.DISTRICT_ADMIN
  const TABS= ['overview','permissions','login-history','audit']
  const assignedTo = emp.role==='INDIA_ADMIN'||emp.role==='SUPER_ADMIN'?'PAN India':emp.role==='STATE_ADMIN'?`${emp.state} State`:`${emp.district}, ${emp.state}`

  return (
    <div style={{ fontFamily:FONTS.body, background:'#F0EAE0', minHeight:'100vh' }}>
      {toast && <div style={{ position:'fixed', top:'20px', right:'20px', background:toast.color, color:'#fff', padding:'12px 20px', fontSize:'13px', fontWeight:700, zIndex:9999, boxShadow:'0 4px 12px rgba(0,0,0,0.2)' }}>{toast.msg}</div>}

      {/* Header */}
      <div style={{ background:'#0D1B2A', borderBottom:'2px solid #B8960C', padding:'0 20px', height:'52px', display:'flex', alignItems:'center', justifyContent:'space-between', position:'sticky', top:0, zIndex:10 }}>
        <div style={{ display:'flex', alignItems:'center', gap:'12px' }}>
          <button onClick={()=>navigate('/app/employees')} style={{ background:'rgba(255,255,255,0.07)', border:'1px solid rgba(255,255,255,0.1)', color:'rgba(255,255,255,0.6)', padding:'5px 10px', cursor:'pointer', fontSize:'12px', fontWeight:700 }}>← BACK</button>
          <div style={{ width:'3px', height:'16px', background:'#B8960C' }}/>
          <div>
            <div style={{ color:'#fff', fontWeight:800, fontSize:'13px', letterSpacing:'1px' }}>{emp.name}</div>
            <div style={{ color:'#B8960C', fontSize:'9px', letterSpacing:'1px', marginTop:'1px' }}>{emp.id} • {emp.email} • Joined {emp.joinedAt}</div>
          </div>
          <span style={{ fontSize:'10px', fontWeight:800, background:rc.bg, color:rc.color, border:`1px solid ${rc.border}`, padding:'3px 8px' }}>{emp.role.replace(/_/g,' ')}</span>
          <span style={{ fontSize:'10px', fontWeight:800, background:sc.bg, color:sc.color, padding:'3px 8px' }}>{emp.status}</span>
        </div>
        <div style={{ display:'flex', gap:'8px' }}>
          {hasDeact && !isSelf && !isSuperEmp && (
            <button onClick={handleDeactivate}
              style={{ background:emp.status==='ACTIVE'?'rgba(220,38,38,0.2)':'rgba(5,150,105,0.2)', border:`1px solid ${emp.status==='ACTIVE'?'rgba(220,38,38,0.5)':'rgba(5,150,105,0.5)'}`, color:emp.status==='ACTIVE'?'#FCA5A5':'#6EE7B7', padding:'6px 12px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>
              {emp.status==='ACTIVE'?'⊘ DEACTIVATE':'✓ REACTIVATE'}
            </button>
          )}
          {isSelf && (
            <div style={{ background:'rgba(217,119,6,0.15)', border:'1px solid rgba(217,119,6,0.4)', color:'#FDE68A', padding:'6px 12px', fontSize:'10px', fontWeight:700 }}>⚠ Cannot deactivate yourself</div>
          )}
          {isSuperEmp && !isSelf && (
            <div style={{ background:'rgba(220,38,38,0.1)', border:'1px solid rgba(220,38,38,0.2)', color:'rgba(220,38,38,0.5)', padding:'6px 12px', fontSize:'10px', fontWeight:700 }}>⊘ Super Admin protected</div>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div style={{ background:'#0A1520', borderBottom:'1px solid rgba(184,150,12,0.2)', display:'flex', padding:'0 20px' }}>
        {TABS.map(t=>(
          <button key={t} onClick={()=>setTab(t)} style={{ padding:'10px 16px', border:'none', background:'none', cursor:'pointer', fontSize:'10px', fontWeight:tab===t?800:400, color:tab===t?'#B8960C':'rgba(255,255,255,0.35)', borderBottom:tab===t?'2px solid #B8960C':'2px solid transparent', letterSpacing:'1.5px', textTransform:'uppercase', whiteSpace:'nowrap' }}>
            {t.replace('-',' ')}
            {t==='audit'&&<span style={{ marginLeft:'5px', background:'rgba(220,38,38,0.3)', color:'#FCA5A5', fontSize:'9px', padding:'1px 5px' }}>{emp.audit.length}</span>}
          </button>
        ))}
      </div>

      {/* KPI Strip */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:'1px', background:'#D4C9B0', borderBottom:'2px solid #B8960C' }}>
        {[
          { label:'Role',        value:emp.role.replace(/_/g,' '), color:rc.color },
          { label:'Assigned To', value:assignedTo,                 color:'#B8960C' },
          { label:'Total Logins',value:emp.loginCount,             color:'#7C3AED' },
          { label:'Last Login',  value:emp.lastLogin.split(' ')[0],color:'#9E8E6E' },
        ].map(k=>(
          <div key={k.label} style={{ background:'#0D1B2A', padding:'10px 16px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
            <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.4)' }}>{k.label}</span>
            <span style={{ fontSize:'13px', fontWeight:800, color:k.color }}>{k.value}</span>
          </div>
        ))}
      </div>

      {emp.status==='INACTIVE' && (
        <div style={{ background:'#FEF2F2', borderBottom:'2px solid #DC2626', padding:'10px 20px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <span style={{ fontSize:'12px', color:'#991B1B', fontWeight:700 }}>⊘ DEACTIVATED — {emp.deactivateReason} • By {emp.deactivatedBy} on {emp.deactivatedAt}</span>
          {hasDeact && !isSelf && !isSuperEmp && <button onClick={handleDeactivate} style={{ background:'#059669', color:'#fff', border:'none', padding:'5px 12px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>✓ REACTIVATE</button>}
        </div>
      )}

      <div style={{ padding:'16px 20px' }}>

        {/* OVERVIEW */}
        {tab==='overview' && (
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:'14px' }}>
            <BCard>
              <BCardHeader title="Employee Profile"/>
              <div style={{ padding:'14px' }}>
                <div style={{ display:'flex', alignItems:'center', gap:'12px', padding:'12px', background:'#F5F0E8', border:'1px solid #E8DFD0', borderTop:'2px solid #B8960C', marginBottom:'14px' }}>
                  <div style={{ width:'44px', height:'44px', background:'#0D1B2A', display:'flex', alignItems:'center', justifyContent:'center', color:'#B8960C', fontSize:'18px', fontWeight:800, flexShrink:0 }}>{emp.name[0]}</div>
                  <div>
                    <div style={{ fontSize:'15px', fontWeight:800, color:'#1A1A2E' }}>{emp.name}</div>
                    <div style={{ fontSize:'10px', color:'#9E8E6E', marginTop:'2px' }}>Employee • {emp.id}</div>
                  </div>
                </div>
                <SLabel title="Contact"/>
                <InfoRow label="Email"    value={emp.email}/>
                <InfoRow label="Phone"    value={emp.phone}/>
                <SLabel title="Assignment"/>
                <InfoRow label="Role"     value={emp.role.replace(/_/g,' ')} valueColor={rc.color}/>
                <InfoRow label="Territory"value={assignedTo}/>
                {emp.state && <InfoRow label="State"  value={emp.state}/>}
                {emp.district && <InfoRow label="District" value={emp.district}/>}
                <SLabel title="Account"/>
                <InfoRow label="Status"   value={emp.status}   valueColor={sc.color}/>
                <InfoRow label="Joined"   value={emp.joinedAt}/>
              </div>
            </BCard>

            <BCard>
              <BCardHeader title="Activity Stats"/>
              <div style={{ padding:'14px' }}>
                <div style={{ background:'#0D1B2A', padding:'16px', marginBottom:'14px', textAlign:'center', borderTop:'2px solid #B8960C' }}>
                  <div style={{ fontSize:'10px', color:'rgba(255,255,255,0.4)', letterSpacing:'1px', marginBottom:'6px' }}>TOTAL LOGINS</div>
                  <div style={{ fontSize:'32px', fontWeight:800, color:'#B8960C' }}>{emp.loginCount}</div>
                </div>
                <InfoRow label="Last Login"   value={emp.lastLogin}/>
                <InfoRow label="Last Login Device" value={emp.loginHistory[0]?.device||'—'}/>
                <InfoRow label="Failed Logins" value={emp.loginHistory.filter(l=>l.status==='FAILED').length} valueColor="#DC2626"/>
                <InfoRow label="Permissions"  value={emp.permissions.length}/>
                <InfoRow label="Joined At"    value={emp.joinedAt}/>
              </div>
            </BCard>

            <BCard>
              <BCardHeader title="Role Management" action={
                hasRoleChg && !editingRole && !isSuperEmp
                  ? <button onClick={()=>setEditingRole(true)} style={{ background:'#B8960C', color:'#0D1B2A', border:'none', padding:'4px 10px', fontSize:'9px', fontWeight:800, cursor:'pointer' }}>CHANGE ROLE</button>
                  : isSuperEmp ? <span style={{ fontSize:'10px', color:'#DC2626', fontWeight:700 }}>🔒 PROTECTED</span> : null
              }/>
              <div style={{ padding:'14px' }}>
                {isSuperEmp && (
                  <div style={{ padding:'12px', background:'#FEF2F2', border:'1px solid #FEE2E2', fontSize:'11px', color:'#991B1B', fontWeight:600, marginBottom:'12px' }}>
                    🔒 SUPER_ADMIN role cannot be changed or downgraded.
                  </div>
                )}
                {editingRole ? (
                  <>
                    <div style={{ marginBottom:'12px', padding:'10px', background:'#FFFBEB', border:'1px solid #FDE68A', fontSize:'11px', color:'#92400E', fontWeight:600 }}>
                      ⚠ Changing role will update employee's access level. Action logged in audit.
                    </div>
                    <select value={newRole} onChange={e=>setNewRole(e.target.value)}
                      style={{ width:'100%', border:'1px solid #D4C9B0', padding:'8px', fontSize:'13px', fontFamily:FONTS.body, outline:'none', marginBottom:'12px' }}>
                      {Object.keys(ROLE_COLORS).map(r=><option key={r} value={r}>{r.replace(/_/g,' ')}</option>)}
                    </select>
                    <div style={{ display:'flex', gap:'8px' }}>
                      <button onClick={()=>setEditingRole(false)} style={{ flex:1, background:'#fff', border:'1px solid #D4C9B0', color:'#6B5E3E', padding:'8px', fontSize:'11px', fontWeight:700, cursor:'pointer' }}>CANCEL</button>
                      <button onClick={handleRoleChange} style={{ flex:1, background:'#B8960C', border:'none', color:'#0D1B2A', padding:'8px', fontSize:'11px', fontWeight:800, cursor:'pointer' }}>✓ CONFIRM</button>
                    </div>
                  </>
                ) : (
                  <>
                    <div style={{ padding:'16px', background:rc.bg, border:`1px solid ${rc.border}`, borderTop:`2px solid ${rc.color}`, textAlign:'center', marginBottom:'14px' }}>
                      <div style={{ fontSize:'14px', fontWeight:800, color:rc.color }}>{emp.role.replace(/_/g,' ')}</div>
                      <div style={{ fontSize:'10px', color:'#9E8E6E', marginTop:'4px' }}>Current Role</div>
                    </div>
                    <InfoRow label="Can Approve KYC"    value={['SUPER_ADMIN','INDIA_ADMIN','STATE_ADMIN'].includes(emp.role)?'✓ Yes':'✗ No'} valueColor={['SUPER_ADMIN','INDIA_ADMIN','STATE_ADMIN'].includes(emp.role)?'#059669':'#DC2626'}/>
                    <InfoRow label="Can Freeze Wallet"  value={['SUPER_ADMIN','INDIA_ADMIN'].includes(emp.role)?'✓ Yes':'✗ No'} valueColor={['SUPER_ADMIN','INDIA_ADMIN'].includes(emp.role)?'#059669':'#DC2626'}/>
                    <InfoRow label="Can Block User"     value={['SUPER_ADMIN','INDIA_ADMIN'].includes(emp.role)?'✓ Yes':'✗ No'} valueColor={['SUPER_ADMIN','INDIA_ADMIN'].includes(emp.role)?'#059669':'#DC2626'}/>
                    <InfoRow label="Can Export"         value={emp.role!=='DISTRICT_ADMIN'?'✓ Yes':'✗ No'} valueColor={emp.role!=='DISTRICT_ADMIN'?'#059669':'#DC2626'}/>
                    {!hasRoleChg && <div style={{ marginTop:'10px', fontSize:'11px', color:'#9E8E6E', fontStyle:'italic', textAlign:'center' }}>Role change requires SUPER_ADMIN</div>}
                  </>
                )}
              </div>
            </BCard>
          </div>
        )}

        {/* PERMISSIONS */}
        {tab==='permissions' && (
          <BCard>
            <BCardHeader title={`Permission Set — ${emp.role.replace(/_/g,' ')}`}/>
            <div style={{ padding:'16px', display:'grid', gridTemplateColumns:'1fr 1fr', gap:'12px' }}>
              {[
                { label:'View Dashboard',        granted:true  },
                { label:'View All Salons',        granted:true  },
                { label:'Approve Salons',         granted:['SUPER_ADMIN','INDIA_ADMIN','STATE_ADMIN'].includes(emp.role) },
                { label:'Approve KYC',            granted:['SUPER_ADMIN','INDIA_ADMIN','STATE_ADMIN'].includes(emp.role) },
                { label:'Reject KYC',             granted:['SUPER_ADMIN','INDIA_ADMIN'].includes(emp.role) },
                { label:'Block Users',            granted:['SUPER_ADMIN','INDIA_ADMIN'].includes(emp.role) },
                { label:'Freeze Wallet',          granted:['SUPER_ADMIN','INDIA_ADMIN'].includes(emp.role) },
                { label:'Resolve Disputes',       granted:['SUPER_ADMIN','INDIA_ADMIN','STATE_ADMIN'].includes(emp.role) },
                { label:'Export Data',            granted:['SUPER_ADMIN','INDIA_ADMIN','STATE_ADMIN'].includes(emp.role) },
                { label:'Manage Employees',       granted:['SUPER_ADMIN','INDIA_ADMIN'].includes(emp.role) },
                { label:'Territory Control',      granted:['SUPER_ADMIN','INDIA_ADMIN'].includes(emp.role) },
                { label:'View Finance Reports',   granted:['SUPER_ADMIN','INDIA_ADMIN','STATE_ADMIN'].includes(emp.role) },
                { label:'Manage Admin Assignment',granted:['SUPER_ADMIN','INDIA_ADMIN'].includes(emp.role) },
                { label:'PII Access',             granted:['SUPER_ADMIN','INDIA_ADMIN'].includes(emp.role) },
              ].map((p,i)=>(
                <div key={i} style={{ display:'flex', alignItems:'center', gap:'10px', padding:'10px 12px', background:p.granted?'#F0FDF4':'#FEF2F2', border:`1px solid ${p.granted?'#D1FAE5':'#FEE2E2'}`, borderLeft:`3px solid ${p.granted?'#059669':'#DC2626'}` }}>
                  <div style={{ width:'20px', height:'20px', background:p.granted?'#059669':'#DC2626', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                    <span style={{ color:'#fff', fontSize:'11px', fontWeight:800 }}>{p.granted?'✓':'✗'}</span>
                  </div>
                  <span style={{ fontSize:'12px', color:p.granted?'#065F46':'#991B1B', fontWeight:p.granted?600:400 }}>{p.label}</span>
                </div>
              ))}
            </div>
          </BCard>
        )}

        {/* LOGIN HISTORY */}
        {tab==='login-history' && (
          <BCard>
            <BCardHeader title={`Login History (${emp.loginHistory.length})`}/>
            <div style={{ display:'grid', gridTemplateColumns:'1.5fr 1.5fr 1.5fr 0.8fr', padding:'8px 14px', background:'#F5F0E8', borderBottom:'1px solid #E8DFD0', gap:'8px' }}>
              {['DATE & TIME','IP ADDRESS','DEVICE','STATUS'].map(h=>(
                <span key={h} style={{ fontSize:'9px', fontWeight:800, color:'#9E8E6E', letterSpacing:'1px' }}>{h}</span>
              ))}
            </div>
            {emp.loginHistory.map((l,i)=>(
              <div key={i} style={{ display:'grid', gridTemplateColumns:'1.5fr 1.5fr 1.5fr 0.8fr', padding:'11px 14px', borderBottom:'1px solid #F0EAE0', alignItems:'center', gap:'8px', background:l.status==='FAILED'?'#FEF2F2':i%2===0?'#fff':'#FDFAF6' }}>
                <span style={{ fontSize:'11px', color:'#6B5E3E', fontFamily:'monospace' }}>{l.date}</span>
                <span style={{ fontSize:'11px', color:'#9E8E6E', fontFamily:'monospace' }}>{l.ip}</span>
                <span style={{ fontSize:'11px', color:'#6B5E3E' }}>{l.device}</span>
                <span style={{ fontSize:'9px', fontWeight:800, background:l.status==='SUCCESS'?'#D1FAE5':'#FEE2E2', color:l.status==='SUCCESS'?'#065F46':'#991B1B', padding:'2px 6px', display:'inline-block' }}>{l.status}</span>
              </div>
            ))}
            <div style={{ padding:'10px 14px', background:'#FFFBEB', borderTop:'1px solid #FDE68A', fontSize:'11px', color:'#92400E', fontWeight:600 }}>
              ⚠ Failed logins trigger automatic security alerts.
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
            {emp.audit.map((a,i)=>(
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
        <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.3)' }}>ZEMISH EMPLOYEE DETAIL v1.0.0</span>
        <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.3)' }}>NATIONAL COMMAND CENTER</span>
      </div>
    </div>
  )
}