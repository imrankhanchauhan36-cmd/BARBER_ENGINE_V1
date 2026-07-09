import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FONTS } from '../../config/brand'
import useAuthStore from '../../store/authStore'

const ADMIN_LEVELS = { SUPER_ADMIN:'SUPER_ADMIN', INDIA_ADMIN:'INDIA_ADMIN', STATE_ADMIN:'STATE_ADMIN', DISTRICT_ADMIN:'DISTRICT_ADMIN' }

const ROLES_DATA = [
  {
    id:'ROLE001', name:'SUPER_ADMIN', label:'Super Admin',
    color:'#DC2626', bg:'#FEF2F2', border:'#DC2626',
    count:1, description:'Full system access. Can manage all modules, employees, roles, and configurations.',
    scope:'PAN India — All Modules',
    permissions:{
      dashboard:true, salons:true, users:true, providers:true,
      kyc_approve:true, kyc_reject:true, manage_provider_kyc:true,
      bookings:true, finance:true, disputes_resolve:true, employees:true,
      roles:true, territory_control:true, export:true, pii_access:true,
      bulk_actions:true, audit_view:true, freeze_wallet:true,
      block_user:true, deactivate_employee:true, change_role:true,
      send_notifications:true,
    }
  },
  {
    id:'ROLE002', name:'INDIA_ADMIN', label:'India Admin',
    color:'#7C3AED', bg:'#F5F3FF', border:'#7C3AED',
    count:1, description:'National level admin. Full operational access. Can view roles but cannot edit them.',
    scope:'PAN India — Operations',
    permissions:{
      dashboard:true, salons:true, users:true, providers:true,
      kyc_approve:true, kyc_reject:true, manage_provider_kyc:true,
      bookings:true, finance:true, disputes_resolve:true, employees:true,
      roles:true, territory_control:true, export:true, pii_access:true,
      bulk_actions:false, audit_view:true, freeze_wallet:true,
      block_user:true, deactivate_employee:false, change_role:false,
      send_notifications:true,
    }
  },
  {
    id:'ROLE003', name:'STATE_ADMIN', label:'State Admin',
    color:'#2563EB', bg:'#EFF6FF', border:'#2563EB',
    count:3, description:'State-level admin. Manages salons, KYC, and disputes for assigned state only.',
    scope:'Assigned State Only',
    permissions:{
      dashboard:true, salons:true, users:true, providers:true,
      kyc_approve:true, kyc_reject:false, manage_provider_kyc:true,
      bookings:true, finance:false, disputes_resolve:true, employees:false,
      roles:false, territory_control:false, export:true, pii_access:false,
      bulk_actions:false, audit_view:true, freeze_wallet:false,
      block_user:false, deactivate_employee:false, change_role:false,
      send_notifications:false,
    }
  },
  {
    id:'ROLE004', name:'DISTRICT_ADMIN', label:'District Admin',
    color:'#059669', bg:'#F0FDF4', border:'#059669',
    count:6, description:'District-level admin. Can recommend salons and view district data only.',
    scope:'Assigned District Only',
    permissions:{
      dashboard:true, salons:true, users:false, providers:false,
      kyc_approve:false, kyc_reject:false, manage_provider_kyc:false,
      bookings:false, finance:false, disputes_resolve:false, employees:false,
      roles:false, territory_control:false, export:false, pii_access:false,
      bulk_actions:false, audit_view:false, freeze_wallet:false,
      block_user:false, deactivate_employee:false, change_role:false,
      send_notifications:false,
    }
  },
]

