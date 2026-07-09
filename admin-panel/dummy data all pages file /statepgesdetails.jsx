import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { FONTS } from '../../../config/brand'
import useAuthStore from '../../../store/authStore'

const STATES_DB = {
  'ST001': {
    id: 'ST001', name: 'Uttar Pradesh', code: 'UP',
    status: 'ACTIVE', territory: 'OPEN',
    createdAt: '2024-01-15', updatedAt: '2026-06-20',
    summary: { districts: 75, areas: 2840, salons: 4250, activeSalons: 3980, totalBookings: 184520, totalRevenue: 42500000, avgRating: 4.3, coverage: 94 },
    admin: { name: 'Rajesh Kumar', email: 'rajesh.kumar@zemish.in', phone: '9812345678', assignedAt: '2024-02-01', status: 'ACTIVE' },
    backupAdmin: { name: 'Amit Verma', email: 'amit.verma@zemish.in', phone: '9823456789', status: 'ACTIVE' },
    districts: [
      { id: 'DT001', name: 'Lucknow',  areas: 124, salons: 420, status: 'ACTIVE', territory: 'OPEN',    admin: 'Vikram Singh'  },
      { id: 'DT002', name: 'Kanpur',   areas: 98,  salons: 380, status: 'ACTIVE', territory: 'OPEN',    admin: 'Priya Sharma'  },
      { id: 'DT003', name: 'Agra',     areas: 76,  salons: 290, status: 'ACTIVE', territory: 'PARTIAL', admin: 'Deepak Gupta'  },
      { id: 'DT004', name: 'Hapur',    areas: 32,  salons: 85,  status: 'ACTIVE', territory: 'OPEN',    admin: 'Sunil Kumar'   },
      { id: 'DT005', name: 'Noida',    areas: 88,  salons: 340, status: 'ACTIVE', territory: 'OPEN',    admin: 'Rahul Mehta'   },
      { id: 'DT006', name: 'Varanasi', areas: 54,  salons: 180, status: 'ACTIVE', territory: 'PARTIAL', admin: 'Not Assigned'  },
    ],
    analytics: {
      bookingTrend: [
        { month:'Jan', bookings:12420, revenue:2840000 },
        { month:'Feb', bookings:14580, revenue:3340000 },
        { month:'Mar', bookings:16240, revenue:3720000 },
        { month:'Apr', bookings:15180, revenue:3480000 },
        { month:'May', bookings:18420, revenue:4220000 },
        { month:'Jun', bookings:21840, revenue:5010000 },
      ],
      topDistricts: [
        { name:'Lucknow', salons:420, bookings:42000 },
        { name:'Noida',   salons:340, bookings:38000 },
        { name:'Kanpur',  salons:380, bookings:35000 },
      ],
    },
    audit: [
      { date:'2026-06-20 10:00', admin:'Super Admin',  action:'Territory Status Updated to OPEN',     ip:'Backend' },
      { date:'2026-06-15 14:30', admin:'Rajesh Kumar', action:'District Varanasi Admin Unassigned',   ip:'Backend' },
      { date:'2026-06-10 09:00', admin:'System',       action:'Monthly Coverage Report Generated',    ip:'Backend' },
      { date:'2024-02-01 10:00', admin:'India Admin',  action:'Rajesh Kumar Assigned as State Admin', ip:'Backend' },
      { date:'2024-01-15 09:00', admin:'System',       action:'State UP Registered',                  ip:'Backend' },
    ],
  },
  'ST002': {
    id: 'ST002', name: 'Maharashtra', code: 'MH',
    status: 'ACTIVE', territory: 'OPEN',
    createdAt: '2024-01-15', updatedAt: '2026-06-18',
    summary: { districts: 36, areas: 1420, salons: 3180, activeSalons: 2940, totalBookings: 142800, totalRevenue: 38200000, avgRating: 4.4, coverage: 88 },
    admin: { name: 'Priya Desai', email: 'priya.desai@zemish.in', phone: '9834567890', assignedAt: '2024-03-01', status: 'ACTIVE' },
    backupAdmin: { name: 'Rohit Shah', email: 'rohit.shah@zemish.in', phone: '9845678901', status: 'ACTIVE' },
    districts: [
      { id: 'DT010', name: 'Mumbai', areas: 180, salons: 820, status: 'ACTIVE', territory: 'OPEN',    admin: 'Sanjay Mehta' },
      { id: 'DT011', name: 'Pune',   areas: 124, salons: 540, status: 'ACTIVE', territory: 'OPEN',    admin: 'Neha Joshi'   },
      { id: 'DT012', name: 'Nagpur', areas: 88,  salons: 320, status: 'ACTIVE', territory: 'PARTIAL', admin: 'Vijay Kumar'  },
      { id: 'DT013', name: 'Nashik', areas: 64,  salons: 240, status: 'ACTIVE', territory: 'OPEN',    admin: 'Priya Patil'  },
    ],
    analytics: {
      bookingTrend: [
        { month:'Jan', bookings:10200, revenue:2640000 },
        { month:'Feb', bookings:11800, revenue:3050000 },
        { month:'Mar', bookings:13400, revenue:3460000 },
        { month:'Apr', bookings:12600, revenue:3260000 },
        { month:'May', bookings:15200, revenue:3930000 },
        { month:'Jun', bookings:18400, revenue:4760000 },
      ],
      topDistricts: [
        { name:'Mumbai', salons:820, bookings:68000 },
        { name:'Pune',   salons:540, bookings:42000 },
        { name:'Nagpur', salons:320, bookings:28000 },
      ],
    },
    audit: [
      { date:'2026-06-18 11:00', admin:'Priya Desai', action:'Coverage Report Updated',              ip:'Backend' },
      { date:'2024-03-01 10:00', admin:'India Admin', action:'Priya Desai Assigned as State Admin',  ip:'Backend' },
      { date:'2024-01-15 09:00', admin:'System',      action:'State MH Registered',                  ip:'Backend' },
    ],
  },
}

