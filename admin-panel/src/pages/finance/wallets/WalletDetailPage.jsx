import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { FONTS } from '../../../config/brand'
import useAuthStore from '../../../store/authStore'
import FinanceAPI from '../api/finance.api'

const ADMIN_LEVELS = { SUPER_ADMIN:'SUPER_ADMIN', INDIA_ADMIN:'INDIA_ADMIN', STATE_ADMIN:'STATE_ADMIN', DISTRICT_ADMIN:'DISTRICT_ADMIN' }
const canFreeze = (l) => [ADMIN_LEVELS.SUPER_ADMIN, ADMIN_LEVELS.INDIA_ADMIN].includes(l)

const fmt  = (v) => '₹' + ((v ?? 0)/100).toLocaleString('en-IN', { minimumFractionDigits:0, maximumFractionDigits:2 })

const DIRECTION_CONFIG = {
  CREDIT: { bg:'#D1FAE5', color:'#065F46', icon:'↑' },
  DEBIT:  { bg:'#FEE2E2', color:'#991B1B', icon:'↓' },
}

const ACTION_CONFIG = {
  BOOKING_SETTLEMENT: { label:'Booking Settlement', color:'#059669' },
  HOLD:               { label:'Hold',               color:'#D97706' },
  RELEASE:            { label:'Release',            color:'#2563EB' },
  PROCESSING:         { label:'Processing',         color:'#7C3AED' },
  COMPLETE_PAYOUT:    { label:'Payout Complete',    color:'#065F46' },
  FAIL_PAYOUT:        { label:'Payout Failed',      color:'#991B1B' },
}

const BUCKET_COLORS = {
  available:   '#059669',
  pending:     '#D97706',
  locked:      '#DC2626',
  processing:  '#7C3AED',
}

const DATES   = ['All Time','Today','Last 7 Days','Last 30 Days','Custom']
const PER_PAGE = 20

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
  <div style={{ display:'flex', justifyContent:'space-between', padding:'7px 0', borderBottom:'1px solid #F0EAE0' }}>
    <span style={{ fontSize:'11px', color:'#9E8E6E', fontWeight:600 }}>{label}</span>
    <span style={{ fontSize:'12px', color, fontWeight:700, fontFamily:mono?'monospace':FONTS.body, textAlign:'right', maxWidth:'220px', wordBreak:'break-all' }}>{value ?? '—'}</span>
  </div>
)