const ALL_PERMISSIONS = [
  { key:'dashboard',              label:'View Dashboard',          group:'View' },
  { key:'salons',                 label:'View & Manage Salons',    group:'View' },
  { key:'users',                  label:'View Users',              group:'View' },
  { key:'providers',              label:'View Providers',          group:'View' },
  { key:'bookings',               label:'View Bookings',           group:'View' },
  { key:'finance',                label:'View Finance',            group:'View' },
  { key:'audit_view',             label:'View Audit Logs',         group:'View' },
  { key:'kyc_approve',            label:'Approve KYC',             group:'Operations' },
  { key:'kyc_reject',             label:'Reject KYC',              group:'Operations' },
  { key:'manage_provider_kyc',    label:'Manage Provider KYC',     group:'Operations' },
  { key:'disputes_resolve',       label:'Resolve Disputes',        group:'Operations' },
  { key:'freeze_wallet',          label:'Freeze Wallet',           group:'Operations' },
  { key:'block_user',             label:'Block/Unblock Users',     group:'Operations' },
  { key:'export',                 label:'Export Data',             group:'Operations' },
  { key:'pii_access',             label:'View PII Data',           group:'Operations' },
  { key:'send_notifications',     label:'Send Notifications',      group:'Operations' },
  { key:'employees',              label:'Manage Employees',        group:'Admin' },
  { key:'roles',                  label:'View Roles & Permissions',group:'Admin' },
  { key:'territory_control',      label:'Territory Control',       group:'Admin' },
  { key:'deactivate_employee',    label:'Deactivate Employee',     group:'Admin' },
  { key:'change_role',            label:'Change Employee Role',    group:'Admin' },
  { key:'bulk_actions',           label:'Bulk Actions',            group:'Admin' },
]

const GROUPS = ['View','Operations','Admin']

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

