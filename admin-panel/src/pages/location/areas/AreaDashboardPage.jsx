import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { FONTS } from '../../../config/brand'
import useAuthStore from '../../../store/authStore'

const ADMIN_LEVELS       = { SUPER_ADMIN:'SUPER_ADMIN', INDIA_ADMIN:'INDIA_ADMIN', STATE_ADMIN:'STATE_ADMIN', DISTRICT_ADMIN:'DISTRICT_ADMIN' }
const canControlTerritory = (l) => [ADMIN_LEVELS.SUPER_ADMIN, ADMIN_LEVELS.INDIA_ADMIN].includes(l)

const AREAS_DB = {
  'AR001': {
    id: 'AR001', name: 'Hazratganj', district: 'Lucknow', districtId: 'DT001',
    state: 'Uttar Pradesh', stateCode: 'UP', status: 'ACTIVE', territory: 'OPEN',
    coverage: 84, lastUpdated: '23 Jun 2026, 05:45 AM',
    summary: { pincodes: 3, salons: 42, activeSalons: 40, pendingApprovals: 4, totalBookings: 8400, totalRevenue: 1960000, avgRating: 4.5, cancelRate: 5.2, targetSalons: 50 },
    alerts: [
      { type: 'INFO',    msg: '4 Salon approvals pending review',     action: 'Review Now',   route: '/app/approvals',                     color: '#2563EB' },
      { type: 'SUCCESS', msg: 'Coverage at 84% — On track',           action: null,           route: null,                                 color: '#059669' },
      { type: 'WARNING', msg: 'Pincode 226003 — No active salons',    action: 'View Pincodes',route: `/app/location/areas/AR001`,           color: '#D97706' },
    ],
    bookingTrend: [
      { month:'Jan', bookings:980,  revenue:228000 },
      { month:'Feb', bookings:1120, revenue:260800 },
      { month:'Mar', bookings:1380, revenue:321200 },
      { month:'Apr', bookings:1240, revenue:288800 },
      { month:'May', bookings:1580, revenue:367800 },
      { month:'Jun', bookings:1920, revenue:446900 },
    ],
    pincodeStats: [
      { pincode:'226001', salons:18, bookings:3200, coverage:90, status:'ACTIVE'   },
      { pincode:'226002', salons:16, bookings:2900, coverage:80, status:'ACTIVE'   },
      { pincode:'226003', salons:8,  bookings:2300, coverage:53, status:'PARTIAL'  },
    ],
    pendingApprovals: [
      { id:'SAL050', salon:'Crown Cuts',  owner:'Ravi Kumar',  submittedAt:'2026-06-22', step:7 },
      { id:'SAL051', salon:'Style Point', owner:'Amit Singh',  submittedAt:'2026-06-21', step:6 },
      { id:'SAL052', salon:'Hair Lab',    owner:'Priya Gupta', submittedAt:'2026-06-20', step:7 },
      { id:'SAL053', salon:'Fade Studio', owner:'Raj Mehta',   submittedAt:'2026-06-19', step:7 },
    ],
    topSalons: [
      { id:'SAL001', name:'Salman Salmani',  bookings:420, rating:4.8, revenue:97800  },
      { id:'SAL002', name:'Royal Cuts',       bookings:380, rating:4.6, revenue:88400  },
      { id:'SAL003', name:'Style Studio',     bookings:340, rating:4.5, revenue:79200  },
    ],
    healthScore: 86,
    healthFactors: [
      { label:'Coverage',          val:'84%', ok:true  },
      { label:'Active Salons',     val:'95%', ok:true  },
      { label:'Admin Assigned',    val:'Yes', ok:true  },
      { label:'Pending Approvals', val:'4',   ok:false },
      { label:'Revenue Growth',    val:'+18%',ok:true  },
      { label:'Empty Pincodes',    val:'0',   ok:true  },
    ],
    manager: { name:'Rohit Verma', phone:'9812345678', status:'ACTIVE' },
  },
  'AR010': {
    id: 'AR010', name: 'Andheri', district: 'Mumbai', districtId: 'DT009',
    state: 'Maharashtra', stateCode: 'MH', status: 'ACTIVE', territory: 'OPEN',
    coverage: 92, lastUpdated: '23 Jun 2026, 05:45 AM',
    summary: { pincodes: 4, salons: 92, activeSalons: 89, pendingApprovals: 8, totalBookings: 18400, totalRevenue: 4280000, avgRating: 4.6, cancelRate: 4.1, targetSalons: 100 },
    alerts: [
      { type: 'INFO',    msg: '8 Salon approvals pending',       action: 'Review Now', route: '/app/approvals', color: '#2563EB' },
      { type: 'SUCCESS', msg: 'Coverage 92% — Excellent',        action: null,         route: null,             color: '#059669' },
    ],
    bookingTrend: [
      { month:'Jan', bookings:2200, revenue:512000 },
      { month:'Feb', bookings:2600, revenue:604800 },
      { month:'Mar', bookings:3100, revenue:721200 },
      { month:'Apr', bookings:2900, revenue:674800 },
      { month:'May', bookings:3600, revenue:837600 },
      { month:'Jun', bookings:4200, revenue:977400 },
    ],
    pincodeStats: [
      { pincode:'400053', salons:24, bookings:4800, coverage:96, status:'ACTIVE' },
      { pincode:'400058', salons:22, bookings:4400, coverage:88, status:'ACTIVE' },
      { pincode:'400059', salons:26, bookings:5200, coverage:96, status:'ACTIVE' },
      { pincode:'400069', salons:20, bookings:4000, coverage:80, status:'ACTIVE' },
    ],
    pendingApprovals: [
      { id:'SAL060', salon:'Luxe Hair', owner:'Raj Kapoor', submittedAt:'2026-06-22', step:7 },
      { id:'SAL061', salon:'Studio 99', owner:'Nita Shah',  submittedAt:'2026-06-21', step:7 },
    ],
    topSalons: [
      { id:'SAL010', name:'Andheri Elite',  bookings:920, rating:4.9, revenue:214000 },
      { id:'SAL011', name:'Style Hub',      bookings:840, rating:4.7, revenue:195600 },
      { id:'SAL012', name:'Crown Barbers',  bookings:780, rating:4.6, revenue:181600 },
    ],
    healthScore: 94,
    healthFactors: [
      { label:'Coverage',          val:'92%', ok:true  },
      { label:'Active Salons',     val:'97%', ok:true  },
      { label:'Admin Assigned',    val:'Yes', ok:true  },
      { label:'Pending Approvals', val:'8',   ok:false },
      { label:'Revenue Growth',    val:'+22%',ok:true  },
      { label:'Empty Pincodes',    val:'0',   ok:true  },
    ],
    manager: { name:'Kavita Sharma', phone:'9834567890', status:'ACTIVE' },
  },
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

function LineChart({ data, valueKey, labelKey, color='#B8960C', height=110 }) {
  if (!data||data.length===0) return null
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
          <text x={p.x} y={p.y-8} fontSize="9" fill={color} textAnchor="middle" fontWeight="700">{p.val.toLocaleString('en-IN')}</text>
        </g>
      ))}
    </svg>
  )
}

