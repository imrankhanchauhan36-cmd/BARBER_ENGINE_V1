import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FONTS } from '../../config/brand'
import useAuthStore from '../../store/authStore'

// ─── Dummy Data ───────────────────────────────────────────
const KPI_TOP = [
  { label: 'Total Users',     value: '2,58,450', change: '+12.5% vs last month', icon: '👥', color: '#2563EB' },
  { label: 'Total Salons',    value: '18,745',   change: '+9.3% vs last month',  icon: '🏪', color: '#7C3AED' },
  { label: 'Total Providers', value: '24,680',   change: '+11.7% vs last month', icon: '👤', color: '#059669' },
  { label: 'Total Bookings',  value: '1,25,890', change: '+14.6% vs last month', icon: '📅', color: '#D97706' },
]

const KPI_MID = [
  { label: "Today's Bookings", value: '4,562',        change: '↑ 8.2% vs yesterday',  color: '#2563EB' },
  { label: "Today's Revenue",  value: '₹18,75,430',   change: '↑ 16.4% vs yesterday', color: '#D97706' },
  { label: 'Monthly Revenue',  value: '₹5,68,45,210', change: '↑ 18.6% vs last month',color: '#059669' },
]

const KPI_RIGHT = [
  { label: 'Pending Approvals', value: '842', color: '#D97706', path: '/app/approvals' },
  { label: 'Pending Payouts',   value: '186', color: '#7C3AED', path: '/app/finance/payouts' },
  { label: 'Open Disputes',     value: '72',  color: '#DC2626', path: '/app/disputes' },
  { label: 'Open Tickets',      value: '34',  color: '#2563EB', path: '/app/notifications' },
]

const TERRITORY = [
  { label: 'States Covered',   value: '28',     icon: '▦' },
  { label: 'Districts Active', value: '742',    icon: '▤' },
  { label: 'Areas Active',     value: '12,845', icon: '▣' },
]

const ALERTS = [
  { msg: '12 KYC Pending Review',       color: '#D97706', path: '/app/kyc' },
  { msg: '4 Wallet Freeze Requests',    color: '#7C3AED', path: '/app/finance/wallets' },
  { msg: '18 Disputes Awaiting Action', color: '#DC2626', path: '/app/disputes' },
  { msg: '186 Payout Requests Pending', color: '#2563EB', path: '/app/finance/payouts' },
]

const REVENUE_CHART = [
  { day: '01 May', val: 12 },
  { day: '06 May', val: 18 },
  { day: '11 May', val: 15 },
  { day: '16 May', val: 28 },
  { day: '21 May', val: 45 },
]

const BOOKING_DONUT = [
  { label: 'Completed', value: 72540, pct: 58, color: '#059669' },
  { label: 'Confirmed', value: 32140, pct: 26, color: '#2563EB' },
  { label: 'Cancelled', value: 12650, pct: 10, color: '#DC2626' },
  { label: 'Pending',   value: 8560,  pct: 6,  color: '#D97706' },
]

const TOP_SERVICES = [
  { rank: 1, name: 'Hair Cut',      bookings: '28,540' },
  { rank: 2, name: 'Beard Styling', bookings: '20,140' },
  { rank: 3, name: 'Facial',        bookings: '18,670' },
  { rank: 4, name: 'Hair Spa',      bookings: '14,230' },
  { rank: 5, name: 'Bridal Makeup', bookings: '11,230' },
]

const ACTIVITIES = [
  { time: '10:24 AM', icon: '🏪', title: 'New Salon Registered',  desc: '"Glow Beauty Salon, Jaipur"' },
  { time: '10:17 AM', icon: '📅', title: 'New Booking',           desc: 'Booking #BK785632' },
  { time: '10:12 AM', icon: '👤', title: 'New Provider Joined',   desc: '"Rahul Home Barber, Lucknow"' },
  { time: '10:05 AM', icon: '💰', title: 'New Payout Request',    desc: '"Style Studio, Pune" — ₹28,450' },
  { time: '09:58 AM', icon: '✅', title: 'Salon Approved',        desc: '"Luxuria Salon, Delhi"' },
]

