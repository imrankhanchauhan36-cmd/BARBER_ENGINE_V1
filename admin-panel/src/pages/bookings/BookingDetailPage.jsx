import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { FONTS } from '../../config/brand'
import useAuthStore from '../../store/authStore'
import BookingsAPI from './api/bookings.api'

// ─── Helpers ─────────────────────────────────────────────
const v  = (val, fb = '—') => (val !== null && val !== undefined && val !== '') ? val : fb
const dt = (d) => d ? new Date(d).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' }) : '—'
const dtTime = (d) => {
  if (!d) return '—'
  const date = d instanceof Date ? d : new Date(d)
  if (isNaN(date)) return '—'
  return date.toLocaleString('en-IN', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit', hour12:true })
}
const tm = (d) => {
  if (!d) return '—'
  const date = d instanceof Date ? d : new Date(d)
  if (isNaN(date)) return '—'
  return date.toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit', hour12:true })
}

// NOTE: dt() / tm() / dtTime() / formatCurrency() are small, stable, and used
// only on this page today. If a 2nd page starts needing them, lift them into
// a shared utils/date.js + utils/currency.js — not before, to avoid premature
// abstraction churn on a frozen module.
const formatCurrency = (rupees) => `₹${Number(rupees ?? 0).toLocaleString('en-IN')}`
const paiseToRupees   = (paise)  => Math.round((paise ?? 0) / 100)

// ─── Role / Scope (matches BookingsPage.jsx — INDIA / STATE / DISTRICT) ──
const canCancel       = (l) => ['INDIA', 'STATE'].includes(l)
const canUpdateStatus = (l) => ['INDIA', 'STATE'].includes(l)

// ── Cancellable statuses — matches adminBooking.controller.js cancellableStatuses ──
const CANCELLABLE_STATUSES = ['HOLD', 'CONFIRMED', 'CHECKED_IN']

// ── Allowed admin status transitions — matches adminUpdateBookingStatus() exactly ──
// (CANCELLED is intentionally excluded here — cancellation always goes through
//  the dedicated /cancel endpoint, which writes cancelledBy/cancelReason properly)
const ALLOWED_TRANSITIONS = {
  CONFIRMED:  [{ to: 'CHECKED_IN', label: '✓ MARK CHECKED-IN' }],
  CHECKED_IN: [{ to: 'ONGOING',    label: '▶ START SERVICE'   }],
  ONGOING:    [{ to: 'COMPLETED',  label: '✓ MARK COMPLETED'  }],
}

// ── Status / Payment / Source colors — same palette as BookingsPage.jsx ──
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
const SOURCE_LABELS = { APP:'APP', ADMIN:'ADMIN', SYSTEM:'SYSTEM', WEB:'WEB' }

// ─── Cancel Modal (reason required — matches adminCancelBooking() contract) ──
function CancelModal({ booking, submitting, onConfirm, onClose }) {
  const [reason, setReason] = useState('')
  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.75)', zIndex:2000, display:'flex', alignItems:'center', justifyContent:'center' }}>
      <div style={{ background:'#fff', width:'440px', border:'2px solid #DC2626' }}>
        <div style={{ background:'#7F1D1D', padding:'14px 18px', borderBottom:'2px solid #DC2626' }}>
          <div style={{ color:'#fff', fontWeight:800, fontSize:'13px', letterSpacing:'1px' }}>⊘ CANCEL BOOKING</div>
          <div style={{ color:'#FECACA', fontSize:'10px', marginTop:'2px' }}>#{String(booking.id).slice(-8)} — {formatCurrency(booking.amountRupees)}</div>
        </div>
        <div style={{ padding:'20px 18px' }}>
          <div style={{ background:'#FEF2F2', border:'1px solid #FEE2E2', padding:'10px', marginBottom:'14px', fontSize:'11px', color:'#991B1B', fontWeight:600 }}>
            ⚠ This action is irreversible. Booking status will change to CANCELLED.
          </div>
          <label style={{ fontSize:'10px', color:'#9E8E6E', fontWeight:800, letterSpacing:'1px', display:'block', marginBottom:'6px' }}>CANCELLATION REASON (REQUIRED)</label>
          <textarea value={reason} onChange={e=>setReason(e.target.value)} placeholder="Enter reason for cancellation..."
            style={{ width:'100%', border:'1px solid #D4C9B0', padding:'8px 12px', fontSize:'13px', fontFamily:FONTS.body, outline:'none', minHeight:'70px', resize:'vertical', boxSizing:'border-box', marginBottom:'14px' }}/>
          <div style={{ display:'flex', gap:'8px', justifyContent:'flex-end' }}>
            <button onClick={onClose} disabled={submitting} style={{ background:'#fff', border:'1px solid #D4C9B0', color:'#6B5E3E', padding:'8px 16px', fontSize:'11px', fontWeight:700, cursor:'pointer' }}>BACK</button>
            <button onClick={() => reason.trim() && onConfirm(reason.trim())} disabled={submitting || !reason.trim()}
              style={{ background:reason.trim() && !submitting ?'#DC2626':'#F5F0E8', border:'none', color:reason.trim() && !submitting ?'#fff':'#C4B49A', padding:'8px 20px', fontSize:'11px', fontWeight:800, cursor:reason.trim() && !submitting ?'pointer':'not-allowed' }}>
              {submitting ? 'CANCELLING...' : '⊘ CONFIRM CANCEL'}
            </button>
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
const InfoRow = ({ label, value, valueColor }) => (
  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'7px 0', borderBottom:'1px solid #F0EAE0' }}>
    <span style={{ fontSize:'12px', color:'#9E8E6E' }}>{label}</span>
    <span style={{ fontSize:'12px', fontWeight:600, color:valueColor||'#1A1A2E', textAlign:'right', maxWidth:'60%' }}>{value}</span>
  </div>
)
const SLabel = ({ title }) => (
  <div style={{ display:'flex', alignItems:'center', gap:'8px', margin:'12px 0 8px' }}>
    <div style={{ width:'3px', height:'12px', background:'#B8960C' }}/>
    <span style={{ fontSize:'9px', fontWeight:800, color:'#9E8E6E', letterSpacing:'2px', textTransform:'uppercase' }}>{title}</span>
  </div>
)
const NotAvailable = ({ label = 'Not available from backend' }) => (
  <div style={{ padding:'10px', background:'#F5F0E8', border:'1px dashed #D4C9B0', fontSize:'11px', color:'#9E8E6E', textAlign:'center', fontStyle:'italic' }}>
    {label}
  </div>
)

