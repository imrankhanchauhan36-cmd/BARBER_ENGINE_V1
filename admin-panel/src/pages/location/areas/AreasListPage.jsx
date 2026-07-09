import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FONTS } from '../../../config/brand'
import useAuthStore from '../../../store/authStore'
import LocationAPI from '../api/location.api'

const ADMIN_LEVELS = { SUPER_ADMIN:'SUPER_ADMIN', INDIA_ADMIN:'INDIA_ADMIN', STATE_ADMIN:'STATE_ADMIN', DISTRICT_ADMIN:'DISTRICT_ADMIN' }
const canCreate = (l) => [ADMIN_LEVELS.SUPER_ADMIN, ADMIN_LEVELS.INDIA_ADMIN, ADMIN_LEVELS.STATE_ADMIN, ADMIN_LEVELS.DISTRICT_ADMIN].includes(l)
const canEdit   = (l) => [ADMIN_LEVELS.SUPER_ADMIN, ADMIN_LEVELS.INDIA_ADMIN, ADMIN_LEVELS.STATE_ADMIN, ADMIN_LEVELS.DISTRICT_ADMIN].includes(l)
const canExport = (l) => [ADMIN_LEVELS.SUPER_ADMIN, ADMIN_LEVELS.INDIA_ADMIN, ADMIN_LEVELS.STATE_ADMIN].includes(l)

const TIER_COLORS = {
  TIER_1: { bg:'#FEF9C3', color:'#92400E' },
  TIER_2: { bg:'#EFF6FF', color:'#1D4ED8' },
  TIER_3: { bg:'#F0FDF4', color:'#059669' },
  RURAL:  { bg:'#F3F4F6', color:'#374151' },
}

const TYPE_COLORS = {
  RESIDENTIAL: { bg:'#F0FDF4', color:'#059669' },
  COMMERCIAL:  { bg:'#EFF6FF', color:'#1D4ED8' },
  INDUSTRIAL:  { bg:'#FEF9C3', color:'#92400E' },
  MIXED:       { bg:'#FDF4FF', color:'#7C3AED' },
}