function HealthGauge({ score }) {
  const color = score>=80?'#059669':score>=60?'#D97706':'#DC2626'
  const label = score>=80?'EXCELLENT':score>=60?'GOOD':score>=40?'AVERAGE':'POOR'
  const c=2*Math.PI*48, off=c-(score/100)*c
  return (
    <div style={{ display:'flex', alignItems:'center', gap:'16px' }}>
      <svg width="110" height="110" viewBox="0 0 120 120">
        <circle cx="60" cy="60" r="48" fill="none" stroke="#E8DFD0" strokeWidth="10"/>
        <circle cx="60" cy="60" r="48" fill="none" stroke={color} strokeWidth="10"
          strokeDasharray={c} strokeDashoffset={off} transform="rotate(-90 60 60)" strokeLinecap="butt"/>
        <text x="60" y="55" textAnchor="middle" fontSize="24" fontWeight="800" fill={color}>{score}</text>
        <text x="60" y="70" textAnchor="middle" fontSize="9" fill="#9E8E6E">/ 100</text>
      </svg>
      <div>
        <div style={{ fontSize:'13px', fontWeight:800, color, letterSpacing:'1px', marginBottom:'4px' }}>{label}</div>
        <div style={{ fontSize:'10px', color:'#9E8E6E' }}>Area Health Score</div>
      </div>
    </div>
  )
}

