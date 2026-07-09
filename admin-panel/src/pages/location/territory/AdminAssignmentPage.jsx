import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FONTS } from '../../../config/brand'
import useAuthStore from '../../../store/authStore'
import LocationAPI from '../api/location.api'

const ADMIN_LEVELS = { SUPER_ADMIN:'SUPER_ADMIN', INDIA_ADMIN:'INDIA_ADMIN', STATE_ADMIN:'STATE_ADMIN', DISTRICT_ADMIN:'DISTRICT_ADMIN' }
const canAssign    = (l) => [ADMIN_LEVELS.SUPER_ADMIN, ADMIN_LEVELS.INDIA_ADMIN].includes(l)

// NOTE ON DATA SOURCES (read before touching this file):
// Unassigned Districts -> LIVE. Backend getDistricts?unassigned=true
//   returns districts whose linked admin is still a seed-time
//   placeholder (phone: null) -- confirmed via Postman (778 of 780).
// All Admins registry    -> NO BACKEND. No list-all-admins endpoint
//   exists anywhere in the codebase (confirmed via repo-wide grep).
//   UI SHELL IS KEPT (filters, table headers, columns) per project
//   rule "never remove UI, show honest empty state instead of fake
//   data" -- only the DATA is honestly empty, not the layout.
// Assignment History     -> NO BACKEND for a cross-district feed.
//   Per-district audit exists (getDistrictAuditLog) but there is no
//   global "all assignments across all districts" endpoint. Same
//   treatment: UI shell kept, data honestly empty.
// "Admin Pool" concept    -> DOES NOT EXIST in the backend. Every
//   assignment (first-time or transfer) always creates a brand new
//   admin user via assignDistrictAdmin(districtId, {adminName, phone,
//   email}); there is no reusable pool of "available" pre-existing
//   admins to pick from, and no standalone "deactivate an admin
//   without replacing them" endpoint either. The old AssignModal
//   (pick-from-pool) and TransferModal are replaced by a single
//   "Assign New Admin" form per district -- this is a genuine
//   architecture difference, not an oversight.
// "+ ADD NEW ADMIN" (header button, old file) -> removed because
//   there is no district-agnostic "create a standalone admin"
//   endpoint -- every admin is always created IN THE CONTEXT of a
//   specific district via assignDistrictAdmin. Assigning from the
//   Unassigned tab's row-level ASSIGN button is the real equivalent.
// "← TERRITORY DASHBOARD" nav button (old file) -> repointed to
//   "← TERRITORY CONTROL" because Territory Dashboard
//   (location/dashboard) was explicitly marked SKIPPED in the
//   handoff note; Territory Control is the nearest real, connected
//   page. Flagging this explicitly since it's a real behavior change,
//   not a silent one.

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

