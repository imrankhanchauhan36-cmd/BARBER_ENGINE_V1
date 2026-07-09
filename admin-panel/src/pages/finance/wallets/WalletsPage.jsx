//////////////////////////////////////////////////////
// BARBER ENGINE V1
// admin-panel/src/pages/finance/wallets/WalletsPage.jsx
// Real API — Industry Grade
//////////////////////////////////////////////////////

import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FONTS } from '../../../config/brand'
import useAuthStore from '../../../store/authStore'
import FinanceAPI from '../api/finance.api'

const ADMIN_LEVELS = {
  SUPER_ADMIN:    'SUPER_ADMIN',
  INDIA_ADMIN:    'INDIA_ADMIN',
  STATE_ADMIN:    'STATE_ADMIN',
  DISTRICT_ADMIN: 'DISTRICT_ADMIN',
}
const canFreeze  = (l) => [ADMIN_LEVELS.SUPER_ADMIN, ADMIN_LEVELS.INDIA_ADMIN].includes(l)
const canExport  = (l) => [ADMIN_LEVELS.SUPER_ADMIN, ADMIN_LEVELS.INDIA_ADMIN, ADMIN_LEVELS.STATE_ADMIN].includes(l)

const p2r = (v) => ((v ?? 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })

const STATUS_COLORS = {
  ACTIVE:   { bg:'#D1FAE5', color:'#065F46' },
  FROZEN:   { bg:'#EFF6FF', color:'#1D4ED8' },
  BLOCKED:  { bg:'#FEE2E2', color:'#991B1B' },
  INACTIVE: { bg:'#F3F4F6', color:'#374151' },
}

const STATUSES = ['ALL', 'ACTIVE', 'FROZEN', 'BLOCKED', 'INACTIVE']
const SORTS    = [
  { val:'available', label:'Sort: Available Balance' },
  { val:'earnings',  label:'Sort: Lifetime Earnings' },
  { val:'recent',    label:'Sort: Recent Activity'   },
]

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

