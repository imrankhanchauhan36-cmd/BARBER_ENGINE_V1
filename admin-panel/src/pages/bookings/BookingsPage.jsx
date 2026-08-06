import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FONTS } from '../../config/brand'
import useAuthStore from '../../store/authStore'
import BookingsAPI from './api/bookings.api'

// ─── Helpers ─────────────────────────────────────────────
const v  = (val, fb = '—') => (val !== null && val !== undefined && val !== '') ? val : fb
const tm = (d) => {
  if (!d) return '—'
  const date = d instanceof Date ? d : new Date(d)
  if (isNaN(date)) return '—'
  return date.toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit', hour12:true })
}

// ─── Constants ────────────────────────────────────────────
const STATUS_COLORS = {
  COMPLETED:  { bg:'#D1FAE5', color:'#065F46' },
  CONFIRMED:  { bg:'#EFF6FF', color:'#1D4ED8' },
  ONGOING:    { bg:'#FEF9C3', color:'#92400E' },
  CANCELLED:  { bg:'#FEE2E2', color:'#991B1B' },
  NO_SHOW:    { bg:'#F3F4F6', color:'#374151' },
  HOLD:       { bg:'#F5F3FF', color:'#5B21B6' },
  CHECKED_IN: { bg:'#ECFDF5', color:'#065F46' },
  EXPIRED:    { bg:'#FEF2F2', color:'#9F1239' },
}
const PAYMENT_COLORS = {
  PAID:     { bg:'#D1FAE5', color:'#065F46' },
  PENDING:  { bg:'#FEF9C3', color:'#92400E' },
  FAILED:   { bg:'#FEE2E2', color:'#991B1B' },
  REFUNDED: { bg:'#F5F3FF', color:'#5B21B6' },
}
const SOURCE_COLORS = {
  APP:    { bg:'#EFF6FF', color:'#1D4ED8', label:'APP'    },
  ADMIN:  { bg:'#FEF9C3', color:'#92400E', label:'ADMIN'  },
  SYSTEM: { bg:'#F3F4F6', color:'#374151', label:'SYSTEM' },
  WEB:    { bg:'#ECFDF5', color:'#065F46', label:'WEB'    },
}

const STATUSES = ['ALL','CONFIRMED','CHECKED_IN','ONGOING','COMPLETED','CANCELLED','NO_SHOW','HOLD','EXPIRED']

const canExport = (l) => ['INDIA', 'STATE'].includes(l)
const canCancel = (l) => ['INDIA', 'STATE'].includes(l)

// ─── Grid ─────────────────────────────────────────────────
// 10 columns: SALON | CUSTOMER | SERVICE | CHAIR | SOURCE | DATE | TIME | AMOUNT | PAYMENT | STATUS+ACTIONS
const GRID = '1.4fr 1.4fr 1.1fr 0.7fr 0.6fr 0.9fr 0.8fr 0.7fr 0.7fr 1.1fr'

// ─── Components ──────────────────────────────────────────
const BCard = ({ children, style={} }) => (
  <div style={{ background:'#fff', border:'1px solid #D4C9B0', borderTop:'2px solid #B8960C', ...style }}>{children}</div>
)
const BCardHeader = ({ title, action }) => (
  <div style={{ padding:'10px 14px', borderBottom:'1px solid #E8DFD0', display:'flex', justifyContent:'space-between', alignItems:'center', background:'#FDFAF6' }}>
    <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
      <div style={{ width:'3px', height:'14px', background:'#B8960C' }}/>
      <span style={{ fontSize:'12px', fontWeight:700, color:'#1A1A2E', letterSpacing:'0.5px', textTransform:'uppercase' }}>{title}</span>
    </div>
    {action}
  </div>
)

// Skeleton row
const SkeletonRow = () => (
  <div style={{ display:'grid', gridTemplateColumns:GRID, padding:'12px 14px', borderBottom:'1px solid #F0EAE0', gap:'8px', alignItems:'center' }}>
    {Array.from({length:10}).map((_,i) => (
      <div key={i} style={{ height:'12px', background:'#E8DFD0', borderRadius:'2px', width: i===0?'80%':'60%', animation:'pulse 1.5s ease-in-out infinite' }}/>
    ))}
  </div>
)

