import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FONTS } from '../../config/brand'
import useAuthStore from '../../store/authStore'

const ADMIN_LEVELS = { SUPER_ADMIN:'SUPER_ADMIN', INDIA_ADMIN:'INDIA_ADMIN', STATE_ADMIN:'STATE_ADMIN', DISTRICT_ADMIN:'DISTRICT_ADMIN' }
const canExport    = (l) => [ADMIN_LEVELS.SUPER_ADMIN, ADMIN_LEVELS.INDIA_ADMIN, ADMIN_LEVELS.STATE_ADMIN].includes(l)

const BOOKINGS_DATA = [
  { id:'BK001', salon:'Salman Salmani',    customer:'Rahul Verma',    service:'Haircut',       amount:150,  date:'2026-06-23', time:'10:00 AM', state:'UP', district:'Hapur',       status:'COMPLETED', paymentMode:'UPI',  rating:5   },
  { id:'BK002', salon:'Royal Cuts Studio', customer:'Amit Kumar',     service:'Beard Styling', amount:100,  date:'2026-06-23', time:'11:30 AM', state:'UP', district:'Noida',       status:'UPCOMING',  paymentMode:'CARD', rating:null },
  { id:'BK003', salon:'Style Studio & Spa',customer:'Vikas Singh',    service:'Hair Color',    amount:500,  date:'2026-06-23', time:'02:00 PM', state:'UP', district:'Lucknow',     status:'ONGOING',   paymentMode:'CASH', rating:null },
  { id:'BK004', salon:'Glamour Zone',      customer:'Deepak Gupta',   service:'Haircut',       amount:150,  date:'2026-06-22', time:'09:00 AM', state:'UP', district:'Agra',        status:'CANCELLED', paymentMode:'UPI',  rating:null },
  { id:'BK005', salon:'Hair Masters',      customer:'Raj Sharma',     service:'Facial',        amount:300,  date:'2026-06-22', time:'03:30 PM', state:'UP', district:'Kanpur',      status:'COMPLETED', paymentMode:'UPI',  rating:4   },
  { id:'BK006', salon:'Luxuria Salon',     customer:'Neha Joshi',     service:'Spa Package',   amount:1200, date:'2026-06-22', time:'12:00 PM', state:'DL', district:'South Delhi', status:'COMPLETED', paymentMode:'CARD', rating:5   },
  { id:'BK007', salon:'The Barber Shop',   customer:'Suresh Kumar',   service:'Haircut',       amount:120,  date:'2026-06-22', time:'04:00 PM', state:'MH', district:'Mumbai',      status:'NO_SHOW',   paymentMode:'UPI',  rating:null },
  { id:'BK008', salon:'Glow Beauty',       customer:'Priya Patel',    service:'Hair Color',    amount:800,  date:'2026-06-21', time:'01:00 PM', state:'RJ', district:'Jaipur',      status:'COMPLETED', paymentMode:'CASH', rating:4   },
  { id:'BK009', salon:'Fade & Blade',      customer:'Karan Mehta',    service:'Beard Styling', amount:150,  date:'2026-06-21', time:'05:00 PM', state:'GJ', district:'Ahmedabad',   status:'REFUNDED',  paymentMode:'UPI',  rating:null },
  { id:'BK010', salon:'Bella Beauty',      customer:'Sunita Das',     service:'Facial',        amount:400,  date:'2026-06-21', time:'11:00 AM', state:'KA', district:'Bengaluru',   status:'COMPLETED', paymentMode:'CARD', rating:5   },
  { id:'BK011', salon:'Smart Cuts',        customer:'Arjun Nair',     service:'Haircut',       amount:180,  date:'2026-06-20', time:'10:30 AM', state:'KL', district:'Kochi',       status:'COMPLETED', paymentMode:'UPI',  rating:5   },
  { id:'BK012', salon:'Urban Grooming',    customer:'Rohan Malhotra', service:'Head Massage',  amount:250,  date:'2026-06-20', time:'06:00 PM', state:'PB', district:'Chandigarh',  status:'UPCOMING',  paymentMode:'CARD', rating:null },
]

const TODAY      = '2026-06-23'
const LAST7      = '2026-06-16'
const LAST30     = '2026-05-24'

