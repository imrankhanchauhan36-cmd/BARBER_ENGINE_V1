import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { FONTS } from '../../../config/brand'
import useAuthStore from '../../../store/authStore'
import LocationAPI from '../api/location.api'

const STATUS_COLORS    = { ACTIVE:{ bg:'#D1FAE5',color:'#065F46' }, INACTIVE:{ bg:'#F3F4F6',color:'#374151' }, CLOSED:{ bg:'#FEE2E2',color:'#991B1B' } }
const TERRITORY_COLORS = { OPEN:{ bg:'#D1FAE5',color:'#065F46' }, PARTIAL:{ bg:'#FEF9C3',color:'#92400E' }, CLOSED:{ bg:'#FEE2E2',color:'#991B1B' } }
const ADMIN_LEVELS     = { SUPER_ADMIN:'SUPER_ADMIN', INDIA_ADMIN:'INDIA_ADMIN', STATE_ADMIN:'STATE_ADMIN', DISTRICT_ADMIN:'DISTRICT_ADMIN' }
const canEdit          = (l) => [ADMIN_LEVELS.SUPER_ADMIN, ADMIN_LEVELS.INDIA_ADMIN].includes(l)

const formatDate = (iso) => {
  if (!iso) return '—'
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-IN', { year:'numeric', month:'short', day:'numeric' })
}

const formatGBV = (rupees) => {
  if (rupees >= 10000000) return `₹${(rupees/10000000).toFixed(2)}Cr`
  if (rupees >= 100000)   return `₹${(rupees/100000).toFixed(2)}L`
  return `₹${rupees.toLocaleString('en-IN')}`
}

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

// NOTE: guards against data.length <= 1 (single-point trends), which the
// original dummy-data version never had to handle since it always shipped
// 6 fixed months. Real states with little booking history can return 0-1
// points from the analytics endpoint.
function LineChart({ data, valueKey, labelKey, color='#B8960C', height=100 }) {
  if (!data || data.length === 0) return <div style={{ padding:'20px', textAlign:'center', color:'#9E8E6E' }}>No data yet</div>
  const max = Math.max(...data.map(d => d[valueKey]), 1)
  const w=400, h=height, pad=16
  const denom = data.length > 1 ? (data.length - 1) : 1
  const pts = data.map((d,i) => ({
    x: data.length > 1 ? pad + (i/denom) * (w-pad*2) : w/2,
    y: h - pad - ((d[valueKey]/max) * (h-pad*2)),
    val: d[valueKey], label: d[labelKey],
  }))
  const path = pts.map((p,i) => `${i===0?'M':'L'}${p.x},${p.y}`).join(' ')
  const area = `${path} L${pts[pts.length-1].x},${h-pad} L${pts[0].x},${h-pad} Z`
  return (
    <svg width="100%" viewBox={`0 0 ${w} ${h}`} style={{ overflow:'visible' }}>
      <path d={area} fill={`${color}18`}/>
      <path d={path} fill="none" stroke={color} strokeWidth="2"/>
      {pts.map((p,i) => (
        <g key={i}>
          <rect x={p.x-4} y={p.y-4} width="8" height="8" fill={color} stroke="#fff" strokeWidth="1.5"/>
          <text x={p.x} y={h-2} fontSize="9" fill="#9E8E6E" textAnchor="middle">{p.label}</text>
        </g>
      ))}
    </svg>
  )
}

