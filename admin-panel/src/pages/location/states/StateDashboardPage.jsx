import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { FONTS } from '../../../config/brand'
import useAuthStore from '../../../store/authStore'

const STATES_DB = {
  'ST001': {
    id: 'ST001', name: 'Uttar Pradesh', code: 'UP',
    status: 'ACTIVE', territory: 'OPEN', coverage: 94,
    lastUpdated: '23 Jun 2026, 05:30 AM',
    summary: { districts: 75, areas: 2840, salons: 4250, activeSalons: 3980, pendingApprovals: 48, totalBookings: 184520, totalRevenue: 42500000, avgRating: 4.3, cancelRate: 7.2 },
    alerts: [
      { type: 'WARNING', msg: 'Varanasi District — Admin Unassigned',    action: 'Assign Admin',   route: '/app/location/admin-assignment', color: '#DC2626' },
      { type: 'WARNING', msg: '8 Districts with coverage < 60%',         action: 'View Districts', route: '/app/location/districts',        color: '#D97706' },
      { type: 'INFO',    msg: '48 Salon approvals pending state review', action: 'Review Now',     route: '/app/approvals',                 color: '#2563EB' },
      { type: 'SUCCESS', msg: 'Revenue up 22% vs last month',            action: null,             route: null,                             color: '#059669' },
    ],
    bookingTrend: [
      { month:'Jan', bookings:12420, revenue:2840000 },
      { month:'Feb', bookings:14580, revenue:3340000 },
      { month:'Mar', bookings:16240, revenue:3720000 },
      { month:'Apr', bookings:15180, revenue:3480000 },
      { month:'May', bookings:18420, revenue:4220000 },
      { month:'Jun', bookings:21840, revenue:5010000 },
    ],
    topDistricts: [
      { id:'DT005', name:'Noida',     salons:340, bookings:38000, coverage:95, territory:'OPEN',    admin:'Rahul Mehta'  },
      { id:'DT001', name:'Lucknow',   salons:420, bookings:42000, coverage:92, territory:'OPEN',    admin:'Vikram Singh' },
      { id:'DT002', name:'Kanpur',    salons:380, bookings:35000, coverage:88, territory:'OPEN',    admin:'Priya Sharma' },
      { id:'DT008', name:'Allahabad', salons:195, bookings:18000, coverage:68, territory:'PARTIAL', admin:'Sanjay Singh' },
      { id:'DT006', name:'Varanasi',  salons:180, bookings:16000, coverage:62, territory:'PARTIAL', admin:'Not Assigned' },
    ],
    lowCoverageDistricts: [
      { name:'Bahraich',   coverage:28, salons:18, admin:'Not Assigned' },
      { name:'Shravasti',  coverage:32, salons:12, admin:'Not Assigned' },
      { name:'Balrampur',  coverage:38, salons:22, admin:'Ravi Gupta'   },
    ],
    pendingApprovals: [
      { id:'SAL020', salon:'Royal Cuts',  district:'Lucknow', owner:'Amit Kumar',  submittedAt:'2026-06-22', step:7, recommendedBy:'Lucknow DISTRICT ADMIN'  },
      { id:'SAL021', salon:'Style Zone',  district:'Noida',   owner:'Priya Verma', submittedAt:'2026-06-21', step:7, recommendedBy:'Noida DISTRICT ADMIN'    },
      { id:'SAL022', salon:'Hair Hub',    district:'Kanpur',  owner:'Raj Singh',   submittedAt:'2026-06-20', step:7, recommendedBy:'Kanpur DISTRICT ADMIN'   },
      { id:'SAL023', salon:'Glow Studio', district:'Agra',    owner:'Neha Gupta',  submittedAt:'2026-06-19', step:7, recommendedBy:'Agra DISTRICT ADMIN'     },
    ],
    healthScore: 89,
    healthFactors: [
      { label:'Territory Coverage',    val:'94%', ok:true  },
      { label:'Active Salons',         val:'94%', ok:true  },
      { label:'Admin Coverage',        val:'91%', ok:true  },
      { label:'Pending Approvals',     val:'48',  ok:false },
      { label:'Revenue Growth',        val:'+22%',ok:true  },
      { label:'Unassigned Districts',  val:'1',   ok:false },
    ],
    districtStats: { total:75, active:74, inactive:1, closed:0, unassigned:1 },
  },
  'ST002': {
    id: 'ST002', name: 'Maharashtra', code: 'MH',
    status: 'ACTIVE', territory: 'OPEN', coverage: 88,
    lastUpdated: '23 Jun 2026, 05:30 AM',
    summary: { districts: 36, areas: 1420, salons: 3180, activeSalons: 2940, pendingApprovals: 32, totalBookings: 142800, totalRevenue: 38200000, avgRating: 4.4, cancelRate: 5.8 },
    alerts: [
      { type: 'INFO',    msg: '32 Salon approvals pending state review', action: 'Review Now', route: '/app/approvals', color: '#2563EB' },
      { type: 'SUCCESS', msg: 'Coverage at 88% — Above target',          action: null,         route: null,             color: '#059669' },
    ],
    bookingTrend: [
      { month:'Jan', bookings:10200, revenue:2640000 },
      { month:'Feb', bookings:11800, revenue:3050000 },
      { month:'Mar', bookings:13400, revenue:3460000 },
      { month:'Apr', bookings:12600, revenue:3260000 },
      { month:'May', bookings:15200, revenue:3930000 },
      { month:'Jun', bookings:18400, revenue:4760000 },
    ],
    topDistricts: [
      { id:'DT009', name:'Mumbai', salons:820, bookings:68000, coverage:97, territory:'OPEN',    admin:'Sanjay Mehta' },
      { id:'DT010', name:'Pune',   salons:540, bookings:42000, coverage:91, territory:'OPEN',    admin:'Neha Joshi'   },
      { id:'DT011', name:'Nagpur', salons:320, bookings:28000, coverage:72, territory:'PARTIAL', admin:'Vijay Kumar'  },
      { id:'DT012', name:'Nashik', salons:240, bookings:18000, coverage:68, territory:'OPEN',    admin:'Priya Patil'  },
    ],
    lowCoverageDistricts: [
      { name:'Gadchiroli', coverage:24, salons:8,  admin:'Not Assigned' },
      { name:'Nandurbar',  coverage:36, salons:14, admin:'Suresh Patil' },
    ],
    pendingApprovals: [
      { id:'SAL030', salon:'Luxe Cuts',   district:'Mumbai', owner:'Raj Kapoor', submittedAt:'2026-06-22', step:7, recommendedBy:'Mumbai DISTRICT ADMIN' },
      { id:'SAL031', salon:'Style House', district:'Pune',   owner:'Nita Shah',  submittedAt:'2026-06-21', step:7, recommendedBy:'Pune DISTRICT ADMIN'   },
    ],
    healthScore: 92,
    healthFactors: [
      { label:'Territory Coverage',   val:'88%', ok:true  },
      { label:'Active Salons',        val:'92%', ok:true  },
      { label:'Admin Coverage',       val:'97%', ok:true  },
      { label:'Pending Approvals',    val:'32',  ok:false },
      { label:'Revenue Growth',       val:'+24%',ok:true  },
      { label:'Unassigned Districts', val:'0',   ok:true  },
    ],
    districtStats: { total:36, active:36, inactive:0, closed:0, unassigned:0 },
  },
}

