import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { FONTS } from '../../config/brand'
import useAuthStore from '../../store/authStore'

const ADMIN_LEVELS = { SUPER_ADMIN:'SUPER_ADMIN', INDIA_ADMIN:'INDIA_ADMIN', STATE_ADMIN:'STATE_ADMIN', DISTRICT_ADMIN:'DISTRICT_ADMIN' }
const canRefund    = (l) => [ADMIN_LEVELS.SUPER_ADMIN, ADMIN_LEVELS.INDIA_ADMIN].includes(l)

const BOOKINGS_DB = {
  'BK001': {
    id:'BK001', status:'COMPLETED', paymentMode:'UPI', amount:150,
    date:'2026-06-23', time:'10:00 AM', duration:'30 min',
    service:'Haircut', notes:'Regular trim, not too short',
    salon:{ id:'SAL001', name:'Salman Salmani', phone:'9971038586', address:'01, UPSIDC IND AREA, Hapur, UP 201015', district:'Hapur', state:'UP' },
    customer:{ name:'Rahul Verma', phone:'9812345678', email:'rahul.verma@gmail.com', totalBookings:12, joinedAt:'2025-08-10' },
    payment:{ mode:'UPI', upiId:'rahul@paytm', txnId:'TXN202606231045', paidAt:'2026-06-23 09:58 AM', platformFee:15, salonShare:135, status:'SUCCESS' },
    rating:{ score:5, review:'Excellent service! Very professional and on time.', reviewedAt:'2026-06-23 11:30 AM' },
    timeline:[
      { event:'Booking Created',    time:'2026-06-23 09:45 AM', by:'Customer',  done:true, color:'#059669' },
      { event:'Payment Received',   time:'2026-06-23 09:58 AM', by:'System',    done:true, color:'#059669' },
      { event:'Salon Confirmed',    time:'2026-06-23 10:00 AM', by:'Salon',     done:true, color:'#059669' },
      { event:'Service Started',    time:'2026-06-23 10:02 AM', by:'Barber',    done:true, color:'#059669' },
      { event:'Service Completed',  time:'2026-06-23 10:32 AM', by:'Barber',    done:true, color:'#059669' },
      { event:'Review Submitted',   time:'2026-06-23 11:30 AM', by:'Customer',  done:true, color:'#059669' },
    ],
    audit:[
      { date:'2026-06-23 11:30 AM', admin:'Customer',   action:'Review submitted — 5★',          ip:'Backend' },
      { date:'2026-06-23 10:32 AM', admin:'System',     action:'Booking marked COMPLETED',       ip:'Backend' },
      { date:'2026-06-23 10:02 AM', admin:'System',     action:'Service started',                ip:'Backend' },
      { date:'2026-06-23 09:58 AM', admin:'System',     action:'Payment SUCCESS — ₹150 UPI',     ip:'Backend' },
      { date:'2026-06-23 09:45 AM', admin:'Customer',   action:'Booking created',                ip:'Backend' },
    ],
  },
  'BK004': {
    id:'BK004', status:'CANCELLED', paymentMode:'UPI', amount:150,
    date:'2026-06-22', time:'09:00 AM', duration:'30 min',
    service:'Haircut', notes:'',
    salon:{ id:'SAL004', name:'Glamour Zone', phone:'9823456789', address:'22, MG Road, Agra, UP 282001', district:'Agra', state:'UP' },
    customer:{ name:'Deepak Gupta', phone:'9934567890', email:'deepak.gupta@gmail.com', totalBookings:4, joinedAt:'2026-01-15' },
    payment:{ mode:'UPI', upiId:'deepak@gpay', txnId:'TXN202606220850', paidAt:'2026-06-22 08:50 AM', platformFee:15, salonShare:135, status:'REFUND_PENDING' },
    rating:null,
    timeline:[
      { event:'Booking Created',    time:'2026-06-22 08:45 AM', by:'Customer', done:true,  color:'#059669' },
      { event:'Payment Received',   time:'2026-06-22 08:50 AM', by:'System',   done:true,  color:'#059669' },
      { event:'Booking Cancelled',  time:'2026-06-22 08:55 AM', by:'Customer', done:true,  color:'#DC2626' },
      { event:'Refund Initiated',   time:'Pending',              by:'System',   done:false, color:'#D97706' },
      { event:'Refund Completed',   time:'Pending',              by:'System',   done:false, color:'#9E8E6E' },
    ],
    audit:[
      { date:'2026-06-22 08:55 AM', admin:'Customer', action:'Booking CANCELLED by customer', ip:'Backend' },
      { date:'2026-06-22 08:50 AM', admin:'System',   action:'Payment received — ₹150 UPI',  ip:'Backend' },
      { date:'2026-06-22 08:45 AM', admin:'Customer', action:'Booking created',               ip:'Backend' },
    ],
    cancelReason:'Customer cancelled before service',
  },
  'BK002': {
    id:'BK002', status:'UPCOMING', paymentMode:'CARD', amount:100,
    date:'2026-06-23', time:'11:30 AM', duration:'20 min',
    service:'Beard Styling', notes:'Keep it sharp',
    salon:{ id:'SAL002', name:'Royal Cuts Studio', phone:'9876543210', address:'42, Sector 18, Noida, UP 201301', district:'Noida', state:'UP' },
    customer:{ name:'Amit Kumar', phone:'9812345678', email:'amit.kumar@gmail.com', totalBookings:7, joinedAt:'2025-11-20' },
    payment:{ mode:'CARD', upiId:null, txnId:'TXN202606230900', paidAt:'2026-06-23 09:00 AM', platformFee:10, salonShare:90, status:'SUCCESS' },
    rating:null,
    timeline:[
      { event:'Booking Created',  time:'2026-06-23 09:00 AM', by:'Customer', done:true,  color:'#059669' },
      { event:'Payment Received', time:'2026-06-23 09:01 AM', by:'System',   done:true,  color:'#059669' },
      { event:'Salon Confirmed',  time:'2026-06-23 09:05 AM', by:'Salon',    done:true,  color:'#059669' },
      { event:'Service Start',    time:'11:30 AM (Scheduled)',by:'—',        done:false, color:'#2563EB' },
      { event:'Service Complete', time:'11:50 AM (Expected)', by:'—',        done:false, color:'#9E8E6E' },
    ],
    audit:[
      { date:'2026-06-23 09:05 AM', admin:'Salon',    action:'Booking confirmed by salon', ip:'Backend' },
      { date:'2026-06-23 09:01 AM', admin:'System',   action:'Payment SUCCESS — ₹100 CARD',ip:'Backend' },
      { date:'2026-06-23 09:00 AM', admin:'Customer', action:'Booking created',            ip:'Backend' },
    ],
  },
}