const STATUS_COLORS    = { ACTIVE:{ bg:'#D1FAE5',color:'#065F46' }, INACTIVE:{ bg:'#F3F4F6',color:'#374151' }, CLOSED:{ bg:'#FEE2E2',color:'#991B1B' } }
const TERRITORY_COLORS = { OPEN:{ bg:'#D1FAE5',color:'#065F46' }, PARTIAL:{ bg:'#FEF9C3',color:'#92400E' }, CLOSED:{ bg:'#FEE2E2',color:'#991B1B' } }
const ADMIN_LEVELS     = { SUPER_ADMIN:'SUPER_ADMIN', INDIA_ADMIN:'INDIA_ADMIN', STATE_ADMIN:'STATE_ADMIN', DISTRICT_ADMIN:'DISTRICT_ADMIN' }
const canEdit          = (l) => [ADMIN_LEVELS.SUPER_ADMIN, ADMIN_LEVELS.INDIA_ADMIN].includes(l)

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
    <span style={{ fontSize:'12px', fontWeight:600, color:valueColor||'#1A1A2E', textAlign:'right', maxWidth:'60%' }}>{value}</span>
  </div>
)
const SLabel = ({ title }) => (
  <div style={{ display:'flex', alignItems:'center', gap:'8px', margin:'12px 0 8px' }}>
    <div style={{ width:'3px', height:'12px', background:'#B8960C' }}/>
    <span style={{ fontSize:'9px', fontWeight:800, color:'#9E8E6E', letterSpacing:'2px', textTransform:'uppercase' }}>{title}</span>
  </div>
)

function LineChart({ data, valueKey, labelKey, color='#B8960C', height=100 }) {
  if (!data||data.length===0) return <div style={{ padding:'20px', textAlign:'center', color:'#9E8E6E' }}>No data</div>
  const max = Math.max(...data.map(d=>d[valueKey]))
  const w=400, h=height, pad=16
  const pts = data.map((d,i) => ({ x:pad+(i/(data.length-1))*(w-pad*2), y:h-pad-((d[valueKey]/max)*(h-pad*2)), val:d[valueKey], label:d[labelKey] }))
  const path = pts.map((p,i) => `${i===0?'M':'L'}${p.x},${p.y}`).join(' ')
  const area = `${path} L${pts[pts.length-1].x},${h-pad} L${pts[0].x},${h-pad} Z`
  return (
    <svg width="100%" viewBox={`0 0 ${w} ${h}`} style={{ overflow:'visible' }}>
      <path d={area} fill={`${color}18`}/>
      <path d={path} fill="none" stroke={color} strokeWidth="2"/>
      {pts.map((p,i) => (
        <g key={i}>
          <rect x={p.x-4} y={p.y-4} width="8" height="8" fill={color} stroke="#fff" strokeWidth="1.5"/>
          <text x={p.x} y={h-2} fontSize="9" fill="#9E8E6E" textAnchor="middle">{p.label}</text>
        </g>
      ))}
    </svg>
  )
}