// ─── Main Page ────────────────────────────────────────────
export default function BookingsPage() {
  const navigate   = useNavigate()
  const admin      = useAuthStore(s => s.admin)
  const adminLevel = admin?.adminLevel || 'INDIA'

  const hasExport = canExport(adminLevel)
  const hasCancel = canCancel(adminLevel)

  const scope = adminLevel === 'STATE'    ? `State: ${admin?.stateRef?.name || '—'}`
              : adminLevel === 'DISTRICT' ? `District: ${admin?.districtRef?.name || '—'}`
              : 'PAN INDIA'

  const [bookings,   setBookings]   = useState([])
  const [summary,    setSummary]    = useState(null)
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState(null)
  const [pagination, setPagination] = useState({ page:1, limit:20, total:0, totalPages:1 })
  const [search,     setSearch]     = useState('')
  const [status,     setStatus]     = useState('ALL')
  const [page,       setPage]       = useState(1)
  const [toast,      setToast]      = useState(null)

  const showToast = (msg, color = '#059669') => {
    setToast({ msg, color })
    setTimeout(() => setToast(null), 3000)
  }

  const fetchBookings = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = {
        page, limit: 20,
        ...(search && { search }),
        ...(status !== 'ALL' && { status }),
      }
      const [res, sumRes] = await Promise.all([
        BookingsAPI.getAll(params),
        BookingsAPI.getSummary(),
      ])
      setBookings(res.data || [])
      if (res.pagination) setPagination(res.pagination)
      if (sumRes.data)    setSummary(sumRes.data)
    } catch (err) {
      setError(err.message || 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [page, status, search])

  useEffect(() => { fetchBookings() }, [fetchBookings])

  const resetFilters = () => { setSearch(''); setStatus('ALL'); setPage(1) }

  const total   = pagination.total || 0
  const ongoing = summary?.overall?.ongoing ?? 0

  return (
    <div style={{ fontFamily:FONTS.body, background:'#F0EAE0', minHeight:'100vh' }}>
      <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }`}</style>

      {toast && (
        <div style={{ position:'fixed', top:'20px', right:'20px', background:toast.color, color:'#fff', padding:'12px 20px', fontSize:'13px', fontWeight:700, zIndex:9999, boxShadow:'0 4px 12px rgba(0,0,0,0.2)' }}>
          {toast.msg}
        </div>
      )}

      {/* ── Header ── */}
      <div style={{ background:'#0D1B2A', borderBottom:'2px solid #B8960C', padding:'0 20px', height:'52px', display:'flex', alignItems:'center', justifyContent:'space-between', position:'sticky', top:0, zIndex:10 }}>
        <div style={{ display:'flex', alignItems:'center', gap:'12px' }}>
          <div style={{ width:'3px', height:'16px', background:'#B8960C' }}/>
          <h1 style={{ fontSize:'13px', fontWeight:800, color:'#fff', margin:0, letterSpacing:'2px' }}>BOOKINGS REGISTRY</h1>
          <span style={{ background:'rgba(184,150,12,0.2)', color:'#B8960C', fontSize:'10px', fontWeight:800, padding:'2px 8px', border:'1px solid rgba(184,150,12,0.3)' }}>
            {loading ? '...' : `${total} TOTAL`}
          </span>
          {ongoing > 0 && (
            <span style={{ background:'rgba(234,179,8,0.2)', color:'#D97706', fontSize:'10px', fontWeight:800, padding:'2px 8px', border:'1px solid rgba(234,179,8,0.3)' }}>
              🔴 {ongoing} LIVE
            </span>
          )}
          <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.35)' }}>|</span>
          <span style={{ fontSize:'10px', color:'#B8960C', fontWeight:600 }}>Viewing: {scope}</span>
        </div>
        <div style={{ display:'flex', gap:'8px' }}>
          {/* ← NEW: Analytics navigation button (was missing — no way to reach the analytics page) */}
          <button onClick={() => navigate('/app/bookings/analytics')}
            style={{ background:'rgba(184,150,12,0.15)', border:'1px solid rgba(184,150,12,0.4)', color:'#B8960C', padding:'6px 12px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>
            📊 ANALYTICS
          </button>
          {/* ✅ Fix: Export — Coming Soon if not connected */}
          {hasExport
            ? <button
                onClick={() => showToast('Export — Coming Soon', '#D97706')}
                style={{ background:'rgba(255,255,255,0.07)', border:'1px solid rgba(255,255,255,0.15)', color:'rgba(255,255,255,0.6)', padding:'6px 12px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>
                ↓ EXPORT
              </button>
            : <div style={{ background:'rgba(220,38,38,0.1)', border:'1px solid rgba(220,38,38,0.2)', color:'rgba(220,38,38,0.5)', padding:'6px 12px', fontSize:'10px', fontWeight:700 }}>⊘ NO EXPORT</div>
          }
          <button onClick={resetFilters} style={{ background:'rgba(255,255,255,0.07)', border:'1px solid rgba(255,255,255,0.15)', color:'rgba(255,255,255,0.6)', padding:'6px 12px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>RESET</button>
          <button onClick={fetchBookings} style={{ background:'#B8960C', border:'none', color:'#0D1B2A', padding:'6px 14px', fontSize:'10px', fontWeight:800, cursor:'pointer' }}>↻ REFRESH</button>
        </div>
      </div>

      <div style={{ padding:'14px 20px' }}>

        {error && (
          <div style={{ background:'#FEE2E2', border:'1px solid #DC2626', borderLeft:'4px solid #DC2626', padding:'10px 14px', marginBottom:'12px', fontSize:'13px', color:'#991B1B', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
            <span>⚠ {error}</span>
            <button onClick={fetchBookings} style={{ background:'#DC2626', border:'none', color:'#fff', cursor:'pointer', fontWeight:700, padding:'4px 10px', fontSize:'11px' }}>RETRY</button>
          </div>
        )}

        {/* ── Summary Strip ── */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:'1px', background:'#D4C9B0', border:'1px solid #D4C9B0', marginBottom:'12px' }}>
          {[
            { label:'Total Bookings',    value: loading ? '...' : summary?.overall?.total ?? total, color:'#B8960C' },
            { label:'Total Revenue',     value: loading ? '...' : `₹${(summary?.overall?.totalRevenueRupees ?? 0).toLocaleString('en-IN')}`, color:'#059669' },
            { label:'Avg Ticket',        value: loading ? '...' : `₹${summary?.overall?.avgTicketSizeRupees ?? 0}`, color:'#2563EB' },
            { label:'Cancellation Rate', value: loading ? '...' : `${summary?.overall?.cancellationRate ?? 0}%`, color:'#DC2626' },
            { label:'Completion Rate',   value: loading ? '...' : `${summary?.overall?.completionRate ?? 0}%`,  color:'#059669' },
          ].map(m => (
            <div key={m.label} style={{ background:'#0D1B2A', padding:'12px 16px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <span style={{ fontSize:'11px', color:'rgba(255,255,255,0.4)' }}>{m.label}</span>
              <span style={{ fontSize:'16px', fontWeight:800, color:m.color }}>{m.value}</span>
            </div>
          ))}
        </div>

        {/* ── Status Cards ── */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(6,1fr)', gap:'8px', marginBottom:'12px' }}>
          {[
            { label:'Completed', color:'#059669', f:'COMPLETED', count: summary?.overall?.completed ?? 0 },
            { label:'Confirmed', color:'#2563EB', f:'CONFIRMED', count: summary?.overall?.confirmed ?? 0 },
            { label:'Ongoing',   color:'#D97706', f:'ONGOING',   count: summary?.overall?.ongoing   ?? 0 },
            { label:'Cancelled', color:'#DC2626', f:'CANCELLED', count: summary?.overall?.cancelled ?? 0 },
            { label:'No Show',   color:'#374151', f:'NO_SHOW',   count: summary?.overall?.noShow    ?? 0 },
            { label:'Hold',      color:'#7C3AED', f:'HOLD',      count: summary?.overall?.hold      ?? 0 },
          ].map(s => (
            <div key={s.label} onClick={() => { setStatus(s.f); setPage(1) }}
              style={{ background:status===s.f?s.color:'#fff', border:`1px solid ${s.color}30`, borderTop:`2px solid ${s.color}`, padding:'10px', cursor:'pointer', textAlign:'center' }}>
              <div style={{ fontSize:'20px', fontWeight:800, color:status===s.f?'#fff':s.color }}>{loading ? '...' : s.count}</div>
              <div style={{ fontSize:'9px', color:status===s.f?'rgba(255,255,255,0.8)':'#9E8E6E', textTransform:'uppercase', letterSpacing:'0.5px', marginTop:'2px' }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* ── Payment Analytics ── ✅ Fix */}
        {summary && (
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'12px', marginBottom:'12px' }}>

            {/* Payment Cards */}
            <BCard>
              <BCardHeader title="Payment Analytics"/>
              <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:'1px', background:'#D4C9B0' }}>
                {[
                  { label:'Paid',     value: summary.payments?.paid     ?? 0, color:'#059669' },
                  { label:'Pending',  value: summary.payments?.pending  ?? 0, color:'#D97706' },
                  { label:'Failed',   value: summary.payments?.failed   ?? 0, color:'#DC2626' },
                  { label:'Refunded', value: summary.payments?.refunded ?? 0, color:'#7C3AED' },
                ].map(p => (
                  <div key={p.label} style={{ background:'#FDFAF6', padding:'10px 12px', textAlign:'center' }}>
                    <div style={{ fontSize:'20px', fontWeight:800, color:p.color }}>{p.value}</div>
                    <div style={{ fontSize:'9px', color:'#9E8E6E', textTransform:'uppercase', marginTop:'2px' }}>{p.label}</div>
                  </div>
                ))}
              </div>
            </BCard>

            {/* Source Cards */}
            <BCard>
              <BCardHeader title="Source Analytics"/>
              <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:'1px', background:'#D4C9B0' }}>
                {[
                  { label:'App',    value: summary.source?.app    ?? 0, color:'#1D4ED8' },
                  { label:'Admin',  value: summary.source?.admin  ?? 0, color:'#92400E' },
                  { label:'Web',    value: summary.source?.web    ?? 0, color:'#065F46' },
                  { label:'System', value: summary.source?.system ?? 0, color:'#374151' },
                ].map(s => (
                  <div key={s.label} style={{ background:'#FDFAF6', padding:'10px 12px', textAlign:'center' }}>
                    <div style={{ fontSize:'20px', fontWeight:800, color:s.color }}>{s.value}</div>
                    <div style={{ fontSize:'9px', color:'#9E8E6E', textTransform:'uppercase', marginTop:'2px' }}>{s.label}</div>
                  </div>
                ))}
              </div>
            </BCard>
          </div>
        )}

        {/* ── Today / Week / Month ── */}
        {summary && (
          <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:'1px', background:'#D4C9B0', marginBottom:'12px' }}>
            {[
              { label:'Today',      data: summary.today     },
              { label:'This Week',  data: summary.thisWeek  },
              { label:'This Month', data: summary.thisMonth },
            ].map(({ label, data }) => (
              <div key={label} style={{ background:'#fff', padding:'10px 14px', borderTop:'2px solid #B8960C' }}>
                <div style={{ fontSize:'10px', color:'#9E8E6E', fontWeight:700, marginBottom:'8px', letterSpacing:'0.5px' }}>{label.toUpperCase()}</div>
                <div style={{ display:'flex', gap:'12px', flexWrap:'wrap' }}>
                  {[
                    { label:'Bookings',  val: data?.count         ?? 0,  color:'#1A1A2E' },
                    { label:'Revenue',   val: `₹${(data?.revenueRupees ?? 0).toLocaleString('en-IN')}`, color:'#059669' },
                    { label:'Done',      val: data?.completed     ?? 0,  color:'#065F46' },
                    { label:'Cancelled', val: data?.cancelled     ?? 0,  color:'#DC2626' },
                    { label:'Ongoing',   val: data?.ongoing       ?? 0,  color:'#D97706' },
                    { label:'Pending',   val: data?.pending       ?? 0,  color:'#2563EB' },
                  ].map(k => (
                    <div key={k.label}>
                      <div style={{ fontSize:'16px', fontWeight:800, color:k.color }}>{k.val}</div>
                      <div style={{ fontSize:'9px', color:'#9E8E6E', textTransform:'uppercase' }}>{k.label}</div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Filters ── */}
        <BCard style={{ marginBottom:'12px' }}>
          <BCardHeader title="Filters" action={<span style={{ fontSize:'11px', color:'#B8960C', fontWeight:700, cursor:'pointer' }} onClick={resetFilters}>RESET ALL</span>}/>
          <div style={{ padding:'12px 14px', display:'flex', gap:'8px', alignItems:'center', flexWrap:'wrap' }}>
            <input value={search} onChange={e => setSearch(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && fetchBookings()}
              placeholder="Search booking ID, salon name, customer name/phone... (Enter)"
              style={{ flex:1, minWidth:'240px', border:'1px solid #D4C9B0', padding:'6px 10px', fontSize:'12px', fontFamily:FONTS.body, outline:'none', background:'#FDFAF6' }}
            />
            <select value={status} onChange={e => { setStatus(e.target.value); setPage(1) }}
              style={{ border:'1px solid #D4C9B0', padding:'5px 8px', fontSize:'11px', color:'#6B5E3E', background:'#FDFAF6', cursor:'pointer', fontFamily:FONTS.body, outline:'none' }}>
              {STATUSES.map(s => <option key={s}>{s}</option>)}
            </select>
            <span style={{ fontSize:'11px', color:'#9E8E6E', fontWeight:600 }}>{loading ? 'Loading...' : `${total} results`}</span>
          </div>
        </BCard>

        {/* ── Table ── */}
        <BCard>
          <BCardHeader
            title={`Booking Registry (${total})`}
            action={<span style={{ fontSize:'11px', color:'#9E8E6E' }}>Page {page} of {pagination.totalPages || 1}</span>}
          />

          {/* ✅ Fix: header & row same GRID constant */}
          <div style={{ display:'grid', gridTemplateColumns:GRID, padding:'8px 14px', background:'#F5F0E8', borderBottom:'1px solid #E8DFD0', gap:'8px' }}>
            {['SALON','CUSTOMER','SERVICE','CHAIR','SOURCE','DATE','TIME','AMOUNT','PAYMENT','STATUS / ACTIONS'].map(h => (
              <span key={h} style={{ fontSize:'9px', fontWeight:800, color:'#9E8E6E', letterSpacing:'1px' }}>{h}</span>
            ))}
          </div>

          {/* Skeleton loader */}
          {loading && Array.from({length:6}).map((_,i) => <SkeletonRow key={i}/>)}

          {/* Empty state */}
          {!loading && bookings.length === 0 && !error && (
            <div style={{ padding:'60px', textAlign:'center' }}>
              <div style={{ fontSize:'32px', marginBottom:'12px' }}>📋</div>
              <div style={{ fontSize:'14px', fontWeight:700, color:'#1A1A2E', marginBottom:'6px' }}>No Bookings Found</div>
              <div style={{ fontSize:'12px', color:'#9E8E6E' }}>Try changing filters or search term</div>
            </div>
          )}

          {/* Rows */}
          {!loading && bookings.map((b, i) => {
            const sc  = STATUS_COLORS[b.status]         || { bg:'#F3F4F6', color:'#374151' }
            const pc  = PAYMENT_COLORS[b.paymentStatus] || { bg:'#F3F4F6', color:'#374151' }
            const src = SOURCE_COLORS[b.source]         || { bg:'#F3F4F6', color:'#374151', label: b.source || '—' }
            return (
              <div key={b.id} style={{ display:'grid', gridTemplateColumns:GRID, padding:'10px 14px', borderBottom:'1px solid #F0EAE0', alignItems:'center', gap:'8px', background:i%2===0?'#fff':'#FDFAF6' }}>

                {/* Salon */}
                <div>
                  <div style={{ fontSize:'11px', fontWeight:700, color:'#1A1A2E' }}>{v(b.salon?.shopName)}</div>
                  <div style={{ fontSize:'9px', color:'#9E8E6E', fontFamily:'monospace', marginTop:'2px' }}>#{String(b.id).slice(-8)}</div>
                </div>

                {/* Customer */}
                <div style={{ display:'flex', alignItems:'center', gap:'6px' }}>
                  <div style={{ width:'22px', height:'22px', background:'#0D1B2A', display:'flex', alignItems:'center', justifyContent:'center', color:'#B8960C', fontSize:'9px', fontWeight:800, flexShrink:0 }}>
                    {(b.user?.name || '?')[0].toUpperCase()}
                  </div>
                  <div>
                    <div style={{ fontSize:'11px', fontWeight:600, color:'#1A1A2E' }}>{v(b.user?.name)}</div>
                    <div style={{ fontSize:'10px', color:'#9E8E6E' }}>{v(b.user?.phone)}</div>
                  </div>
                </div>

                {/* Service */}
                <div style={{ fontSize:'10px', color:'#6B5E3E' }}>
                  {b.services?.length > 0 ? b.services.map(s => s.name).join(', ') : '—'}
                </div>

                {/* ✅ Chair */}
                <div style={{ fontSize:'10px', color:'#6B5E3E', fontWeight:600 }}>
                  {v(b.chair?.name)}
                </div>

                {/* ✅ Source */}
                <span style={{ fontSize:'9px', fontWeight:700, background:src.bg, color:src.color, padding:'2px 5px', display:'inline-block' }}>
                  {src.label}
                </span>

                {/* Date */}
                <div style={{ fontSize:'10px', color:'#1A1A2E', fontWeight:600 }}>{v(b.bookingDate)}</div>

                {/* Time */}
                <div>
                  <div style={{ fontSize:'10px', color:'#6B5E3E' }}>{tm(b.startTime)}</div>
                  <div style={{ fontSize:'9px', color:'#9E8E6E' }}>{tm(b.endTime)}</div>
                </div>

                {/* Amount */}
                <div style={{ fontSize:'12px', fontWeight:700, color:'#B8960C' }}>₹{b.amountRupees ?? 0}</div>

                {/* Payment */}
                <span style={{ fontSize:'9px', fontWeight:700, background:pc.bg, color:pc.color, padding:'2px 5px', display:'inline-block' }}>
                  {v(b.paymentStatus)}
                </span>

                {/* Status + Actions */}
                <div style={{ display:'flex', flexDirection:'column', gap:'3px' }}>
                  <span style={{ fontSize:'9px', fontWeight:800, background:sc.bg, color:sc.color, padding:'2px 5px', display:'inline-block' }}>
                    {v(b.status)?.replace('_', ' ')}
                  </span>
                  <div style={{ display:'flex', gap:'3px' }}>
                    <button onClick={() => navigate(`/app/bookings/${b.id}`)}
                      style={{ background:'#1A1A2E', color:'#fff', border:'none', padding:'3px 6px', fontSize:'9px', fontWeight:700, cursor:'pointer' }}>VIEW</button>
                    {hasCancel && ['CONFIRMED','CHECKED_IN','HOLD'].includes(b.status) && (
                      <button onClick={() => navigate(`/app/bookings/${b.id}`)}
                        style={{ background:'#DC2626', color:'#fff', border:'none', padding:'3px 6px', fontSize:'9px', fontWeight:700, cursor:'pointer' }}>CANCEL</button>
                    )}
                  </div>
                </div>
              </div>
            )
          })}

          {/* Pagination */}
          <div style={{ padding:'12px 14px', borderTop:'1px solid #E8DFD0', display:'flex', justifyContent:'space-between', alignItems:'center', background:'#FDFAF6' }}>
            <span style={{ fontSize:'11px', color:'#9E8E6E' }}>
              {total === 0 ? 'No results' : `Showing ${((page-1)*20)+1}–${Math.min(page*20, total)} of ${total}`}
            </span>
            <div style={{ display:'flex', gap:'4px' }}>
              <button onClick={() => setPage(p => Math.max(1, p-1))} disabled={page===1}
                style={{ background:page===1?'#F5F0E8':'#1A1A2E', color:page===1?'#C4B49A':'#fff', border:'1px solid #D4C9B0', padding:'5px 10px', fontSize:'11px', fontWeight:700, cursor:page===1?'not-allowed':'pointer' }}>← PREV</button>
              {Array.from({ length: Math.min(pagination.totalPages||1, 10) }, (_,i) => i+1).map(p => (
                <button key={p} onClick={() => setPage(p)}
                  style={{ background:p===page?'#B8960C':'#fff', color:p===page?'#fff':'#6B5E3E', border:'1px solid #D4C9B0', padding:'5px 10px', fontSize:'11px', fontWeight:700, cursor:'pointer' }}>{p}</button>
              ))}
              <button onClick={() => setPage(p => Math.min(pagination.totalPages||1, p+1))} disabled={page===pagination.totalPages}
                style={{ background:page===pagination.totalPages?'#F5F0E8':'#1A1A2E', color:page===pagination.totalPages?'#C4B49A':'#fff', border:'1px solid #D4C9B0', padding:'5px 10px', fontSize:'11px', fontWeight:700, cursor:page===pagination.totalPages?'not-allowed':'pointer' }}>NEXT →</button>
            </div>
          </div>
        </BCard>
      </div>

      <div style={{ background:'#0D1B2A', borderTop:'2px solid #B8960C', padding:'10px 20px', display:'flex', justifyContent:'space-between', marginTop:'14px' }}>
        <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.3)' }}>ZEMISH BOOKING REGISTRY v2.0.0</span>
        <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.3)' }}>NATIONAL COMMAND CENTER</span>
      </div>
    </div>
  )
}