const STATUS_COLORS = {
  COMPLETED:      { bg:'#D1FAE5', color:'#065F46' },
  UPCOMING:       { bg:'#EFF6FF', color:'#1D4ED8' },
  ONGOING:        { bg:'#FEF9C3', color:'#92400E' },
  CANCELLED:      { bg:'#FEE2E2', color:'#991B1B' },
  NO_SHOW:        { bg:'#F3F4F6', color:'#374151' },
  REFUNDED:       { bg:'#F5F3FF', color:'#5B21B6' },
  SUCCESS:        { bg:'#D1FAE5', color:'#065F46' },
  REFUND_PENDING: { bg:'#FEF9C3', color:'#92400E' },
  FAILED:         { bg:'#FEE2E2', color:'#991B1B' },
}

// ─── Refund Modal ─────────────────────────────────────────
function RefundModal({ booking, onConfirm, onCancel }) {
  const [reason, setReason] = useState('')
  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.75)', zIndex:2000, display:'flex', alignItems:'center', justifyContent:'center' }}>
      <div style={{ background:'#fff', width:'440px', border:'2px solid #7C3AED' }}>
        <div style={{ background:'#4C1D95', padding:'14px 18px', borderBottom:'2px solid #7C3AED' }}>
          <div style={{ color:'#fff', fontWeight:800, fontSize:'13px', letterSpacing:'1px' }}>↩ INITIATE REFUND</div>
          <div style={{ color:'#DDD6FE', fontSize:'10px', marginTop:'2px' }}>{booking.id} — ₹{booking.amount} {booking.paymentMode}</div>
        </div>
        <div style={{ padding:'20px 18px' }}>
          <div style={{ background:'#F5F3FF', border:'1px solid #DDD6FE', padding:'10px', marginBottom:'14px', fontSize:'11px', color:'#5B21B6', fontWeight:600 }}>
            ⚠ Refund of ₹{booking.amount} will be initiated to customer's {booking.paymentMode} account.
          </div>
          <label style={{ fontSize:'10px', color:'#9E8E6E', fontWeight:800, letterSpacing:'1px', display:'block', marginBottom:'6px' }}>REFUND REASON (REQUIRED)</label>
          <textarea value={reason} onChange={e=>setReason(e.target.value)} placeholder="Enter reason for refund..."
            style={{ width:'100%', border:'1px solid #D4C9B0', padding:'8px 12px', fontSize:'13px', fontFamily:FONTS.body, outline:'none', minHeight:'70px', resize:'vertical', boxSizing:'border-box', marginBottom:'14px' }}/>
          <div style={{ display:'flex', gap:'8px', justifyContent:'flex-end' }}>
            <button onClick={onCancel} style={{ background:'#fff', border:'1px solid #D4C9B0', color:'#6B5E3E', padding:'8px 16px', fontSize:'11px', fontWeight:700, cursor:'pointer' }}>CANCEL</button>
            <button onClick={() => reason.trim() && onConfirm(reason)}
              style={{ background:reason.trim()?'#7C3AED':'#F5F0E8', border:'none', color:reason.trim()?'#fff':'#C4B49A', padding:'8px 20px', fontSize:'11px', fontWeight:800, cursor:reason.trim()?'pointer':'not-allowed' }}>
              ↩ CONFIRM REFUND
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

