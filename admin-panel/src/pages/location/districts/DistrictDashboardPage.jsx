import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { FONTS } from '../../../config/brand'
import useAuthStore from '../../../store/authStore'

const DISTRICTS_DB = {
  'DT001': {
    id: 'DT001', name: 'Lucknow', state: 'Uttar Pradesh', stateCode: 'UP',
    status: 'ACTIVE', territory: 'OPEN', coverage: 92,
    lastUpdated: '23 Jun 2026, 05:15 AM',
    summary: { areas: 124, salons: 420, activeSalons: 398, pendingApprovals: 12, totalBookings: 42000, totalRevenue: 9800000, avgRating: 4.4, cancelRate: 6.2 },
    alerts: [
      { type: 'WARNING', msg: '3 Areas with coverage < 50%', action: 'View Areas', color: '#D97706' },
      { type: 'INFO',    msg: '12 Salon approvals pending review', action: 'Review Now', color: '#2563EB' },
      { type: 'SUCCESS', msg: 'Revenue up 18% vs last month', action: null, color: '#059669' },
    ],
    bookingTrend: [
      { month:'Jan', bookings:5200, revenue:1210000 },
      { month:'Feb', bookings:6100, revenue:1420000 },
      { month:'Mar', bookings:7400, revenue:1720000 },
      { month:'Apr', bookings:6800, revenue:1580000 },
      { month:'May', bookings:8200, revenue:1910000 },
      { month:'Jun', bookings:9800, revenue:2280000 },
    ],
    topAreas: [
      { name:'Hazratganj',   salons:42, bookings:8400, coverage:98, territory:'OPEN'    },
      { name:'Gomti Nagar',  salons:38, bookings:7600, coverage:94, territory:'OPEN'    },
      { name:'Aliganj',      salons:31, bookings:6200, coverage:72, territory:'PARTIAL' },
      { name:'Indira Nagar', salons:28, bookings:5600, coverage:85, territory:'OPEN'    },
      { name:'Aminabad',     salons:24, bookings:4800, coverage:48, territory:'PARTIAL' },
    ],
    lowCoverageAreas: [
      { name:'Aminabad',   coverage:48, salons:24, territory:'PARTIAL' },
      { name:'Sitapur Rd', coverage:38, salons:12, territory:'PARTIAL' },
      { name:'Rajajipuram',coverage:32, salons:8,  territory:'PARTIAL' },
    ],
    pendingApprovals: [
      { id:'SAL020', salon:'Royal Cuts',   owner:'Amit Kumar',  submittedAt:'2026-06-22', step:7 },
      { id:'SAL021', salon:'Style Zone',   owner:'Priya Verma', submittedAt:'2026-06-21', step:6 },
      { id:'SAL022', salon:'Hair Hub',     owner:'Raj Singh',   submittedAt:'2026-06-20', step:7 },
      { id:'SAL023', salon:'Glow Studio',  owner:'Neha Gupta',  submittedAt:'2026-06-19', step:7 },
    ],
    healthScore: 91,
    healthFactors: [
      { label:'Coverage',          val:'92%', score:92, ok:true  },
      { label:'Active Salons',     val:'95%', score:95, ok:true  },
      { label:'Admin Assigned',    val:'Yes', score:100, ok:true },
      { label:'Pending Approvals', val:'12',  score:60, ok:false },
      { label:'Revenue Growth',    val:'+18%',score:95, ok:true  },
    ],
  },
  'DT009': {
    id: 'DT009', name: 'Mumbai', state: 'Maharashtra', stateCode: 'MH',
    status: 'ACTIVE', territory: 'OPEN', coverage: 97,
    lastUpdated: '23 Jun 2026, 05:15 AM',
    summary: { areas: 180, salons: 820, activeSalons: 798, pendingApprovals: 18, totalBookings: 68000, totalRevenue: 18400000, avgRating: 4.6, cancelRate: 4.8 },
    alerts: [
      { type: 'INFO',    msg: '18 Salon approvals pending review', action: 'Review Now', color: '#2563EB' },
      { type: 'SUCCESS', msg: 'Coverage at 97% — Excellent', action: null, color: '#059669' },
    ],
    bookingTrend: [
      { month:'Jan', bookings:9200, revenue:2490000 },
      { month:'Feb', bookings:10800, revenue:2920000 },
      { month:'Mar', bookings:12400, revenue:3350000 },
      { month:'Apr', bookings:11600, revenue:3130000 },
      { month:'May', bookings:14200, revenue:3840000 },
      { month:'Jun', bookings:16800, revenue:4540000 },
    ],
    topAreas: [
      { name:'Andheri',  salons:92, bookings:18400, coverage:98, territory:'OPEN' },
      { name:'Bandra',   salons:88, bookings:17600, coverage:97, territory:'OPEN' },
      { name:'Juhu',     salons:64, bookings:12800, coverage:95, territory:'OPEN' },
      { name:'Powai',    salons:58, bookings:11600, coverage:92, territory:'OPEN' },
      { name:'Kurla',    salons:48, bookings:9600,  coverage:88, territory:'OPEN' },
    ],
    lowCoverageAreas: [],
    pendingApprovals: [
      { id:'SAL030', salon:'Luxe Cuts',   owner:'Raj Kapoor', submittedAt:'2026-06-22', step:7 },
      { id:'SAL031', salon:'Style House', owner:'Nita Shah',  submittedAt:'2026-06-21', step:7 },
    ],
    healthScore: 96,
    healthFactors: [
      { label:'Coverage',          val:'97%', score:97, ok:true },
      { label:'Active Salons',     val:'97%', score:97, ok:true },
      { label:'Admin Assigned',    val:'Yes', score:100,ok:true },
      { label:'Pending Approvals', val:'18',  score:55, ok:false},
      { label:'Revenue Growth',    val:'+22%',score:98, ok:true },
    ],
  },
}

