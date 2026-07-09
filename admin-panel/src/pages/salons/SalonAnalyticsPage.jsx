import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { FONTS } from '../../config/brand'

const ANALYTICS_DB = {
  'SAL001': {
    id: 'SAL001', salon: 'Salman Salmani', district: 'Hapur', state: 'Uttar Pradesh',
    lastUpdated: '23 Jun 2026, 11:45 PM',
    summary: { totalBookings: 842, totalRevenue: 184500, avgRating: 4.5, repeatCustomers: 312, totalCustomers: 580, cancelRate: 8.2, avgBookingValue: 219 },
    bookingTrend: [
      { month: 'Jan', bookings: 42,  revenue: 9200  },
      { month: 'Feb', bookings: 58,  revenue: 12700 },
      { month: 'Mar', bookings: 71,  revenue: 15550 },
      { month: 'Apr', bookings: 65,  revenue: 14230 },
      { month: 'May', bookings: 89,  revenue: 19500 },
      { month: 'Jun', bookings: 112, revenue: 24530 },
    ],
    topServices: [
      { name: 'Haircut',       bookings: 420, revenue: 63000, pct: 100 },
      { name: 'Beard Styling', bookings: 210, revenue: 21000, pct: 50  },
      { name: 'Hair Color',    bookings: 80,  revenue: 40000, pct: 19  },
      { name: 'Facial',        bookings: 65,  revenue: 19500, pct: 15  },
      { name: 'Head Massage',  bookings: 67,  revenue: 13400, pct: 16  },
    ],
    customerGrowth: [
      { month: 'Jan', new: 48,  repeat: 20 },
      { month: 'Feb', new: 62,  repeat: 28 },
      { month: 'Mar', new: 75,  repeat: 38 },
      { month: 'Apr', new: 68,  repeat: 42 },
      { month: 'May', new: 92,  repeat: 58 },
      { month: 'Jun', new: 115, repeat: 76 },
    ],
    peakHours: [
      { hour: '9AM',  count: 32 }, { hour: '10AM', count: 58 },
      { hour: '11AM', count: 72 }, { hour: '12PM', count: 45 },
      { hour: '1PM',  count: 28 }, { hour: '2PM',  count: 35 },
      { hour: '3PM',  count: 62 }, { hour: '4PM',  count: 85 },
      { hour: '5PM',  count: 95 }, { hour: '6PM',  count: 88 },
      { hour: '7PM',  count: 65 }, { hour: '8PM',  count: 42 },
    ],
    ratings: { 5: 68, 4: 22, 3: 7, 2: 2, 1: 1 },
    healthScore: 87,
    districtAvg: { bookings: 620, revenue: 135000, rating: 4.2 },
    stateAvg:    { bookings: 580, revenue: 128000, rating: 4.1 },
  },
  'SAL002': {
    id: 'SAL002', salon: 'Royal Cuts Studio', district: 'Noida', state: 'Uttar Pradesh',
    lastUpdated: '23 Jun 2026, 11:45 PM',
    summary: { totalBookings: 0, totalRevenue: 0, avgRating: 0, repeatCustomers: 0, totalCustomers: 0, cancelRate: 0, avgBookingValue: 0 },
    bookingTrend: [], topServices: [], customerGrowth: [], peakHours: [],
    ratings: { 5:0, 4:0, 3:0, 2:0, 1:0 },
    healthScore: 0,
    districtAvg: null, stateAvg: null,
  },
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

function EmptyState({ msg }) {
  return (
    <div style={{ padding:'32px', textAlign:'center' }}>
      <div style={{ fontSize:'32px', marginBottom:'10px' }}>📊</div>
      <div style={{ fontSize:'13px', fontWeight:700, color:'#1A1A2E', marginBottom:'4px' }}>No Analytics Available</div>
      <div style={{ fontSize:'11px', color:'#9E8E6E' }}>{msg || 'Data will appear once bookings start coming in.'}</div>
    </div>
  )
}

function LineChart({ data, valueKey, labelKey, color='#B8960C', height=120 }) {
  if (!data || data.length === 0) return <EmptyState/>
  const max = Math.max(...data.map(d => d[valueKey]))
  const w=400, h=height, pad=20
  const pts = data.map((d,i) => ({
    x: pad+(i/(data.length-1))*(w-pad*2),
    y: h-pad-((d[valueKey]/max)*(h-pad*2)),
    val: d[valueKey], label: d[labelKey],
  }))
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
          <text x={p.x} y={p.y-8} fontSize="9" fill={color} textAnchor="middle" fontWeight="700">{p.val}</text>
        </g>
      ))}
    </svg>
  )
}

