import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FONTS } from '../../config/brand'
import useAuthStore from '../../store/authStore'
import BookingsAPI from '../bookings/api/bookings.api'
import FinanceAPI from '../finance/api/finance.api'
import KYCAPI from '../kyc/api/kyc.api'
import ProviderAPI from '../providers/api/provider.api'
import UsersAPI from '../users/api/users.api'

const p2r = (v) => '₹' + ((v ?? 0)).toLocaleString('en-IN')
const n2r = (v) => (v ?? 0).toLocaleString('en-IN')
const DASH = '—'

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

const EmptyState = ({ children = 'No data available' }) => (
  <div style={{ padding: '30px 14px', textAlign: 'center', color: '#9E8E6E', fontSize: '12px' }}>{children}</div>
)

// ─── Revenue Line Chart — driven by real monthly trend data ──
function LineChart({ data, footer }) {
  if (!data || data.length === 0) return <EmptyState>No revenue data available</EmptyState>

  const max = Math.max(...data.map(d => d.val), 1), w = 320, h = 130, pad = 24
  const pts = data.map((d, i) => ({
    x: pad + (i / Math.max(data.length - 1, 1)) * (w - pad * 2),
    y: h - pad - (d.val / max) * (h - pad * 2),
    val: d.val, label: d.label,
  }))
  const path = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ')
  const area = `${path} L${pts[pts.length-1].x},${h-pad} L${pts[0].x},${h-pad} Z`

  return (
    <div style={{ padding: '14px' }}>
      <svg width="100%" viewBox={`0 0 ${w} ${h}`} style={{ overflow: 'visible' }}>
        {[max,max*0.75,max*0.5,max*0.25,0].map(v => {
          const y = h - pad - (v / max) * (h - pad * 2)
          return (
            <g key={v}>
              <line x1={pad} y1={y} x2={w-pad} y2={y} stroke="#E8DFD0" strokeWidth="1" strokeDasharray="3,3"/>
            </g>
          )
        })}
        <path d={area} fill="rgba(184,150,12,0.08)"/>
        <path d={path} fill="none" stroke="#B8960C" strokeWidth="2"/>
        {pts.map((p, i) => (
          <rect key={i} x={p.x-4} y={p.y-4} width="8" height="8" fill="#B8960C" stroke="#fff" strokeWidth="1.5"/>
        ))}
        {pts.map((p, i) => (
          <text key={i} x={p.x} y={h-2} fontSize="9" fill="#9E8E6E" textAnchor="middle">{p.label}</text>
        ))}
      </svg>
      <div style={{ display:'flex', justifyContent:'space-between', marginTop:'10px', paddingTop:'10px', borderTop:'1px solid #E8DFD0' }}>
        <div>
          <div style={{ fontSize:'10px', color:'#9E8E6E', letterSpacing:'0.5px', textTransform:'uppercase' }}>Total Revenue</div>
          <div style={{ fontSize:'15px', fontWeight:800, color:'#1A1A2E', fontFamily:FONTS.heading }}>{footer.totalRevenue != null ? p2r(footer.totalRevenue) : DASH}</div>
        </div>
        <div style={{ textAlign:'right' }}>
          <div style={{ fontSize:'10px', color:'#9E8E6E', letterSpacing:'0.5px', textTransform:'uppercase' }}>Platform Revenue</div>
          <div style={{ fontSize:'15px', fontWeight:800, color:'#1A1A2E', fontFamily:FONTS.heading }}>{footer.platformRevenue != null ? p2r(footer.platformRevenue) : DASH}</div>
        </div>
      </div>
    </div>
  )
}