const TOP_CITIES = [
  { city: 'Mumbai',    bookings: 25680, pct: 100 },
  { city: 'Delhi',     bookings: 19845, pct: 77  },
  { city: 'Bangalore', bookings: 14540, pct: 57  },
  { city: 'Pune',      bookings: 12540, pct: 49  },
  { city: 'Hyderabad', bookings: 10250, pct: 40  },
]

const SYSTEM_STATUS = [
  { name: 'Server',               status: 'ONLINE', ms: '42ms'  },
  { name: 'Database',             status: 'ONLINE', ms: '18ms'  },
  { name: 'Payment Gateway',      status: 'ONLINE', ms: '120ms' },
  { name: 'Notification Service', status: 'ONLINE', ms: '35ms'  },
  { name: 'Storage',              status: 'ONLINE', ms: '28ms'  },
  { name: 'Backup',               status: 'ONLINE', ms: '—'     },
]

// ─── Bank Style Components ────────────────────────────────

// Box Card — no border radius
const BCard = ({ children, style = {} }) => (
  <div style={{
    background: '#FFFFFF',
    border: '1px solid #D4C9B0',
    borderTop: '2px solid #B8960C',
    padding: '0',
    ...style
  }}>
    {children}
  </div>
)

// Card Header — bank style
const BCardHeader = ({ title, action }) => (
  <div style={{
    padding: '10px 14px',
    borderBottom: '1px solid #E8DFD0',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    background: '#FDFAF6',
  }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <div style={{ width: '3px', height: '14px', background: '#B8960C' }}/>
      <span style={{ fontSize: '12px', fontWeight: 700, color: '#1A1A2E', letterSpacing: '0.3px', textTransform: 'uppercase' }}>{title}</span>
    </div>
    {action}
  </div>
)

// Filter select
const BSelect = ({ value, onChange }) => (
  <select value={value} onChange={onChange} style={{ fontSize: '11px', border: '1px solid #D4C9B0', padding: '4px 8px', color: '#6B5E3E', background: '#FDFAF6', cursor: 'pointer', fontFamily: FONTS.body }}>
    <option>This Month</option>
    <option>Last Month</option>
    <option>This Year</option>
  </select>
)

// ─── Revenue Line Chart ───────────────────────────────────
function LineChart() {
  const max = 50, w = 320, h = 130, pad = 24
  const pts = REVENUE_CHART.map((d, i) => ({
    x: pad + (i / (REVENUE_CHART.length - 1)) * (w - pad * 2),
    y: h - pad - (d.val / max) * (h - pad * 2),
    val: d.val, day: d.day,
  }))
  const path = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ')
  const area = `${path} L${pts[pts.length-1].x},${h-pad} L${pts[0].x},${h-pad} Z`

  return (
    <div style={{ padding: '14px' }}>
      <svg width="100%" viewBox={`0 0 ${w} ${h}`} style={{ overflow: 'visible' }}>
        {[50,40,30,20,10,0].map(v => {
          const y = h - pad - (v / max) * (h - pad * 2)
          return (
            <g key={v}>
              <line x1={pad} y1={y} x2={w-pad} y2={y} stroke="#E8DFD0" strokeWidth="1" strokeDasharray="3,3"/>
              <text x={pad-4} y={y+4} fontSize="9" fill="#9E8E6E" textAnchor="end">{v}L</text>
            </g>
          )
        })}
        <path d={area} fill="rgba(184,150,12,0.08)"/>
        <path d={path} fill="none" stroke="#B8960C" strokeWidth="2"/>
        {pts.map((p, i) => (
          <rect key={i} x={p.x-4} y={p.y-4} width="8" height="8" fill="#B8960C" stroke="#fff" strokeWidth="1.5"/>
        ))}
        {pts.map((p, i) => (
          <text key={i} x={p.x} y={h-2} fontSize="9" fill="#9E8E6E" textAnchor="middle">{p.day}</text>
        ))}
      </svg>
      <div style={{ display:'flex', justifyContent:'space-between', marginTop:'10px', paddingTop:'10px', borderTop:'1px solid #E8DFD0' }}>
        <div>
          <div style={{ fontSize:'10px', color:'#9E8E6E', letterSpacing:'0.5px', textTransform:'uppercase' }}>Total Revenue</div>
          <div style={{ fontSize:'15px', fontWeight:800, color:'#1A1A2E', fontFamily:FONTS.heading }}>₹5,68,45,210</div>
        </div>
        <div style={{ textAlign:'right' }}>
          <div style={{ fontSize:'10px', color:'#9E8E6E', letterSpacing:'0.5px', textTransform:'uppercase' }}>Platform Revenue</div>
          <div style={{ fontSize:'15px', fontWeight:800, color:'#1A1A2E', fontFamily:FONTS.heading }}>₹56,84,521</div>
        </div>
      </div>
    </div>
  )
}

// ─── Donut Chart ─────────────────────────────────────────
function DonutChart() {
  const size=160, cx=80, cy=80, r=58, stroke=20
  let angle=-90
  const slices = BOOKING_DONUT.map(d => {
    const deg=(d.pct/100)*360, start=angle; angle+=deg
    const r1=(start*Math.PI)/180, r2=((start+deg)*Math.PI)/180
    const x1=cx+r*Math.cos(r1), y1=cy+r*Math.sin(r1)
    const x2=cx+r*Math.cos(r2), y2=cy+r*Math.sin(r2)
    return { ...d, d:`M${x1},${y1} A${r},${r} 0 ${deg>180?1:0},1 ${x2},${y2}` }
  })
  return (
    <div style={{ padding:'14px' }}>
      <div style={{ display:'flex', alignItems:'center', gap:'16px' }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flexShrink:0 }}>
          {slices.map((s,i) => <path key={i} d={s.d} fill="none" stroke={s.color} strokeWidth={stroke} strokeLinecap="butt"/>)}
          <text x={cx} y={cy-8} textAnchor="middle" fontSize="10" fill="#9E8E6E" fontWeight="600">TOTAL</text>
          <text x={cx} y={cy+10} textAnchor="middle" fontSize="15" fontWeight="800" fill="#1A1A2E">1,25,890</text>
        </svg>
        <div style={{ flex:1 }}>
          {BOOKING_DONUT.map(d => (
            <div key={d.label} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'5px 0', borderBottom:'1px solid #F0EAE0' }}>
              <div style={{ display:'flex', alignItems:'center', gap:'7px' }}>
                <div style={{ width:'10px', height:'10px', background:d.color, flexShrink:0 }}/>
                <span style={{ fontSize:'11px', color:'#6B5E3E' }}>{d.label}</span>
              </div>
              <div>
                <span style={{ fontSize:'11px', fontWeight:700, color:'#1A1A2E' }}>{d.value.toLocaleString('en-IN')}</span>
                <span style={{ fontSize:'10px', color:'#9E8E6E', marginLeft:'3px' }}>({d.pct}%)</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Main Dashboard ───────────────────────────────────────
export default function DashboardPage() {
  const navigate = useNavigate()
  const admin    = useAuthStore(s => s.admin)
  const [filter, setFilter] = useState('This Month')
  const now = new Date().toLocaleDateString('en-IN', { day:'numeric', month:'long', year:'numeric', weekday:'long' })

  return (
    <div style={{ fontFamily:FONTS.body, background:'#F0EAE0', minHeight:'100vh' }}>

      {/* ══ TOP HEADER BAR ══ */}
      <div style={{ background:'#0D1B2A', borderBottom:'2px solid #B8960C', padding:'0 20px', height:'52px', display:'flex', alignItems:'center', justifyContent:'space-between', position:'sticky', top:0, zIndex:10 }}>
        <div style={{ display:'flex', alignItems:'center', gap:'12px' }}>
          <button style={{ background:'none', border:'none', cursor:'pointer', color:'rgba(255,255,255,0.5)', fontSize:'16px', padding:'4px' }}>☰</button>
          <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
            <div style={{ width:'3px', height:'16px', background:'#B8960C' }}/>
            <h1 style={{ fontSize:'14px', fontWeight:800, color:'#FFFFFF', margin:0, letterSpacing:'2px', textTransform:'uppercase' }}>Dashboard</h1>
          </div>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:'10px' }}>
          {/* Quick Actions */}
          {[{ l:'▸ APPROVE SALON', p:'/app/approvals' }, { l:'▸ CREATE STATE', p:'/app/location/states' }].map(a => (
            <button key={a.l} onClick={() => navigate(a.p)} style={{ background:'rgba(184,150,12,0.15)', border:'1px solid rgba(184,150,12,0.4)', color:'#B8960C', padding:'5px 10px', fontSize:'10px', fontWeight:700, cursor:'pointer', letterSpacing:'0.5px' }}>
              {a.l}
            </button>
          ))}
          {/* Date */}
          <div style={{ background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.1)', padding:'5px 10px', display:'flex', alignItems:'center', gap:'6px' }}>
            <span style={{ fontSize:'11px', color:'rgba(255,255,255,0.4)' }}>▦</span>
            <span style={{ fontSize:'11px', color:'rgba(255,255,255,0.6)', letterSpacing:'0.3px' }}>{now}</span>
          </div>
          {/* Bell */}
          <div style={{ position:'relative' }}>
            <button style={{ background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.1)', color:'rgba(255,255,255,0.6)', padding:'5px 10px', cursor:'pointer', fontSize:'14px' }}>🔔</button>
            <span style={{ position:'absolute', top:'-4px', right:'-4px', width:'16px', height:'16px', background:'#DC2626', fontSize:'9px', color:'#fff', display:'flex', alignItems:'center', justifyContent:'center', fontWeight:800 }}>12</span>
          </div>
          {/* Profile */}
          <div style={{ display:'flex', alignItems:'center', gap:'8px', background:'rgba(184,150,12,0.1)', border:'1px solid rgba(184,150,12,0.3)', padding:'5px 12px', cursor:'pointer' }}>
            <div style={{ width:'26px', height:'26px', background:'#B8960C', display:'flex', alignItems:'center', justifyContent:'center', color:'#0D1B2A', fontSize:'11px', fontWeight:800 }}>
              {(admin?.name||'A')[0]}
            </div>
            <div>
              <div style={{ fontSize:'11px', fontWeight:700, color:'#FFFFFF', letterSpacing:'0.3px' }}>{admin?.name||'Super Admin'}</div>
              <div style={{ fontSize:'9px', color:'#B8960C', fontWeight:600, letterSpacing:'1px' }}>{admin?.adminLevel||'SUPER_ADMIN'}</div>
            </div>
            <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.4)' }}>▾</span>
          </div>
        </div>
      </div>

      <div style={{ padding:'16px 20px' }}>

        {/* ══ ALERTS BAR ══ */}
        <div style={{ background:'#FFFBEB', border:'1px solid #D97706', borderLeft:'4px solid #D97706', padding:'8px 14px', marginBottom:'14px', display:'flex', alignItems:'center', gap:'14px', flexWrap:'wrap' }}>
          <span style={{ fontSize:'11px', fontWeight:800, color:'#92400E', letterSpacing:'0.5px', textTransform:'uppercase' }}>⚠ HIGH PRIORITY ALERTS:</span>
          {ALERTS.map((a,i) => (
            <button key={i} onClick={() => navigate(a.path)} style={{ background:'none', border:'none', cursor:'pointer', fontSize:'11px', color:a.color, fontWeight:700, padding:0, textDecoration:'underline', letterSpacing:'0.3px' }}>
              {a.msg}
            </button>
          ))}
        </div>

        {/* ══ ROW 1: 4 KPI CARDS ══ */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:'12px', marginBottom:'12px' }}>
          {KPI_TOP.map(k => (
            <BCard key={k.label}>
              <div style={{ padding:'14px' }}>
                <div style={{ display:'flex', alignItems:'center', gap:'10px', marginBottom:'10px' }}>
                  <div style={{ width:'36px', height:'36px', background:k.color+'15', border:`1px solid ${k.color}30`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:'18px', flexShrink:0 }}>
                    {k.icon}
                  </div>
                  <span style={{ fontSize:'11px', color:'#6B5E3E', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.3px' }}>{k.label}</span>
                </div>
                <div style={{ fontSize:'24px', fontWeight:800, color:'#1A1A2E', fontFamily:FONTS.heading }}>{k.value}</div>
                <div style={{ fontSize:'10px', color:'#059669', marginTop:'4px', fontWeight:700, letterSpacing:'0.3px' }}>▲ {k.change}</div>
              </div>
            </BCard>
          ))}
        </div>

        {/* ══ ROW 2: MID KPIs + QUICK STATS ══ */}
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr', gap:'12px', marginBottom:'12px' }}>
          {KPI_MID.map(k => (
            <BCard key={k.label}>
              <div style={{ padding:'14px' }}>
                <div style={{ fontSize:'10px', color:'#9E8E6E', fontWeight:700, letterSpacing:'0.5px', textTransform:'uppercase', marginBottom:'8px' }}>{k.label}</div>
                <div style={{ fontSize:'20px', fontWeight:800, color:'#1A1A2E', fontFamily:FONTS.heading }}>{k.value}</div>
                <div style={{ fontSize:'10px', color:'#059669', marginTop:'4px', fontWeight:700 }}>{k.change}</div>
              </div>
            </BCard>
          ))}
          {/* Quick Stats */}
          <BCard>
            <BCardHeader title="Quick Stats"/>
            <div style={{ padding:'0' }}>
              {KPI_RIGHT.map(k => (
                <div key={k.label} onClick={() => navigate(k.path)} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'9px 14px', borderBottom:'1px solid #F0EAE0', cursor:'pointer' }}>
                  <span style={{ fontSize:'11px', color:'#6B5E3E', fontWeight:500 }}>{k.label}</span>
                  <span style={{ fontSize:'14px', fontWeight:800, color:k.color }}>{k.value}</span>
                </div>
              ))}
            </div>
          </BCard>
        </div>

        {/* ══ TERRITORY + PENDING APPROVALS ══ */}
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'12px', marginBottom:'12px' }}>
          {/* Territory */}
          <BCard>
            <BCardHeader title="Territory Coverage — PAN India"/>
            <div style={{ padding:'14px', display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:'10px' }}>
              {TERRITORY.map(t => (
                <div key={t.label} style={{ textAlign:'center', padding:'14px 8px', background:'#FDFAF6', border:'1px solid #E8DFD0', borderTop:'2px solid #B8960C' }}>
                  <div style={{ fontSize:'20px', marginBottom:'6px' }}>{t.icon}</div>
                  <div style={{ fontSize:'20px', fontWeight:800, color:'#1A1A2E', fontFamily:FONTS.heading }}>{t.value}</div>
                  <div style={{ fontSize:'10px', color:'#9E8E6E', marginTop:'4px', textTransform:'uppercase', letterSpacing:'0.3px' }}>{t.label}</div>
                </div>
              ))}
            </div>
          </BCard>

          {/* Pending Approvals */}
          <div style={{ background:'#0D1B2A', border:'1px solid #B8960C', borderTop:'3px solid #B8960C', padding:'0' }}>
            <div style={{ padding:'10px 14px', borderBottom:'1px solid rgba(184,150,12,0.2)', display:'flex', alignItems:'center', gap:'8px', background:'rgba(184,150,12,0.06)' }}>
              <div style={{ width:'3px', height:'14px', background:'#B8960C' }}/>
              <span style={{ fontSize:'11px', fontWeight:800, color:'#B8960C', letterSpacing:'1px', textTransform:'uppercase' }}>Pending Salon Approvals</span>
            </div>
            <div style={{ padding:'16px 14px', display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
              <div>
                <div style={{ fontSize:'54px', fontWeight:800, color:'#B8960C', fontFamily:FONTS.heading, lineHeight:1 }}>842</div>
                <div style={{ fontSize:'11px', color:'rgba(255,255,255,0.35)', marginTop:'6px' }}>Awaiting review & approval</div>
              </div>
              <div>
                <div style={{ fontSize:'9px', color:'rgba(255,255,255,0.25)', letterSpacing:'1px', marginBottom:'8px', textTransform:'uppercase' }}>Breakdown</div>
                {[{ l:'New Today', v:'48', c:'#B8960C' }, { l:'Recommended', v:'124', c:'#10B981' }, { l:'Escalated', v:'18', c:'#DC2626' }].map(r => (
                  <div key={r.l} style={{ display:'flex', justifyContent:'space-between', gap:'20px', padding:'4px 0', borderBottom:'1px solid rgba(255,255,255,0.05)' }}>
                    <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.35)' }}>{r.l}</span>
                    <span style={{ fontSize:'11px', fontWeight:800, color:r.c }}>{r.v}</span>
                  </div>
                ))}
              </div>
            </div>
            <div style={{ padding:'0 14px 14px' }}>
              <button onClick={() => navigate('/app/approvals')} style={{ width:'100%', background:'#B8960C', color:'#0D1B2A', border:'none', padding:'10px', fontSize:'12px', fontWeight:800, cursor:'pointer', letterSpacing:'1px', textTransform:'uppercase' }}>
                VIEW APPROVAL QUEUE ▸
              </button>
            </div>
          </div>
        </div>

        {/* ══ ROW 3: REVENUE + DONUT + SERVICES ══ */}
        <div style={{ display:'grid', gridTemplateColumns:'1.4fr 1fr 1fr', gap:'12px', marginBottom:'12px' }}>
          <BCard>
            <BCardHeader title="Revenue Overview" action={<BSelect value={filter} onChange={e=>setFilter(e.target.value)}/>}/>
            <LineChart />
          </BCard>
          <BCard>
            <BCardHeader title="Bookings Overview" action={<BSelect value={filter} onChange={e=>setFilter(e.target.value)}/>}/>
            <DonutChart />
          </BCard>
          <BCard>
            <BCardHeader title="Top Services" action={<BSelect value={filter} onChange={e=>setFilter(e.target.value)}/>}/>
            <div style={{ padding:'0 14px' }}>
              <div style={{ display:'grid', gridTemplateColumns:'20px 1fr auto', fontSize:'10px', color:'#9E8E6E', fontWeight:700, letterSpacing:'0.5px', textTransform:'uppercase', padding:'8px 0', borderBottom:'1px solid #E8DFD0' }}>
                <span>#</span><span>SERVICE</span><span>BOOKINGS</span>
              </div>
              {TOP_SERVICES.map(s => (
                <div key={s.rank} style={{ display:'grid', gridTemplateColumns:'20px 1fr auto', padding:'9px 0', borderBottom:'1px solid #F0EAE0', alignItems:'center' }}>
                  <span style={{ fontSize:'11px', color:'#9E8E6E', fontWeight:700 }}>{s.rank}</span>
                  <span style={{ fontSize:'12px', color:'#1A1A2E', fontWeight:500 }}>{s.name}</span>
                  <span style={{ fontSize:'12px', fontWeight:700, color:'#1A1A2E' }}>{s.bookings}</span>
                </div>
              ))}
              <div style={{ padding:'10px 0' }}>
                <button onClick={() => navigate('/app/salons')} style={{ background:'none', border:'none', cursor:'pointer', fontSize:'11px', color:'#B8960C', fontWeight:700, letterSpacing:'0.3px', padding:0 }}>VIEW ALL SERVICES ▸</button>
              </div>
            </div>
          </BCard>
        </div>

        {/* ══ ROW 4: ACTIVITIES + CITIES + SYSTEM ══ */}
        <div style={{ display:'grid', gridTemplateColumns:'1.4fr 1fr 1fr', gap:'12px', marginBottom:'12px' }}>
          <BCard>
            <BCardHeader title="Recent Activities"/>
            <div style={{ padding:'0 14px' }}>
              {ACTIVITIES.map((a,i) => (
                <div key={i} style={{ display:'flex', gap:'10px', padding:'10px 0', borderBottom:i<ACTIVITIES.length-1?'1px solid #F0EAE0':'none', alignItems:'flex-start' }}>
                  <span style={{ fontSize:'10px', color:'#9E8E6E', flexShrink:0, width:'52px', marginTop:'2px', fontWeight:600 }}>{a.time}</span>
                  <div style={{ width:'28px', height:'28px', background:'#F5F0E8', border:'1px solid #E8DFD0', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'13px', flexShrink:0 }}>{a.icon}</div>
                  <div>
                    <div style={{ fontSize:'12px', fontWeight:700, color:'#1A1A2E' }}>{a.title}</div>
                    <div style={{ fontSize:'10px', color:'#9E8E6E' }}>{a.desc}</div>
                  </div>
                </div>
              ))}
              <div style={{ padding:'10px 0' }}>
                <button style={{ background:'none', border:'none', cursor:'pointer', fontSize:'11px', color:'#B8960C', fontWeight:700, letterSpacing:'0.3px', padding:0 }}>VIEW ALL ACTIVITIES ▸</button>
              </div>
            </div>
          </BCard>

          <BCard>
            <BCardHeader title="Top Cities by Bookings" action={<BSelect value={filter} onChange={e=>setFilter(e.target.value)}/>}/>
            <div style={{ padding:'14px' }}>
              {TOP_CITIES.map((c,i) => (
                <div key={c.city} style={{ marginBottom:'12px' }}>
                  <div style={{ display:'flex', justifyContent:'space-between', marginBottom:'4px' }}>
                    <span style={{ fontSize:'12px', color:'#1A1A2E', fontWeight:500 }}>{i+1}. {c.city}</span>
                    <span style={{ fontSize:'12px', fontWeight:700, color:'#1A1A2E' }}>{c.bookings.toLocaleString('en-IN')}</span>
                  </div>
                  <div style={{ height:'4px', background:'#F0EAE0', border:'1px solid #E8DFD0' }}>
                    <div style={{ height:'100%', width:`${c.pct}%`, background:'#B8960C' }}/>
                  </div>
                </div>
              ))}
              <button style={{ background:'none', border:'none', cursor:'pointer', fontSize:'11px', color:'#B8960C', fontWeight:700, letterSpacing:'0.3px', padding:0 }}>VIEW FULL REPORT ▸</button>
            </div>
          </BCard>

          <BCard>
            <BCardHeader title="System Status"/>
            <div style={{ padding:'0 14px' }}>
              {SYSTEM_STATUS.map((s,i) => (
                <div key={s.name} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'9px 0', borderBottom:i<SYSTEM_STATUS.length-1?'1px solid #F0EAE0':'none' }}>
                  <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
                    <div style={{ width:'8px', height:'8px', background:'#059669', flexShrink:0 }}/>
                    <span style={{ fontSize:'12px', color:'#1A1A2E' }}>{s.name}</span>
                  </div>
                  <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
                    <span style={{ fontSize:'10px', fontWeight:800, color:'#059669', letterSpacing:'0.5px' }}>{s.status}</span>
                    <span style={{ fontSize:'10px', color:'#9E8E6E', background:'#F5F0E8', border:'1px solid #E8DFD0', padding:'1px 5px' }}>{s.ms}</span>
                  </div>
                </div>
              ))}
            </div>
          </BCard>
        </div>

      </div>

      {/* ══ FOOTER ══ */}
      <div style={{ background:'#0D1B2A', borderTop:'2px solid #B8960C', padding:'10px 20px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
        <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.3)', letterSpacing:'0.5px' }}>ZEMISH SUPER ADMIN PANEL v1.0.0</span>
        <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.3)', letterSpacing:'0.5px' }}>POWERING THE FUTURE OF GROOMING & BEAUTY</span>
      </div>
    </div>
  )
}