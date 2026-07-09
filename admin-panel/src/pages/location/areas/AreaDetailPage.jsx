import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { FONTS } from '../../../config/brand'
import useAuthStore from '../../../store/authStore'

const AREAS_DB = {
  'AR001': {
    id:'AR001', name:'Hazratganj', district:'Lucknow', districtId:'DT001', state:'Uttar Pradesh', stateCode:'UP',
    status:'ACTIVE', territory:'OPEN',
    createdAt:'2024-03-10', updatedAt:'2026-06-19',
    summary:{ pincodes:8, salons:62, activeSalons:58, totalBookings:14820, totalRevenue:3420000, avgRating:4.5, coverage:91, pendingApprovals:3 },
    admin:{ name:'Anil Tiwari', email:'anil.tiwari@zemish.in', phone:'9811112222', assignedAt:'2024-03-15', status:'ACTIVE' },
    backupAdmin:{ name:'Rina Bose', email:'rina.bose@zemish.in', phone:'9811113333', status:'ACTIVE' },
    pincodeList:[
      { pincode:'226001', salons:14, coverage:96, status:'ACTIVE' },
      { pincode:'226002', salons:11, coverage:88, status:'ACTIVE' },
      { pincode:'226003', salons:9,  coverage:84, status:'ACTIVE' },
      { pincode:'226004', salons:8,  coverage:79, status:'ACTIVE' },
      { pincode:'226005', salons:7,  coverage:92, status:'ACTIVE' },
      { pincode:'226006', salons:6,  coverage:95, status:'ACTIVE' },
      { pincode:'226007', salons:4,  coverage:68, status:'ACTIVE' },
      { pincode:'226008', salons:3,  coverage:58, status:'PARTIAL' },
    ],
    salonsList:[
      { id:'SL101', name:'Royal Cuts Salon',    rating:4.8, bookings:1240, status:'ACTIVE' },
      { id:'SL102', name:'Glamour Studio',      rating:4.6, bookings:980,  status:'ACTIVE' },
      { id:'SL103', name:'StyleHub Unisex',     rating:4.5, bookings:870,  status:'ACTIVE' },
      { id:'SL104', name:'Trendz Salon & Spa',  rating:3.2, bookings:120,  status:'ACTIVE' },
      { id:'SL105', name:'Classic Barber Shop', rating:2.9, bookings:95,   status:'PENDING' },
    ],
    analytics:{
      bookingTrend:[
        { month:'Jan', bookings:980,  revenue:226000 },
        { month:'Feb', bookings:1120, revenue:258000 },
        { month:'Mar', bookings:1280, revenue:294000 },
        { month:'Apr', bookings:1190, revenue:274000 },
        { month:'May', bookings:1420, revenue:328000 },
        { month:'Jun', bookings:1680, revenue:388000 },
      ],
      topSalons:[
        { name:'Royal Cuts Salon', bookings:1240, rating:4.8 },
        { name:'Glamour Studio',   bookings:980,  rating:4.6 },
        { name:'StyleHub Unisex',  bookings:870,  rating:4.5 },
      ],
    },
    audit:[
      { date:'2026-06-19 09:40', admin:'Anil Tiwari',  action:'Coverage Report Updated',                  ip:'Backend' },
      { date:'2026-06-12 16:10', admin:'System',       action:'Pincode 226008 Marked PARTIAL Territory',  ip:'Backend' },
      { date:'2024-03-15 10:00', admin:'India Admin',  action:'Anil Tiwari Assigned as Area Manager',     ip:'Backend' },
      { date:'2024-03-10 09:00', admin:'System',       action:'Area Hazratganj Registered',                ip:'Backend' },
    ],
  },
  'AR003': {
    id:'AR003', name:'Aliganj', district:'Lucknow', districtId:'DT001', state:'Uttar Pradesh', stateCode:'UP',
    status:'ACTIVE', territory:'PARTIAL',
    createdAt:'2024-04-02', updatedAt:'2026-06-14',
    summary:{ pincodes:5, salons:34, activeSalons:27, totalBookings:6240, totalRevenue:1180000, avgRating:4.0, coverage:58, pendingApprovals:5 },
    admin:{ name:'Not Assigned', email:'-', phone:'-', assignedAt:'-', status:'INACTIVE' },
    backupAdmin:{ name:'Not Assigned', email:'-', phone:'-', status:'INACTIVE' },
    pincodeList:[
      { pincode:'226020', salons:9, coverage:64, status:'ACTIVE' },
      { pincode:'226021', salons:8, coverage:60, status:'ACTIVE' },
      { pincode:'226022', salons:7, coverage:55, status:'PARTIAL' },
      { pincode:'226023', salons:6, coverage:52, status:'PARTIAL' },
      { pincode:'226024', salons:4, coverage:38, status:'PARTIAL' },
    ],
    salonsList:[
      { id:'SL201', name:'Sunshine Salon',  rating:4.1, bookings:420, status:'ACTIVE' },
      { id:'SL202', name:'Urban Cuts',      rating:3.8, bookings:310, status:'ACTIVE' },
      { id:'SL203', name:'Hair Affair',     rating:2.6, bookings:60,  status:'ACTIVE' },
    ],
    analytics:{
      bookingTrend:[
        { month:'Jan', bookings:420, revenue:78000 },
        { month:'Feb', bookings:460, revenue:86000 },
        { month:'Mar', bookings:510, revenue:96000 },
        { month:'Apr', bookings:480, revenue:90000 },
        { month:'May', bookings:560, revenue:104000 },
        { month:'Jun', bookings:610, revenue:114000 },
      ],
      topSalons:[
        { name:'Sunshine Salon', bookings:420, rating:4.1 },
        { name:'Urban Cuts',     bookings:310, rating:3.8 },
      ],
    },
    audit:[
      { date:'2026-06-14 12:00', admin:'System',     action:'Area Manager Unassigned — Vacancy',        ip:'Backend' },
      { date:'2024-04-02 09:00', admin:'System',      action:'Area Aliganj Registered',                  ip:'Backend' },
    ],
  },
}

