import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import apiClient from '../../../api/client'
import { FONTS } from '../../../config/brand'
import useAuthStore from '../../../store/authStore'
import LocationAPI from '../api/location.api'

const STATUS_COLORS    = { ACTIVE:{ bg:'#D1FAE5',color:'#065F46' }, INACTIVE:{ bg:'#F3F4F6',color:'#374151' } }
const TERRITORY_COLORS = { OPEN:{ bg:'#D1FAE5',color:'#065F46' }, PARTIAL:{ bg:'#FEF9C3',color:'#92400E' }, CLOSED:{ bg:'#FEE2E2',color:'#991B1B' } }

// Matches backend User.adminLevel enum: "INDIA" | "STATE" | "DISTRICT"
const ADMIN_LEVELS = { INDIA:'INDIA', STATE:'STATE', DISTRICT:'DISTRICT' }
const canEdit       = (l) => [ADMIN_LEVELS.INDIA, ADMIN_LEVELS.STATE].includes(l)

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
    <span style={{ fontSize:'12px', fontWeight:600, color:valueColor||'#1A1A2E', textAlign:'right', maxWidth:'60%' }}>{value ?? '—'}</span>
  </div>
)
const SLabel = ({ title }) => (
  <div style={{ display:'flex', alignItems:'center', gap:'8px', margin:'12px 0 8px' }}>
    <div style={{ width:'3px', height:'12px', background:'#B8960C' }}/>
    <span style={{ fontSize:'9px', fontWeight:800, color:'#9E8E6E', letterSpacing:'2px', textTransform:'uppercase' }}>{title}</span>
  </div>
)
const EmptyState = ({ children }) => (
  <div style={{ padding:'40px', textAlign:'center', color:'#9E8E6E', fontSize:'12px' }}>{children}</div>
)

function LineChart({ data, valueKey, labelKey, color='#B8960C', height=100, formatVal }) {
  if (!data || data.length === 0) return <EmptyState>No data available yet</EmptyState>
  const max = Math.max(...data.map(d => d[valueKey]), 1)
  const w = 400, h = height, pad = 16
  const pts = data.map((d, i) => ({
    x: pad + (data.length === 1 ? 0 : (i / (data.length - 1)) * (w - pad * 2)),
    y: h - pad - ((d[valueKey] / max) * (h - pad * 2)),
    val: d[valueKey], label: d[labelKey],
  }))
  const path = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ')
  const area = `${path} L${pts[pts.length - 1].x},${h - pad} L${pts[0].x},${h - pad} Z`
  return (
    <svg width="100%" viewBox={`0 0 ${w} ${h}`} style={{ overflow:'visible' }}>
      <path d={area} fill={`${color}18`}/>
      <path d={path} fill="none" stroke={color} strokeWidth="2"/>
      {pts.map((p, i) => (
        <g key={i}>
          <rect x={p.x-4} y={p.y-4} width="8" height="8" fill={color} stroke="#fff" strokeWidth="1.5"/>
          <text x={p.x} y={h-2} fontSize="9" fill="#9E8E6E" textAnchor="middle">{p.label}</text>
        </g>
      ))}
    </svg>
  )
}

const formatINR = (paise) => {
  const rupees = (paise || 0) / 100
  if (rupees >= 10000000) return `₹${(rupees/10000000).toFixed(1)}Cr`
  if (rupees >= 100000)   return `₹${(rupees/100000).toFixed(1)}L`
  return `₹${rupees.toLocaleString('en-IN')}`
}