const TERRITORY_COLORS = { OPEN:{ bg:'#D1FAE5',color:'#065F46' }, PARTIAL:{ bg:'#FEF9C3',color:'#92400E' }, CLOSED:{ bg:'#FEE2E2',color:'#991B1B' } }
const ADMIN_LEVELS     = { SUPER_ADMIN:'SUPER_ADMIN', INDIA_ADMIN:'INDIA_ADMIN', STATE_ADMIN:'STATE_ADMIN', DISTRICT_ADMIN:'DISTRICT_ADMIN' }
const canApprove       = (l) => [ADMIN_LEVELS.SUPER_ADMIN, ADMIN_LEVELS.INDIA_ADMIN, ADMIN_LEVELS.STATE_ADMIN].includes(l)
const canViewDistricts = (l) => l !== ADMIN_LEVELS.DISTRICT_ADMIN

// ─── Reject Reason Modal ──────────────────────────────────
function RejectModal({ salon, onConfirm, onCancel }) {
  const [reason, setReason] = useState('')
  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.75)', zIndex:2000, display:'flex', alignItems:'center', justifyContent:'center' }}>
      <div style={{ background:'#fff', width:'440px', border:'2px solid #DC2626' }}>
        <div style={{ background:'#7F1D1D', padding:'14px 18px', borderBottom:'2px solid #DC2626' }}>
          <div style={{ color:'#fff', fontWeight:800, fontSize:'13px', letterSpacing:'1px' }}>✕ REJECT SALON APPROVAL</div>
        </div>
        <div style={{ padding:'20px 18px' }}>
          <div style={{ fontSize:'12px', color:'#9E8E6E', padding:'10px', background:'#F5F0E8', border:'1px solid #E8DFD0', marginBottom:'14px' }}>
            Rejecting: <strong>{salon}</strong>
          </div>
          <label style={{ fontSize:'10px', color:'#9E8E6E', fontWeight:800, letterSpacing:'1px', display:'block', marginBottom:'6px' }}>REJECTION REASON (REQUIRED)</label>
          <textarea value={reason} onChange={e => setReason(e.target.value)} placeholder="Enter reason for rejection..."
            style={{ width:'100%', border:'1px solid #D4C9B0', padding:'8px 12px', fontSize:'13px', fontFamily:FONTS.body, outline:'none', minHeight:'80px', resize:'vertical', boxSizing:'border-box', marginBottom:'14px' }}
          />
          <div style={{ display:'flex', gap:'8px', justifyContent:'flex-end' }}>
            <button onClick={onCancel} style={{ background:'#fff', border:'1px solid #D4C9B0', color:'#6B5E3E', padding:'8px 16px', fontSize:'11px', fontWeight:700, cursor:'pointer' }}>CANCEL</button>
            <button onClick={() => reason.trim() && onConfirm(reason)} style={{ background:reason.trim()?'#DC2626':'#F5F0E8', border:'none', color:reason.trim()?'#fff':'#C4B49A', padding:'8px 20px', fontSize:'11px', fontWeight:800, cursor:reason.trim()?'pointer':'not-allowed' }}>✕ CONFIRM REJECT</button>
          </div>
        </div>
      </div>
    </div>
  )
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
        <div style={{ fontSize:'10px', color:'#9E8E6E' }}>State Health Score</div>
      </div>
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────
export default function StateDashboardPage() {
  const { id }   = useParams()
  const navigate = useNavigate()
  const admin    = useAuthStore(s => s.admin)
  const adminLevel  = admin?.adminLevel || ADMIN_LEVELS.STATE_ADMIN
  const hasApprove  = canApprove(adminLevel)
  const hasDistricts= canViewDistricts(adminLevel)

  const [filter,      setFilter]      = useState('Last 6 Months')
  const [rejectModal, setRejectModal] = useState(null) // { id, salon }
  const [toast,       setToast]       = useState(null)

  const showToast = (msg, color) => { setToast({ msg, color }); setTimeout(() => setToast(null), 3000) }

  const st = STATES_DB[id] || Object.values(STATES_DB)[0]
  const s  = st.summary

  const handleReject = (reason) => {
    showToast(`✕ ${rejectModal.salon} rejected`, '#DC2626')
    setRejectModal(null)
  }

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
          <button onClick={() => navigate(`/app/location/states/${id}`)} style={{ background:'rgba(255,255,255,0.07)', border:'1px solid rgba(255,255,255,0.1)', color:'rgba(255,255,255,0.6)', padding:'5px 10px', cursor:'pointer', fontSize:'12px', fontWeight:700 }}>← BACK</button>
          <div style={{ width:'3px', height:'16px', background:'#B8960C' }}/>
          <div>
            <div style={{ color:'#fff', fontWeight:800, fontSize:'13px', letterSpacing:'1px' }}>{st.name} ({st.code}) — STATE DASHBOARD</div>
            <div style={{ color:'#B8960C', fontSize:'9px', letterSpacing:'1px', marginTop:'1px' }}>State Admin Command Center • {st.id}</div>
          </div>
          {s.pendingApprovals > 0 && <span style={{ background:'#DC2626', color:'#fff', fontSize:'10px', fontWeight:800, padding:'3px 8px' }}>{s.pendingApprovals} PENDING</span>}
          {st.districtStats.unassigned > 0 && <span style={{ background:'#D97706', color:'#fff', fontSize:'10px', fontWeight:800, padding:'3px 8px' }}>⚠ {st.districtStats.unassigned} UNASSIGNED</span>}
        </div>
        <div style={{ display:'flex', gap:'8px', alignItems:'center' }}>
          <select value={filter} onChange={e=>setFilter(e.target.value)}
            style={{ background:'rgba(255,255,255,0.07)', border:'1px solid rgba(184,150,12,0.4)', color:'#B8960C', padding:'6px 10px', fontSize:'11px', fontWeight:700, cursor:'pointer', fontFamily:FONTS.body, outline:'none' }}>
            {['Last 30 Days','Last 3 Months','Last 6 Months','This Year'].map(f=><option key={f}>{f}</option>)}
          </select>
          {hasApprove && (
            <button onClick={() => navigate('/app/approvals')} style={{ background:'#B8960C', border:'none', color:'#0D1B2A', padding:'6px 14px', fontSize:'10px', fontWeight:800, cursor:'pointer' }}>
              ✓ APPROVAL QUEUE ({s.pendingApprovals})
            </button>
          )}
          {hasDistricts && (
            <button onClick={() => navigate(`/app/location/districts?state=${st.name}`)} style={{ background:'rgba(37,99,235,0.15)', border:'1px solid rgba(37,99,235,0.4)', color:'#93C5FD', padding:'6px 12px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>
              VIEW DISTRICTS
            </button>
          )}
        </div>
      </div>

      {/* Sub-header */}
      <div style={{ background:'#0A1520', borderBottom:'1px solid rgba(184,150,12,0.15)', padding:'6px 20px', display:'flex', justifyContent:'space-between' }}>
        <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.3)' }}>Period: <strong style={{ color:'#B8960C' }}>{filter}</strong></span>
        <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.25)' }}>Data Last Updated: <strong style={{ color:'rgba(255,255,255,0.4)' }}>{st.lastUpdated}</strong></span>
      </div>

      {/* Alerts — correct routing */}
      {st.alerts.length > 0 && (
        <div style={{ background:'#FFFBEB', borderBottom:'2px solid #FDE68A', padding:'8px 20px', display:'flex', gap:'16px', alignItems:'center', flexWrap:'wrap' }}>
          <span style={{ fontSize:'11px', fontWeight:800, color:'#92400E' }}>⚠ STATE ALERTS:</span>
          {st.alerts.map((a,i) => (
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
            { label:'Districts',        value:s.districts,                                color:'#2563EB' },
            { label:'Areas',            value:s.areas.toLocaleString('en-IN'),            color:'#7C3AED' },
            { label:'Total Salons',     value:s.salons.toLocaleString('en-IN'),           color:'#B8960C' },
            { label:'Active Salons',    value:s.activeSalons.toLocaleString('en-IN'),     color:'#059669' },
            { label:'Pending Approvals',value:s.pendingApprovals,                         color:'#DC2626' },
            { label:'Total Bookings',   value:s.totalBookings.toLocaleString('en-IN'),    color:'#0891B2' },
            { label:'Revenue',          value:`₹${(s.totalRevenue/10000000).toFixed(1)}Cr`,color:'#B8960C'},
            { label:'Coverage',         value:`${st.coverage}%`,                          color:st.coverage>=80?'#059669':'#D97706' },
          ].map(k => (
            <BCard key={k.label}>
              <div style={{ padding:'10px 12px' }}>
                <div style={{ fontSize:'14px', fontWeight:800, color:k.color }}>{k.value}</div>
                <div style={{ fontSize:'9px', color:'#9E8E6E', marginTop:'3px', textTransform:'uppercase', letterSpacing:'0.3px' }}>{k.label}</div>
              </div>
            </BCard>
          ))}
        </div>

        {/* District Stats */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:'10px', marginBottom:'14px' }}>
          {[
            { label:'Total Districts',    value:st.districtStats.total,      color:'#1A1A2E' },
            { label:'Active Districts',   value:st.districtStats.active,     color:'#059669' },
            { label:'Inactive Districts', value:st.districtStats.inactive,   color:'#374151' },
            { label:'Closed Districts',   value:st.districtStats.closed,     color:'#DC2626' },
            { label:'Unassigned Admins',  value:st.districtStats.unassigned, color:'#D97706' },
          ].map(m => (
            <div key={m.label} style={{ background:'#0D1B2A', border:'1px solid rgba(184,150,12,0.2)', borderTop:`2px solid ${m.color}`, padding:'12px 14px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <span style={{ fontSize:'11px', color:'rgba(255,255,255,0.4)' }}>{m.label}</span>
              <span style={{ fontSize:'20px', fontWeight:800, color:m.color }}>{m.value}</span>
            </div>
          ))}
        </div>

        {/* Charts */}
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'14px', marginBottom:'14px' }}>
          <BCard>
            <BCardHeader title="Booking Trend" action={<span style={{ fontSize:'10px', color:'#B8960C', fontWeight:700 }}>{filter}</span>}/>
            <div style={{ padding:'14px' }}><LineChart data={st.bookingTrend} valueKey="bookings" labelKey="month" color="#B8960C"/></div>
          </BCard>
          <BCard>
            <BCardHeader title="Revenue Trend (₹)" action={<span style={{ fontSize:'10px', color:'#059669', fontWeight:700 }}>{filter}</span>}/>
            <div style={{ padding:'14px' }}><LineChart data={st.bookingTrend} valueKey="revenue" labelKey="month" color="#059669"/></div>
          </BCard>
        </div>

        {/* Row 3 */}
        <div style={{ display:'grid', gridTemplateColumns:'1.4fr 1fr 0.9fr', gap:'14px', marginBottom:'14px' }}>

          <BCard>
            <BCardHeader title="Top Districts" action={
              hasDistricts && <button onClick={() => navigate(`/app/location/districts?state=${st.name}`)} style={{ background:'none', border:'none', cursor:'pointer', fontSize:'11px', color:'#B8960C', fontWeight:700 }}>VIEW ALL ▸</button>
            }/>
            <div style={{ display:'grid', gridTemplateColumns:'1.2fr 0.6fr 0.8fr 0.7fr 0.8fr', padding:'8px 14px', background:'#F5F0E8', borderBottom:'1px solid #E8DFD0', gap:'8px' }}>
              {['DISTRICT','SALONS','BOOKINGS','COVERAGE','TERRITORY'].map(h => (
                <span key={h} style={{ fontSize:'9px', fontWeight:800, color:'#9E8E6E', letterSpacing:'1px' }}>{h}</span>
              ))}
            </div>
            {st.topDistricts.map((d,i) => {
              const tt = TERRITORY_COLORS[d.territory]||TERRITORY_COLORS.PARTIAL
              return (
                <div key={d.name} style={{ display:'grid', gridTemplateColumns:'1.2fr 0.6fr 0.8fr 0.7fr 0.8fr', padding:'9px 14px', borderBottom:'1px solid #F0EAE0', alignItems:'center', gap:'8px', background:i%2===0?'#fff':'#FDFAF6' }}>
                  <button onClick={() => navigate(`/app/location/districts/${d.id}`)} style={{ background:'none', border:'none', cursor:'pointer', padding:0, textAlign:'left' }}>
                    <div style={{ fontSize:'12px', fontWeight:700, color:d.admin==='Not Assigned'?'#DC2626':'#2563EB', textDecoration:'underline' }}>{d.name}</div>
                    {d.admin==='Not Assigned' && <div style={{ fontSize:'9px', color:'#DC2626', fontWeight:700 }}>⚠ UNASSIGNED</div>}
                  </button>
                  <span style={{ fontSize:'12px', fontWeight:700, color:'#B8960C' }}>{d.salons}</span>
                  <span style={{ fontSize:'11px', color:'#059669', fontWeight:600 }}>{d.bookings.toLocaleString('en-IN')}</span>
                  <div>
                    <div style={{ height:'4px', background:'#E8DFD0' }}>
                      <div style={{ height:'100%', width:`${d.coverage}%`, background:d.coverage>=80?'#059669':d.coverage>=60?'#D97706':'#DC2626' }}/>
                    </div>
                    <span style={{ fontSize:'9px', color:'#9E8E6E' }}>{d.coverage}%</span>
                  </div>
                  <span style={{ fontSize:'9px', fontWeight:800, background:tt.bg, color:tt.color, padding:'2px 5px', display:'inline-block' }}>{d.territory}</span>
                </div>
              )
            })}
          </BCard>

          <BCard>
            <BCardHeader title="Low Coverage Districts" action={
              <span style={{ fontSize:'10px', color:st.lowCoverageDistricts.length>0?'#DC2626':'#059669', fontWeight:700 }}>
                {st.lowCoverageDistricts.length > 0 ? `⚠ ${st.lowCoverageDistricts.length}` : '✓ GOOD'}
              </span>
            }/>
            <div style={{ padding:'14px' }}>
              {st.lowCoverageDistricts.length === 0
                ? <div style={{ textAlign:'center', padding:'20px', color:'#059669', fontSize:'13px', fontWeight:600 }}>✓ No low coverage districts</div>
                : st.lowCoverageDistricts.map((d,i) => (
                    <div key={d.name} style={{ padding:'10px 0', borderBottom:'1px solid #F0EAE0' }}>
                      <div style={{ display:'flex', justifyContent:'space-between', marginBottom:'4px' }}>
                        <span style={{ fontSize:'12px', fontWeight:600, color:'#1A1A2E' }}>{d.name}</span>
                        <span style={{ fontSize:'11px', fontWeight:700, color:'#DC2626' }}>{d.coverage}%</span>
                      </div>
                      <div style={{ height:'4px', background:'#E8DFD0' }}>
                        <div style={{ height:'100%', width:`${d.coverage}%`, background:'#DC2626' }}/>
                      </div>
                      <div style={{ display:'flex', justifyContent:'space-between', marginTop:'3px' }}>
                        <span style={{ fontSize:'9px', color:'#9E8E6E' }}>{d.salons} salons</span>
                        <span style={{ fontSize:'9px', color:d.admin==='Not Assigned'?'#DC2626':'#9E8E6E', fontWeight:700 }}>{d.admin==='Not Assigned'?'⚠ UNASSIGNED':d.admin}</span>
                      </div>
                    </div>
                  ))
              }
              {st.lowCoverageDistricts.length > 0 && (
                <button onClick={() => navigate('/app/location/admin-assignment')} style={{ marginTop:'12px', width:'100%', background:'#FEF2F2', border:'1px solid #DC2626', color:'#DC2626', padding:'8px', fontSize:'10px', fontWeight:800, cursor:'pointer' }}>
                  ASSIGN ADMINS ▸
                </button>
              )}
            </div>
          </BCard>

          <BCard>
            <BCardHeader title="State Health Score"/>
            <div style={{ padding:'16px' }}>
              <HealthGauge score={st.healthScore}/>
              <div style={{ marginTop:'14px' }}>
                {st.healthFactors.map(f => (
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
          <BCardHeader title={`Pending Approvals — Recommended by District Admins (${st.pendingApprovals.length})`} action={
            hasApprove && <button onClick={() => navigate('/app/approvals')} style={{ background:'#B8960C', color:'#0D1B2A', border:'none', padding:'4px 12px', fontSize:'10px', fontWeight:800, cursor:'pointer' }}>VIEW FULL QUEUE ▸</button>
          }/>
          <div style={{ background:'#F0FDF4', borderBottom:'1px solid #D1FAE5', padding:'8px 16px', fontSize:'11px', color:'#065F46', fontWeight:600 }}>
            ⭐ State Admin Workflow: District Admin RECOMMENDS → State Admin APPROVES → Salon goes LIVE
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'0.7fr 1.3fr 0.9fr 0.8fr 0.8fr 1.4fr 1fr', padding:'8px 14px', background:'#F5F0E8', borderBottom:'1px solid #E8DFD0', gap:'8px' }}>
            {['SALON ID','SALON NAME','DISTRICT','OWNER','SUBMITTED','RECOMMENDED BY','ACTIONS'].map(h => (
              <span key={h} style={{ fontSize:'9px', fontWeight:800, color:'#9E8E6E', letterSpacing:'1px' }}>{h}</span>
            ))}
          </div>
          {st.pendingApprovals.map((p,i) => (
            <div key={p.id} style={{ display:'grid', gridTemplateColumns:'0.7fr 1.3fr 0.9fr 0.8fr 0.8fr 1.4fr 1fr', padding:'11px 14px', borderBottom:'1px solid #F0EAE0', alignItems:'center', gap:'8px', background:i%2===0?'#fff':'#FDFAF6' }}>
              <span style={{ fontSize:'10px', color:'#9E8E6E', fontFamily:'monospace' }}>{p.id}</span>
              <span style={{ fontSize:'13px', fontWeight:700, color:'#1A1A2E' }}>{p.salon}</span>
              <span style={{ fontSize:'11px', color:'#6B5E3E' }}>{p.district}</span>
              <span style={{ fontSize:'11px', color:'#6B5E3E' }}>{p.owner}</span>
              <span style={{ fontSize:'11px', color:'#9E8E6E' }}>{p.submittedAt}</span>
              <span style={{ fontSize:'10px', color:'#059669', fontWeight:600 }}>✓ {p.recommendedBy}</span>
              <div style={{ display:'flex', gap:'4px' }}>
                <button onClick={() => navigate(`/app/approvals/${p.id}`)} style={{ background:'#1A1A2E', color:'#fff', border:'none', padding:'5px 8px', fontSize:'9px', fontWeight:700, cursor:'pointer' }}>REVIEW</button>
                {hasApprove && (
                  <>
                    <button onClick={() => showToast(`✓ ${p.salon} approved!`, '#059669')} style={{ background:'#B8960C', color:'#0D1B2A', border:'none', padding:'5px 8px', fontSize:'9px', fontWeight:800, cursor:'pointer' }}>✓ APPROVE</button>
                    <button onClick={() => setRejectModal({ id:p.id, salon:p.salon })} style={{ background:'#FEF2F2', border:'1px solid #DC2626', color:'#DC2626', padding:'5px 8px', fontSize:'9px', fontWeight:700, cursor:'pointer' }}>✕</button>
                  </>
                )}
              </div>
            </div>
          ))}
          {!hasApprove && (
            <div style={{ padding:'10px 16px', background:'#FEF2F2', fontSize:'11px', color:'#991B1B', fontWeight:600 }}>
              ⊘ {adminLevel} — View only. Approval requires State Admin or above.
            </div>
          )}
        </BCard>

      </div>

      <div style={{ background:'#0D1B2A', borderTop:'2px solid #B8960C', padding:'10px 20px', display:'flex', justifyContent:'space-between', marginTop:'14px' }}>
        <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.3)' }}>ZEMISH STATE COMMAND CENTER v1.0.0</span>
        <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.3)' }}>NATIONAL COMMAND CENTER</span>
      </div>

      {rejectModal && <RejectModal salon={rejectModal.salon} onConfirm={handleReject} onCancel={() => setRejectModal(null)}/>}
    </div>
  )
}