// ─── Assign New Admin Modal ───────────────────────────────
// Replaces the old "pick from available pool" concept -- backend
// always creates a brand new admin record, so this is a plain form.
function AssignAdminModal({ district, onConfirm, onCancel, isSaving, error }) {
  const [adminName, setAdminName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')

  const cleanedPhone = phone.replace(/\D/g, '')
  const canSubmit = adminName.trim().length >= 2 && cleanedPhone.length === 10 && !isSaving

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.75)', zIndex:2000, display:'flex', alignItems:'center', justifyContent:'center' }}>
      <div style={{ background:'#fff', width:'440px', border:'2px solid #B8960C' }}>
        <div style={{ background:'#0D1B2A', padding:'14px 18px', borderBottom:'2px solid #B8960C' }}>
          <div style={{ color:'#fff', fontWeight:800, fontSize:'13px', letterSpacing:'1px' }}>👤 ASSIGN DISTRICT ADMIN</div>
          <div style={{ color:'#B8960C', fontSize:'10px', marginTop:'2px' }}>{district?.name} — {district?.state}</div>
        </div>
        <div style={{ padding:'20px 18px' }}>
          {error && (
            <div style={{ background:'#FEF2F2', border:'1px solid #FEE2E2', padding:'10px', marginBottom:'14px', fontSize:'11px', color:'#991B1B', fontWeight:600 }}>
              ⚠ {error}
            </div>
          )}
          <div style={{ marginBottom:'14px' }}>
            <label style={{ display:'block', fontSize:'10px', fontWeight:800, color:'#9E8E6E', letterSpacing:'1px', textTransform:'uppercase', marginBottom:'6px' }}>Admin Name *</label>
            <input value={adminName} onChange={e=>setAdminName(e.target.value)} placeholder="e.g. Rajesh Kumar" disabled={isSaving}
              style={{ width:'100%', border:'1px solid #D4C9B0', padding:'8px 12px', fontSize:'13px', fontFamily:FONTS.body, outline:'none', boxSizing:'border-box' }}/>
          </div>
          <div style={{ marginBottom:'14px' }}>
            <label style={{ display:'block', fontSize:'10px', fontWeight:800, color:'#9E8E6E', letterSpacing:'1px', textTransform:'uppercase', marginBottom:'6px' }}>Phone (10 digits) *</label>
            <input value={phone} onChange={e=>setPhone(e.target.value)} placeholder="e.g. 9812345678" disabled={isSaving}
              style={{ width:'100%', border:'1px solid #D4C9B0', padding:'8px 12px', fontSize:'13px', fontFamily:FONTS.body, outline:'none', boxSizing:'border-box' }}/>
          </div>
          <div style={{ marginBottom:'14px' }}>
            <label style={{ display:'block', fontSize:'10px', fontWeight:800, color:'#9E8E6E', letterSpacing:'1px', textTransform:'uppercase', marginBottom:'6px' }}>Email (optional)</label>
            <input value={email} onChange={e=>setEmail(e.target.value)} placeholder="e.g. rajesh@zemish.in" disabled={isSaving}
              style={{ width:'100%', border:'1px solid #D4C9B0', padding:'8px 12px', fontSize:'13px', fontFamily:FONTS.body, outline:'none', boxSizing:'border-box' }}/>
          </div>
          <div style={{ background:'#F5F0E8', border:'1px solid #E8DFD0', padding:'10px', marginBottom:'14px', fontSize:'11px', color:'#9E8E6E' }}>
            ⚠ This creates a new admin account with a temporary password and is permanently logged in the audit trail.
          </div>
          <div style={{ display:'flex', gap:'8px', justifyContent:'flex-end' }}>
            <button onClick={onCancel} disabled={isSaving}
              style={{ background:'#fff', border:'1px solid #D4C9B0', color:'#6B5E3E', padding:'8px 16px', fontSize:'11px', fontWeight:700, cursor:isSaving?'not-allowed':'pointer' }}>CANCEL</button>
            <button onClick={() => canSubmit && onConfirm({ adminName: adminName.trim(), phone: cleanedPhone, email: email.trim() || undefined })}
              style={{ background:canSubmit?'#B8960C':'#F5F0E8', border:'none', color:canSubmit?'#0D1B2A':'#C4B49A', padding:'8px 20px', fontSize:'11px', fontWeight:800, cursor:canSubmit?'pointer':'not-allowed' }}>
              {isSaving ? 'ASSIGNING...' : '✓ ASSIGN'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function AssignSuccessModal({ result, onClose }) {
  const admin = result?.data?.admin
  const previousAdmin = result?.data?.previousAdmin
  const wasTransfer = !!previousAdmin
  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.75)', zIndex:2000, display:'flex', alignItems:'center', justifyContent:'center' }}>
      <div style={{ background:'#fff', width:'440px', border:'2px solid #059669' }}>
        <div style={{ background:'#064E3B', padding:'14px 18px', borderBottom:'2px solid #059669' }}>
          <div style={{ color:'#fff', fontWeight:800, fontSize:'13px', letterSpacing:'1px' }}>✓ ADMIN ASSIGNED</div>
        </div>
        <div style={{ padding:'20px 18px' }}>
          <div style={{ fontSize:'13px', color:'#1A1A2E', marginBottom:'14px' }}>{result?.message}</div>

          <div style={{
            display:'flex', alignItems:'center', gap:'6px', padding:'8px 12px', marginBottom:'14px',
            background: wasTransfer ? '#FFFBEB' : '#F0FDF4',
            border: `1px solid ${wasTransfer ? '#FDE68A' : '#D1FAE5'}`,
            fontSize:'11px', fontWeight:700,
            color: wasTransfer ? '#92400E' : '#065F46',
          }}>
            {wasTransfer
              ? `🔄 Transferred — previous admin (${previousAdmin.name}) has been deactivated`
              : '✅ First-time assignment — no previous admin existed for this district'}
          </div>
          {admin && (
            <div style={{ background:'#F5F0E8', border:'1px solid #E8DFD0', padding:'14px', marginBottom:'14px' }}>
              <div style={{ fontSize:'10px', color:'#9E8E6E', fontWeight:800, letterSpacing:'1px', marginBottom:'8px' }}>LOGIN CREDENTIALS (share securely)</div>
              <div style={{ fontSize:'12px', color:'#1A1A2E', marginBottom:'4px' }}>Name: <strong>{admin.name}</strong></div>
              <div style={{ fontSize:'12px', color:'#1A1A2E', marginBottom:'4px' }}>Phone: <strong>{admin.phone}</strong></div>
              <div style={{ fontSize:'12px', color:'#1A1A2E', marginBottom:'4px' }}>Temp Password: <strong style={{ color:'#B8960C', fontFamily:'monospace' }}>{admin.tempPassword}</strong></div>
              <div style={{ fontSize:'10px', color:'#DC2626', marginTop:'8px', fontWeight:600 }}>⚠ Admin will be required to change this password on first login.</div>
            </div>
          )}
          <button onClick={onClose} style={{ width:'100%', background:'#B8960C', border:'none', color:'#0D1B2A', padding:'10px', fontSize:'12px', fontWeight:800, cursor:'pointer' }}>DONE</button>
        </div>
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────
export default function AdminAssignmentPage() {
  const navigate      = useNavigate()
  const admin          = useAuthStore(s => s.admin)
  const adminLevel     = admin?.adminLevel || ADMIN_LEVELS.SUPER_ADMIN
  const hasAssignPerm  = canAssign(adminLevel)

  const [tab, setTab] = useState('unassigned')

  // Unassigned districts -- LIVE data
  const [districts,      setDistricts]      = useState([])
  const [loading,         setLoading]         = useState(true)
  const [error,           setError]           = useState(null)
  const [search,          setSearch]          = useState('')
  const [searchInput,     setSearchInput]     = useState('')
  const [stateFilter,     setStateFilter]     = useState('')
  const [page,            setPage]            = useState(1)
  const [totalPages,      setTotalPages]      = useState(1)
  const [totalCount,      setTotalCount]      = useState(0)
  const [stateOptions,    setStateOptions]    = useState([])

  const [assignTarget,    setAssignTarget]    = useState(null)
  const [isAssigning,     setIsAssigning]     = useState(false)
  const [assignError,     setAssignError]     = useState(null)
  const [successResult,   setSuccessResult]   = useState(null)
  const [toast,           setToast]           = useState(null)

  // All-Admins tab -- UI shell kept, no backend, filters are inert
  const [adminSearch,      setAdminSearch]      = useState('')
  const [adminLevelFilter, setAdminLevelFilter] = useState('ALL')
  const [adminStatusFilter,setAdminStatusFilter]= useState('ALL')

  const PER_PAGE = 50

  const showToast = (msg, color) => { setToast({ msg, color }); setTimeout(() => setToast(null), 3000) }

  const fetchUnassigned = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await LocationAPI.getDistricts({
        unassigned: 'true',
        search: search || undefined,
        stateId: stateFilter || undefined,
        page,
        limit: PER_PAGE,
      })
      const rows = res.data || []
      setDistricts(rows)
      setTotalPages(res.pagination?.totalPages ?? 1)
      setTotalCount(res.pagination?.total ?? rows.length)

      setStateOptions(prev => {
        const seen = new Map(prev.map(s => [s.id, s]))
        rows.forEach(d => { if (d.state?.id) seen.set(d.state.id, d.state) })
        return Array.from(seen.values()).sort((a,b) => a.name.localeCompare(b.name))
      })
    } catch (err) {
      setError(err.message || 'Failed to load unassigned districts')
    } finally {
      setLoading(false)
    }
  }, [search, stateFilter, page])

  useEffect(() => { fetchUnassigned() }, [fetchUnassigned])

  useEffect(() => {
    const t = setTimeout(() => { setSearch(searchInput); setPage(1) }, 400)
    return () => clearTimeout(t)
  }, [searchInput])

  const handleAssignConfirm = async ({ adminName, phone, email }) => {
    setIsAssigning(true)
    setAssignError(null)
    try {
      const res = await LocationAPI.assignDistrictAdmin(assignTarget.id, { adminName, phone, email })
      setAssignTarget(null)
      setSuccessResult(res)
      fetchUnassigned()
    } catch (err) {
      setAssignError(err.message || 'Failed to assign admin')
    } finally {
      setIsAssigning(false)
    }
  }

  const TABS = ['unassigned', 'all-admins', 'history']

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
          <h1 style={{ fontSize:'13px', fontWeight:800, color:'#fff', margin:0, letterSpacing:'2px', textTransform:'uppercase' }}>Admin Assignment</h1>
          <span style={{ background:'rgba(220,38,38,0.2)', color:'#FCA5A5', fontSize:'10px', fontWeight:800, padding:'2px 8px', border:'1px solid rgba(220,38,38,0.3)' }}>
            ⚠ {loading ? '…' : totalCount} NEED REAL ADMIN
          </span>
        </div>
        <div style={{ display:'flex', gap:'8px' }}>
          {/* Repointed from old '/app/location/dashboard' (Territory
              Dashboard) since that page is explicitly SKIPPED per the
              project handoff note. Territory Control is the nearest
              real, connected destination. */}
          <button onClick={() => navigate('/app/location/control')} style={{ background:'rgba(255,255,255,0.07)', border:'1px solid rgba(255,255,255,0.15)', color:'rgba(255,255,255,0.5)', padding:'6px 12px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>← TERRITORY CONTROL</button>
        </div>
      </div>

      {!hasAssignPerm && (
        <div style={{ background:'#FEF2F2', border:'1px solid #FEE2E2', padding:'10px 20px', fontSize:'12px', color:'#991B1B', fontWeight:600 }}>
          ⚠ {adminLevel} — View Only. Only SUPER_ADMIN and INDIA_ADMIN can assign district admins.
        </div>
      )}

      {/* Tabs */}
      <div style={{ background:'#0A1520', borderBottom:'1px solid rgba(184,150,12,0.2)', display:'flex', padding:'0 20px' }}>
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)} style={{ padding:'10px 18px', border:'none', background:'none', cursor:'pointer', fontSize:'10px', fontWeight:tab===t?800:400, color:tab===t?'#B8960C':'rgba(255,255,255,0.35)', borderBottom:tab===t?'2px solid #B8960C':'2px solid transparent', letterSpacing:'1.5px', textTransform:'uppercase' }}>
            {t.replace('-',' ')}
            {t === 'unassigned' && (
              <span style={{ marginLeft:'5px', background:'#DC2626', color:'#fff', fontSize:'9px', padding:'1px 5px' }}>{loading ? '…' : totalCount}</span>
            )}
            {t !== 'unassigned' && (
              <span style={{ marginLeft:'5px', background:'rgba(217,119,6,0.25)', color:'#FBBF24', fontSize:'9px', padding:'1px 5px' }}>N/A</span>
            )}
          </button>
        ))}
      </div>

      {/* KPI Strip -- restored. Only the "unassigned" metric is real
          (from the live API); the rest are honestly marked N/A rather
          than showing fabricated Active/Available/Inactive counts,
          since there is no admin-registry backend to compute them from. */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:'1px', background:'#D4C9B0', borderBottom:'2px solid #B8960C' }}>
        {[
          { label:'Total Districts',           value: loading ? '…' : totalCount, color:'#DC2626' },
          { label:'Active Admins',             value:'N/A', color:'#9E8E6E' },
          { label:'Available Admins',          value:'N/A', color:'#9E8E6E' },
          { label:'Inactive Admins',           value:'N/A', color:'#9E8E6E' },
          { label:'Districts Needing Admin',   value: loading ? '…' : totalCount, color:'#B8960C' },
        ].map(k => (
          <div key={k.label} style={{ background:'#0D1B2A', padding:'10px 16px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
            <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.4)' }}>{k.label}</span>
            <span style={{ fontSize:'18px', fontWeight:800, color:k.color }}>{k.value}</span>
          </div>
        ))}
      </div>

      <div style={{ padding:'14px 20px' }}>

        {/* UNASSIGNED -- LIVE */}
        {tab === 'unassigned' && (
          <div>
            {!hasAssignPerm && (
              <div style={{ background:'#FEF2F2', border:'1px solid #FEE2E2', padding:'12px 16px', marginBottom:'14px', fontSize:'12px', color:'#991B1B', fontWeight:600 }}>
                ⚠ {adminLevel} — View Only. Only SUPER_ADMIN and INDIA_ADMIN can assign admins.
              </div>
            )}

            <BCard style={{ marginBottom:'12px' }}>
              <div style={{ padding:'10px 14px', display:'flex', gap:'8px', alignItems:'center', flexWrap:'wrap' }}>
                <div style={{ display:'flex', alignItems:'center', gap:'6px' }}>
                  <div style={{ width:'3px', height:'14px', background:'#B8960C' }}/>
                  <span style={{ fontSize:'10px', fontWeight:800, color:'#9E8E6E', letterSpacing:'1px' }}>FILTERS</span>
                </div>
                <input value={searchInput} onChange={e=>setSearchInput(e.target.value)} placeholder="Search district name..."
                  style={{ flex:1, minWidth:'200px', border:'1px solid #D4C9B0', padding:'6px 10px', fontSize:'12px', fontFamily:FONTS.body, outline:'none', background:'#FDFAF6' }}/>
                <select value={stateFilter} onChange={e=>{ setStateFilter(e.target.value); setPage(1) }}
                  style={{ border:'1px solid #D4C9B0', padding:'5px 8px', fontSize:'11px', color:'#6B5E3E', background:'#FDFAF6', cursor:'pointer', fontFamily:FONTS.body, outline:'none' }}>
                  <option value="">All States</option>
                  {stateOptions.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                <span style={{ fontSize:'11px', color:'#9E8E6E' }}>{totalCount} districts</span>
                <button onClick={()=>{ setSearchInput(''); setSearch(''); setStateFilter(''); setPage(1) }}
                  style={{ background:'#F5F0E8', border:'1px solid #D4C9B0', color:'#9E8E6E', padding:'5px 10px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>RESET</button>
              </div>
            </BCard>

            <BCard>
              <BCardHeader title={`Districts Needing a Real Admin (${totalCount})`} action={
                <span style={{ fontSize:'10px', color:'#DC2626', fontWeight:700 }}>⚠ Requires Immediate Action</span>
              }/>

              {error && (
                <div style={{ padding:'30px', textAlign:'center' }}>
                  <div style={{ color:'#991B1B', fontSize:'12px', fontWeight:600, marginBottom:'10px' }}>⚠ {error}</div>
                  <button onClick={fetchUnassigned} style={{ background:'#DC2626', color:'#fff', border:'none', padding:'6px 14px', fontSize:'11px', fontWeight:700, cursor:'pointer' }}>RETRY</button>
                </div>
              )}

              {!error && (
                <>
                  <div style={{ display:'grid', gridTemplateColumns:'0.8fr 1.4fr 1fr 0.8fr 1.6fr 1fr', padding:'8px 14px', background:'#F5F0E8', borderBottom:'1px solid #E8DFD0', gap:'8px' }}>
                    {['CODE','DISTRICT','STATE','SALONS','CURRENT (PLACEHOLDER)','ACTIONS'].map(h => (
                      <span key={h} style={{ fontSize:'9px', fontWeight:800, color:'#9E8E6E', letterSpacing:'1px' }}>{h}</span>
                    ))}
                  </div>

                  {loading && <div style={{ padding:'40px', textAlign:'center', color:'#9E8E6E' }}>Loading…</div>}

                  {!loading && districts.length === 0 && (
                    <div style={{ padding:'40px', textAlign:'center', color:'#059669', fontWeight:600 }}>✓ No districts match — all assigned or filtered out</div>
                  )}

                  {!loading && districts.map((d, i) => (
                    <div key={d.id} style={{ display:'grid', gridTemplateColumns:'0.8fr 1.4fr 1fr 0.8fr 1.6fr 1fr', padding:'11px 14px', borderBottom:'1px solid #F0EAE0', alignItems:'center', gap:'8px', background:i%2===0?'#fff':'#FDFAF6' }}>
                      <span style={{ fontSize:'10px', color:'#9E8E6E', fontFamily:'monospace', fontWeight:600 }}>{d.code}</span>
                      <span style={{ fontSize:'13px', fontWeight:700, color:'#1A1A2E' }}>{d.name}</span>
                      <span style={{ fontSize:'11px', fontWeight:800, color:'#B8960C' }}>{d.state?.name}</span>
                      <span style={{ fontSize:'12px', color:'#6B5E3E' }}>{d.salonCount}</span>
                      <span style={{ fontSize:'11px', color:'#DC2626', fontStyle:'italic' }}>{d.districtAdmin?.name || '—'} (no phone)</span>
                      <div>
                        {hasAssignPerm
                          ? <button onClick={() => { setAssignTarget({ id:d.id, name:d.name, state:d.state?.name }); setAssignError(null) }}
                              style={{ background:'#B8960C', color:'#0D1B2A', border:'none', padding:'5px 10px', fontSize:'9px', fontWeight:800, cursor:'pointer' }}>ASSIGN ▸</button>
                          : <span style={{ fontSize:'10px', color:'#C4B49A', fontStyle:'italic' }}>No permission</span>
                        }
                      </div>
                    </div>
                  ))}

                  {!loading && districts.length > 0 && (
                    <div style={{ padding:'12px 14px', borderTop:'1px solid #E8DFD0', display:'flex', justifyContent:'space-between', alignItems:'center', background:'#FDFAF6' }}>
                      <span style={{ fontSize:'11px', color:'#9E8E6E' }}>Page {page} of {totalPages} — {totalCount} total</span>
                      <div style={{ display:'flex', gap:'4px' }}>
                        <button onClick={() => setPage(p => Math.max(1, p-1))} disabled={page===1}
                          style={{ background:page===1?'#F5F0E8':'#1A1A2E', color:page===1?'#C4B49A':'#fff', border:'1px solid #D4C9B0', padding:'5px 10px', fontSize:'11px', fontWeight:700, cursor:page===1?'not-allowed':'pointer' }}>← PREV</button>
                        <button onClick={() => setPage(p => Math.min(totalPages, p+1))} disabled={page===totalPages}
                          style={{ background:page===totalPages?'#F5F0E8':'#1A1A2E', color:page===totalPages?'#C4B49A':'#fff', border:'1px solid #D4C9B0', padding:'5px 10px', fontSize:'11px', fontWeight:700, cursor:page===totalPages?'not-allowed':'pointer' }}>NEXT →</button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </BCard>
          </div>
        )}

        {/* ALL ADMINS -- UI shell restored, no backend, so every row
            is honestly empty rather than the section being deleted. */}
        {tab === 'all-admins' && (
          <div>
            <div style={{ background:'#FFFBEB', border:'1px solid #FDE68A', padding:'10px 16px', marginBottom:'12px', fontSize:'11px', color:'#92400E', fontWeight:600 }}>
              ⏳ No backend endpoint exists yet to list all admin accounts (confirmed by searching the codebase). Filters below are shown for layout consistency but have no data to act on yet.
            </div>
            <BCard style={{ marginBottom:'12px' }}>
              <div style={{ padding:'10px 14px', display:'flex', gap:'8px', alignItems:'center', flexWrap:'wrap' }}>
                <div style={{ display:'flex', alignItems:'center', gap:'6px' }}>
                  <div style={{ width:'3px', height:'14px', background:'#B8960C' }}/>
                  <span style={{ fontSize:'10px', fontWeight:800, color:'#9E8E6E', letterSpacing:'1px' }}>FILTERS</span>
                </div>
                <input value={adminSearch} onChange={e=>setAdminSearch(e.target.value)} placeholder="Search admin, email, territory..." disabled
                  style={{ flex:1, minWidth:'200px', border:'1px solid #D4C9B0', padding:'6px 10px', fontSize:'12px', fontFamily:FONTS.body, outline:'none', background:'#F5F0E8', color:'#C4B49A' }}/>
                <select value={adminLevelFilter} onChange={e=>setAdminLevelFilter(e.target.value)} disabled
                  style={{ border:'1px solid #D4C9B0', padding:'5px 8px', fontSize:'11px', color:'#C4B49A', background:'#F5F0E8', fontFamily:FONTS.body, outline:'none' }}>
                  {['ALL','STATE_ADMIN','DISTRICT_ADMIN'].map(o=><option key={o}>{o}</option>)}
                </select>
                <select value={adminStatusFilter} onChange={e=>setAdminStatusFilter(e.target.value)} disabled
                  style={{ border:'1px solid #D4C9B0', padding:'5px 8px', fontSize:'11px', color:'#C4B49A', background:'#F5F0E8', fontFamily:FONTS.body, outline:'none' }}>
                  {['ALL','ACTIVE','AVAILABLE','INACTIVE'].map(o=><option key={o}>{o}</option>)}
                </select>
                <span style={{ fontSize:'11px', color:'#9E8E6E' }}>0 results</span>
                <button disabled style={{ background:'#F5F0E8', border:'1px solid #D4C9B0', color:'#C4B49A', padding:'5px 10px', fontSize:'10px', fontWeight:700, cursor:'not-allowed' }}>RESET</button>
              </div>
            </BCard>
            <BCard>
              <BCardHeader title="Admin Registry (0)"/>
              <div style={{ display:'grid', gridTemplateColumns:'2fr 1.8fr 0.8fr 1.2fr 0.8fr 1fr 1.2fr', padding:'8px 14px', background:'#F5F0E8', borderBottom:'1px solid #E8DFD0', gap:'8px' }}>
                {['ADMIN NAME','EMAIL','LEVEL','ASSIGNED TO','TYPE','STATUS','ACTIONS'].map(h=>(
                  <span key={h} style={{ fontSize:'9px', fontWeight:800, color:'#9E8E6E', letterSpacing:'1px' }}>{h}</span>
                ))}
              </div>
              <div style={{ padding:'40px', textAlign:'center', color:'#9E8E6E' }}>
                No data — backend endpoint for this registry doesn't exist yet.
              </div>
            </BCard>
          </div>
        )}

        {/* HISTORY -- UI shell restored, no backend, honestly empty. */}
        {tab === 'history' && (
          <div>
            <div style={{ background:'#FFFBEB', border:'1px solid #FDE68A', padding:'10px 16px', marginBottom:'12px', fontSize:'11px', color:'#92400E', fontWeight:600 }}>
              ⏳ Per-district audit logs exist and work (see each District's own Audit tab), but there is no single feed showing assignment history across ALL districts at once yet.
            </div>
            <BCard>
              <BCardHeader title="Assignment History — All Districts" action={
                <span style={{ fontSize:'10px', color:'#DC2626', fontWeight:700 }}>⚠ IMMUTABLE (when available)</span>
              }/>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1.2fr 2.5fr 1fr', padding:'8px 14px', background:'#F5F0E8', borderBottom:'1px solid #E8DFD0', gap:'8px' }}>
                {['DATE','ADMIN','ACTION','DONE BY'].map(h=>(
                  <span key={h} style={{ fontSize:'9px', fontWeight:800, color:'#9E8E6E', letterSpacing:'1px' }}>{h}</span>
                ))}
              </div>
              <div style={{ padding:'40px', textAlign:'center', color:'#9E8E6E' }}>
                No data — cross-district history endpoint doesn't exist yet.
              </div>
              <div style={{ padding:'8px 14px', background:'#FFFBEB', borderTop:'1px solid #FDE68A', fontSize:'10px', color:'#92400E', fontWeight:600 }}>
                ⚠ When built, assignment history will be immutable and cannot be deleted (matches District Audit Log behavior already in production).
              </div>
            </BCard>
          </div>
        )}

      </div>

      <div style={{ background:'#0D1B2A', borderTop:'2px solid #B8960C', padding:'10px 20px', display:'flex', justifyContent:'space-between', marginTop:'14px' }}>
        <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.3)' }}>ZEMISH ADMIN ASSIGNMENT v1.0.0</span>
        <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.3)' }}>NATIONAL COMMAND CENTER</span>
      </div>

      {assignTarget && (
        <AssignAdminModal
          district={assignTarget}
          isSaving={isAssigning}
          error={assignError}
          onConfirm={handleAssignConfirm}
          onCancel={() => !isAssigning && setAssignTarget(null)}
        />
      )}

      {successResult && (
        <AssignSuccessModal
          result={successResult}
          onClose={() => { setSuccessResult(null); showToast('✓ District admin assigned', '#059669') }}
        />
      )}
    </div>
  )
}