function BarChart({ data, valueKey, labelKey, color='#B8960C', height=120 }) {
  if (!data || data.length === 0) return <EmptyState/>
  const max = Math.max(...data.map(d => d[valueKey]))
  return (
    <div style={{ display:'flex', alignItems:'flex-end', gap:'4px', height:`${height}px`, padding:'0 4px' }}>
      {data.map((d,i) => (
        <div key={i} style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', gap:'3px', height:'100%', justifyContent:'flex-end' }}>
          <div style={{ fontSize:'8px', color:'#1A1A2E', fontWeight:700 }}>{d[valueKey]}</div>
          <div style={{ width:'100%', background:color, height:`${(d[valueKey]/max)*100}%`, minHeight:'2px' }}/>
          <div style={{ fontSize:'8px', color:'#9E8E6E', textAlign:'center' }}>{d[labelKey]}</div>
        </div>
      ))}
    </div>
  )
}

function DualBarChart({ data, height=120 }) {
  if (!data || data.length === 0) return <EmptyState/>
  const max = Math.max(...data.map(d => d.new+d.repeat))
  return (
    <div>
      <div style={{ display:'flex', gap:'12px', marginBottom:'8px' }}>
        <div style={{ display:'flex', alignItems:'center', gap:'4px' }}><div style={{ width:'10px', height:'10px', background:'#B8960C' }}/><span style={{ fontSize:'10px', color:'#6B5E3E' }}>New</span></div>
        <div style={{ display:'flex', alignItems:'center', gap:'4px' }}><div style={{ width:'10px', height:'10px', background:'#059669' }}/><span style={{ fontSize:'10px', color:'#6B5E3E' }}>Repeat</span></div>
      </div>
      <div style={{ display:'flex', alignItems:'flex-end', gap:'6px', height:`${height}px` }}>
        {data.map((d,i) => (
          <div key={i} style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', gap:'4px', height:'100%', justifyContent:'flex-end' }}>
            <div style={{ width:'100%', display:'flex', flexDirection:'column', height:`${((d.new+d.repeat)/max)*100}%` }}>
              <div style={{ flex:d.new, background:'#B8960C' }}/>
              <div style={{ flex:d.repeat, background:'#059669' }}/>
            </div>
            <div style={{ fontSize:'9px', color:'#9E8E6E' }}>{d.month}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

function HealthScore({ score }) {
  const color = score>=80?'#059669':score>=60?'#D97706':'#DC2626'
  const label = score>=80?'EXCELLENT':score>=60?'GOOD':score>=40?'AVERAGE':'POOR'
  const c = 2*Math.PI*54
  const off = c-(score/100)*c
  return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', padding:'16px' }}>
      <svg width="130" height="130" viewBox="0 0 140 140">
        <circle cx="70" cy="70" r="54" fill="none" stroke="#E8DFD0" strokeWidth="12"/>
        <circle cx="70" cy="70" r="54" fill="none" stroke={color} strokeWidth="12"
          strokeDasharray={c} strokeDashoffset={off} transform="rotate(-90 70 70)" strokeLinecap="butt"/>
        <text x="70" y="63" textAnchor="middle" fontSize="28" fontWeight="800" fill={color}>{score}</text>
        <text x="70" y="80" textAnchor="middle" fontSize="10" fill="#9E8E6E">/ 100</text>
      </svg>
      <div style={{ fontSize:'12px', fontWeight:800, color, letterSpacing:'2px', marginTop:'6px' }}>{label}</div>
    </div>
  )
}

// ─── Export Dropdown ──────────────────────────────────────
function ExportMenu() {
  const [open, setOpen] = useState(false)
  return (
    <div style={{ position:'relative' }}>
      <button onClick={() => setOpen(o=>!o)} style={{ background:'#B8960C', border:'none', color:'#0D1B2A', padding:'6px 14px', fontSize:'10px', fontWeight:800, cursor:'pointer', letterSpacing:'0.5px' }}>
        ↓ EXPORT ▾
      </button>
      {open && (
        <div style={{ position:'absolute', right:0, top:'32px', background:'#fff', border:'1px solid #D4C9B0', borderTop:'2px solid #B8960C', width:'140px', zIndex:100 }}>
          {['Export CSV','Export PDF','Export Excel'].map(opt => (
            <button key={opt} onClick={() => setOpen(false)} style={{ width:'100%', background:'none', border:'none', borderBottom:'1px solid #F0EAE0', padding:'9px 12px', fontSize:'11px', color:'#1A1A2E', cursor:'pointer', textAlign:'left', fontFamily:FONTS.body, fontWeight:600 }}>
              {opt}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────
export default function SalonAnalyticsPage() {
  const { id }   = useParams()
  const navigate = useNavigate()
  const [filter,  setFilter]  = useState('Last 6 Months')
  const [compare, setCompare] = useState('None')

  const data = ANALYTICS_DB[id] || {
    id, salon: id, district: '—', state: '—',
    lastUpdated: '—',
    summary: { totalBookings:0, totalRevenue:0, avgRating:0, repeatCustomers:0, totalCustomers:0, cancelRate:0, avgBookingValue:0 },
    bookingTrend:[], topServices:[], customerGrowth:[], peakHours:[],
    ratings:{5:0,4:0,3:0,2:0,1:0},
    healthScore:0, districtAvg:null, stateAvg:null,
  }
  const s    = data.summary
  const isEmpty = s.totalBookings === 0

  const KPI_CARDS = [
    { label:'Total Bookings',    value: s.totalBookings.toLocaleString('en-IN'),         color:'#2563EB', icon:'📅', distAvg: data.districtAvg?.bookings },
    { label:'Total Revenue',     value: `₹${s.totalRevenue.toLocaleString('en-IN')}`,    color:'#B8960C', icon:'💰', distAvg: data.districtAvg?.revenue  },
    { label:'Avg Rating',        value: s.avgRating ? `${s.avgRating} ★` : 'N/A',       color:'#D97706', icon:'⭐', distAvg: data.districtAvg?.rating   },
    { label:'Repeat Customers',  value: s.repeatCustomers.toLocaleString('en-IN'),       color:'#059669', icon:'👥', distAvg: null },
    { label:'Total Customers',   value: s.totalCustomers.toLocaleString('en-IN'),        color:'#7C3AED', icon:'👤', distAvg: null },
    { label:'Avg Booking Value', value: `₹${s.avgBookingValue.toLocaleString('en-IN')}`, color:'#0891B2', icon:'📊', distAvg: null },
    { label:'Cancel Rate',       value: `${s.cancelRate}%`,                              color:'#DC2626', icon:'❌', distAvg: null },
  ]

  return (
    <div style={{ fontFamily:FONTS.body, background:'#F0EAE0', minHeight:'100vh' }}>

      {/* Header */}
      <div style={{ background:'#0D1B2A', borderBottom:'2px solid #B8960C', padding:'0 20px', height:'52px', display:'flex', alignItems:'center', justifyContent:'space-between', position:'sticky', top:0, zIndex:10 }}>
        <div style={{ display:'flex', alignItems:'center', gap:'12px' }}>
          <button onClick={() => navigate(`/app/salons/${id}`)} style={{ background:'rgba(255,255,255,0.07)', border:'1px solid rgba(255,255,255,0.1)', color:'rgba(255,255,255,0.6)', padding:'5px 10px', cursor:'pointer', fontSize:'12px', fontWeight:700 }}>← BACK</button>
          <div style={{ width:'3px', height:'16px', background:'#B8960C' }}/>
          <div>
            <div style={{ color:'#fff', fontWeight:800, fontSize:'13px', letterSpacing:'1px' }}>{data.salon} — ANALYTICS</div>
            <div style={{ color:'#B8960C', fontSize:'9px', letterSpacing:'1px', marginTop:'1px' }}>{data.id} • {data.district}, {data.state}</div>
          </div>
        </div>
        <div style={{ display:'flex', gap:'8px', alignItems:'center' }}>
          <select value={compare} onChange={e => setCompare(e.target.value)}
            style={{ background:'rgba(255,255,255,0.07)', border:'1px solid rgba(255,255,255,0.15)', color:'rgba(255,255,255,0.5)', padding:'6px 10px', fontSize:'10px', fontWeight:600, cursor:'pointer', fontFamily:FONTS.body, outline:'none' }}>
            {['None','District Average','State Average','Top 10 Salons'].map(f => <option key={f}>{f}</option>)}
          </select>
          <select value={filter} onChange={e => setFilter(e.target.value)}
            style={{ background:'rgba(255,255,255,0.07)', border:'1px solid rgba(184,150,12,0.4)', color:'#B8960C', padding:'6px 10px', fontSize:'11px', fontWeight:700, cursor:'pointer', fontFamily:FONTS.body, outline:'none' }}>
            {['Last 30 Days','Last 3 Months','Last 6 Months','This Year'].map(f => <option key={f}>{f}</option>)}
          </select>
          <ExportMenu/>
        </div>
      </div>

      {/* Data Update Banner */}
      <div style={{ background:'#0A1520', borderBottom:'1px solid rgba(184,150,12,0.15)', padding:'6px 20px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
        <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.3)', letterSpacing:'0.5px' }}>
          Analytics Period: <strong style={{ color:'#B8960C' }}>{filter}</strong>
        </span>
        <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.25)', letterSpacing:'0.5px' }}>
          Data Last Updated: <strong style={{ color:'rgba(255,255,255,0.4)' }}>{data.lastUpdated}</strong>
        </span>
      </div>

      {/* Empty State for no-data salons */}
      {isEmpty ? (
        <div style={{ padding:'40px 20px' }}>
          <BCard>
            <div style={{ padding:'60px 20px', textAlign:'center' }}>
              <div style={{ fontSize:'48px', marginBottom:'16px' }}>📊</div>
              <div style={{ fontSize:'18px', fontWeight:800, color:'#1A1A2E', marginBottom:'8px' }}>No Analytics Available Yet</div>
              <div style={{ fontSize:'13px', color:'#9E8E6E', marginBottom:'20px' }}>This salon has not received any bookings yet. Analytics will appear once bookings start coming in.</div>
              <button onClick={() => navigate(`/app/salons/${id}`)} style={{ background:'#B8960C', color:'#0D1B2A', border:'none', padding:'10px 24px', fontSize:'12px', fontWeight:800, cursor:'pointer', letterSpacing:'0.5px' }}>
                ← BACK TO SALON PROFILE
              </button>
            </div>
          </BCard>
        </div>
      ) : (
        <div style={{ padding:'16px 20px' }}>

          {/* KPI Cards */}
          <div style={{ display:'grid', gridTemplateColumns:'repeat(7,1fr)', gap:'10px', marginBottom:'14px' }}>
            {KPI_CARDS.map(k => (
              <BCard key={k.label}>
                <div style={{ padding:'12px' }}>
                  <div style={{ fontSize:'18px', marginBottom:'6px' }}>{k.icon}</div>
                  <div style={{ fontSize:'16px', fontWeight:800, color:k.color }}>{k.value}</div>
                  <div style={{ fontSize:'9px', color:'#9E8E6E', marginTop:'3px', textTransform:'uppercase', letterSpacing:'0.3px' }}>{k.label}</div>
                  {compare !== 'None' && k.distAvg && (
                    <div style={{ fontSize:'9px', color:'#7C3AED', marginTop:'4px', fontWeight:600 }}>
                      Avg: {typeof k.distAvg === 'number' && k.distAvg > 1000 ? `₹${k.distAvg.toLocaleString('en-IN')}` : k.distAvg}
                    </div>
                  )}
                </div>
              </BCard>
            ))}
          </div>

          {/* Row 2: Charts */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'14px', marginBottom:'14px' }}>
            <BCard>
              <BCardHeader title="Booking Trend" action={<span style={{ fontSize:'10px', color:'#B8960C', fontWeight:700 }}>{filter}</span>}/>
              <div style={{ padding:'14px' }}><LineChart data={data.bookingTrend} valueKey="bookings" labelKey="month" color="#B8960C"/></div>
            </BCard>
            <BCard>
              <BCardHeader title="Revenue Trend (₹)" action={<span style={{ fontSize:'10px', color:'#059669', fontWeight:700 }}>{filter}</span>}/>
              <div style={{ padding:'14px' }}><LineChart data={data.bookingTrend} valueKey="revenue" labelKey="month" color="#059669"/></div>
            </BCard>
          </div>

          {/* Row 3 */}
          <div style={{ display:'grid', gridTemplateColumns:'1.4fr 1fr 0.8fr', gap:'14px', marginBottom:'14px' }}>
            <BCard>
              <BCardHeader title="Top Services by Bookings"/>
              <div style={{ display:'grid', gridTemplateColumns:'1.5fr 0.8fr 1fr 2fr', padding:'8px 14px', background:'#F5F0E8', borderBottom:'1px solid #E8DFD0', gap:'8px' }}>
                {['SERVICE','BOOKINGS','REVENUE','PERFORMANCE'].map(h => (
                  <span key={h} style={{ fontSize:'9px', fontWeight:800, color:'#9E8E6E', letterSpacing:'1px' }}>{h}</span>
                ))}
              </div>
              {data.topServices.map((sv, i) => (
                <div key={sv.name} style={{ display:'grid', gridTemplateColumns:'1.5fr 0.8fr 1fr 2fr', padding:'10px 14px', borderBottom:'1px solid #F0EAE0', alignItems:'center', gap:'8px', background:i%2===0?'#fff':'#FDFAF6' }}>
                  <span style={{ fontSize:'12px', fontWeight:600, color:'#1A1A2E' }}>{sv.name}</span>
                  <span style={{ fontSize:'12px', fontWeight:700, color:'#B8960C' }}>{sv.bookings}</span>
                  <span style={{ fontSize:'12px', color:'#059669', fontWeight:600 }}>₹{sv.revenue.toLocaleString('en-IN')}</span>
                  <div>
                    <div style={{ height:'6px', background:'#F0EAE0' }}>
                      <div style={{ height:'100%', width:`${sv.pct}%`, background:'#B8960C' }}/>
                    </div>
                    <span style={{ fontSize:'9px', color:'#9E8E6E' }}>{sv.pct}%</span>
                  </div>
                </div>
              ))}
            </BCard>

            <BCard>
              <BCardHeader title="Customer Growth"/>
              <div style={{ padding:'14px' }}>
                <DualBarChart data={data.customerGrowth}/>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'8px', marginTop:'14px', paddingTop:'12px', borderTop:'1px solid #E8DFD0' }}>
                  <div style={{ textAlign:'center', padding:'8px', background:'#F5F0E8', borderTop:'2px solid #B8960C' }}>
                    <div style={{ fontSize:'16px', fontWeight:800, color:'#B8960C' }}>{s.totalCustomers-s.repeatCustomers}</div>
                    <div style={{ fontSize:'9px', color:'#9E8E6E', textTransform:'uppercase' }}>New</div>
                  </div>
                  <div style={{ textAlign:'center', padding:'8px', background:'#F0FDF4', borderTop:'2px solid #059669' }}>
                    <div style={{ fontSize:'16px', fontWeight:800, color:'#059669' }}>{s.repeatCustomers}</div>
                    <div style={{ fontSize:'9px', color:'#9E8E6E', textTransform:'uppercase' }}>Repeat</div>
                  </div>
                </div>
              </div>
            </BCard>

            <BCard>
              <BCardHeader title="Health Score"/>
              <HealthScore score={data.healthScore}/>
              <div style={{ padding:'0 14px 14px' }}>
                {[{label:'Booking Rate',val:'Good'},{label:'Review Score',val:'Strong'},{label:'Revenue Growth',val:'High'}].map(m => (
                  <div key={m.label} style={{ display:'flex', justifyContent:'space-between', padding:'6px 0', borderBottom:'1px solid #F0EAE0' }}>
                    <span style={{ fontSize:'11px', color:'#9E8E6E' }}>{m.label}</span>
                    <span style={{ fontSize:'11px', fontWeight:700, color:'#059669' }}>{m.val}</span>
                  </div>
                ))}
              </div>
            </BCard>
          </div>

          {/* Row 4 */}
          <div style={{ display:'grid', gridTemplateColumns:'1.5fr 1fr', gap:'14px', marginBottom:'14px' }}>
            <BCard>
              <BCardHeader title="Peak Booking Hours"/>
              <div style={{ padding:'14px' }}>
                <BarChart data={data.peakHours} valueKey="count" labelKey="hour" color="#B8960C" height={130}/>
                <div style={{ marginTop:'10px', padding:'8px 12px', background:'#FFFBEB', border:'1px solid #FDE68A', fontSize:'11px', color:'#92400E', fontWeight:600 }}>
                  ⭐ Peak: {data.peakHours.reduce((a,b)=>a.count>b.count?a:b).hour} — {data.peakHours.reduce((a,b)=>a.count>b.count?a:b).count} bookings
                </div>
              </div>
            </BCard>

            <BCard>
              <BCardHeader title="Rating Distribution"/>
              <div style={{ padding:'14px' }}>
                {[5,4,3,2,1].map(star => {
                  const total = Object.values(data.ratings).reduce((a,b)=>a+b,0)
                  const count = data.ratings[star]
                  const pct   = total>0?Math.round((count/total)*100):0
                  return (
                    <div key={star} style={{ display:'flex', alignItems:'center', gap:'10px', marginBottom:'10px' }}>
                      <span style={{ fontSize:'11px', color:'#B8960C', width:'30px', flexShrink:0 }}>{'★'.repeat(star)}</span>
                      <div style={{ flex:1, height:'10px', background:'#F0EAE0' }}>
                        <div style={{ height:'100%', width:`${pct}%`, background:star>=4?'#059669':star===3?'#D97706':'#DC2626' }}/>
                      </div>
                      <span style={{ fontSize:'11px', color:'#9E8E6E', width:'50px', textAlign:'right', flexShrink:0 }}>{count} ({pct}%)</span>
                    </div>
                  )
                })}
                <div style={{ marginTop:'12px', paddingTop:'12px', borderTop:'1px solid #E8DFD0', display:'flex', justifyContent:'space-between' }}>
                  <span style={{ fontSize:'11px', color:'#9E8E6E' }}>Overall Rating</span>
                  <span style={{ fontSize:'16px', fontWeight:800, color:'#B8960C' }}>{s.avgRating} ★</span>
                </div>
              </div>
            </BCard>
          </div>

          {/* AI Insights */}
          <BCard>
            <BCardHeader title="AI Insights — Coming Soon" action={
              <span style={{ fontSize:'10px', color:'#7C3AED', fontWeight:700, background:'#F5F3FF', padding:'3px 8px', border:'1px solid #DDD6FE' }}>FUTURE FEATURE</span>
            }/>
            <div style={{ padding:'20px', display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:'12px' }}>
              {[
                { icon:'🤖', title:'Growth Prediction',   desc:'AI-powered next month booking forecast' },
                { icon:'📈', title:'Revenue Opportunity',  desc:'Identify peak hours & services to maximize revenue' },
                { icon:'⚠',  title:'Risk Alerts',          desc:'Early warning for declining ratings or bookings' },
              ].map(item => (
                <div key={item.title} style={{ padding:'14px', background:'#F5F3FF', border:'1px solid #DDD6FE', borderTop:'2px solid #7C3AED', textAlign:'center' }}>
                  <div style={{ fontSize:'24px', marginBottom:'8px' }}>{item.icon}</div>
                  <div style={{ fontSize:'12px', fontWeight:700, color:'#1A1A2E', marginBottom:'4px' }}>{item.title}</div>
                  <div style={{ fontSize:'10px', color:'#9E8E6E' }}>{item.desc}</div>
                </div>
              ))}
            </div>
          </BCard>

        </div>
      )}

      {/* Footer */}
      <div style={{ background:'#0D1B2A', borderTop:'2px solid #B8960C', padding:'10px 20px', display:'flex', justifyContent:'space-between', marginTop:'14px' }}>
        <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.3)', letterSpacing:'0.5px' }}>ZEMISH SALON ANALYTICS v1.0.0</span>
        <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.3)', letterSpacing:'0.5px' }}>NATIONAL COMMAND CENTER</span>
      </div>
    </div>
  )
}