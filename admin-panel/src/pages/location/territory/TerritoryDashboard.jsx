import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FONTS } from '../../../config/brand'
import useAuthStore from '../../../store/authStore'

const ADMIN_LEVELS        = { SUPER_ADMIN:'SUPER_ADMIN', INDIA_ADMIN:'INDIA_ADMIN', STATE_ADMIN:'STATE_ADMIN', DISTRICT_ADMIN:'DISTRICT_ADMIN' }
const canControlTerritory = (l) => [ADMIN_LEVELS.SUPER_ADMIN, ADMIN_LEVELS.INDIA_ADMIN].includes(l)

// ─── Dummy Data ───────────────────────────────────────────
const DASHBOARD_DATA = {
  lastUpdated: '23 Jun 2026, 06:00 AM',
  national: {
    states: 28, activeStates: 27, closedStates: 1,
    districts: 742, activeDistricts: 738, closedDistricts: 4,
    areas: 12845, activeAreas: 12420, closedAreas: 425,
    salons: 28420, activeSalons: 26840, pendingApprovals: 184,
    totalBookings: 1284500, totalRevenue: 298000000,
    avgCoverage: 84, avgRating: 4.4,
    unassignedStates: 1, unassignedDistricts: 12, unassignedAreas: 48,
  },
  alerts: [
    { type:'CRITICAL', msg:'Bihar State — No Admin Assigned',              action:'Assign Now',    route:'/app/location/admin-assignment', color:'#DC2626' },
    { type:'WARNING',  msg:'12 Districts with no Admin',                   action:'View Districts', route:'/app/location/districts',       color:'#D97706' },
    { type:'WARNING',  msg:'Haryana Territory CLOSED — Admin Transfer',    action:'View State',    route:'/app/location/states',          color:'#D97706' },
    { type:'INFO',     msg:'184 Salon approvals pending across India',     action:'Review Queue',  route:'/app/approvals',                color:'#2563EB' },
    { type:'SUCCESS',  msg:'Revenue up 21% vs last month — ₹298 Cr total',action: null,           route: null,                           color:'#059669' },
  ],
  topStates: [
    { id:'ST001', name:'Uttar Pradesh', code:'UP', salons:4250, bookings:184520, revenue:42500000, coverage:94, territory:'OPEN'    },
    { id:'ST002', name:'Maharashtra',   code:'MH', salons:3180, bookings:142800, revenue:38200000, coverage:88, territory:'OPEN'    },
    { id:'ST008', name:'Tamil Nadu',    code:'TN', salons:2180, bookings:98400,  revenue:28400000, coverage:85, territory:'OPEN'    },
    { id:'ST003', name:'Karnataka',     code:'KA', salons:2240, bookings:102000, revenue:26800000, coverage:82, territory:'OPEN'    },
    { id:'ST012', name:'Kerala',        code:'KL', salons:1120, bookings:50400,  revenue:16200000, coverage:91, territory:'OPEN'    },
    { id:'ST009', name:'Bihar',         code:'BR', salons:680,  bookings:30600,  revenue:8200000,  coverage:42, territory:'PARTIAL' },
  ],
  lowCoverageStates: [
    { id:'ST009', name:'Bihar',          code:'BR', coverage:42, admin:'Not Assigned', territory:'PARTIAL' },
    { id:'ST007', name:'Madhya Pradesh', code:'MP', coverage:65, admin:'Deepak Mishra',territory:'PARTIAL' },
    { id:'ST014', name:'Haryana',        code:'HR', coverage:68, admin:'Sunil Hooda',  territory:'CLOSED'  },
  ],
  bookingTrend: [
    { month:'Jan', bookings:98420,  revenue:22800000 },
    { month:'Feb', bookings:112580, revenue:26100000 },
    { month:'Mar', bookings:128240, revenue:29700000 },
    { month:'Apr', bookings:118600, revenue:27500000 },
    { month:'May', bookings:142800, revenue:33100000 },
    { month:'Jun', bookings:168400, revenue:39000000 },
  ],
  regionStats: [
    { region:'North India',    states:6, salons:8420, coverage:82, color:'#2563EB' },
    { region:'South India',    states:5, salons:6840, coverage:88, color:'#059669' },
    { region:'West India',     states:4, salons:5980, coverage:85, color:'#B8960C' },
    { region:'East India',     states:5, salons:4120, coverage:72, color:'#7C3AED' },
    { region:'Central India',  states:4, salons:2840, coverage:68, color:'#D97706' },
    { region:'North East',     states:4, salons:220,  coverage:38, color:'#DC2626' },
  ],
  healthScore: 84,
  healthFactors: [
    { label:'National Coverage',     val:'84%', ok:true  },
    { label:'Active States',         val:'27/28',ok:true },
    { label:'Admin Coverage',        val:'92%', ok:true  },
    { label:'Pending Approvals',     val:'184', ok:false },
    { label:'Revenue Growth',        val:'+21%',ok:true  },
    { label:'Unassigned Districts',  val:'12',  ok:false },
    { label:'Closed Territories',    val:'5',   ok:false },
  ],
}