export default function WalletsPage() {
  const navigate   = useNavigate()
  const admin      = useAuthStore(s => s.admin)
  const adminLevel = admin?.adminLevel || ADMIN_LEVELS.SUPER_ADMIN
  const hasFreeze  = canFreeze(adminLevel)
  const hasExport  = canExport(adminLevel)

  const scope = adminLevel === ADMIN_LEVELS.STATE_ADMIN    ? 'YOUR STATE'
              : adminLevel === ADMIN_LEVELS.DISTRICT_ADMIN ? 'YOUR DISTRICT'
              : 'PAN INDIA'

  const [wallets,       setWallets]       = useState([])
  const [summary,       setSummary]       = useState(null)
  const [loading,       setLoading]       = useState(true)
  const [error,         setError]         = useState(null)
  const [page,          setPage]          = useState(1)
  const [total,         setTotal]         = useState(0)
  const [sort,          setSort]          = useState('available')
  const [statusFilter,  setStatusFilter]  = useState('ALL')
  const [search,        setSearch]        = useState('')
  const [toast,         setToast]         = useState(null)
  const [freezeLoading, setFreezeLoading] = useState(null)
  const LIMIT = 20

  const showToast = (msg, color='#059669') => {
    setToast({ msg, color })
    setTimeout(() => setToast(null), 3000)
  }

  const fetchWallets = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const params = { page, limit: LIMIT, sort }
      if (statusFilter !== 'ALL') params.status = statusFilter
      const res = await FinanceAPI.getWallets(params)
      setWallets(res.data || [])
      setTotal(res.pagination?.total || 0)
    } catch (err) {
      setError(err.message || 'Failed to fetch wallets')
    } finally {
      setLoading(false)
    }
  }, [page, sort, statusFilter])

  const fetchSummary = useCallback(async () => {
    try {
      const res = await FinanceAPI.getSummary()
      setSummary(res.data)
    } catch {}
  }, [])

  useEffect(() => { fetchWallets() }, [fetchWallets])
  useEffect(() => { fetchSummary() }, [fetchSummary])

  const handleFreeze = async (w, action) => {
    try {
      setFreezeLoading(w.id)
      await FinanceAPI.freezeWallet(w.id, { action })
      showToast(
        action === 'FREEZE'   ? `❄ ${w.salon} wallet frozen`   :
        action === 'UNFREEZE' ? `✓ ${w.salon} wallet unfrozen` :
        `⊘ ${w.salon} wallet blocked`,
        action === 'UNFREEZE' ? '#059669' : action === 'FREEZE' ? '#2563EB' : '#DC2626'
      )
      fetchWallets()
      fetchSummary()
    } catch (err) {
      showToast(err.message || 'Action failed', '#DC2626')
    } finally {
      setFreezeLoading(null)
    }
  }

  const totalPages = Math.ceil(total / LIMIT)

  const filtered = search
    ? wallets.filter(w =>
        (w.salon    || '').toLowerCase().includes(search.toLowerCase()) ||
        (w.address  || '').toLowerCase().includes(search.toLowerCase()) ||
        (w.phone    || '').includes(search)
      )
    : wallets

  const frozenCount = wallets.filter(w => w.status === 'FROZEN' || w.status === 'BLOCKED').length

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
          <h1 style={{ fontSize:'13px', fontWeight:800, color:'#fff', margin:0, letterSpacing:'2px', textTransform:'uppercase' }}>Wallets</h1>
          <span style={{ background:'rgba(184,150,12,0.2)', color:'#B8960C', fontSize:'10px', fontWeight:800, padding:'2px 8px', border:'1px solid rgba(184,150,12,0.3)' }}>{total} WALLETS</span>
          <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.35)' }}>|</span>
          <span style={{ fontSize:'10px', color:'#B8960C', fontWeight:600 }}>Viewing: {scope}</span>
          {frozenCount > 0 && <span style={{ background:'rgba(37,99,235,0.2)', color:'#93C5FD', fontSize:'10px', fontWeight:800, padding:'2px 8px', border:'1px solid rgba(37,99,235,0.3)' }}>❄ {frozenCount} FROZEN/BLOCKED</span>}
        </div>
        <div style={{ display:'flex', gap:'8px' }}>
          <button onClick={() => navigate('/app/finance/transactions')} style={{ background:'rgba(255,255,255,0.07)', border:'1px solid rgba(255,255,255,0.15)', color:'rgba(255,255,255,0.5)', padding:'6px 12px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>TRANSACTIONS ▸</button>
          <button onClick={() => navigate('/app/finance/payouts')} style={{ background:'rgba(184,150,12,0.15)', border:'1px solid rgba(184,150,12,0.4)', color:'#B8960C', padding:'6px 12px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>PAYOUTS ▸</button>
          {hasExport && <button style={{ background:'rgba(255,255,255,0.07)', border:'1px solid rgba(255,255,255,0.15)', color:'rgba(255,255,255,0.6)', padding:'6px 12px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>↓ EXPORT</button>}
        </div>
      </div>

      <div style={{ padding:'14px 20px' }}>

        {/* Summary Strip */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:'1px', background:'#D4C9B0', border:'1px solid #D4C9B0', marginBottom:'12px' }}>
          {[
            { label:'Total Available',    value: summary ? `₹${p2r(summary.wallets?.totalAvailableInPaise)}`    : '—', color:'#B8960C' },
            { label:'Lifetime Earnings',  value: summary ? `₹${p2r(summary.wallets?.lifetimeEarningsInPaise)}`  : '—', color:'#059669' },
            { label:'Locked (Payouts)',   value: summary ? `₹${p2r(summary.wallets?.totalLockedInPaise)}`        : '—', color:'#DC2626' },
            { label:'Processing',         value: summary ? `₹${p2r(summary.wallets?.totalProcessingInPaise)}`   : '—', color:'#7C3AED' },
          ].map(m => (
            <div key={m.label} style={{ background:'#0D1B2A', padding:'12px 16px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <span style={{ fontSize:'11px', color:'rgba(255,255,255,0.4)' }}>{m.label}</span>
              <span style={{ fontSize:'18px', fontWeight:800, color:m.color }}>{m.value}</span>
            </div>
          ))}
        </div>

        {/* Status Cards */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:'10px', marginBottom:'12px' }}>
          {STATUSES.map(s => {
            const count = s === 'ALL' ? total : wallets.filter(w => w.status === s).length
            const color = s === 'ACTIVE' ? '#059669' : s === 'FROZEN' ? '#2563EB' : s === 'BLOCKED' ? '#DC2626' : s === 'INACTIVE' ? '#374151' : '#1A1A2E'
            return (
              <div key={s} onClick={() => { setStatusFilter(s); setPage(1) }}
                style={{ background:statusFilter===s?color:'#fff', border:`1px solid ${color}30`, borderTop:`2px solid ${color}`, padding:'12px 14px', cursor:'pointer', textAlign:'center' }}>
                <div style={{ fontSize:'20px', fontWeight:800, color:statusFilter===s?'#fff':color }}>{count}</div>
                <div style={{ fontSize:'9px', color:statusFilter===s?'rgba(255,255,255,0.8)':'#9E8E6E', textTransform:'uppercase', letterSpacing:'0.5px', marginTop:'2px' }}>{s}</div>
              </div>
            )
          })}
        </div>

        {/* Filters */}
        <BCard style={{ marginBottom:'12px' }}>
          <div style={{ padding:'10px 14px', display:'flex', gap:'8px', alignItems:'center', flexWrap:'wrap' }}>
            <div style={{ display:'flex', alignItems:'center', gap:'6px' }}>
              <div style={{ width:'3px', height:'14px', background:'#B8960C' }}/>
              <span style={{ fontSize:'10px', fontWeight:800, color:'#9E8E6E', letterSpacing:'1px' }}>FILTERS</span>
            </div>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search salon name, phone..."
              style={{ flex:1, minWidth:'200px', border:'1px solid #D4C9B0', padding:'6px 10px', fontSize:'12px', fontFamily:FONTS.body, outline:'none', background:'#FDFAF6' }}/>
            <select value={sort} onChange={e => { setSort(e.target.value); setPage(1) }}
              style={{ border:'1px solid #D4C9B0', padding:'5px 8px', fontSize:'11px', color:'#6B5E3E', background:'#FDFAF6', cursor:'pointer', fontFamily:FONTS.body, outline:'none' }}>
              {SORTS.map(s => <option key={s.val} value={s.val}>{s.label}</option>)}
            </select>
            <span style={{ fontSize:'11px', color:'#9E8E6E' }}>{filtered.length} results</span>
            <button onClick={() => { setSearch(''); setSort('available'); setStatusFilter('ALL'); setPage(1) }}
              style={{ background:'#F5F0E8', border:'1px solid #D4C9B0', color:'#9E8E6E', padding:'5px 10px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>RESET</button>
          </div>
        </BCard>

        {/* Table */}
        <BCard>
          <BCardHeader title={`Wallet Registry (${total})`} action={
            <div style={{ display:'flex', gap:'8px', alignItems:'center' }}>
              <button onClick={fetchWallets} style={{ background:'#F5F0E8', border:'1px solid #D4C9B0', color:'#6B5E3E', padding:'4px 10px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>↻ REFRESH</button>
              <span style={{ fontSize:'11px', color:'#9E8E6E' }}>Page {page}/{totalPages||1}</span>
            </div>
          }/>

          {/* Table Header */}
          <div style={{ display:'grid', gridTemplateColumns:'1.8fr 1fr 0.9fr 0.9fr 0.9fr 0.9fr 1fr 0.8fr 0.8fr 1fr', padding:'8px 14px', background:'#F5F0E8', borderBottom:'1px solid #E8DFD0', gap:'8px' }}>
            {['SALON','PHONE','AVAILABLE','PENDING','LOCKED','PROCESSING','LIFETIME EARNED','WITHDRAWN','STATUS','ACTIONS'].map(h => (
              <span key={h} style={{ fontSize:'9px', fontWeight:800, color:'#9E8E6E', letterSpacing:'1px' }}>{h}</span>
            ))}
          </div>

          {loading ? (
            <div style={{ padding:'40px', textAlign:'center', color:'#9E8E6E' }}>Loading wallets...</div>
          ) : error ? (
            <div style={{ padding:'40px', textAlign:'center', color:'#DC2626' }}>{error}</div>
          ) : filtered.length === 0 ? (
            <div style={{ padding:'40px', textAlign:'center', color:'#9E8E6E' }}>No wallets found</div>
          ) : filtered.map((w, i) => {
            const sc = STATUS_COLORS[w.status] || STATUS_COLORS.ACTIVE
            const isFrozen = w.status === 'FROZEN' || w.status === 'BLOCKED'
            return (
              <div key={w.id || i} style={{ display:'grid', gridTemplateColumns:'1.8fr 1fr 0.9fr 0.9fr 0.9fr 0.9fr 1fr 0.8fr 0.8fr 1fr', padding:'10px 14px', borderBottom:'1px solid #F0EAE0', alignItems:'center', gap:'8px',
                background: isFrozen ? '#EFF6FF' : i%2===0 ? '#fff' : '#FDFAF6'
              }}>
                <div>
                  <div style={{ fontSize:'12px', fontWeight:700, color:'#1A1A2E' }}>{w.salon || '—'}</div>
                  <div style={{ fontSize:'9px', color:'#9E8E6E', fontFamily:'monospace' }}>{w.address ? w.address.slice(0,35)+'...' : '—'}</div>
                </div>
                <span style={{ fontSize:'11px', color:'#6B5E3E', fontFamily:'monospace' }}>{w.phone || '—'}</span>
                <span style={{ fontSize:'12px', fontWeight:800, color:'#B8960C' }}>₹{p2r(w.availableBalanceInPaise)}</span>
                <span style={{ fontSize:'11px', color:'#D97706', fontWeight:600 }}>₹{p2r(w.pendingBalanceInPaise)}</span>
                <span style={{ fontSize:'11px', color:'#DC2626', fontWeight:600 }}>₹{p2r(w.lockedBalanceInPaise)}</span>
                <span style={{ fontSize:'11px', color:'#7C3AED', fontWeight:600 }}>₹{p2r(w.processingBalanceInPaise)}</span>
                <span style={{ fontSize:'11px', color:'#059669', fontWeight:600 }}>₹{p2r(w.lifetimeEarningsInPaise)}</span>
                <span style={{ fontSize:'11px', color:'#6B5E3E' }}>₹{p2r(w.lifetimeWithdrawalsInPaise)}</span>
                <span style={{ fontSize:'9px', fontWeight:800, background:sc.bg, color:sc.color, padding:'2px 6px', display:'inline-block' }}>{w.status || 'ACTIVE'}</span>
                <div style={{ display:'flex', gap:'3px', flexWrap:'wrap' }}>
                  {hasFreeze && w.status === 'ACTIVE' && (
                    <button onClick={() => handleFreeze(w, 'FREEZE')} disabled={freezeLoading===w.id}
                      style={{ background:'#2563EB', color:'#fff', border:'none', padding:'4px 6px', fontSize:'9px', fontWeight:700, cursor:'pointer', opacity:freezeLoading===w.id?0.6:1 }}>
                      ❄ FREEZE
                    </button>
                  )}
                  {hasFreeze && w.status === 'FROZEN' && (
                    <button onClick={() => handleFreeze(w, 'UNFREEZE')} disabled={freezeLoading===w.id}
                      style={{ background:'#059669', color:'#fff', border:'none', padding:'4px 6px', fontSize:'9px', fontWeight:700, cursor:'pointer', opacity:freezeLoading===w.id?0.6:1 }}>
                      ✓ UNFREEZE
                    </button>
                  )}
                  {hasFreeze && w.status !== 'BLOCKED' && (
                    <button onClick={() => handleFreeze(w, 'BLOCK')} disabled={freezeLoading===w.id}
                      style={{ background:'#DC2626', color:'#fff', border:'none', padding:'4px 6px', fontSize:'9px', fontWeight:700, cursor:'pointer', opacity:freezeLoading===w.id?0.6:1 }}>
                      ⊘ BLOCK
                    </button>
                  )}
                  {hasFreeze && w.status === 'BLOCKED' && (
                    <button onClick={() => handleFreeze(w, 'UNFREEZE')} disabled={freezeLoading===w.id}
                      style={{ background:'#059669', color:'#fff', border:'none', padding:'4px 6px', fontSize:'9px', fontWeight:700, cursor:'pointer', opacity:freezeLoading===w.id?0.6:1 }}>
                      ✓ UNBLOCK
                    </button>
                  )}
                  <button onClick={() => navigate(`/app/finance/wallets/${w.salonId}`)}
                    style={{ background:'#1A1A2E', color:'#fff', border:'none', padding:'4px 6px', fontSize:'9px', fontWeight:700, cursor:'pointer' }}>
                    LEDGER
                  </button>
                </div>
              </div>
            )
          })}

          {/* Pagination */}
          <div style={{ padding:'12px 14px', borderTop:'1px solid #E8DFD0', display:'flex', justifyContent:'space-between', alignItems:'center', background:'#FDFAF6' }}>
            <span style={{ fontSize:'11px', color:'#9E8E6E' }}>
              Showing {total===0?0:((page-1)*LIMIT)+1}–{Math.min(page*LIMIT,total)} of {total}
            </span>
            <div style={{ display:'flex', gap:'4px' }}>
              <button onClick={() => setPage(p => Math.max(1,p-1))} disabled={page===1}
                style={{ background:page===1?'#F5F0E8':'#1A1A2E', color:page===1?'#C4B49A':'#fff', border:'1px solid #D4C9B0', padding:'5px 10px', fontSize:'11px', fontWeight:700, cursor:page===1?'not-allowed':'pointer' }}>← PREV</button>
              {Array.from({length:Math.min(totalPages,7)},(_,i)=>i+1).map(p => (
                <button key={p} onClick={() => setPage(p)}
                  style={{ background:p===page?'#B8960C':'#fff', color:p===page?'#fff':'#6B5E3E', border:'1px solid #D4C9B0', padding:'5px 10px', fontSize:'11px', fontWeight:700, cursor:'pointer' }}>{p}</button>
              ))}
              <button onClick={() => setPage(p => Math.min(totalPages,p+1))} disabled={page===totalPages||totalPages===0}
                style={{ background:(page===totalPages||totalPages===0)?'#F5F0E8':'#1A1A2E', color:(page===totalPages||totalPages===0)?'#C4B49A':'#fff', border:'1px solid #D4C9B0', padding:'5px 10px', fontSize:'11px', fontWeight:700, cursor:(page===totalPages||totalPages===0)?'not-allowed':'pointer' }}>NEXT →</button>
            </div>
          </div>
        </BCard>

        {!hasFreeze && (
          <div style={{ marginTop:'10px', padding:'10px 14px', background:'#FEF2F2', border:'1px solid #FEE2E2', fontSize:'11px', color:'#991B1B', fontWeight:600 }}>
            ⊘ {adminLevel} — View Only. Freeze and Block actions require INDIA_ADMIN or SUPER_ADMIN.
          </div>
        )}
      </div>

      <div style={{ background:'#0D1B2A', borderTop:'2px solid #B8960C', padding:'10px 20px', display:'flex', justifyContent:'space-between', marginTop:'14px' }}>
        <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.3)' }}>BARBER ENGINE WALLET REGISTRY v1.0.0</span>
        <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.3)' }}>NATIONAL COMMAND CENTER</span>
      </div>
    </div>
  )
}