export default function RolesPage() {
  const navigate   = useNavigate()
  const admin      = useAuthStore(s=>s.admin)
  const adminLevel = admin?.adminLevel||ADMIN_LEVELS.SUPER_ADMIN
  const [selectedRole, setSelectedRole] = useState('ROLE001')

  if (![ADMIN_LEVELS.SUPER_ADMIN, ADMIN_LEVELS.INDIA_ADMIN].includes(adminLevel)) {
    return (
      <div style={{ fontFamily:FONTS.body, background:'#F0EAE0', minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center' }}>
        <div style={{ background:'#fff', border:'2px solid #DC2626', padding:'40px', textAlign:'center', maxWidth:'400px' }}>
          <div style={{ fontSize:'40px', marginBottom:'16px' }}>🔒</div>
          <div style={{ fontSize:'16px', fontWeight:800, color:'#1A1A2E', marginBottom:'8px' }}>Access Denied</div>
          <div style={{ fontSize:'13px', color:'#9E8E6E' }}>Only SUPER_ADMIN and INDIA_ADMIN can view Roles & Permissions.</div>
        </div>
      </div>
    )
  }

  const activeRole = ROLES_DATA.find(r=>r.id===selectedRole)||ROLES_DATA[0]
  const grantedCount = Object.values(activeRole.permissions).filter(Boolean).length

  return (
    <div style={{ fontFamily:FONTS.body, background:'#F0EAE0', minHeight:'100vh' }}>

      {/* Header */}
      <div style={{ background:'#0D1B2A', borderBottom:'2px solid #B8960C', padding:'0 20px', height:'52px', display:'flex', alignItems:'center', justifyContent:'space-between', position:'sticky', top:0, zIndex:10 }}>
        <div style={{ display:'flex', alignItems:'center', gap:'12px' }}>
          <div style={{ width:'3px', height:'16px', background:'#B8960C' }}/>
          <h1 style={{ fontSize:'13px', fontWeight:800, color:'#fff', margin:0, letterSpacing:'2px', textTransform:'uppercase' }}>Roles & Permissions</h1>
          <span style={{ background:'rgba(184,150,12,0.2)', color:'#B8960C', fontSize:'10px', fontWeight:800, padding:'2px 8px', border:'1px solid rgba(184,150,12,0.3)' }}>{ROLES_DATA.length} ROLES</span>
          <span style={{ background:'rgba(220,38,38,0.15)', color:'#FCA5A5', fontSize:'10px', fontWeight:700, padding:'2px 8px', border:'1px solid rgba(220,38,38,0.3)' }}>🔒 READ ONLY</span>
        </div>
        <div style={{ display:'flex', gap:'8px' }}>
          <button onClick={()=>navigate('/app/employees')} style={{ background:'rgba(255,255,255,0.07)', border:'1px solid rgba(255,255,255,0.15)', color:'rgba(255,255,255,0.5)', padding:'6px 12px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>← EMPLOYEES</button>
        </div>
      </div>

      <div style={{ padding:'14px 20px' }}>

        {/* Role Cards */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:'12px', marginBottom:'16px' }}>
          {ROLES_DATA.map(r=>(
            <div key={r.id} onClick={()=>setSelectedRole(r.id)}
              style={{ padding:'14px', background:selectedRole===r.id?r.color:'#fff', border:`2px solid ${selectedRole===r.id?r.color:r.border}`, cursor:'pointer', transition:'all 0.15s' }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:'8px' }}>
                <span style={{ fontSize:'12px', fontWeight:800, color:selectedRole===r.id?'#fff':r.color }}>{r.label}</span>
                <span style={{ fontSize:'16px', fontWeight:800, color:selectedRole===r.id?'rgba(255,255,255,0.8)':r.color }}>{r.count}</span>
              </div>
              <div style={{ fontSize:'10px', color:selectedRole===r.id?'rgba(255,255,255,0.7)':'#9E8E6E', marginBottom:'8px', lineHeight:'1.4' }}>{r.scope}</div>
              <div style={{ fontSize:'9px', fontWeight:700, color:selectedRole===r.id?'rgba(255,255,255,0.6)':'#6B5E3E' }}>
                {Object.values(r.permissions).filter(Boolean).length}/{ALL_PERMISSIONS.length} permissions
              </div>
              <div style={{ marginTop:'6px', height:'4px', background:selectedRole===r.id?'rgba(255,255,255,0.3)':'#E8DFD0' }}>
                <div style={{ height:'100%', width:`${(Object.values(r.permissions).filter(Boolean).length/ALL_PERMISSIONS.length)*100}%`, background:selectedRole===r.id?'rgba(255,255,255,0.9)':r.color }}/>
              </div>
            </div>
          ))}
        </div>

        {/* Permission Matrix */}
        <div style={{ display:'grid', gridTemplateColumns:'1fr 2fr', gap:'14px' }}>

          {/* Role Info */}
          <BCard>
            <BCardHeader title={activeRole.label} action={
              <span style={{ fontSize:'10px', fontWeight:800, background:activeRole.bg, color:activeRole.color, border:`1px solid ${activeRole.border}`, padding:'3px 8px' }}>
                {grantedCount}/{ALL_PERMISSIONS.length}
              </span>
            }/>
            <div style={{ padding:'14px' }}>
              <div style={{ padding:'12px', background:activeRole.bg, border:`1px solid ${activeRole.border}`, borderTop:`3px solid ${activeRole.color}`, marginBottom:'14px' }}>
                <div style={{ fontSize:'13px', fontWeight:800, color:activeRole.color, marginBottom:'6px' }}>{activeRole.label}</div>
                <div style={{ fontSize:'11px', color:'#6B5E3E', lineHeight:'1.5' }}>{activeRole.description}</div>
              </div>
              <div style={{ display:'flex', justifyContent:'space-between', padding:'8px 0', borderBottom:'1px solid #F0EAE0' }}>
                <span style={{ fontSize:'12px', color:'#9E8E6E' }}>Scope</span>
                <span style={{ fontSize:'12px', fontWeight:600, color:activeRole.color }}>{activeRole.scope}</span>
              </div>
              <div style={{ display:'flex', justifyContent:'space-between', padding:'8px 0', borderBottom:'1px solid #F0EAE0' }}>
                <span style={{ fontSize:'12px', color:'#9E8E6E' }}>Employees</span>
                <span style={{ fontSize:'12px', fontWeight:600, color:'#1A1A2E' }}>{activeRole.count} assigned</span>
              </div>
              <div style={{ display:'flex', justifyContent:'space-between', padding:'8px 0', borderBottom:'1px solid #F0EAE0' }}>
                <span style={{ fontSize:'12px', color:'#9E8E6E' }}>Permissions</span>
                <span style={{ fontSize:'12px', fontWeight:600, color:'#059669' }}>{grantedCount} granted</span>
              </div>
              <div style={{ display:'flex', justifyContent:'space-between', padding:'8px 0' }}>
                <span style={{ fontSize:'12px', color:'#9E8E6E' }}>Denied</span>
                <span style={{ fontSize:'12px', fontWeight:600, color:'#DC2626' }}>{ALL_PERMISSIONS.length-grantedCount} denied</span>
              </div>
              <div style={{ marginTop:'12px', padding:'10px', background:'#FFFBEB', border:'1px solid #FDE68A', fontSize:'11px', color:'#92400E', fontWeight:600 }}>
                ⚠ Roles are system-defined. {adminLevel===ADMIN_LEVELS.SUPER_ADMIN?'Only SUPER_ADMIN can modify roles via backend.':'INDIA_ADMIN has view-only access to roles.'}
              </div>
            </div>
          </BCard>

          {/* Permission Matrix */}
          <BCard>
            <BCardHeader title="Permission Matrix"/>
            <div style={{ padding:'16px' }}>
              {GROUPS.map(group=>(
                <div key={group} style={{ marginBottom:'16px' }}>
                  <div style={{ display:'flex', alignItems:'center', gap:'8px', marginBottom:'8px' }}>
                    <div style={{ width:'3px', height:'12px', background:'#B8960C' }}/>
                    <span style={{ fontSize:'10px', fontWeight:800, color:'#9E8E6E', letterSpacing:'2px', textTransform:'uppercase' }}>{group}</span>
                  </div>
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'6px' }}>
                    {ALL_PERMISSIONS.filter(p=>p.group===group).map(p=>{
                      const granted = activeRole.permissions[p.key]
                      return (
                        <div key={p.key} style={{ display:'flex', alignItems:'center', gap:'8px', padding:'8px 10px', background:granted?'#F0FDF4':'#FEF2F2', border:`1px solid ${granted?'#D1FAE5':'#FEE2E2'}`, borderLeft:`3px solid ${granted?'#059669':'#DC2626'}` }}>
                          <div style={{ width:'16px', height:'16px', background:granted?'#059669':'#DC2626', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                            <span style={{ color:'#fff', fontSize:'9px', fontWeight:800 }}>{granted?'✓':'✗'}</span>
                          </div>
                          <span style={{ fontSize:'11px', color:granted?'#065F46':'#991B1B', fontWeight:granted?600:400 }}>{p.label}</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          </BCard>
        </div>

        {/* Comparison Table */}
        <BCard style={{ marginTop:'14px' }}>
          <BCardHeader title="Role Comparison Matrix"/>
          <div style={{ overflowX:'auto' }}>
            <table style={{ width:'100%', borderCollapse:'collapse' }}>
              <thead>
                <tr style={{ background:'#F5F0E8' }}>
                  <th style={{ padding:'10px 14px', textAlign:'left', fontSize:'9px', fontWeight:800, color:'#9E8E6E', letterSpacing:'1px', borderBottom:'1px solid #E8DFD0', minWidth:'180px' }}>PERMISSION</th>
                  {ROLES_DATA.map(r=>(
                    <th key={r.id} style={{ padding:'10px 14px', textAlign:'center', fontSize:'9px', fontWeight:800, color:r.color, letterSpacing:'1px', borderBottom:'1px solid #E8DFD0', minWidth:'120px' }}>{r.label.toUpperCase()}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ALL_PERMISSIONS.map((p,i)=>(
                  <tr key={p.key} style={{ background:i%2===0?'#fff':'#FDFAF6', borderBottom:'1px solid #F0EAE0' }}>
                    <td style={{ padding:'9px 14px', fontSize:'11px', color:'#6B5E3E', fontWeight:500 }}>{p.label}</td>
                    {ROLES_DATA.map(r=>(
                      <td key={r.id} style={{ padding:'9px 14px', textAlign:'center' }}>
                        <span style={{ fontSize:'12px', fontWeight:800, color:r.permissions[p.key]?'#059669':'#DC2626' }}>
                          {r.permissions[p.key]?'✓':'✗'}
                        </span>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </BCard>

      </div>

      <div style={{ background:'#0D1B2A', borderTop:'2px solid #B8960C', padding:'10px 20px', display:'flex', justifyContent:'space-between', marginTop:'14px' }}>
        <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.3)' }}>ZEMISH ROLES & PERMISSIONS v1.0.0</span>
        <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.3)' }}>NATIONAL COMMAND CENTER</span>
      </div>
    </div>
  )
}