const TERRITORY_COLORS = { OPEN:{ bg:'#D1FAE5',color:'#065F46' }, PARTIAL:{ bg:'#FEF9C3',color:'#92400E' }, CLOSED:{ bg:'#FEE2E2',color:'#991B1B' } }

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
  const c = 2*Math.PI*48
  const off = c-(score/100)*c
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
        <div style={{ fontSize:'13px', fontWeight:800, color, letterSpacing:'1px', marginBottom:'8px' }}>{label}</div>
        <div style={{ fontSize:'10px', color:'#9E8E6E' }}>District Health Score</div>
      </div>
    </div>
  )
}

export default function DistrictDashboardPage() {
  const { id }   = useParams()
  const navigate = useNavigate()
  const admin    = useAuthStore(s => s.admin)
  const [filter, setFilter] = useState('Last 6 Months')

  const d = DISTRICTS_DB[id] || Object.values(DISTRICTS_DB)[0]
  const s = d.summary

  return (
    <div style={{ fontFamily:FONTS.body, background:'#F0EAE0', minHeight:'100vh' }}>

      {/* Header */}
      <div style={{ background:'#0D1B2A', borderBottom:'2px solid #B8960C', padding:'0 20px', height:'52px', display:'flex', alignItems:'center', justifyContent:'space-between', position:'sticky', top:0, zIndex:10 }}>
        <div style={{ display:'flex', alignItems:'center', gap:'12px' }}>
          <button onClick={() => navigate(`/app/location/districts/${id}`)} style={{ background:'rgba(255,255,255,0.07)', border:'1px solid rgba(255,255,255,0.1)', color:'rgba(255,255,255,0.6)', padding:'5px 10px', cursor:'pointer', fontSize:'12px', fontWeight:700 }}>← BACK</button>
          <div style={{ width:'3px', height:'16px', background:'#B8960C' }}/>
          <div>
            <div style={{ color:'#fff', fontWeight:800, fontSize:'13px', letterSpacing:'1px' }}>{d.name}, {d.stateCode} — DASHBOARD</div>
            <div style={{ color:'#B8960C', fontSize:'9px', letterSpacing:'1px', marginTop:'1px' }}>District Admin Command Center • {d.id}</div>
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
          <button onClick={() => navigate('/app/approvals')} style={{ background:'#B8960C', border:'none', color:'#0D1B2A', padding:'6px 14px', fontSize:'10px', fontWeight:800, cursor:'pointer', letterSpacing:'0.5px' }}>
            ✓ APPROVAL QUEUE ({s.pendingApprovals})
          </button>
        </div>
      </div>

      {/* Sub-header — last updated */}
      <div style={{ background:'#0A1520', borderBottom:'1px solid rgba(184,150,12,0.15)', padding:'6px 20px', display:'flex', justifyContent:'space-between' }}>
        <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.3)' }}>Period: <strong style={{ color:'#B8960C' }}>{filter}</strong></span>
        <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.25)' }}>Data Last Updated: <strong style={{ color:'rgba(255,255,255,0.4)' }}>{d.lastUpdated}</strong></span>
      </div>

      {/* Alerts Bar */}
      {d.alerts.length > 0 && (
        <div style={{ background:'#FFFBEB', borderBottom:'2px solid #FDE68A', padding:'8px 20px', display:'flex', gap:'16px', alignItems:'center', flexWrap:'wrap' }}>
          <span style={{ fontSize:'11px', fontWeight:800, color:'#92400E', letterSpacing:'0.5px' }}>⚠ DISTRICT ALERTS:</span>
          {d.alerts.map((a,i) => (
            <div key={i} style={{ display:'flex', alignItems:'center', gap:'6px' }}>
              <div style={{ width:'6px', height:'6px', background:a.color, flexShrink:0 }}/>
              <span style={{ fontSize:'11px', color:'#1A1A2E' }}>{a.msg}</span>
              {a.action && <button onClick={() => navigate('/app/approvals')} style={{ background:'none', border:'none', cursor:'pointer', fontSize:'11px', color:a.color, fontWeight:700, padding:0, textDecoration:'underline' }}>{a.action}</button>}
            </div>
          ))}
        </div>
      )}

      <div style={{ padding:'14px 20px' }}>

        {/* KPI Strip */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(8,1fr)', gap:'10px', marginBottom:'14px' }}>
          {[
            { label:'Areas',            value:s.areas,                               color:'#2563EB' },
            { label:'Total Salons',     value:s.salons,                              color:'#B8960C' },
            { label:'Active Salons',    value:s.activeSalons,                        color:'#059669' },
            { label:'Pending Approvals',value:s.pendingApprovals,                    color:'#DC2626' },
            { label:'Total Bookings',   value:s.totalBookings.toLocaleString('en-IN'),color:'#7C3AED'},
            { label:'Revenue',          value:`₹${(s.totalRevenue/100000).toFixed(1)}L`, color:'#B8960C'},
            { label:'Avg Rating',       value:`${s.avgRating}★`,                    color:'#D97706' },
            { label:'Coverage',         value:`${d.coverage}%`,                      color:d.coverage>=80?'#059669':'#D97706' },
          ].map(k => (
            <BCard key={k.label}>
              <div style={{ padding:'10px 12px' }}>
                <div style={{ fontSize:'14px', fontWeight:800, color:k.color }}>{k.value}</div>
                <div style={{ fontSize:'9px', color:'#9E8E6E', marginTop:'3px', textTransform:'uppercase', letterSpacing:'0.3px' }}>{k.label}</div>
              </div>
            </BCard>
          ))}
        </div>

        {/* Row 2: Charts */}
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'14px', marginBottom:'14px' }}>
          <BCard>
            <BCardHeader title="Booking Trend" action={<span style={{ fontSize:'10px', color:'#B8960C', fontWeight:700 }}>{filter}</span>}/>
            <div style={{ padding:'14px' }}><LineChart data={d.bookingTrend} valueKey="bookings" labelKey="month" color="#B8960C"/></div>
          </BCard>
          <BCard>
            <BCardHeader title="Revenue Trend (₹)" action={<span style={{ fontSize:'10px', color:'#059669', fontWeight:700 }}>{filter}</span>}/>
            <div style={{ padding:'14px' }}><LineChart data={d.bookingTrend} valueKey="revenue" labelKey="month" color="#059669"/></div>
          </BCard>
        </div>

        {/* Row 3: Top Areas + Low Coverage + Health */}
        <div style={{ display:'grid', gridTemplateColumns:'1.4fr 1fr 0.9fr', gap:'14px', marginBottom:'14px' }}>

          {/* Top Areas */}
          <BCard>
            <BCardHeader title="Top Areas by Salons"/>
            <div style={{ display:'grid', gridTemplateColumns:'1.5fr 0.6fr 0.8fr 0.7fr 0.8fr', padding:'8px 14px', background:'#F5F0E8', borderBottom:'1px solid #E8DFD0', gap:'8px' }}>
              {['AREA','SALONS','BOOKINGS','COVERAGE','TERRITORY'].map(h => (
                <span key={h} style={{ fontSize:'9px', fontWeight:800, color:'#9E8E6E', letterSpacing:'1px' }}>{h}</span>
              ))}
            </div>
            {d.topAreas.map((a,i) => {
              const tt = TERRITORY_COLORS[a.territory]||TERRITORY_COLORS.PARTIAL
              return (
                <div key={a.name} style={{ display:'grid', gridTemplateColumns:'1.5fr 0.6fr 0.8fr 0.7fr 0.8fr', padding:'9px 14px', borderBottom:'1px solid #F0EAE0', alignItems:'center', gap:'8px', background:i%2===0?'#fff':'#FDFAF6' }}>
                  <span style={{ fontSize:'12px', fontWeight:600, color:'#1A1A2E' }}>{a.name}</span>
                  <span style={{ fontSize:'12px', fontWeight:700, color:'#B8960C' }}>{a.salons}</span>
                  <span style={{ fontSize:'11px', color:'#059669', fontWeight:600 }}>{a.bookings.toLocaleString('en-IN')}</span>
                  <div>
                    <div style={{ height:'4px', background:'#E8DFD0' }}>
                      <div style={{ height:'100%', width:`${a.coverage}%`, background:a.coverage>=80?'#059669':a.coverage>=60?'#D97706':'#DC2626' }}/>
                    </div>
                    <span style={{ fontSize:'9px', color:'#9E8E6E' }}>{a.coverage}%</span>
                  </div>
                  <span style={{ fontSize:'9px', fontWeight:800, background:tt.bg, color:tt.color, padding:'2px 5px', display:'inline-block' }}>{a.territory}</span>
                </div>
              )
            })}
          </BCard>

          {/* Low Coverage Alerts */}
          <BCard>
            <BCardHeader title="Low Coverage Areas" action={
              <span style={{ fontSize:'10px', color:d.lowCoverageAreas.length>0?'#DC2626':'#059669', fontWeight:700 }}>{d.lowCoverageAreas.length > 0 ? `⚠ ${d.lowCoverageAreas.length} AREAS` : '✓ ALL GOOD'}</span>
            }/>
            <div style={{ padding:'14px' }}>
              {d.lowCoverageAreas.length === 0
                ? <div style={{ textAlign:'center', padding:'20px', color:'#059669', fontSize:'13px', fontWeight:600 }}>✓ No low coverage areas</div>
                : d.lowCoverageAreas.map((a,i) => (
                    <div key={a.name} style={{ padding:'10px 0', borderBottom:'1px solid #F0EAE0' }}>
                      <div style={{ display:'flex', justifyContent:'space-between', marginBottom:'4px' }}>
                        <span style={{ fontSize:'12px', fontWeight:600, color:'#1A1A2E' }}>{a.name}</span>
                        <span style={{ fontSize:'11px', fontWeight:700, color:'#DC2626' }}>{a.coverage}%</span>
                      </div>
                      <div style={{ height:'4px', background:'#E8DFD0' }}>
                        <div style={{ height:'100%', width:`${a.coverage}%`, background:'#DC2626' }}/>
                      </div>
                      <div style={{ display:'flex', justifyContent:'space-between', marginTop:'3px' }}>
                        <span style={{ fontSize:'9px', color:'#9E8E6E' }}>{a.salons} salons</span>
                        <span style={{ fontSize:'9px', color:'#D97706', fontWeight:700 }}>⚠ LOW</span>
                      </div>
                    </div>
                  ))
              }
              {d.lowCoverageAreas.length > 0 && (
                <button onClick={() => navigate(`/app/location/districts/${id}`)} style={{ marginTop:'12px', width:'100%', background:'#FEF2F2', border:'1px solid #DC2626', color:'#DC2626', padding:'8px', fontSize:'10px', fontWeight:800, cursor:'pointer' }}>
                  VIEW ALL AREAS ▸
                </button>
              )}
            </div>
          </BCard>

          {/* Health Score */}
          <BCard>
            <BCardHeader title="District Health"/>
            <div style={{ padding:'16px' }}>
              <HealthGauge score={d.healthScore}/>
              <div style={{ marginTop:'14px' }}>
                {d.healthFactors.map(f => (
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

        {/* Row 4: Pending Approvals — District Admin Primary Workspace */}
        <BCard>
          <BCardHeader title={`Pending Approvals — Requires Your Action (${d.pendingApprovals.length})`} action={
            <button onClick={() => navigate('/app/approvals')} style={{ background:'#B8960C', color:'#0D1B2A', border:'none', padding:'4px 12px', fontSize:'10px', fontWeight:800, cursor:'pointer' }}>VIEW FULL QUEUE ▸</button>
          }/>
          <div style={{ background:'#FFFBEB', borderBottom:'1px solid #FDE68A', padding:'8px 16px', fontSize:'11px', color:'#92400E', fontWeight:600 }}>
            ⭐ District Admin Workflow: Review salon → RECOMMEND to State Admin → State Admin approves
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'0.7fr 1.5fr 1.2fr 0.8fr 0.8fr 1.2fr', padding:'8px 14px', background:'#F5F0E8', borderBottom:'1px solid #E8DFD0', gap:'8px' }}>
            {['SALON ID','SALON NAME','OWNER','SUBMITTED','STEP','ACTIONS'].map(h => (
              <span key={h} style={{ fontSize:'9px', fontWeight:800, color:'#9E8E6E', letterSpacing:'1px' }}>{h}</span>
            ))}
          </div>
          {d.pendingApprovals.map((p,i) => (
            <div key={p.id} style={{ display:'grid', gridTemplateColumns:'0.7fr 1.5fr 1.2fr 0.8fr 0.8fr 1.2fr', padding:'11px 14px', borderBottom:'1px solid #F0EAE0', alignItems:'center', gap:'8px', background:i%2===0?'#fff':'#FDFAF6' }}>
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
                <button style={{ background:'#059669', color:'#fff', border:'none', padding:'5px 8px', fontSize:'9px', fontWeight:700, cursor:'pointer' }}>↑ RECOMMEND</button>
                <button style={{ background:'#FEF2F2', border:'1px solid #DC2626', color:'#DC2626', padding:'5px 8px', fontSize:'9px', fontWeight:700, cursor:'pointer' }}>✕</button>
              </div>
            </div>
          ))}
        </BCard>

      </div>

      <div style={{ background:'#0D1B2A', borderTop:'2px solid #B8960C', padding:'10px 20px', display:'flex', justifyContent:'space-between', marginTop:'14px' }}>
        <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.3)' }}>ZEMISH DISTRICT COMMAND CENTER v1.0.0</span>
        <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.3)' }}>NATIONAL COMMAND CENTER</span>
      </div>
    </div>
  )
}