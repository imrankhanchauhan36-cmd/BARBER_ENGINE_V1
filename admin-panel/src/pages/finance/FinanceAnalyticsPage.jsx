import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FONTS } from '../../config/brand'
import useAuthStore from '../../store/authStore'
import FinanceAPI from './api/finance.api'

const ADMIN_LEVELS = { SUPER_ADMIN:'SUPER_ADMIN', INDIA_ADMIN:'INDIA_ADMIN', STATE_ADMIN:'STATE_ADMIN', DISTRICT_ADMIN:'DISTRICT_ADMIN' }
const canExport    = (l) => [ADMIN_LEVELS.SUPER_ADMIN, ADMIN_LEVELS.INDIA_ADMIN, ADMIN_LEVELS.STATE_ADMIN].includes(l)

const fmt  = (v) => '₹' + ((v ?? 0)/100).toLocaleString('en-IN', { minimumFractionDigits:0, maximumFractionDigits:2 })
const fmtN = (v) => (v ?? 0).toLocaleString('en-IN')
const fmtCr = (v) => { const cr = (v ?? 0)/100/10000000; return cr >= 1 ? `₹${cr.toFixed(2)}Cr` : fmt(v) }

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

// ── Simple Bar Chart Component — now driven by real trend data ──
const SimpleBarChart = ({ data }) => {
  const max = Math.max(...data.map(d => d.volumeInPaise), 1) // avoid /0 when all months are empty
  return (
    <div style={{ display:'flex', alignItems:'flex-end', gap:'6px', height:'80px', padding:'0 4px' }}>
      {data.map((d) => (
        <div key={`${d.year}-${d.month}`} style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', gap:'3px' }}>
          <div style={{ width:'100%', display:'flex', flexDirection:'column', justifyContent:'flex-end', height:'64px', gap:'1px' }}>
            <div style={{ width:'100%', background:'#DC2626', height:`${(d.commissionInPaise/max)*64}px` }}/>
            <div style={{ width:'100%', background:'#059669', height:`${(d.settledInPaise/max)*64}px` }}/>
          </div>
          <span style={{ fontSize:'8px', color:'#9E8E6E', fontWeight:600 }}>{d.month}</span>
        </div>
      ))}
    </div>
  )
}