// ─── Components ──────────────────────────────────────────
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
          <text x={p.x} y={p.y-8} fontSize="9" fill={color} textAnchor="middle" fontWeight="700">
            {valueKey==='revenue' ? `₹${(p.val/10000000).toFixed(1)}Cr` : p.val.toLocaleString('en-IN')}
          </text>
        </g>
      ))}
    </svg>
  )
}

function NationalHealthGauge({ score }) {
  const color = score>=80?'#059669':score>=60?'#D97706':'#DC2626'
  const label = score>=80?'EXCELLENT':score>=60?'GOOD':score>=40?'AVERAGE':'POOR'
  const c=2*Math.PI*54, off=c-(score/100)*c
  return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', padding:'16px' }}>
      <svg width="130" height="130" viewBox="0 0 140 140">
        <circle cx="70" cy="70" r="54" fill="none" stroke="#E8DFD0" strokeWidth="10"/>
        <circle cx="70" cy="70" r="54" fill="none" stroke={color} strokeWidth="10"
          strokeDasharray={c} strokeDashoffset={off} transform="rotate(-90 70 70)" strokeLinecap="butt"/>
        <text x="70" y="62" textAnchor="middle" fontSize="28" fontWeight="800" fill={color}>{score}</text>
        <text x="70" y="80" textAnchor="middle" fontSize="10" fill="#9E8E6E">/ 100</text>
      </svg>
      <div style={{ fontSize:'13px', fontWeight:800, color, letterSpacing:'2px', marginTop:'6px' }}>{label}</div>
      <div style={{ fontSize:'10px', color:'#9E8E6E', marginTop:'2px' }}>National Territory Health</div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────
export default function TerritoryDashboard() {
  const navigate   = useNavigate()
  const admin      = useAuthStore(s => s.admin)
  const adminLevel = admin?.adminLevel || ADMIN_LEVELS.SUPER_ADMIN
  const hasControl = canControlTerritory(adminLevel)
  const [filter, setFilter] = useState('Last 6 Months')

  const d  = DASHBOARD_DATA
  const n  = d.national
  const TERRITORY_COLORS = { OPEN:{ bg:'#D1FAE5',color:'#065F46' }, PARTIAL:{ bg:'#FEF9C3',color:'#92400E' }, CLOSED:{ bg:'#FEE2E2',color:'#991B1B' } }

  return (
    <div style={{ fontFamily:FONTS.body, background:'#F0EAE0', minHeight:'100vh' }}>

      {/* Header */}
      <div style={{ background:'#0D1B2A', borderBottom:'2px solid #B8960C', padding:'0 20px', height:'52px', display:'flex', alignItems:'center', justifyContent:'space-between', position:'sticky', top:0, zIndex:10 }}>
        <div style={{ display:'flex', alignItems:'center', gap:'12px' }}>
          <div style={{ width:'3px', height:'16px', background:'#B8960C' }}/>
          <h1 style={{ fontSize:'13px', fontWeight:800, color:'#fff', margin:0, letterSpacing:'2px', textTransform:'uppercase' }}>Territory Dashboard</h1>
          <span style={{ background:'rgba(184,150,12,0.2)', color:'#B8960C', fontSize:'10px', fontWeight:800, padding:'2px 8px', border:'1px solid rgba(184,150,12,0.3)' }}>PAN INDIA</span>
          {n.unassignedStates > 0 && <span style={{ background:'rgba(220,38,38,0.2)', color:'#FCA5A5', fontSize:'10px', fontWeight:800, padding:'2px 8px', border:'1px solid rgba(220,38,38,0.3)' }}>⚠ {n.unassignedStates} STATE UNASSIGNED</span>}
          {n.pendingApprovals > 0 && <span style={{ background:'rgba(220,38,38,0.2)', color:'#FCA5A5', fontSize:'10px', fontWeight:800, padding:'2px 8px', border:'1px solid rgba(220,38,38,0.3)' }}>{n.pendingApprovals} PENDING</span>}
        </div>
        <div style={{ display:'flex', gap:'8px', alignItems:'center' }}>
          <select value={filter} onChange={e=>setFilter(e.target.value)}
            style={{ background:'rgba(255,255,255,0.07)', border:'1px solid rgba(184,150,12,0.4)', color:'#B8960C', padding:'6px 10px', fontSize:'11px', fontWeight:700, cursor:'pointer', fontFamily:FONTS.body, outline:'none' }}>
            {['Last 30 Days','Last 3 Months','Last 6 Months','This Year'].map(f=><option key={f}>{f}</option>)}
          </select>
          {hasControl && (
            <button onClick={() => navigate('/app/location/control')} style={{ background:'rgba(220,38,38,0.2)', border:'1px solid rgba(220,38,38,0.5)', color:'#FCA5A5', padding:'6px 12px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>⊘ TERRITORY CONTROL</button>
          )}
          <button onClick={() => navigate('/app/location/admin-assignment')} style={{ background:'rgba(124,58,237,0.15)', border:'1px solid rgba(124,58,237,0.4)', color:'#C4B5FD', padding:'6px 12px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>👤 ADMIN ASSIGNMENT</button>
          <button onClick={() => navigate('/app/approvals')} style={{ background:'#B8960C', border:'none', color:'#0D1B2A', padding:'6px 14px', fontSize:'10px', fontWeight:800, cursor:'pointer' }}>✓ APPROVALS ({n.pendingApprovals})</button>
        </div>
      </div>

      {/* Sub-header */}
      <div style={{ background:'#0A1520', borderBottom:'1px solid rgba(184,150,12,0.15)', padding:'6px 20px', display:'flex', justifyContent:'space-between' }}>
        <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.3)' }}>Period: <strong style={{ color:'#B8960C' }}>{filter}</strong></span>
        <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.25)' }}>Data Last Updated: <strong style={{ color:'rgba(255,255,255,0.4)' }}>{d.lastUpdated}</strong></span>
      </div>

      {/* Alerts Bar */}
      {d.alerts.length > 0 && (
        <div style={{ background:'#FFFBEB', borderBottom:'2px solid #FDE68A', padding:'8px 20px', display:'flex', gap:'16px', alignItems:'center', flexWrap:'wrap' }}>
          <span style={{ fontSize:'11px', fontWeight:800, color:'#92400E', letterSpacing:'0.5px', flexShrink:0 }}>⚠ NATIONAL ALERTS:</span>
          {d.alerts.map((a,i) => (
            <div key={i} style={{ display:'flex', alignItems:'center', gap:'6px' }}>
              <div style={{ width:'6px', height:'6px', background:a.color, flexShrink:0 }}/>
              <span style={{ fontSize:'11px', color:'#1A1A2E' }}>{a.msg}</span>
              {a.action && a.route && (
                <button onClick={() => navigate(a.route)} style={{ background:'none', border:'none', cursor:'pointer', fontSize:'11px', color:a.color, fontWeight:700, padding:0, textDecoration:'underline' }}>{a.action}</button>
              )}
            </div>
          ))}
        </div>
      )}

      <div style={{ padding:'14px 20px' }}>

        {/* National KPI Strip — dark navy */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:'1px', background:'#D4C9B0', border:'1px solid #D4C9B0', marginBottom:'14px' }}>
          {[
            { label:'Total States',    value:n.states,                                  sub:`${n.activeStates} Active`,   color:'#B8960C' },
            { label:'Total Districts', value:n.districts.toLocaleString('en-IN'),        sub:`${n.activeDistricts} Active`, color:'#2563EB' },
            { label:'Total Areas',     value:n.areas.toLocaleString('en-IN'),            sub:`${n.activeAreas} Active`,    color:'#7C3AED' },
            { label:'Total Salons',    value:n.salons.toLocaleString('en-IN'),           sub:`${n.activeSalons.toLocaleString('en-IN')} Active`, color:'#059669' },
          ].map(m => (
            <div key={m.label} style={{ background:'#0D1B2A', padding:'14px 18px' }}>
              <div style={{ fontSize:'10px', color:'rgba(255,255,255,0.4)', marginBottom:'6px', letterSpacing:'0.5px' }}>{m.label}</div>
              <div style={{ fontSize:'24px', fontWeight:800, color:m.color }}>{m.value}</div>
              <div style={{ fontSize:'10px', color:'rgba(255,255,255,0.3)', marginTop:'4px' }}>{m.sub}</div>
            </div>
          ))}
        </div>

        {/* Secondary KPIs */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(6,1fr)', gap:'10px', marginBottom:'14px' }}>
          {[
            { label:'Total Bookings',       value:n.totalBookings.toLocaleString('en-IN'),       color:'#0891B2' },
            { label:'Total Revenue',        value:`₹${(n.totalRevenue/10000000).toFixed(0)}Cr`,  color:'#B8960C' },
            { label:'Avg Coverage',         value:`${n.avgCoverage}%`,                            color:n.avgCoverage>=80?'#059669':'#D97706' },
            { label:'Pending Approvals',    value:n.pendingApprovals,                             color:'#DC2626' },
            { label:'Unassigned Districts', value:n.unassignedDistricts,                          color:'#D97706' },
            { label:'Closed Territories',   value:n.closedStates+n.closedDistricts+n.closedAreas,color:'#DC2626' },
          ].map(k => (
            <BCard key={k.label}>
              <div style={{ padding:'10px 12px' }}>
                <div style={{ fontSize:'16px', fontWeight:800, color:k.color }}>{k.value}</div>
                <div style={{ fontSize:'9px', color:'#9E8E6E', marginTop:'3px', textTransform:'uppercase', letterSpacing:'0.3px' }}>{k.label}</div>
              </div>
            </BCard>
          ))}
        </div>

        {/* Region Coverage */}
        <BCard style={{ marginBottom:'14px' }}>
          <BCardHeader title="Coverage by Region — PAN India"/>
          <div style={{ padding:'16px', display:'grid', gridTemplateColumns:'repeat(6,1fr)', gap:'10px' }}>
            {d.regionStats.map(r => (
              <div key={r.region} style={{ textAlign:'center' }}>
                <div style={{ fontSize:'10px', fontWeight:800, color:'#9E8E6E', letterSpacing:'0.5px', marginBottom:'8px', textTransform:'uppercase' }}>{r.region}</div>
                <div style={{ position:'relative', width:'64px', height:'64px', margin:'0 auto 8px' }}>
                  <svg width="64" height="64" viewBox="0 0 64 64">
                    <circle cx="32" cy="32" r="26" fill="none" stroke="#E8DFD0" strokeWidth="8"/>
                    <circle cx="32" cy="32" r="26" fill="none" stroke={r.color} strokeWidth="8"
                      strokeDasharray={2*Math.PI*26} strokeDashoffset={2*Math.PI*26-(r.coverage/100)*2*Math.PI*26}
                      transform="rotate(-90 32 32)" strokeLinecap="butt"/>
                    <text x="32" y="36" textAnchor="middle" fontSize="11" fontWeight="800" fill={r.color}>{r.coverage}%</text>
                  </svg>
                </div>
                <div style={{ fontSize:'11px', fontWeight:700, color:'#1A1A2E' }}>{r.salons.toLocaleString('en-IN')}</div>
                <div style={{ fontSize:'9px', color:'#9E8E6E' }}>salons</div>
                <div style={{ fontSize:'9px', color:'#9E8E6E', marginTop:'2px' }}>{r.states} states</div>
              </div>
            ))}
          </div>
        </BCard>

        {/* Charts */}
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'14px', marginBottom:'14px' }}>
          <BCard>
            <BCardHeader title="National Booking Trend" action={<span style={{ fontSize:'10px', color:'#B8960C', fontWeight:700 }}>{filter}</span>}/>
            <div style={{ padding:'14px' }}><LineChart data={d.bookingTrend} valueKey="bookings" labelKey="month" color="#B8960C"/></div>
          </BCard>
          <BCard>
            <BCardHeader title="National Revenue Trend" action={<span style={{ fontSize:'10px', color:'#059669', fontWeight:700 }}>{filter}</span>}/>
            <div style={{ padding:'14px' }}><LineChart data={d.bookingTrend} valueKey="revenue" labelKey="month" color="#059669"/></div>
          </BCard>
        </div>

        {/* Top States + Low Coverage + Health */}
        <div style={{ display:'grid', gridTemplateColumns:'1.4fr 1fr 0.9fr', gap:'14px', marginBottom:'14px' }}>

          {/* Top States */}
          <BCard>
            <BCardHeader title="Top States by Performance" action={
              <button onClick={() => navigate('/app/location/states')} style={{ background:'none', border:'none', cursor:'pointer', fontSize:'11px', color:'#B8960C', fontWeight:700 }}>VIEW ALL ▸</button>
            }/>
            <div style={{ display:'grid', gridTemplateColumns:'0.5fr 1.4fr 0.7fr 0.8fr 0.7fr 0.7fr', padding:'8px 14px', background:'#F5F0E8', borderBottom:'1px solid #E8DFD0', gap:'8px' }}>
              {['CODE','STATE','SALONS','BOOKINGS','COVERAGE','TERRITORY'].map(h => (
                <span key={h} style={{ fontSize:'9px', fontWeight:800, color:'#9E8E6E', letterSpacing:'1px' }}>{h}</span>
              ))}
            </div>
            {d.topStates.map((st,i) => {
              const tt = TERRITORY_COLORS[st.territory]||TERRITORY_COLORS.PARTIAL
              return (
                <div key={st.id} style={{ display:'grid', gridTemplateColumns:'0.5fr 1.4fr 0.7fr 0.8fr 0.7fr 0.7fr', padding:'9px 14px', borderBottom:'1px solid #F0EAE0', alignItems:'center', gap:'8px', background:i%2===0?'#fff':'#FDFAF6' }}>
                  <span style={{ fontSize:'11px', fontWeight:800, color:'#B8960C', fontFamily:'monospace' }}>{st.code}</span>
                  <button onClick={() => navigate(`/app/location/states/${st.id}`)} style={{ background:'none', border:'none', cursor:'pointer', padding:0, textAlign:'left' }}>
                    <span style={{ fontSize:'12px', fontWeight:700, color:'#2563EB', textDecoration:'underline' }}>{st.name}</span>
                  </button>
                  <span style={{ fontSize:'12px', fontWeight:600, color:'#B8960C' }}>{st.salons.toLocaleString('en-IN')}</span>
                  <span style={{ fontSize:'11px', color:'#059669', fontWeight:600 }}>{st.bookings.toLocaleString('en-IN')}</span>
                  <div>
                    <div style={{ height:'4px', background:'#E8DFD0', marginBottom:'2px' }}>
                      <div style={{ height:'100%', width:`${st.coverage}%`, background:st.coverage>=80?'#059669':st.coverage>=60?'#D97706':'#DC2626' }}/>
                    </div>
                    <span style={{ fontSize:'9px', color:'#9E8E6E' }}>{st.coverage}%</span>
                  </div>
                  <span style={{ fontSize:'9px', fontWeight:800, background:tt.bg, color:tt.color, padding:'2px 5px', display:'inline-block' }}>{st.territory}</span>
                </div>
              )
            })}
          </BCard>

          {/* Low Coverage States */}
          <BCard>
            <BCardHeader title="Low Coverage States" action={
              <span style={{ fontSize:'10px', color:'#DC2626', fontWeight:700 }}>⚠ {d.lowCoverageStates.length} STATES</span>
            }/>
            <div style={{ padding:'14px' }}>
              {d.lowCoverageStates.map((st,i) => (
                <div key={st.id} style={{ padding:'10px 0', borderBottom:'1px solid #F0EAE0' }}>
                  <div style={{ display:'flex', justifyContent:'space-between', marginBottom:'4px' }}>
                    <button onClick={() => navigate(`/app/location/states/${st.id}`)} style={{ background:'none', border:'none', cursor:'pointer', padding:0 }}>
                      <span style={{ fontSize:'12px', fontWeight:700, color:'#2563EB', textDecoration:'underline' }}>{st.name} ({st.code})</span>
                    </button>
                    <span style={{ fontSize:'11px', fontWeight:700, color:'#DC2626' }}>{st.coverage}%</span>
                  </div>
                  <div style={{ height:'4px', background:'#E8DFD0', marginBottom:'4px' }}>
                    <div style={{ height:'100%', width:`${st.coverage}%`, background:'#DC2626' }}/>
                  </div>
                  <div style={{ display:'flex', justifyContent:'space-between' }}>
                    <span style={{ fontSize:'9px', color:st.admin==='Not Assigned'?'#DC2626':'#9E8E6E', fontWeight:st.admin==='Not Assigned'?700:400 }}>
                      {st.admin==='Not Assigned'?'⚠ UNASSIGNED':st.admin}
                    </span>
                    <span style={{ fontSize:'9px', color:TERRITORY_COLORS[st.territory]?.color||'#9E8E6E', fontWeight:700 }}>{st.territory}</span>
                  </div>
                </div>
              ))}
              <button onClick={() => navigate('/app/location/admin-assignment')} style={{ marginTop:'12px', width:'100%', background:'#FEF2F2', border:'1px solid #DC2626', color:'#DC2626', padding:'8px', fontSize:'10px', fontWeight:800, cursor:'pointer' }}>
                ASSIGN ADMINS ▸
              </button>
            </div>
          </BCard>

          {/* National Health */}
          <BCard>
            <BCardHeader title="National Health"/>
            <NationalHealthGauge score={d.healthScore}/>
            <div style={{ padding:'0 16px 16px' }}>
              {d.healthFactors.map(f => (
                <div key={f.label} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'5px 0', borderBottom:'1px solid #F0EAE0' }}>
                  <div style={{ display:'flex', alignItems:'center', gap:'6px' }}>
                    <div style={{ width:'6px', height:'6px', background:f.ok?'#059669':'#D97706', flexShrink:0 }}/>
                    <span style={{ fontSize:'10px', color:'#9E8E6E' }}>{f.label}</span>
                  </div>
                  <span style={{ fontSize:'11px', fontWeight:700, color:f.ok?'#059669':'#D97706' }}>{f.val}</span>
                </div>
              ))}
            </div>
          </BCard>
        </div>

        {/* Quick Navigation */}
        <BCard>
          <BCardHeader title="Quick Navigation — Territory Engine"/>
          <div style={{ padding:'16px', display:'grid', gridTemplateColumns:'repeat(6,1fr)', gap:'10px' }}>
            {[
              { label:'States',          count:n.states,                                     route:'/app/location/states',           color:'#B8960C', icon:'🏛️' },
              { label:'Districts',       count:n.districts,                                  route:'/app/location/districts',        color:'#2563EB', icon:'🗺️' },
              { label:'Areas',           count:n.areas,                                      route:'/app/location/areas',            color:'#7C3AED', icon:'📍' },
              { label:'Approval Queue',  count:n.pendingApprovals,                           route:'/app/approvals',                 color:'#DC2626', icon:'✓'  },
              { label:'Admin Assignment',count:n.unassignedDistricts+n.unassignedStates,     route:'/app/location/admin-assignment', color:'#D97706', icon:'👤' },
              ...(hasControl ? [{ label:'Territory Control', count:n.closedStates+n.closedDistricts, route:'/app/location/control', color:'#DC2626', icon:'⊘' }] : []),
            ].map(nav => (
              <button key={nav.label} onClick={() => navigate(nav.route)}

                style={{ background:'#F5F0E8', border:`1px solid ${nav.color}30`, borderTop:`2px solid ${nav.color}`, padding:'14px 10px', cursor:'pointer', textAlign:'center' }}>
                <div style={{ fontSize:'22px', marginBottom:'6px' }}>{nav.icon}</div>
                <div style={{ fontSize:'16px', fontWeight:800, color:nav.color }}>{nav.count.toLocaleString('en-IN')}</div>
                <div style={{ fontSize:'9px', color:'#9E8E6E', marginTop:'3px', textTransform:'uppercase', letterSpacing:'0.5px' }}>{nav.label}</div>
              </button>
            ))}
          </div>
        </BCard>

      </div>

      {/* Footer */}
      <div style={{ background:'#0D1B2A', borderTop:'2px solid #B8960C', padding:'10px 20px', display:'flex', justifyContent:'space-between', marginTop:'14px' }}>
        <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.3)', letterSpacing:'0.5px' }}>ZEMISH NATIONAL COMMAND CENTER v1.0.0</span>
        <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.3)', letterSpacing:'0.5px' }}>PAN INDIA TERRITORY ENGINE</span>
      </div>
    </div>
  )
}