export default function DistrictDetailPage() {
  const { id }   = useParams()
  const navigate = useNavigate()
  const admin      = useAuthStore(s => s.admin)
  const adminLevel = admin?.adminLevel || null
  const hasEdit    = canEdit(adminLevel)

  const [tab, setTab] = useState('overview')

  const [district, setDistrict] = useState(null)
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState(null)

  const [analytics,        setAnalytics]        = useState(null)
  const [analyticsLoading, setAnalyticsLoading]  = useState(false)

  const [areas,        setAreas]        = useState([])
  const [areasLoading, setAreasLoading]  = useState(false)
  const [areasError,   setAreasError]    = useState(null)
  const [areasFetched, setAreasFetched]  = useState(false)

  const [approvals,        setApprovals]        = useState([])
  const [approvalsLoading, setApprovalsLoading]  = useState(false)
  const [approvalsError,   setApprovalsError]    = useState(null)
  const [approvalsFetched, setApprovalsFetched]  = useState(false)

  const [auditLogs,    setAuditLogs]    = useState([])
  const [auditLoading, setAuditLoading] = useState(false)
  const [auditError,   setAuditError]   = useState(null)
  const [auditFetched, setAuditFetched] = useState(false)

  // Core district fetch (Overview / Admins / KPI strip)
  useEffect(() => {
    if (!id) return
    setLoading(true)
    setError(null)
    LocationAPI.getDistrictById(id)
      .then(res => setDistrict(res.data))
      .catch(err => setError(err.message || 'Failed to load district'))
      .finally(() => setLoading(false))
  }, [id])

  // Analytics fetch (Overview "Top Areas" + Analytics tab both need this)
  useEffect(() => {
    if (!id) return
    setAnalyticsLoading(true)
    LocationAPI.getDistrictAnalytics(id, { months: 6 })
      .then(res => setAnalytics(res.data))
      .catch(() => setAnalytics(null))
      .finally(() => setAnalyticsLoading(false))
  }, [id])

  // Areas tab — lazy-loaded on first visit.
  // NOTE: uses the City module's getCities endpoint filtered by
  // districtId — this is the same "City vs Area" naming question
  // flagged earlier in the District module review; the query param
  // name (districtId) is assumed consistent with the rest of the
  // Location module and has not been independently confirmed here.
  useEffect(() => {
    if (tab !== 'areas' || areasFetched || !id) return
    setAreasLoading(true)
    setAreasError(null)
    LocationAPI.getCities({ districtId: id, limit: 100 })
      .then(res => setAreas(res.data || []))
      .catch(err => setAreasError(err.message || 'Failed to load areas'))
      .finally(() => { setAreasLoading(false); setAreasFetched(true) })
  }, [tab, areasFetched, id])

  // Approvals tab — lazy-loaded, pulls PENDING salons scoped to this
  // district from the Salon Approval Engine (District doesn't own
  // this data, only filters by districtId). No dedicated Salon API
  // service exists yet, so this calls apiClient directly.
  useEffect(() => {
    if (tab !== 'approvals' || approvalsFetched || !id) return
    setApprovalsLoading(true)
    setApprovalsError(null)
    apiClient.get('/admin/salons', { district: id, status: 'PENDING', limit: 20 })
      .then(res => setApprovals(res.data || []))
      .catch(err => setApprovalsError(err.message || 'Failed to load pending approvals'))
      .finally(() => { setApprovalsLoading(false); setApprovalsFetched(true) })
  }, [tab, approvalsFetched, id])

  // Audit tab — lazy-loaded, reads AdminAuditLog entries scoped to
  // this district (write side: district.controller.js logs on
  // create/update/archive/restore/admin-assign; login/logout and
  // other system-level events are intentionally out of scope here).
  useEffect(() => {
    if (tab !== 'audit' || auditFetched || !id) return
    setAuditLoading(true)
    setAuditError(null)
    LocationAPI.getDistrictAudit(id, { limit: 20 })
      .then(res => setAuditLogs(res.data || []))
      .catch(err => setAuditError(err.message || 'Failed to load audit log'))
      .finally(() => { setAuditLoading(false); setAuditFetched(true) })
  }, [tab, auditFetched, id])

  const handleApprove = async (salonId) => {
    try {
      await apiClient.patch(`/admin/salons/${salonId}/status`, { status: 'APPROVED' })
      setApprovals(prev => prev.filter(s => s.id !== salonId))
    } catch (err) {
      alert(err.message || 'Failed to approve salon')
    }
  }
  const handleReject = async (salonId) => {
    const reason = window.prompt('Rejection reason (optional):') || undefined
    try {
      await apiClient.patch(`/admin/salons/${salonId}/status`, { status: 'REJECTED', rejectionReason: reason })
      setApprovals(prev => prev.filter(s => s.id !== salonId))
    } catch (err) {
      alert(err.message || 'Failed to reject salon')
    }
  }

  if (loading) {
    return (
      <div style={{ fontFamily:FONTS.body, background:'#F0EAE0', minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center' }}>
        <span style={{ color:'#9E8E6E' }}>Loading district…</span>
      </div>
    )
  }

  if (error || !district) {
    return (
      <div style={{ fontFamily:FONTS.body, background:'#F0EAE0', minHeight:'100vh', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:'12px' }}>
        <span style={{ color:'#DC2626', fontWeight:600 }}>⚠ {error || 'District not found'}</span>
        <button onClick={() => navigate('/app/location/districts')} style={{ background:'#1A1A2E', color:'#fff', border:'none', padding:'8px 16px', fontSize:'12px', fontWeight:700, cursor:'pointer' }}>← Back to Districts</button>
      </div>
    )
  }

  const isActive = !!district.isActive
  const st = isActive ? STATUS_COLORS.ACTIVE : STATUS_COLORS.INACTIVE
  const tt = TERRITORY_COLORS[district.territory] || TERRITORY_COLORS.PARTIAL
  const adminName = district.districtAdmin?.name || 'Not Assigned'
  const topCities = analytics?.topCities || []

  const TABS = ['overview','areas','admins','approvals','analytics','audit']

  return (
    <div style={{ fontFamily:FONTS.body, background:'#F0EAE0', minHeight:'100vh' }}>

      {/* Header */}
      <div style={{ background:'#0D1B2A', borderBottom:'2px solid #B8960C', padding:'0 20px', height:'52px', display:'flex', alignItems:'center', justifyContent:'space-between', position:'sticky', top:0, zIndex:10 }}>
        <div style={{ display:'flex', alignItems:'center', gap:'12px' }}>
          <button onClick={() => navigate('/app/location/districts')} style={{ background:'rgba(255,255,255,0.07)', border:'1px solid rgba(255,255,255,0.1)', color:'rgba(255,255,255,0.6)', padding:'5px 10px', cursor:'pointer', fontSize:'12px', fontWeight:700 }}>← BACK</button>
          <div style={{ width:'3px', height:'16px', background:'#B8960C' }}/>
          <div>
            <div style={{ color:'#fff', fontWeight:800, fontSize:'13px', letterSpacing:'1px' }}>{district.name}, {district.state?.code}</div>
            <div style={{ color:'#B8960C', fontSize:'9px', letterSpacing:'1px', marginTop:'1px' }}>{district.code} • {district.state?.name} • DISTRICT DETAIL</div>
          </div>
          <span style={{ fontSize:'10px', fontWeight:800, background:st.bg, color:st.color, padding:'3px 8px' }}>{isActive ? 'ACTIVE' : 'INACTIVE'}</span>
          <span style={{ fontSize:'10px', fontWeight:800, background:tt.bg, color:tt.color, padding:'3px 8px' }}>Territory: {district.territory}</span>
          {district.pendingApprovalCount > 0 && (
            <span style={{ background:'#DC2626', color:'#fff', fontSize:'10px', fontWeight:800, padding:'3px 8px' }}>
              {district.pendingApprovalCount} PENDING APPROVALS
            </span>
          )}
        </div>
        <div style={{ display:'flex', gap:'8px' }}>
          {hasEdit && <button onClick={() => navigate(`/app/location/districts/${id}/edit`)} style={{ background:'rgba(184,150,12,0.15)', border:'1px solid rgba(184,150,12,0.4)', color:'#B8960C', padding:'6px 12px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>✎ EDIT</button>}
          <button onClick={() => navigate(`/app/location/districts/${id}/dashboard`)} style={{ background:'rgba(37,99,235,0.15)', border:'1px solid rgba(37,99,235,0.4)', color:'#93C5FD', padding:'6px 12px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>📊 DASHBOARD</button>
          <button onClick={() => navigate('/app/location/control')} style={{ background:'rgba(220,38,38,0.15)', border:'1px solid rgba(220,38,38,0.4)', color:'#FCA5A5', padding:'6px 12px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>⊘ TERRITORY CONTROL</button>
          <button onClick={() => navigate('/app/approvals')} style={{ background:'rgba(184,150,12,0.2)', border:'1px solid rgba(184,150,12,0.5)', color:'#B8960C', padding:'6px 12px', fontSize:'10px', fontWeight:800, cursor:'pointer' }}>✓ APPROVAL QUEUE</button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ background:'#0A1520', borderBottom:'1px solid rgba(184,150,12,0.2)', display:'flex', padding:'0 20px' }}>
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)} style={{ padding:'10px 18px', border:'none', background:'none', cursor:'pointer', fontSize:'10px', fontWeight:tab===t?800:400, color:tab===t?'#B8960C':'rgba(255,255,255,0.35)', borderBottom:tab===t?'2px solid #B8960C':'2px solid transparent', letterSpacing:'1.5px', textTransform:'uppercase', position:'relative' }}>
            {t}
            {t==='approvals' && district.pendingApprovalCount > 0 && (
              <span style={{ marginLeft:'5px', background:'#DC2626', color:'#fff', fontSize:'8px', fontWeight:800, padding:'1px 5px' }}>{district.pendingApprovalCount}</span>
            )}
          </button>
        ))}
      </div>

      {/* KPI Strip */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(6,1fr)', gap:'1px', background:'#D4C9B0', borderBottom:'2px solid #B8960C' }}>
        {[
          { label:'Areas',            value:district.cityCount,                                color:'#2563EB' },
          { label:'Total Salons',     value:district.totalSalons.toLocaleString('en-IN'),        color:'#B8960C' },
          { label:'Active Salons',    value:district.activeSalons.toLocaleString('en-IN'),        color:'#059669' },
          { label:'Total Bookings',   value:district.totalBookings.toLocaleString('en-IN'),       color:'#7C3AED' },
          { label:'Coverage',         value:`${district.coverage}%`,                              color:district.coverage>=80?'#059669':'#D97706' },
          { label:'Pending Approvals',value:district.pendingApprovalCount,                        color:'#DC2626' },
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
              <BCardHeader title="District Information"/>
              <div style={{ padding:'14px' }}>
                <SLabel title="Basic"/>
                <InfoRow label="District Name"  value={district.name}/>
                <InfoRow label="Code"           value={district.code}/>
                <InfoRow label="State"          value={`${district.state?.name} (${district.state?.code})`}/>
                <InfoRow label="Capital / HQ"   value={district.capital}/>
                <InfoRow label="Status"         value={isActive ? 'ACTIVE' : 'INACTIVE'} valueColor={st.color}/>
                <InfoRow label="Territory"      value={district.territory} valueColor={tt.color}/>
                <InfoRow label="Pincodes"       value={district.pincodesCount}/>
                <InfoRow label="Created"        value={new Date(district.createdAt).toLocaleDateString('en-IN')}/>
                <InfoRow label="Last Updated"   value={new Date(district.updatedAt).toLocaleDateString('en-IN')}/>
                <SLabel title="Coverage"/>
                <div style={{ padding:'8px 0' }}>
                  <div style={{ display:'flex', justifyContent:'space-between', marginBottom:'6px' }}>
                    <span style={{ fontSize:'12px', color:'#9E8E6E' }}>Territory Coverage</span>
                    <span style={{ fontSize:'12px', fontWeight:700, color:'#B8960C' }}>{district.coverage}%</span>
                  </div>
                  <div style={{ height:'8px', background:'#E8DFD0' }}>
                    <div style={{ height:'100%', width:`${district.coverage}%`, background:district.coverage>=80?'#059669':district.coverage>=60?'#D97706':'#DC2626' }}/>
                  </div>
                </div>
              </div>
            </BCard>

            <BCard>
              <BCardHeader title="Business Performance"/>
              <div style={{ padding:'14px' }}>
                <div style={{ background:'#0D1B2A', padding:'16px', marginBottom:'14px', textAlign:'center', borderTop:'2px solid #B8960C' }}>
                  <div style={{ fontSize:'10px', color:'rgba(255,255,255,0.4)', letterSpacing:'1px', marginBottom:'6px' }}>TOTAL GBV</div>
                  <div style={{ fontSize:'24px', fontWeight:800, color:'#B8960C' }}>{formatINR(district.totalGbvInPaise)}</div>
                </div>
                <SLabel title="Metrics"/>
                <InfoRow label="Total Bookings"     value={district.totalBookings.toLocaleString('en-IN')}/>
                <InfoRow label="Avg Rating"         value={district.avgRating ? `${district.avgRating} ★` : 'No ratings yet'} valueColor="#D97706"/>
                <InfoRow label="Active Salons"      value={`${district.activeSalons} / ${district.totalSalons}`} valueColor="#059669"/>
                <InfoRow label="Pending Approvals"  value={district.pendingApprovalCount} valueColor="#DC2626"/>
              </div>
            </BCard>

            <BCard>
              <BCardHeader title="Top Areas"/>
              <div style={{ padding:'14px' }}>
                {analyticsLoading
                  ? <EmptyState>Loading…</EmptyState>
                  : topCities.length === 0
                    ? <EmptyState>No booking activity yet</EmptyState>
                    : topCities.slice(0, 3).map((a, i) => (
                      <div key={a.cityId || i} style={{ padding:'10px 0', borderBottom:'1px solid #F0EAE0' }}>
                        <div style={{ display:'flex', justifyContent:'space-between', marginBottom:'4px' }}>
                          <span style={{ fontSize:'13px', fontWeight:600, color:'#1A1A2E' }}>{i+1}. {a.cityName}</span>
                          <span style={{ fontSize:'12px', color:'#B8960C', fontWeight:700 }}>{a.salonCount} salons</span>
                        </div>
                        <div style={{ height:'4px', background:'#E8DFD0' }}>
                          <div style={{ height:'100%', width:`${(a.salonCount/(topCities[0].salonCount||1))*100}%`, background:'#B8960C' }}/>
                        </div>
                      </div>
                    ))
                }
                <button onClick={() => setTab('areas')} style={{ marginTop:'12px', background:'none', border:'none', cursor:'pointer', fontSize:'11px', color:'#B8960C', fontWeight:700, padding:0 }}>VIEW ALL AREAS ▸</button>
              </div>
            </BCard>
          </div>
        )}

        {/* AREAS */}
        {tab === 'areas' && (
          <BCard>
            <BCardHeader title={`Areas (${areas.length})`} action={
              hasEdit && <button onClick={() => alert('Add Area form not built yet.')} style={{ background:'#B8960C', color:'#0D1B2A', border:'none', padding:'4px 10px', fontSize:'10px', fontWeight:800, cursor:'pointer' }}>+ ADD AREA</button>
            }/>
            <div style={{ display:'grid', gridTemplateColumns:'1.8fr 1fr 0.9fr 0.9fr 0.9fr', padding:'8px 14px', background:'#F5F0E8', borderBottom:'1px solid #E8DFD0', gap:'8px' }}>
              {['AREA NAME','PINCODE','STATUS','SERVICEABLE','ACTIONS'].map(h => (
                <span key={h} style={{ fontSize:'9px', fontWeight:800, color:'#9E8E6E', letterSpacing:'1px' }}>{h}</span>
              ))}
            </div>
            {areasLoading
              ? <EmptyState>Loading areas…</EmptyState>
              : areasError
                ? <EmptyState>⚠ {areasError}</EmptyState>
                : areas.length === 0
                  ? <EmptyState>No areas found for this district</EmptyState>
                  : areas.map((a, i) => {
                    const aActive = !!a.isActive
                    const as = aActive ? STATUS_COLORS.ACTIVE : STATUS_COLORS.INACTIVE
                    const sv = a.isServiceable ? TERRITORY_COLORS.OPEN : TERRITORY_COLORS.CLOSED
                    return (
                      <div key={a.id || a._id} style={{ display:'grid', gridTemplateColumns:'1.8fr 1fr 0.9fr 0.9fr 0.9fr', padding:'10px 14px', borderBottom:'1px solid #F0EAE0', alignItems:'center', gap:'8px', background:i%2===0?'#fff':'#FDFAF6' }}>
                        <span style={{ fontSize:'13px', fontWeight:700, color:'#1A1A2E' }}>{a.name}</span>
                        <span style={{ fontSize:'12px', color:'#6B5E3E', fontFamily:'monospace' }}>{a.pincode || '—'}</span>
                        <span style={{ fontSize:'9px', fontWeight:800, background:as.bg, color:as.color, padding:'2px 6px', display:'inline-block' }}>{aActive ? 'ACTIVE' : 'INACTIVE'}</span>
                        <span style={{ fontSize:'9px', fontWeight:800, background:sv.bg, color:sv.color, padding:'2px 6px', display:'inline-block' }}>{a.isServiceable ? 'YES' : 'NO'}</span>
                        <div style={{ display:'flex', gap:'3px' }}>
                          <button onClick={() => navigate(`/app/location/areas/${a.id || a._id}`)} style={{ background:'#1A1A2E', color:'#fff', border:'none', padding:'4px 7px', fontSize:'9px', fontWeight:700, cursor:'pointer' }}>VIEW</button>
                        </div>
                      </div>
                    )
                  })
            }
          </BCard>
        )}

        {/* ADMINS */}
        {tab === 'admins' && (
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'14px' }}>
            <BCard>
              <BCardHeader title="District Admin" action={
                hasEdit && <button onClick={() => navigate('/app/location/admin-assignment')} style={{ background:'#B8960C', color:'#0D1B2A', border:'none', padding:'4px 10px', fontSize:'10px', fontWeight:800, cursor:'pointer' }}>REASSIGN</button>
              }/>
              <div style={{ padding:'14px' }}>
                {district.districtAdmin ? (
                  <>
                    <div style={{ display:'flex', alignItems:'center', gap:'14px', padding:'14px', background:'#F5F0E8', border:'1px solid #E8DFD0', borderTop:'2px solid #B8960C', marginBottom:'14px' }}>
                      <div style={{ width:'48px', height:'48px', background:'#0D1B2A', display:'flex', alignItems:'center', justifyContent:'center', color:'#B8960C', fontSize:'20px', fontWeight:800, flexShrink:0 }}>
                        {district.districtAdmin.name[0]}
                      </div>
                      <div>
                        <div style={{ fontSize:'15px', fontWeight:800, color:'#1A1A2E' }}>{district.districtAdmin.name}</div>
                        <div style={{ fontSize:'11px', color:'#B8960C', fontWeight:600, letterSpacing:'0.5px' }}>DISTRICT ADMIN — {district.name}</div>
                      </div>
                      <span style={{ marginLeft:'auto', fontSize:'10px', fontWeight:800, background:'#D1FAE5', color:'#065F46', padding:'3px 8px' }}>{district.districtAdmin.status}</span>
                    </div>
                    <InfoRow label="Email"       value={district.districtAdmin.email}/>
                    <InfoRow label="Phone"       value={district.districtAdmin.phone}/>
                    <InfoRow label="Assigned At" value={new Date(district.districtAdmin.assignedAt).toLocaleDateString('en-IN')}/>
                    <InfoRow label="Role"        value="Can RECOMMEND salons" valueColor="#059669"/>
                    {hasEdit && (
                      <div style={{ display:'flex', gap:'8px', marginTop:'14px' }}>
                        <button onClick={() => navigate('/app/location/admin-assignment')} style={{ flex:1, background:'#F5F0E8', border:'1px solid #D4C9B0', color:'#6B5E3E', padding:'8px', fontSize:'11px', fontWeight:700, cursor:'pointer' }}>↔ TRANSFER</button>
                      </div>
                    )}
                  </>
                ) : (
                  <EmptyState>⚠ No admin assigned to this district</EmptyState>
                )}
              </div>
            </BCard>

            {/* Permission Matrix — static role-capability reference,
                not district-specific data, kept as documentation. */}
            <BCard>
              <BCardHeader title="District Admin Permission Matrix"/>
              <div style={{ padding:'16px', display:'grid', gridTemplateColumns:'1fr 1fr', gap:'10px' }}>
                {[
                  { action:'Review Salon',    allowed:true,  note:'Can review submitted salons' },
                  { action:'Approve Salon',   allowed:false, note:'Only State/India Admin can approve' },
                  { action:'Reject Salon',    allowed:true,  note:'Can reject with reason' },
                  { action:'Close Area',      allowed:true,  note:'Can request area closure' },
                  { action:'Edit District',   allowed:false, note:'Only State/India Admin' },
                  { action:'Assign Admin',    allowed:false, note:'Only State/India Admin' },
                  { action:'View Analytics',  allowed:true,  note:'Full district analytics access' },
                  { action:'Archive District',allowed:false, note:'India Admin only' },
                ].map(p => (
                  <div key={p.action} style={{ padding:'10px', background:p.allowed?'#F0FDF4':'#FEF2F2', border:`1px solid ${p.allowed?'#D1FAE5':'#FEE2E2'}`, borderTop:`2px solid ${p.allowed?'#059669':'#DC2626'}` }}>
                    <div style={{ fontSize:'11px', fontWeight:800, color:p.allowed?'#065F46':'#991B1B', marginBottom:'4px' }}>
                      {p.allowed?'✓':'✕'} {p.action}
                    </div>
                    <div style={{ fontSize:'10px', color:'#9E8E6E' }}>{p.note}</div>
                  </div>
                ))}
              </div>
            </BCard>
          </div>
        )}

        {/* APPROVALS — District Admin ka primary workspace */}
        {tab === 'approvals' && (
          <div>
            <div style={{ background:'#FFFBEB', border:'1px solid #FDE68A', borderLeft:'4px solid #D97706', padding:'10px 16px', marginBottom:'14px', fontSize:'12px', color:'#92400E', fontWeight:600 }}>
              ⭐ Review pending salon submissions for this district.
            </div>
            <BCard>
              <BCardHeader title={`Pending Approvals (${approvals.length})`} action={
                <button onClick={() => navigate('/app/approvals')} style={{ background:'#B8960C', color:'#0D1B2A', border:'none', padding:'4px 12px', fontSize:'10px', fontWeight:800, cursor:'pointer' }}>VIEW FULL QUEUE ▸</button>
              }/>
              <div style={{ display:'grid', gridTemplateColumns:'0.8fr 1.5fr 1.2fr 0.9fr 0.7fr 1fr', padding:'8px 14px', background:'#F5F0E8', borderBottom:'1px solid #E8DFD0', gap:'8px' }}>
                {['SALON ID','SALON NAME','OWNER','SUBMITTED','STATUS','ACTIONS'].map(h => (
                  <span key={h} style={{ fontSize:'9px', fontWeight:800, color:'#9E8E6E', letterSpacing:'1px' }}>{h}</span>
                ))}
              </div>
              {approvalsLoading
                ? <EmptyState>Loading pending approvals…</EmptyState>
                : approvalsError
                  ? <EmptyState>⚠ {approvalsError}</EmptyState>
                  : approvals.length === 0
                    ? <EmptyState>✓ No pending approvals for this district</EmptyState>
                    : approvals.map((p, i) => (
                      <div key={p.id} style={{ display:'grid', gridTemplateColumns:'0.8fr 1.5fr 1.2fr 0.9fr 0.7fr 1fr', padding:'12px 14px', borderBottom:'1px solid #F0EAE0', alignItems:'center', gap:'8px', background:i%2===0?'#fff':'#FDFAF6' }}>
                        <span style={{ fontSize:'10px', color:'#9E8E6E', fontFamily:'monospace' }}>{String(p.id).slice(-6)}</span>
                        <span style={{ fontSize:'13px', fontWeight:700, color:'#1A1A2E' }}>{p.shopName}</span>
                        <span style={{ fontSize:'12px', color:'#6B5E3E' }}>{p.ownerName || '—'}</span>
                        <span style={{ fontSize:'11px', color:'#9E8E6E' }}>{new Date(p.createdAt).toLocaleDateString('en-IN')}</span>
                        <span style={{ fontSize:'9px', fontWeight:800, background:'#FEF9C3', color:'#92400E', padding:'2px 6px', display:'inline-block' }}>{p.status}</span>
                        <div style={{ display:'flex', gap:'4px' }}>
                          <button onClick={() => handleApprove(p.id)} style={{ background:'#059669', color:'#fff', border:'none', padding:'5px 8px', fontSize:'9px', fontWeight:700, cursor:'pointer' }}>✓ APPROVE</button>
                          <button onClick={() => handleReject(p.id)} style={{ background:'#FEF2F2', border:'1px solid #DC2626', color:'#DC2626', padding:'5px 8px', fontSize:'9px', fontWeight:700, cursor:'pointer' }}>✕ REJECT</button>
                        </div>
                      </div>
                    ))
              }
            </BCard>
          </div>
        )}

        {/* ANALYTICS */}
        {tab === 'analytics' && (
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'14px' }}>
            <BCard>
              <BCardHeader title={`Booking Trend (${analytics?.months || 6} months)`}/>
              <div style={{ padding:'14px' }}>
                {analyticsLoading ? <EmptyState>Loading…</EmptyState> :
                  <LineChart data={analytics?.bookingTrend || []} valueKey="bookings" labelKey="month" color="#B8960C"/>
                }
              </div>
            </BCard>
            <BCard>
              <BCardHeader title="GBV Trend"/>
              <div style={{ padding:'14px' }}>
                {analyticsLoading ? <EmptyState>Loading…</EmptyState> :
                  <LineChart data={(analytics?.bookingTrend || []).map(b => ({ ...b, gbvRupees: (b.gbvInPaise||0)/100 }))} valueKey="gbvRupees" labelKey="month" color="#059669"/>
                }
              </div>
            </BCard>
            <BCard style={{ gridColumn:'1/-1' }}>
              <BCardHeader title="Top Areas Performance"/>
              <div style={{ display:'grid', gridTemplateColumns:'2fr 1fr 1fr 2fr', padding:'8px 14px', background:'#F5F0E8', borderBottom:'1px solid #E8DFD0', gap:'8px' }}>
                {['AREA','SALONS','BOOKINGS','PERFORMANCE'].map(h => (
                  <span key={h} style={{ fontSize:'9px', fontWeight:800, color:'#9E8E6E', letterSpacing:'1px' }}>{h}</span>
                ))}
              </div>
              {topCities.length === 0
                ? <EmptyState>No booking activity in this period</EmptyState>
                : topCities.map((a, i) => (
                  <div key={a.cityId || i} style={{ display:'grid', gridTemplateColumns:'2fr 1fr 1fr 2fr', padding:'11px 14px', borderBottom:'1px solid #F0EAE0', alignItems:'center', gap:'8px', background:i%2===0?'#fff':'#FDFAF6' }}>
                    <span style={{ fontSize:'13px', fontWeight:600, color:'#1A1A2E' }}>{a.cityName}</span>
                    <span style={{ fontSize:'12px', fontWeight:700, color:'#B8960C' }}>{a.salonCount}</span>
                    <span style={{ fontSize:'12px', color:'#059669', fontWeight:600 }}>{a.bookings.toLocaleString('en-IN')}</span>
                    <div>
                      <div style={{ height:'6px', background:'#E8DFD0' }}>
                        <div style={{ height:'100%', width:`${(a.bookings/(topCities[0].bookings||1))*100}%`, background:'#B8960C' }}/>
                      </div>
                    </div>
                  </div>
                ))
              }
            </BCard>
          </div>
        )}

        {/* AUDIT */}
        {tab === 'audit' && (
          <BCard>
            <BCardHeader title="Audit Log — Immutable" action={
              <span style={{ fontSize:'10px', color:'#DC2626', fontWeight:700 }}>⚠ CANNOT BE DELETED</span>
            }/>
            <div style={{ display:'grid', gridTemplateColumns:'1.4fr 1.2fr 2.2fr 1fr', padding:'8px 14px', background:'#F5F0E8', borderBottom:'1px solid #E8DFD0', gap:'8px' }}>
              {['DATE & TIME','ADMIN','ACTION','IP'].map(h => (
                <span key={h} style={{ fontSize:'9px', fontWeight:800, color:'#9E8E6E', letterSpacing:'1px' }}>{h}</span>
              ))}
            </div>
            {auditLoading
              ? <EmptyState>Loading audit log…</EmptyState>
              : auditError
                ? <EmptyState>⚠ {auditError}</EmptyState>
                : auditLogs.length === 0
                  ? <EmptyState>No audit entries yet for this district</EmptyState>
                  : auditLogs.map((a, i) => (
                    <div key={a.id} style={{ display:'grid', gridTemplateColumns:'1.4fr 1.2fr 2.2fr 1fr', padding:'11px 14px', borderBottom:'1px solid #F0EAE0', alignItems:'center', gap:'8px', background:i%2===0?'#fff':'#FDFAF6' }}>
                      <span style={{ fontSize:'11px', color:'#6B5E3E', fontFamily:'monospace' }}>{new Date(a.createdAt).toLocaleString('en-IN')}</span>
                      <span style={{ fontSize:'12px', color:'#1A1A2E', fontWeight:600 }}>{a.admin?.name || 'System'}</span>
                      <span style={{ fontSize:'12px', color:'#1A1A2E' }}>{a.action.replace(/_/g, ' ')}</span>
                      <span style={{ fontSize:'11px', color:'#9E8E6E', fontFamily:'monospace' }}>{a.ip || '—'}</span>
                    </div>
                  ))
            }
            <div style={{ padding:'8px 14px', background:'#FFFBEB', borderTop:'1px solid #FDE68A', fontSize:'10px', color:'#92400E', fontWeight:600 }}>
              ⚠ Audit logs are immutable. No records can be modified or deleted.
            </div>
          </BCard>
        )}

      </div>

      <div style={{ background:'#0D1B2A', borderTop:'2px solid #B8960C', padding:'10px 20px', display:'flex', justifyContent:'space-between', marginTop:'14px' }}>
        <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.3)' }}>ZEMISH TERRITORY ENGINE v1.0.0</span>
        <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.3)' }}>NATIONAL COMMAND CENTER</span>
      </div>
    </div>
  )
}