export default function AreaDashboardPage() {
  const { id }   = useParams()
  const navigate = useNavigate()
  const admin    = useAuthStore(s => s.admin)
  const [filter, setFilter] = useState('Last 6 Months')
  const [toast,  setToast]  = useState(null)

  const showToast = (msg, color) => { setToast({ msg, color }); setTimeout(() => setToast(null), 3000) }

  const adminLevel     = admin?.adminLevel || ADMIN_LEVELS.SUPER_ADMIN
  const hasTerrControl = canControlTerritory(adminLevel)

  const area = AREAS_DB[id] || Object.values(AREAS_DB)[0]
  const s    = area.summary
  const coveragePct = s.targetSalons > 0 ? Math.min(100, Math.round((s.salons / s.targetSalons) * 100)) : 0

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
          <button onClick={() => navigate(`/app/location/areas/${id}`)} style={{ background:'rgba(255,255,255,0.07)', border:'1px solid rgba(255,255,255,0.1)', color:'rgba(255,255,255,0.6)', padding:'5px 10px', cursor:'pointer', fontSize:'12px', fontWeight:700 }}>← BACK</button>
          <div style={{ width:'3px', height:'16px', background:'#B8960C' }}/>
          <div>
            <div style={{ color:'#fff', fontWeight:800, fontSize:'13px', letterSpacing:'1px' }}>{area.name}, {area.stateCode} — AREA DASHBOARD</div>
            <div style={{ color:'#B8960C', fontSize:'9px', letterSpacing:'1px', marginTop:'1px' }}>{area.id} • {area.district} • Area Command Center</div>
          </div>
          {s.pendingApprovals > 0 && (
            <span style={{ background:'#DC2626', color:'#fff', fontSize:'10px', fontWeight:800, padding:'3px 8px' }}>{s.pendingApprovals} PENDING</span>
          )}
        </div>
        <div style={{ display:'flex', gap:'8px', alignItems:'center' }}>
          <select value={filter} onChange={e=>setFilter(e.target.value)}
            style={{ background:'rgba(255,255,255,0.07)', border:'1px solid rgba(184,150,12,0.4)', color:'#B8960C', padding:'6px 10px', fontSize:'11px', fontWeight:700, cursor:'pointer', fontFamily:FONTS.body, outline:'none' }}>
            {['Last 30 Days','Last 3 Months','Last 6 Months','This Year'].map(f=><option key={f}>{f}</option>)}
          </select>
          <button onClick={() => navigate('/app/approvals')} style={{ background:'#B8960C', border:'none', color:'#0D1B2A', padding:'6px 14px', fontSize:'10px', fontWeight:800, cursor:'pointer' }}>
            ✓ APPROVAL QUEUE ({s.pendingApprovals})
          </button>
          <button onClick={() => navigate(`/app/location/districts/${area.districtId}/dashboard`)} style={{ background:'rgba(37,99,235,0.15)', border:'1px solid rgba(37,99,235,0.4)', color:'#93C5FD', padding:'6px 12px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>
            ↑ DISTRICT DASHBOARD
          </button>
        </div>
      </div>

      {/* Sub-header */}
      <div style={{ background:'#0A1520', borderBottom:'1px solid rgba(184,150,12,0.15)', padding:'6px 20px', display:'flex', justifyContent:'space-between' }}>
        <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.3)' }}>Period: <strong style={{ color:'#B8960C' }}>{filter}</strong></span>
        <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.25)' }}>Data Last Updated: <strong style={{ color:'rgba(255,255,255,0.4)' }}>{area.lastUpdated}</strong></span>
      </div>

      {/* Alerts */}
      {area.alerts.length > 0 && (
        <div style={{ background:'#FFFBEB', borderBottom:'2px solid #FDE68A', padding:'8px 20px', display:'flex', gap:'16px', alignItems:'center', flexWrap:'wrap' }}>
          <span style={{ fontSize:'11px', fontWeight:800, color:'#92400E' }}>⚠ AREA ALERTS:</span>
          {area.alerts.map((a,i) => (
            <div key={i} style={{ display:'flex', alignItems:'center', gap:'6px' }}>
              <div style={{ width:'6px', height:'6px', background:a.color, flexShrink:0 }}/>
              <span style={{ fontSize:'11px', color:'#1A1A2E' }}>{a.msg}</span>
              {a.action && a.route && (
                <button onClick={() => navigate(a.route)} style={{ background:'none', border:'none', cursor:'pointer', fontSize:'11px', color:a.color, fontWeight:700, padding:0, textDecoration:'underline' }}>
                  {a.action}
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <div style={{ padding:'14px 20px' }}>

        {/* KPI Strip */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(8,1fr)', gap:'10px', marginBottom:'14px' }}>
          {[
            { label:'Pincodes',         value:s.pincodes,                                color:'#2563EB' },
            { label:'Total Salons',     value:s.salons,                                  color:'#B8960C' },
            { label:'Active Salons',    value:s.activeSalons,                            color:'#059669' },
            { label:'Pending Approvals',value:s.pendingApprovals,                        color:'#DC2626' },
            { label:'Total Bookings',   value:s.totalBookings.toLocaleString('en-IN'),   color:'#7C3AED' },
            { label:'Revenue',          value:`₹${(s.totalRevenue/100000).toFixed(1)}L`, color:'#B8960C' },
            { label:'Avg Rating',       value:`${s.avgRating}★`,                        color:'#D97706' },
            { label:'Coverage',         value:`${coveragePct}%`,                         color:coveragePct>=80?'#059669':'#D97706' },
          ].map(k => (
            <BCard key={k.label}>
              <div style={{ padding:'10px 12px' }}>
                <div style={{ fontSize:'14px', fontWeight:800, color:k.color }}>{k.value}</div>
                <div style={{ fontSize:'9px', color:'#9E8E6E', marginTop:'3px', textTransform:'uppercase', letterSpacing:'0.3px' }}>{k.label}</div>
              </div>
            </BCard>
          ))}
        </div>

        {/* Coverage + Manager Strip */}
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:'10px', marginBottom:'14px' }}>
          {/* Coverage Progress */}
          <div style={{ background:'#0D1B2A', border:'1px solid rgba(184,150,12,0.2)', borderTop:'2px solid #B8960C', padding:'14px 16px' }}>
            <div style={{ fontSize:'10px', color:'rgba(255,255,255,0.4)', letterSpacing:'1px', marginBottom:'8px' }}>SALON COVERAGE TARGET</div>
            <div style={{ display:'flex', justifyContent:'space-between', marginBottom:'6px' }}>
              <span style={{ fontSize:'12px', color:'rgba(255,255,255,0.6)' }}>{s.salons} of {s.targetSalons} salons</span>
              <span style={{ fontSize:'14px', fontWeight:800, color:coveragePct>=80?'#059669':'#D97706' }}>{coveragePct}%</span>
            </div>
            <div style={{ height:'8px', background:'rgba(255,255,255,0.1)' }}>
              <div style={{ height:'100%', width:`${coveragePct}%`, background:coveragePct>=80?'#059669':coveragePct>=60?'#D97706':'#DC2626' }}/>
            </div>
          </div>

          {/* Area Manager */}
          <div style={{ background:'#0D1B2A', border:'1px solid rgba(184,150,12,0.2)', borderTop:'2px solid #B8960C', padding:'14px 16px', display:'flex', alignItems:'center', gap:'12px' }}>
            <div style={{ width:'40px', height:'40px', background:'rgba(184,150,12,0.2)', border:'1px solid rgba(184,150,12,0.4)', display:'flex', alignItems:'center', justifyContent:'center', color:'#B8960C', fontSize:'16px', fontWeight:800, flexShrink:0 }}>
              {area.manager.name[0]}
            </div>
            <div>
              <div style={{ fontSize:'10px', color:'rgba(255,255,255,0.4)', letterSpacing:'1px', marginBottom:'2px' }}>AREA MANAGER</div>
              <div style={{ fontSize:'13px', fontWeight:700, color:'#fff' }}>{area.manager.name}</div>
              <div style={{ fontSize:'10px', color:'rgba(255,255,255,0.4)' }}>{area.manager.phone}</div>
            </div>
            <span style={{ marginLeft:'auto', fontSize:'9px', fontWeight:800, background:'rgba(5,150,105,0.2)', color:'#059669', padding:'2px 8px', border:'1px solid rgba(5,150,105,0.3)' }}>{area.manager.status}</span>
          </div>

          {/* Territory Status */}
          <div style={{ background:'#0D1B2A', border:'1px solid rgba(184,150,12,0.2)', borderTop:`2px solid ${area.territory==='OPEN'?'#059669':area.territory==='PARTIAL'?'#D97706':'#DC2626'}`, padding:'14px 16px' }}>
            <div style={{ fontSize:'10px', color:'rgba(255,255,255,0.4)', letterSpacing:'1px', marginBottom:'8px' }}>TERRITORY STATUS</div>
            <div style={{ fontSize:'20px', fontWeight:800, color:area.territory==='OPEN'?'#059669':area.territory==='PARTIAL'?'#D97706':'#DC2626', marginBottom:'4px' }}>{area.territory}</div>
            <div style={{ fontSize:'10px', color:'rgba(255,255,255,0.3)' }}>{area.status} • {area.stateCode} Territory</div>
            {hasTerrControl && (
              <button onClick={() => navigate('/app/location/control')} style={{ marginTop:'8px', background:'rgba(220,38,38,0.15)', border:'1px solid rgba(220,38,38,0.3)', color:'#FCA5A5', padding:'4px 10px', fontSize:'9px', fontWeight:700, cursor:'pointer', display:'block' }}>
                ⊘ TERRITORY CONTROL
              </button>
            )}
          </div>
        </div>

        {/* Charts */}
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'14px', marginBottom:'14px' }}>
          <BCard>
            <BCardHeader title="Booking Trend" action={<span style={{ fontSize:'10px', color:'#B8960C', fontWeight:700 }}>{filter}</span>}/>
            <div style={{ padding:'14px' }}><LineChart data={area.bookingTrend} valueKey="bookings" labelKey="month" color="#B8960C"/></div>
          </BCard>
          <BCard>
            <BCardHeader title="Revenue Trend (₹)" action={<span style={{ fontSize:'10px', color:'#059669', fontWeight:700 }}>{filter}</span>}/>
            <div style={{ padding:'14px' }}><LineChart data={area.bookingTrend} valueKey="revenue" labelKey="month" color="#059669"/></div>
          </BCard>
        </div>

        {/* Row 3: Pincodes + Top Salons + Health */}
        <div style={{ display:'grid', gridTemplateColumns:'1.2fr 1.2fr 0.9fr', gap:'14px', marginBottom:'14px' }}>

          {/* Pincode Stats */}
          <BCard>
            <BCardHeader title={`Pincode Performance (${area.pincodeStats.length})`}/>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 0.6fr 0.8fr 0.7fr', padding:'8px 14px', background:'#F5F0E8', borderBottom:'1px solid #E8DFD0', gap:'8px' }}>
              {['PINCODE','SALONS','BOOKINGS','COVERAGE'].map(h => (
                <span key={h} style={{ fontSize:'9px', fontWeight:800, color:'#9E8E6E', letterSpacing:'1px' }}>{h}</span>
              ))}
            </div>
            {area.pincodeStats.map((p,i) => (
              <div key={p.pincode} style={{ display:'grid', gridTemplateColumns:'1fr 0.6fr 0.8fr 0.7fr', padding:'10px 14px', borderBottom:'1px solid #F0EAE0', alignItems:'center', gap:'8px', background:i%2===0?'#fff':'#FDFAF6' }}>
                <span style={{ fontSize:'12px', fontWeight:700, color:'#1A1A2E', fontFamily:'monospace' }}>{p.pincode}</span>
                <span style={{ fontSize:'12px', fontWeight:600, color:'#B8960C' }}>{p.salons}</span>
                <span style={{ fontSize:'11px', color:'#059669', fontWeight:600 }}>{p.bookings.toLocaleString('en-IN')}</span>
                <div>
                  <div style={{ height:'4px', background:'#E8DFD0', marginBottom:'2px' }}>
                    <div style={{ height:'100%', width:`${p.coverage}%`, background:p.coverage>=80?'#059669':p.coverage>=60?'#D97706':'#DC2626' }}/>
                  </div>
                  <div style={{ display:'flex', gap:'4px', alignItems:'center' }}>
                    <span style={{ fontSize:'9px', color:'#9E8E6E' }}>{p.coverage}%</span>
                    {p.coverage<60 && <span style={{ fontSize:'8px', color:'#DC2626', fontWeight:800 }}>⚠LOW</span>}
                  </div>
                </div>
              </div>
            ))}
          </BCard>

          {/* Top Salons */}
          <BCard>
            <BCardHeader title="Top Salons" action={
              <button onClick={() => navigate('/app/salons')} style={{ background:'none', border:'none', cursor:'pointer', fontSize:'11px', color:'#B8960C', fontWeight:700 }}>VIEW ALL ▸</button>
            }/>
            <div style={{ display:'grid', gridTemplateColumns:'1.5fr 0.7fr 0.7fr 1fr', padding:'8px 14px', background:'#F5F0E8', borderBottom:'1px solid #E8DFD0', gap:'8px' }}>
              {['SALON','BOOKINGS','RATING','REVENUE'].map(h => (
                <span key={h} style={{ fontSize:'9px', fontWeight:800, color:'#9E8E6E', letterSpacing:'1px' }}>{h}</span>
              ))}
            </div>
            {area.topSalons.map((s,i) => (
              <div key={s.id} style={{ display:'grid', gridTemplateColumns:'1.5fr 0.7fr 0.7fr 1fr', padding:'10px 14px', borderBottom:'1px solid #F0EAE0', alignItems:'center', gap:'8px', background:i%2===0?'#fff':'#FDFAF6' }}>
                <button onClick={() => navigate(`/app/salons/${s.id}`)} style={{ background:'none', border:'none', cursor:'pointer', padding:0, textAlign:'left' }}>
                  <span style={{ fontSize:'12px', fontWeight:700, color:'#2563EB', textDecoration:'underline' }}>{s.name}</span>
                </button>
                <span style={{ fontSize:'12px', fontWeight:600, color:'#B8960C' }}>{s.bookings}</span>
                <span style={{ fontSize:'12px', color:'#D97706', fontWeight:700 }}>{s.rating}★</span>
                <span style={{ fontSize:'11px', color:'#059669', fontWeight:600 }}>₹{(s.revenue/1000).toFixed(0)}K</span>
              </div>
            ))}
          </BCard>

          {/* Health Score */}
          <BCard>
            <BCardHeader title="Area Health"/>
            <div style={{ padding:'16px' }}>
              <HealthGauge score={area.healthScore}/>
              <div style={{ marginTop:'14px' }}>
                {area.healthFactors.map(f => (
                  <div key={f.label} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'5px 0', borderBottom:'1px solid #F0EAE0' }}>
                    <div style={{ display:'flex', alignItems:'center', gap:'6px' }}>
                      <div style={{ width:'6px', height:'6px', background:f.ok?'#059669':'#D97706', flexShrink:0 }}/>
                      <span style={{ fontSize:'11px', color:'#9E8E6E' }}>{f.label}</span>
                    </div>
                    <span style={{ fontSize:'11px', fontWeight:700, color:f.ok?'#059669':'#D97706' }}>{f.val}</span>
                  </div>
                ))}
              </div>
            </div>
          </BCard>
        </div>

        {/* Pending Approvals */}
        <BCard>
          <BCardHeader title={`Pending Approvals in ${area.name} (${area.pendingApprovals.length})`} action={
            <button onClick={() => navigate('/app/approvals')} style={{ background:'#B8960C', color:'#0D1B2A', border:'none', padding:'4px 12px', fontSize:'10px', fontWeight:800, cursor:'pointer' }}>VIEW FULL QUEUE ▸</button>
          }/>
          <div style={{ background:'#FFFBEB', borderBottom:'1px solid #FDE68A', padding:'8px 16px', fontSize:'11px', color:'#92400E', fontWeight:600 }}>
            ⭐ District Admin reviews these → RECOMMENDS to State Admin → State Admin APPROVES
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'0.7fr 1.5fr 1.2fr 0.8fr 1fr 1fr', padding:'8px 14px', background:'#F5F0E8', borderBottom:'1px solid #E8DFD0', gap:'8px' }}>
            {['SALON ID','SALON NAME','OWNER','SUBMITTED','PROGRESS','ACTIONS'].map(h => (
              <span key={h} style={{ fontSize:'9px', fontWeight:800, color:'#9E8E6E', letterSpacing:'1px' }}>{h}</span>
            ))}
          </div>
          {area.pendingApprovals.map((p,i) => (
            <div key={p.id} style={{ display:'grid', gridTemplateColumns:'0.7fr 1.5fr 1.2fr 0.8fr 1fr 1fr', padding:'11px 14px', borderBottom:'1px solid #F0EAE0', alignItems:'center', gap:'8px', background:i%2===0?'#fff':'#FDFAF6' }}>
              <span style={{ fontSize:'10px', color:'#9E8E6E', fontFamily:'monospace' }}>{p.id}</span>
              <span style={{ fontSize:'13px', fontWeight:700, color:'#1A1A2E' }}>{p.salon}</span>
              <span style={{ fontSize:'12px', color:'#6B5E3E' }}>{p.owner}</span>
              <span style={{ fontSize:'11px', color:'#9E8E6E' }}>{p.submittedAt}</span>
              <div>
                <div style={{ height:'4px', background:'#E8DFD0', marginBottom:'2px' }}>
                  <div style={{ height:'100%', width:`${(p.step/7)*100}%`, background:'#B8960C' }}/>
                </div>
                <span style={{ fontSize:'9px', color:'#9E8E6E' }}>Step {p.step}/7</span>
              </div>
              <div style={{ display:'flex', gap:'4px' }}>
                <button onClick={() => navigate(`/app/approvals/${p.id}`)} style={{ background:'#1A1A2E', color:'#fff', border:'none', padding:'5px 8px', fontSize:'9px', fontWeight:700, cursor:'pointer' }}>REVIEW</button>
                <button onClick={() => showToast(`↑ ${p.salon} recommended!`, '#059669')} style={{ background:'#059669', color:'#fff', border:'none', padding:'5px 8px', fontSize:'9px', fontWeight:700, cursor:'pointer' }}>↑ RECOMMEND</button>
              </div>
            </div>
          ))}
        </BCard>

      </div>

      <div style={{ background:'#0D1B2A', borderTop:'2px solid #B8960C', padding:'10px 20px', display:'flex', justifyContent:'space-between', marginTop:'14px' }}>
        <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.3)' }}>ZEMISH AREA COMMAND CENTER v1.0.0</span>
        <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.3)' }}>NATIONAL COMMAND CENTER</span>
      </div>
    </div>
  )
}