const STATUS_COLORS = {
  COMPLETED: { bg:'#D1FAE5', color:'#065F46' },
  UPCOMING:  { bg:'#EFF6FF', color:'#1D4ED8' },
  ONGOING:   { bg:'#FEF9C3', color:'#92400E' },
  CANCELLED: { bg:'#FEE2E2', color:'#991B1B' },
  NO_SHOW:   { bg:'#F3F4F6', color:'#374151' },
  REFUNDED:  { bg:'#F5F3FF', color:'#5B21B6' },
}
const PAYMENT_COLORS = {
  UPI:  { bg:'#F0FDF4', color:'#059669' },
  CARD: { bg:'#EFF6FF', color:'#1D4ED8' },
  CASH: { bg:'#FFFBEB', color:'#92400E' },
}

const STATES   = ['All States',   ...new Set(BOOKINGS_DATA.map(b => b.state))]
const STATUSES = ['ALL','COMPLETED','UPCOMING','ONGOING','CANCELLED','NO_SHOW','REFUNDED']
const PAYMENTS = ['ALL','UPI','CARD','CASH']
const DATES    = ['All Time','Today','Last 7 Days','Last 30 Days']

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

export default function BookingsPage() {
  const navigate   = useNavigate()
  const admin      = useAuthStore(s => s.admin)
  const adminLevel = admin?.adminLevel || ADMIN_LEVELS.SUPER_ADMIN
  const hasExport  = canExport(adminLevel)

  const [search,  setSearch]  = useState('')
  const [status,  setStatus]  = useState('ALL')
  const [payment, setPayment] = useState('ALL')
  const [stateF,  setStateF]  = useState('All States')
  const [dateF,   setDateF]   = useState('All Time')
  const [page,    setPage]    = useState(1)
  const PER_PAGE = 8

  // ✅ Fix 1 — Date filter working
  const filterByDate = (b) => {
    if (dateF === 'All Time')    return true
    if (dateF === 'Today')       return b.date === TODAY
    if (dateF === 'Last 7 Days') return b.date >= LAST7
    if (dateF === 'Last 30 Days')return b.date >= LAST30
    return true
  }

  const filtered = BOOKINGS_DATA.filter(b => {
    const q = search.toLowerCase()
    const matchSearch  = !search || b.salon.toLowerCase().includes(q) || b.customer.toLowerCase().includes(q) || b.id.toLowerCase().includes(q) || b.service.toLowerCase().includes(q)
    const matchStatus  = status  === 'ALL'        || b.status      === status
    const matchPayment = payment === 'ALL'        || b.paymentMode === payment
    const matchState   = stateF  === 'All States' || b.state       === stateF
    return matchSearch && matchStatus && matchPayment && matchState && filterByDate(b)
  })

  const totalPages = Math.ceil(filtered.length / PER_PAGE)
  const paginated  = filtered.slice((page-1)*PER_PAGE, page*PER_PAGE)

  const counts = {
    ALL:       BOOKINGS_DATA.length,
    COMPLETED: BOOKINGS_DATA.filter(b=>b.status==='COMPLETED').length,
    UPCOMING:  BOOKINGS_DATA.filter(b=>b.status==='UPCOMING').length,
    ONGOING:   BOOKINGS_DATA.filter(b=>b.status==='ONGOING').length,
    CANCELLED: BOOKINGS_DATA.filter(b=>b.status==='CANCELLED').length,
    NO_SHOW:   BOOKINGS_DATA.filter(b=>b.status==='NO_SHOW').length,
    REFUNDED:  BOOKINGS_DATA.filter(b=>b.status==='REFUNDED').length,
  }

  const completedBookings = BOOKINGS_DATA.filter(b=>b.status==='COMPLETED')
  const totalRevenue  = completedBookings.reduce((a,b)=>a+b.amount,0)
  const totalRefunded = BOOKINGS_DATA.filter(b=>b.status==='REFUNDED').reduce((a,b)=>a+b.amount,0)
  // ✅ Fix 2 — Division by zero protection
  const avgBookingVal = completedBookings.length > 0 ? Math.round(totalRevenue / completedBookings.length) : 0

  const resetFilters = () => { setSearch(''); setStatus('ALL'); setPayment('ALL'); setStateF('All States'); setDateF('All Time'); setPage(1) }

  return (
    <div style={{ fontFamily:FONTS.body, background:'#F0EAE0', minHeight:'100vh' }}>

      {/* Header */}
      <div style={{ background:'#0D1B2A', borderBottom:'2px solid #B8960C', padding:'0 20px', height:'52px', display:'flex', alignItems:'center', justifyContent:'space-between', position:'sticky', top:0, zIndex:10 }}>
        <div style={{ display:'flex', alignItems:'center', gap:'12px' }}>
          <div style={{ width:'3px', height:'16px', background:'#B8960C' }}/>
          <h1 style={{ fontSize:'13px', fontWeight:800, color:'#fff', margin:0, letterSpacing:'2px', textTransform:'uppercase' }}>Bookings</h1>
          <span style={{ background:'rgba(184,150,12,0.2)', color:'#B8960C', fontSize:'10px', fontWeight:800, padding:'2px 8px', border:'1px solid rgba(184,150,12,0.3)' }}>{BOOKINGS_DATA.length} TOTAL</span>
          {counts.ONGOING > 0 && <span style={{ background:'rgba(234,179,8,0.2)', color:'#D97706', fontSize:'10px', fontWeight:800, padding:'2px 8px', border:'1px solid rgba(234,179,8,0.3)' }}>🔴 {counts.ONGOING} LIVE</span>}
          {/* ✅ Fix 3 — Scope indicator */}
          <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.3)', letterSpacing:'0.5px' }}>|</span>
          <span style={{ fontSize:'10px', color:'#B8960C', fontWeight:600 }}>
            {adminLevel === ADMIN_LEVELS.STATE_ADMIN ? `Viewing: ${admin?.scope?.stateRef||'Your State'}` : adminLevel === ADMIN_LEVELS.DISTRICT_ADMIN ? `Viewing: ${admin?.scope?.districtRef||'Your District'}` : 'Viewing: PAN India'}
          </span>
        </div>
        <div style={{ display:'flex', gap:'8px' }}>
          <button onClick={() => navigate('/app/bookings/analytics')} style={{ background:'rgba(5,150,105,0.15)', border:'1px solid rgba(5,150,105,0.4)', color:'#6EE7B7', padding:'6px 12px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>📊 ANALYTICS</button>
          {/* ✅ Fix 4 — Export permission based */}
          {hasExport
            ? <button style={{ background:'rgba(255,255,255,0.07)', border:'1px solid rgba(255,255,255,0.15)', color:'rgba(255,255,255,0.6)', padding:'6px 12px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>↓ EXPORT</button>
            : <div style={{ background:'rgba(220,38,38,0.1)', border:'1px solid rgba(220,38,38,0.2)', color:'rgba(220,38,38,0.5)', padding:'6px 12px', fontSize:'10px', fontWeight:700 }}>⊘ NO EXPORT</div>
          }
        </div>
      </div>

      <div style={{ padding:'14px 20px' }}>

        {/* Summary Strip */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:'1px', background:'#D4C9B0', border:'1px solid #D4C9B0', marginBottom:'12px' }}>
          {[
            { label:'Total Bookings', value:counts.ALL,                                    color:'#B8960C' },
            { label:'Total Revenue',  value:`₹${totalRevenue.toLocaleString('en-IN')}`,    color:'#059669' },
            { label:'Avg Booking',    value:avgBookingVal > 0 ? `₹${avgBookingVal}` : '—', color:'#2563EB' },
            { label:'Cancelled+NoShow',value:counts.CANCELLED+counts.NO_SHOW,              color:'#DC2626' },
            { label:'Refunded',       value:`₹${totalRefunded.toLocaleString('en-IN')}`,   color:'#7C3AED' },
          ].map(m => (
            <div key={m.label} style={{ background:'#0D1B2A', padding:'12px 16px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <span style={{ fontSize:'11px', color:'rgba(255,255,255,0.4)' }}>{m.label}</span>
              <span style={{ fontSize:'16px', fontWeight:800, color:m.color }}>{m.value}</span>
            </div>
          ))}
        </div>

        {/* Stats Cards */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(6,1fr)', gap:'8px', marginBottom:'12px' }}>
          {[
            { label:'Completed', count:counts.COMPLETED, color:'#059669', f:'COMPLETED' },
            { label:'Upcoming',  count:counts.UPCOMING,  color:'#2563EB', f:'UPCOMING'  },
            { label:'Ongoing',   count:counts.ONGOING,   color:'#D97706', f:'ONGOING'   },
            { label:'Cancelled', count:counts.CANCELLED, color:'#DC2626', f:'CANCELLED' },
            { label:'No Show',   count:counts.NO_SHOW,   color:'#374151', f:'NO_SHOW'   },
            { label:'Refunded',  count:counts.REFUNDED,  color:'#7C3AED', f:'REFUNDED'  },
          ].map(s => (
            <div key={s.label} onClick={() => { setStatus(s.f); setPage(1) }}
              style={{ background:status===s.f?s.color:'#fff', border:`1px solid ${s.color}30`, borderTop:`2px solid ${s.color}`, padding:'10px', cursor:'pointer', textAlign:'center' }}>
              <div style={{ fontSize:'20px', fontWeight:800, color:status===s.f?'#fff':s.color }}>{s.count}</div>
              <div style={{ fontSize:'9px', color:status===s.f?'rgba(255,255,255,0.8)':'#9E8E6E', textTransform:'uppercase', letterSpacing:'0.5px', marginTop:'2px' }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* Filters */}
        <BCard style={{ marginBottom:'12px' }}>
          <div style={{ padding:'10px 14px', display:'flex', gap:'8px', alignItems:'center', flexWrap:'wrap' }}>
            <div style={{ display:'flex', alignItems:'center', gap:'6px' }}>
              <div style={{ width:'3px', height:'14px', background:'#B8960C' }}/>
              <span style={{ fontSize:'10px', fontWeight:800, color:'#9E8E6E', letterSpacing:'1px' }}>FILTERS</span>
            </div>
            <input value={search} onChange={e=>{setSearch(e.target.value);setPage(1)}} placeholder="Search booking ID, salon, customer, service..."
              style={{ flex:1, minWidth:'200px', border:'1px solid #D4C9B0', padding:'6px 10px', fontSize:'12px', fontFamily:FONTS.body, outline:'none', background:'#FDFAF6' }}/>
            {[
              { val:status,  set:v=>{setStatus(v);setPage(1)},  opts:STATUSES },
              { val:payment, set:v=>{setPayment(v);setPage(1)}, opts:PAYMENTS },
              { val:stateF,  set:v=>{setStateF(v);setPage(1)},  opts:STATES   },
              { val:dateF,   set:v=>{setDateF(v);setPage(1)},   opts:DATES    },
            ].map((f,i) => (
              <select key={i} value={f.val} onChange={e=>f.set(e.target.value)}
                style={{ border:'1px solid #D4C9B0', padding:'5px 8px', fontSize:'11px', color:'#6B5E3E', background:'#FDFAF6', cursor:'pointer', fontFamily:FONTS.body, outline:'none' }}>
                {f.opts.map(o=><option key={o}>{o}</option>)}
              </select>
            ))}
            <span style={{ fontSize:'11px', color:'#9E8E6E' }}>{filtered.length} results</span>
            <button onClick={resetFilters} style={{ background:'#F5F0E8', border:'1px solid #D4C9B0', color:'#9E8E6E', padding:'5px 10px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>RESET</button>
          </div>
        </BCard>

        {/* Table */}
        <BCard>
          <BCardHeader title={`Booking Registry (${filtered.length})`} action={
            <span style={{ fontSize:'11px', color:'#9E8E6E' }}>Page {page} of {totalPages||1}</span>
          }/>
          <div style={{ display:'grid', gridTemplateColumns:'0.7fr 1.5fr 1.2fr 1.2fr 0.8fr 0.7fr 0.7fr 0.7fr 0.6fr 0.8fr', padding:'8px 14px', background:'#F5F0E8', borderBottom:'1px solid #E8DFD0', gap:'8px' }}>
            {['BOOKING ID','SALON','CUSTOMER','SERVICE','AMOUNT','DATE','TIME','PAYMENT','RATING','STATUS'].map(h=>(
              <span key={h} style={{ fontSize:'9px', fontWeight:800, color:'#9E8E6E', letterSpacing:'1px' }}>{h}</span>
            ))}
          </div>

          {paginated.length === 0
            ? <div style={{ padding:'40px', textAlign:'center', color:'#9E8E6E' }}>No bookings found</div>
            : paginated.map((b,i) => {
              const sc = STATUS_COLORS[b.status]       || STATUS_COLORS.COMPLETED
              const pc = PAYMENT_COLORS[b.paymentMode] || PAYMENT_COLORS.UPI
              return (
                <div key={b.id} onClick={() => navigate(`/app/bookings/${b.id}`)}
                  style={{ display:'grid', gridTemplateColumns:'0.7fr 1.5fr 1.2fr 1.2fr 0.8fr 0.7fr 0.7fr 0.7fr 0.6fr 0.8fr', padding:'10px 14px', borderBottom:'1px solid #F0EAE0', alignItems:'center', gap:'8px', background:i%2===0?'#fff':'#FDFAF6', cursor:'pointer' }}>
                  <span style={{ fontSize:'10px', color:'#9E8E6E', fontFamily:'monospace', fontWeight:600 }}>{b.id}</span>
                  <div>
                    <div style={{ fontSize:'12px', fontWeight:700, color:'#1A1A2E' }}>{b.salon}</div>
                    <div style={{ fontSize:'10px', color:'#9E8E6E' }}>{b.district}, {b.state}</div>
                  </div>
                  <span style={{ fontSize:'12px', color:'#1A1A2E', fontWeight:500 }}>{b.customer}</span>
                  <span style={{ fontSize:'12px', color:'#6B5E3E' }}>{b.service}</span>
                  <span style={{ fontSize:'13px', fontWeight:700, color:'#B8960C' }}>₹{b.amount}</span>
                  <span style={{ fontSize:'11px', color:'#6B5E3E' }}>{b.date}</span>
                  <span style={{ fontSize:'11px', color:'#9E8E6E' }}>{b.time}</span>
                  <span style={{ fontSize:'9px', fontWeight:700, background:pc.bg, color:pc.color, padding:'2px 6px', display:'inline-block' }}>{b.paymentMode}</span>
                  <span style={{ fontSize:'12px', color:b.rating?'#B8960C':'#C4B49A' }}>{b.rating ? `${b.rating}★` : '—'}</span>
                  <span style={{ fontSize:'9px', fontWeight:800, background:sc.bg, color:sc.color, padding:'2px 6px', display:'inline-block', letterSpacing:'0.3px' }}>{b.status.replace('_',' ')}</span>
                </div>
              )
            })
          }

          <div style={{ padding:'12px 14px', borderTop:'1px solid #E8DFD0', display:'flex', justifyContent:'space-between', alignItems:'center', background:'#FDFAF6' }}>
            <span style={{ fontSize:'11px', color:'#9E8E6E' }}>
              Showing {filtered.length===0?0:((page-1)*PER_PAGE)+1}–{Math.min(page*PER_PAGE,filtered.length)} of {filtered.length}
            </span>
            <div style={{ display:'flex', gap:'4px' }}>
              <button onClick={()=>setPage(p=>Math.max(1,p-1))} disabled={page===1}
                style={{ background:page===1?'#F5F0E8':'#1A1A2E', color:page===1?'#C4B49A':'#fff', border:'1px solid #D4C9B0', padding:'5px 10px', fontSize:'11px', fontWeight:700, cursor:page===1?'not-allowed':'pointer' }}>← PREV</button>
              {Array.from({length:totalPages},(_,i)=>i+1).map(p=>(
                <button key={p} onClick={()=>setPage(p)}
                  style={{ background:p===page?'#B8960C':'#fff', color:p===page?'#fff':'#6B5E3E', border:'1px solid #D4C9B0', padding:'5px 10px', fontSize:'11px', fontWeight:700, cursor:'pointer' }}>{p}</button>
              ))}
              <button onClick={()=>setPage(p=>Math.min(totalPages,p+1))} disabled={page===totalPages||totalPages===0}
                style={{ background:(page===totalPages||totalPages===0)?'#F5F0E8':'#1A1A2E', color:(page===totalPages||totalPages===0)?'#C4B49A':'#fff', border:'1px solid #D4C9B0', padding:'5px 10px', fontSize:'11px', fontWeight:700, cursor:(page===totalPages||totalPages===0)?'not-allowed':'pointer' }}>NEXT →</button>
            </div>
          </div>
        </BCard>
      </div>

      <div style={{ background:'#0D1B2A', borderTop:'2px solid #B8960C', padding:'10px 20px', display:'flex', justifyContent:'space-between', marginTop:'14px' }}>
        <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.3)' }}>ZEMISH BOOKING REGISTRY v1.0.0</span>
        <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.3)' }}>NATIONAL COMMAND CENTER</span>
      </div>
    </div>
  )
}