// Page-level skeleton (initial load)
const DetailSkeleton = () => (
  <div style={{ padding:'40px 20px' }}>
    {Array.from({length:5}).map((_,i) => (
      <div key={i} style={{ height:'14px', background:'#E8DFD0', borderRadius:'2px', width: `${70 - i*5}%`, marginBottom:'14px', animation:'pulse 1.5s ease-in-out infinite' }}/>
    ))}
  </div>
)

// ─── Main Page ────────────────────────────────────────────
export default function BookingDetailPage() {
  const { id }     = useParams()
  const navigate   = useNavigate()
  const admin      = useAuthStore(s => s.admin)
  const adminLevel = admin?.adminLevel || 'INDIA'

  const hasCancel       = canCancel(adminLevel)
  const hasUpdateStatus = canUpdateStatus(adminLevel)

  const [tab,          setTab]          = useState('overview')
  const [booking,      setBooking]      = useState(null)
  const [loading,      setLoading]      = useState(true)
  const [error,        setError]        = useState(null)
  const [showCancel,   setShowCancel]   = useState(false)
  const [cancelling,   setCancelling]   = useState(false)
  const [updatingTo,   setUpdatingTo]   = useState(null) // which transition is in-flight
  const [toast,        setToast]        = useState(null)

  const showToast = (msg, color = '#059669') => {
    setToast({ msg, color })
    setTimeout(() => setToast(null), 3000)
  }

  // ── Fetch booking detail from real backend ──────────────
  // `mountedRef` (closed over by the effect below) avoids the classic
  // "setState on unmounted component" warning if the admin navigates away
  // (e.g. clicks BACK) before the request resolves. We deliberately don't
  // use AbortController here — bookings.api.js's contract (frozen) doesn't
  // accept a signal option, and we must not change that file to add one.
  const fetchBooking = useCallback(async (isMountedFn = () => true) => {
    setLoading(true)
    setError(null)
    try {
      const res = await BookingsAPI.getById(id)
      if (!isMountedFn()) return
      const raw = res.data || null

      // Defensive sort — never assume backend order is guaranteed.
      // timeline[] is shown oldest → newest; statusHistory[] newest → oldest
      // (standard audit-log convention).
      if (raw?.timeline) {
        raw.timeline = [...raw.timeline].sort((a, b) => {
          if (!a.time && !b.time) return 0
          if (!a.time) return 1
          if (!b.time) return -1
          return new Date(a.time) - new Date(b.time)
        })
      }
      if (raw?.statusHistory) {
        raw.statusHistory = [...raw.statusHistory].sort(
          (a, b) => new Date(b.changedAt) - new Date(a.changedAt)
        )
      }

      setBooking(raw)
    } catch (err) {
      if (!isMountedFn()) return
      // Prefer backend's own message (err.data.message) over the generic
      // fetch-layer message — client.js attaches the parsed body as err.data.
      setError(err.data?.message || err.message || 'Failed to load booking')
    } finally {
      if (isMountedFn()) setLoading(false)
    }
  }, [id])

  useEffect(() => {
    let isMounted = true
    fetchBooking(() => isMounted)
    return () => { isMounted = false }
  }, [fetchBooking])

  // ── Cancel booking — PATCH /admin/bookings/:id/cancel ───
  const handleCancel = async (reason) => {
    setCancelling(true)
    try {
      await BookingsAPI.cancel(id, { reason })
      showToast('⊘ Booking cancelled successfully', '#DC2626')
      setShowCancel(false)
      await fetchBooking()
    } catch (err) {
      showToast(err.message || 'Failed to cancel booking', '#DC2626')
    } finally {
      setCancelling(false)
    }
  }

  // ── Status transition — PATCH /admin/bookings/:id/status ─
  const handleStatusUpdate = async (nextStatus) => {
    setUpdatingTo(nextStatus)
    try {
      await BookingsAPI.updateStatus(id, { status: nextStatus })
      showToast(`✓ Status updated to ${nextStatus.replace('_', ' ')}`, '#059669')
      await fetchBooking()
    } catch (err) {
      showToast(err.message || 'Failed to update status', '#DC2626')
    } finally {
      setUpdatingTo(null)
    }
  }

  // Hooks must run unconditionally on every render — computed BEFORE the
  // loading/error early-returns below, guarded internally with booking?. .
  const nextTransitions = useMemo(() => {
    if (!hasUpdateStatus || !booking?.status) return []
    return ALLOWED_TRANSITIONS[booking.status] || []
  }, [booking?.status, hasUpdateStatus])

  // ── Loading state ────────────────────────────────────────
  if (loading) {
    return (
      <div style={{ fontFamily:FONTS.body, background:'#F0EAE0', minHeight:'100vh' }}>
        <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }`}</style>
        <div style={{ background:'#0D1B2A', borderBottom:'2px solid #B8960C', padding:'0 20px', height:'52px', display:'flex', alignItems:'center' }}>
          <span style={{ color:'rgba(255,255,255,0.5)', fontSize:'12px' }}>Loading booking…</span>
        </div>
        <DetailSkeleton/>
      </div>
    )
  }

  // ── Error state ───────────────────────────────────────────
  if (error || !booking) {
    return (
      <div style={{ fontFamily:FONTS.body, background:'#F0EAE0', minHeight:'100vh' }}>
        <div style={{ background:'#0D1B2A', borderBottom:'2px solid #B8960C', padding:'0 20px', height:'52px', display:'flex', alignItems:'center' }}>
          <button onClick={() => navigate('/app/bookings')} style={{ background:'rgba(255,255,255,0.07)', border:'1px solid rgba(255,255,255,0.1)', color:'rgba(255,255,255,0.6)', padding:'5px 10px', cursor:'pointer', fontSize:'12px', fontWeight:700 }}>← BACK</button>
        </div>
        <div style={{ padding:'60px', textAlign:'center' }}>
          <div style={{ fontSize:'32px', marginBottom:'12px' }}>⚠</div>
          <div style={{ fontSize:'14px', fontWeight:700, color:'#991B1B', marginBottom:'10px' }}>{error || 'Booking not found'}</div>
          <button onClick={() => fetchBooking()} style={{ background:'#DC2626', border:'none', color:'#fff', cursor:'pointer', fontWeight:700, padding:'8px 16px', fontSize:'11px' }}>RETRY</button>
        </div>
      </div>
    )
  }

  const sc          = STATUS_COLORS[booking.status]              || { bg:'#F3F4F6', color:'#374151' }
  const psc         = PAYMENT_COLORS[booking.paymentStatus]      || { bg:'#F3F4F6', color:'#374151' }
  const transaction = booking.transaction
  const tsc         = transaction ? (PAYMENT_COLORS[transaction.status] || { bg:'#F3F4F6', color:'#374151' }) : null
  const isCancellable = hasCancel && CANCELLABLE_STATUSES.includes(booking.status)
  const TABS = ['overview', 'customer', 'salon', 'payment', 'timeline', 'audit']

  return (
    <div style={{ fontFamily:FONTS.body, background:'#F0EAE0', minHeight:'100vh' }}>
      <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }`}</style>

      {toast && (
        <div style={{ position:'fixed', top:'20px', right:'20px', background:toast.color, color:'#fff', padding:'12px 20px', fontSize:'13px', fontWeight:700, zIndex:9999, boxShadow:'0 4px 12px rgba(0,0,0,0.2)' }}>
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <div style={{ background:'#0D1B2A', borderBottom:'2px solid #B8960C', padding:'0 20px', height:'52px', display:'flex', alignItems:'center', justifyContent:'space-between', position:'sticky', top:0, zIndex:10 }}>
        <div style={{ display:'flex', alignItems:'center', gap:'12px' }}>
          <button onClick={() => navigate('/app/bookings')} style={{ background:'rgba(255,255,255,0.07)', border:'1px solid rgba(255,255,255,0.1)', color:'rgba(255,255,255,0.6)', padding:'5px 10px', cursor:'pointer', fontSize:'12px', fontWeight:700 }}>← BACK</button>
          <div style={{ width:'3px', height:'16px', background:'#B8960C' }}/>
          <div>
            <div style={{ color:'#fff', fontWeight:800, fontSize:'13px', letterSpacing:'1px' }}>
              #{String(booking.id).slice(-8)} — {booking.services?.[0]?.name || 'Service'}{booking.services?.length > 1 ? ` +${booking.services.length - 1}` : ''}
            </div>
            <div style={{ color:'#B8960C', fontSize:'9px', letterSpacing:'1px', marginTop:'1px' }}>
              {v(booking.salon?.shopName)} • {dt(booking.bookingDate)} {tm(booking.startTime)}
            </div>
          </div>
          <span style={{ fontSize:'10px', fontWeight:800, background:sc.bg, color:sc.color, padding:'3px 8px' }}>{booking.status}</span>
        </div>
        <div style={{ display:'flex', gap:'8px' }}>
          {booking.salon?.id && (
            <button onClick={() => navigate(`/app/salons/${booking.salon.id}`)} style={{ background:'rgba(184,150,12,0.15)', border:'1px solid rgba(184,150,12,0.4)', color:'#B8960C', padding:'6px 12px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>VIEW SALON</button>
          )}
          {nextTransitions.map(t => (
            <button key={t.to} onClick={() => handleStatusUpdate(t.to)} disabled={updatingTo === t.to}
              style={{ background:'rgba(37,99,235,0.15)', border:'1px solid rgba(37,99,235,0.4)', color:'#93C5FD', padding:'6px 12px', fontSize:'10px', fontWeight:700, cursor:updatingTo ? 'not-allowed' : 'pointer' }}>
              {updatingTo === t.to ? 'UPDATING…' : t.label}
            </button>
          ))}
          {isCancellable && (
            <button onClick={() => setShowCancel(true)} style={{ background:'rgba(220,38,38,0.15)', border:'1px solid rgba(220,38,38,0.4)', color:'#FCA5A5', padding:'6px 12px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>⊘ CANCEL</button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div style={{ background:'#0A1520', borderBottom:'1px solid rgba(184,150,12,0.2)', display:'flex', padding:'0 20px' }}>
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)} style={{ padding:'10px 18px', border:'none', background:'none', cursor:'pointer', fontSize:'10px', fontWeight:tab===t?800:400, color:tab===t?'#B8960C':'rgba(255,255,255,0.35)', borderBottom:tab===t?'2px solid #B8960C':'2px solid transparent', letterSpacing:'1.5px', textTransform:'uppercase' }}>
            {t}
          </button>
        ))}
      </div>

      {/* KPI Strip */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(6,1fr)', gap:'1px', background:'#D4C9B0', borderBottom:'2px solid #B8960C' }}>
        {[
          { label:'Service',       value: booking.services?.length ? booking.services.map(s=>s.name).join(', ') : '—', color:'#B8960C' },
          { label:'Amount',        value: formatCurrency(booking.amountRupees), color:'#059669' },
          { label:'Source',        value: SOURCE_LABELS[booking.source] || v(booking.source), color:'#2563EB' },
          { label:'Chair',         value: v(booking.chair?.name),            color:'#D97706' },
          { label:'Date',          value: dt(booking.bookingDate),           color:'#9E8E6E' },
          { label:'Time',          value: `${tm(booking.startTime)} – ${tm(booking.endTime)}`, color:'#9E8E6E' },
        ].map(k => (
          <div key={k.label} style={{ background:'#0D1B2A', padding:'10px 12px', display:'flex', flexDirection:'column', gap:'2px' }}>
            <span style={{ fontSize:'9px', color:'rgba(255,255,255,0.4)' }}>{k.label}</span>
            <span style={{ fontSize:'12px', fontWeight:800, color:k.color, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{k.value}</span>
          </div>
        ))}
      </div>

      <div style={{ padding:'16px 20px' }}>

        {/* OVERVIEW */}
        {tab === 'overview' && (
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:'14px' }}>
            <BCard>
              <BCardHeader title="Booking Details"/>
              <div style={{ padding:'14px' }}>
                <SLabel title="Basic"/>
                <InfoRow label="Booking ID"       value={booking.id}/>
                <InfoRow label="Services"         value={booking.services?.length ? booking.services.map(s => `${s.name} (₹${s.price})`).join(', ') : '—'}/>
                <InfoRow label="Duration"         value={booking.serviceDuration ? `${booking.serviceDuration} min` : '—'}/>
                <InfoRow label="Buffer Time"      value={booking.bufferTime ? `${booking.bufferTime} min` : '0 min'}/>
                <InfoRow label="Date"             value={dt(booking.bookingDate)}/>
                <InfoRow label="Start Time"       value={tm(booking.startTime)}/>
                <InfoRow label="End Time"         value={tm(booking.endTime)}/>
                <InfoRow label="Status"           value={booking.status}   valueColor={sc.color}/>
                <InfoRow label="Source"           value={SOURCE_LABELS[booking.source] || v(booking.source)}/>
                <InfoRow label="Created At"       value={dtTime(booking.createdAt)}/>

                <SLabel title="Rating"/>
                {booking.rating ? (
                  <div style={{ display:'flex', alignItems:'center', gap:'4px' }}>
                    {[1,2,3,4,5].map(s => (
                      <span key={s} style={{ color:s<=booking.rating?'#B8960C':'#E8DFD0', fontSize:'18px' }}>★</span>
                    ))}
                    <span style={{ fontSize:'12px', fontWeight:700, color:'#1A1A2E', marginLeft:'6px' }}>{booking.rating}/5</span>
                  </div>
                ) : (
                  <NotAvailable label="No rating submitted yet"/>
                )}

                {booking.cancelReason && (
                  <>
                    <SLabel title="Cancellation Reason"/>
                    <div style={{ padding:'8px 10px', background:'#FEF2F2', border:'1px solid #FEE2E2', fontSize:'12px', color:'#991B1B', borderLeft:'3px solid #DC2626' }}>{booking.cancelReason}</div>
                  </>
                )}
                {booking.cancelledBy && (
                  <>
                    <SLabel title="Cancelled By"/>
                    <InfoRow label="Name"        value={v(booking.cancelledBy.name)}/>
                    <InfoRow label="Phone"       value={v(booking.cancelledBy.phone)}/>
                    <InfoRow label="Admin Level" value={v(booking.cancelledBy.adminLevel)}/>
                  </>
                )}
              </div>
            </BCard>

            <BCard>
              <BCardHeader title="Payment Summary"/>
              <div style={{ padding:'14px' }}>
                <div style={{ background:'#0D1B2A', padding:'16px', marginBottom:'14px', textAlign:'center', borderTop:'2px solid #B8960C' }}>
                  <div style={{ fontSize:'10px', color:'rgba(255,255,255,0.4)', letterSpacing:'1px', marginBottom:'6px' }}>BOOKING AMOUNT</div>
                  <div style={{ fontSize:'28px', fontWeight:800, color:'#B8960C' }}>{formatCurrency(booking.amountRupees)}</div>
                  <span style={{ fontSize:'10px', fontWeight:800, background:psc.bg, color:psc.color, padding:'2px 8px', display:'inline-block', marginTop:'6px' }}>{v(booking.paymentStatus)}</span>
                </div>
                {transaction ? (
                  <>
                    <SLabel title="Breakdown"/>
                    <InfoRow label="Platform Commission" value={formatCurrency(paiseToRupees(transaction.commission))} valueColor="#DC2626"/>
                    <InfoRow label="Salon Payout"         value={formatCurrency(paiseToRupees(transaction.payoutAmount))} valueColor="#059669"/>
                    <InfoRow label="Payment ID"           value={v(transaction.paymentId)}/>
                    <InfoRow label="Transaction Status"   value={v(transaction.status)} valueColor={tsc?.color}/>
                    <InfoRow label="Paid At"              value={dtTime(transaction.createdAt)}/>
                  </>
                ) : (
                  <NotAvailable label="No transaction record for this booking"/>
                )}
              </div>
            </BCard>

            <BCard>
              <BCardHeader title="Lifecycle Timestamps"/>
              <div style={{ padding:'14px' }}>
                <InfoRow label="Checked In"      value={dtTime(booking.checkedInAt)}/>
                <InfoRow label="Service Started" value={dtTime(booking.serviceStartedAt)}/>
                <InfoRow label="Completed"       value={dtTime(booking.completedAt)}/>
                <InfoRow label="Cancelled"       value={dtTime(booking.cancelledAt)}/>
                <InfoRow label="No-Show Marked"  value={dtTime(booking.noShowMarkedAt)}/>
              </div>
            </BCard>
          </div>
        )}

        {/* CUSTOMER */}
        {tab === 'customer' && (
          <BCard>
            <BCardHeader title="Customer Information"/>
            <div style={{ padding:'20px' }}>
              {booking.user ? (
                <>
                  <div style={{ display:'flex', alignItems:'center', gap:'14px', padding:'16px', background:'#F5F0E8', border:'1px solid #E8DFD0', borderTop:'2px solid #B8960C', marginBottom:'16px' }}>
                    <div style={{ width:'52px', height:'52px', background:'#0D1B2A', display:'flex', alignItems:'center', justifyContent:'center', color:'#B8960C', fontSize:'22px', fontWeight:800, flexShrink:0, overflow:'hidden' }}>
                      {booking.user.profilePhoto
                        ? <img src={booking.user.profilePhoto} alt="" style={{ width:'100%', height:'100%', objectFit:'cover' }}/>
                        : (booking.user.name || '?')[0]?.toUpperCase()}
                    </div>
                    <div>
                      <div style={{ fontSize:'16px', fontWeight:800, color:'#1A1A2E' }}>{v(booking.user.name)}</div>
                      <div style={{ fontSize:'11px', color:'#9E8E6E', marginTop:'2px' }}>Customer</div>
                    </div>
                  </div>
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'16px' }}>
                    <div>
                      <InfoRow label="Full Name" value={v(booking.user.name)}/>
                      <InfoRow label="Phone"     value={v(booking.user.phone)}/>
                    </div>
                    <div>
                      <InfoRow label="Email"     value={v(booking.user.email)}/>
                      <InfoRow label="User ID"   value={v(booking.user.id)}/>
                    </div>
                  </div>
                </>
              ) : <NotAvailable label="Customer record unavailable"/>}
            </div>
          </BCard>
        )}

        {/* SALON */}
        {tab === 'salon' && (
          <BCard>
            <BCardHeader title="Salon Information" action={
              booking.salon?.id && (
                <button onClick={() => navigate(`/app/salons/${booking.salon.id}`)} style={{ background:'#B8960C', color:'#0D1B2A', border:'none', padding:'4px 12px', fontSize:'10px', fontWeight:800, cursor:'pointer' }}>VIEW SALON ▸</button>
              )
            }/>
            <div style={{ padding:'20px' }}>
              {booking.salon ? (
                <>
                  <div style={{ display:'flex', alignItems:'center', gap:'14px', padding:'16px', background:'#F5F0E8', border:'1px solid #E8DFD0', borderTop:'2px solid #B8960C', marginBottom:'16px' }}>
                    <div style={{ width:'52px', height:'52px', background:'#0D1B2A', display:'flex', alignItems:'center', justifyContent:'center', color:'#B8960C', fontSize:'22px', fontWeight:800, flexShrink:0 }}>
                      {(booking.salon.shopName || '?')[0]?.toUpperCase()}
                    </div>
                    <div>
                      <div style={{ fontSize:'16px', fontWeight:800, color:'#1A1A2E' }}>{v(booking.salon.shopName)}</div>
                      <div style={{ fontSize:'11px', color:'#9E8E6E', marginTop:'2px' }}>{v(booking.salon.category)}</div>
                    </div>
                  </div>
                  <InfoRow label="Salon Name" value={v(booking.salon.shopName)}/>
                  <InfoRow label="Category"   value={v(booking.salon.category)}/>
                  <InfoRow label="Address"    value={v(booking.salon.address)}/>
                  <InfoRow label="Chair"      value={v(booking.chair?.name)}/>
                </>
              ) : <NotAvailable label="Salon record unavailable"/>}
            </div>
          </BCard>
        )}

        {/* PAYMENT */}
        {tab === 'payment' && (
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'14px' }}>
            <BCard>
              <BCardHeader title="Payment Details"/>
              <div style={{ padding:'14px' }}>
                <div style={{ background:'#0D1B2A', padding:'20px', marginBottom:'14px', textAlign:'center', borderTop:'2px solid #B8960C' }}>
                  <div style={{ fontSize:'10px', color:'rgba(255,255,255,0.4)', letterSpacing:'1px', marginBottom:'6px' }}>TOTAL AMOUNT</div>
                  <div style={{ fontSize:'32px', fontWeight:800, color:'#B8960C' }}>{formatCurrency(booking.amountRupees)}</div>
                  <span style={{ fontSize:'10px', fontWeight:800, background:psc.bg, color:psc.color, padding:'3px 10px', display:'inline-block', marginTop:'8px' }}>{v(booking.paymentStatus)}</span>
                </div>
                {transaction ? (
                  <>
                    <InfoRow label="Payment ID"          value={v(transaction.paymentId)}/>
                    <InfoRow label="Transaction Type"    value={v(transaction.type)}/>
                    <InfoRow label="Transaction Status"  value={v(transaction.status)} valueColor={tsc?.color}/>
                    <InfoRow label="Paid At"             value={dtTime(transaction.createdAt)}/>
                  </>
                ) : <NotAvailable label="No transaction record for this booking"/>}
              </div>
            </BCard>

            <BCard>
              <BCardHeader title="Revenue Split"/>
              <div style={{ padding:'14px' }}>
                {transaction ? (
                  <>
                    {[
                      { label:'Total Paid',           value: formatCurrency(paiseToRupees(transaction.amountPaise)),  color:'#1A1A2E' },
                      { label:'Platform Commission',  value: `- ${formatCurrency(paiseToRupees(transaction.commission))}`, color:'#DC2626' },
                      { label:'Salon Payout',         value: formatCurrency(paiseToRupees(transaction.payoutAmount)), color:'#059669' },
                    ].map(r => (
                      <div key={r.label} style={{ display:'flex', justifyContent:'space-between', padding:'10px 0', borderBottom:'1px solid #F0EAE0' }}>
                        <span style={{ fontSize:'13px', color:'#9E8E6E' }}>{r.label}</span>
                        <span style={{ fontSize:'14px', fontWeight:800, color:r.color }}>{r.value}</span>
                      </div>
                    ))}
                  </>
                ) : <NotAvailable label="No revenue split available — no transaction recorded"/>}

                <div style={{ marginTop:'14px', padding:'10px', background:'#FFFBEB', border:'1px solid #FDE68A', fontSize:'10px', color:'#92400E', fontWeight:600 }}>
                  ℹ Refunds are not yet supported as an admin action on this booking — no refund endpoint exists in the current backend API.
                </div>
              </div>
            </BCard>
          </div>
        )}

        {/* TIMELINE — sourced directly from backend computed timeline[] */}
        {tab === 'timeline' && (
          <BCard>
            <BCardHeader title="Booking Timeline"/>
            <div style={{ padding:'24px 20px' }}>
              {booking.timeline?.length ? (
                <div style={{ position:'relative', paddingLeft:'32px' }}>
                  <div style={{ position:'absolute', left:'12px', top:'10px', bottom:'10px', width:'2px', background:'#E8DFD0' }}/>
                  {booking.timeline.map((t, i) => {
                    const isCancelEvent = ['CANCELLED','NO_SHOW'].includes(t.event)
                    const color = t.done ? (isCancelEvent ? '#DC2626' : '#059669') : '#9E8E6E'
                    return (
                      <div key={i} style={{ position:'relative', marginBottom:'24px' }}>
                        <div style={{ position:'absolute', left:'-23px', top:'2px', width:'20px', height:'20px', background:t.done?color:'#E8DFD0', border:`2px solid ${t.done?color:'#D4C9B0'}`, display:'flex', alignItems:'center', justifyContent:'center' }}>
                          {t.done && <span style={{ color:'#fff', fontSize:'10px', fontWeight:800 }}>✓</span>}
                        </div>
                        <div style={{ background:t.done?'#FDFAF6':'#F5F0E8', border:`1px solid ${t.done?'#D4C9B0':'#E8DFD0'}`, borderLeft:`3px solid ${t.done?color:'#D4C9B0'}`, padding:'12px 16px' }}>
                          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                            <div style={{ fontSize:'13px', fontWeight:700, color:t.done?'#1A1A2E':'#9E8E6E' }}>{t.label}</div>
                            <span style={{ fontSize:'10px', color:t.done?color:'#C4B49A', fontWeight:600 }}>{t.time ? dtTime(t.time) : 'Pending'}</span>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : <NotAvailable label="No timeline data available"/>}
            </div>
          </BCard>
        )}

        {/* AUDIT — sourced from backend statusHistory[] */}
        {tab === 'audit' && (
          <BCard>
            <BCardHeader title="Status History — Immutable" action={
              <span style={{ fontSize:'10px', color:'#DC2626', fontWeight:700 }}>⚠ CANNOT BE DELETED</span>
            }/>
            <div style={{ display:'grid', gridTemplateColumns:'1.5fr 1fr 1.2fr 1fr', padding:'8px 14px', background:'#F5F0E8', borderBottom:'1px solid #E8DFD0', gap:'8px' }}>
              {['DATE & TIME','STATUS','CHANGED BY','ADMIN LEVEL'].map(h=>(
                <span key={h} style={{ fontSize:'9px', fontWeight:800, color:'#9E8E6E', letterSpacing:'1px' }}>{h}</span>
              ))}
            </div>
            {booking.statusHistory?.length ? booking.statusHistory.map((h,i) => (
              <div key={i} style={{ display:'grid', gridTemplateColumns:'1.5fr 1fr 1.2fr 1fr', padding:'11px 14px', borderBottom:'1px solid #F0EAE0', alignItems:'center', gap:'8px', background:i%2===0?'#fff':'#FDFAF6' }}>
                <span style={{ fontSize:'11px', color:'#6B5E3E', fontFamily:'monospace' }}>{dtTime(h.changedAt)}</span>
                <span style={{ fontSize:'10px', fontWeight:800, background:(STATUS_COLORS[h.status]||{}).bg, color:(STATUS_COLORS[h.status]||{}).color, padding:'2px 6px', display:'inline-block', width:'fit-content' }}>{h.status}</span>
                <span style={{ fontSize:'12px', color:'#1A1A2E', fontWeight:600 }}>{v(h.changedBy?.name, 'System')}</span>
                <span style={{ fontSize:'11px', color:'#9E8E6E' }}>{v(h.changedBy?.adminLevel, '—')}</span>
              </div>
            )) : (
              <div style={{ padding:'40px', textAlign:'center' }}><NotAvailable label="No status history recorded"/></div>
            )}
            <div style={{ padding:'8px 14px', background:'#FFFBEB', borderTop:'1px solid #FDE68A', fontSize:'10px', color:'#92400E', fontWeight:600 }}>
              ⚠ Status history is immutable. No records can be modified or deleted.
            </div>
          </BCard>
        )}

      </div>

      <div style={{ background:'#0D1B2A', borderTop:'2px solid #B8960C', padding:'10px 20px', display:'flex', justifyContent:'space-between', marginTop:'14px' }}>
        <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.3)' }}>ZEMISH BOOKING DETAIL v2.0.0</span>
        <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.3)' }}>NATIONAL COMMAND CENTER</span>
      </div>

      {showCancel && (
        <CancelModal
          booking={booking}
          submitting={cancelling}
          onConfirm={handleCancel}
          onClose={() => setShowCancel(false)}
        />
      )}
    </div>
  )
}