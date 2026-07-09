import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FONTS } from '../../../config/brand'
import useAuthStore from '../../../store/authStore'
import LocationAPI from '../api/location.api'

const ADMIN_LEVELS = { SUPER_ADMIN:'SUPER_ADMIN', INDIA_ADMIN:'INDIA_ADMIN', STATE_ADMIN:'STATE_ADMIN', DISTRICT_ADMIN:'DISTRICT_ADMIN' }
const canEdit   = (l) => [ADMIN_LEVELS.SUPER_ADMIN, ADMIN_LEVELS.INDIA_ADMIN].includes(l)
const canCreate = (l) => [ADMIN_LEVELS.SUPER_ADMIN, ADMIN_LEVELS.INDIA_ADMIN].includes(l)
const canExport = (l) => [ADMIN_LEVELS.SUPER_ADMIN, ADMIN_LEVELS.INDIA_ADMIN, ADMIN_LEVELS.STATE_ADMIN].includes(l)

const ZONE_COLORS = {
  NORTH:   { bg:'#EFF6FF', color:'#1D4ED8' },
  SOUTH:   { bg:'#F0FDF4', color:'#059669' },
  EAST:    { bg:'#FEF9C3', color:'#92400E' },
  WEST:    { bg:'#FDF4FF', color:'#7C3AED' },
  CENTRAL: { bg:'#FFF7ED', color:'#C2410C' },
  NE:      { bg:'#FEE2E2', color:'#991B1B' },
}

const TERRITORY_CONFIG = {
  OPEN:    { bg:'#D1FAE5', color:'#065F46', label:'OPEN'    },
  PARTIAL: { bg:'#FEF9C3', color:'#92400E', label:'PARTIAL' },
  CLOSED:  { bg:'#FEE2E2', color:'#991B1B', label:'CLOSED'  },
}

const STATUS_FILTER = ['ALL','ACTIVE','INACTIVE']
const SORT_OPTIONS  = [
  { val:'name',      label:'Sort: Name A-Z'       },
  { val:'newest',    label:'Sort: Recently Added' },
  { val:'districts', label:'Sort: Most Districts' },
]

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