// NEW — modal for assigning/editing the state's backup (SUPPORT) admin.
// Wired to POST /admin/states/:id/backup-admin, which creates a new
// backup admin if none exists, or edits the existing one in place
// (same record, same id) if one is already assigned.
function BackupAdminModal({ initialValues, onSubmit, onCancel, saving, error }) {
  const [form, setForm] = useState({
    adminName: initialValues?.name  || '',
    phone:     initialValues?.phone || '',
    email:     initialValues?.email || '',
  })

  const canSubmit = !saving && form.adminName.trim() && form.phone.length === 10

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.75)', zIndex:2000, display:'flex', alignItems:'center', justifyContent:'center' }}>
      <div style={{ background:'#fff', width:'420px', border:'2px solid #B8960C' }}>
        <div style={{ background:'#0D1B2A', padding:'14px 18px', borderBottom:'2px solid #B8960C' }}>
          <div style={{ color:'#fff', fontWeight:800, fontSize:'13px', letterSpacing:'1px' }}>
            {initialValues ? '✎ EDIT BACKUP ADMIN' : '+ ASSIGN BACKUP ADMIN'}
          </div>
        </div>
        <div style={{ padding:'20px 18px' }}>
          <div style={{ marginBottom:'12px' }}>
            <label style={{ display:'block', fontSize:'10px', fontWeight:800, color:'#9E8E6E', letterSpacing:'1px', textTransform:'uppercase', marginBottom:'6px' }}>Name *</label>
            <input
              value={form.adminName}
              onChange={e => setForm(f => ({ ...f, adminName: e.target.value }))}
              placeholder="e.g. Amit Verma"
              style={{ width:'100%', border:'1px solid #D4C9B0', padding:'8px 12px', fontSize:'13px', outline:'none', boxSizing:'border-box', fontFamily:'inherit' }}
            />
          </div>
          <div style={{ marginBottom:'12px' }}>
            <label style={{ display:'block', fontSize:'10px', fontWeight:800, color:'#9E8E6E', letterSpacing:'1px', textTransform:'uppercase', marginBottom:'6px' }}>Phone *</label>
            <input
              value={form.phone}
              onChange={e => setForm(f => ({ ...f, phone: e.target.value.replace(/\D/g, '').slice(0, 10) }))}
              placeholder="10 digit mobile number"
              style={{ width:'100%', border:'1px solid #D4C9B0', padding:'8px 12px', fontSize:'13px', outline:'none', boxSizing:'border-box', fontFamily:'inherit' }}
            />
          </div>
          <div style={{ marginBottom:'16px' }}>
            <label style={{ display:'block', fontSize:'10px', fontWeight:800, color:'#9E8E6E', letterSpacing:'1px', textTransform:'uppercase', marginBottom:'6px' }}>Email</label>
            <input
              value={form.email}
              onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
              placeholder="optional"
              style={{ width:'100%', border:'1px solid #D4C9B0', padding:'8px 12px', fontSize:'13px', outline:'none', boxSizing:'border-box', fontFamily:'inherit' }}
            />
          </div>

          {error && (
            <div style={{ background:'#FEF2F2', border:'1px solid #FEE2E2', padding:'10px', marginBottom:'14px', fontSize:'11px', color:'#991B1B', fontWeight:600 }}>
              ⚠ {error}
            </div>
          )}

          <div style={{ display:'flex', gap:'8px', justifyContent:'flex-end' }}>
            <button onClick={onCancel} disabled={saving} style={{ background:'#fff', border:'1px solid #D4C9B0', color:'#6B5E3E', padding:'8px 16px', fontSize:'11px', fontWeight:700, cursor:saving?'not-allowed':'pointer' }}>CANCEL</button>
            <button
              onClick={() => onSubmit(form)}
              disabled={!canSubmit}
              style={{ background:canSubmit?'#B8960C':'rgba(184,150,12,0.4)', border:'none', color:'#0D1B2A', padding:'8px 20px', fontSize:'11px', fontWeight:800, cursor:canSubmit?'pointer':'not-allowed' }}>
              {saving ? 'SAVING...' : (initialValues ? '✓ UPDATE' : '✓ ASSIGN')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function StateDetailPage() {
  const { id }     = useParams()
  const navigate   = useNavigate()
  const admin      = useAuthStore(s => s.admin)
  const adminLevel = admin?.adminLevel || ADMIN_LEVELS.SUPER_ADMIN
  const hasEdit    = canEdit(adminLevel)

  const [tab,   setTab]   = useState('overview')
  const [toast, setToast] = useState(null)

  const [state,   setState]   = useState(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)

  const [analytics, setAnalytics] = useState(null)

  const [districts,        setDistricts]        = useState([])
  const [districtsLoading, setDistrictsLoading] = useState(false)
  const [districtsLoaded,  setDistrictsLoaded]   = useState(false)

  const [showBackupModal, setShowBackupModal] = useState(false)
  const [backupSaving,    setBackupSaving]    = useState(false)
  const [backupError,     setBackupError]     = useState(null)

  const showToast = (msg, color) => { setToast({ msg, color }); setTimeout(() => setToast(null), 3000) }

  // State detail + analytics fetched together on mount — both are needed
  // by the Overview tab (KPI strip + Top Districts card), so there's no
  // benefit to lazy-loading analytics behind the Analytics tab click.
  useEffect(() => {
    let cancelled = false
    setLoading(true); setError(null)

    Promise.all([
      LocationAPI.getStateById(id),
      LocationAPI.getStateAnalytics(id),
    ])
      .then(([stateRes, analyticsRes]) => {
        if (cancelled) return
        setState(stateRes.data)
        setAnalytics(analyticsRes.data)
      })
      .catch(err => { if (!cancelled) setError(err.message || 'Failed to load state') })
      .finally(() => { if (!cancelled) setLoading(false) })

    return () => { cancelled = true }
  }, [id])

  // Districts list is only needed on the Districts tab and can be a much
  // longer list (up to 75+ for large states) — lazy-load on first visit.
  useEffect(() => {
    if (tab !== 'districts' || districtsLoaded) return
    setDistrictsLoading(true)
    LocationAPI.getDistricts({ stateId: id, limit: 100, sort: 'name' })
      .then(res => { setDistricts(res.data || []); setDistrictsLoaded(true) })
      .catch(() => showToast('Failed to load districts', '#DC2626'))
      .finally(() => setDistrictsLoading(false))
  }, [tab, id, districtsLoaded])

  const handleBackupAdminSubmit = async (form) => {
    setBackupSaving(true)
    setBackupError(null)
    try {
      await LocationAPI.assignBackupAdmin(id, {
        adminName: form.adminName.trim(),
        phone: form.phone,
        email: form.email?.trim() || undefined,
      })
      const refreshed = await LocationAPI.getStateById(id)
      setState(refreshed.data)
      setShowBackupModal(false)
      showToast('✓ Backup admin saved', '#059669')
    } catch (err) {
      setBackupError(err.message || 'Failed to save backup admin')
    } finally {
      setBackupSaving(false)
    }
  }

  if (loading) {
    return (
      <div style={{ fontFamily:FONTS.body, background:'#F0EAE0', minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center' }}>
        <span style={{ color:'#9E8E6E', fontSize:'13px' }}>Loading state...</span>
      </div>
    )
  }

  if (error || !state) {
    return (
      <div style={{ fontFamily:FONTS.body, background:'#F0EAE0', minHeight:'100vh', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:'12px' }}>
        <span style={{ color:'#DC2626', fontSize:'13px', fontWeight:600 }}>{error || 'State not found'}</span>
        <button onClick={() => navigate('/app/location/states')} style={{ background:'#1A1A2E', color:'#fff', border:'none', padding:'8px 16px', fontSize:'12px', fontWeight:700, cursor:'pointer' }}>← Back to States</button>
      </div>
    )
  }

  const statusLabel = state.isActive ? 'ACTIVE' : 'INACTIVE'
  const st = STATUS_COLORS[statusLabel]        || STATUS_COLORS.INACTIVE
  const tt = TERRITORY_COLORS[state.territory] || TERRITORY_COLORS.CLOSED
  const TABS = ['overview', 'districts', 'admins', 'analytics', 'audit']

  const totalRevenueRupees = (state.totalGbvInPaise || 0) / 100
  const topDistricts = analytics?.topDistricts || []
  const maxTopDistrictBookings = topDistricts.length > 0 ? Math.max(...topDistricts.map(d => d.bookings)) : 1

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
          <button onClick={() => navigate('/app/location/states')} style={{ background:'rgba(255,255,255,0.07)', border:'1px solid rgba(255,255,255,0.1)', color:'rgba(255,255,255,0.6)', padding:'5px 10px', cursor:'pointer', fontSize:'12px', fontWeight:700 }}>← BACK</button>
          <div style={{ width:'3px', height:'16px', background:'#B8960C' }}/>
          <div>
            <div style={{ color:'#fff', fontWeight:800, fontSize:'13px', letterSpacing:'1px' }}>{state.name} ({state.code || '—'})</div>
            <div style={{ color:'#B8960C', fontSize:'9px', letterSpacing:'1px', marginTop:'1px' }}>{state.id} • STATE DETAIL</div>
          </div>
          <span style={{ fontSize:'10px', fontWeight:800, background:st.bg, color:st.color, padding:'3px 8px' }}>{statusLabel}</span>
          <span style={{ fontSize:'10px', fontWeight:800, background:tt.bg, color:tt.color, padding:'3px 8px' }}>Territory: {state.territory}</span>
        </div>
        <div style={{ display:'flex', gap:'8px' }}>
          {hasEdit && (
            <button onClick={() => navigate(`/app/location/states/${id}/edit`)} style={{ background:'rgba(184,150,12,0.15)', border:'1px solid rgba(184,150,12,0.4)', color:'#B8960C', padding:'6px 12px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>✎ EDIT</button>
          )}
          <button onClick={() => navigate(`/app/location/states/${id}/dashboard`)} style={{ background:'rgba(37,99,235,0.2)', border:'1px solid rgba(37,99,235,0.5)', color:'#93C5FD', padding:'6px 12px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>📊 DASHBOARD</button>
          <button onClick={() => navigate('/app/location/control')} style={{ background:'rgba(220,38,38,0.15)', border:'1px solid rgba(220,38,38,0.4)', color:'#FCA5A5', padding:'6px 12px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>⊘ TERRITORY CONTROL</button>
          <button onClick={() => navigate(`/app/location/districts?stateId=${id}`)} style={{ background:'rgba(37,99,235,0.15)', border:'1px solid rgba(37,99,235,0.4)', color:'#93C5FD', padding:'6px 12px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>VIEW DISTRICTS</button>
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
      <div style={{ display:'grid', gridTemplateColumns:'repeat(6,1fr)', gap:'1px', background:'#D4C9B0', borderBottom:'2px solid #B8960C' }}>
        {[
          { label:'Districts',      value: state.districtCount,                              color:'#2563EB' },
          { label:'Areas',          value: (state.totalAreas ?? 0).toLocaleString('en-IN'),   color:'#7C3AED' },
          { label:'Total Salons',   value: (state.totalSalons ?? 0).toLocaleString('en-IN'),  color:'#B8960C' },
          { label:'Active Salons',  value: (state.activeSalons ?? 0).toLocaleString('en-IN'), color:'#059669' },
          { label:'Total Bookings', value: (state.totalBookings ?? 0).toLocaleString('en-IN'),color:'#0891B2' },
          { label:'Coverage',       value:`${state.coverage ?? 0}%`, color:(state.coverage??0)>=80?'#059669':(state.coverage??0)>=60?'#D97706':'#DC2626' },
        ].map(k => (
          <div key={k.label} style={{ background:'#0D1B2A', padding:'10px 16px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
            <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.4)' }}>{k.label}</span>
            <span style={{ fontSize:'16px', fontWeight:800, color:k.color }}>{k.value}</span>
          </div>
        ))}
      </div>

      <div style={{ padding:'16px 20px' }}>

        {/* OVERVIEW */}
        {tab === 'overview' && (
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:'14px' }}>
            <BCard>
              <BCardHeader title="State Information"/>
              <div style={{ padding:'14px' }}>
                <SLabel title="Basic"/>
                <InfoRow label="State Name"   value={state.name}/>
                <InfoRow label="State Code"   value={state.code || '—'}/>
                <InfoRow label="Status"       value={statusLabel}     valueColor={st.color}/>
                <InfoRow label="Territory"    value={state.territory} valueColor={tt.color}/>
                <InfoRow label="Created"      value={formatDate(state.createdAt)}/>
                <InfoRow label="Last Updated" value={formatDate(state.updatedAt)}/>
                <SLabel title="Coverage"/>
                <div style={{ padding:'8px 0' }}>
                  <div style={{ display:'flex', justifyContent:'space-between', marginBottom:'6px' }}>
                    <span style={{ fontSize:'12px', color:'#9E8E6E' }}>Territory Coverage</span>
                    <span style={{ fontSize:'12px', fontWeight:700, color:'#B8960C' }}>{state.coverage ?? 0}%</span>
                  </div>
                  <div style={{ height:'8px', background:'#E8DFD0' }}>
                    <div style={{ height:'100%', width:`${state.coverage ?? 0}%`, background:(state.coverage??0)>=80?'#059669':(state.coverage??0)>=60?'#D97706':'#DC2626' }}/>
                  </div>
                </div>
              </div>
            </BCard>

            <BCard>
              <BCardHeader title="Gross Booking Value & Performance"/>
              <div style={{ padding:'14px' }}>
                <div style={{ background:'#0D1B2A', padding:'16px', marginBottom:'14px', textAlign:'center', borderTop:'2px solid #B8960C' }}>
                  <div style={{ fontSize:'10px', color:'rgba(255,255,255,0.4)', letterSpacing:'1px', marginBottom:'6px' }}>GROSS BOOKING VALUE (GBV)</div>
                  <div style={{ fontSize:'24px', fontWeight:800, color:'#B8960C' }}>{formatGBV(totalRevenueRupees)}</div>
                  <div style={{ fontSize:'10px', color:'rgba(255,255,255,0.3)', marginTop:'4px' }}>₹{totalRevenueRupees.toLocaleString('en-IN')} lifetime</div>
                </div>
                <SLabel title="Metrics"/>
                <InfoRow label="Total Bookings"  value={(state.totalBookings ?? 0).toLocaleString('en-IN')}/>
                <InfoRow label="Avg Rating"      value={state.avgRating > 0 ? `${state.avgRating} ★` : 'No ratings yet'} valueColor="#D97706"/>
                <InfoRow label="Active Salons"   value={`${state.activeSalons ?? 0} / ${state.totalSalons ?? 0}`} valueColor="#059669"/>
                <InfoRow label="Inactive Salons" value={(state.totalSalons ?? 0) - (state.activeSalons ?? 0)} valueColor="#DC2626"/>
              </div>
            </BCard>

            <BCard>
              <BCardHeader title="Top Districts (by Bookings)"/>
              <div style={{ padding:'14px' }}>
                {topDistricts.length === 0 ? (
                  <div style={{ padding:'20px', textAlign:'center', color:'#9E8E6E', fontSize:'12px' }}>No booking activity yet</div>
                ) : (
                  <>
                    {topDistricts.map((d,i) => (
                      <div key={d.districtId} style={{ padding:'10px 0', borderBottom:'1px solid #F0EAE0' }}>
                        <div style={{ display:'flex', justifyContent:'space-between', marginBottom:'4px' }}>
                          <span style={{ fontSize:'13px', fontWeight:600, color:'#1A1A2E' }}>{i+1}. {d.districtName}</span>
                          <span style={{ fontSize:'12px', color:'#B8960C', fontWeight:700 }}>{d.salonCount} salons · {d.bookings} bookings</span>
                        </div>
                        <div style={{ height:'4px', background:'#E8DFD0' }}>
                          <div style={{ height:'100%', width:`${(d.bookings/maxTopDistrictBookings)*100}%`, background:'#B8960C' }}/>
                        </div>
                      </div>
                    ))}
                    <button onClick={() => setTab('analytics')} style={{ marginTop:'12px', background:'none', border:'none', cursor:'pointer', fontSize:'11px', color:'#B8960C', fontWeight:700, padding:0 }}>
                      VIEW FULL ANALYTICS ▸
                    </button>
                  </>
                )}
              </div>
            </BCard>
          </div>
        )}

        {/* DISTRICTS */}
        {tab === 'districts' && (
          <BCard>
            <BCardHeader title={`Districts (${districts.length})`} action={
              hasEdit && <button onClick={() => navigate(`/app/location/districts/create?stateId=${id}`)} style={{ background:'#B8960C', color:'#0D1B2A', border:'none', padding:'4px 10px', fontSize:'10px', fontWeight:800, cursor:'pointer' }}>+ ADD DISTRICT</button>
            }/>
            <div style={{ display:'grid', gridTemplateColumns:'1.5fr 0.8fr 0.8fr 0.8fr 0.8fr 1.2fr 0.8fr', padding:'8px 14px', background:'#F5F0E8', borderBottom:'1px solid #E8DFD0', gap:'8px' }}>
              {['DISTRICT','AREAS','SALONS','STATUS','TERRITORY','DISTRICT ADMIN','ACTIONS'].map(h => (
                <span key={h} style={{ fontSize:'9px', fontWeight:800, color:'#9E8E6E', letterSpacing:'1px' }}>{h}</span>
              ))}
            </div>
            {districtsLoading ? (
              <div style={{ padding:'40px', textAlign:'center', color:'#9E8E6E' }}>Loading districts...</div>
            ) : districts.length === 0 ? (
              <div style={{ padding:'40px', textAlign:'center', color:'#9E8E6E' }}>No districts found</div>
            ) : districts.map((d,i) => {
              const dStatus = d.isActive ? 'ACTIVE' : 'INACTIVE'
              const ds = STATUS_COLORS[dStatus]          || STATUS_COLORS.INACTIVE
              const dt = TERRITORY_COLORS[d.territory]   || TERRITORY_COLORS.CLOSED
              const adminName = d.districtAdmin?.name || 'Not Assigned'
              return (
                <div key={d.id} style={{ display:'grid', gridTemplateColumns:'1.5fr 0.8fr 0.8fr 0.8fr 0.8fr 1.2fr 0.8fr', padding:'10px 14px', borderBottom:'1px solid #F0EAE0', alignItems:'center', gap:'8px', background:i%2===0?'#fff':'#FDFAF6' }}>
                  <span style={{ fontSize:'13px', fontWeight:700, color:'#1A1A2E' }}>{d.name}</span>
                  <span style={{ fontSize:'12px', color:'#6B5E3E' }}>{d.areaCount ?? 0}</span>
                  <span style={{ fontSize:'12px', fontWeight:600, color:'#1A1A2E' }}>{d.salonCount ?? 0}</span>
                  <span style={{ fontSize:'9px', fontWeight:800, background:ds.bg, color:ds.color, padding:'2px 6px', display:'inline-block' }}>{dStatus}</span>
                  <span style={{ fontSize:'9px', fontWeight:800, background:dt.bg, color:dt.color, padding:'2px 6px', display:'inline-block' }}>{d.territory}</span>
                  <div>
                    <div style={{ fontSize:'12px', color:adminName==='Not Assigned'?'#DC2626':'#1A1A2E', fontWeight:500 }}>{adminName}</div>
                    {adminName==='Not Assigned' && <div style={{ fontSize:'9px', color:'#DC2626', fontWeight:700 }}>⚠ UNASSIGNED</div>}
                  </div>
                  <div style={{ display:'flex', gap:'3px' }}>
                    <button onClick={() => navigate(`/app/location/districts/${d.id}`)} style={{ background:'#1A1A2E', color:'#fff', border:'none', padding:'4px 7px', fontSize:'9px', fontWeight:700, cursor:'pointer' }}>VIEW</button>
                    {hasEdit && <button onClick={() => navigate(`/app/location/districts/${d.id}/edit`)} style={{ background:'#B8960C', color:'#fff', border:'none', padding:'4px 7px', fontSize:'9px', fontWeight:700, cursor:'pointer' }}>EDIT</button>}
                  </div>
                </div>
              )
            })}
          </BCard>
        )}

        {/* ADMINS — State Admin (PRIMARY) + Backup Admin (SUPPORT) */}
        {tab === 'admins' && (
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'14px' }}>
            <BCard>
              <BCardHeader title="State Admin" action={
                hasEdit && <button onClick={() => navigate('/app/location/admin-assignment')} style={{ background:'#B8960C', color:'#0D1B2A', border:'none', padding:'4px 10px', fontSize:'10px', fontWeight:800, cursor:'pointer' }}>REASSIGN</button>
              }/>
              <div style={{ padding:'14px' }}>
                {state.stateAdmin ? (
                  <>
                    <div style={{ display:'flex', alignItems:'center', gap:'14px', padding:'14px', background:'#F5F0E8', border:'1px solid #E8DFD0', borderTop:'2px solid #B8960C', marginBottom:'14px' }}>
                      <div style={{ width:'48px', height:'48px', background:'#0D1B2A', display:'flex', alignItems:'center', justifyContent:'center', color:'#B8960C', fontSize:'20px', fontWeight:800, flexShrink:0 }}>
                        {state.stateAdmin.name?.[0] || '?'}
                      </div>
                      <div>
                        <div style={{ fontSize:'15px', fontWeight:800, color:'#1A1A2E' }}>{state.stateAdmin.name}</div>
                        <div style={{ fontSize:'11px', color:'#B8960C', fontWeight:600, letterSpacing:'0.5px' }}>STATE ADMIN — {state.code || '—'}</div>
                      </div>
                      <span style={{ marginLeft:'auto', fontSize:'10px', fontWeight:800, background:state.stateAdmin.status==='ACTIVE'?'#D1FAE5':'#FEE2E2', color:state.stateAdmin.status==='ACTIVE'?'#065F46':'#991B1B', padding:'3px 8px' }}>{state.stateAdmin.status || 'UNKNOWN'}</span>
                    </div>
                    <InfoRow label="Email"       value={state.stateAdmin.email || '—'}/>
                    <InfoRow label="Phone"       value={state.stateAdmin.phone || '—'}/>
                    <InfoRow label="Assigned At" value={formatDate(state.stateAdmin.assignedAt)}/>
                    <div style={{ display:'flex', gap:'8px', marginTop:'14px' }}>
                      <button onClick={() => navigate('/app/location/admin-assignment')} style={{ flex:1, background:'#F5F0E8', border:'1px solid #D4C9B0', color:'#6B5E3E', padding:'8px', fontSize:'11px', fontWeight:700, cursor:'pointer' }}>↔ TRANSFER</button>
                      <button style={{ flex:1, background:'#FEF2F2', border:'1px solid #DC2626', color:'#DC2626', padding:'8px', fontSize:'11px', fontWeight:700, cursor:'pointer' }}>⊘ DEACTIVATE</button>
                    </div>
                  </>
                ) : (
                  <div style={{ padding:'20px', textAlign:'center' }}>
                    <div style={{ fontSize:'13px', color:'#DC2626', fontWeight:700, marginBottom:'10px' }}>⚠ No admin assigned to this state</div>
                    {hasEdit && (
                      <button onClick={() => navigate('/app/location/admin-assignment')} style={{ background:'#B8960C', color:'#0D1B2A', border:'none', padding:'8px 16px', fontSize:'11px', fontWeight:700, cursor:'pointer' }}>ASSIGN ADMIN</button>
                    )}
                  </div>
                )}
              </div>
            </BCard>

            <BCard>
              <BCardHeader title="Backup Admin" action={
                hasEdit && <button onClick={() => { setBackupError(null); setShowBackupModal(true) }} style={{ background:'rgba(184,150,12,0.15)', border:'1px solid rgba(184,150,12,0.3)', color:'#B8960C', padding:'4px 10px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>{state.backupAdmin ? 'CHANGE' : 'ASSIGN'}</button>
              }/>
              <div style={{ padding:'14px' }}>
                {state.backupAdmin ? (
                  <>
                    <div style={{ display:'flex', alignItems:'center', gap:'14px', padding:'14px', background:'#F5F0E8', border:'1px solid #E8DFD0', borderTop:'2px solid #B8960C', marginBottom:'14px' }}>
                      <div style={{ width:'48px', height:'48px', background:'#0D1B2A', display:'flex', alignItems:'center', justifyContent:'center', color:'#B8960C', fontSize:'20px', fontWeight:800, flexShrink:0 }}>
                        {state.backupAdmin.name?.[0] || '?'}
                      </div>
                      <div>
                        <div style={{ fontSize:'15px', fontWeight:800, color:'#1A1A2E' }}>{state.backupAdmin.name}</div>
                        <div style={{ fontSize:'11px', color:'#9E8E6E', fontWeight:600, letterSpacing:'0.5px' }}>BACKUP ADMIN — {state.code || '—'}</div>
                      </div>
                      <span style={{ marginLeft:'auto', fontSize:'10px', fontWeight:800, background:state.backupAdmin.status==='ACTIVE'?'#D1FAE5':'#FEE2E2', color:state.backupAdmin.status==='ACTIVE'?'#065F46':'#991B1B', padding:'3px 8px' }}>{state.backupAdmin.status || 'UNKNOWN'}</span>
                    </div>
                    <InfoRow label="Email"       value={state.backupAdmin.email || '—'}/>
                    <InfoRow label="Phone"       value={state.backupAdmin.phone || '—'}/>
                    <InfoRow label="Assigned At" value={formatDate(state.backupAdmin.assignedAt)}/>
                    <InfoRow label="Role"        value="Backup — Activates if Primary Inactive" valueColor="#D97706"/>
                  </>
                ) : (
                  <div style={{ padding:'20px', textAlign:'center' }}>
                    <div style={{ fontSize:'13px', color:'#9E8E6E', fontWeight:600, marginBottom:'10px' }}>No backup admin assigned</div>
                    {hasEdit && (
                      <button onClick={() => { setBackupError(null); setShowBackupModal(true) }} style={{ background:'#B8960C', color:'#0D1B2A', border:'none', padding:'8px 16px', fontSize:'11px', fontWeight:700, cursor:'pointer' }}>ASSIGN BACKUP ADMIN</button>
                    )}
                  </div>
                )}
              </div>
            </BCard>
          </div>
        )}

        {/* ANALYTICS */}
        {tab === 'analytics' && (
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'14px' }}>
            <BCard>
              <BCardHeader title="Booking Trend (Last 6 Months)"/>
              <div style={{ padding:'14px' }}>
                <LineChart data={analytics?.bookingTrend || []} valueKey="bookings" labelKey="month" color="#B8960C"/>
              </div>
            </BCard>
            <BCard>
              <BCardHeader title="Gross Booking Value Trend (₹)"/>
              <div style={{ padding:'14px' }}>
                <LineChart
                  data={(analytics?.bookingTrend || []).map(b => ({ month: b.month, revenue: b.gbvInPaise / 100 }))}
                  valueKey="revenue" labelKey="month" color="#059669"
                />
              </div>
            </BCard>
            <BCard style={{ gridColumn:'1/-1' }}>
              <BCardHeader title="District Performance (Last 6 Months)"/>
              <div style={{ display:'grid', gridTemplateColumns:'1.8fr 0.8fr 0.8fr 1fr 1.6fr', padding:'8px 14px', background:'#F5F0E8', borderBottom:'1px solid #E8DFD0', gap:'8px' }}>
                {['DISTRICT','SALONS','BOOKINGS','GBV (₹)','PERFORMANCE'].map(h => (
                  <span key={h} style={{ fontSize:'9px', fontWeight:800, color:'#9E8E6E', letterSpacing:'1px' }}>{h}</span>
                ))}
              </div>
              {topDistricts.length === 0 ? (
                <div style={{ padding:'40px', textAlign:'center', color:'#9E8E6E' }}>No booking activity in this window</div>
              ) : topDistricts.map((d,i) => (
                <div key={d.districtId} style={{ display:'grid', gridTemplateColumns:'1.8fr 0.8fr 0.8fr 1fr 1.6fr', padding:'11px 14px', borderBottom:'1px solid #F0EAE0', alignItems:'center', gap:'8px', background:i%2===0?'#fff':'#FDFAF6' }}>
                  <span style={{ fontSize:'13px', fontWeight:600, color:'#1A1A2E' }}>{d.districtName}</span>
                  <span style={{ fontSize:'12px', fontWeight:700, color:'#7C3AED' }}>{d.salonCount}</span>
                  <span style={{ fontSize:'12px', fontWeight:700, color:'#B8960C' }}>{d.bookings}</span>
                  <span style={{ fontSize:'12px', color:'#059669', fontWeight:600 }}>{(d.gbvInPaise/100).toLocaleString('en-IN')}</span>
                  <div>
                    <div style={{ height:'6px', background:'#E8DFD0' }}>
                      <div style={{ height:'100%', width:`${(d.bookings/maxTopDistrictBookings)*100}%`, background:'#B8960C' }}/>
                    </div>
                  </div>
                </div>
              ))}
            </BCard>
          </div>
        )}

        {/* AUDIT — deferred: audit logging is being built as a separate
            engine, not bolted onto this page ad-hoc. Placeholder only. */}
        {tab === 'audit' && (
          <BCard>
            <BCardHeader title="Audit Log"/>
            <div style={{ padding:'40px', textAlign:'center' }}>
              <div style={{ fontSize:'13px', color:'#9E8E6E', fontWeight:600, marginBottom:'6px' }}>🚧 Coming Soon</div>
              <div style={{ fontSize:'12px', color:'#C4B49A' }}>Audit logging is being built as a dedicated system and will appear here once ready.</div>
            </div>
          </BCard>
        )}

      </div>

      <div style={{ background:'#0D1B2A', borderTop:'2px solid #B8960C', padding:'10px 20px', display:'flex', justifyContent:'space-between', marginTop:'14px' }}>
        <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.3)', letterSpacing:'0.5px' }}>BARBER ENGINE TERRITORY ENGINE v1.0.0</span>
        <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.3)', letterSpacing:'0.5px' }}>NATIONAL COMMAND CENTER</span>
      </div>

      {showBackupModal && (
        <BackupAdminModal
          initialValues={state.backupAdmin}
          onSubmit={handleBackupAdminSubmit}
          onCancel={() => !backupSaving && setShowBackupModal(false)}
          saving={backupSaving}
          error={backupError}
        />
      )}
    </div>
  )
}