import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FONTS } from '../../config/brand'
import useAuthStore from '../../store/authStore'
import BookingsAPI from './api/bookings.api'

// ─── Role / Scope — fixed to match actual backend values (INDIA/STATE/DISTRICT) ──
const canExport = (l) => ['INDIA', 'STATE'].includes(l)

// ─── Range selector → backend query param ────────────────
const RANGE_OPTIONS = [
  { label: 'Last 30 Days',   value: '30d' },
  { label: 'Last 3 Months',  value: '3m'  },
  { label: 'Last 6 Months',  value: '6m'  },
  { label: 'This Year',      value: '1y'  },
]

const formatCurrency = (rupees) => `₹${Number(rupees ?? 0).toLocaleString('en-IN')}`
const formatCompact   = (rupees) => {
  const n = Number(rupees ?? 0)
  if (n >= 10000000) return `₹${(n / 10000000).toFixed(1)}Cr`
  if (n >= 100000)   return `₹${(n / 100000).toFixed(1)}L`
  if (n >= 1000)     return `₹${(n / 1000).toFixed(1)}K`
  return `₹${n}`
}

const PAYMENT_STATUS_COLORS = {
  PAID:     '#059669',
  PENDING:  '#D97706',
  FAILED:   '#DC2626',
  REFUNDED: '#7C3AED',
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
const NotAvailable = ({ label = 'No data for this period' }) => (
  <div style={{ padding:'30px', textAlign:'center', color:'#9E8E6E', fontSize:'12px', fontStyle:'italic' }}>{label}</div>
)
const InfoNote = ({ children }) => (
  <div style={{ padding:'8px 12px', background:'#FFFBEB', border:'1px solid #FDE68A', fontSize:'10px', color:'#92400E', fontWeight:600 }}>{children}</div>
)

// ─── Charts (pure presentational — no backend dependency) ──
function LineChart({ data, valueKey, labelKey, color='#B8960C', height=120, isRevenue=false }) {
  if (!data || data.length === 0) return <NotAvailable/>

  // Special case: a line needs at least 2 points to draw an actual line.
  // With exactly 1 data point, the path below would collapse to a single
  // moveto command — visually just a floating dot with no graph at all.
  // Render a clear single-value display instead of a broken-looking chart.
  if (data.length === 1) {
    const only = data[0]
    return (
      <div style={{ height:`${height}px`, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:'6px' }}>
        <div style={{ fontSize:'28px', fontWeight:800, color }}>
          {isRevenue ? formatCompact(only[valueKey]) : Number(only[valueKey]).toLocaleString('en-IN')}
        </div>
        <div style={{ fontSize:'11px', color:'#6B5E3E', fontWeight:600 }}>{only[labelKey]}</div>
        <div style={{ fontSize:'10px', color:'#9E8E6E', fontStyle:'italic', marginTop:'4px' }}>
          Trend needs 2+ periods — only one period of data so far
        </div>
      </div>
    )
  }

  const max = Math.max(...data.map(d => d[valueKey]), 1)
  const w=400, h=height, pad=16
  const pts = data.map((d,i) => ({
    x: pad + (i/(data.length-1)) * (w-pad*2),
    y: h-pad-((d[valueKey]/max)*(h-pad*2)),
    val: d[valueKey],
    label: d[labelKey],
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
          <text x={p.x} y={p.y-8} fontSize="9" fill={color} textAnchor="middle" fontWeight="700">
            {isRevenue ? formatCompact(p.val) : p.val.toLocaleString('en-IN')}
          </text>
        </g>
      ))}
    </svg>
  
  )
}