const STATUS_COLORS    = { ACTIVE:{ bg:'#D1FAE5',color:'#065F46' }, PENDING:{ bg:'#FEF9C3',color:'#92400E' }, INACTIVE:{ bg:'#F3F4F6',color:'#374151' }, CLOSED:{ bg:'#FEE2E2',color:'#991B1B' } }
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

export default function AreaDetailPage() {
  const { id }   = useParams()
  const navigate = useNavigate()
  const admin    = useAuthStore(s => s.admin)
  const adminLevel = admin?.adminLevel || ADMIN_LEVELS.SUPER_ADMIN
  const hasEdit  = canEdit(adminLevel)

  const [tab,   setTab]   = useState('overview')
  const [toast, setToast] = useState(null)
  const [area, setArea]   = useState(AREAS_DB[id] || Object.values(AREAS_DB)[0])

  const showToast = (msg, color) => { setToast({ msg, color }); setTimeout(() => setToast(null), 3000) }

  const st = STATUS_COLORS[area.status]       || STATUS_COLORS.INACTIVE
  const tt = TERRITORY_COLORS[area.territory] || TERRITORY_COLORS.PARTIAL
  const s  = area.summary
  const TABS = ['overview', 'pincodes', 'salons', 'admins', 'analytics', 'audit']

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
          <button onClick={() => navigate('/app/location/areas')} style={{ background:'rgba(255,255,255,0.07)', border:'1px solid rgba(255,255,255,0.1)', color:'rgba(255,255,255,0.6)', padding:'5px 10px', cursor:'pointer', fontSize:'12px', fontWeight:700 }}>← BACK</button>
          <div style={{ width:'3px', height:'16px', background:'#B8960C' }}/>
          <div>
            <div style={{ color:'#fff', fontWeight:800, fontSize:'13px', letterSpacing:'1px' }}>{area.name} ({area.district}, {area.stateCode})</div>
            <div style={{ color:'#B8960C', fontSize:'9px', letterSpacing:'1px', marginTop:'1px' }}>{area.id} • AREA DETAIL</div>
          </div>
          <span style={{ fontSize:'10px', fontWeight:800, background:st.bg, color:st.color, padding:'3px 8px' }}>{area.status}</span>
          <span style={{ fontSize:'10px', fontWeight:800, background:tt.bg, color:tt.color, padding:'3px 8px' }}>Territory: {area.territory}</span>
        </div>
        <div style={{ display:'flex', gap:'8px' }}>
          {hasEdit && (
            <button onClick={() => navigate(`/app/location/areas/${id}/edit`)} style={{ background:'rgba(184,150,12,0.15)', border:'1px solid rgba(184,150,12,0.4)', color:'#B8960C', padding:'6px 12px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>✎ EDIT</button>
          )}
          <button onClick={() => navigate(`/app/location/areas/${id}/dashboard`)} style={{ background:'rgba(37,99,235,0.2)', border:'1px solid rgba(37,99,235,0.5)', color:'#93C5FD', padding:'6px 12px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>📊 DASHBOARD</button>
          <button onClick={() => navigate('/app/location/control')} style={{ background:'rgba(220,38,38,0.15)', border:'1px solid rgba(220,38,38,0.4)', color:'#FCA5A5', padding:'6px 12px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>⊘ TERRITORY CONTROL</button>
          <button onClick={() => navigate(`/app/location/districts/${area.districtId}`)} style={{ background:'rgba(37,99,235,0.15)', border:'1px solid rgba(37,99,235,0.4)', color:'#93C5FD', padding:'6px 12px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>VIEW DISTRICT</button>
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
          { label:'Pincodes',          value:s.pincodes,                              color:'#2563EB' },
          { label:'Total Salons',      value:s.salons,                                color:'#B8960C' },
          { label:'Active Salons',     value:s.activeSalons,                          color:'#059669' },
          { label:'Total Bookings',    value:s.totalBookings.toLocaleString('en-IN'), color:'#0891B2' },
          { label:'Pending Approvals', value:s.pendingApprovals,                      color:s.pendingApprovals>0?'#D97706':'#9E8E6E' },
          { label:'Coverage',          value:`${s.coverage}%`,                        color:s.coverage>=80?'#059669':s.coverage>=60?'#D97706':'#DC2626' },
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
              <BCardHeader title="Area Information"/>
              <div style={{ padding:'14px' }}>
                <SLabel title="Basic"/>
                <InfoRow label="Area Name"    value={area.name}/>
                <InfoRow label="District"     value={area.district}/>
                <InfoRow label="State"        value={`${area.state} (${area.stateCode})`}/>
                <InfoRow label="Status"       value={area.status}    valueColor={st.color}/>
                <InfoRow label="Territory"    value={area.territory} valueColor={tt.color}/>
                <InfoRow label="Created"      value={area.createdAt}/>
                <InfoRow label="Last Updated" value={area.updatedAt}/>
                <SLabel title="Coverage"/>
                <div style={{ padding:'8px 0' }}>
                  <div style={{ display:'flex', justifyContent:'space-between', marginBottom:'6px' }}>
                    <span style={{ fontSize:'12px', color:'#9E8E6E' }}>Territory Coverage</span>
                    <span style={{ fontSize:'12px', fontWeight:700, color:'#B8960C' }}>{s.coverage}%</span>
                  </div>
                  <div style={{ height:'8px', background:'#E8DFD0' }}>
                    <div style={{ height:'100%', width:`${s.coverage}%`, background:s.coverage>=80?'#059669':s.coverage>=60?'#D97706':'#DC2626' }}/>
                  </div>
                  {s.coverage < 50 && <div style={{ fontSize:'10px', color:'#DC2626', fontWeight:700, marginTop:'6px' }}>⚠ LOW COVERAGE — Needs Attention</div>}
                </div>
              </div>
            </BCard>

            <BCard>
              <BCardHeader title="Revenue & Performance"/>
              <div style={{ padding:'14px' }}>
                <div style={{ background:'#0D1B2A', padding:'16px', marginBottom:'14px', textAlign:'center', borderTop:'2px solid #B8960C' }}>
                  <div style={{ fontSize:'10px', color:'rgba(255,255,255,0.4)', letterSpacing:'1px', marginBottom:'6px' }}>TOTAL REVENUE</div>
                  <div style={{ fontSize:'24px', fontWeight:800, color:'#B8960C' }}>₹{(s.totalRevenue/100000).toFixed(1)}L</div>
                </div>
                <SLabel title="Metrics"/>
                <InfoRow label="Total Bookings"  value={s.totalBookings.toLocaleString('en-IN')}/>
                <InfoRow label="Avg Rating"      value={`${s.avgRating} ★`} valueColor="#D97706"/>
                <InfoRow label="Active Salons"   value={`${s.activeSalons} / ${s.salons}`} valueColor="#059669"/>
                <InfoRow label="Inactive Salons" value={s.salons-s.activeSalons} valueColor="#DC2626"/>
                <InfoRow label="Pending Approvals" value={s.pendingApprovals} valueColor={s.pendingApprovals>0?'#D97706':'#059669'}/>
              </div>
            </BCard>

            <BCard>
              <BCardHeader title="Top Salons"/>
              <div style={{ padding:'14px' }}>
                {area.analytics.topSalons.map((sal,i) => (
                  <div key={sal.name} style={{ padding:'10px 0', borderBottom:'1px solid #F0EAE0' }}>
                    <div style={{ display:'flex', justifyContent:'space-between', marginBottom:'4px' }}>
                      <span style={{ fontSize:'13px', fontWeight:600, color:'#1A1A2E' }}>{i+1}. {sal.name}</span>
                      <span style={{ fontSize:'12px', color:'#B8960C', fontWeight:700 }}>{sal.bookings} bookings</span>
                    </div>
                    <div style={{ height:'4px', background:'#E8DFD0' }}>
                      <div style={{ height:'100%', width:`${(sal.bookings/area.analytics.topSalons[0].bookings)*100}%`, background:'#B8960C' }}/>
                    </div>
                  </div>
                ))}
                <button onClick={() => setTab('salons')} style={{ marginTop:'12px', background:'none', border:'none', cursor:'pointer', fontSize:'11px', color:'#B8960C', fontWeight:700, padding:0 }}>
                  VIEW ALL SALONS ▸
                </button>
              </div>
            </BCard>
          </div>
        )}

        {/* PINCODES */}
        {tab === 'pincodes' && (
          <BCard>
            <BCardHeader title={`Pincodes (${area.pincodeList.length})`} action={
              hasEdit && <button style={{ background:'#B8960C', color:'#0D1B2A', border:'none', padding:'4px 10px', fontSize:'10px', fontWeight:800, cursor:'pointer' }}>+ ADD PINCODE</button>
            }/>
            <div style={{ display:'grid', gridTemplateColumns:'1.2fr 0.8fr 1.5fr 1fr 1fr', padding:'8px 14px', background:'#F5F0E8', borderBottom:'1px solid #E8DFD0', gap:'8px' }}>
              {['PINCODE','SALONS','COVERAGE','STATUS','ACTIONS'].map(h => (
                <span key={h} style={{ fontSize:'9px', fontWeight:800, color:'#9E8E6E', letterSpacing:'1px' }}>{h}</span>
              ))}
            </div>
            {area.pincodeList.map((p,i) => {
              const ps = STATUS_COLORS[p.status] || TERRITORY_COLORS[p.status] || STATUS_COLORS.INACTIVE
              const lowCov = p.coverage < 50
              return (
                <div key={p.pincode} style={{ display:'grid', gridTemplateColumns:'1.2fr 0.8fr 1.5fr 1fr 1fr', padding:'10px 14px', borderBottom:'1px solid #F0EAE0', alignItems:'center', gap:'8px', background:i%2===0?'#fff':'#FDFAF6' }}>
                  <span style={{ fontSize:'13px', fontWeight:700, color:'#1A1A2E', fontFamily:'monospace' }}>{p.pincode}</span>
                  <span style={{ fontSize:'12px', fontWeight:600, color:'#1A1A2E' }}>{p.salons}</span>
                  <div>
                    <div style={{ height:'4px', background:'#E8DFD0', marginBottom:'3px' }}>
                      <div style={{ height:'100%', width:`${p.coverage}%`, background:p.coverage>=80?'#059669':p.coverage>=60?'#D97706':'#DC2626' }}/>
                    </div>
                    <div style={{ display:'flex', alignItems:'center', gap:'4px' }}>
                      <span style={{ fontSize:'9px', color:'#9E8E6E' }}>{p.coverage}%</span>
                      {lowCov && <span style={{ fontSize:'8px', color:'#DC2626', fontWeight:800 }}>⚠LOW</span>}
                    </div>
                  </div>
                  <span style={{ fontSize:'9px', fontWeight:800, background:TERRITORY_COLORS[p.status]?.bg || ps.bg, color:TERRITORY_COLORS[p.status]?.color || ps.color, padding:'2px 6px', display:'inline-block', width:'fit-content' }}>{p.status}</span>
                  <div style={{ display:'flex', gap:'3px' }}>
                    {hasEdit && <button style={{ background:'#B8960C', color:'#fff', border:'none', padding:'4px 7px', fontSize:'9px', fontWeight:700, cursor:'pointer' }}>EDIT</button>}
                  </div>
                </div>
              )
            })}
          </BCard>
        )}

        {/* SALONS */}
        {tab === 'salons' && (
          <BCard>
            <BCardHeader title={`Salons (${area.salonsList.length})`} action={
              <button onClick={() => navigate(`/app/location/salons?area=${area.name}`)} style={{ background:'rgba(37,99,235,0.1)', border:'1px solid rgba(37,99,235,0.3)', color:'#2563EB', padding:'4px 10px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>VIEW IN SALONS MODULE</button>
            }/>
            <div style={{ display:'grid', gridTemplateColumns:'0.8fr 1.6fr 0.8fr 0.8fr 1fr 0.8fr', padding:'8px 14px', background:'#F5F0E8', borderBottom:'1px solid #E8DFD0', gap:'8px' }}>
              {['ID','SALON NAME','RATING','BOOKINGS','STATUS','ACTIONS'].map(h => (
                <span key={h} style={{ fontSize:'9px', fontWeight:800, color:'#9E8E6E', letterSpacing:'1px' }}>{h}</span>
              ))}
            </div>
            {area.salonsList.map((sal,i) => {
              const ss = STATUS_COLORS[sal.status] || STATUS_COLORS.INACTIVE
              const lowRated = sal.rating < 3.0
              return (
                <div key={sal.id} style={{ display:'grid', gridTemplateColumns:'0.8fr 1.6fr 0.8fr 0.8fr 1fr 0.8fr', padding:'10px 14px', borderBottom:'1px solid #F0EAE0', alignItems:'center', gap:'8px', background:i%2===0?'#fff':'#FDFAF6' }}>
                  <span style={{ fontSize:'10px', color:'#9E8E6E', fontFamily:'monospace', fontWeight:600 }}>{sal.id}</span>
                  <span style={{ fontSize:'13px', fontWeight:700, color:'#1A1A2E' }}>{sal.name}</span>
                  <span style={{ fontSize:'12px', fontWeight:600, color:lowRated?'#DC2626':'#D97706' }}>{sal.rating} ★ {lowRated && '⚠'}</span>
                  <span style={{ fontSize:'12px', color:'#1A1A2E' }}>{sal.bookings}</span>
                  <span style={{ fontSize:'9px', fontWeight:800, background:ss.bg, color:ss.color, padding:'2px 6px', display:'inline-block', width:'fit-content' }}>{sal.status}</span>
                  <button onClick={() => navigate(`/app/salons/${sal.id}`)} style={{ background:'#1A1A2E', color:'#fff', border:'none', padding:'4px 7px', fontSize:'9px', fontWeight:700, cursor:'pointer' }}>VIEW</button>
                </div>
              )
            })}
          </BCard>
        )}

        {/* ADMINS */}
        {tab === 'admins' && (
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'14px' }}>
            <BCard>
              <BCardHeader title="Area Manager" action={
                hasEdit && <button onClick={() => navigate('/app/location/admin-assignment')} style={{ background:'#B8960C', color:'#0D1B2A', border:'none', padding:'4px 10px', fontSize:'10px', fontWeight:800, cursor:'pointer' }}>{area.admin.name==='Not Assigned' ? 'ASSIGN' : 'REASSIGN'}</button>
              }/>
              <div style={{ padding:'14px' }}>
                {area.admin.name === 'Not Assigned' ? (
                  <div style={{ padding:'20px', textAlign:'center', background:'#FEF2F2', border:'1px solid #FCA5A5' }}>
                    <div style={{ fontSize:'13px', fontWeight:800, color:'#DC2626' }}>⚠ NO AREA MANAGER ASSIGNED</div>
                    <div style={{ fontSize:'11px', color:'#991B1B', marginTop:'4px' }}>This area is unattended. Assign a manager to maintain territory operations.</div>
                  </div>
                ) : (
                  <>
                    <div style={{ display:'flex', alignItems:'center', gap:'14px', padding:'14px', background:'#F5F0E8', border:'1px solid #E8DFD0', borderTop:'2px solid #B8960C', marginBottom:'14px' }}>
                      <div style={{ width:'48px', height:'48px', background:'#0D1B2A', display:'flex', alignItems:'center', justifyContent:'center', color:'#B8960C', fontSize:'20px', fontWeight:800, flexShrink:0 }}>
                        {area.admin.name[0]}
                      </div>
                      <div>
                        <div style={{ fontSize:'15px', fontWeight:800, color:'#1A1A2E' }}>{area.admin.name}</div>
                        <div style={{ fontSize:'11px', color:'#B8960C', fontWeight:600, letterSpacing:'0.5px' }}>AREA MANAGER — {area.name}</div>
                      </div>
                      <span style={{ marginLeft:'auto', fontSize:'10px', fontWeight:800, background:'#D1FAE5', color:'#065F46', padding:'3px 8px' }}>{area.admin.status}</span>
                    </div>
                    <InfoRow label="Email"       value={area.admin.email}/>
                    <InfoRow label="Phone"       value={area.admin.phone}/>
                    <InfoRow label="Assigned At" value={area.admin.assignedAt}/>
                    <div style={{ display:'flex', gap:'8px', marginTop:'14px' }}>
                      <button onClick={() => navigate('/app/location/admin-assignment')} style={{ flex:1, background:'#F5F0E8', border:'1px solid #D4C9B0', color:'#6B5E3E', padding:'8px', fontSize:'11px', fontWeight:700, cursor:'pointer' }}>↔ TRANSFER</button>
                      <button style={{ flex:1, background:'#FEF2F2', border:'1px solid #DC2626', color:'#DC2626', padding:'8px', fontSize:'11px', fontWeight:700, cursor:'pointer' }}>⊘ DEACTIVATE</button>
                    </div>
                  </>
                )}
              </div>
            </BCard>

            <BCard>
              <BCardHeader title="Backup Manager" action={
                hasEdit && <button onClick={() => navigate('/app/location/admin-assignment')} style={{ background:'rgba(184,150,12,0.15)', border:'1px solid rgba(184,150,12,0.3)', color:'#B8960C', padding:'4px 10px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>CHANGE</button>
              }/>
              <div style={{ padding:'14px' }}>
                {area.backupAdmin.name === 'Not Assigned' ? (
                  <div style={{ padding:'20px', textAlign:'center', background:'#F5F0E8', border:'1px solid #E8DFD0' }}>
                    <div style={{ fontSize:'12px', color:'#9E8E6E' }}>No backup manager assigned</div>
                  </div>
                ) : (
                  <>
                    <div style={{ display:'flex', alignItems:'center', gap:'14px', padding:'14px', background:'#F5F0E8', border:'1px solid #E8DFD0', borderTop:'2px solid #B8960C', marginBottom:'14px' }}>
                      <div style={{ width:'48px', height:'48px', background:'#0D1B2A', display:'flex', alignItems:'center', justifyContent:'center', color:'#B8960C', fontSize:'20px', fontWeight:800, flexShrink:0 }}>
                        {area.backupAdmin.name[0]}
                      </div>
                      <div>
                        <div style={{ fontSize:'15px', fontWeight:800, color:'#1A1A2E' }}>{area.backupAdmin.name}</div>
                        <div style={{ fontSize:'11px', color:'#9E8E6E', fontWeight:600, letterSpacing:'0.5px' }}>BACKUP MANAGER — {area.name}</div>
                      </div>
                      <span style={{ marginLeft:'auto', fontSize:'10px', fontWeight:800, background:'#D1FAE5', color:'#065F46', padding:'3px 8px' }}>{area.backupAdmin.status}</span>
                    </div>
                    <InfoRow label="Email" value={area.backupAdmin.email}/>
                    <InfoRow label="Phone" value={area.backupAdmin.phone}/>
                    <InfoRow label="Role"  value="Backup — Activates if Primary Inactive" valueColor="#D97706"/>
                  </>
                )}
              </div>
            </BCard>
          </div>
        )}

        {/* ANALYTICS */}
        {tab === 'analytics' && (
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'14px' }}>
            <BCard>
              <BCardHeader title="Booking Trend"/>
              <div style={{ padding:'14px' }}><LineChart data={area.analytics.bookingTrend} valueKey="bookings" labelKey="month" color="#B8960C"/></div>
            </BCard>
            <BCard>
              <BCardHeader title="Revenue Trend (₹)"/>
              <div style={{ padding:'14px' }}><LineChart data={area.analytics.bookingTrend} valueKey="revenue" labelKey="month" color="#059669"/></div>
            </BCard>
            <BCard style={{ gridColumn:'1/-1' }}>
              <BCardHeader title="Salon Performance"/>
              <div style={{ display:'grid', gridTemplateColumns:'2fr 1fr 1fr 2fr', padding:'8px 14px', background:'#F5F0E8', borderBottom:'1px solid #E8DFD0', gap:'8px' }}>
                {['SALON','BOOKINGS','RATING','PERFORMANCE'].map(h => (
                  <span key={h} style={{ fontSize:'9px', fontWeight:800, color:'#9E8E6E', letterSpacing:'1px' }}>{h}</span>
                ))}
              </div>
              {area.analytics.topSalons.map((sal,i) => (
                <div key={sal.name} style={{ display:'grid', gridTemplateColumns:'2fr 1fr 1fr 2fr', padding:'11px 14px', borderBottom:'1px solid #F0EAE0', alignItems:'center', gap:'8px', background:i%2===0?'#fff':'#FDFAF6' }}>
                  <span style={{ fontSize:'13px', fontWeight:600, color:'#1A1A2E' }}>{sal.name}</span>
                  <span style={{ fontSize:'12px', color:'#059669', fontWeight:600 }}>{sal.bookings.toLocaleString('en-IN')}</span>
                  <span style={{ fontSize:'12px', fontWeight:700, color:'#D97706' }}>{sal.rating} ★</span>
                  <div>
                    <div style={{ height:'6px', background:'#E8DFD0' }}>
                      <div style={{ height:'100%', width:`${(sal.bookings/area.analytics.topSalons[0].bookings)*100}%`, background:'#B8960C' }}/>
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
            {area.audit.map((a,i) => (
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