// ─── Main Page ────────────────────────────────────────────
export default function BookingDetailPage() {
  const { id }     = useParams()
  const navigate   = useNavigate()
  const admin      = useAuthStore(s => s.admin)
  const adminLevel = admin?.adminLevel || ADMIN_LEVELS.SUPER_ADMIN
  const hasRefund  = canRefund(adminLevel)

  const [tab,         setTab]         = useState('overview')
  const [showRefund,  setShowRefund]  = useState(false)
  const [toast,       setToast]       = useState(null)
  const [booking,     setBooking]     = useState(BOOKINGS_DB[id] || Object.values(BOOKINGS_DB)[0])

  const showToast = (msg, color) => { setToast({ msg, color }); setTimeout(() => setToast(null), 3000) }

  const handleRefund = (reason) => {
    setBooking(b => ({ ...b, status:'REFUNDED', payment:{ ...b.payment, status:'REFUND_PENDING' } }))
    setShowRefund(false)
    showToast('↩ Refund initiated successfully', '#7C3AED')
  }

  const sc   = STATUS_COLORS[booking.status]  || STATUS_COLORS.COMPLETED
  const psc  = STATUS_COLORS[booking.payment?.status] || STATUS_COLORS.SUCCESS
  const TABS = ['overview','customer','salon','payment','timeline','audit']

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
          <button onClick={() => navigate('/app/bookings')} style={{ background:'rgba(255,255,255,0.07)', border:'1px solid rgba(255,255,255,0.1)', color:'rgba(255,255,255,0.6)', padding:'5px 10px', cursor:'pointer', fontSize:'12px', fontWeight:700 }}>← BACK</button>
          <div style={{ width:'3px', height:'16px', background:'#B8960C' }}/>
          <div>
            <div style={{ color:'#fff', fontWeight:800, fontSize:'13px', letterSpacing:'1px' }}>{booking.id} — {booking.service}</div>
            <div style={{ color:'#B8960C', fontSize:'9px', letterSpacing:'1px', marginTop:'1px' }}>{booking.salon.name} • {booking.date} {booking.time}</div>
          </div>
          <span style={{ fontSize:'10px', fontWeight:800, background:sc.bg, color:sc.color, padding:'3px 8px' }}>{booking.status}</span>
        </div>
        <div style={{ display:'flex', gap:'8px' }}>
          <button onClick={() => navigate(`/app/salons/${booking.salon.id}`)} style={{ background:'rgba(184,150,12,0.15)', border:'1px solid rgba(184,150,12,0.4)', color:'#B8960C', padding:'6px 12px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>VIEW SALON</button>
          {hasRefund && booking.status !== 'REFUNDED' && booking.status !== 'UPCOMING' && (
            <button onClick={() => setShowRefund(true)} style={{ background:'rgba(124,58,237,0.15)', border:'1px solid rgba(124,58,237,0.4)', color:'#C4B5FD', padding:'6px 12px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>↩ REFUND</button>
          )}
          {booking.status === 'UPCOMING' && (
            <button onClick={() => showToast('⊘ Booking cancelled', '#DC2626')} style={{ background:'rgba(220,38,38,0.15)', border:'1px solid rgba(220,38,38,0.4)', color:'#FCA5A5', padding:'6px 12px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>⊘ CANCEL</button>
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
      <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:'1px', background:'#D4C9B0', borderBottom:'2px solid #B8960C' }}>
        {[
          { label:'Service',       value:booking.service,         color:'#B8960C' },
          { label:'Amount',        value:`₹${booking.amount}`,    color:'#059669' },
          { label:'Payment Mode',  value:booking.paymentMode,     color:'#2563EB' },
          { label:'Duration',      value:booking.duration,        color:'#D97706' },
          { label:'Date & Time',   value:`${booking.date} ${booking.time}`, color:'#9E8E6E' },
        ].map(k => (
          <div key={k.label} style={{ background:'#0D1B2A', padding:'10px 16px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
            <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.4)' }}>{k.label}</span>
            <span style={{ fontSize:'13px', fontWeight:800, color:k.color }}>{k.value}</span>
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
                <InfoRow label="Booking ID"    value={booking.id}/>
                <InfoRow label="Service"       value={booking.service}/>
                <InfoRow label="Duration"      value={booking.duration}/>
                <InfoRow label="Date"          value={booking.date}/>
                <InfoRow label="Time"          value={booking.time}/>
                <InfoRow label="Status"        value={booking.status}   valueColor={sc.color}/>
                {booking.notes && (
                  <>
                    <SLabel title="Customer Notes"/>
                    <div style={{ padding:'8px 10px', background:'#F5F0E8', border:'1px solid #E8DFD0', fontSize:'12px', color:'#6B5E3E', borderLeft:'3px solid #B8960C' }}>{booking.notes}</div>
                  </>
                )}
                {booking.cancelReason && (
                  <>
                    <SLabel title="Cancellation Reason"/>
                    <div style={{ padding:'8px 10px', background:'#FEF2F2', border:'1px solid #FEE2E2', fontSize:'12px', color:'#991B1B', borderLeft:'3px solid #DC2626' }}>{booking.cancelReason}</div>
                  </>
                )}
              </div>
            </BCard>

            <BCard>
              <BCardHeader title="Payment Summary"/>
              <div style={{ padding:'14px' }}>
                <div style={{ background:'#0D1B2A', padding:'16px', marginBottom:'14px', textAlign:'center', borderTop:'2px solid #B8960C' }}>
                  <div style={{ fontSize:'10px', color:'rgba(255,255,255,0.4)', letterSpacing:'1px', marginBottom:'6px' }}>BOOKING AMOUNT</div>
                  <div style={{ fontSize:'28px', fontWeight:800, color:'#B8960C' }}>₹{booking.amount}</div>
                  <span style={{ fontSize:'10px', fontWeight:800, background:psc.bg, color:psc.color, padding:'2px 8px', display:'inline-block', marginTop:'6px' }}>{booking.payment?.status}</span>
                </div>
                <SLabel title="Breakdown"/>
                <InfoRow label="Platform Fee"  value={`₹${booking.payment?.platformFee}`} valueColor="#DC2626"/>
                <InfoRow label="Salon Share"   value={`₹${booking.payment?.salonShare}`}  valueColor="#059669"/>
                <InfoRow label="TXN ID"        value={booking.payment?.txnId}/>
                <InfoRow label="Paid At"       value={booking.payment?.paidAt}/>
              </div>
            </BCard>

            <BCard>
              <BCardHeader title="Rating & Review"/>
              <div style={{ padding:'14px' }}>
                {booking.rating ? (
                  <>
                    <div style={{ display:'flex', justifyContent:'center', gap:'4px', marginBottom:'12px' }}>
                      {[1,2,3,4,5].map(s => (
                        <span key={s} style={{ color:s<=booking.rating.score?'#B8960C':'#E8DFD0', fontSize:'28px' }}>★</span>
                      ))}
                    </div>
                    <div style={{ textAlign:'center', fontSize:'24px', fontWeight:800, color:'#B8960C', marginBottom:'12px' }}>{booking.rating.score}/5</div>
                    <div style={{ padding:'12px', background:'#F5F0E8', border:'1px solid #E8DFD0', borderLeft:'3px solid #B8960C', fontSize:'13px', color:'#6B5E3E' }}>
                      "{booking.rating.review}"
                    </div>
                    <div style={{ fontSize:'10px', color:'#9E8E6E', marginTop:'8px', textAlign:'right' }}>— {booking.rating.reviewedAt}</div>
                  </>
                ) : (
                  <div style={{ padding:'30px', textAlign:'center', color:'#9E8E6E' }}>
                    <div style={{ fontSize:'32px', marginBottom:'8px' }}>⭐</div>
                    <div style={{ fontSize:'12px', fontWeight:600 }}>No review yet</div>
                    <div style={{ fontSize:'10px', marginTop:'4px' }}>{booking.status === 'COMPLETED' ? 'Customer has not reviewed' : 'Review available after completion'}</div>
                  </div>
                )}
              </div>
            </BCard>
          </div>
        )}

        {/* CUSTOMER */}
        {tab === 'customer' && (
          <BCard>
            <BCardHeader title="Customer Information"/>
            <div style={{ padding:'20px' }}>
              <div style={{ display:'flex', alignItems:'center', gap:'14px', padding:'16px', background:'#F5F0E8', border:'1px solid #E8DFD0', borderTop:'2px solid #B8960C', marginBottom:'16px' }}>
                <div style={{ width:'52px', height:'52px', background:'#0D1B2A', display:'flex', alignItems:'center', justifyContent:'center', color:'#B8960C', fontSize:'22px', fontWeight:800, flexShrink:0 }}>
                  {booking.customer.name[0]}
                </div>
                <div>
                  <div style={{ fontSize:'16px', fontWeight:800, color:'#1A1A2E' }}>{booking.customer.name}</div>
                  <div style={{ fontSize:'11px', color:'#9E8E6E', marginTop:'2px' }}>Customer • Joined {booking.customer.joinedAt}</div>
                </div>
                <div style={{ marginLeft:'auto', textAlign:'center', padding:'10px 16px', background:'#0D1B2A', borderTop:'2px solid #B8960C' }}>
                  <div style={{ fontSize:'20px', fontWeight:800, color:'#B8960C' }}>{booking.customer.totalBookings}</div>
                  <div style={{ fontSize:'9px', color:'rgba(255,255,255,0.4)', letterSpacing:'0.5px' }}>TOTAL BOOKINGS</div>
                </div>
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'16px' }}>
                <div>
                  <InfoRow label="Full Name"     value={booking.customer.name}/>
                  <InfoRow label="Phone"         value={booking.customer.phone}/>
                  <InfoRow label="Email"         value={booking.customer.email}/>
                </div>
                <div>
                  <InfoRow label="Member Since"  value={booking.customer.joinedAt}/>
                  <InfoRow label="Total Bookings"value={booking.customer.totalBookings}/>
                </div>
              </div>
            </div>
          </BCard>
        )}

        {/* SALON */}
        {tab === 'salon' && (
          <BCard>
            <BCardHeader title="Salon Information" action={
              <button onClick={() => navigate(`/app/salons/${booking.salon.id}`)} style={{ background:'#B8960C', color:'#0D1B2A', border:'none', padding:'4px 12px', fontSize:'10px', fontWeight:800, cursor:'pointer' }}>VIEW SALON ▸</button>
            }/>
            <div style={{ padding:'20px' }}>
              <div style={{ display:'flex', alignItems:'center', gap:'14px', padding:'16px', background:'#F5F0E8', border:'1px solid #E8DFD0', borderTop:'2px solid #B8960C', marginBottom:'16px' }}>
                <div style={{ width:'52px', height:'52px', background:'#0D1B2A', display:'flex', alignItems:'center', justifyContent:'center', color:'#B8960C', fontSize:'22px', fontWeight:800, flexShrink:0 }}>
                  {booking.salon.name[0]}
                </div>
                <div>
                  <div style={{ fontSize:'16px', fontWeight:800, color:'#1A1A2E' }}>{booking.salon.name}</div>
                  <div style={{ fontSize:'11px', color:'#9E8E6E', marginTop:'2px' }}>{booking.salon.district}, {booking.salon.state}</div>
                </div>
              </div>
              <InfoRow label="Salon Name" value={booking.salon.name}/>
              <InfoRow label="Phone"      value={booking.salon.phone}/>
              <InfoRow label="Address"    value={booking.salon.address}/>
              <InfoRow label="District"   value={booking.salon.district}/>
              <InfoRow label="State"      value={booking.salon.state}/>
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
                  <div style={{ fontSize:'10px', color:'rgba(255,255,255,0.4)', letterSpacing:'1px', marginBottom:'6px' }}>TOTAL PAID</div>
                  <div style={{ fontSize:'32px', fontWeight:800, color:'#B8960C' }}>₹{booking.amount}</div>
                  <span style={{ fontSize:'10px', fontWeight:800, background:psc.bg, color:psc.color, padding:'3px 10px', display:'inline-block', marginTop:'8px' }}>{booking.payment?.status}</span>
                </div>
                <InfoRow label="Payment Mode"  value={booking.paymentMode}/>
                {booking.payment?.upiId && <InfoRow label="UPI ID"  value={booking.payment.upiId}/>}
                <InfoRow label="Transaction ID" value={booking.payment?.txnId}/>
                <InfoRow label="Paid At"        value={booking.payment?.paidAt}/>
              </div>
            </BCard>

            <BCard>
              <BCardHeader title="Revenue Split"/>
              <div style={{ padding:'14px' }}>
                <div style={{ background:'#FFFBEB', border:'1px solid #FDE68A', padding:'10px', marginBottom:'14px', fontSize:'11px', color:'#92400E', fontWeight:600 }}>
                  ⚠ Revenue split is calculated at time of booking.
                </div>
                {[
                  { label:'Customer Paid',  value:`₹${booking.amount}`,                color:'#1A1A2E' },
                  { label:'Platform Fee',   value:`- ₹${booking.payment?.platformFee}`,color:'#DC2626' },
                  { label:'Salon Share',    value:`₹${booking.payment?.salonShare}`,   color:'#059669' },
                ].map(r => (
                  <div key={r.label} style={{ display:'flex', justifyContent:'space-between', padding:'10px 0', borderBottom:'1px solid #F0EAE0' }}>
                    <span style={{ fontSize:'13px', color:'#9E8E6E' }}>{r.label}</span>
                    <span style={{ fontSize:'14px', fontWeight:800, color:r.color }}>{r.value}</span>
                  </div>
                ))}
                {hasRefund && booking.status !== 'REFUNDED' && (
                  <button onClick={() => setShowRefund(true)} style={{ width:'100%', marginTop:'14px', background:'rgba(124,58,237,0.1)', border:'1px solid #7C3AED', color:'#7C3AED', padding:'10px', fontSize:'11px', fontWeight:800, cursor:'pointer', letterSpacing:'0.5px' }}>
                    ↩ INITIATE REFUND
                  </button>
                )}
              </div>
            </BCard>
          </div>
        )}

        {/* TIMELINE */}
        {tab === 'timeline' && (
          <BCard>
            <BCardHeader title="Booking Timeline"/>
            <div style={{ padding:'24px 20px' }}>
              <div style={{ position:'relative', paddingLeft:'32px' }}>
                <div style={{ position:'absolute', left:'12px', top:'10px', bottom:'10px', width:'2px', background:'#E8DFD0' }}/>
                {booking.timeline.map((t, i) => (
                  <div key={i} style={{ position:'relative', marginBottom:'24px' }}>
                    <div style={{ position:'absolute', left:'-23px', top:'2px', width:'20px', height:'20px', background:t.done?t.color:'#E8DFD0', border:`2px solid ${t.done?t.color:'#D4C9B0'}`, display:'flex', alignItems:'center', justifyContent:'center' }}>
                      {t.done && <span style={{ color:'#fff', fontSize:'10px', fontWeight:800 }}>✓</span>}
                    </div>
                    <div style={{ background:t.done?'#FDFAF6':'#F5F0E8', border:`1px solid ${t.done?'#D4C9B0':'#E8DFD0'}`, borderLeft:`3px solid ${t.done?t.color:'#D4C9B0'}`, padding:'12px 16px' }}>
                      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                        <div style={{ fontSize:'13px', fontWeight:700, color:t.done?'#1A1A2E':'#9E8E6E' }}>{t.event}</div>
                        <div style={{ display:'flex', gap:'12px', alignItems:'center' }}>
                          <span style={{ fontSize:'10px', color:'#9E8E6E' }}>By: {t.by}</span>
                          <span style={{ fontSize:'10px', color:t.done?t.color:'#C4B49A', fontWeight:600 }}>{t.time}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </BCard>
        )}

        {/* AUDIT */}
        {tab === 'audit' && (
          <BCard>
            <BCardHeader title="Audit Log — Immutable" action={
              <span style={{ fontSize:'10px', color:'#DC2626', fontWeight:700 }}>⚠ CANNOT BE DELETED</span>
            }/>
            <div style={{ display:'grid', gridTemplateColumns:'1.5fr 1.2fr 2.5fr 1fr', padding:'8px 14px', background:'#F5F0E8', borderBottom:'1px solid #E8DFD0', gap:'8px' }}>
              {['DATE & TIME','BY','ACTION','IP'].map(h=>(
                <span key={h} style={{ fontSize:'9px', fontWeight:800, color:'#9E8E6E', letterSpacing:'1px' }}>{h}</span>
              ))}
            </div>
            {booking.audit.map((a,i) => (
              <div key={i} style={{ display:'grid', gridTemplateColumns:'1.5fr 1.2fr 2.5fr 1fr', padding:'11px 14px', borderBottom:'1px solid #F0EAE0', alignItems:'center', gap:'8px', background:i%2===0?'#fff':'#FDFAF6' }}>
                <span style={{ fontSize:'11px', color:'#6B5E3E', fontFamily:'monospace' }}>{a.date}</span>
                <span style={{ fontSize:'12px', color:'#1A1A2E', fontWeight:600 }}>{a.admin}</span>
                <span style={{ fontSize:'12px', color:'#1A1A2E' }}>{a.action}</span>
                <span style={{ fontSize:'11px', color:'#C4B49A', fontStyle:'italic' }}>From Backend</span>
              </div>
            ))}
            <div style={{ padding:'8px 14px', background:'#FFFBEB', borderTop:'1px solid #FDE68A', fontSize:'10px', color:'#92400E', fontWeight:600 }}>
              ⚠ Audit logs are immutable. No records can be modified or deleted.
            </div>
          </BCard>
        )}

      </div>

      <div style={{ background:'#0D1B2A', borderTop:'2px solid #B8960C', padding:'10px 20px', display:'flex', justifyContent:'space-between', marginTop:'14px' }}>
        <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.3)' }}>ZEMISH BOOKING DETAIL v1.0.0</span>
        <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.3)' }}>NATIONAL COMMAND CENTER</span>
      </div>

      {showRefund && <RefundModal booking={booking} onConfirm={handleRefund} onCancel={() => setShowRefund(false)}/>}
    </div>
  )
}
