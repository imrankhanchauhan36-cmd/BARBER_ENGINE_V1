import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { FONTS } from '../../../config/brand'
import useAuthStore from '../../../store/authStore'
import FinanceAPI from '../api/finance.api'

const ADMIN_LEVELS = { SUPER_ADMIN:'SUPER_ADMIN', INDIA_ADMIN:'INDIA_ADMIN', STATE_ADMIN:'STATE_ADMIN', DISTRICT_ADMIN:'DISTRICT_ADMIN' }

const fmt = (v) => '₹' + ((v ?? 0)/100).toLocaleString('en-IN', { minimumFractionDigits:0, maximumFractionDigits:2 })

const STATUS_CONFIG = {
  PAID:     { label:'PAID',     bg:'#D1FAE5', color:'#065F46', border:'#059669' },
  PENDING:  { label:'PENDING',  bg:'#FEF9C3', color:'#92400E', border:'#D97706' },
  FAILED:   { label:'FAILED',   bg:'#FEE2E2', color:'#991B1B', border:'#DC2626' },
  REFUNDED: { label:'REFUNDED', bg:'#EDE9FE', color:'#5B21B6', border:'#7C3AED' },
}

const METHOD_CONFIG = {
  UPI:         { bg:'#F0FDF4', color:'#059669' },
  CARD:        { bg:'#EFF6FF', color:'#1D4ED8' },
  NET_BANKING: { bg:'#FFF7ED', color:'#C2410C' },
  WALLET:      { bg:'#FDF4FF', color:'#7C3AED' },
  CASH:        { bg:'#FFFBEB', color:'#92400E' },
  UNKNOWN:     { bg:'#F3F4F6', color:'#6B7280' },
}

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
// value can be a plain string/number OR a React element (e.g. a badge).
// The isElement branch renders it as-is, without forcing text-only styles onto it.
const DetailRow = ({ label, value, mono=false, color='#1A1A2E' }) => {
  const isElement = value != null && typeof value === 'object' && '$$typeof' in value
  return (
    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'7px 0', borderBottom:'1px solid #F0EAE0' }}>
      <span style={{ fontSize:'11px', color:'#9E8E6E', fontWeight:600 }}>{label}</span>
      {isElement ? (
        <span style={{ display:'flex', alignItems:'center' }}>{value}</span>
      ) : (
        <span style={{ fontSize:'12px', color, fontWeight:700, fontFamily:mono?'monospace':FONTS.body, textAlign:'right', maxWidth:'260px', wordBreak:'break-all' }}>{value ?? '—'}</span>
      )}
    </div>
  )
}