const SORT_OPTIONS = [
  { val:'name',    label:'Sort: Name A-Z'       },
  { val:'newest',  label:'Sort: Recently Added' },
  { val:'pincode', label:'Sort: Pincode'        },
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

export default function AreasListPage() {
  const navigate   = useNavigate()
  const admin      = useAuthStore(s => s.admin)
  const adminLevel = admin?.adminLevel || ADMIN_LEVELS.SUPER_ADMIN
  const hasCreate  = canCreate(adminLevel)
  const hasEdit    = canEdit(adminLevel)
  const hasExport  = canExport(adminLevel)

  const [areas,         setAreas]         = useState([])
  const [states,        setStates]        = useState([])
  const [districts,     setDistricts]     = useState([])
  const [cities,        setCities]        = useState([])
  const [loading,       setLoading]       = useState(true)
  const [error,         setError]         = useState(null)
  const [total,         setTotal]         = useState(0)
  const [page,          setPage]          = useState(1)
  const [search,        setSearch]        = useState('')
  const [sort,          setSort]          = useState('name')
  const [stateFilter,   setStateFilter]   = useState('ALL')
  const [distFilter,    setDistFilter]    = useState('ALL')
  const [cityFilter,    setCityFilter]    = useState('ALL')
  const [isActive,      setIsActive]      = useState('ALL')
  const [isServiceable, setIsServiceable] = useState('ALL')
  const [showCreate,    setShowCreate]    = useState(false)
  const [creating,      setCreating]      = useState(false)
  const [toast,         setToast]         = useState(null)
  const [lastSync,      setLastSync]      = useState(null)
  const [form,          setForm]          = useState({
    name:'', cityId:'', districtId:'', stateId:'', pincode:'', isServiceable: true, type:'MIXED'
  })
  const LIMIT = 20

  const showToast = (msg, color='#059669') => {
    setToast({ msg, color })
    setTimeout(() => setToast(null), 3000)
  }

  const fetchAreas = useCallback(async () => {
    try {
      setLoading(true); setError(null)
      const params = { page, limit: LIMIT, sort }
      if (search)                 params.search        = search
      if (stateFilter  !== 'ALL') params.stateId       = stateFilter
      if (distFilter   !== 'ALL') params.districtId    = distFilter
      if (cityFilter   !== 'ALL') params.cityId        = cityFilter
      if (isActive     !== 'ALL') params.isActive      = isActive      === 'ACTIVE'       ? 'true' : 'false'
      if (isServiceable!== 'ALL') params.isServiceable = isServiceable === 'SERVICEABLE'  ? 'true' : 'false'

      if (adminLevel === ADMIN_LEVELS.STATE_ADMIN    && admin?.stateRef)    params.stateId    = admin.stateRef
      if (adminLevel === ADMIN_LEVELS.DISTRICT_ADMIN && admin?.districtRef) params.districtId = admin.districtRef

      const res = await LocationAPI.getAreas(params)
      setAreas(res.data || [])
      setTotal(res.pagination?.total || 0)
      setLastSync(new Date())
    } catch (err) {
      setError(err.message || 'Failed to fetch areas')
    } finally { setLoading(false) }
  }, [page, search, sort, stateFilter, distFilter, cityFilter, isActive, isServiceable, adminLevel])

  const fetchStates    = useCallback(async () => {
    try { const r = await LocationAPI.getStates({ limit:100 });    setStates(r.data||[])    } catch {}
  }, [])
  const fetchDistricts = useCallback(async () => {
    if (stateFilter==='ALL') { setDistricts([]); return }
    try { const r = await LocationAPI.getDistricts({ stateId:stateFilter, limit:100 }); setDistricts(r.data||[]) } catch {}
  }, [stateFilter])
  const fetchCities    = useCallback(async () => {
    if (distFilter==='ALL') { setCities([]); return }
    try { const r = await LocationAPI.getCities({ districtId:distFilter, limit:100 }); setCities(r.data||[]) } catch {}
  }, [distFilter])

  useEffect(() => { fetchAreas()    }, [fetchAreas])
  useEffect(() => { fetchStates()   }, [fetchStates])
  useEffect(() => { fetchDistricts()}, [fetchDistricts])
  useEffect(() => { fetchCities()   }, [fetchCities])

  const handleCreate = async () => {
    if (!form.name || !form.cityId || !form.districtId || !form.stateId) {
      showToast('Name, City, District and State required', '#DC2626'); return
    }
    if (form.pincode && !/^\d{6}$/.test(form.pincode)) {
      showToast('Pincode must be 6 digits', '#DC2626'); return
    }
    try {
      setCreating(true)
      await LocationAPI.createArea(form)
      showToast(`✓ Area "${form.name}" created`)
      setShowCreate(false)
      setForm({ name:'', cityId:'', districtId:'', stateId:'', pincode:'', isServiceable:true, type:'MIXED' })
      fetchAreas()
    } catch (err) {
      showToast(err.message || 'Create failed', '#DC2626')
    } finally { setCreating(false) }
  }

  const totalPages      = Math.ceil(total / LIMIT)
  const paginationRange = getPaginationRange(page, totalPages || 1)
  const serviceableCount = areas.filter(a => a.isServiceable).length
  const notServiceable   = areas.filter(a => !a.isServiceable).length

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
          <button onClick={() => navigate('/app/location/cities')} style={{ background:'transparent', border:'none', color:'rgba(255,255,255,0.5)', cursor:'pointer', fontSize:'18px' }}>←</button>
          <div style={{ width:'3px', height:'16px', background:'#B8960C' }}/>
          <h1 style={{ fontSize:'13px', fontWeight:800, color:'#fff', margin:0, letterSpacing:'2px', textTransform:'uppercase' }}>Areas</h1>
          <span style={{ background:'rgba(184,150,12,0.2)', color:'#B8960C', fontSize:'10px', fontWeight:800, padding:'2px 8px', border:'1px solid rgba(184,150,12,0.3)' }}>{total} AREAS</span>
          {lastSync && <span style={{ fontSize:'9px', color:'rgba(255,255,255,0.3)' }}>Last sync: {lastSync.toLocaleTimeString('en-IN')}</span>}
        </div>
        <div style={{ display:'flex', gap:'8px' }}>
          {hasCreate && (
            <button onClick={() => setShowCreate(true)} style={{ background:'#B8960C', color:'#0D1B2A', border:'none', padding:'6px 14px', fontSize:'10px', fontWeight:800, cursor:'pointer' }}>+ NEW AREA</button>
          )}
          <button onClick={fetchAreas} style={{ background:'rgba(255,255,255,0.07)', border:'1px solid rgba(255,255,255,0.15)', color:'rgba(255,255,255,0.6)', padding:'6px 12px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>↻ REFRESH</button>
          {hasExport && <button onClick={() => showToast('Export triggered','#1D4ED8')} style={{ background:'rgba(184,150,12,0.15)', border:'1px solid rgba(184,150,12,0.4)', color:'#B8960C', padding:'6px 12px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>↓ EXPORT</button>}
        </div>
      </div>

      <div style={{ padding:'14px 20px' }}>

        {/* Summary Strip */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:'1px', background:'#D4C9B0', border:'1px solid #D4C9B0', marginBottom:'12px' }}>
          {[
            { label:'Total Areas',    value: total,            color:'#B8960C' },
            { label:'Serviceable',    value: serviceableCount, color:'#059669' },
            { label:'Not Serviceable',value: notServiceable,   color:'#DC2626' },
            { label:'Active',         value: areas.filter(a=>a.isActive).length, color:'#2563EB' },
          ].map(m => (
            <div key={m.label} style={{ background:'#0D1B2A', padding:'12px 16px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <span style={{ fontSize:'11px', color:'rgba(255,255,255,0.4)' }}>{m.label}</span>
              <span style={{ fontSize:'20px', fontWeight:800, color:m.color }}>{m.value}</span>
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
            <input value={search} onChange={e => { setSearch(e.target.value); setPage(1) }}
              placeholder="Search area name or pincode..."
              style={{ flex:1, minWidth:'160px', border:'1px solid #D4C9B0', padding:'6px 10px', fontSize:'12px', fontFamily:FONTS.body, outline:'none', background:'#FDFAF6' }}/>
            <select value={stateFilter} onChange={e => { setStateFilter(e.target.value); setDistFilter('ALL'); setCityFilter('ALL'); setPage(1) }}
              style={{ border:'1px solid #D4C9B0', padding:'5px 8px', fontSize:'11px', color:'#6B5E3E', background:'#FDFAF6', cursor:'pointer', fontFamily:FONTS.body, outline:'none' }}>
              <option value="ALL">All States</option>
              {states.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <select value={distFilter} onChange={e => { setDistFilter(e.target.value); setCityFilter('ALL'); setPage(1) }}
              style={{ border:'1px solid #D4C9B0', padding:'5px 8px', fontSize:'11px', color:'#6B5E3E', background:'#FDFAF6', cursor:'pointer', fontFamily:FONTS.body, outline:'none' }}>
              <option value="ALL">All Districts</option>
              {districts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
            <select value={cityFilter} onChange={e => { setCityFilter(e.target.value); setPage(1) }}
              style={{ border:'1px solid #D4C9B0', padding:'5px 8px', fontSize:'11px', color:'#6B5E3E', background:'#FDFAF6', cursor:'pointer', fontFamily:FONTS.body, outline:'none' }}>
              <option value="ALL">All Cities</option>
              {cities.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select value={isServiceable} onChange={e => { setIsServiceable(e.target.value); setPage(1) }}
              style={{ border:'1px solid #D4C9B0', padding:'5px 8px', fontSize:'11px', color:'#6B5E3E', background:'#FDFAF6', cursor:'pointer', fontFamily:FONTS.body, outline:'none' }}>
              <option value="ALL">All Serviceable</option>
              <option value="SERVICEABLE">Serviceable</option>
              <option value="NOT_SERVICEABLE">Not Serviceable</option>
            </select>
            <select value={isActive} onChange={e => { setIsActive(e.target.value); setPage(1) }}
              style={{ border:'1px solid #D4C9B0', padding:'5px 8px', fontSize:'11px', color:'#6B5E3E', background:'#FDFAF6', cursor:'pointer', fontFamily:FONTS.body, outline:'none' }}>
              <option value="ALL">All Status</option>
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
            </select>
            <select value={sort} onChange={e => { setSort(e.target.value); setPage(1) }}
              style={{ border:'1px solid #D4C9B0', padding:'5px 8px', fontSize:'11px', color:'#6B5E3E', background:'#FDFAF6', cursor:'pointer', fontFamily:FONTS.body, outline:'none' }}>
              {SORT_OPTIONS.map(o => <option key={o.val} value={o.val}>{o.label}</option>)}
            </select>
            <button onClick={() => { setSearch(''); setSort('name'); setStateFilter('ALL'); setDistFilter('ALL'); setCityFilter('ALL'); setIsActive('ALL'); setIsServiceable('ALL'); setPage(1) }}
              style={{ background:'#F5F0E8', border:'1px solid #D4C9B0', color:'#9E8E6E', padding:'5px 10px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>RESET</button>
          </div>
        </BCard>

        {/* Table */}
        <BCard>
          <BCardHeader title={`Area Registry (${total})`} action={
            <div style={{ display:'flex', gap:'8px', alignItems:'center' }}>
              <button onClick={fetchAreas} style={{ background:'#F5F0E8', border:'1px solid #D4C9B0', color:'#6B5E3E', padding:'4px 10px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>↻ REFRESH</button>
              <span style={{ fontSize:'11px', color:'#9E8E6E' }}>Page {page}/{totalPages||1}</span>
            </div>
          }/>

          <div style={{ display:'grid', gridTemplateColumns:'1.5fr 1.2fr 1fr 0.6fr 0.7fr 0.7fr 0.7fr 0.8fr', padding:'8px 14px', background:'#F5F0E8', borderBottom:'1px solid #E8DFD0', gap:'8px' }}>
            {['AREA','CITY','DISTRICT','PINCODE','TYPE','SERVICEABLE','STATUS','ACTIONS'].map(h => (
              <span key={h} style={{ fontSize:'9px', fontWeight:800, color:'#9E8E6E', letterSpacing:'1px' }}>{h}</span>
            ))}
          </div>

          {loading ? (
            <div style={{ padding:'40px', textAlign:'center', color:'#9E8E6E' }}>Loading areas...</div>
          ) : error ? (
            <div style={{ padding:'40px', textAlign:'center', color:'#DC2626' }}>{error}</div>
          ) : areas.length === 0 ? (
            <div style={{ padding:'40px', textAlign:'center', color:'#9E8E6E' }}>No areas found</div>
          ) : areas.map((a, i) => {
            const tc = TYPE_COLORS[a.type] || TYPE_COLORS.MIXED
            return (
              <div key={a.id} style={{ display:'grid', gridTemplateColumns:'1.5fr 1.2fr 1fr 0.6fr 0.7fr 0.7fr 0.7fr 0.8fr', padding:'10px 14px', borderBottom:'1px solid #F0EAE0', alignItems:'center', gap:'8px', background:i%2===0?'#fff':'#FDFAF6', cursor:'pointer' }}
                onClick={() => navigate(`/app/location/areas/${a.id}`)}>
                <div>
                  <div style={{ fontSize:'12px', fontWeight:700, color:'#1A1A2E' }}>{a.name}</div>
                  {a.slug && <div style={{ fontSize:'9px', color:'#9E8E6E' }}>{a.slug}</div>}
                </div>
                <span style={{ fontSize:'11px', color:'#6B5E3E' }}>{a.city?.name || '—'}</span>
                <span style={{ fontSize:'10px', color:'#9E8E6E' }}>{a.district?.name || '—'}</span>
                <span style={{ fontSize:'11px', fontFamily:'monospace', color:'#B8960C' }}>{a.pincode || '—'}</span>
                <span style={{ fontSize:'9px', fontWeight:700, background:tc.bg, color:tc.color, padding:'2px 5px', display:'inline-block' }}>{a.type || 'MIXED'}</span>
                <span style={{ fontSize:'9px', fontWeight:800, background:a.isServiceable?'#D1FAE5':'#FEE2E2', color:a.isServiceable?'#065F46':'#991B1B', padding:'2px 6px', display:'inline-block' }}>
                  {a.isServiceable ? '✓ YES' : '✕ NO'}
                </span>
                <span style={{ fontSize:'9px', fontWeight:800, background:a.isActive?'#D1FAE5':'#FEE2E2', color:a.isActive?'#065F46':'#991B1B', padding:'2px 6px', display:'inline-block' }}>
                  {a.isActive ? 'ACTIVE' : 'INACTIVE'}
                </span>
                <div style={{ display:'flex', gap:'4px' }}>
                  <button onClick={e => { e.stopPropagation(); navigate(`/app/location/areas/${a.id}`) }}
                    style={{ background:'#1A1A2E', color:'#fff', border:'none', padding:'4px 8px', fontSize:'9px', fontWeight:700, cursor:'pointer' }}>VIEW</button>
                  {hasEdit && (
                    <button onClick={e => { e.stopPropagation(); navigate(`/app/location/areas/${a.id}/edit`) }}
                      style={{ background:'#B8960C', color:'#0D1B2A', border:'none', padding:'4px 8px', fontSize:'9px', fontWeight:700, cursor:'pointer' }}>EDIT</button>
                  )}
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
      </div>

      <div style={{ background:'#0D1B2A', borderTop:'2px solid #B8960C', padding:'10px 20px', display:'flex', justifyContent:'space-between', marginTop:'14px' }}>
        <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.3)' }}>BARBER ENGINE AREA REGISTRY v1.0.0</span>
        <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.3)' }}>NATIONAL COMMAND CENTER</span>
      </div>

      {/* Create Area Modal */}
      {showCreate && (
        <div onClick={() => !creating && setShowCreate(false)} style={{ position:'fixed', inset:0, background:'rgba(13,27,42,0.7)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:60 }}>
          <div onClick={e => e.stopPropagation()} style={{ background:'#fff', border:'2px solid #B8960C', padding:'28px 32px', maxWidth:'480px', width:'90%', maxHeight:'90vh', overflowY:'auto' }}>
            <div style={{ fontSize:'14px', fontWeight:800, color:'#1A1A2E', marginBottom:'20px' }}>+ New Area</div>

            {[
              { label:'Area Name *', key:'name',    placeholder:'e.g. Koramangala' },
              { label:'Pincode',     key:'pincode', placeholder:'6 digit pincode (optional)' },
            ].map(f => (
              <div key={f.key} style={{ marginBottom:'12px' }}>
                <label style={{ fontSize:'11px', fontWeight:700, color:'#6B5E3E', display:'block', marginBottom:'4px' }}>{f.label}</label>
                <input value={form[f.key]} onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))}
                  placeholder={f.placeholder}
                  style={{ width:'100%', border:'1px solid #D4C9B0', padding:'8px 10px', fontSize:'12px', fontFamily:FONTS.body, outline:'none', boxSizing:'border-box' }}/>
              </div>
            ))}

            <div style={{ marginBottom:'12px' }}>
              <label style={{ fontSize:'11px', fontWeight:700, color:'#6B5E3E', display:'block', marginBottom:'4px' }}>Area Type</label>
              <select value={form.type} onChange={e => setForm(p => ({ ...p, type: e.target.value }))}
                style={{ width:'100%', border:'1px solid #D4C9B0', padding:'8px 10px', fontSize:'12px', fontFamily:FONTS.body, outline:'none', background:'#FDFAF6' }}>
                {['RESIDENTIAL','COMMERCIAL','INDUSTRIAL','MIXED'].map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>

            <div style={{ marginBottom:'12px' }}>
              <label style={{ fontSize:'11px', fontWeight:700, color:'#6B5E3E', display:'block', marginBottom:'4px' }}>State *</label>
              <select value={form.stateId} onChange={e => setForm(p => ({ ...p, stateId: e.target.value, districtId:'', cityId:'' }))}
                style={{ width:'100%', border:'1px solid #D4C9B0', padding:'8px 10px', fontSize:'12px', fontFamily:FONTS.body, outline:'none', background:'#FDFAF6' }}>
                <option value="">Select State</option>
                {states.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>

            <div style={{ marginBottom:'12px' }}>
              <label style={{ fontSize:'11px', fontWeight:700, color:'#6B5E3E', display:'block', marginBottom:'4px' }}>District *</label>
              <select value={form.districtId} onChange={e => setForm(p => ({ ...p, districtId: e.target.value, cityId:'' }))}
                style={{ width:'100%', border:'1px solid #D4C9B0', padding:'8px 10px', fontSize:'12px', fontFamily:FONTS.body, outline:'none', background:'#FDFAF6' }}>
                <option value="">Select District</option>
                {districts.filter(d => !form.stateId || d.state?.id === form.stateId).map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>

            <div style={{ marginBottom:'12px' }}>
              <label style={{ fontSize:'11px', fontWeight:700, color:'#6B5E3E', display:'block', marginBottom:'4px' }}>City *</label>
              <select value={form.cityId} onChange={e => setForm(p => ({ ...p, cityId: e.target.value }))}
                style={{ width:'100%', border:'1px solid #D4C9B0', padding:'8px 10px', fontSize:'12px', fontFamily:FONTS.body, outline:'none', background:'#FDFAF6' }}>
                <option value="">Select City</option>
                {cities.filter(c => !form.districtId || c.district?.id === form.districtId).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>

            <div style={{ marginBottom:'20px', display:'flex', alignItems:'center', gap:'10px' }}>
              <input type="checkbox" checked={form.isServiceable} onChange={e => setForm(p => ({ ...p, isServiceable: e.target.checked }))} id="serviceable"/>
              <label htmlFor="serviceable" style={{ fontSize:'12px', color:'#6B5E3E', fontWeight:600, cursor:'pointer' }}>Serviceable (bookings allowed in this area)</label>
            </div>

            <div style={{ display:'flex', gap:'10px' }}>
              <button onClick={() => setShowCreate(false)} disabled={creating}
                style={{ flex:1, background:'#F5F0E8', border:'1px solid #D4C9B0', color:'#6B5E3E', padding:'10px', fontSize:'12px', fontWeight:700, cursor:'pointer' }}>CANCEL</button>
              <button onClick={handleCreate} disabled={creating}
                style={{ flex:1, background:'#059669', color:'#fff', border:'none', padding:'10px', fontSize:'12px', fontWeight:700, cursor:'pointer', opacity:creating?0.6:1 }}>
                {creating ? 'Creating...' : 'CREATE AREA'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}