// ─── Donut Chart — driven by real booking status counts ──
function DonutChart({ slices, total }) {
  if (!slices) return <EmptyState>No booking data available</EmptyState>

  const size=160, cx=80, cy=80, r=58, stroke=20
  const sum = slices.reduce((a,s)=>a+s.value,0) || 1
  const drawn = slices.reduce((acc, d) => {
    const start = acc.angle
    const pct = (d.value/sum)*100
    const deg = (pct/100)*360
    const r1=(start*Math.PI)/180, r2=((start+deg)*Math.PI)/180
    const x1=cx+r*Math.cos(r1), y1=cy+r*Math.sin(r1)
    const x2=cx+r*Math.cos(r2), y2=cy+r*Math.sin(r2)
    acc.slices.push({ ...d, pct, d:`M${x1},${y1} A${r},${r} 0 ${deg>180?1:0},1 ${x2},${y2}` })
    acc.angle += deg
    return acc
  }, { angle: -90, slices: [] }).slices
  return (
    <div style={{ padding:'14px' }}>
      <div style={{ display:'flex', alignItems:'center', gap:'16px' }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flexShrink:0 }}>
          {drawn.map((s,i) => <path key={i} d={s.d} fill="none" stroke={s.color} strokeWidth={stroke} strokeLinecap="butt"/>)}
          <text x={cx} y={cy-8} textAnchor="middle" fontSize="10" fill="#9E8E6E" fontWeight="600">TOTAL</text>
          <text x={cx} y={cy+10} textAnchor="middle" fontSize="15" fontWeight="800" fill="#1A1A2E">{n2r(total)}</text>
        </svg>
        <div style={{ flex:1 }}>
          {drawn.map(d => (
            <div key={d.label} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'5px 0', borderBottom:'1px solid #F0EAE0' }}>
              <div style={{ display:'flex', alignItems:'center', gap:'7px' }}>
                <div style={{ width:'10px', height:'10px', background:d.color, flexShrink:0 }}/>
                <span style={{ fontSize:'11px', color:'#6B5E3E' }}>{d.label}</span>
              </div>
              <div>
                <span style={{ fontSize:'11px', fontWeight:700, color:'#1A1A2E' }}>{n2r(d.value)}</span>
                <span style={{ fontSize:'10px', color:'#9E8E6E', marginLeft:'3px' }}>({d.pct.toFixed(0)}%)</span>
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

  const [loading, setLoading] = useState(true)
  const [toast,   setToast]   = useState(null)
  const showToast = (msg,color='#374151') => { setToast({msg,color}); setTimeout(()=>setToast(null),3000) }
  const notAvailable = () => showToast('Not available yet — no backend data for this section', '#DC2626')

  const [usersSummary,    setUsersSummary]    = useState(null)
  const [providerSummary, setProviderSummary] = useState(null)
  const [bookingsSummary, setBookingsSummary] = useState(null)
  const [kycSummary,      setKycSummary]      = useState(null)
  const [payoutSummary,   setPayoutSummary]   = useState(null)
  const [financeSummary,  setFinanceSummary]  = useState(null)
  const [revenueTrend,    setRevenueTrend]    = useState(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const results = await Promise.allSettled([
        UsersAPI.getSummary(),
        ProviderAPI.getSummary(),
        BookingsAPI.getSummary(),
        KYCAPI.getSummary(),
        FinanceAPI.getPayoutSummary(),
        FinanceAPI.getSummary(),
        FinanceAPI.getRevenueTrend({ months: 5 }),
      ])
      if (cancelled) return
      const [u,p,b,k,po,fs,rt] = results
      if (u.status  === 'fulfilled') setUsersSummary(u.value.data)
      if (p.status  === 'fulfilled') setProviderSummary(p.value.data)
      if (b.status  === 'fulfilled') setBookingsSummary(b.value.data)
      if (k.status  === 'fulfilled') setKycSummary(k.value.data)
      if (po.status === 'fulfilled') setPayoutSummary(po.value.data)
      if (fs.status === 'fulfilled') setFinanceSummary(fs.value.data)
      if (rt.status === 'fulfilled') setRevenueTrend(rt.value.data)
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [])

  // ── KPI derivations — real values, or "—" when the source call failed/hasn't loaded ──
  const KPI_TOP = [
    { label: 'Total Users',     value: usersSummary    ? n2r(usersSummary.total)              : DASH, icon: '👥', color: '#2563EB' },
    { label: 'Total Salons',    value: providerSummary ? n2r(providerSummary.salons?.total)    : DASH, icon: '🏪', color: '#7C3AED' },
    { label: 'Total Providers', value: providerSummary ? n2r(providerSummary.total)            : DASH, icon: '👤', color: '#059669' },
    { label: 'Total Bookings',  value: bookingsSummary ? n2r(bookingsSummary.overall?.total)   : DASH, icon: '📅', color: '#D97706' },
  ]

  const KPI_MID = [
    { label: "Today's Bookings", value: bookingsSummary ? n2r(bookingsSummary.today?.count)          : DASH, color: '#2563EB' },
    { label: "Today's Revenue",  value: bookingsSummary ? p2r(bookingsSummary.today?.revenueRupees)  : DASH, color: '#D97706' },
    { label: 'Monthly Revenue',  value: bookingsSummary ? p2r(bookingsSummary.thisMonth?.revenueRupees) : DASH, color: '#059669' },
  ]

  const pendingApprovals = providerSummary?.salons?.pending
  const pendingPayouts   = payoutSummary?.requested

  const KPI_RIGHT = [
    { label: 'Pending Approvals', value: pendingApprovals != null ? n2r(pendingApprovals) : DASH, color: '#D97706', path: '/app/approvals' },
    { label: 'Pending Payouts',   value: pendingPayouts   != null ? n2r(pendingPayouts)   : DASH, color: '#7C3AED', path: '/app/finance/payouts' },
    // BACKEND GAP — Disputes has no backend at all (no model/route/controller).
    { label: 'Open Disputes',     value: DASH, color: '#DC2626', path: '/app/disputes' },
    // BACKEND GAP — no admin notification/ticketing backend exists.
    { label: 'Open Tickets',      value: DASH, color: '#2563EB', path: '/app/notifications' },
  ]

  // Location module (states/districts/areas) is out of scope for this
  // release and was not audited — shown as honest placeholders rather
  // than fabricated coverage numbers.
  const TERRITORY = [
    { label: 'States Covered',   value: DASH, icon: '▦' },
    { label: 'Districts Active', value: DASH, icon: '▤' },
    { label: 'Areas Active',     value: DASH, icon: '▣' },
  ]

  const kycPending = kycSummary?.pending

  const ALERTS = [
    { msg: `${kycPending != null ? n2r(kycPending) : DASH} KYC Pending Review`, color: '#D97706', path: '/app/kyc' },
    // BACKEND GAP — freeze is an instant action, not a request/approval queue; no such backend concept exists.
    { msg: `${DASH} Wallet Freeze Requests`,    color: '#7C3AED', path: '/app/finance/wallets' },
    // BACKEND GAP — Disputes has no backend at all.
    { msg: `${DASH} Disputes Awaiting Action`,  color: '#DC2626', path: '/app/disputes' },
    { msg: `${pendingPayouts != null ? n2r(pendingPayouts) : DASH} Payout Requests Pending`, color: '#2563EB', path: '/app/finance/payouts' },
  ]

  // Revenue trend → real monthly points (real backend, FinanceAPI.getRevenueTrend)
  const revenueChartData = revenueTrend && revenueTrend.length > 0
    ? revenueTrend.map(d => ({ label: d.month, val: (d.volumeInPaise ?? 0) / 100 }))
    : null
  const revenueFooter = {
    totalRevenue:    financeSummary?.transactions?.totalRevenueInPaise    != null ? Math.round(financeSummary.transactions.totalRevenueInPaise / 100)    : null,
    platformRevenue: financeSummary?.transactions?.totalCommissionInPaise != null ? Math.round(financeSummary.transactions.totalCommissionInPaise / 100) : null,
  }

  // Booking donut → real overall status counts; "Pending" is the residual
  // (total - completed - cancelled - confirmed) so the donut always sums
  // to the real total rather than fabricating a fourth bucket.
  const overall = bookingsSummary?.overall
  const donutSlices = overall ? [
    { label: 'Completed', value: overall.completed, color: '#059669' },
    { label: 'Confirmed', value: overall.confirmed, color: '#2563EB' },
    { label: 'Cancelled', value: overall.cancelled, color: '#DC2626' },
    { label: 'Pending',   value: Math.max(0, (overall.total ?? 0) - (overall.completed ?? 0) - (overall.cancelled ?? 0) - (overall.confirmed ?? 0)), color: '#D97706' },
  ] : null

  return (
    <div style={{ fontFamily:FONTS.body, background:'#F0EAE0', minHeight:'100vh' }}>

      {toast && <div style={{ position:'fixed', top:'20px', right:'20px', background:toast.color, color:'#fff', padding:'12px 20px', fontSize:'13px', fontWeight:700, zIndex:9999, boxShadow:'0 4px 12px rgba(0,0,0,0.2)' }}>{toast.msg}</div>}

      {/* ══ TOP HEADER BAR ══ */}
      <div style={{ background:'#0D1B2A', borderBottom:'2px solid #B8960C', padding:'0 20px', height:'52px', display:'flex', alignItems:'center', justifyContent:'space-between', position:'sticky', top:0, zIndex:10 }}>
        <div style={{ display:'flex', alignItems:'center', gap:'12px' }}>
          <span style={{ color:'rgba(255,255,255,0.5)', fontSize:'16px', padding:'4px' }}>☰</span>
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
          {/* Bell — real navigation to Notifications, no fabricated unread count */}
          <div style={{ position:'relative' }}>
            <button onClick={() => navigate('/app/notifications')} style={{ background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.1)', color:'rgba(255,255,255,0.6)', padding:'5px 10px', cursor:'pointer', fontSize:'14px' }}>🔔</button>
          </div>
          {/* Profile */}
          <div style={{ display:'flex', alignItems:'center', gap:'8px', background:'rgba(184,150,12,0.1)', border:'1px solid rgba(184,150,12,0.3)', padding:'5px 12px' }}>
            <div style={{ width:'26px', height:'26px', background:'#B8960C', display:'flex', alignItems:'center', justifyContent:'center', color:'#0D1B2A', fontSize:'11px', fontWeight:800 }}>
              {(admin?.name||'A')[0]}
            </div>
            <div>
              <div style={{ fontSize:'11px', fontWeight:700, color:'#FFFFFF', letterSpacing:'0.3px' }}>{admin?.name||'Admin'}</div>
              <div style={{ fontSize:'9px', color:'#B8960C', fontWeight:600, letterSpacing:'1px' }}>{admin?.adminLevel||'ADMIN'}</div>
            </div>
          </div>
        </div>
      </div>

      {loading ? (
        <div style={{ padding:'60px', textAlign:'center', color:'#9E8E6E', fontSize:'14px' }}>Loading dashboard...</div>
      ) : (
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
          {/* Territory — out of scope this release (Location module not audited) */}
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

          {/* Pending Approvals — real count from Providers summary (same source Approvals module reads) */}
          <div style={{ background:'#0D1B2A', border:'1px solid #B8960C', borderTop:'3px solid #B8960C', padding:'0' }}>
            <div style={{ padding:'10px 14px', borderBottom:'1px solid rgba(184,150,12,0.2)', display:'flex', alignItems:'center', gap:'8px', background:'rgba(184,150,12,0.06)' }}>
              <div style={{ width:'3px', height:'14px', background:'#B8960C' }}/>
              <span style={{ fontSize:'11px', fontWeight:800, color:'#B8960C', letterSpacing:'1px', textTransform:'uppercase' }}>Pending Salon Approvals</span>
            </div>
            <div style={{ padding:'16px 14px', display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
              <div>
                <div style={{ fontSize:'54px', fontWeight:800, color:'#B8960C', fontFamily:FONTS.heading, lineHeight:1 }}>{pendingApprovals != null ? n2r(pendingApprovals) : DASH}</div>
                <div style={{ fontSize:'11px', color:'rgba(255,255,255,0.35)', marginTop:'6px' }}>Awaiting review & approval</div>
              </div>
              <div>
                <div style={{ fontSize:'9px', color:'rgba(255,255,255,0.25)', letterSpacing:'1px', marginBottom:'8px', textTransform:'uppercase' }}>Breakdown</div>
                {/* BACKEND GAP — no endpoint breaks pending approvals down by New Today / Recommended / Escalated */}
                {[{ l:'New Today', v:DASH, c:'#B8960C' }, { l:'Recommended', v:DASH, c:'#10B981' }, { l:'Escalated', v:DASH, c:'#DC2626' }].map(r => (
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
            <LineChart data={revenueChartData} footer={revenueFooter} />
          </BCard>
          <BCard>
            <BCardHeader title="Bookings Overview" action={<BSelect value={filter} onChange={e=>setFilter(e.target.value)}/>}/>
            <DonutChart slices={donutSlices} total={overall?.total} />
          </BCard>
          <BCard>
            <BCardHeader title="Top Services" action={<BSelect value={filter} onChange={e=>setFilter(e.target.value)}/>}/>
            <div style={{ padding:'0 14px' }}>
              <div style={{ display:'grid', gridTemplateColumns:'20px 1fr auto', fontSize:'10px', color:'#9E8E6E', fontWeight:700, letterSpacing:'0.5px', textTransform:'uppercase', padding:'8px 0', borderBottom:'1px solid #E8DFD0' }}>
                <span>#</span><span>SERVICE</span><span>BOOKINGS</span>
              </div>
              {/* BACKEND GAP — no per-service booking-count endpoint exists */}
              <EmptyState>No data available</EmptyState>
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
              {/* BACKEND GAP — no cross-entity activity feed / audit log backend exists */}
              <EmptyState>No data available</EmptyState>
              <div style={{ padding:'10px 0' }}>
                <button onClick={notAvailable} style={{ background:'none', border:'none', cursor:'pointer', fontSize:'11px', color:'#B8960C', fontWeight:700, letterSpacing:'0.3px', padding:0 }}>VIEW ALL ACTIVITIES ▸</button>
              </div>
            </div>
          </BCard>

          <BCard>
            <BCardHeader title="Top Cities by Bookings" action={<BSelect value={filter} onChange={e=>setFilter(e.target.value)}/>}/>
            <div style={{ padding:'14px' }}>
              {/* BACKEND GAP — no city-level geo-aggregation endpoint exists */}
              <EmptyState>No data available</EmptyState>
              <button onClick={notAvailable} style={{ background:'none', border:'none', cursor:'pointer', fontSize:'11px', color:'#B8960C', fontWeight:700, letterSpacing:'0.3px', padding:0 }}>VIEW FULL REPORT ▸</button>
            </div>
          </BCard>

          <BCard>
            <BCardHeader title="System Status"/>
            <div style={{ padding:'0 14px' }}>
              {/* BACKEND GAP — no health-check/monitoring backend exists; showing
                  the same rows without fabricating uptime/latency numbers. */}
              {['Server','Database','Payment Gateway','Notification Service','Storage','Backup'].map((name,i,arr) => (
                <div key={name} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'9px 0', borderBottom:i<arr.length-1?'1px solid #F0EAE0':'none' }}>
                  <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
                    <div style={{ width:'8px', height:'8px', background:'#9E8E6E', flexShrink:0 }}/>
                    <span style={{ fontSize:'12px', color:'#1A1A2E' }}>{name}</span>
                  </div>
                  <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
                    <span style={{ fontSize:'10px', fontWeight:800, color:'#9E8E6E', letterSpacing:'0.5px' }}>UNKNOWN</span>
                    <span style={{ fontSize:'10px', color:'#9E8E6E', background:'#F5F0E8', border:'1px solid #E8DFD0', padding:'1px 5px' }}>{DASH}</span>
                  </div>
                </div>
              ))}
            </div>
          </BCard>
        </div>

      </div>
      )}

      {/* ══ FOOTER ══ */}
      <div style={{ background:'#0D1B2A', borderTop:'2px solid #B8960C', padding:'10px 20px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
        <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.3)', letterSpacing:'0.5px' }}>ZEMISH SUPER ADMIN PANEL v1.0.0</span>
        <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.3)', letterSpacing:'0.5px' }}>POWERING THE FUTURE OF GROOMING & BEAUTY</span>
      </div>
    </div>
  )
}

// Filter select
const BSelect = ({ value, onChange }) => (
  <select value={value} onChange={onChange} style={{ fontSize: '11px', border: '1px solid #D4C9B0', padding: '4px 8px', color: '#6B5E3E', background: '#FDFAF6', cursor: 'pointer', fontFamily: FONTS.body }}>
    <option>This Month</option>
    <option>Last Month</option>
    <option>This Year</option>
  </select>
)
