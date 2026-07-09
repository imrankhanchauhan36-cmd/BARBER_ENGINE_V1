import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FONTS } from '../../config/brand'
import useAuthStore from '../../store/authStore'

const ADMIN_LEVELS = { SUPER_ADMIN:'SUPER_ADMIN', INDIA_ADMIN:'INDIA_ADMIN', STATE_ADMIN:'STATE_ADMIN', DISTRICT_ADMIN:'DISTRICT_ADMIN' }
const canExport    = (l) => [ADMIN_LEVELS.SUPER_ADMIN, ADMIN_LEVELS.INDIA_ADMIN, ADMIN_LEVELS.STATE_ADMIN].includes(l)

const ANALYTICS_DATA = {
  lastUpdated: '23 Jun 2026, 06:30 AM',
  summary: {
    totalBookings: 184520, completedBookings: 162480, cancelledBookings: 14280,
    noShowBookings: 4820, refundedBookings: 2940, upcomingBookings: 8420,
    totalRevenue: 38200000, platformRevenue: 3820000, refundedAmount: 441000,
    avgBookingValue: 235, repeatRate: 62, cancelRate: 7.7, noShowRate: 2.6,
  },
  bookingTrend: [
    { month:'Jan', bookings:12420, revenue:2920000 },
    { month:'Feb', bookings:14580, revenue:3430000 },
    { month:'Mar', bookings:18240, revenue:4290000 },
    { month:'Apr', bookings:16800, revenue:3950000 },
    { month:'May', bookings:22400, revenue:5270000 },
    { month:'Jun', bookings:28400, revenue:6680000 },
  ],
  topServices: [
    { name:'Haircut',       bookings:68420, revenue:10263000, pct:100, avgVal:150  },
    { name:'Beard Styling', bookings:42180, revenue:6327000,  pct:62,  avgVal:150  },
    { name:'Hair Color',    bookings:18240, revenue:9120000,  pct:27,  avgVal:500  },
    { name:'Facial',        bookings:14820, revenue:4446000,  pct:22,  avgVal:300  },
    { name:'Head Massage',  bookings:12840, revenue:2568000,  pct:19,  avgVal:200  },
    { name:'Spa Package',   bookings:8240,  revenue:9888000,  pct:12,  avgVal:1200 },
  ],
  peakHours: [
    { hour:'8AM',  count:2840  }, { hour:'9AM',  count:8420  },
    { hour:'10AM', count:14280 }, { hour:'11AM', count:18420 },
    { hour:'12PM', count:12840 }, { hour:'1PM',  count:8240  },
    { hour:'2PM',  count:9820  }, { hour:'3PM',  count:14820 },
    { hour:'4PM',  count:18640 }, { hour:'5PM',  count:22480 },
    { hour:'6PM',  count:20840 }, { hour:'7PM',  count:14280 },
    { hour:'8PM',  count:8420  },
  ],
  peakDays: [
    { day:'Mon', count:22400 }, { day:'Tue', count:24800 },
    { day:'Wed', count:26400 }, { day:'Thu', count:28200 },
    { day:'Fri', count:32400 }, { day:'Sat', count:42800 },
    { day:'Sun', count:38400 },
  ],
  paymentSplit: [
    { mode:'UPI',  count:98420, pct:53, color:'#059669' },
    { mode:'CARD', count:54840, pct:30, color:'#2563EB' },
    { mode:'CASH', count:31260, pct:17, color:'#D97706' },
  ],
  topStates: [
    { state:'Uttar Pradesh', code:'UP', bookings:42800, revenue:10060000, cancelRate:8.2 },
    { state:'Maharashtra',   code:'MH', bookings:38400, revenue:9024000,  cancelRate:6.8 },
    { state:'Karnataka',     code:'KA', bookings:24800, revenue:5828000,  cancelRate:7.1 },
    { state:'Delhi',         code:'DL', bookings:22400, revenue:5264000,  cancelRate:5.9 },
    { state:'Tamil Nadu',    code:'TN', bookings:18200, revenue:4277000,  cancelRate:7.4 },
  ],
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

function LineChart({ data, valueKey, labelKey, color='#B8960C', height=120 }) {
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
            {valueKey==='revenue'?`₹${(p.val/100000).toFixed(1)}L`:p.val.toLocaleString('en-IN')}
          </text>
        </g>
      ))}
    </svg>
  )
}