export default function StateDetailPage() {
  const { id }   = useParams()
  const navigate = useNavigate()
  const admin    = useAuthStore(s => s.admin)
  const adminLevel = admin?.adminLevel || ADMIN_LEVELS.SUPER_ADMIN
  const hasEdit  = canEdit(adminLevel)

  const [tab,   setTab]   = useState('overview')
  const [toast, setToast] = useState(null)
  const [state, setState] = useState(STATES_DB[id] || Object.values(STATES_DB)[0])

  const showToast = (msg, color) => { setToast({ msg, color }); setTimeout(() => setToast(null), 3000) }

  const st = STATUS_COLORS[state.status]       || STATUS_COLORS.INACTIVE
  const tt = TERRITORY_COLORS[state.territory] || TERRITORY_COLORS.PARTIAL
  const s  = state.summary
  const TABS = ['overview', 'districts', 'admins', 'analytics', 'audit']

  return (
    <div style={{ fontFamily:FONTS.body, background:'#F0EAE0', minHeight:'100vh' }}>

      {toast && (
        <div style={{ position:'fixed', top:'20px', right:'20px', background:toast.color, color:'#fff', padding:'12px 20px', fontSize:'13px', fontWeight:700, zIndex:9999, boxShadow:'0 4px 12px rgba(0,0,0,0.2)' }}>
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <div style={{ background:'#0D1B2A', borderBottom:'2px solid #B8960C', padding:'0 20px', height:'52px', display:'flex', alignItems:'center', justifyContent:'space-between', position:'sticky', top:0, zIndex:10 }}>
        <div style={{ display:'flex', alignItems:'center', gap:'12px' }}>
          <button onClick={() => navigate('/app/location/states')} style={{ background:'rgba(255,255,255,0.07)', border:'1px solid rgba(255,255,255,0.1)', color:'rgba(255,255,255,0.6)', padding:'5px 10px', cursor:'pointer', fontSize:'12px', fontWeight:700 }}>← BACK</button>
          <div style={{ width:'3px', height:'16px', background:'#B8960C' }}/>
          <div>
            <div style={{ color:'#fff', fontWeight:800, fontSize:'13px', letterSpacing:'1px' }}>{state.name} ({state.code})</div>
            <div style={{ color:'#B8960C', fontSize:'9px', letterSpacing:'1px', marginTop:'1px' }}>{state.id} • STATE DETAIL</div>
          </div>
          <span style={{ fontSize:'10px', fontWeight:800, background:st.bg, color:st.color, padding:'3px 8px' }}>{state.status}</span>
          <span style={{ fontSize:'10px', fontWeight:800, background:tt.bg, color:tt.color, padding:'3px 8px' }}>Territory: {state.territory}</span>
        </div>
        <div style={{ display:'flex', gap:'8px' }}>
          {hasEdit && (
            <button onClick={() => navigate(`/app/location/states/${id}/edit`)} style={{ background:'rgba(184,150,12,0.15)', border:'1px solid rgba(184,150,12,0.4)', color:'#B8960C', padding:'6px 12px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>✎ EDIT</button>
          )}
          {/* ✅ DASHBOARD BUTTON — yahi missing tha */}
          <button onClick={() => navigate(`/app/location/states/${id}/dashboard`)} style={{ background:'rgba(37,99,235,0.2)', border:'1px solid rgba(37,99,235,0.5)', color:'#93C5FD', padding:'6px 12px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>📊 DASHBOARD</button>
          <button onClick={() => navigate('/app/location/control')} style={{ background:'rgba(220,38,38,0.15)', border:'1px solid rgba(220,38,38,0.4)', color:'#FCA5A5', padding:'6px 12px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>⊘ TERRITORY CONTROL</button>
          <button onClick={() => navigate(`/app/location/districts?state=${state.name}`)} style={{ background:'rgba(37,99,235,0.15)', border:'1px solid rgba(37,99,235,0.4)', color:'#93C5FD', padding:'6px 12px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>VIEW DISTRICTS</button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ background:'#0A1520', borderBottom:'1px solid rgba(184,150,12,0.2)', display:'flex', padding:'0 20px' }}>
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)} style={{ padding:'10px 18px', border:'none', background:'none', cursor:'pointer', fontSize:'10px', fontWeight:tab===t?800:400, color:tab===t?'#B8960C':'rgba(255,255,255,0.35)', borderBottom:tab===t?'2px solid #B8960C':'2px solid transparent', letterSpacing:'1.5px', textTransform:'uppercase' }}>
            {t}
          </button>
        ))}
      </div>

      {/* KPI Strip */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(6,1fr)', gap:'1px', background:'#D4C9B0', borderBottom:'2px solid #B8960C' }}>
        {[
          { label:'Districts',      value:s.districts,                             color:'#2563EB' },
          { label:'Areas',          value:s.areas.toLocaleString('en-IN'),         color:'#7C3AED' },
          { label:'Total Salons',   value:s.salons.toLocaleString('en-IN'),        color:'#B8960C' },
          { label:'Active Salons',  value:s.activeSalons.toLocaleString('en-IN'),  color:'#059669' },
          { label:'Total Bookings', value:s.totalBookings.toLocaleString('en-IN'), color:'#0891B2' },
          { label:'Coverage',       value:`${s.coverage}%`,                        color:s.coverage>=80?'#059669':s.coverage>=60?'#D97706':'#DC2626' },
        ].map(k => (
          <div key={k.label} style={{ background:'#0D1B2A', padding:'10px 16px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
            <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.4)' }}>{k.label}</span>
            <span style={{ fontSize:'16px', fontWeight:800, color:k.color }}>{k.value}</span>
          </div>
        ))}
      </div>

      <div style={{ padding:'16px 20px' }}>

        {/* OVERVIEW */}
        {tab === 'overview' && (
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:'14px' }}>
            <BCard>
              <BCardHeader title="State Information"/>
              <div style={{ padding:'14px' }}>
                <SLabel title="Basic"/>
                <InfoRow label="State Name"   value={state.name}/>
                <InfoRow label="State Code"   value={state.code}/>
                <InfoRow label="Status"       value={state.status}    valueColor={st.color}/>
                <InfoRow label="Territory"    value={state.territory} valueColor={tt.color}/>
                <InfoRow label="Created"      value={state.createdAt}/>
                <InfoRow label="Last Updated" value={state.updatedAt}/>
                <SLabel title="Coverage"/>
                <div style={{ padding:'8px 0' }}>
                  <div style={{ display:'flex', justifyContent:'space-between', marginBottom:'6px' }}>
                    <span style={{ fontSize:'12px', color:'#9E8E6E' }}>Territory Coverage</span>
                    <span style={{ fontSize:'12px', fontWeight:700, color:'#B8960C' }}>{s.coverage}%</span>
                  </div>
                  <div style={{ height:'8px', background:'#E8DFD0' }}>
                    <div style={{ height:'100%', width:`${s.coverage}%`, background:s.coverage>=80?'#059669':s.coverage>=60?'#D97706':'#DC2626' }}/>
                  </div>
                </div>
              </div>
            </BCard>

            <BCard>
              <BCardHeader title="Revenue & Performance"/>
              <div style={{ padding:'14px' }}>
                <div style={{ background:'#0D1B2A', padding:'16px', marginBottom:'14px', textAlign:'center', borderTop:'2px solid #B8960C' }}>
                  <div style={{ fontSize:'10px', color:'rgba(255,255,255,0.4)', letterSpacing:'1px', marginBottom:'6px' }}>TOTAL REVENUE</div>
                  <div style={{ fontSize:'24px', fontWeight:800, color:'#B8960C' }}>₹{(s.totalRevenue/10000000).toFixed(1)}Cr</div>
                </div>
                <SLabel title="Metrics"/>
                <InfoRow label="Total Bookings"  value={s.totalBookings.toLocaleString('en-IN')}/>
                <InfoRow label="Avg Rating"      value={`${s.avgRating} ★`} valueColor="#D97706"/>
                <InfoRow label="Active Salons"   value={`${s.activeSalons} / ${s.salons}`} valueColor="#059669"/>
                <InfoRow label="Inactive Salons" value={s.salons-s.activeSalons} valueColor="#DC2626"/>
              </div>
            </BCard>

            <BCard>
              <BCardHeader title="Top Districts"/>
              <div style={{ padding:'14px' }}>
                {state.analytics.topDistricts.map((d,i) => (
                  <div key={d.name} style={{ padding:'10px 0', borderBottom:'1px solid #F0EAE0' }}>
                    <div style={{ display:'flex', justifyContent:'space-between', marginBottom:'4px' }}>
                      <span style={{ fontSize:'13px', fontWeight:600, color:'#1A1A2E' }}>{i+1}. {d.name}</span>
                      <span style={{ fontSize:'12px', color:'#B8960C', fontWeight:700 }}>{d.salons} salons</span>
                    </div>
                    <div style={{ height:'4px', background:'#E8DFD0' }}>
                      <div style={{ height:'100%', width:`${(d.salons/state.analytics.topDistricts[0].salons)*100}%`, background:'#B8960C' }}/>
                    </div>
                  </div>
                ))}
                <button onClick={() => setTab('districts')} style={{ marginTop:'12px', background:'none', border:'none', cursor:'pointer', fontSize:'11px', color:'#B8960C', fontWeight:700, padding:0 }}>
                  VIEW ALL DISTRICTS ▸
                </button>
              </div>
            </BCard>
          </div>
        )}

        {/* DISTRICTS */}
        {tab === 'districts' && (
          <BCard>
            <BCardHeader title={`Districts (${state.districts.length})`} action={
              hasEdit && <button style={{ background:'#B8960C', color:'#0D1B2A', border:'none', padding:'4px 10px', fontSize:'10px', fontWeight:800, cursor:'pointer' }}>+ ADD DISTRICT</button>
            }/>
            <div style={{ display:'grid', gridTemplateColumns:'1.5fr 0.8fr 0.8fr 0.8fr 0.8fr 1.2fr 0.8fr', padding:'8px 14px', background:'#F5F0E8', borderBottom:'1px solid #E8DFD0', gap:'8px' }}>
              {['DISTRICT','AREAS','SALONS','STATUS','TERRITORY','DISTRICT ADMIN','ACTIONS'].map(h => (
                <span key={h} style={{ fontSize:'9px', fontWeight:800, color:'#9E8E6E', letterSpacing:'1px' }}>{h}</span>
              ))}
            </div>
            {state.districts.map((d,i) => {
              const ds = STATUS_COLORS[d.status]       || STATUS_COLORS.INACTIVE
              const dt = TERRITORY_COLORS[d.territory] || TERRITORY_COLORS.PARTIAL
              return (
                <div key={d.id} style={{ display:'grid', gridTemplateColumns:'1.5fr 0.8fr 0.8fr 0.8fr 0.8fr 1.2fr 0.8fr', padding:'10px 14px', borderBottom:'1px solid #F0EAE0', alignItems:'center', gap:'8px', background:i%2===0?'#fff':'#FDFAF6' }}>
                  <span style={{ fontSize:'13px', fontWeight:700, color:'#1A1A2E' }}>{d.name}</span>
                  <span style={{ fontSize:'12px', color:'#6B5E3E' }}>{d.areas}</span>
                  <span style={{ fontSize:'12px', fontWeight:600, color:'#1A1A2E' }}>{d.salons}</span>
                  <span style={{ fontSize:'9px', fontWeight:800, background:ds.bg, color:ds.color, padding:'2px 6px', display:'inline-block' }}>{d.status}</span>
                  <span style={{ fontSize:'9px', fontWeight:800, background:dt.bg, color:dt.color, padding:'2px 6px', display:'inline-block' }}>{d.territory}</span>
                  <div>
                    <div style={{ fontSize:'12px', color:d.admin==='Not Assigned'?'#DC2626':'#1A1A2E', fontWeight:500 }}>{d.admin}</div>
                    {d.admin==='Not Assigned' && <div style={{ fontSize:'9px', color:'#DC2626', fontWeight:700 }}>⚠ UNASSIGNED</div>}
                  </div>
                  <div style={{ display:'flex', gap:'3px' }}>
                    <button onClick={() => navigate(`/app/location/districts/${d.id}`)} style={{ background:'#1A1A2E', color:'#fff', border:'none', padding:'4px 7px', fontSize:'9px', fontWeight:700, cursor:'pointer' }}>VIEW</button>
                    {hasEdit && <button style={{ background:'#B8960C', color:'#fff', border:'none', padding:'4px 7px', fontSize:'9px', fontWeight:700, cursor:'pointer' }}>EDIT</button>}
                  </div>
                </div>
              )
            })}
          </BCard>
        )}

        {/* ADMINS */}
        {tab === 'admins' && (
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'14px' }}>
            <BCard>
              <BCardHeader title="State Admin" action={
                hasEdit && <button onClick={() => navigate('/app/location/admin-assignment')} style={{ background:'#B8960C', color:'#0D1B2A', border:'none', padding:'4px 10px', fontSize:'10px', fontWeight:800, cursor:'pointer' }}>REASSIGN</button>
              }/>
              <div style={{ padding:'14px' }}>
                <div style={{ display:'flex', alignItems:'center', gap:'14px', padding:'14px', background:'#F5F0E8', border:'1px solid #E8DFD0', borderTop:'2px solid #B8960C', marginBottom:'14px' }}>
                  <div style={{ width:'48px', height:'48px', background:'#0D1B2A', display:'flex', alignItems:'center', justifyContent:'center', color:'#B8960C', fontSize:'20px', fontWeight:800, flexShrink:0 }}>
                    {state.admin.name[0]}
                  </div>
                  <div>
                    <div style={{ fontSize:'15px', fontWeight:800, color:'#1A1A2E' }}>{state.admin.name}</div>
                    <div style={{ fontSize:'11px', color:'#B8960C', fontWeight:600, letterSpacing:'0.5px' }}>STATE ADMIN — {state.code}</div>
                  </div>
                  <span style={{ marginLeft:'auto', fontSize:'10px', fontWeight:800, background:'#D1FAE5', color:'#065F46', padding:'3px 8px' }}>{state.admin.status}</span>
                </div>
                <InfoRow label="Email"       value={state.admin.email}/>
                <InfoRow label="Phone"       value={state.admin.phone}/>
                <InfoRow label="Assigned At" value={state.admin.assignedAt}/>
                <div style={{ display:'flex', gap:'8px', marginTop:'14px' }}>
                  <button onClick={() => navigate('/app/location/admin-assignment')} style={{ flex:1, background:'#F5F0E8', border:'1px solid #D4C9B0', color:'#6B5E3E', padding:'8px', fontSize:'11px', fontWeight:700, cursor:'pointer' }}>↔ TRANSFER</button>
                  <button style={{ flex:1, background:'#FEF2F2', border:'1px solid #DC2626', color:'#DC2626', padding:'8px', fontSize:'11px', fontWeight:700, cursor:'pointer' }}>⊘ DEACTIVATE</button>
                </div>
              </div>
            </BCard>

            <BCard>
              <BCardHeader title="Backup Admin" action={
                hasEdit && <button onClick={() => navigate('/app/location/admin-assignment')} style={{ background:'rgba(184,150,12,0.15)', border:'1px solid rgba(184,150,12,0.3)', color:'#B8960C', padding:'4px 10px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>CHANGE</button>
              }/>
              <div style={{ padding:'14px' }}>
                <div style={{ display:'flex', alignItems:'center', gap:'14px', padding:'14px', background:'#F5F0E8', border:'1px solid #E8DFD0', borderTop:'2px solid #B8960C', marginBottom:'14px' }}>
                  <div style={{ width:'48px', height:'48px', background:'#0D1B2A', display:'flex', alignItems:'center', justifyContent:'center', color:'#B8960C', fontSize:'20px', fontWeight:800, flexShrink:0 }}>
                    {state.backupAdmin.name[0]}
                  </div>
                  <div>
                    <div style={{ fontSize:'15px', fontWeight:800, color:'#1A1A2E' }}>{state.backupAdmin.name}</div>
                    <div style={{ fontSize:'11px', color:'#9E8E6E', fontWeight:600, letterSpacing:'0.5px' }}>BACKUP ADMIN — {state.code}</div>
                  </div>
                  <span style={{ marginLeft:'auto', fontSize:'10px', fontWeight:800, background:'#D1FAE5', color:'#065F46', padding:'3px 8px' }}>{state.backupAdmin.status}</span>
                </div>
                <InfoRow label="Email" value={state.backupAdmin.email}/>
                <InfoRow label="Phone" value={state.backupAdmin.phone}/>
                <InfoRow label="Role"  value="Backup — Activates if Primary Inactive" valueColor="#D97706"/>
              </div>
            </BCard>
          </div>
        )}

        {/* ANALYTICS */}
        {tab === 'analytics' && (
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'14px' }}>
            <BCard>
              <BCardHeader title="Booking Trend"/>
              <div style={{ padding:'14px' }}><LineChart data={state.analytics.bookingTrend} valueKey="bookings" labelKey="month" color="#B8960C"/></div>
            </BCard>
            <BCard>
              <BCardHeader title="Revenue Trend (₹)"/>
              <div style={{ padding:'14px' }}><LineChart data={state.analytics.bookingTrend} valueKey="revenue" labelKey="month" color="#059669"/></div>
            </BCard>
            <BCard style={{ gridColumn:'1/-1' }}>
              <BCardHeader title="District Performance"/>
              <div style={{ display:'grid', gridTemplateColumns:'2fr 1fr 1fr 2fr', padding:'8px 14px', background:'#F5F0E8', borderBottom:'1px solid #E8DFD0', gap:'8px' }}>
                {['DISTRICT','SALONS','BOOKINGS','PERFORMANCE'].map(h => (
                  <span key={h} style={{ fontSize:'9px', fontWeight:800, color:'#9E8E6E', letterSpacing:'1px' }}>{h}</span>
                ))}
              </div>
              {state.analytics.topDistricts.map((d,i) => (
                <div key={d.name} style={{ display:'grid', gridTemplateColumns:'2fr 1fr 1fr 2fr', padding:'11px 14px', borderBottom:'1px solid #F0EAE0', alignItems:'center', gap:'8px', background:i%2===0?'#fff':'#FDFAF6' }}>
                  <span style={{ fontSize:'13px', fontWeight:600, color:'#1A1A2E' }}>{d.name}</span>
                  <span style={{ fontSize:'12px', fontWeight:700, color:'#B8960C' }}>{d.salons}</span>
                  <span style={{ fontSize:'12px', color:'#059669', fontWeight:600 }}>{d.bookings.toLocaleString('en-IN')}</span>
                  <div>
                    <div style={{ height:'6px', background:'#E8DFD0' }}>
                      <div style={{ height:'100%', width:`${(d.bookings/state.analytics.topDistricts[0].bookings)*100}%`, background:'#B8960C' }}/>
                    </div>
                  </div>
                </div>
              ))}
            </BCard>
          </div>
        )}

        {/* AUDIT */}
        {tab === 'audit' && (
          <BCard>
            <BCardHeader title="Audit Log — Immutable" action={
              <span style={{ fontSize:'10px', color:'#DC2626', fontWeight:700 }}>⚠ CANNOT BE DELETED</span>
            }/>
            <div style={{ display:'grid', gridTemplateColumns:'1.5fr 1.2fr 2.5fr 1fr', padding:'8px 14px', background:'#F5F0E8', borderBottom:'1px solid #E8DFD0', gap:'8px' }}>
              {['DATE & TIME','ADMIN','ACTION','IP'].map(h => (
                <span key={h} style={{ fontSize:'9px', fontWeight:800, color:'#9E8E6E', letterSpacing:'1px' }}>{h}</span>
              ))}
            </div>
            {state.audit.map((a,i) => (
              <div key={i} style={{ display:'grid', gridTemplateColumns:'1.5fr 1.2fr 2.5fr 1fr', padding:'11px 14px', borderBottom:'1px solid #F0EAE0', alignItems:'center', gap:'8px', background:i%2===0?'#fff':'#FDFAF6' }}>
                <span style={{ fontSize:'11px', color:'#6B5E3E', fontFamily:'monospace' }}>{a.date}</span>
                <span style={{ fontSize:'12px', color:'#1A1A2E', fontWeight:600 }}>{a.admin}</span>
                <span style={{ fontSize:'12px', color:'#1A1A2E' }}>{a.action}</span>
                <span style={{ fontSize:'11px', color:'#C4B49A', fontStyle:'italic' }}>From Backend</span>
              </div>
            ))}
            <div style={{ padding:'8px 14px', background:'#FFFBEB', borderTop:'1px solid #FDE68A', fontSize:'10px', color:'#92400E', fontWeight:600 }}>
              ⚠ Audit logs are immutable. No records can be modified or deleted.
            </div>
          </BCard>
        )}

      </div>

      <div style={{ background:'#0D1B2A', borderTop:'2px solid #B8960C', padding:'10px 20px', display:'flex', justifyContent:'space-between', marginTop:'14px' }}>
        <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.3)', letterSpacing:'0.5px' }}>ZEMISH TERRITORY ENGINE v1.0.0</span>
        <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.3)', letterSpacing:'0.5px' }}>NATIONAL COMMAND CENTER</span>
      </div>
    </div>
  )
}