export default function StatesPage() {
  const navigate   = useNavigate()
  const admin      = useAuthStore(s => s.admin)
  const adminLevel = admin?.adminLevel || ADMIN_LEVELS.SUPER_ADMIN
  const hasEdit    = canEdit(adminLevel)
  const hasCreate  = canCreate(adminLevel)
  const hasExport  = canExport(adminLevel)

  // NOTE: totalDistricts/totalSalons/avgCoverage now come from backend
  // meta (nationwide totals across ALL matching states), not just the
  // current page's 20 states. See fetchStates() below.
  const [states,    setStates]    = useState([])
  const [summary,   setSummary]   = useState({ total:0, active:0, inactive:0, totalDistricts:0, totalSalons:0, avgCoverage:0, unassigned:0 })
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState(null)
  const [total,     setTotal]     = useState(0)
  const [page,      setPage]      = useState(1)
  const [search,    setSearch]    = useState('')
  const [sort,      setSort]      = useState('name')
  const [isActive,  setIsActive]  = useState('ALL')
  const [toast,     setToast]     = useState(null)
  const [lastSync,  setLastSync]  = useState(null)
  const LIMIT = 20

  const showToast = (msg, color='#059669') => {
    setToast({ msg, color })
    setTimeout(() => setToast(null), 3000)
  }

  const fetchStates = useCallback(async () => {
    try {
      setLoading(true); setError(null)
      const params = { page, limit: LIMIT, sort }
      if (search)             params.search   = search
      if (isActive !== 'ALL') params.isActive = isActive === 'ACTIVE' ? 'true' : 'false'
      if (adminLevel === ADMIN_LEVELS.STATE_ADMIN && admin?.stateRef) {
        params.stateId = admin.stateRef
      }

      const res = await LocationAPI.getStates(params)
      const all = res.data || []
      setStates(all)
      setTotal(res.pagination?.total || 0)
      setLastSync(new Date())

      // CHANGED: totalDistricts/totalSalons/avgCoverage now read from
      // res.meta (nationwide, computed by backend across ALL filtered
      // states) instead of reducing over `all` (current page only).
      // Fallback to the old page-only calc only if the backend hasn't
      // been updated yet, so nothing breaks mid-deploy.
      setSummary({
        total:          res.pagination?.total || 0,
        active:         res.meta?.activeCount     ?? all.filter(s => s.isActive).length,
        inactive:       res.meta?.inactiveCount   ?? all.filter(s => !s.isActive).length,
        totalDistricts: res.meta?.totalDistricts  ?? all.reduce((s, st) => s + (st.districtCount || 0), 0),
        totalSalons:    res.meta?.totalSalons     ?? all.reduce((s, st) => s + (st.totalSalons    || 0), 0),
        avgCoverage:    res.meta?.avgCoverage     ?? (all.length > 0 ? Math.round(all.reduce((s, st) => s + (st.coverage || 0), 0) / all.length) : 0),
        unassigned:     res.meta?.unassignedCount ?? 0,
      })
    } catch (err) {
      setError(err.message || 'Failed to fetch states')
    } finally { setLoading(false) }
  }, [page, search, sort, isActive, adminLevel])

  useEffect(() => { fetchStates() }, [fetchStates])

  const totalPages      = Math.ceil(total / LIMIT)
  const paginationRange = getPaginationRange(page, totalPages || 1)

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
          <h1 style={{ fontSize:'13px', fontWeight:800, color:'#fff', margin:0, letterSpacing:'2px', textTransform:'uppercase' }}>States — Territory Engine</h1>
          <span style={{ background:'rgba(184,150,12,0.2)', color:'#B8960C', fontSize:'10px', fontWeight:800, padding:'2px 8px', border:'1px solid rgba(184,150,12,0.3)' }}>{total} STATES</span>
          {summary.unassigned > 0 && (
            <span style={{ background:'rgba(220,38,38,0.2)', color:'#FCA5A5', fontSize:'10px', fontWeight:800, padding:'2px 8px', border:'1px solid rgba(220,38,38,0.3)' }}>
              ⚠ {summary.unassigned} UNASSIGNED
            </span>
          )}
          {lastSync && <span style={{ fontSize:'9px', color:'rgba(255,255,255,0.3)' }}>Last sync: {lastSync.toLocaleTimeString('en-IN')}</span>}
        </div>
        <div style={{ display:'flex', gap:'8px' }}>
          <button onClick={() => navigate('/app/location/control')} style={{ background:'rgba(255,255,255,0.07)', border:'1px solid rgba(255,255,255,0.15)', color:'rgba(255,255,255,0.5)', padding:'6px 12px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>🗺 TERRITORY CONTROL</button>
          <button onClick={() => navigate('/app/location/districts')} style={{ background:'rgba(255,255,255,0.07)', border:'1px solid rgba(255,255,255,0.15)', color:'rgba(255,255,255,0.5)', padding:'6px 12px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>DISTRICTS ▸</button>
          {hasCreate && (
            <button onClick={() => navigate('/app/location/states/create')} style={{ background:'#B8960C', color:'#0D1B2A', border:'none', padding:'6px 14px', fontSize:'10px', fontWeight:800, cursor:'pointer' }}>+ CREATE STATE</button>
          )}
          <button onClick={fetchStates} style={{ background:'rgba(255,255,255,0.07)', border:'1px solid rgba(255,255,255,0.15)', color:'rgba(255,255,255,0.6)', padding:'6px 12px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>↻ REFRESH</button>
          {hasExport && <button onClick={() => showToast('Export triggered','#1D4ED8')} style={{ background:'rgba(184,150,12,0.15)', border:'1px solid rgba(184,150,12,0.4)', color:'#B8960C', padding:'6px 12px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>↓ EXPORT</button>}
        </div>
      </div>

      <div style={{ padding:'14px 20px' }}>

        {/* Summary Strip */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:'1px', background:'#D4C9B0', border:'1px solid #D4C9B0', marginBottom:'12px' }}>
          {[
            { label:'Total States',    value: summary.total,          color:'#B8960C' },
            { label:'Active States',   value: summary.active,         color:'#059669' },
            { label:'Total Districts', value: summary.totalDistricts, color:'#2563EB' },
            { label:'Total Salons',    value: summary.totalSalons,    color:'#7C3AED' },
            { label:'Avg Coverage',    value: `${summary.avgCoverage}%`, color:'#D97706' },
          ].map(m => (
            <div key={m.label} style={{ background:'#0D1B2A', padding:'12px 16px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <span style={{ fontSize:'11px', color:'rgba(255,255,255,0.4)' }}>{m.label}</span>
              <span style={{ fontSize:'18px', fontWeight:800, color:m.color }}>{m.value}</span>
            </div>
          ))}
        </div>

        {/* Status Cards */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:'8px', marginBottom:'12px' }}>
          {STATUS_FILTER.map(s => {
            const count = s === 'ALL' ? summary.total : s === 'ACTIVE' ? summary.active : summary.inactive
            const color = s === 'ACTIVE' ? '#059669' : s === 'INACTIVE' ? '#DC2626' : '#1A1A2E'
            return (
              <div key={s} onClick={() => { setIsActive(s); setPage(1) }}
                style={{ background:isActive===s?color:'#fff', border:`1px solid ${color}30`, borderTop:`2px solid ${color}`, padding:'12px', cursor:'pointer', textAlign:'center' }}>
                <div style={{ fontSize:'22px', fontWeight:800, color:isActive===s?'#fff':color }}>{count}</div>
                <div style={{ fontSize:'9px', color:isActive===s?'rgba(255,255,255,0.8)':'#9E8E6E', textTransform:'uppercase', letterSpacing:'0.5px', marginTop:'2px' }}>{s}</div>
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
            <input value={search} onChange={e => { setSearch(e.target.value); setPage(1) }}
              placeholder="Search state, code, admin..."
              style={{ flex:1, minWidth:'200px', border:'1px solid #D4C9B0', padding:'6px 10px', fontSize:'12px', fontFamily:FONTS.body, outline:'none', background:'#FDFAF6' }}/>
            <select value={sort} onChange={e => { setSort(e.target.value); setPage(1) }}
              style={{ border:'1px solid #D4C9B0', padding:'5px 8px', fontSize:'11px', color:'#6B5E3E', background:'#FDFAF6', cursor:'pointer', fontFamily:FONTS.body, outline:'none' }}>
              {SORT_OPTIONS.map(o => <option key={o.val} value={o.val}>{o.label}</option>)}
            </select>
            <span style={{ fontSize:'11px', color:'#9E8E6E' }}>{states.length} results</span>
            <button onClick={() => { setSearch(''); setSort('name'); setIsActive('ALL'); setPage(1) }}
              style={{ background:'#F5F0E8', border:'1px solid #D4C9B0', color:'#9E8E6E', padding:'5px 10px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>RESET</button>
          </div>
        </BCard>

        {/* Table */}
        <BCard>
          <BCardHeader title={`State Registry (${total})`} action={
            <div style={{ display:'flex', gap:'8px', alignItems:'center' }}>
              <button onClick={fetchStates} style={{ background:'#F5F0E8', border:'1px solid #D4C9B0', color:'#6B5E3E', padding:'4px 10px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>↻ REFRESH</button>
              <span style={{ fontSize:'11px', color:'#9E8E6E' }}>Page {page}/{totalPages||1}</span>
            </div>
          }/>

          {/* Table Header */}
          <div style={{ display:'grid', gridTemplateColumns:'0.4fr 1.6fr 0.5fr 0.7fr 0.6fr 0.8fr 1.2fr 0.7fr 1fr', padding:'8px 14px', background:'#F5F0E8', borderBottom:'1px solid #E8DFD0', gap:'8px' }}>
            {['CODE','STATE NAME','DIST.','AREAS','SALONS','COVERAGE','TERRITORY','STATUS','ACTIONS'].map(h => (
              <span key={h} style={{ fontSize:'9px', fontWeight:800, color:'#9E8E6E', letterSpacing:'1px' }}>{h}</span>
            ))}
          </div>

          {loading ? (
            <div style={{ padding:'40px', textAlign:'center', color:'#9E8E6E' }}>Loading states...</div>
          ) : error ? (
            <div style={{ padding:'40px', textAlign:'center', color:'#DC2626' }}>{error}</div>
          ) : states.length === 0 ? (
            <div style={{ padding:'40px', textAlign:'center', color:'#9E8E6E' }}>No states found</div>
          ) : states.map((s, i) => {
            const tc = TERRITORY_CONFIG[s.territory] || TERRITORY_CONFIG.CLOSED
            const zc = ZONE_COLORS[s.zone] || { bg:'#F3F4F6', color:'#6B7280' }
            return (
              <div key={s.id} style={{ display:'grid', gridTemplateColumns:'0.4fr 1.6fr 0.5fr 0.7fr 0.6fr 0.8fr 1.2fr 0.7fr 1fr', padding:'10px 14px', borderBottom:'1px solid #F0EAE0', alignItems:'center', gap:'8px', background:i%2===0?'#fff':'#FDFAF6', cursor:'pointer' }}
                onClick={() => navigate(`/app/location/states/${s.id}`)}>
                <span style={{ fontSize:'11px', fontWeight:800, color:'#B8960C', fontFamily:'monospace' }}>{s.code || '—'}</span>
                <div>
                  <div style={{ fontSize:'12px', fontWeight:700, color:'#1A1A2E' }}>{s.name}</div>
                  {s.stateAdmin
                    ? <div style={{ fontSize:'9px', color:'#059669' }}>👤 {s.stateAdmin.name}</div>
                    : <div style={{ fontSize:'9px', color:'#DC2626' }}>⚠ No Admin</div>
                  }
                </div>
                <span style={{ fontSize:'13px', fontWeight:800, color:'#2563EB' }}>{s.districtCount ?? 0}</span>
                <span style={{ fontSize:'12px', color:'#6B5E3E', fontWeight:600 }}>{s.totalAreas ?? 0}</span>
                <span style={{ fontSize:'12px', color:'#7C3AED', fontWeight:600 }}>{s.totalSalons ?? 0}</span>
                <div>
                  <div style={{ display:'flex', alignItems:'center', gap:'4px', marginBottom:'2px' }}>
                    <div style={{ flex:1, height:'6px', background:'#E8DFD0', position:'relative' }}>
                      <div style={{ position:'absolute', left:0, top:0, height:'100%', width:`${s.coverage ?? 0}%`,
                        background: (s.coverage??0) >= 80 ? '#059669' : (s.coverage??0) >= 40 ? '#D97706' : '#DC2626'
                      }}/>
                    </div>
                    <span style={{ fontSize:'9px', color:'#6B5E3E', fontWeight:700, minWidth:'28px' }}>{s.coverage ?? 0}%</span>
                  </div>
                </div>
                <span style={{ fontSize:'9px', fontWeight:800, background:tc.bg, color:tc.color, padding:'2px 6px', display:'inline-block' }}>
                  {tc.label}
                </span>
                <span style={{ fontSize:'9px', fontWeight:800, background:s.isActive?'#D1FAE5':'#FEE2E2', color:s.isActive?'#065F46':'#991B1B', padding:'2px 6px', display:'inline-block' }}>
                  {s.isActive ? 'ACTIVE' : 'INACTIVE'}
                </span>
                <div style={{ display:'flex', gap:'3px' }}>
                  <button onClick={e => { e.stopPropagation(); navigate(`/app/location/states/${s.id}`) }}
                    style={{ background:'#1A1A2E', color:'#fff', border:'none', padding:'4px 7px', fontSize:'9px', fontWeight:700, cursor:'pointer' }}>VIEW</button>
                  {hasEdit && (
                    <button onClick={e => { e.stopPropagation(); navigate(`/app/location/states/${s.id}/edit`) }}
                      style={{ background:'#B8960C', color:'#0D1B2A', border:'none', padding:'4px 7px', fontSize:'9px', fontWeight:700, cursor:'pointer' }}>EDIT</button>
                  )}
                  <button onClick={e => { e.stopPropagation(); navigate(`/app/location/districts?stateId=${s.id}`) }}
                    style={{ background:'#2563EB', color:'#fff', border:'none', padding:'4px 7px', fontSize:'9px', fontWeight:700, cursor:'pointer' }}>DIST</button>
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

        {!hasEdit && (
          <div style={{ marginTop:'10px', padding:'10px 14px', background:'#FEF2F2', border:'1px solid #FEE2E2', fontSize:'11px', color:'#991B1B', fontWeight:600 }}>
            ⊘ {adminLevel} — View Only. Contact INDIA_ADMIN to edit states.
          </div>
        )}
      </div>

      <div style={{ background:'#0D1B2A', borderTop:'2px solid #B8960C', padding:'10px 20px', display:'flex', justifyContent:'space-between', marginTop:'14px' }}>
        <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.3)' }}>BARBER ENGINE STATE REGISTRY v1.0.0</span>
        <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.3)' }}>NATIONAL COMMAND CENTER</span>
      </div>
    </div>
  )
}