export default function FinanceAnalyticsPage() {
  const navigate   = useNavigate()
  const admin      = useAuthStore(s => s.admin)
  const adminLevel = admin?.adminLevel || ADMIN_LEVELS.SUPER_ADMIN
  const hasExport  = canExport(adminLevel)

  const scope = adminLevel === ADMIN_LEVELS.STATE_ADMIN    ? 'YOUR STATE'
              : adminLevel === ADMIN_LEVELS.DISTRICT_ADMIN ? 'YOUR DISTRICT'
              : 'PAN INDIA'

  const [summary,  setSummary]  = useState(null)
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState(null)
  const [lastSync, setLastSync] = useState(null)
  const [toast,    setToast]    = useState(null)
  const [activeTab,setActiveTab]= useState('overview')

  // ── Real analytics tab data (lazy-loaded per tab, cached once fetched) ──
  const [trendData,   setTrendData]   = useState(null)
  const [trendLoading,setTrendLoading]= useState(false)
  const [trendError,  setTrendError]  = useState(null)

  const [stateData,   setStateData]   = useState(null)
  const [stateLoading,setStateLoading]= useState(false)
  const [stateError,  setStateError]  = useState(null)

  const [salonData,   setSalonData]   = useState(null)
  const [salonLoading,setSalonLoading]= useState(false)
  const [salonError,  setSalonError]  = useState(null)

  const showToast = (msg, color='#059669') => {
    setToast({ msg, color })
    setTimeout(() => setToast(null), 3000)
  }

  const fetchSummary = useCallback(async () => {
    try {
      setLoading(true); setError(null)
      const res = await FinanceAPI.getSummary()
      setSummary(res.data)
      setLastSync(new Date())
    } catch (err) {
      setError(err.message || 'Failed to fetch analytics')
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { fetchSummary() }, [fetchSummary])

  // ── Lazy-fetch each tab's real data only when first opened ──
  const fetchTrend = useCallback(async () => {
    if (trendData) return // already loaded, avoid refetching on every tab click
    try {
      setTrendLoading(true); setTrendError(null)
      const res = await FinanceAPI.getRevenueTrend({ months: 6 })
      setTrendData(res.data || [])
    } catch (err) {
      setTrendError(err.message || 'Failed to fetch revenue trend')
    } finally { setTrendLoading(false) }
  }, [trendData])

  const fetchStates = useCallback(async () => {
    if (stateData) return
    try {
      setStateLoading(true); setStateError(null)
      const res = await FinanceAPI.getStatePerformance()
      setStateData(res.data || [])
    } catch (err) {
      setStateError(err.message || 'Failed to fetch state performance')
    } finally { setStateLoading(false) }
  }, [stateData])

  const fetchSalons = useCallback(async () => {
    if (salonData) return
    try {
      setSalonLoading(true); setSalonError(null)
      const res = await FinanceAPI.getTopSalons({ limit: 10 })
      setSalonData(res.data || [])
    } catch (err) {
      setSalonError(err.message || 'Failed to fetch top salons')
    } finally { setSalonLoading(false) }
  }, [salonData])

  const handleTabClick = (tabId) => {
    setActiveTab(tabId)
    if (tabId === 'revenue') fetchTrend()
    if (tabId === 'states')  fetchStates()
    if (tabId === 'salons')  fetchSalons()
  }

  const handleRefreshAll = () => {
    fetchSummary()
    setTrendData(null); setStateData(null); setSalonData(null)
    if (activeTab === 'revenue') fetchTrend()
    if (activeTab === 'states')  fetchStates()
    if (activeTab === 'salons')  fetchSalons()
  }

  // ── Derived values ──────────────────────────────────
  const txn     = summary?.transactions || {}
  const wallets = summary?.wallets      || {}
  const payouts = summary?.payouts      || {}

  const totalRevenue    = txn.totalRevenueInPaise    ?? 0
  const commission      = txn.totalCommissionInPaise ?? 0
  const salonEarnings   = totalRevenue - commission
  const avgBooking      = txn.avgBookingValueInPaise ?? 0
  const successRate     = txn.successRate            ?? 0
  const totalBookings   = txn.totalBookings          ?? 0
  const paidBookings    = txn.paidBookings           ?? 0
  const failedBookings  = totalBookings - paidBookings
  const commissionRate  = totalRevenue > 0 ? Math.round((commission / totalRevenue) * 100) : 10

  const totalAvailable  = wallets.totalAvailableInPaise   ?? 0
  const totalPending    = wallets.totalPendingInPaise     ?? 0
  const totalLocked     = wallets.totalLockedInPaise      ?? 0
  const totalProcessing = wallets.totalProcessingInPaise  ?? 0
  const lifetimeEarned  = wallets.lifetimeEarningsInPaise ?? 0
  const lifetimePayout  = wallets.lifetimePayoutsInPaise  ?? 0
  const walletCount     = wallets.count                   ?? 0

  const totalPaid       = payouts.totalPaidInPaise      ?? 0
  const totalRequested  = payouts.totalRequestedInPaise ?? 0
  const pendingPayouts  = payouts.pendingCount           ?? 0
  const paidPayouts     = payouts.paidCount              ?? 0

  const revTotal = totalRevenue || 1
  const commPct  = Math.round((commission    / revTotal) * 100)
  const salonPct = Math.round((salonEarnings / revTotal) * 100)

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
          <div style={{ width:'3px', height:'16px', background:'#B8960C' }}/>
          <h1 style={{ fontSize:'13px', fontWeight:800, color:'#fff', margin:0, letterSpacing:'2px', textTransform:'uppercase' }}>Finance Analytics</h1>
          <span style={{ background:'rgba(184,150,12,0.15)', color:'#B8960C', fontSize:'10px', fontWeight:800, padding:'2px 8px', border:'1px solid rgba(184,150,12,0.3)' }}>NATIONAL COMMAND CENTER</span>
          <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.35)' }}>|</span>
          <span style={{ fontSize:'10px', color:'#B8960C', fontWeight:600 }}>Viewing: {scope}</span>
          {lastSync && <span style={{ fontSize:'9px', color:'rgba(255,255,255,0.3)' }}>Last sync: {lastSync.toLocaleTimeString('en-IN')}</span>}
        </div>
        <div style={{ display:'flex', gap:'8px' }}>
          <button onClick={() => navigate('/app/finance/transactions')} style={{ background:'rgba(255,255,255,0.07)', border:'1px solid rgba(255,255,255,0.15)', color:'rgba(255,255,255,0.5)', padding:'6px 12px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>TRANSACTIONS ▸</button>
          <button onClick={() => navigate('/app/finance/wallets')}      style={{ background:'rgba(255,255,255,0.07)', border:'1px solid rgba(255,255,255,0.15)', color:'rgba(255,255,255,0.5)', padding:'6px 12px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>WALLETS ▸</button>
          <button onClick={() => navigate('/app/finance/payouts')}      style={{ background:'rgba(255,255,255,0.07)', border:'1px solid rgba(255,255,255,0.15)', color:'rgba(255,255,255,0.5)', padding:'6px 12px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>PAYOUTS ▸</button>
          <button onClick={handleRefreshAll} style={{ background:'rgba(255,255,255,0.07)', border:'1px solid rgba(255,255,255,0.15)', color:'rgba(255,255,255,0.6)', padding:'6px 12px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>↻ REFRESH</button>
          {hasExport && <button onClick={() => showToast('Export triggered', '#1D4ED8')} style={{ background:'rgba(184,150,12,0.15)', border:'1px solid rgba(184,150,12,0.4)', color:'#B8960C', padding:'6px 12px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>↓ EXPORT</button>}
        </div>
      </div>

      <div style={{ padding:'14px 20px' }}>
        {loading ? (
          <div style={{ padding:'60px', textAlign:'center', color:'#9E8E6E', fontSize:'14px' }}>Loading analytics...</div>
        ) : error ? (
          <div style={{ padding:'60px', textAlign:'center', color:'#DC2626', fontSize:'14px' }}>{error}</div>
        ) : (
          <>
            {/* ── KPI Strip ── */}
            <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:'1px', background:'#D4C9B0', border:'1px solid #D4C9B0', marginBottom:'12px' }}>
              {[
                { label:'Total Volume',       value: fmt(totalRevenue), color:'#B8960C' },
                { label:'Platform Commission',value: fmt(commission),   color:'#DC2626' },
                { label:'Settled to Salons',  value: fmt(salonEarnings),color:'#059669' },
                { label:'Success Rate',       value: `${successRate}%`, color:'#2563EB' },
              ].map(m => (
                <div key={m.label} style={{ background:'#0D1B2A', padding:'14px 18px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                  <span style={{ fontSize:'11px', color:'rgba(255,255,255,0.4)' }}>{m.label}</span>
                  <span style={{ fontSize:'20px', fontWeight:800, color:m.color }}>{m.value}</span>
                </div>
              ))}
            </div>

            {/* ── Tabs ── */}
            <div style={{ display:'flex', gap:'0', marginBottom:'12px', background:'#fff', border:'1px solid #D4C9B0', borderTop:'2px solid #B8960C' }}>
              {[
                { id:'overview',  label:'Overview'         },
                { id:'revenue',   label:'Revenue Trend'    },
                { id:'states',    label:'State Performance'},
                { id:'salons',    label:'Top Salons'       },
              ].map(tab => (
                <button key={tab.id} onClick={() => handleTabClick(tab.id)}
                  style={{ padding:'10px 20px', fontSize:'12px', fontWeight:700, cursor:'pointer', border:'none',
                    borderBottom: activeTab===tab.id ? '2px solid #B8960C' : '2px solid transparent',
                    background:'transparent', color: activeTab===tab.id ? '#B8960C' : '#9E8E6E',
                    fontFamily:FONTS.body }}>
                  {tab.label}
                </button>
              ))}
            </div>

            {/* ── Overview Tab ── */}
            {activeTab === 'overview' && (
              <>
                {/* Revenue Split Bar */}
                <BCard style={{ marginBottom:'12px', padding:'16px 20px' }}>
                  <div style={{ display:'flex', alignItems:'center', gap:'8px', marginBottom:'12px' }}>
                    <div style={{ width:'3px', height:'14px', background:'#B8960C' }}/>
                    <span style={{ fontSize:'11px', fontWeight:800, color:'#9E8E6E', letterSpacing:'1px', textTransform:'uppercase' }}>Revenue Split — Commission Rate: {commissionRate}%</span>
                  </div>
                  <div style={{ display:'flex', height:'28px', overflow:'hidden', marginBottom:'10px', border:'1px solid #E8DFD0' }}>
                    <div style={{ width:`${commPct}%`, background:'#DC2626', display:'flex', alignItems:'center', justifyContent:'center' }}>
                      {commPct > 5 && <span style={{ fontSize:'10px', color:'#fff', fontWeight:800 }}>Platform {commPct}%</span>}
                    </div>
                    <div style={{ width:`${salonPct}%`, background:'#059669', display:'flex', alignItems:'center', justifyContent:'center' }}>
                      {salonPct > 5 && <span style={{ fontSize:'10px', color:'#fff', fontWeight:800 }}>Salons {salonPct}%</span>}
                    </div>
                  </div>
                  <div style={{ display:'flex', gap:'24px' }}>
                    {[
                      { label:'Gross Revenue',       value: fmt(totalRevenue),  color:'#1A1A2E' },
                      { label:'Platform Commission', value: fmt(commission),    color:'#DC2626' },
                      { label:'Settled to Salons',   value: fmt(salonEarnings), color:'#059669' },
                    ].map(m => (
                      <div key={m.label} style={{ display:'flex', alignItems:'center', gap:'8px' }}>
                        <div style={{ width:'10px', height:'10px', background:m.color, flexShrink:0 }}/>
                        <span style={{ fontSize:'11px', color:'#6B5E3E' }}>{m.label}: <strong style={{ color:m.color }}>{m.value}</strong></span>
                      </div>
                    ))}
                  </div>
                </BCard>

                {/* 3 Column Grid */}
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:'12px', marginBottom:'12px' }}>
                  <BCard>
                    <BCardHeader title="Transactions" />
                    <div style={{ padding:'12px 14px' }}>
                      {[
                        { label:'Total Bookings',   value: fmtN(totalBookings),  color:'#1A1A2E' },
                        { label:'Paid',             value: fmtN(paidBookings),   color:'#059669' },
                        { label:'Failed',           value: fmtN(failedBookings), color:'#DC2626' },
                        { label:'Avg Ticket Size',  value: fmt(avgBooking),      color:'#B8960C' },
                        { label:'Success Rate',     value: `${successRate}%`,    color:'#2563EB' },
                        { label:'Commission Rate',  value: `${commissionRate}%`, color:'#7C3AED' },
                      ].map(m => (
                        <div key={m.label} style={{ display:'flex', justifyContent:'space-between', padding:'7px 0', borderBottom:'1px solid #F0EAE0' }}>
                          <span style={{ fontSize:'11px', color:'#9E8E6E', fontWeight:600 }}>{m.label}</span>
                          <span style={{ fontSize:'13px', color:m.color, fontWeight:800 }}>{m.value}</span>
                        </div>
                      ))}
                    </div>
                    <div style={{ padding:'0 14px 14px' }}>
                      <button onClick={() => navigate('/app/finance/transactions')}
                        style={{ width:'100%', background:'#1A1A2E', color:'#fff', border:'none', padding:'8px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>
                        VIEW ALL TRANSACTIONS →
                      </button>
                    </div>
                  </BCard>

                  <BCard>
                    <BCardHeader title="Wallets" />
                    <div style={{ padding:'12px 14px' }}>
                      {[
                        { label:'Total Wallets',     value: fmtN(walletCount),    color:'#1A1A2E' },
                        { label:'Available Balance', value: fmt(totalAvailable),  color:'#059669' },
                        { label:'Pending Balance',   value: fmt(totalPending),    color:'#D97706' },
                        { label:'Locked Balance',    value: fmt(totalLocked),     color:'#DC2626' },
                        { label:'Processing',        value: fmt(totalProcessing), color:'#7C3AED' },
                        { label:'Lifetime Earned',   value: fmt(lifetimeEarned),  color:'#B8960C' },
                        { label:'Lifetime Payouts',  value: fmt(lifetimePayout),  color:'#6B5E3E' },
                      ].map(m => (
                        <div key={m.label} style={{ display:'flex', justifyContent:'space-between', padding:'7px 0', borderBottom:'1px solid #F0EAE0' }}>
                          <span style={{ fontSize:'11px', color:'#9E8E6E', fontWeight:600 }}>{m.label}</span>
                          <span style={{ fontSize:'13px', color:m.color, fontWeight:800 }}>{m.value}</span>
                        </div>
                      ))}
                    </div>
                    <div style={{ padding:'0 14px 14px' }}>
                      <button onClick={() => navigate('/app/finance/wallets')}
                        style={{ width:'100%', background:'#1A1A2E', color:'#fff', border:'none', padding:'8px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>
                        VIEW ALL WALLETS →
                      </button>
                    </div>
                  </BCard>

                  <BCard>
                    <BCardHeader title="Payouts" />
                    <div style={{ padding:'12px 14px' }}>
                      {[
                        { label:'Total Paid',         value: fmt(totalPaid),      color:'#059669' },
                        { label:'Pending Amount',     value: fmt(totalRequested), color:'#D97706' },
                        { label:'Pending Requests',   value: fmtN(pendingPayouts),color:'#D97706' },
                        { label:'Completed Payouts',  value: fmtN(paidPayouts),   color:'#059669' },
                        { label:'Rejected',           value: fmtN(payouts.rejectedCount ?? 0), color:'#DC2626' },
                        { label:'Failed',             value: fmtN(payouts.failedCount    ?? 0), color:'#991B1B' },
                      ].map(m => (
                        <div key={m.label} style={{ display:'flex', justifyContent:'space-between', padding:'7px 0', borderBottom:'1px solid #F0EAE0' }}>
                          <span style={{ fontSize:'11px', color:'#9E8E6E', fontWeight:600 }}>{m.label}</span>
                          <span style={{ fontSize:'13px', color:m.color, fontWeight:800 }}>{m.value}</span>
                        </div>
                      ))}
                    </div>
                    <div style={{ padding:'0 14px 14px' }}>
                      <button onClick={() => navigate('/app/finance/payouts')}
                        style={{ width:'100%', background:'#1A1A2E', color:'#fff', border:'none', padding:'8px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>
                        VIEW ALL PAYOUTS →
                      </button>
                    </div>
                  </BCard>
                </div>

                {/* Financial Health */}
                <BCard>
                  <BCardHeader title="Financial Health Dashboard" />
                  <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)' }}>
                    {[
                      { label:'Gross Revenue',     value: fmt(totalRevenue),   sub:`${fmtN(totalBookings)} bookings`,   color:'#B8960C', bg:'#FFFBEB' },
                      { label:'Platform Earnings', value: fmt(commission),     sub:`${commissionRate}% commission`,     color:'#DC2626', bg:'#FEF2F2' },
                      { label:'Salon Earnings',    value: fmt(salonEarnings),  sub:`${100-commissionRate}% to salons`,  color:'#059669', bg:'#F0FDF4' },
                      { label:'Wallet Pool',       value: fmt(totalAvailable), sub:`${walletCount} active wallets`,     color:'#2563EB', bg:'#EFF6FF' },
                    ].map((m, i) => (
                      <div key={m.label} style={{ background:m.bg, padding:'16px 20px', borderRight: i<3 ? '1px solid #E8DFD0' : 'none' }}>
                        <div style={{ fontSize:'11px', color:'#9E8E6E', fontWeight:600, marginBottom:'6px' }}>{m.label}</div>
                        <div style={{ fontSize:'22px', fontWeight:800, color:m.color, marginBottom:'4px' }}>{m.value}</div>
                        <div style={{ fontSize:'10px', color:'#9E8E6E' }}>{m.sub}</div>
                      </div>
                    ))}
                  </div>
                </BCard>
              </>
            )}

            {/* ── Revenue Trend Tab — REAL DATA ── */}
            {activeTab === 'revenue' && (
              <BCard style={{ padding:'20px' }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'16px' }}>
                  <div>
                    <div style={{ fontSize:'12px', fontWeight:800, color:'#1A1A2E', marginBottom:'4px' }}>Monthly Revenue Trend</div>
                    <div style={{ fontSize:'10px', color:'#9E8E6E' }}>Last 6 months, grouped by paid transaction date</div>
                  </div>
                  <div style={{ display:'flex', gap:'12px' }}>
                    {[
                      { label:'Commission', color:'#DC2626' },
                      { label:'Settled',    color:'#059669' },
                    ].map(m => (
                      <div key={m.label} style={{ display:'flex', alignItems:'center', gap:'5px' }}>
                        <div style={{ width:'10px', height:'10px', background:m.color }}/>
                        <span style={{ fontSize:'10px', color:'#6B5E3E' }}>{m.label}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {trendLoading ? (
                  <div style={{ padding:'40px', textAlign:'center', color:'#9E8E6E', fontSize:'13px' }}>Loading revenue trend...</div>
                ) : trendError ? (
                  <div style={{ padding:'40px', textAlign:'center', color:'#DC2626', fontSize:'13px' }}>{trendError}</div>
                ) : !trendData || trendData.length === 0 ? (
                  <div style={{ padding:'40px', textAlign:'center', color:'#9E8E6E', fontSize:'13px' }}>No transaction data in this period</div>
                ) : (
                  <>
                    <SimpleBarChart data={trendData} />
                    <div style={{ display:`grid`, gridTemplateColumns:`repeat(${trendData.length},1fr)`, gap:'8px', marginTop:'16px' }}>
                      {trendData.map(d => (
                        <div key={`${d.year}-${d.month}`} style={{ background:'#F5F0E8', padding:'10px', textAlign:'center', border:'1px solid #E8DFD0' }}>
                          <div style={{ fontSize:'10px', fontWeight:800, color:'#1A1A2E', marginBottom:'4px' }}>{d.month}</div>
                          <div style={{ fontSize:'11px', color:'#B8960C', fontWeight:700 }}>{fmtCr(d.volumeInPaise)}</div>
                          <div style={{ fontSize:'9px', color:'#059669' }}>Net: {fmtCr(d.settledInPaise)}</div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </BCard>
            )}

            {/* ── State Performance Tab — REAL DATA ── */}
            {activeTab === 'states' && (
              <BCard>
                <BCardHeader title="State Performance" />
                {stateLoading ? (
                  <div style={{ padding:'40px', textAlign:'center', color:'#9E8E6E', fontSize:'13px' }}>Loading state performance...</div>
                ) : stateError ? (
                  <div style={{ padding:'40px', textAlign:'center', color:'#DC2626', fontSize:'13px' }}>{stateError}</div>
                ) : !stateData || stateData.length === 0 ? (
                  <div style={{ padding:'40px', textAlign:'center', color:'#9E8E6E', fontSize:'13px' }}>No transaction data yet</div>
                ) : (
                  <div style={{ padding:'0 14px' }}>
                    <div style={{ display:'grid', gridTemplateColumns:'0.3fr 1.5fr 1fr 1fr 0.8fr', padding:'8px 0', background:'#F5F0E8', borderBottom:'1px solid #E8DFD0', marginTop:'1px' }}>
                      {['RANK','STATE','VOLUME','SALONS','SUCCESS'].map(h => (
                        <span key={h} style={{ fontSize:'9px', fontWeight:800, color:'#9E8E6E', letterSpacing:'1px' }}>{h}</span>
                      ))}
                    </div>
                    {stateData.map((s, i) => (
                      <div key={s.stateId || s.state} style={{ display:'grid', gridTemplateColumns:'0.3fr 1.5fr 1fr 1fr 0.8fr', padding:'12px 0', borderBottom:'1px solid #F0EAE0', alignItems:'center', background: i%2===0?'#fff':'#FDFAF6' }}>
                        <span style={{ fontSize:'14px', fontWeight:800, color:'#B8960C' }}>#{i + 1}</span>
                        <span style={{ fontSize:'12px', fontWeight:700, color:'#1A1A2E' }}>{s.state}</span>
                        <span style={{ fontSize:'12px', fontWeight:700, color:'#059669' }}>{fmtCr(s.volumeInPaise)}</span>
                        <span style={{ fontSize:'12px', color:'#6B5E3E' }}>{fmtN(s.salons)} salons</span>
                        <span style={{ fontSize:'11px', fontWeight:700, color:s.successRate>99?'#059669':'#D97706' }}>{s.successRate}%</span>
                      </div>
                    ))}
                  </div>
                )}
              </BCard>
            )}

            {/* ── Top Salons Tab — REAL DATA ── */}
            {activeTab === 'salons' && (
              <BCard>
                <BCardHeader title="Top Performing Salons" />
                {salonLoading ? (
                  <div style={{ padding:'40px', textAlign:'center', color:'#9E8E6E', fontSize:'13px' }}>Loading top salons...</div>
                ) : salonError ? (
                  <div style={{ padding:'40px', textAlign:'center', color:'#DC2626', fontSize:'13px' }}>{salonError}</div>
                ) : !salonData || salonData.length === 0 ? (
                  <div style={{ padding:'40px', textAlign:'center', color:'#9E8E6E', fontSize:'13px' }}>No paid transactions yet</div>
                ) : (
                  <div style={{ padding:'0 14px' }}>
                    <div style={{ display:'grid', gridTemplateColumns:'0.3fr 1.8fr 1fr 1fr 0.8fr', padding:'8px 0', background:'#F5F0E8', borderBottom:'1px solid #E8DFD0', marginTop:'1px' }}>
                      {['RANK','SALON','CITY','REVENUE','BOOKINGS'].map(h => (
                        <span key={h} style={{ fontSize:'9px', fontWeight:800, color:'#9E8E6E', letterSpacing:'1px' }}>{h}</span>
                      ))}
                    </div>
                    {salonData.map((s, i) => (
                      <div key={s.salonId} style={{ display:'grid', gridTemplateColumns:'0.3fr 1.8fr 1fr 1fr 0.8fr', padding:'14px 0', borderBottom:'1px solid #F0EAE0', alignItems:'center', background: i%2===0?'#fff':'#FDFAF6' }}>
                        <div style={{ width:'24px', height:'24px', background: i===0?'#B8960C':i===1?'#9E8E6E':i===2?'#CD7F32':'#E8DFD0', display:'flex', alignItems:'center', justifyContent:'center' }}>
                          <span style={{ fontSize:'11px', fontWeight:800, color: i<3?'#fff':'#6B5E3E' }}>#{s.rank}</span>
                        </div>
                        <span style={{ fontSize:'12px', fontWeight:700, color:'#1A1A2E' }}>{s.name}</span>
                        <span style={{ fontSize:'11px', color:'#6B5E3E' }}>{s.city || '—'}</span>
                        <span style={{ fontSize:'12px', fontWeight:700, color:'#059669' }}>{fmtCr(s.revenueInPaise)}</span>
                        <span style={{ fontSize:'11px', color:'#B8960C', fontWeight:600 }}>{fmtN(s.bookings)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </BCard>
            )}
          </>
        )}
      </div>

      <div style={{ background:'#0D1B2A', borderTop:'2px solid #B8960C', padding:'10px 20px', display:'flex', justifyContent:'space-between', marginTop:'14px' }}>
        <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.3)' }}>BARBER ENGINE FINANCE ANALYTICS v1.0.0</span>
        <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.3)' }}>NATIONAL COMMAND CENTER</span>
      </div>
    </div>
  )
}