export default function TransactionDetailPage() {
  const { id: transactionId } = useParams()
  const navigate   = useNavigate()
  const admin      = useAuthStore(s => s.admin)
  const adminLevel = admin?.adminLevel || ADMIN_LEVELS.SUPER_ADMIN

  const [txn,       setTxn]       = useState(null)
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState(null)
  const [activeTab, setActiveTab] = useState('overview')

  const fetchTxn = useCallback(async () => {
    try {
      setLoading(true); setError(null)
      const res = await FinanceAPI.getTransaction(transactionId)
      setTxn(res.data || null)
    } catch (err) {
      setError(err.message || 'Failed to fetch transaction')
    } finally { setLoading(false) }
  }, [transactionId])

  useEffect(() => { fetchTxn() }, [fetchTxn])

  const t  = txn || {}
  const sc = STATUS_CONFIG[t.status]        || STATUS_CONFIG.PENDING
  const mc = METHOD_CONFIG[t.paymentMethod] || METHOD_CONFIG.UNKNOWN

  return (
    <div style={{ fontFamily:FONTS.body, background:'#F0EAE0', minHeight:'100vh' }}>

      {/* Header */}
      <div style={{ background:'#0D1B2A', borderBottom:'2px solid #B8960C', padding:'0 20px', height:'52px', display:'flex', alignItems:'center', justifyContent:'space-between', position:'sticky', top:0, zIndex:10 }}>
        <div style={{ display:'flex', alignItems:'center', gap:'12px' }}>
          <button onClick={() => navigate('/app/finance/transactions')}
            style={{ background:'transparent', border:'none', color:'rgba(255,255,255,0.5)', cursor:'pointer', fontSize:'18px' }}>←</button>
          <div style={{ width:'3px', height:'16px', background:'#B8960C' }}/>
          <h1 style={{ fontSize:'13px', fontWeight:800, color:'#fff', margin:0, letterSpacing:'2px', textTransform:'uppercase' }}>Transaction Detail</h1>
          {txn && (
            <span style={{ background:'rgba(184,150,12,0.2)', color:'#B8960C', fontSize:'10px', fontWeight:800, padding:'2px 8px', border:'1px solid rgba(184,150,12,0.3)', fontFamily:'monospace' }}>
              {String(t.id).slice(-8)}
            </span>
          )}
          {txn && (
            <span style={{ fontSize:'9px', fontWeight:800, background:sc.bg, color:sc.color, border:`1px solid ${sc.border}`, padding:'2px 8px' }}>{t.status}</span>
          )}
        </div>
        <div style={{ display:'flex', gap:'8px' }}>
          <button onClick={fetchTxn} style={{ background:'rgba(255,255,255,0.07)', border:'1px solid rgba(255,255,255,0.15)', color:'rgba(255,255,255,0.6)', padding:'6px 12px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>↻ REFRESH</button>
          {t.salon?.id && (
            <button onClick={() => navigate(`/app/finance/wallets/${t.salon.id}`)}
              style={{ background:'rgba(184,150,12,0.15)', border:'1px solid rgba(184,150,12,0.4)', color:'#B8960C', padding:'6px 12px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>VIEW LEDGER ▸</button>
          )}
        </div>
      </div>

      <div style={{ padding:'14px 20px' }}>

        {loading ? (
          <div style={{ padding:'60px', textAlign:'center', color:'#9E8E6E', fontSize:'13px' }}>Loading transaction...</div>
        ) : error ? (
          <div style={{ padding:'60px', textAlign:'center', color:'#DC2626', fontSize:'13px' }}>{error}</div>
        ) : !txn ? (
          <div style={{ padding:'60px', textAlign:'center', color:'#9E8E6E', fontSize:'13px' }}>Transaction not found</div>
        ) : (
          <>
            {/* Revenue Split Strip */}
            <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:'1px', background:'#D4C9B0', border:'1px solid #D4C9B0', marginBottom:'12px' }}>
              {[
                { label:'Gross Amount',   value: fmt(t.amountInPaise),       color:'#B8960C' },
                { label:'Commission',     value: fmt(t.commissionInPaise),   color:'#DC2626' },
                { label:'Salon Payout',   value: fmt(t.payoutAmountInPaise), color:'#059669' },
                { label:'Gateway Fee',    value: fmt(t.gatewayFeeInPaise),   color:'#6B5E3E' },
              ].map(m => (
                <div key={m.label} style={{ background:'#0D1B2A', padding:'12px 16px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                  <span style={{ fontSize:'11px', color:'rgba(255,255,255,0.4)' }}>{m.label}</span>
                  <span style={{ fontSize:'18px', fontWeight:800, color:m.color }}>{m.value}</span>
                </div>
              ))}
            </div>

            <BCard>
              {/* Tabs */}
              <div style={{ display:'flex', borderBottom:'1px solid #D4C9B0', background:'#FDFAF6' }}>
                {[
                  { id:'overview',   label:'Overview'   },
                  { id:'payment',    label:'Payment'    },
                  { id:'settlement', label:'Settlement' },
                  { id:'audit',      label:'Audit'      },
                ].map(tab => (
                  <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                    style={{ padding:'10px 20px', fontSize:'11px', fontWeight:700, cursor:'pointer', border:'none', borderBottom: activeTab===tab.id ? '2px solid #B8960C' : '2px solid transparent',
                      background:'transparent', color: activeTab===tab.id ? '#B8960C' : '#9E8E6E', fontFamily:FONTS.body }}>
                    {tab.label}
                  </button>
                ))}
              </div>

              <div style={{ padding:'18px 22px' }}>
                {/* Overview */}
                {activeTab === 'overview' && (
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'24px' }}>
                    <div>
                      <div style={{ fontSize:'9px', fontWeight:800, color:'#9E8E6E', letterSpacing:'1px', marginBottom:'8px' }}>SALON INFO</div>
                      <DetailRow label="Salon Name" value={t.salon?.name} />
                      <DetailRow label="Phone"      value={t.salon?.phone} />
                      <DetailRow label="Address"    value={t.salon?.address} />
                      <DetailRow label="Salon ID"   value={String(t.salon?.id || '—').slice(-12)} mono />
                    </div>
                    <div>
                      <div style={{ fontSize:'9px', fontWeight:800, color:'#9E8E6E', letterSpacing:'1px', marginBottom:'8px' }}>CUSTOMER INFO</div>
                      <DetailRow label="Name"    value={t.user?.name} />
                      <DetailRow label="Phone"   value={t.user?.phone} />
                      <DetailRow label="User ID" value={String(t.user?.id || '—').slice(-12)} mono />
                    </div>
                  </div>
                )}

                {/* Payment */}
                {activeTab === 'payment' && (
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'24px' }}>
                    <div>
                      <div style={{ fontSize:'9px', fontWeight:800, color:'#9E8E6E', letterSpacing:'1px', marginBottom:'8px' }}>GATEWAY INFO</div>
                      <DetailRow label="Provider"   value={t.provider || 'MANUAL'} />
                      <DetailRow label="Method"     value={<span style={{ background:mc.bg, color:mc.color, padding:'2px 6px', fontSize:'10px', fontWeight:800 }}>{t.paymentMethod || 'UNKNOWN'}</span>} />
                      <DetailRow label="Payment ID" value={t.paymentId || '—'} mono />
                      <DetailRow label="Order ID"   value={t.orderId   || '—'} mono />
                      <DetailRow label="Currency"   value={t.currency  || 'INR'} />
                      <DetailRow label="Source"     value={t.source    || 'APP'} />
                      {t.failureReason && <DetailRow label="Failure Reason" value={t.failureReason} color='#DC2626' />}
                    </div>
                    <div>
                      <div style={{ fontSize:'9px', fontWeight:800, color:'#9E8E6E', letterSpacing:'1px', marginBottom:'8px' }}>BOOKING INFO</div>
                      <DetailRow label="Booking ID" value={String(t.booking?.id || '—').slice(-12)} mono />
                      <DetailRow label="Type"       value={t.type} />
                      <DetailRow label="Status"     value={t.status} />
                      <DetailRow label="Created"    value={t.createdAt ? new Date(t.createdAt).toLocaleString('en-IN') : '—'} />
                      {t.booking?.id && (
                        <button onClick={() => navigate(`/app/bookings/${t.booking.id}`)}
                          style={{ marginTop:'12px', background:'#B8960C', color:'#0D1B2A', border:'none', padding:'6px 12px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>VIEW BOOKING</button>
                      )}
                    </div>
                  </div>
                )}

                {/* Settlement */}
                {activeTab === 'settlement' && (
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'24px' }}>
                    <div>
                      <div style={{ fontSize:'9px', fontWeight:800, color:'#9E8E6E', letterSpacing:'1px', marginBottom:'8px' }}>REVENUE SPLIT</div>
                      <DetailRow label="Gross Amount"         value={fmt(t.amountInPaise)}        color='#1A1A2E' />
                      <DetailRow label="Platform Commission"  value={fmt(t.commissionInPaise)}    color='#DC2626' />
                      <DetailRow label="Salon Payout"         value={fmt(t.payoutAmountInPaise)}  color='#059669' />
                      <DetailRow label="Gateway Fee"          value={fmt(t.gatewayFeeInPaise)}    color='#6B5E3E' />
                      <DetailRow label="Refund Amount"        value={fmt(t.refundAmountInPaise)}  color='#7C3AED' />
                    </div>
                    <div>
                      <div style={{ fontSize:'9px', fontWeight:800, color:'#9E8E6E', letterSpacing:'1px', marginBottom:'8px' }}>SETTLEMENT DATES</div>
                      <DetailRow label="Transaction Date" value={t.createdAt  ? new Date(t.createdAt).toLocaleString('en-IN')  : '—'} />
                      <DetailRow label="Settled At"       value={t.settledAt  ? new Date(t.settledAt).toLocaleString('en-IN')  : '—'} />
                      <DetailRow label="Refunded At"      value={t.refundedAt ? new Date(t.refundedAt).toLocaleString('en-IN') : '—'} />
                      {t.refundReason && <DetailRow label="Refund Reason" value={t.refundReason} color='#7C3AED' />}
                      <DetailRow label="Gateway Settlement ID" value={t.gatewaySettlementId || '—'} mono />
                    </div>
                  </div>
                )}

                {/* Audit */}
                {activeTab === 'audit' && (
                  <div>
                    <div style={{ fontSize:'9px', fontWeight:800, color:'#9E8E6E', letterSpacing:'1px', marginBottom:'10px' }}>AUDIT TRAIL</div>
                    {[
                      { label:'Created',  ts: t.createdAt,  done: !!t.createdAt },
                      { label:'Paid',     ts: t.createdAt,  done: t.status==='PAID' },
                      { label:'Credited', ts: t.settledAt,  done: !!t.settledAt },
                      { label:'Refunded', ts: t.refundedAt, done: t.status === 'REFUNDED' },
                    ].map(ev => (
                      <div key={ev.label} style={{ display:'flex', alignItems:'center', gap:'12px', padding:'10px 0', borderBottom:'1px solid #F0EAE0' }}>
                        <div style={{ width:'8px', height:'8px', borderRadius:'50%', background: ev.done ? '#059669' : '#D4C9B0', flexShrink:0 }}/>
                        <span style={{ fontSize:'12px', fontWeight:700, color: ev.done ? '#1A1A2E' : '#9E8E6E', minWidth:'90px' }}>{ev.label}</span>
                        <span style={{ fontSize:'11px', color:'#9E8E6E' }}>{ev.ts ? new Date(ev.ts).toLocaleString('en-IN') : 'Pending'}</span>
                      </div>
                    ))}
                    <div style={{ marginTop:'14px' }}>
                      <DetailRow label="Updated At" value={t.updatedAt ? new Date(t.updatedAt).toLocaleString('en-IN') : '—'} />
                    </div>
                  </div>
                )}

                {/* Action buttons */}
                <div style={{ display:'flex', gap:'8px', marginTop:'20px', flexWrap:'wrap', borderTop:'1px solid #F0EAE0', paddingTop:'16px' }}>
                  {t.booking?.id && (
                    <button onClick={() => navigate(`/app/bookings/${t.booking.id}`)}
                      style={{ background:'#B8960C', color:'#0D1B2A', border:'none', padding:'7px 14px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>VIEW BOOKING</button>
                  )}
                  {t.salon?.id && (
                    <button onClick={() => navigate(`/app/salons/${t.salon.id}`)}
                      style={{ background:'transparent', color:'#6B5E3E', border:'1px solid #D4C9B0', padding:'7px 14px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>VIEW SALON</button>
                  )}
                  {t.user?.id && (
                    <button onClick={() => navigate(`/app/users/${t.user.id}`)}
                      style={{ background:'transparent', color:'#6B5E3E', border:'1px solid #D4C9B0', padding:'7px 14px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>VIEW CUSTOMER</button>
                  )}
                  {t.salon?.id && (
                    <button onClick={() => navigate(`/app/finance/wallets/${t.salon.id}`)}
                      style={{ background:'transparent', color:'#6B5E3E', border:'1px solid #D4C9B0', padding:'7px 14px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>VIEW LEDGER</button>
                  )}
                </div>
              </div>
            </BCard>
          </>
        )}
      </div>

      <div style={{ background:'#0D1B2A', borderTop:'2px solid #B8960C', padding:'10px 20px', display:'flex', justifyContent:'space-between', marginTop:'14px' }}>
        <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.3)' }}>BARBER ENGINE TRANSACTION DETAIL v1.0.0</span>
        <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.3)' }}>NATIONAL COMMAND CENTER</span>
      </div>
    </div>
  )
}