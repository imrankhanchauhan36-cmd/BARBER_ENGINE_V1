import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { FONTS } from '../../../config/brand'
import useAuthStore from '../../../store/authStore'
import LocationAPI from '../api/location.api'

const STATUS_COLORS    = { ACTIVE:{ bg:'#D1FAE5',color:'#065F46' }, INACTIVE:{ bg:'#F3F4F6',color:'#374151' } }
const TERRITORY_COLORS = { OPEN:{ bg:'#D1FAE5',color:'#065F46' }, PARTIAL:{ bg:'#FEF9C3',color:'#92400E' }, CLOSED:{ bg:'#FEE2E2',color:'#991B1B' } }

// Matches backend User.adminLevel enum exactly: "INDIA" | "STATE" | "DISTRICT"
const ADMIN_LEVELS = { INDIA:'INDIA', STATE:'STATE', DISTRICT:'DISTRICT' }
const canCreate     = (l) => [ADMIN_LEVELS.INDIA, ADMIN_LEVELS.STATE].includes(l)

const PER_PAGE = 20

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

export default function DistrictsPage() {
  const navigate       = useNavigate()
  const [searchParams] = useSearchParams()
  const admin           = useAuthStore(s => s.admin)
  const adminLevel      = admin?.adminLevel || null
  const hasCreate       = canCreate(adminLevel)

  const [searchInput, setSearchInput] = useState('')
  const [search,      setSearch]      = useState('')
  const [status,      setStatus]      = useState('ALL')
  const [territory,   setTerritory]   = useState('ALL')
  const [stateFilter, setStateFilter] = useState(searchParams.get('stateId') || '')
  const [page,        setPage]        = useState(1)

  const [districts,  setDistricts]  = useState([])
  const [pagination, setPagination] = useState({ page:1, limit:PER_PAGE, total:0, totalPages:1 })
  const [meta,        setMeta]        = useState({
    unassignedCount:0, activeCount:0, inactiveCount:0, closedTerritoryCount:0,
    totalCities:0, totalSalons:0, avgCoverage:0,
  })
  const [statesList, setStatesList] = useState([])

  const [loading,   setLoading]   = useState(true)
  const [refreshing,setRefreshing]= useState(false)
  const [error,     setError]     = useState(null)

  const fetchIdRef = useRef(0)

  useEffect(() => {
    const t = setTimeout(() => { setSearch(searchInput); setPage(1) }, 350)
    return () => clearTimeout(t)
  }, [searchInput])

  useEffect(() => {
    LocationAPI.getStates({ limit: 100, sort: 'name' })
      .then(res => setStatesList(res.data || []))
      .catch(() => {})
  }, [])

  const fetchDistricts = useCallback((isManualRefresh = false) => {
    const id = ++fetchIdRef.current
    if (isManualRefresh) setRefreshing(true)
    else setLoading(true)
    setError(null)

    const params = {
      page, limit: PER_PAGE,
      ...(search      ? { search } : {}),
      ...(stateFilter ? { stateId: stateFilter } : {}),
      ...(status !== 'ALL'    ? { isActive: status === 'ACTIVE' } : {}),
      ...(territory !== 'ALL' ? { territory } : {}),
    }

    LocationAPI.getDistricts(params)
      .then(res => {
        if (fetchIdRef.current !== id) return
        setDistricts(res.data || [])
        setPagination(res.pagination || { page:1, limit:PER_PAGE, total:0, totalPages:1 })
        setMeta(res.meta || {
          unassignedCount:0, activeCount:0, inactiveCount:0, closedTerritoryCount:0,
          totalCities:0, totalSalons:0, avgCoverage:0,
        })
      })
      .catch(err => {
        if (fetchIdRef.current !== id) return
        setError(err.message || 'Failed to load districts')
        setDistricts([])
      })
      .finally(() => {
        if (fetchIdRef.current === id) { setLoading(false); setRefreshing(false) }
      })
  }, [page, search, stateFilter, status, territory])

  useEffect(() => { fetchDistricts(false) }, [fetchDistricts])

  const resetFilters = () => {
    setSearchInput(''); setSearch(''); setStatus('ALL'); setTerritory('ALL'); setStateFilter(''); setPage(1)
  }

  const quickFilters = [
    { label:'Total',            count:pagination.total,          color:'#1A1A2E', kind:'status',    value:'ALL'      },
    { label:'Active',           count:meta.activeCount,          color:'#059669', kind:'status',    value:'ACTIVE'   },
    { label:'Inactive',         count:meta.inactiveCount,        color:'#374151', kind:'status',    value:'INACTIVE' },
    { label:'Closed Territory', count:meta.closedTerritoryCount, color:'#DC2626', kind:'territory', value:'CLOSED'   },
  ]
  const isQuickFilterActive = (f) => f.kind === 'status' ? status === f.value : territory === f.value
  const applyQuickFilter = (f) => {
    if (f.kind === 'status') { setStatus(f.value); setTerritory('ALL') }
    else { setTerritory(f.value); setStatus('ALL') }
    setPage(1)
  }

  return (
    <div style={{ fontFamily:FONTS.body, background:'#F0EAE0', minHeight:'100vh' }}>

      <div style={{ background:'#0D1B2A', borderBottom:'2px solid #B8960C', padding:'0 20px', height:'52px', display:'flex', alignItems:'center', justifyContent:'space-between', position:'sticky', top:0, zIndex:10 }}>
        <div style={{ display:'flex', alignItems:'center', gap:'12px' }}>
          <button onClick={() => navigate('/app/location/states')} style={{ background:'rgba(255,255,255,0.07)', border:'1px solid rgba(255,255,255,0.1)', color:'rgba(255,255,255,0.6)', padding:'5px 10px', cursor:'pointer', fontSize:'12px', fontWeight:700 }}>← STATES</button>
          <div style={{ width:'3px', height:'16px', background:'#B8960C' }}/>
          <h1 style={{ fontSize:'13px', fontWeight:800, color:'#fff', margin:0, letterSpacing:'2px', textTransform:'uppercase' }}>Districts — Territory Engine</h1>
          <span style={{ background:'rgba(184,150,12,0.2)', color:'#B8960C', fontSize:'10px', fontWeight:800, padding:'2px 8px', border:'1px solid rgba(184,150,12,0.3)' }}>{pagination.total} DISTRICTS</span>
          {meta.unassignedCount > 0 && (
            <span style={{ background:'rgba(220,38,38,0.2)', color:'#FCA5A5', fontSize:'10px', fontWeight:800, padding:'2px 8px', border:'1px solid rgba(220,38,38,0.3)' }}>
              ⚠ {meta.unassignedCount} UNASSIGNED
            </span>
          )}
        </div>
        <div style={{ display:'flex', gap:'8px' }}>
          <button onClick={() => fetchDistricts(true)} disabled={refreshing || loading}
            style={{ background:'rgba(255,255,255,0.07)', border:'1px solid rgba(255,255,255,0.15)', color:'rgba(255,255,255,0.6)', padding:'6px 12px', fontSize:'10px', fontWeight:700, cursor:(refreshing||loading)?'not-allowed':'pointer' }}>
            {refreshing ? '⟳ REFRESHING…' : '⟳ REFRESH'}
          </button>
          <button onClick={() => navigate('/app/location/admin-assignment')} style={{ background:'rgba(124,58,237,0.15)', border:'1px solid rgba(124,58,237,0.4)', color:'#C4B5FD', padding:'6px 12px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>👤 ADMIN ASSIGNMENT</button>
          <button onClick={() => navigate('/app/location/control')} style={{ background:'rgba(220,38,38,0.15)', border:'1px solid rgba(220,38,38,0.4)', color:'#FCA5A5', padding:'6px 12px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>⊘ TERRITORY CONTROL</button>
          {hasCreate && <button onClick={() => navigate('/app/location/districts/new')} style={{ background:'#B8960C', border:'none', color:'#0D1B2A', padding:'6px 14px', fontSize:'10px', fontWeight:800, cursor:'pointer' }}>+ CREATE DISTRICT</button>}
          <button onClick={() => alert('CSV export is not available yet.')} style={{ background:'rgba(255,255,255,0.07)', border:'1px solid rgba(255,255,255,0.15)', color:'rgba(255,255,255,0.6)', padding:'6px 12px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>↓ EXPORT</button>
        </div>
      </div>

      <div style={{ padding:'14px 20px' }}>

        {error && (
          <div style={{ background:'#FEF2F2', border:'1px solid #FEE2E2', borderLeft:'4px solid #DC2626', padding:'10px 16px', marginBottom:'12px', fontSize:'12px', color:'#991B1B', fontWeight:600 }}>
            ⚠ {error}
          </div>
        )}

        <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:'1px', background:'#D4C9B0', border:'1px solid #D4C9B0', marginBottom:'12px' }}>
          {[
            { label:'Total Districts', value:pagination.total,                          color:'#B8960C' },
            { label:'Active',          value:meta.activeCount,                          color:'#059669' },
            { label:'Total Cities',    value:meta.totalCities.toLocaleString('en-IN'),  color:'#2563EB' },
            { label:'Total Salons',    value:meta.totalSalons.toLocaleString('en-IN'),  color:'#7C3AED' },
            { label:'Avg Coverage',    value:`${meta.avgCoverage}%`,                    color:'#D97706' },
          ].map(m => (
            <div key={m.label} style={{ background:'#0D1B2A', padding:'12px 16px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <span style={{ fontSize:'11px', color:'rgba(255,255,255,0.4)' }}>{m.label}</span>
              <span style={{ fontSize:'18px', fontWeight:800, color:m.color }}>{m.value}</span>
            </div>
          ))}
        </div>

        <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:'10px', marginBottom:'12px' }}>
          {quickFilters.map(f => {
            const active = isQuickFilterActive(f)
            return (
              <div key={f.label} onClick={() => applyQuickFilter(f)}
                style={{ background:active?f.color:'#fff', border:`1px solid ${f.color}30`, borderTop:`2px solid ${f.color}`, padding:'12px 14px', cursor:'pointer', textAlign:'center' }}>
                <div style={{ fontSize:'22px', fontWeight:800, color:active?'#fff':f.color }}>{f.count}</div>
                <div style={{ fontSize:'9px', color:active?'rgba(255,255,255,0.8)':'#9E8E6E', textTransform:'uppercase', letterSpacing:'0.5px', marginTop:'2px' }}>{f.label}</div>
              </div>
            )
          })}
        </div>

        <BCard style={{ marginBottom:'12px' }}>
          <div style={{ padding:'10px 14px', display:'flex', gap:'8px', alignItems:'center', flexWrap:'wrap' }}>
            <div style={{ display:'flex', alignItems:'center', gap:'6px' }}>
              <div style={{ width:'3px', height:'14px', background:'#B8960C' }}/>
              <span style={{ fontSize:'10px', fontWeight:800, color:'#9E8E6E', letterSpacing:'1px' }}>FILTERS</span>
            </div>
            <input value={searchInput} onChange={e => setSearchInput(e.target.value)}
              placeholder="Search district or admin name..."
              style={{ flex:1, minWidth:'180px', border:'1px solid #D4C9B0', padding:'6px 10px', fontSize:'12px', fontFamily:FONTS.body, outline:'none', background:'#FDFAF6' }}
            />
            <select value={stateFilter} onChange={e => { setStateFilter(e.target.value); setPage(1) }}
              style={{ border:'1px solid #D4C9B0', padding:'5px 8px', fontSize:'11px', color:'#6B5E3E', background:'#FDFAF6', cursor:'pointer', fontFamily:FONTS.body, outline:'none' }}>
              <option value="">All States</option>
              {statesList.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <select value={status} onChange={e => { setStatus(e.target.value); setPage(1) }}
              style={{ border:'1px solid #D4C9B0', padding:'5px 8px', fontSize:'11px', color:'#6B5E3E', background:'#FDFAF6', cursor:'pointer', fontFamily:FONTS.body, outline:'none' }}>
              {['ALL','ACTIVE','INACTIVE'].map(o => <option key={o} value={o}>{o}</option>)}
            </select>
            <select value={territory} onChange={e => { setTerritory(e.target.value); setPage(1) }}
              style={{ border:'1px solid #D4C9B0', padding:'5px 8px', fontSize:'11px', color:'#6B5E3E', background:'#FDFAF6', cursor:'pointer', fontFamily:FONTS.body, outline:'none' }}>
              {['ALL','OPEN','PARTIAL','CLOSED'].map(o => <option key={o} value={o}>{o}</option>)}
            </select>
            <span style={{ fontSize:'11px', color:'#9E8E6E' }}>{pagination.total} results</span>
            <button onClick={resetFilters}
              style={{ background:'#F5F0E8', border:'1px solid #D4C9B0', color:'#9E8E6E', padding:'5px 10px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>RESET</button>
          </div>
        </BCard>

        <BCard>
          <BCardHeader title={`District Registry (${pagination.total})`} action={
            <span style={{ fontSize:'11px', color:'#9E8E6E' }}>Page {pagination.page} of {pagination.totalPages || 1}</span>
          }/>
          <div style={{ display:'grid', gridTemplateColumns:'0.7fr 1.4fr 0.6fr 0.6fr 0.7fr 0.8fr 0.8fr 0.7fr 1.2fr 1fr', padding:'8px 14px', background:'#F5F0E8', borderBottom:'1px solid #E8DFD0', gap:'8px' }}>
            {['CODE','DISTRICT','STATE','AREAS','SALONS','COVERAGE','TERRITORY','STATUS','DISTRICT ADMIN','ACTIONS'].map(h => (
              <span key={h} style={{ fontSize:'9px', fontWeight:800, color:'#9E8E6E', letterSpacing:'1px' }}>{h}</span>
            ))}
          </div>

          {loading
            ? <div style={{ padding:'40px', textAlign:'center', color:'#9E8E6E' }}>Loading districts…</div>
            : districts.length === 0
              ? <div style={{ padding:'40px', textAlign:'center', color:'#9E8E6E' }}>No districts found</div>
              : districts.map((d, i) => {
                const isActive = !!d.isActive
                const st = isActive ? STATUS_COLORS.ACTIVE : STATUS_COLORS.INACTIVE
                const tt = TERRITORY_COLORS[d.territory] || TERRITORY_COLORS.PARTIAL
                const lowCoverage = d.coverage < 50
                const adminName = d.districtAdmin?.name || 'Not Assigned'
                return (
                  <div key={d.id} style={{ display:'grid', gridTemplateColumns:'0.7fr 1.4fr 0.6fr 0.6fr 0.7fr 0.8fr 0.8fr 0.7fr 1.2fr 1fr', padding:'10px 14px', borderBottom:'1px solid #F0EAE0', alignItems:'center', gap:'8px', background:d.territory==='CLOSED'?'#FEF2F2':i%2===0?'#fff':'#FDFAF6' }}>
                    <span style={{ fontSize:'11px', color:'#9E8E6E', fontFamily:'monospace', fontWeight:600 }}>{d.code}</span>
                    <div>
                      <div style={{ fontSize:'13px', fontWeight:700, color:'#1A1A2E' }}>{d.name}</div>
                      {d.closedReason && <div style={{ fontSize:'9px', color:'#DC2626', fontWeight:600 }}>⊘ {d.closedReason}</div>}
                    </div>
                    <span style={{ fontSize:'11px', fontWeight:700, color:'#B8960C' }}>{d.state?.code}</span>
                    <span style={{ fontSize:'12px', color:'#6B5E3E' }}>{d.cityCount}</span>
                    <span style={{ fontSize:'12px', fontWeight:600, color:'#1A1A2E' }}>{d.salonCount}</span>
                    <div>
                      <div style={{ height:'4px', background:'#E8DFD0', marginBottom:'3px' }}>
                        <div style={{ height:'100%', width:`${d.coverage}%`, background:d.coverage>=80?'#059669':d.coverage>=60?'#D97706':'#DC2626' }}/>
                      </div>
                      <div style={{ display:'flex', alignItems:'center', gap:'4px' }}>
                        <span style={{ fontSize:'9px', color:'#9E8E6E' }}>{d.coverage}%</span>
                        {lowCoverage && <span style={{ fontSize:'8px', color:'#DC2626', fontWeight:800 }}>⚠LOW</span>}
                      </div>
                    </div>
                    <span style={{ fontSize:'9px', fontWeight:800, background:tt.bg, color:tt.color, padding:'2px 6px', display:'inline-block' }}>{d.territory}</span>
                    <span style={{ fontSize:'9px', fontWeight:800, background:st.bg, color:st.color, padding:'2px 6px', display:'inline-block' }}>{isActive ? 'ACTIVE' : 'INACTIVE'}</span>
                    <div>
                      <button onClick={() => navigate('/app/location/admin-assignment')}
                        style={{ background:'none', border:'none', cursor:'pointer', padding:0, textAlign:'left' }}>
                        <div style={{ fontSize:'12px', color:adminName==='Not Assigned'?'#DC2626':'#2563EB', fontWeight:600, textDecoration:adminName==='Not Assigned'?'none':'underline' }}>{adminName}</div>
                      </button>
                      {adminName==='Not Assigned' && <div style={{ fontSize:'9px', color:'#DC2626', fontWeight:700 }}>⚠ UNASSIGNED</div>}
                    </div>
                    <div style={{ display:'flex', gap:'3px' }}>
                      <button onClick={() => navigate(`/app/location/districts/${d.id}`)} style={{ background:'#1A1A2E', color:'#fff', border:'none', padding:'4px 7px', fontSize:'9px', fontWeight:700, cursor:'pointer' }}>VIEW</button>
                      {hasCreate && <button onClick={() => navigate(`/app/location/districts/${d.id}/edit`)} style={{ background:'#B8960C', color:'#fff', border:'none', padding:'4px 7px', fontSize:'9px', fontWeight:700, cursor:'pointer' }}>EDIT</button>}
                      <button onClick={() => navigate(`/app/location/areas?districtId=${d.id}`)} style={{ background:'#2563EB', color:'#fff', border:'none', padding:'4px 7px', fontSize:'9px', fontWeight:700, cursor:'pointer' }}>AREAS</button>
                    </div>
                  </div>
                )
              })
          }

          <div style={{ padding:'12px 14px', borderTop:'1px solid #E8DFD0', display:'flex', justifyContent:'space-between', alignItems:'center', background:'#FDFAF6' }}>
            <span style={{ fontSize:'11px', color:'#9E8E6E' }}>
              Showing {pagination.total===0?0:((pagination.page-1)*pagination.limit)+1}–{Math.min(pagination.page*pagination.limit, pagination.total)} of {pagination.total}
            </span>
            <div style={{ display:'flex', gap:'4px' }}>
              <button onClick={() => setPage(p=>Math.max(1,p-1))} disabled={page===1}
                style={{ background:page===1?'#F5F0E8':'#1A1A2E', color:page===1?'#C4B49A':'#fff', border:'1px solid #D4C9B0', padding:'5px 10px', fontSize:'11px', fontWeight:700, cursor:page===1?'not-allowed':'pointer' }}>← PREV</button>
              <span style={{ fontSize:'11px', color:'#6B5E3E', padding:'5px 8px' }}>{page} / {pagination.totalPages || 1}</span>
              <button onClick={() => setPage(p=>Math.min(pagination.totalPages,p+1))} disabled={page===pagination.totalPages||pagination.totalPages===0}
                style={{ background:(page===pagination.totalPages||pagination.totalPages===0)?'#F5F0E8':'#1A1A2E', color:(page===pagination.totalPages||pagination.totalPages===0)?'#C4B49A':'#fff', border:'1px solid #D4C9B0', padding:'5px 10px', fontSize:'11px', fontWeight:700, cursor:(page===pagination.totalPages||pagination.totalPages===0)?'not-allowed':'pointer' }}>NEXT →</button>
            </div>
          </div>
        </BCard>
      </div>

      <div style={{ background:'#0D1B2A', borderTop:'2px solid #B8960C', padding:'10px 20px', display:'flex', justifyContent:'space-between', marginTop:'14px' }}>
        <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.3)', letterSpacing:'0.5px' }}>ZEMISH TERRITORY ENGINE v1.0.0</span>
        <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.3)', letterSpacing:'0.5px' }}>NATIONAL COMMAND CENTER</span>
      </div>
    </div>
  )
}