export default function WalletDetailPage() {
  const { id: salonId } = useParams()
  const navigate    = useNavigate()
  const admin       = useAuthStore(s => s.admin)
  const adminLevel  = admin?.adminLevel || ADMIN_LEVELS.SUPER_ADMIN
  const hasFreeze   = canFreeze(adminLevel)

  // ── Wallet state ──────────────────────────────────────
  const [wallet,        setWallet]        = useState(null)
  const [walletLoading, setWalletLoading] = useState(true)
  const [walletError,   setWalletError]   = useState(null)

  // ── Ledger state ──────────────────────────────────────
  const [entries,       setEntries]       = useState([])
  const [ledgerLoading, setLedgerLoading] = useState(true)
  const [ledgerError,   setLedgerError]   = useState(null)
  const [total,         setTotal]         = useState(0)
  const [page,          setPage]          = useState(1)
  const [dateF,         setDateF]         = useState('All Time')
  const [fromDate,      setFromDate]      = useState('')
  const [toDate,        setToDate]        = useState('')
  const [dirFilter,     setDirFilter]     = useState('ALL')
  const [expanded,      setExpanded]      = useState(null)

  // ── Freeze state ──────────────────────────────────────
  const [freezeLoading, setFreezeLoading] = useState(false)
  const [toast,         setToast]         = useState(null)

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

  // ── Fetch wallet (from wallets list, filter by salonId) ──
  const fetchWallet = useCallback(async () => {
      try {
        setWalletLoading(true); setWalletError(null)
        const res = await FinanceAPI.getWalletDetail(salonId)
        setWallet(res.data || null)
      } catch (err) {
        setWalletError(err.message || 'Failed to fetch wallet')
      } finally { setWalletLoading(false) }
    }, [salonId])

  // ── Fetch ledger ──────────────────────────────────────
  const fetchLedger = useCallback(async () => {
    try {
      setLedgerLoading(true); setLedgerError(null)
      const params = { page, limit: PER_PAGE }
      const dp = getDateParams()
      if (dp.from) params.from = dp.from
      if (dp.to)   params.to   = dp.to
      const res = await FinanceAPI.getSalonLedger(salonId, params)
      setEntries(res.data || [])
      setTotal(res.pagination?.total || 0)
    } catch (err) {
      setLedgerError(err.message || 'Failed to fetch ledger')
    } finally { setLedgerLoading(false) }
  }, [salonId, page, dateF, fromDate, toDate])

  useEffect(() => { fetchWallet() }, [fetchWallet])
  useEffect(() => { fetchLedger() }, [fetchLedger])

  // ── Freeze/Unfreeze ───────────────────────────────────
  const handleFreeze = async (action) => {
    try {
      setFreezeLoading(true)
      await FinanceAPI.freezeWallet(wallet.id, { action })
      showToast(
        action === 'FREEZE'   ? '❄ Wallet frozen'   :
        action === 'UNFREEZE' ? '✓ Wallet unfrozen' :
        '⊘ Wallet blocked',
        action === 'UNFREEZE' ? '#059669' : action === 'FREEZE' ? '#2563EB' : '#DC2626'
      )
      fetchWallet()
    } catch (err) {
      showToast(err.message || 'Action failed', '#DC2626')
    } finally { setFreezeLoading(false) }
  }

  // ── Filter ledger client-side by direction ────────────
  const filteredEntries = dirFilter === 'ALL'
    ? entries
    : entries.filter(e => e.direction === dirFilter)

  const totalPages      = Math.ceil(total / PER_PAGE)
  const paginationRange = getPaginationRange(page, totalPages || 1)

  // ── Ledger stats ──────────────────────────────────────
  const totalCredit = entries.filter(e => e.direction === 'CREDIT').reduce((s, e) => s + (e.amountInPaise || 0), 0)
  const totalDebit  = entries.filter(e => e.direction === 'DEBIT' ).reduce((s, e) => s + (e.amountInPaise || 0), 0)

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
          <button onClick={() => navigate('/app/finance/wallets')}
            style={{ background:'transparent', border:'none', color:'rgba(255,255,255,0.5)', cursor:'pointer', fontSize:'18px' }}>←</button>
          <div style={{ width:'3px', height:'16px', background:'#B8960C' }}/>
          <h1 style={{ fontSize:'13px', fontWeight:800, color:'#fff', margin:0, letterSpacing:'2px', textTransform:'uppercase' }}>Wallet Ledger</h1>
          {wallet && (
            <span style={{ background:'rgba(184,150,12,0.2)', color:'#B8960C', fontSize:'10px', fontWeight:800, padding:'2px 8px', border:'1px solid rgba(184,150,12,0.3)' }}>
              {wallet.salon}
            </span>
          )}
          {wallet?.status && (
            <span style={{ fontSize:'9px', fontWeight:800, padding:'2px 8px',
              background: wallet.status==='ACTIVE' ? '#D1FAE5' : wallet.status==='FROZEN' ? '#EFF6FF' : '#FEE2E2',
              color:      wallet.status==='ACTIVE' ? '#065F46' : wallet.status==='FROZEN' ? '#1D4ED8' : '#991B1B',
            }}>{wallet.status}</span>
          )}
        </div>
        <div style={{ display:'flex', gap:'8px' }}>
          {hasFreeze && wallet && (
            <>
              {wallet.status === 'ACTIVE' && (
                <button onClick={() => handleFreeze('FREEZE')} disabled={freezeLoading}
                  style={{ background:'#2563EB', color:'#fff', border:'none', padding:'6px 12px', fontSize:'10px', fontWeight:700, cursor:'pointer', opacity:freezeLoading?0.6:1 }}>
                  ❄ FREEZE
                </button>
              )}
              {wallet.status === 'FROZEN' && (
                <button onClick={() => handleFreeze('UNFREEZE')} disabled={freezeLoading}
                  style={{ background:'#059669', color:'#fff', border:'none', padding:'6px 12px', fontSize:'10px', fontWeight:700, cursor:'pointer', opacity:freezeLoading?0.6:1 }}>
                  ✓ UNFREEZE
                </button>
              )}
              {wallet.status !== 'BLOCKED' && (
                <button onClick={() => handleFreeze('BLOCK')} disabled={freezeLoading}
                  style={{ background:'#DC2626', color:'#fff', border:'none', padding:'6px 12px', fontSize:'10px', fontWeight:700, cursor:'pointer', opacity:freezeLoading?0.6:1 }}>
                  ⊘ BLOCK
                </button>
              )}
              {wallet.status === 'BLOCKED' && (
                <button onClick={() => handleFreeze('UNFREEZE')} disabled={freezeLoading}
                  style={{ background:'#059669', color:'#fff', border:'none', padding:'6px 12px', fontSize:'10px', fontWeight:700, cursor:'pointer', opacity:freezeLoading?0.6:1 }}>
                  ✓ UNBLOCK
                </button>
              )}
            </>
          )}
          <button onClick={() => navigate(`/app/finance/transactions?salonId=${salonId}`)}
            style={{ background:'rgba(255,255,255,0.07)', border:'1px solid rgba(255,255,255,0.15)', color:'rgba(255,255,255,0.6)', padding:'6px 12px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>
            TRANSACTIONS ▸
          </button>
        </div>
      </div>

      <div style={{ padding:'14px 20px' }}>

        {walletLoading ? (
          <div style={{ padding:'20px', textAlign:'center', color:'#9E8E6E' }}>Loading wallet...</div>
        ) : walletError ? (
          <div style={{ padding:'20px', textAlign:'center', color:'#DC2626' }}>{walletError}</div>
        ) : wallet ? (
          <>
            {/* Wallet Balance Strip */}
            <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:'1px', background:'#D4C9B0', border:'1px solid #D4C9B0', marginBottom:'12px' }}>
              {[
                { label:'Available',   value: fmt(wallet.availableBalanceInPaise),   color:'#059669' },
                { label:'Pending',     value: fmt(wallet.pendingBalanceInPaise),     color:'#D97706' },
                { label:'Locked',      value: fmt(wallet.lockedBalanceInPaise),      color:'#DC2626' },
                { label:'Processing',  value: fmt(wallet.processingBalanceInPaise),  color:'#7C3AED' },
              ].map(m => (
                <div key={m.label} style={{ background:'#0D1B2A', padding:'12px 16px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                  <span style={{ fontSize:'11px', color:'rgba(255,255,255,0.4)' }}>{m.label}</span>
                  <span style={{ fontSize:'18px', fontWeight:800, color:m.color }}>{m.value}</span>
                </div>
              ))}
            </div>

            {/* Wallet Info */}
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'12px', marginBottom:'12px' }}>
              <BCard style={{ padding:'14px 18px' }}>
                <div style={{ fontSize:'10px', fontWeight:800, color:'#9E8E6E', letterSpacing:'1px', marginBottom:'10px' }}>SALON INFO</div>
                <DetailRow label="Salon Name"     value={wallet.salon} />
                <DetailRow label="Phone"          value={wallet.phone} />
                <DetailRow label="Address"        value={wallet.address} />
                <DetailRow label="Status"         value={wallet.status} color={wallet.status==='ACTIVE'?'#059669':wallet.status==='FROZEN'?'#2563EB':'#DC2626'} />
                <DetailRow label="Salon ID"       value={String(wallet.salonId)} mono />
                {wallet.frozenAt   && <DetailRow label="Frozen At"  value={new Date(wallet.frozenAt).toLocaleString('en-IN')} color='#2563EB' />}
                {wallet.frozenNote && <DetailRow label="Freeze Note" value={wallet.frozenNote} />}
              </BCard>

              <BCard style={{ padding:'14px 18px' }}>
                <div style={{ fontSize:'10px', fontWeight:800, color:'#9E8E6E', letterSpacing:'1px', marginBottom:'10px' }}>LIFETIME STATS</div>
                <DetailRow label="Lifetime Earned"     value={fmt(wallet.lifetimeEarningsInPaise)}    color='#059669' />
                <DetailRow label="Lifetime Withdrawn"  value={fmt(wallet.lifetimeWithdrawalsInPaise)} color='#DC2626' />
                <DetailRow label="Last Transaction"    value={wallet.lastTransactionAt ? new Date(wallet.lastTransactionAt).toLocaleDateString('en-IN') : '—'} />
                <DetailRow label="Last Payout"         value={wallet.lastPayoutAt ? new Date(wallet.lastPayoutAt).toLocaleDateString('en-IN') : '—'} />
                <div style={{ marginTop:'14px' }}>
                  <div style={{ fontSize:'10px', fontWeight:800, color:'#9E8E6E', letterSpacing:'1px', marginBottom:'8px' }}>LEDGER STATS (CURRENT PAGE)</div>
                  <DetailRow label="Total Credits" value={fmt(totalCredit)} color='#059669' />
                  <DetailRow label="Total Debits"  value={fmt(totalDebit)}  color='#DC2626' />
                </div>
              </BCard>
            </div>
          </>
        ) : (
          <div style={{ padding:'20px', textAlign:'center', color:'#9E8E6E' }}>Wallet not found</div>
        )}

        {/* Ledger Table */}
        <BCard>
          <BCardHeader title={`Wallet Ledger (${total} entries)`} action={
            <div style={{ display:'flex', gap:'8px', alignItems:'center' }}>
              <button onClick={fetchLedger} style={{ background:'#F5F0E8', border:'1px solid #D4C9B0', color:'#6B5E3E', padding:'4px 10px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>↻ REFRESH</button>
              <span style={{ fontSize:'11px', color:'#9E8E6E' }}>Page {page}/{totalPages||1}</span>
            </div>
          }/>

          {/* Ledger Filters */}
          <div style={{ padding:'10px 14px', borderBottom:'1px solid #E8DFD0', display:'flex', gap:'8px', alignItems:'center', flexWrap:'wrap', background:'#FDFAF6' }}>
            <div style={{ display:'flex', alignItems:'center', gap:'6px' }}>
              <div style={{ width:'3px', height:'14px', background:'#B8960C' }}/>
              <span style={{ fontSize:'10px', fontWeight:800, color:'#9E8E6E', letterSpacing:'1px' }}>FILTERS</span>
            </div>
            {['ALL','CREDIT','DEBIT'].map(d => (
              <button key={d} onClick={() => setDirFilter(d)}
                style={{ background: dirFilter===d ? '#1A1A2E' : '#F5F0E8', color: dirFilter===d ? '#fff' : '#6B5E3E', border:'1px solid #D4C9B0', padding:'4px 10px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>
                {d}
              </button>
            ))}
            <select value={dateF} onChange={e => { setDateF(e.target.value); setPage(1) }}
              style={{ border:'1px solid #D4C9B0', padding:'5px 8px', fontSize:'11px', color:'#6B5E3E', background:'#FDFAF6', cursor:'pointer', fontFamily:FONTS.body, outline:'none' }}>
              {DATES.map(o => <option key={o}>{o}</option>)}
            </select>
            {dateF === 'Custom' && (<>
              <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)}
                style={{ border:'1px solid #D4C9B0', padding:'5px 8px', fontSize:'11px', outline:'none' }}/>
              <span style={{ fontSize:'11px', color:'#9E8E6E' }}>to</span>
              <input type="date" value={toDate} onChange={e => setToDate(e.target.value)}
                style={{ border:'1px solid #D4C9B0', padding:'5px 8px', fontSize:'11px', outline:'none' }}/>
            </>)}
            <button onClick={() => { setDirFilter('ALL'); setDateF('All Time'); setFromDate(''); setToDate(''); setPage(1) }}
              style={{ background:'#F5F0E8', border:'1px solid #D4C9B0', color:'#9E8E6E', padding:'4px 10px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>RESET</button>
          </div>

          {/* Table Header */}
          <div style={{ display:'grid', gridTemplateColumns:'0.5fr 0.6fr 0.7fr 0.8fr 0.8fr 0.8fr 1.2fr 0.8fr', padding:'8px 14px', background:'#F5F0E8', borderBottom:'1px solid #E8DFD0', gap:'8px' }}>
            {['DIR','BUCKET','ACTION','AMOUNT','BALANCE AFTER','ENTITY','REMARKS','DATE'].map(h => (
              <span key={h} style={{ fontSize:'9px', fontWeight:800, color:'#9E8E6E', letterSpacing:'1px' }}>{h}</span>
            ))}
          </div>

          {ledgerLoading ? (
            <div style={{ padding:'40px', textAlign:'center', color:'#9E8E6E' }}>Loading ledger...</div>
          ) : ledgerError ? (
            <div style={{ padding:'40px', textAlign:'center', color:'#DC2626' }}>{ledgerError}</div>
          ) : filteredEntries.length === 0 ? (
            <div style={{ padding:'40px', textAlign:'center', color:'#9E8E6E' }}>No ledger entries found</div>
          ) : filteredEntries.map((e, i) => {
            const dc = DIRECTION_CONFIG[e.direction] || DIRECTION_CONFIG.CREDIT
            const ac = ACTION_CONFIG[e.action]       || { label: e.action, color:'#6B5E3E' }
            const isExp = expanded === e.id
            return (
              <div key={e.id}>
                <div onClick={() => setExpanded(isExp ? null : e.id)}
                  style={{ display:'grid', gridTemplateColumns:'0.5fr 0.6fr 0.7fr 0.8fr 0.8fr 0.8fr 1.2fr 0.8fr', padding:'10px 14px', borderBottom: isExp ? 'none' : '1px solid #F0EAE0', alignItems:'center', gap:'8px',
                    background: e.direction==='CREDIT' ? (i%2===0?'#F0FDF4':'#F7FEF9') : (i%2===0?'#FEF2F2':'#FFF5F5'),
                    cursor:'pointer',
                  }}>
                  <span style={{ fontSize:'11px', fontWeight:800, background:dc.bg, color:dc.color, padding:'2px 6px', display:'inline-block' }}>
                    {dc.icon} {e.direction}
                  </span>
                  <span style={{ fontSize:'10px', color: BUCKET_COLORS[e.bucket] || '#6B5E3E', fontWeight:700, textTransform:'uppercase' }}>{e.bucket}</span>
                  <span style={{ fontSize:'9px', color:ac.color, fontWeight:700 }}>{ac.label}</span>
                  <span style={{ fontSize:'12px', fontWeight:800, color: e.direction==='CREDIT'?'#059669':'#DC2626' }}>
                    {e.direction==='CREDIT'?'+':'-'}{fmt(e.amountInPaise)}
                  </span>
                  <span style={{ fontSize:'11px', color:'#1A1A2E', fontWeight:600 }}>{fmt(e.balanceAfter?.available ?? 0)}</span>
                  <span style={{ fontSize:'9px', color:'#9E8E6E', fontFamily:'monospace' }}>{e.entityType || '—'}</span>
                  <span style={{ fontSize:'10px', color:'#6B5E3E' }}>{e.remarks || '—'}</span>
                  <span style={{ fontSize:'10px', color:'#9E8E6E' }}>{e.createdAt ? new Date(e.createdAt).toLocaleDateString('en-IN') : '—'}</span>
                </div>

                {/* Expanded */}
                {isExp && (
                  <div style={{ background:'#F5F0E8', borderBottom:'1px solid #D4C9B0', padding:'14px 20px' }}>
                    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'20px' }}>
                      <div>
                        <div style={{ fontSize:'9px', fontWeight:800, color:'#9E8E6E', letterSpacing:'1px', marginBottom:'8px' }}>LEDGER ENTRY</div>
                        <DetailRow label="Direction"      value={e.direction} />
                        <DetailRow label="Bucket"         value={e.bucket} />
                        <DetailRow label="Action"         value={e.action} />
                        <DetailRow label="Amount"         value={fmt(e.amountInPaise)} color={e.direction==='CREDIT'?'#059669':'#DC2626'} />
                        <DetailRow label="Currency"       value={e.currency || 'INR'} />
                        <DetailRow label="Idempotency Key" value={e.idempotencyKey} mono />
                      </div>
                      <div>
                        <div style={{ fontSize:'9px', fontWeight:800, color:'#9E8E6E', letterSpacing:'1px', marginBottom:'8px' }}>BALANCE SNAPSHOT</div>
                        <DetailRow label="Available After"   value={fmt(e.balanceAfter?.available   ?? 0)} color='#059669' />
                        <DetailRow label="Pending After"     value={fmt(e.balanceAfter?.pending     ?? 0)} color='#D97706' />
                        <DetailRow label="Locked After"      value={fmt(e.balanceAfter?.locked      ?? 0)} color='#DC2626' />
                        <DetailRow label="Processing After"  value={fmt(e.balanceAfter?.processing  ?? 0)} color='#7C3AED' />
                        <div style={{ marginTop:'10px' }}>
                          <DetailRow label="Entity Type"   value={e.entityType} />
                          <DetailRow label="Entity ID"     value={String(e.entityId || '—')} mono />
                          <DetailRow label="Triggered By"  value={e.triggeredBy} />
                          <DetailRow label="Remarks"       value={e.remarks} />
                          <DetailRow label="Date"          value={e.createdAt ? new Date(e.createdAt).toLocaleString('en-IN') : '—'} />
                        </div>
                      </div>
                    </div>
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
        <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.3)' }}>BARBER ENGINE WALLET LEDGER v1.0.0</span>
        <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.3)' }}>NATIONAL COMMAND CENTER</span>
      </div>
    </div>
  )
}