function BarChart({ data, valueKey, labelKey, color='#B8960C', height=120, highlightMax=true }) {
  if (!data||data.length===0) return null
  const max = Math.max(...data.map(d=>d[valueKey]))
  return (
    <div style={{ display:'flex', alignItems:'flex-end', gap:'4px', height:`${height}px` }}>
      {data.map((d,i) => {
        const isMax = d[valueKey] === max
        return (
          <div key={i} style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', gap:'3px', height:'100%', justifyContent:'flex-end' }}>
            <div style={{ fontSize:'8px', color:highlightMax&&isMax?color:'#9E8E6E', fontWeight:isMax?800:400 }}>{d[valueKey].toLocaleString('en-IN')}</div>
            <div style={{ width:'100%', background:highlightMax&&isMax?color:`${color}60`, height:`${(d[valueKey]/max)*100}%`, minHeight:'2px' }}/>
            <div style={{ fontSize:'9px', color:highlightMax&&isMax?color:'#9E8E6E', fontWeight:isMax?700:400, textAlign:'center' }}>{d[labelKey]}</div>
          </div>
        )
      })}
    </div>
  )
}

export default function BookingAnalyticsPage() {
  const navigate   = useNavigate()
  const admin      = useAuthStore(s => s.admin)
  const adminLevel = admin?.adminLevel || ADMIN_LEVELS.SUPER_ADMIN
  const hasExport  = canExport(adminLevel)
  const scope      = adminLevel === ADMIN_LEVELS.STATE_ADMIN    ? 'YOUR STATE'
                   : adminLevel === ADMIN_LEVELS.DISTRICT_ADMIN ? 'YOUR DISTRICT'
                   : 'PAN INDIA'
  const [filter, setFilter] = useState('Last 6 Months')

  const d = ANALYTICS_DATA
  const s = d.summary

  const completionRate = Math.round((s.completedBookings / s.totalBookings) * 100)

  return (
    <div style={{ fontFamily:FONTS.body, background:'#F0EAE0', minHeight:'100vh' }}>

      {/* Header */}
      <div style={{ background:'#0D1B2A', borderBottom:'2px solid #B8960C', padding:'0 20px', height:'52px', display:'flex', alignItems:'center', justifyContent:'space-between', position:'sticky', top:0, zIndex:10 }}>
        <div style={{ display:'flex', alignItems:'center', gap:'12px' }}>
          <button onClick={() => navigate('/app/bookings')} style={{ background:'rgba(255,255,255,0.07)', border:'1px solid rgba(255,255,255,0.1)', color:'rgba(255,255,255,0.6)', padding:'5px 10px', cursor:'pointer', fontSize:'12px', fontWeight:700 }}>← BACK</button>
          <div style={{ width:'3px', height:'16px', background:'#B8960C' }}/>
          <h1 style={{ fontSize:'13px', fontWeight:800, color:'#fff', margin:0, letterSpacing:'2px', textTransform:'uppercase' }}>Booking Analytics</h1>
          <span style={{ background:'rgba(184,150,12,0.2)', color:'#B8960C', fontSize:'10px', fontWeight:800, padding:'2px 8px', border:'1px solid rgba(184,150,12,0.3)' }}>{scope}</span>
        </div>
        {/* ✅ Fixed: closing div was missing here */}
        <div style={{ display:'flex', gap:'8px', alignItems:'center' }}>
          <select value={filter} onChange={e=>setFilter(e.target.value)}
            style={{ background:'rgba(255,255,255,0.07)', border:'1px solid rgba(184,150,12,0.4)', color:'#B8960C', padding:'6px 10px', fontSize:'11px', fontWeight:700, cursor:'pointer', fontFamily:FONTS.body, outline:'none' }}>
            {['Last 30 Days','Last 3 Months','Last 6 Months','This Year'].map(f=><option key={f}>{f}</option>)}
          </select>
          {hasExport
            ? <button style={{ background:'rgba(255,255,255,0.07)', border:'1px solid rgba(255,255,255,0.15)', color:'rgba(255,255,255,0.6)', padding:'6px 12px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>↓ EXPORT</button>
            : <div style={{ background:'rgba(220,38,38,0.1)', border:'1px solid rgba(220,38,38,0.2)', color:'rgba(220,38,38,0.5)', padding:'6px 12px', fontSize:'10px', fontWeight:700 }}>⊘ NO EXPORT</div>
          }
        </div>
      </div>

      {/* Sub-header */}
      <div style={{ background:'#0A1520', borderBottom:'1px solid rgba(184,150,12,0.15)', padding:'6px 20px', display:'flex', justifyContent:'space-between' }}>
        <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.3)' }}>Period: <strong style={{ color:'#B8960C' }}>{filter}</strong></span>
        <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.25)' }}>Data Last Updated: <strong style={{ color:'rgba(255,255,255,0.4)' }}>{d.lastUpdated}</strong></span>
      </div>

      <div style={{ padding:'14px 20px' }}>

        {/* KPI Strip */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:'1px', background:'#D4C9B0', border:'1px solid #D4C9B0', marginBottom:'14px' }}>
          {[
            { label:'Total Bookings',   value:s.totalBookings.toLocaleString('en-IN'),      color:'#B8960C' },
            { label:'Total Revenue',    value:`₹${(s.totalRevenue/10000000).toFixed(1)}Cr`, color:'#059669' },
            { label:'Platform Revenue', value:`₹${(s.platformRevenue/100000).toFixed(1)}L`, color:'#2563EB' },
            { label:'Avg Booking Value',value:`₹${s.avgBookingValue}`,                      color:'#D97706' },
          ].map(k => (
            <div key={k.label} style={{ background:'#0D1B2A', padding:'14px 18px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <span style={{ fontSize:'11px', color:'rgba(255,255,255,0.4)' }}>{k.label}</span>
              <span style={{ fontSize:'22px', fontWeight:800, color:k.color }}>{k.value}</span>
            </div>
          ))}
        </div>

        {/* Health Metrics */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(6,1fr)', gap:'10px', marginBottom:'14px' }}>
          {[
            { label:'Completion Rate',  value:`${completionRate}%`,                           color:'#059669', good:completionRate>=80 },
            { label:'Cancel Rate',      value:`${s.cancelRate}%`,                             color:'#DC2626', good:s.cancelRate<=10   },
            { label:'No Show Rate',     value:`${s.noShowRate}%`,                             color:'#D97706', good:s.noShowRate<=5    },
            { label:'Repeat Customers', value:`${s.repeatRate}%`,                             color:'#7C3AED', good:s.repeatRate>=50   },
            { label:'Upcoming',         value:s.upcomingBookings.toLocaleString('en-IN'),     color:'#2563EB', good:true               },
            { label:'Refunded Amt',     value:`₹${(s.refundedAmount/1000).toFixed(0)}K`,     color:'#7C3AED', good:true               },
          ].map(k => (
            <BCard key={k.label}>
              <div style={{ padding:'12px' }}>
                <div style={{ fontSize:'16px', fontWeight:800, color:k.color }}>{k.value}</div>
                <div style={{ fontSize:'9px', color:'#9E8E6E', marginTop:'3px', textTransform:'uppercase', letterSpacing:'0.3px' }}>{k.label}</div>
                <div style={{ fontSize:'8px', marginTop:'4px', color:k.good?'#059669':'#D97706', fontWeight:700 }}>{k.good?'✓ GOOD':'⚠ WATCH'}</div>
              </div>
            </BCard>
          ))}
        </div>

        {/* Charts Row 1 */}
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'14px', marginBottom:'14px' }}>
          <BCard>
            <BCardHeader title="Booking Trend" action={<span style={{ fontSize:'10px', color:'#B8960C', fontWeight:700 }}>{filter}</span>}/>
            <div style={{ padding:'14px' }}><LineChart data={d.bookingTrend} valueKey="bookings" labelKey="month" color="#B8960C"/></div>
          </BCard>
          <BCard>
            <BCardHeader title="Revenue Trend" action={<span style={{ fontSize:'10px', color:'#059669', fontWeight:700 }}>{filter}</span>}/>
            <div style={{ padding:'14px' }}><LineChart data={d.bookingTrend} valueKey="revenue" labelKey="month" color="#059669"/></div>
          </BCard>
        </div>

        {/* Charts Row 2 */}
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'14px', marginBottom:'14px' }}>
          <BCard>
            <BCardHeader title="Peak Hours" action={
              <span style={{ fontSize:'10px', color:'#B8960C', fontWeight:700 }}>Peak: {d.peakHours.reduce((a,b)=>a.count>b.count?a:b).hour}</span>
            }/>
            <div style={{ padding:'14px' }}>
              <BarChart data={d.peakHours} valueKey="count" labelKey="hour" color="#B8960C" height={110}/>
              <div style={{ marginTop:'10px', padding:'8px 12px', background:'#FFFBEB', border:'1px solid #FDE68A', fontSize:'11px', color:'#92400E', fontWeight:600 }}>
                ⭐ Busiest: {d.peakHours.reduce((a,b)=>a.count>b.count?a:b).hour} — {d.peakHours.reduce((a,b)=>a.count>b.count?a:b).count.toLocaleString('en-IN')} bookings
              </div>
            </div>
          </BCard>
          <BCard>
            <BCardHeader title="Peak Days of Week" action={
              <span style={{ fontSize:'10px', color:'#2563EB', fontWeight:700 }}>Peak: {d.peakDays.reduce((a,b)=>a.count>b.count?a:b).day}</span>
            }/>
            <div style={{ padding:'14px' }}>
              <BarChart data={d.peakDays} valueKey="count" labelKey="day" color="#2563EB" height={110}/>
              <div style={{ marginTop:'10px', padding:'8px 12px', background:'#EFF6FF', border:'1px solid #BFDBFE', fontSize:'11px', color:'#1D4ED8', fontWeight:600 }}>
                ⭐ Busiest Day: {d.peakDays.reduce((a,b)=>a.count>b.count?a:b).day} — {d.peakDays.reduce((a,b)=>a.count>b.count?a:b).count.toLocaleString('en-IN')} bookings
              </div>
            </div>
          </BCard>
        </div>

        {/* Row 3 */}
        <div style={{ display:'grid', gridTemplateColumns:'1.4fr 0.8fr 1.2fr', gap:'14px', marginBottom:'14px' }}>

          <BCard>
            <BCardHeader title="Top Services"/>
            <div style={{ display:'grid', gridTemplateColumns:'1.5fr 0.8fr 1fr 0.8fr 2fr', padding:'8px 14px', background:'#F5F0E8', borderBottom:'1px solid #E8DFD0', gap:'8px' }}>
              {['SERVICE','BOOKINGS','REVENUE','AVG VAL','PERFORMANCE'].map(h=>(
                <span key={h} style={{ fontSize:'9px', fontWeight:800, color:'#9E8E6E', letterSpacing:'1px' }}>{h}</span>
              ))}
            </div>
            {d.topServices.map((sv,i) => (
              <div key={sv.name} style={{ display:'grid', gridTemplateColumns:'1.5fr 0.8fr 1fr 0.8fr 2fr', padding:'10px 14px', borderBottom:'1px solid #F0EAE0', alignItems:'center', gap:'8px', background:i%2===0?'#fff':'#FDFAF6' }}>
                <span style={{ fontSize:'12px', fontWeight:600, color:'#1A1A2E' }}>{sv.name}</span>
                <span style={{ fontSize:'12px', fontWeight:700, color:'#B8960C' }}>{sv.bookings.toLocaleString('en-IN')}</span>
                <span style={{ fontSize:'11px', color:'#059669', fontWeight:600 }}>₹{(sv.revenue/100000).toFixed(1)}L</span>
                <span style={{ fontSize:'11px', color:'#6B5E3E' }}>₹{sv.avgVal}</span>
                <div>
                  <div style={{ height:'6px', background:'#E8DFD0' }}>
                    <div style={{ height:'100%', width:`${sv.pct}%`, background:'#B8960C' }}/>
                  </div>
                  <span style={{ fontSize:'9px', color:'#9E8E6E' }}>{sv.pct}%</span>
                </div>
              </div>
            ))}
          </BCard>

          <BCard>
            <BCardHeader title="Payment Methods"/>
            <div style={{ padding:'16px' }}>
              <div style={{ marginBottom:'16px' }}>
                <svg width="100%" viewBox="0 0 120 120">
                  {(() => {
                    let offset = 0
                    const total = 2*Math.PI*40
                    return d.paymentSplit.map((p,i) => {
                      const slice = (p.pct/100)*total
                      const el = (
                        <circle key={i} cx="60" cy="60" r="40" fill="none" stroke={p.color} strokeWidth="18"
                          strokeDasharray={`${slice} ${total-slice}`} strokeDashoffset={-offset}
                          transform="rotate(-90 60 60)"/>
                      )
                      offset += slice
                      return el
                    })
                  })()}
                  <text x="60" y="56" textAnchor="middle" fontSize="14" fontWeight="800" fill="#1A1A2E">100%</text>
                  <text x="60" y="70" textAnchor="middle" fontSize="8" fill="#9E8E6E">Bookings</text>
                </svg>
              </div>
              {d.paymentSplit.map(p => (
                <div key={p.mode} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'8px 0', borderBottom:'1px solid #F0EAE0' }}>
                  <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
                    <div style={{ width:'10px', height:'10px', background:p.color, flexShrink:0 }}/>
                    <span style={{ fontSize:'12px', color:'#1A1A2E', fontWeight:600 }}>{p.mode}</span>
                  </div>
                  <div style={{ textAlign:'right' }}>
                    <div style={{ fontSize:'13px', fontWeight:800, color:p.color }}>{p.pct}%</div>
                    <div style={{ fontSize:'10px', color:'#9E8E6E' }}>{p.count.toLocaleString('en-IN')}</div>
                  </div>
                </div>
              ))}
            </div>
          </BCard>

          <BCard>
            <BCardHeader title="Top States" action={
              <button onClick={() => navigate('/app/location/states')} style={{ background:'none', border:'none', cursor:'pointer', fontSize:'11px', color:'#B8960C', fontWeight:700 }}>VIEW ALL ▸</button>
            }/>
            {[ADMIN_LEVELS.STATE_ADMIN, ADMIN_LEVELS.DISTRICT_ADMIN].includes(adminLevel) && (
              <div style={{ padding:'8px 14px', background:'#FFFBEB', borderBottom:'1px solid #FDE68A', fontSize:'10px', color:'#92400E', fontWeight:600 }}>
                ℹ Showing data scoped to your territory. Full view available to India/Super Admin.
              </div>
            )}
            <div style={{ display:'grid', gridTemplateColumns:'0.4fr 1.2fr 0.8fr 0.8fr', padding:'8px 14px', background:'#F5F0E8', borderBottom:'1px solid #E8DFD0', gap:'8px' }}>
              {['#','STATE','REVENUE','CANCEL%'].map(h=>(
                <span key={h} style={{ fontSize:'9px', fontWeight:800, color:'#9E8E6E', letterSpacing:'1px' }}>{h}</span>
              ))}
            </div>
            {d.topStates.map((st,i) => (
              <div key={st.code} style={{ display:'grid', gridTemplateColumns:'0.4fr 1.2fr 0.8fr 0.8fr', padding:'10px 14px', borderBottom:'1px solid #F0EAE0', alignItems:'center', gap:'8px', background:i%2===0?'#fff':'#FDFAF6' }}>
                <span style={{ fontSize:'12px', fontWeight:800, color:'#9E8E6E' }}>#{i+1}</span>
                <div>
                  <div style={{ fontSize:'12px', fontWeight:700, color:'#1A1A2E' }}>{st.code}</div>
                  <div style={{ fontSize:'10px', color:'#9E8E6E' }}>{st.bookings.toLocaleString('en-IN')} bookings</div>
                </div>
                <span style={{ fontSize:'12px', fontWeight:700, color:'#B8960C' }}>₹{(st.revenue/100000).toFixed(1)}L</span>
                <span style={{ fontSize:'12px', fontWeight:700, color:st.cancelRate>8?'#DC2626':'#059669' }}>{st.cancelRate}%</span>
              </div>
            ))}
          </BCard>
        </div>

        {/* Status Distribution */}
        <BCard>
          <BCardHeader title="Booking Status Distribution"/>
          <div style={{ padding:'16px', display:'grid', gridTemplateColumns:'repeat(6,1fr)', gap:'12px' }}>
            {[
              { label:'Completed', count:s.completedBookings, color:'#059669', pct:Math.round(s.completedBookings/s.totalBookings*100) },
              { label:'Upcoming',  count:s.upcomingBookings,  color:'#2563EB', pct:Math.round(s.upcomingBookings/s.totalBookings*100)  },
              { label:'Cancelled', count:s.cancelledBookings, color:'#DC2626', pct:Math.round(s.cancelledBookings/s.totalBookings*100) },
              { label:'No Show',   count:s.noShowBookings,    color:'#374151', pct:Math.round(s.noShowBookings/s.totalBookings*100)    },
              { label:'Refunded',  count:s.refundedBookings,  color:'#7C3AED', pct:Math.round(s.refundedBookings/s.totalBookings*100)  },
              { label:'Ongoing',   count:42,                  color:'#D97706', pct:0 },
            ].map(st => (
              <div key={st.label} style={{ padding:'12px', background:'#F5F0E8', border:`1px solid ${st.color}20`, borderTop:`2px solid ${st.color}`, textAlign:'center' }}>
                <div style={{ fontSize:'20px', fontWeight:800, color:st.color }}>{st.count.toLocaleString('en-IN')}</div>
                <div style={{ fontSize:'9px', color:'#9E8E6E', textTransform:'uppercase', letterSpacing:'0.5px', marginTop:'3px' }}>{st.label}</div>
                <div style={{ fontSize:'12px', fontWeight:700, color:st.color, marginTop:'4px' }}>{st.pct}%</div>
                <div style={{ height:'4px', background:'#E8DFD0', marginTop:'6px' }}>
                  <div style={{ height:'100%', width:`${st.pct}%`, background:st.color }}/>
                </div>
              </div>
            ))}
          </div>
        </BCard>

      </div>

      <div style={{ background:'#0D1B2A', borderTop:'2px solid #B8960C', padding:'10px 20px', display:'flex', justifyContent:'space-between', marginTop:'14px' }}>
        <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.3)' }}>ZEMISH BOOKING ANALYTICS v1.0.0</span>
        <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.3)' }}>NATIONAL COMMAND CENTER</span>
      </div>
    </div>
  )
}