function BarChart({ data, valueKey, labelKey, color='#B8960C', height=120, highlightMax=true }) {
  if (!data || data.length === 0) return <NotAvailable/>
  const max = Math.max(...data.map(d => d[valueKey]), 1)
  return (
    <div style={{ display:'flex', alignItems:'flex-end', gap:'4px', height:`${height}px` }}>
      {data.map((d,i) => {
        const isMax = d[valueKey] === max && max > 0
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
  const adminLevel = admin?.adminLevel || 'INDIA'
  const hasExport  = canExport(adminLevel)
  const scope      = adminLevel === 'STATE'    ? `State: ${admin?.stateRef?.name || '—'}`
                   : adminLevel === 'DISTRICT' ? `District: ${admin?.districtRef?.name || '—'}`
                   : 'PAN INDIA'

  const [range,   setRange]   = useState('6m')
  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)

  // requestIdRef guards against out-of-order responses: the "↻ REFRESH"
  // and error-banner "RETRY" buttons both call fetchAnalytics() directly
  // (onClick={() => fetchAnalytics()}), which uses the default
  // isMountedFn = () => true — no staleness protection at all. A rapid
  // double-click, or a Refresh click followed by a range change before
  // the first request resolves, could let an older/slower response
  // apply its state AFTER a newer one already resolved. The isMountedFn
  // param (passed by the useEffect below) still correctly guards against
  // unmount/superseded-effect races on its own; this ref adds the same
  // protection for the two manually-triggered call sites, without
  // changing either of their onClick handlers.
  const requestIdRef = useRef(0)

  const fetchAnalytics = useCallback(async (isMountedFn = () => true) => {
    const myRequestId = ++requestIdRef.current
    const isCurrent = () => isMountedFn() && requestIdRef.current === myRequestId

    setLoading(true)
    setError(null)
    try {
      const res = await BookingsAPI.getAnalytics({ range })
      if (!isCurrent()) return
      setData(res.data || null)
    } catch (err) {
      if (!isCurrent()) return
      setError(err.data?.message || err.message || 'Failed to load analytics')
    } finally {
      if (isCurrent()) setLoading(false)
    }
  }, [range])

  useEffect(() => {
    let isMounted = true
    fetchAnalytics(() => isMounted)
    return () => { isMounted = false }
  }, [fetchAnalytics])

  const s = data?.summary

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
        <div style={{ display:'flex', gap:'8px', alignItems:'center' }}>
          <select value={range} onChange={e => setRange(e.target.value)} aria-label="Date Range"
            style={{ background:'rgba(255,255,255,0.07)', border:'1px solid rgba(184,150,12,0.4)', color:'#B8960C', padding:'6px 10px', fontSize:'11px', fontWeight:700, cursor:'pointer', fontFamily:FONTS.body, outline:'none' }}>
            {RANGE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          {hasExport
            ? <button onClick={() => {}} style={{ background:'rgba(255,255,255,0.07)', border:'1px solid rgba(255,255,255,0.15)', color:'rgba(255,255,255,0.6)', padding:'6px 12px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>↓ EXPORT</button>
            // TODO (future scope, not blocking freeze): wire this button to a real
            // export action (CSV / Excel / PDF) once a backend export endpoint
            // exists, e.g. GET /admin/bookings/analytics/export?format=csv&range=...
            // Currently a no-op placeholder — intentionally left here rather than
            // hidden, so the permission gate (hasExport) stays visibly correct.
            : <div style={{ background:'rgba(220,38,38,0.1)', border:'1px solid rgba(220,38,38,0.2)', color:'rgba(220,38,38,0.5)', padding:'6px 12px', fontSize:'10px', fontWeight:700 }}>⊘ NO EXPORT</div>
          }
          <button onClick={() => fetchAnalytics()} style={{ background:'#B8960C', border:'none', color:'#0D1B2A', padding:'6px 14px', fontSize:'10px', fontWeight:800, cursor:'pointer' }}>↻ REFRESH</button>
        </div>
      </div>

      {/* Sub-header */}
      <div style={{ background:'#0A1520', borderBottom:'1px solid rgba(184,150,12,0.15)', padding:'6px 20px', display:'flex', justifyContent:'space-between' }}>
        <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.3)' }}>Period: <strong style={{ color:'#B8960C' }}>{RANGE_OPTIONS.find(o=>o.value===range)?.label}</strong></span>
        <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.25)' }}>Data Last Updated: <strong style={{ color:'rgba(255,255,255,0.4)' }}>{data?.lastUpdated ? new Date(data.lastUpdated).toLocaleString('en-IN', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit', hour12:true, timeZone:'Asia/Kolkata' }) : '—'}</strong></span>
        {/* TODO (future, not blocking freeze): native Date + toLocaleString works
            correctly today. If date logic grows more complex elsewhere in the app
            (relative time, multiple timezones, parsing edge cases), standardize on
            dayjs/date-fns/luxon across the codebase rather than mixing approaches. */}
      </div>

      <div style={{ padding:'14px 20px' }}>

        {error && (
          <div style={{ background:'#FEE2E2', border:'1px solid #DC2626', borderLeft:'4px solid #DC2626', padding:'10px 14px', marginBottom:'12px', fontSize:'13px', color:'#991B1B', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
            <span>⚠ {error}</span>
            <button onClick={() => fetchAnalytics()} style={{ background:'#DC2626', border:'none', color:'#fff', cursor:'pointer', fontWeight:700, padding:'4px 10px', fontSize:'11px' }}>RETRY</button>
          </div>
        )}

        {/* KPI Strip */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:'1px', background:'#D4C9B0', border:'1px solid #D4C9B0', marginBottom:'14px' }}>
          {[
            { label:'Total Bookings',    value: loading ? '...' : (s?.total ?? 0).toLocaleString('en-IN'),      color:'#B8960C' },
            { label:'Total Revenue',     value: loading ? '...' : formatCompact(s?.totalRevenueRupees),          color:'#059669' },
            { label:'Platform Revenue',  value: loading ? '...' : formatCompact(s?.platformRevenueRupees),       color:'#2563EB' },
            { label:'Avg Booking Value', value: loading ? '...' : formatCurrency(s?.avgBookingValueRupees),       color:'#D97706' },
          ].map(k => (
            <div key={k.label} style={{ background:'#0D1B2A', padding:'14px 18px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <span style={{ fontSize:'11px', color:'rgba(255,255,255,0.4)' }}>{k.label}</span>
              <span style={{ fontSize:'22px', fontWeight:800, color:k.color }}>{k.value}</span>
            </div>
          ))}
        </div>

        {/* Manual vs Auto — Booking Engine V2 — Phase 5 (read-only) */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:'1px', background:'#D4C9B0', border:'1px solid #D4C9B0', marginBottom:'14px' }}>
          {[
            { label:'Manual Completed', value: loading ? '...' : (s?.manualCompleted ?? 0).toLocaleString('en-IN'), color:'#059669' },
            { label:'Auto Completed',   value: loading ? '...' : (s?.autoCompleted   ?? 0).toLocaleString('en-IN'), color:'#2563EB' },
            { label:'Manual No Show',   value: loading ? '...' : (s?.manualNoShow    ?? 0).toLocaleString('en-IN'), color:'#D97706' },
            { label:'Auto No Show',     value: loading ? '...' : (s?.autoNoShow      ?? 0).toLocaleString('en-IN'), color:'#DC2626' },
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
            { label:'Completion Rate',  value:`${s?.completionRate ?? 0}%`,      color:'#059669', good:(s?.completionRate ?? 0) >= 80 },
            { label:'Cancel Rate',      value:`${s?.cancellationRate ?? 0}%`,    color:'#DC2626', good:(s?.cancellationRate ?? 0) <= 10 },
            { label:'No Show Rate',     value:`${s?.noShowRate ?? 0}%`,          color:'#D97706', good:(s?.noShowRate ?? 0) <= 5 },
            { label:'Repeat Customers', value:`${s?.repeatCustomerRate ?? 0}%`,  color:'#7C3AED', good:(s?.repeatCustomerRate ?? 0) >= 50 },
            { label:'Upcoming',         value: (s?.upcoming ?? 0).toLocaleString('en-IN'), color:'#2563EB', good:true },
            { label:'Refunded Amt',     value: formatCompact(s?.refundedAmountRupees),      color:'#7C3AED', good:true },
          ].map(k => (
            <BCard key={k.label}>
              <div style={{ padding:'12px' }}>
                <div style={{ fontSize:'16px', fontWeight:800, color:k.color }}>{loading ? '...' : k.value}</div>
                <div style={{ fontSize:'9px', color:'#9E8E6E', marginTop:'3px', textTransform:'uppercase', letterSpacing:'0.3px' }}>{k.label}</div>
                <div style={{ fontSize:'8px', marginTop:'4px', color:k.good?'#059669':'#D97706', fontWeight:700 }}>{loading ? '' : (k.good ? '✓ GOOD' : '⚠ WATCH')}</div>
              </div>
            </BCard>
          ))}
        </div>

        {/* Charts Row 1 — Trend */}
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'14px', marginBottom:'14px' }}>
          <BCard>
            <BCardHeader title="Booking Trend"/>
            <div style={{ padding:'14px' }}>
              {loading ? <NotAvailable label="Loading…"/> : <LineChart data={data?.trend} valueKey="bookings" labelKey="label" color="#B8960C"/>}
            </div>
          </BCard>
          <BCard>
            <BCardHeader title="Revenue Trend"/>
            <div style={{ padding:'14px' }}>
              {loading ? <NotAvailable label="Loading…"/> : <LineChart data={data?.trend} valueKey="revenueRupees" labelKey="label" color="#059669" isRevenue/>}
            </div>
          </BCard>
        </div>

        {/* Charts Row 2 — Peak Hours / Days */}
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'14px', marginBottom:'14px' }}>
          <BCard>
            <BCardHeader title="Peak Hours (IST)" action={
              data?.peakHours?.length > 0 && (
                <span style={{ fontSize:'10px', color:'#B8960C', fontWeight:700 }}>
                  Peak: {data.peakHours.reduce((a,b)=>a.count>b.count?a:b).label}
                </span>
              )
            }/>
            <div style={{ padding:'14px' }}>
              {loading ? <NotAvailable label="Loading…"/> : (
                <>
                  <BarChart data={data?.peakHours} valueKey="count" labelKey="label" color="#B8960C" height={110}/>
                  {data?.peakHours?.length > 0 && (
                    <div style={{ marginTop:'10px' }}>
                      <InfoNote>
                        ⭐ Busiest: {data.peakHours.reduce((a,b)=>a.count>b.count?a:b).label} — {data.peakHours.reduce((a,b)=>a.count>b.count?a:b).count.toLocaleString('en-IN')} bookings
                      </InfoNote>
                    </div>
                  )}
                </>
              )}
            </div>
          </BCard>
          <BCard>
            <BCardHeader title="Peak Days of Week (IST)" action={
              data?.peakDays?.length > 0 && (
                <span style={{ fontSize:'10px', color:'#2563EB', fontWeight:700 }}>
                  Peak: {data.peakDays.reduce((a,b)=>a.count>b.count?a:b).day}
                </span>
              )
            }/>
            <div style={{ padding:'14px' }}>
              {loading ? <NotAvailable label="Loading…"/> : (
                <>
                  <BarChart data={data?.peakDays} valueKey="count" labelKey="day" color="#2563EB" height={110}/>
                  {data?.peakDays?.length > 0 && (
                    <div style={{ marginTop:'10px', padding:'8px 12px', background:'#EFF6FF', border:'1px solid #BFDBFE', fontSize:'11px', color:'#1D4ED8', fontWeight:600 }}>
                      ⭐ Busiest Day: {data.peakDays.reduce((a,b)=>a.count>b.count?a:b).day} — {data.peakDays.reduce((a,b)=>a.count>b.count?a:b).count.toLocaleString('en-IN')} bookings
                    </div>
                  )}
                </>
              )}
            </div>
          </BCard>
        </div>

        {/* Row 3 — Services / Payment Status / Top States */}
        <div style={{ display:'grid', gridTemplateColumns:'1.4fr 0.8fr 1.2fr', gap:'14px', marginBottom:'14px' }}>

          <BCard>
            <BCardHeader title="Top Services"/>
            {loading ? (
              <NotAvailable label="Loading…"/>
            ) : (!data?.topServices || data.topServices.length === 0) ? (
              <NotAvailable/>
            ) : (
              <>
                <div style={{ display:'grid', gridTemplateColumns:'1.5fr 0.8fr 1fr 0.8fr', padding:'8px 14px', background:'#F5F0E8', borderBottom:'1px solid #E8DFD0', gap:'8px' }}>
                  {['SERVICE','BOOKINGS','EST. REVENUE','AVG VAL'].map(h=>(
                    <span key={h} style={{ fontSize:'9px', fontWeight:800, color:'#9E8E6E', letterSpacing:'1px' }}>{h}</span>
                  ))}
                </div>
                {(data?.topServices || []).map((sv,i) => (
                  <div key={sv.name + i} style={{ display:'grid', gridTemplateColumns:'1.5fr 0.8fr 1fr 0.8fr', padding:'10px 14px', borderBottom:'1px solid #F0EAE0', alignItems:'center', gap:'8px', background:i%2===0?'#fff':'#FDFAF6' }}>
                    <span style={{ fontSize:'12px', fontWeight:600, color:'#1A1A2E' }}>{sv.name}</span>
                    <span style={{ fontSize:'12px', fontWeight:700, color:'#B8960C' }}>{(sv.bookings ?? 0).toLocaleString('en-IN')}</span>
                    <span style={{ fontSize:'11px', color:'#059669', fontWeight:600 }}>{formatCompact(sv.estimatedRevenueRupees)}</span>
                    <span style={{ fontSize:'11px', color:'#6B5E3E' }}>{formatCurrency(sv.avgValueRupees)}</span>
                  </div>
                ))}
                <InfoNote>ℹ "Est. Revenue" = bookings × service's current listed price (no per-service price split is stored on the booking record).</InfoNote>
              </>
            )}
          </BCard>

          <BCard>
            <BCardHeader title="Payment Status"/>
            <div style={{ padding:'16px' }}>
              {loading ? <NotAvailable label="Loading…"/> : !data?.paymentStatusSplit?.length ? <NotAvailable/> : (
                <>
                  <div style={{ marginBottom:'16px' }}>
                    <svg width="100%" viewBox="0 0 120 120">
                      {(() => {
                        let offset = 0
                        const total = 2*Math.PI*40
                        return data.paymentStatusSplit.map((p,i) => {
                          const slice = (p.pct/100)*total
                          const color = PAYMENT_STATUS_COLORS[p.status] || '#9E8E6E'
                          const el = (
                            <circle key={i} cx="60" cy="60" r="40" fill="none" stroke={color} strokeWidth="18"
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
                  {data.paymentStatusSplit.map(p => {
                    const color = PAYMENT_STATUS_COLORS[p.status] || '#9E8E6E'
                    return (
                      <div key={p.status} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'8px 0', borderBottom:'1px solid #F0EAE0' }}>
                        <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
                          <div style={{ width:'10px', height:'10px', background:color, flexShrink:0 }}/>
                          <span style={{ fontSize:'12px', color:'#1A1A2E', fontWeight:600 }}>{p.status}</span>
                        </div>
                        <div style={{ textAlign:'right' }}>
                          <div style={{ fontSize:'13px', fontWeight:800, color }}>{p.pct}%</div>
                          <div style={{ fontSize:'10px', color:'#9E8E6E' }}>{(p.count ?? 0).toLocaleString('en-IN')}</div>
                        </div>
                      </div>
                    )
                  })}
                </>
              )}
            </div>
          </BCard>

          <BCard>
            <BCardHeader title="Top States" action={
              <button onClick={() => navigate('/app/location/states')} style={{ background:'none', border:'none', cursor:'pointer', fontSize:'11px', color:'#B8960C', fontWeight:700 }}>VIEW ALL ▸</button>
            }/>
            {['STATE','DISTRICT'].includes(adminLevel) && (
              <InfoNote>ℹ Showing data scoped to your territory. Full view available to INDIA admin.</InfoNote>
            )}
            {loading ? (
              <NotAvailable label="Loading…"/>
            ) : (!data?.topStates || data.topStates.length === 0) ? (
              <NotAvailable/>
            ) : (
              <>
                <div style={{ display:'grid', gridTemplateColumns:'0.4fr 1.2fr 0.8fr 0.8fr', padding:'8px 14px', background:'#F5F0E8', borderBottom:'1px solid #E8DFD0', gap:'8px' }}>
                  {['#','STATE','REVENUE','CANCEL%'].map(h=>(
                    <span key={h} style={{ fontSize:'9px', fontWeight:800, color:'#9E8E6E', letterSpacing:'1px' }}>{h}</span>
                  ))}
                </div>
                {(data?.topStates || []).map((st,i) => (
                  <div key={st.stateId || i} style={{ display:'grid', gridTemplateColumns:'0.4fr 1.2fr 0.8fr 0.8fr', padding:'10px 14px', borderBottom:'1px solid #F0EAE0', alignItems:'center', gap:'8px', background:i%2===0?'#fff':'#FDFAF6' }}>
                    <span style={{ fontSize:'12px', fontWeight:800, color:'#9E8E6E' }}>#{i+1}</span>
                    <div>
                      <div style={{ fontSize:'12px', fontWeight:700, color:'#1A1A2E' }}>{st.code}</div>
                      <div style={{ fontSize:'10px', color:'#9E8E6E' }}>{(st.bookings ?? 0).toLocaleString('en-IN')} bookings</div>
                    </div>
                    <span style={{ fontSize:'12px', fontWeight:700, color:'#B8960C' }}>{formatCompact(Math.round((st.revenuePaise ?? 0)/100))}</span>
                    <span style={{ fontSize:'12px', fontWeight:700, color:st.cancelRate>8?'#DC2626':'#059669' }}>{st.cancelRate}%</span>
                  </div>
                ))}
              </>
            )}
          </BCard>
        </div>

        {/* Status Distribution */}
        <BCard>
          <BCardHeader title="Booking Status Distribution"/>
          <div style={{ padding:'16px', display:'grid', gridTemplateColumns:'repeat(6,1fr)', gap:'12px' }}>
            {[
              { label:'Completed', count: s?.completed ?? 0, color:'#059669', pct: s?.completionRate ?? 0 },
              { label:'Upcoming',  count: s?.upcoming  ?? 0, color:'#2563EB', pct: s?.total > 0 ? +(((s?.upcoming ?? 0)/s.total)*100).toFixed(1) : 0 },
              { label:'Cancelled', count: s?.cancelled ?? 0, color:'#DC2626', pct: s?.cancellationRate ?? 0 },
              { label:'No Show',   count: s?.noShow    ?? 0, color:'#374151', pct: s?.noShowRate ?? 0 },
              { label:'Refunded',  count: s?.refundedCount ?? 0, color:'#7C3AED', pct: s?.total > 0 ? +(((s?.refundedCount ?? 0)/s.total)*100).toFixed(1) : 0 },
              { label:'Ongoing',   count: s?.ongoing   ?? 0, color:'#D97706', pct: s?.total > 0 ? +(((s?.ongoing ?? 0)/s.total)*100).toFixed(1) : 0 },
            ].map(st => (
              <div key={st.label} style={{ padding:'12px', background:'#F5F0E8', border:`1px solid ${st.color}20`, borderTop:`2px solid ${st.color}`, textAlign:'center' }}>
                <div style={{ fontSize:'20px', fontWeight:800, color:st.color }}>{loading ? '...' : st.count.toLocaleString('en-IN')}</div>
                <div style={{ fontSize:'9px', color:'#9E8E6E', textTransform:'uppercase', letterSpacing:'0.5px', marginTop:'3px' }}>{st.label}</div>
                <div style={{ fontSize:'12px', fontWeight:700, color:st.color, marginTop:'4px' }}>{loading ? '' : `${st.pct}%`}</div>
                <div style={{ height:'4px', background:'#E8DFD0', marginTop:'6px' }}>
                  <div style={{ height:'100%', width:`${loading ? 0 : st.pct}%`, background:st.color }}/>
                </div>
              </div>
            ))}
          </div>
        </BCard>

      </div>

      <div style={{ background:'#0D1B2A', borderTop:'2px solid #B8960C', padding:'10px 20px', display:'flex', justifyContent:'space-between', marginTop:'14px' }}>
        <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.3)' }}>ZEMISH BOOKING ANALYTICS v2.0.0</span>
        <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.3)' }}>NATIONAL COMMAND CENTER</span>
      </div>
    </div>
  )
}