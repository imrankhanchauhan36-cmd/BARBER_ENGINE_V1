import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { canExport } from '../../../config/adminRoles'
import { FONTS } from '../../../config/brand'
import useAuthStore from '../../../store/authStore'
import FinanceAPI from '../api/finance.api'

const fmt  = (v) => '₹' + ((v ?? 0)/100).toLocaleString('en-IN', { minimumFractionDigits:0, maximumFractionDigits:2 })

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

const STATUSES  = ['ALL','PAID','PENDING','FAILED','REFUNDED']
const METHODS   = ['ALL','UPI','CARD','NET_BANKING','WALLET','CASH','UNKNOWN']
const PROVIDERS = ['ALL','MANUAL','RAZORPAY','CASHFREE','STRIPE']
const DATES     = ['All Time','Today','Last 7 Days','Last 30 Days','Custom']
const PER_PAGE  = 20

function getPaginationRange(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const pages = new Set([1, 2, total-1, total, current-1, current, current+1])
  const valid = [...pages].filter(p => p >= 1 && p <= total).sort((a,b) => a-b)
  const result = []
  let prev = null
  for (const p of valid) {
    if (prev !== null && p - prev > 1) result.push('...')
    result.push(p)
    prev = p
  }
  return result
}

// CSV export helper — escapes commas/quotes/newlines safely
function downloadCsv(rows, filename) {
  if (!rows.length) return
  const headers = ['TXN ID','Salon','Customer','Phone','Amount','Commission','Payout','Method','Provider','Status','Date']
  const escape = (v) => {
    const s = String(v ?? '')
    return /[",\n]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s
  }
  const lines = [headers.join(',')]
  rows.forEach(t => {
    lines.push([
      t.id,
      t.salon?.name || '',
      t.user?.name || '',
      t.user?.phone || '',
      ((t.amountInPaise ?? 0)/100).toFixed(2),
      ((t.commissionInPaise ?? 0)/100).toFixed(2),
      ((t.payoutAmountInPaise ?? 0)/100).toFixed(2),
      t.paymentMethod || 'UNKNOWN',
      t.provider || 'MANUAL',
      t.status,
      t.createdAt ? new Date(t.createdAt).toLocaleString('en-IN') : '',
    ].map(escape).join(','))
  })
  const blob = new Blob([lines.join('\n')], { type:'text/csv;charset=utf-8;' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href = url; a.download = filename
  document.body.appendChild(a); a.click(); document.body.removeChild(a)
  URL.revokeObjectURL(url)
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

const DetailRow = ({ label, value, mono=false, color='#1A1A2E' }) => (
  <div style={{ display:'flex', justifyContent:'space-between', padding:'6px 0', borderBottom:'1px solid #F0EAE0' }}>
    <span style={{ fontSize:'10px', color:'#9E8E6E', fontWeight:600 }}>{label}</span>
    <span style={{ fontSize:'11px', color, fontWeight:700, fontFamily:mono?'monospace':FONTS.body, textAlign:'right', maxWidth:'200px', wordBreak:'break-all' }}>{value ?? '—'}</span>
  </div>
)

export default function TransactionsPage() {
  const navigate   = useNavigate()
  const admin      = useAuthStore(s => s.admin)
  const adminLevel = admin?.adminLevel || 'DISTRICT'
  const hasExport  = canExport(adminLevel)

  const scope = adminLevel === 'STATE'    ? 'YOUR STATE'
              : adminLevel === 'DISTRICT' ? 'YOUR DISTRICT'
              : 'PAN INDIA'

  // ── State ─────────────────────────────────────────────
  const [txns,      setTxns]      = useState([])
  const [summary,   setSummary]   = useState(null)
  const [statusCounts, setStatusCounts] = useState({ PENDING:0, FAILED:0, REFUNDED:0 })
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState(null)
  const [total,     setTotal]     = useState(0)
  const [page,      setPage]      = useState(1)
  const [search,    setSearch]    = useState('')
  const [status,    setStatus]    = useState('ALL')
  const [method,    setMethod]    = useState('ALL')
  const [provider,  setProvider]  = useState('ALL')
  const [dateF,     setDateF]     = useState('All Time')
  const [fromDate,  setFromDate]  = useState('')
  const [toDate,    setToDate]    = useState('')
  const [expanded,  setExpanded]  = useState(null)
  const [activeTab, setActiveTab] = useState('overview')
  const [lastSync,  setLastSync]  = useState(null)
  const [toast,     setToast]     = useState(null)

  // Lazy-loaded detail cache: { [id]: { loading, data, error } }
  const [detailCache, setDetailCache] = useState({})

  const showToast = (msg, color='#059669') => {
    setToast({ msg, color })
    setTimeout(() => setToast(null), 3000)
  }

  // ── Date helpers ──────────────────────────────────────
  const today  = new Date().toISOString().split('T')[0]
  const last7  = new Date(Date.now()-7*86400000).toISOString().split('T')[0]
  const last30 = new Date(Date.now()-30*86400000).toISOString().split('T')[0]

  const getDateParams = () => {
    if (dateF === 'Today')        return { from: today,    to: today  }
    if (dateF === 'Last 7 Days')  return { from: last7,    to: today  }
    if (dateF === 'Last 30 Days') return { from: last30,   to: today  }
    if (dateF === 'Custom')       return { from: fromDate, to: toDate }
    return {}
  }

  // ── Fetch: transaction list ───────────────────────────
  const fetchTxns = useCallback(async () => {
    try {
      setLoading(true); setError(null)
      const params = { page, limit: PER_PAGE }
      if (status !== 'ALL')   params.status   = status
      if (provider !== 'ALL') params.provider = provider
      const dp = getDateParams()
      if (dp.from) params.from = dp.from
      if (dp.to)   params.to   = dp.to
      const res = await FinanceAPI.getTransactions(params)
      setTxns(res.data || [])
      setTotal(res.pagination?.total || 0)
      setLastSync(new Date())
    } catch (err) {
      setError(err.message || 'Failed to fetch transactions')
    } finally { setLoading(false) }
  }, [page, status, provider, dateF, fromDate, toDate])

  // ── Fetch: finance summary (for revenue/commission/avg/success-rate KPIs) ──
  const fetchSummary = useCallback(async () => {
    try {
      const res = await FinanceAPI.getSummary()
      setSummary(res.data)
    } catch {}
  }, [])

  // ── Fetch: exact status counts (PENDING / FAILED / REFUNDED) ──────
  // Summary API doesn't expose a per-status breakdown, so we ask the
  // transactions list endpoint for each status with limit=1 and read
  // pagination.total — cheap, accurate, no field-name guessing.
  const fetchStatusCounts = useCallback(async () => {
    try {
      const [pending, failed, refunded] = await Promise.all([
        FinanceAPI.getTransactions({ status:'PENDING',  limit:1 }),
        FinanceAPI.getTransactions({ status:'FAILED',   limit:1 }),
        FinanceAPI.getTransactions({ status:'REFUNDED', limit:1 }),
      ])
      setStatusCounts({
        PENDING:  pending.pagination?.total  || 0,
        FAILED:   failed.pagination?.total   || 0,
        REFUNDED: refunded.pagination?.total || 0,
      })
    } catch {
      // fail silently — cards fall back to 0 rather than breaking the page
    }
  }, [])

  useEffect(() => { fetchTxns()         }, [fetchTxns])
  useEffect(() => { fetchSummary()      }, [fetchSummary])
  useEffect(() => { fetchStatusCounts() }, [fetchStatusCounts])

  // ── Lazy-fetch full detail when a row is expanded ─────
  const handleExpand = async (t) => {
    const isExpanded = expanded === t.id
    if (isExpanded) { setExpanded(null); return }
    setExpanded(t.id)
    setActiveTab('overview')

    if (detailCache[t.id]?.data || detailCache[t.id]?.loading) return // already fetched/fetching

    setDetailCache(prev => ({ ...prev, [t.id]: { loading:true, data:null, error:null } }))
    try {
      const res = await FinanceAPI.getTransaction(t.id)
      setDetailCache(prev => ({ ...prev, [t.id]: { loading:false, data: res.data, error:null } }))
    } catch (err) {
      setDetailCache(prev => ({ ...prev, [t.id]: { loading:false, data:null, error: err.message || 'Failed to load detail' } }))
    }
  }

  // ── Client-side search + method filter (within current page) ──
  const filtered = txns.filter(t => {
    const matchSearch = !search ||
      String(t.id).toLowerCase().includes(search.toLowerCase()) ||
      (t.salon?.name  || '').toLowerCase().includes(search.toLowerCase()) ||
      (t.user?.name   || '').toLowerCase().includes(search.toLowerCase()) ||
      (t.user?.phone  || '').includes(search) ||
      (t.paymentId    || '').toLowerCase().includes(search.toLowerCase()) ||
      (t.orderId      || '').toLowerCase().includes(search.toLowerCase())
    const matchMethod = method === 'ALL' || t.paymentMethod === method
    return matchSearch && matchMethod
  })

  const totalPages      = Math.ceil(total / PER_PAGE)
  const paginationRange = getPaginationRange(page, totalPages || 1)

  // ── KPI ───────────────────────────────────────────────
  const kpi = summary?.transactions || {}

  const handleExportClick = () => {
    if (!filtered.length) { showToast('No rows to export', '#DC2626'); return }
    const stamp = new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')
    downloadCsv(filtered, `transactions-current-view-${stamp}.csv`)
    showToast(`Exported ${filtered.length} rows (current view)`, '#1D4ED8')
  }

  return (
    <div style={{ fontFamily:FONTS.body, background:'#F0EAE0', minHeight:'100vh' }}>

      {toast && (
        <div style={{ position:'fixed', top:'20px', right:'20px', background:toast.color, color:'#fff', padding:'12px 20px', fontSize:'13px', fontWeight:700, zIndex:9999, boxShadow:'0 4px 12px rgba(0,0,0,0.2)' }}>
          {toast.msg}
        </div>
      )}

      {/* ── Header ── */}
      <div style={{ background:'#0D1B2A', borderBottom:'2px solid #B8960C', padding:'0 20px', height:'52px', display:'flex', alignItems:'center', justifyContent:'space-between', position:'sticky', top:0, zIndex:10 }}>
        <div style={{ display:'flex', alignItems:'center', gap:'12px' }}>
          <div style={{ width:'3px', height:'16px', background:'#B8960C' }}/>
          <h1 style={{ fontSize:'13px', fontWeight:800, color:'#fff', margin:0, letterSpacing:'2px', textTransform:'uppercase' }}>Transactions</h1>
          <span style={{ background:'rgba(184,150,12,0.2)', color:'#B8960C', fontSize:'10px', fontWeight:800, padding:'2px 8px', border:'1px solid rgba(184,150,12,0.3)' }}>{total} TOTAL</span>
          <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.35)' }}>|</span>
          <span style={{ fontSize:'10px', color:'#B8960C', fontWeight:600 }}>Viewing: {scope}</span>
          {lastSync && <span style={{ fontSize:'9px', color:'rgba(255,255,255,0.3)' }}>Last sync: {lastSync.toLocaleTimeString('en-IN')}</span>}
        </div>
        <div style={{ display:'flex', gap:'8px' }}>
          <button onClick={() => navigate('/app/finance/wallets')} style={{ background:'rgba(255,255,255,0.07)', border:'1px solid rgba(255,255,255,0.15)', color:'rgba(255,255,255,0.5)', padding:'6px 12px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>WALLETS ▸</button>
          <button onClick={() => navigate('/app/finance/payouts')} style={{ background:'rgba(255,255,255,0.07)', border:'1px solid rgba(255,255,255,0.15)', color:'rgba(255,255,255,0.5)', padding:'6px 12px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>PAYOUTS ▸</button>
          <button onClick={() => { fetchTxns(); fetchSummary(); fetchStatusCounts() }} style={{ background:'rgba(255,255,255,0.07)', border:'1px solid rgba(255,255,255,0.15)', color:'rgba(255,255,255,0.6)', padding:'6px 12px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>↻ REFRESH</button>
          {hasExport && <button onClick={handleExportClick} style={{ background:'rgba(184,150,12,0.15)', border:'1px solid rgba(184,150,12,0.4)', color:'#B8960C', padding:'6px 12px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>↓ EXPORT (VIEW)</button>}
        </div>
      </div>

      <div style={{ padding:'14px 20px' }}>

        {/* ── KPI Cards ── */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:'1px', background:'#D4C9B0', border:'1px solid #D4C9B0', marginBottom:'12px' }}>
          {[
            { label:'Total Revenue',      value: fmt(kpi.totalRevenueInPaise),    color:'#B8960C' },
            { label:'Platform Commission',value: fmt(kpi.totalCommissionInPaise), color:'#DC2626' },
            { label:'Avg Ticket Size',    value: fmt(kpi.avgBookingValueInPaise), color:'#059669' },
            { label:'Success Rate',       value: `${kpi.successRate ?? 0}%`,      color:'#2563EB' },
          ].map(m => (
            <div key={m.label} style={{ background:'#0D1B2A', padding:'12px 16px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <span style={{ fontSize:'11px', color:'rgba(255,255,255,0.4)' }}>{m.label}</span>
              <span style={{ fontSize:'18px', fontWeight:800, color:m.color }}>{m.value}</span>
            </div>
          ))}
        </div>

        {/* ── Status Cards ── */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:'8px', marginBottom:'12px' }}>
          {[
            { label:'Total',    count:kpi.totalBookings ?? 0,           f:'ALL',      color:'#1A1A2E' },
            { label:'Paid',     count:kpi.paidBookings  ?? 0,           f:'PAID',     color:'#059669' },
            { label:'Pending',  count:statusCounts.PENDING,             f:'PENDING',  color:'#D97706' },
            { label:'Refunded', count:statusCounts.REFUNDED,            f:'REFUNDED', color:'#7C3AED' },
            { label:'Failed',   count:statusCounts.FAILED,              f:'FAILED',   color:'#DC2626' },
          ].map(s => (
            <div key={s.f} onClick={() => { setStatus(s.f); setPage(1) }}
              style={{ background:status===s.f?s.color:'#fff', border:`1px solid ${s.color}30`, borderTop:`2px solid ${s.color}`, padding:'12px', cursor:'pointer', textAlign:'center' }}>
              <div style={{ fontSize:'22px', fontWeight:800, color:status===s.f?'#fff':s.color }}>{s.count}</div>
              <div style={{ fontSize:'9px', color:status===s.f?'rgba(255,255,255,0.8)':'#9E8E6E', textTransform:'uppercase', letterSpacing:'0.5px', marginTop:'2px' }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* ── Filters ── */}
        <BCard style={{ marginBottom:'12px' }}>
          <div style={{ padding:'10px 14px', display:'flex', gap:'8px', alignItems:'center', flexWrap:'wrap' }}>
            <div style={{ display:'flex', alignItems:'center', gap:'6px' }}>
              <div style={{ width:'3px', height:'14px', background:'#B8960C' }}/>
              <span style={{ fontSize:'10px', fontWeight:800, color:'#9E8E6E', letterSpacing:'1px' }}>FILTERS</span>
            </div>
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search TXN ID, salon, customer, payment ID..."
              style={{ flex:1, minWidth:'240px', border:'1px solid #D4C9B0', padding:'6px 10px', fontSize:'12px', fontFamily:FONTS.body, outline:'none', background:'#FDFAF6' }}/>
            <select value={status} onChange={e => { setStatus(e.target.value); setPage(1) }}
              style={{ border:'1px solid #D4C9B0', padding:'5px 8px', fontSize:'11px', color:'#6B5E3E', background:'#FDFAF6', cursor:'pointer', fontFamily:FONTS.body, outline:'none' }}>
              {STATUSES.map(o => <option key={o} value={o}>Status: {o}</option>)}
            </select>
            <select value={method} onChange={e => { setMethod(e.target.value) }}
              style={{ border:'1px solid #D4C9B0', padding:'5px 8px', fontSize:'11px', color:'#6B5E3E', background:'#FDFAF6', cursor:'pointer', fontFamily:FONTS.body, outline:'none' }}>
              {METHODS.map(o => <option key={o} value={o}>Method: {o}</option>)}
            </select>
            <select value={provider} onChange={e => { setProvider(e.target.value); setPage(1) }}
              style={{ border:'1px solid #D4C9B0', padding:'5px 8px', fontSize:'11px', color:'#6B5E3E', background:'#FDFAF6', cursor:'pointer', fontFamily:FONTS.body, outline:'none' }}>
              {PROVIDERS.map(o => <option key={o} value={o}>Provider: {o}</option>)}
            </select>
            <select value={dateF} onChange={e => { setDateF(e.target.value); setPage(1) }}
              style={{ border:'1px solid #D4C9B0', padding:'5px 8px', fontSize:'11px', color:'#6B5E3E', background:'#FDFAF6', cursor:'pointer', fontFamily:FONTS.body, outline:'none' }}>
              {DATES.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
            {dateF === 'Custom' && (<>
              <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)}
                style={{ border:'1px solid #D4C9B0', padding:'5px 8px', fontSize:'11px', color:'#6B5E3E', background:'#FDFAF6', outline:'none' }}/>
              <span style={{ fontSize:'11px', color:'#9E8E6E' }}>to</span>
              <input type="date" value={toDate} onChange={e => setToDate(e.target.value)}
                style={{ border:'1px solid #D4C9B0', padding:'5px 8px', fontSize:'11px', color:'#6B5E3E', background:'#FDFAF6', outline:'none' }}/>
            </>)}
            <span style={{ fontSize:'11px', color:'#9E8E6E' }}>{filtered.length} results</span>
            <button onClick={() => { setSearch(''); setStatus('ALL'); setMethod('ALL'); setProvider('ALL'); setDateF('All Time'); setFromDate(''); setToDate(''); setPage(1) }}
              style={{ background:'#F5F0E8', border:'1px solid #D4C9B0', color:'#9E8E6E', padding:'5px 10px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>RESET</button>
          </div>
        </BCard>

        {/* ── Table ── */}
        <BCard>
          <BCardHeader title={`Transaction Ledger (${total})`} action={
            <span style={{ fontSize:'11px', color:'#9E8E6E' }}>Page {page}/{totalPages||1}</span>
          }/>

          {/* Header */}
          <div style={{ display:'grid', gridTemplateColumns:'0.6fr 1.4fr 1.1fr 0.8fr 0.8fr 0.7fr 0.7fr 0.7fr 0.8fr', padding:'8px 14px', background:'#F5F0E8', borderBottom:'1px solid #E8DFD0', gap:'8px' }}>
            {['TXN ID','SALON','CUSTOMER','AMOUNT','COMMISSION','PAYOUT','METHOD','PROVIDER','STATUS'].map(h => (
              <span key={h} style={{ fontSize:'9px', fontWeight:800, color:'#9E8E6E', letterSpacing:'1px' }}>{h}</span>
            ))}
          </div>

          {loading ? (
            <div style={{ padding:'40px', textAlign:'center', color:'#9E8E6E', fontSize:'13px' }}>Loading transactions...</div>
          ) : error ? (
            <div style={{ padding:'40px', textAlign:'center', color:'#DC2626', fontSize:'13px' }}>{error}</div>
          ) : filtered.length === 0 ? (
            <div style={{ padding:'40px', textAlign:'center', color:'#9E8E6E', fontSize:'13px' }}>No transactions found</div>
          ) : filtered.map((t, i) => {
            const sc  = STATUS_CONFIG[t.status]         || STATUS_CONFIG.PENDING
            const mc  = METHOD_CONFIG[t.paymentMethod]  || METHOD_CONFIG.UNKNOWN
            const isExpanded = expanded === t.id
            const detail = detailCache[t.id]
            // Merge: list row fields as base, full detail (once loaded) overrides/extends
            const d = detail?.data ? { ...t, ...detail.data } : t

            return (
              <div key={t.id}>
                {/* Row */}
                <div onClick={() => handleExpand(t)}
                  style={{ display:'grid', gridTemplateColumns:'0.6fr 1.4fr 1.1fr 0.8fr 0.8fr 0.7fr 0.7fr 0.7fr 0.8fr', padding:'10px 14px',
                    borderBottom: isExpanded ? 'none' : '1px solid #F0EAE0', alignItems:'center', gap:'8px',
                    background: t.status==='FAILED'?'#FEF2F2' : isExpanded?'#F5F0E8' : i%2===0?'#fff':'#FDFAF6',
                    cursor:'pointer',
                  }}>
                  <span style={{ fontSize:'9px', color:'#B8960C', fontFamily:'monospace', fontWeight:700 }}>{String(t.id).slice(-8)}</span>
                  <div>
                    <div style={{ fontSize:'11px', fontWeight:700, color:'#1A1A2E' }}>{t.salon?.name || '—'}</div>
                    <div style={{ fontSize:'9px', color:'#9E8E6E' }}>{t.createdAt ? new Date(t.createdAt).toLocaleDateString('en-IN') : '—'}</div>
                  </div>
                  <div>
                    <div style={{ fontSize:'11px', color:'#6B5E3E' }}>{t.user?.name || '—'}</div>
                    <div style={{ fontSize:'9px', color:'#9E8E6E' }}>{t.user?.phone || '—'}</div>
                  </div>
                  <span style={{ fontSize:'12px', fontWeight:800, color:'#B8960C' }}>{fmt(t.amountInPaise)}</span>
                  <span style={{ fontSize:'11px', color:'#DC2626', fontWeight:600 }}>{fmt(t.commissionInPaise)}</span>
                  <span style={{ fontSize:'11px', color:'#059669', fontWeight:600 }}>{fmt(t.payoutAmountInPaise)}</span>
                  <span style={{ fontSize:'9px', fontWeight:700, background:mc.bg, color:mc.color, padding:'2px 5px', display:'inline-block' }}>{t.paymentMethod || 'UNKNOWN'}</span>
                  <span style={{ fontSize:'9px', color:'#9E8E6E', fontWeight:600 }}>{t.provider || 'MANUAL'}</span>
                  <span style={{ fontSize:'9px', fontWeight:800, background:sc.bg, color:sc.color, border:`1px solid ${sc.border}`, padding:'2px 6px', display:'inline-block' }}>{t.status}</span>
                </div>

                {/* Expanded Detail */}
                {isExpanded && (
                  <div style={{ background:'#F5F0E8', borderBottom:'2px solid #B8960C', padding:'0' }}>
                    {/* Tabs */}
                    <div style={{ display:'flex', borderBottom:'1px solid #D4C9B0', background:'#FDFAF6' }}>
                      {[
                        { id:'overview',   label:'Overview'   },
                        { id:'payment',    label:'Payment'    },
                        { id:'settlement', label:'Settlement' },
                        { id:'audit',      label:'Audit'      },
                      ].map(tab => (
                        <button key={tab.id} onClick={e => { e.stopPropagation(); setActiveTab(tab.id) }}
                          style={{ padding:'8px 16px', fontSize:'11px', fontWeight:700, cursor:'pointer', border:'none', borderBottom: activeTab===tab.id ? '2px solid #B8960C' : '2px solid transparent',
                            background:'transparent', color: activeTab===tab.id ? '#B8960C' : '#9E8E6E', fontFamily:FONTS.body }}>
                          {tab.label}
                        </button>
                      ))}
                    </div>

                    {detail?.loading ? (
                      <div style={{ padding:'30px', textAlign:'center', color:'#9E8E6E', fontSize:'12px' }}>Loading full detail...</div>
                    ) : detail?.error ? (
                      <div style={{ padding:'30px', textAlign:'center', color:'#DC2626', fontSize:'12px' }}>{detail.error}</div>
                    ) : (
                    <div style={{ padding:'14px 20px' }}>
                      {/* Overview Tab */}
                      {activeTab === 'overview' && (
                        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'20px' }}>
                          <div>
                            <div style={{ fontSize:'9px', fontWeight:800, color:'#9E8E6E', letterSpacing:'1px', marginBottom:'8px' }}>SALON INFO</div>
                            <DetailRow label="Salon Name"  value={d.salon?.name} />
                            <DetailRow label="Address"     value={d.salon?.address} />
                            <DetailRow label="Salon ID"    value={String(d.salon?.id || '—').slice(-12)} mono />
                          </div>
                          <div>
                            <div style={{ fontSize:'9px', fontWeight:800, color:'#9E8E6E', letterSpacing:'1px', marginBottom:'8px' }}>CUSTOMER INFO</div>
                            <DetailRow label="Name"        value={d.user?.name} />
                            <DetailRow label="Phone"       value={d.user?.phone} />
                            <DetailRow label="User ID"     value={String(d.user?.id || '—').slice(-12)} mono />
                          </div>
                        </div>
                      )}

                      {/* Payment Tab */}
                      {activeTab === 'payment' && (
                        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'20px' }}>
                          <div>
                            <div style={{ fontSize:'9px', fontWeight:800, color:'#9E8E6E', letterSpacing:'1px', marginBottom:'8px' }}>GATEWAY INFO</div>
                            <DetailRow label="Provider"    value={d.provider    || 'MANUAL'} />
                            <DetailRow label="Method"      value={d.paymentMethod || 'UNKNOWN'} />
                            <DetailRow label="Payment ID"  value={d.paymentId   || '—'} mono />
                            <DetailRow label="Order ID"    value={d.orderId     || '—'} mono />
                            <DetailRow label="Currency"    value={d.currency    || 'INR'} />
                            <DetailRow label="Source"      value={d.source      || 'APP'} />
                            {d.failureReason && <DetailRow label="Failure" value={d.failureReason} color='#DC2626' />}
                          </div>
                          <div>
                            <div style={{ fontSize:'9px', fontWeight:800, color:'#9E8E6E', letterSpacing:'1px', marginBottom:'8px' }}>BOOKING INFO</div>
                            <DetailRow label="Booking ID"  value={String(d.booking?.id || '—').slice(-12)} mono />
                            <DetailRow label="Type"        value={d.type} />
                            <DetailRow label="Status"      value={d.status} />
                            <DetailRow label="Created"     value={d.createdAt ? new Date(d.createdAt).toLocaleString('en-IN') : '—'} />
                          </div>
                        </div>
                      )}

                      {/* Settlement Tab */}
                      {activeTab === 'settlement' && (
                        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'20px' }}>
                          <div>
                            <div style={{ fontSize:'9px', fontWeight:800, color:'#9E8E6E', letterSpacing:'1px', marginBottom:'8px' }}>REVENUE SPLIT</div>
                            <DetailRow label="Gross Amount"     value={fmt(d.amountInPaise)}        color='#1A1A2E' />
                            <DetailRow label="Platform Commission" value={fmt(d.commissionInPaise)} color='#DC2626' />
                            <DetailRow label="Salon Payout"     value={fmt(d.payoutAmountInPaise)}  color='#059669' />
                            <DetailRow label="Gateway Fee"      value={fmt(d.gatewayFeeInPaise)}    color='#6B5E3E' />
                            <DetailRow label="Refund Amount"    value={fmt(d.refundAmountInPaise)}  color='#7C3AED' />
                          </div>
                          <div>
                            <div style={{ fontSize:'9px', fontWeight:800, color:'#9E8E6E', letterSpacing:'1px', marginBottom:'8px' }}>SETTLEMENT DATES</div>
                            <DetailRow label="Transaction Date" value={d.createdAt  ? new Date(d.createdAt).toLocaleString('en-IN')  : '—'} />
                            <DetailRow label="Settled At"       value={d.settledAt  ? new Date(d.settledAt).toLocaleString('en-IN')  : '—'} />
                            <DetailRow label="Refunded At"      value={d.refundedAt ? new Date(d.refundedAt).toLocaleString('en-IN') : '—'} />
                          </div>
                        </div>
                      )}

                      {/* Audit Tab */}
                      {activeTab === 'audit' && (
                        <div>
                          <div style={{ fontSize:'9px', fontWeight:800, color:'#9E8E6E', letterSpacing:'1px', marginBottom:'8px' }}>AUDIT TRAIL</div>
                          {[
                            { label:'Created',   ts: d.createdAt,  done: !!d.createdAt  },
                            { label:'Paid',      ts: d.createdAt,  done: d.status==='PAID' },
                            { label:'Credited',  ts: d.settledAt,  done: !!d.settledAt  },
                            { label:'Refunded',  ts: d.refundedAt, done: !!d.refundedAt },
                          ].map(ev => (
                            <div key={ev.label} style={{ display:'flex', alignItems:'center', gap:'12px', padding:'8px 0', borderBottom:'1px solid #F0EAE0' }}>
                              <div style={{ width:'8px', height:'8px', borderRadius:'50%', background: ev.done ? '#059669' : '#D4C9B0', flexShrink:0 }}/>
                              <span style={{ fontSize:'11px', fontWeight:700, color: ev.done ? '#1A1A2E' : '#9E8E6E', minWidth:'80px' }}>{ev.label}</span>
                              <span style={{ fontSize:'10px', color:'#9E8E6E' }}>{ev.ts ? new Date(ev.ts).toLocaleString('en-IN') : 'Pending'}</span>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Action buttons */}
                      <div style={{ display:'flex', gap:'8px', marginTop:'14px', flexWrap:'wrap' }}>
                        <button onClick={e => { e.stopPropagation(); navigate(`/app/finance/transactions/${t.id}`) }}
                          style={{ background:'#1A1A2E', color:'#fff', border:'none', padding:'6px 12px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>VIEW FULL DETAIL</button>
                        {d.booking?.id && (
                          <button onClick={e => { e.stopPropagation(); navigate(`/app/bookings/${d.booking.id}`) }}
                            style={{ background:'#B8960C', color:'#0D1B2A', border:'none', padding:'6px 12px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>VIEW BOOKING</button>
                        )}
                        {d.salon?.id && (
                          <button onClick={e => { e.stopPropagation(); navigate(`/app/salons/${d.salon.id}`) }}
                            style={{ background:'transparent', color:'#6B5E3E', border:'1px solid #D4C9B0', padding:'6px 12px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>VIEW SALON</button>
                        )}
                        {d.user?.id && (
                          <button onClick={e => { e.stopPropagation(); navigate(`/app/users/${d.user.id}`) }}
                            style={{ background:'transparent', color:'#6B5E3E', border:'1px solid #D4C9B0', padding:'6px 12px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>VIEW CUSTOMER</button>
                        )}
                        <button onClick={e => { e.stopPropagation(); navigate(`/app/finance/wallets/${d.salon?.id}`) }}
                          style={{ background:'transparent', color:'#6B5E3E', border:'1px solid #D4C9B0', padding:'6px 12px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>VIEW LEDGER</button>
                      </div>
                    </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}

          {/* Pagination */}
          <div style={{ padding:'12px 14px', borderTop:'1px solid #E8DFD0', display:'flex', justifyContent:'space-between', alignItems:'center', background:'#FDFAF6' }}>
            <span style={{ fontSize:'11px', color:'#9E8E6E' }}>
              Showing {total===0?0:((page-1)*PER_PAGE)+1}–{Math.min(page*PER_PAGE,total)} of {total}
            </span>
            <div style={{ display:'flex', gap:'4px' }}>
              <button onClick={() => setPage(p => Math.max(1,p-1))} disabled={page===1}
                style={{ background:page===1?'#F5F0E8':'#1A1A2E', color:page===1?'#C4B49A':'#fff', border:'1px solid #D4C9B0', padding:'5px 10px', fontSize:'11px', fontWeight:700, cursor:page===1?'not-allowed':'pointer' }}>← PREV</button>
              {paginationRange.map((p, idx) => p==='...'
                ? <span key={`e-${idx}`} style={{ padding:'5px 6px', fontSize:'11px', color:'#9E8E6E' }}>…</span>
                : <button key={p} onClick={() => setPage(p)}
                    style={{ background:p===page?'#B8960C':'#fff', color:p===page?'#fff':'#6B5E3E', border:'1px solid #D4C9B0', padding:'5px 10px', fontSize:'11px', fontWeight:700, cursor:'pointer' }}>{p}</button>
              )}
              <button onClick={() => setPage(p => Math.min(totalPages,p+1))} disabled={page===totalPages||totalPages===0}
                style={{ background:(page===totalPages||totalPages===0)?'#F5F0E8':'#1A1A2E', color:(page===totalPages||totalPages===0)?'#C4B49A':'#fff', border:'1px solid #D4C9B0', padding:'5px 10px', fontSize:'11px', fontWeight:700, cursor:(page===totalPages||totalPages===0)?'not-allowed':'pointer' }}>NEXT →</button>
            </div>
          </div>
        </BCard>
      </div>

      <div style={{ background:'#0D1B2A', borderTop:'2px solid #B8960C', padding:'10px 20px', display:'flex', justifyContent:'space-between', marginTop:'14px' }}>
        <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.3)' }}>BARBER ENGINE TRANSACTION LEDGER v1.0.0</span>
        <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.3)' }}>NATIONAL COMMAND CENTER</span>
      </div>
    </div>
  )
}