import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FONTS } from '../../../config/brand'
import useAuthStore from '../../../store/authStore'
import LocationAPI from '../api/location.api'

const ADMIN_LEVELS        = { SUPER_ADMIN:'SUPER_ADMIN', INDIA_ADMIN:'INDIA_ADMIN', STATE_ADMIN:'STATE_ADMIN', DISTRICT_ADMIN:'DISTRICT_ADMIN' }
const canControl          = (l) => [ADMIN_LEVELS.SUPER_ADMIN, ADMIN_LEVELS.INDIA_ADMIN].includes(l)
const canBulkAction       = (l) => l === ADMIN_LEVELS.SUPER_ADMIN
const canRequestClosure   = (l) => l === ADMIN_LEVELS.STATE_ADMIN

// ─── NOTE ON DATA SOURCES ─────────────────────────────────
// Districts  -> LIVE, connected to real backend (verified via Postman:
//              GET/PATCH /api/admin/districts, territory + closedReason
//              fields confirmed working end-to-end).
// States     -> NOT YET CONNECTED. State controller has not been
//              verified to support manualTerritoryOverride/notes the
//              same way District does. Shown as "Pending Verification"
//              rather than fake data - never fabricate numbers here.
// Areas      -> NOT YET AVAILABLE. Area model has no territory field
//              today (confirmed by reading Area.js - only
//              `isServiceable: Boolean` exists, no OPEN/PARTIAL/CLOSED
//              enum, no closedReason). Explicit decision: skip for now,
//              revisit once Area schema gets a territory field.
// ───────────────────────────────────────────────────────────

const CLOSURE_REASONS = [
  'Operational Maintenance',
  'Admin Transfer Pending',
  'Legal Issue',
  'Natural Disaster / Emergency',
  'Fraud Investigation',
  'System Maintenance',
  'Other',
]

const TERRITORY_COLORS = {
  OPEN:    { bg:'#D1FAE5', color:'#065F46', border:'#059669' },
  PARTIAL: { bg:'#FEF9C3', color:'#92400E', border:'#D97706' },
  CLOSED:  { bg:'#FEE2E2', color:'#991B1B', border:'#DC2626' },
}

// Maps a real /api/admin/districts response row into the shape
// TerritoryRow already expects (kept intentionally close to the old
// dummy shape so the row component didn't need rewriting).
function mapDistrictItem(d) {
  return {
    id:       d.id,
    name:     d.name,
    state:    d.state?.code || '',
    salons:   d.salonCount ?? 0,
    territory:d.territory,
    reason:   d.closedReason || null,
    isActive: d.isActive,
    districtAdminName: d.districtAdmin?.name || null,
  }
}

// ─── Action Modal ─────────────────────────────────────────
function TerritoryActionModal({ item, action, isSaving, onConfirm, onCancel }) {
  const [reason,    setReason]    = useState('')
  const [customReason, setCustomReason] = useState('')
  const isClose   = action === 'CLOSE'
  const isOpen    = action === 'OPEN'
  const isPartial = action === 'PARTIAL'

  const finalReason = reason === 'Other' ? customReason : reason

  const actionColors = {
    CLOSE:   { header:'#7F1D1D', border:'#DC2626', btn:'#DC2626', btnText:'#fff',    label:'⊘ CLOSE TERRITORY'    },
    OPEN:    { header:'#064E3B', border:'#059669', btn:'#059669', btnText:'#fff',    label:'✓ OPEN TERRITORY'     },
    PARTIAL: { header:'#78350F', border:'#D97706', btn:'#D97706', btnText:'#0D1B2A', label:'⚠ SET PARTIAL'        },
  }
  const ac = actionColors[action]

  const canSubmit = (isOpen || finalReason.trim()) && !isSaving

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.8)', zIndex:2000, display:'flex', alignItems:'center', justifyContent:'center' }}>
      <div style={{ background:'#fff', width:'480px', border:`2px solid ${ac.border}` }}>
        <div style={{ background:ac.header, padding:'14px 18px', borderBottom:`2px solid ${ac.border}` }}>
          <div style={{ color:'#fff', fontWeight:800, fontSize:'13px', letterSpacing:'1px' }}>{ac.label}</div>
          <div style={{ color:'rgba(255,255,255,0.6)', fontSize:'10px', marginTop:'2px' }}>{item?.name} — {item?.id}</div>
        </div>
        <div style={{ padding:'20px 18px' }}>
          {isClose && (
            <div style={{ background:'#FEF2F2', border:'1px solid #FEE2E2', padding:'12px', marginBottom:'14px', fontSize:'11px', color:'#991B1B', fontWeight:600 }}>
              ⚠ Closing territory will PAUSE all bookings. Existing appointments will be honoured.
            </div>
          )}
          {isOpen && (
            <div style={{ background:'#F0FDF4', border:'1px solid #D1FAE5', padding:'12px', marginBottom:'14px', fontSize:'11px', color:'#065F46', fontWeight:600 }}>
              ✓ Opening territory will RESUME all salon bookings in this area.
            </div>
          )}
          {isPartial && (
            <div style={{ background:'#FFFBEB', border:'1px solid #FDE68A', padding:'12px', marginBottom:'14px', fontSize:'11px', color:'#92400E', fontWeight:600 }}>
              ⚠ Partial mode — Limited operations. Some salons may remain active.
            </div>
          )}

          <label style={{ fontSize:'10px', color:'#9E8E6E', fontWeight:800, letterSpacing:'1px', display:'block', marginBottom:'6px' }}>
            {isOpen ? 'REOPENING NOTE (OPTIONAL)' : 'REASON (REQUIRED)'}
          </label>

          {!isOpen ? (
            <>
              <select value={reason} onChange={e=>setReason(e.target.value)} disabled={isSaving}
                style={{ width:'100%', border:'1px solid #D4C9B0', padding:'8px 12px', fontSize:'13px', fontFamily:FONTS.body, outline:'none', marginBottom:'10px', boxSizing:'border-box' }}>
                <option value="">Select reason...</option>
                {CLOSURE_REASONS.map(r => <option key={r}>{r}</option>)}
              </select>
              {reason === 'Other' && (
                <input value={customReason} onChange={e=>setCustomReason(e.target.value)} placeholder="Specify reason..." disabled={isSaving}
                  style={{ width:'100%', border:'1px solid #D4C9B0', padding:'8px 12px', fontSize:'13px', fontFamily:FONTS.body, outline:'none', marginBottom:'10px', boxSizing:'border-box' }}/>
              )}
            </>
          ) : (
            <textarea value={reason} onChange={e=>setReason(e.target.value)} placeholder="Optional note for audit trail..." disabled={isSaving}
              style={{ width:'100%', border:'1px solid #D4C9B0', padding:'8px 12px', fontSize:'13px', fontFamily:FONTS.body, outline:'none', minHeight:'60px', resize:'vertical', boxSizing:'border-box', marginBottom:'10px' }}/>
          )}

          <div style={{ background:'#F5F0E8', border:'1px solid #E8DFD0', padding:'10px', marginBottom:'14px', fontSize:'11px', color:'#9E8E6E' }}>
            ⚠ This action will be permanently logged in audit trail.
          </div>

          <div style={{ display:'flex', gap:'8px', justifyContent:'flex-end' }}>
            <button onClick={onCancel} disabled={isSaving}
              style={{ background:'#fff', border:'1px solid #D4C9B0', color:'#6B5E3E', padding:'8px 16px', fontSize:'11px', fontWeight:700, cursor:isSaving?'not-allowed':'pointer' }}>CANCEL</button>
            <button
              onClick={() => canSubmit && onConfirm(finalReason)}
              style={{ background:canSubmit?ac.btn:'#F5F0E8', border:'none', color:canSubmit?ac.btnText:'#C4B49A', padding:'8px 20px', fontSize:'11px', fontWeight:800, cursor:canSubmit?'pointer':'not-allowed', letterSpacing:'0.5px' }}>
              {isSaving ? 'SAVING...' : ac.label}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Components ──────────────────────────────────────────
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

// Honest placeholder for tabs/sections whose backend isn't verified
// or doesn't exist yet — never fabricate numbers or rows here.
function PendingCard({ title, message }) {
  return (
    <BCard>
      <BCardHeader title={title}/>
      <div style={{ padding:'40px 20px', textAlign:'center' }}>
        <div style={{ fontSize:'28px', marginBottom:'10px' }}>⏳</div>
        <div style={{ fontSize:'13px', fontWeight:700, color:'#6B5E3E', marginBottom:'6px' }}>Not Connected Yet</div>
        <div style={{ fontSize:'11px', color:'#9E8E6E', maxWidth:'420px', margin:'0 auto' }}>{message}</div>
      </div>
    </BCard>
  )
}

function TerritoryRow({ item, hasControl, onAction }) {
  const tt = TERRITORY_COLORS[item.territory] || TERRITORY_COLORS.PARTIAL
  return (
    <div style={{ display:'grid', gridTemplateColumns:'0.8fr 1.6fr 0.5fr 0.6fr 0.8fr 1.8fr 1.6fr', padding:'11px 14px', borderBottom:'1px solid #F0EAE0', alignItems:'center', gap:'8px', background:item.territory==='CLOSED'?'#FEF2F2':item.territory==='PARTIAL'?'#FFFBEB':'#fff' }}>
      <span style={{ fontSize:'10px', color:'#9E8E6E', fontFamily:'monospace', fontWeight:600 }}>{item.id.slice(-6)}</span>
      <div>
        <div style={{ fontSize:'13px', fontWeight:700, color:'#1A1A2E' }}>{item.name}</div>
        {item.reason && <div style={{ fontSize:'9px', color:'#D97706', marginTop:'1px', fontWeight:600 }}>⚠ {item.reason}</div>}
        {item.districtAdminName && <div style={{ fontSize:'9px', color:'#9E8E6E', marginTop:'1px' }}>Admin: {item.districtAdminName}</div>}
      </div>
      <span style={{ fontSize:'11px', fontWeight:800, color:'#B8960C', fontFamily:'monospace' }}>{item.state}</span>
      <span style={{ fontSize:'12px', color:'#6B5E3E' }}>{item.salons}</span>
      <span style={{ fontSize:'9px', fontWeight:800, background:tt.bg, color:tt.color, border:`1px solid ${tt.border}`, padding:'3px 8px', display:'inline-block', letterSpacing:'0.3px' }}>{item.territory}</span>
      <div style={{ fontSize:'11px', color:item.reason?'#D97706':'#059669', fontStyle:item.reason?'italic':'normal' }}>
        {item.reason || '✓ Operating normally'}
      </div>
      {hasControl ? (
        <div style={{ display:'flex', gap:'3px' }}>
          {item.territory !== 'OPEN' && (
            <button onClick={() => onAction(item, 'OPEN')} style={{ background:'#059669', color:'#fff', border:'none', padding:'4px 8px', fontSize:'9px', fontWeight:700, cursor:'pointer' }}>✓ OPEN</button>
          )}
          {item.territory !== 'PARTIAL' && (
            <button onClick={() => onAction(item, 'PARTIAL')} style={{ background:'#D97706', color:'#fff', border:'none', padding:'4px 8px', fontSize:'9px', fontWeight:700, cursor:'pointer' }}>⚠ PARTIAL</button>
          )}
          {item.territory !== 'CLOSED' && (
            <button onClick={() => onAction(item, 'CLOSE')} style={{ background:'#DC2626', color:'#fff', border:'none', padding:'4px 8px', fontSize:'9px', fontWeight:700, cursor:'pointer' }}>⊘ CLOSE</button>
          )}
        </div>
      ) : (
        <span style={{ fontSize:'10px', color:'#C4B49A', fontStyle:'italic' }}>View only</span>
      )}
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────
export default function TerritoryControlPage() {
  const navigate    = useNavigate()
  const admin       = useAuthStore(s => s.admin)
  const adminLevel  = admin?.adminLevel || ADMIN_LEVELS.SUPER_ADMIN
  const hasControl  = canControl(adminLevel)
  const hasBulk     = canBulkAction(adminLevel)
  const canRequest  = canRequestClosure(adminLevel)

  const [tab,        setTab]        = useState('overview')
  const [modal,      setModal]      = useState(null) // { item, action }
  const [isSaving,   setIsSaving]   = useState(false)
  const [toast,      setToast]      = useState(null)

  // ── Districts — LIVE data ─────────────────────────────
  const [districtItems,    setDistrictItems]    = useState([])
  const [districtsLoading, setDistrictsLoading] = useState(true)
  const [districtsError,   setDistrictsError]   = useState(null)
  const [districtsTruncated, setDistrictsTruncated] = useState(false)
  // Total district count district-wide (any territory) — used only to
  // derive an OPEN count for the summary strip, since the backend's
  // /districts list endpoint doesn't expose a full OPEN/PARTIAL/CLOSED
  // breakdown in one call (only closedTerritoryCount today). No new
  // backend field added for this — derived client-side instead:
  // openCount = totalDistricts - partialCount - closedCount.
  const [totalDistrictsCount, setTotalDistrictsCount] = useState(null)

  const showToast = (msg, color) => { setToast({ msg, color }); setTimeout(() => setToast(null), 3000) }

  const fetchExceptionDistricts = useCallback(async () => {
    setDistrictsLoading(true)
    setDistrictsError(null)
    try {
      const [partialRes, closedRes, totalRes] = await Promise.all([
        LocationAPI.getDistricts({ territory: 'PARTIAL', limit: 100 }),
        LocationAPI.getDistricts({ territory: 'CLOSED',  limit: 100 }),
        LocationAPI.getDistricts({ limit: 1 }), // just to read pagination.total
      ])

      const partialItems = (partialRes.data || []).map(mapDistrictItem)
      const closedItems  = (closedRes.data  || []).map(mapDistrictItem)

      setDistrictItems([...closedItems, ...partialItems])
      setTotalDistrictsCount(totalRes.pagination?.total ?? null)
      setDistrictsTruncated(
        (partialRes.pagination?.total || 0) > 100 || (closedRes.pagination?.total || 0) > 100
      )
    } catch (err) {
      setDistrictsError(err.message || 'Failed to load districts')
    } finally {
      setDistrictsLoading(false)
    }
  }, [])

  useEffect(() => { fetchExceptionDistricts() }, [fetchExceptionDistricts])

  const handleAction = async (reason) => {
    const { item, action } = modal
    const newTerritory = action === 'CLOSE' ? 'CLOSED' : action === 'PARTIAL' ? 'PARTIAL' : 'OPEN'

    setIsSaving(true)
    try {
      await LocationAPI.updateDistrict(item.id, {
        manualTerritoryOverride: newTerritory,
        closedReason: action === 'OPEN' ? null : reason,
      })
      const msgs = { CLOSE:'⊘ Territory Closed', OPEN:'✓ Territory Opened', PARTIAL:'⚠ Set to Partial' }
      const cols  = { CLOSE:'#DC2626', OPEN:'#059669', PARTIAL:'#D97706' }
      showToast(`${msgs[action]} — ${item.name}`, cols[action])
      setModal(null)
      await fetchExceptionDistricts() // re-sync from server — don't trust optimistic local state
    } catch (err) {
      showToast(`✗ Failed — ${err.message || 'Could not update territory'}`, '#DC2626')
    } finally {
      setIsSaving(false)
    }
  }

  const totalClosed  = districtItems.filter(t => t.territory === 'CLOSED').length
  const totalPartial = districtItems.filter(t => t.territory === 'PARTIAL').length
  const totalOpen     = totalDistrictsCount !== null
    ? Math.max(0, totalDistrictsCount - totalClosed - totalPartial)
    : null
  const total = totalDistrictsCount !== null ? totalDistrictsCount : (totalClosed + totalPartial)

  const TABS = ['overview', 'states', 'districts', 'areas']
  const TABLE_HEAD = ['ID','NAME','STATE','SALONS','TERRITORY','REASON / STATUS','ACTIONS']

  return (
    <div style={{ fontFamily:FONTS.body, background:'#F0EAE0', minHeight:'100vh' }}>

      {toast && (
        <div style={{ position:'fixed', top:'20px', right:'20px', background:toast.color, color:'#fff', padding:'12px 20px', fontSize:'13px', fontWeight:700, zIndex:9999, boxShadow:'0 4px 12px rgba(0,0,0,0.2)' }}>
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <div style={{ background:'#0D1B2A', borderBottom:'2px solid #DC2626', padding:'0 20px', height:'52px', display:'flex', alignItems:'center', justifyContent:'space-between', position:'sticky', top:0, zIndex:10 }}>
        <div style={{ display:'flex', alignItems:'center', gap:'12px' }}>
          <div style={{ width:'3px', height:'16px', background:'#DC2626' }}/>
          <h1 style={{ fontSize:'13px', fontWeight:800, color:'#fff', margin:0, letterSpacing:'2px', textTransform:'uppercase' }}>⊘ Territory Control</h1>
          <span style={{ background:'rgba(220,38,38,0.2)', color:'#FCA5A5', fontSize:'10px', fontWeight:800, padding:'2px 8px', border:'1px solid rgba(220,38,38,0.3)' }}>EMERGENCY PANEL</span>
          {totalClosed > 0 && <span style={{ background:'#DC2626', color:'#fff', fontSize:'10px', fontWeight:800, padding:'2px 8px' }}>{totalClosed} CLOSED</span>}
          {totalPartial > 0 && <span style={{ background:'#D97706', color:'#fff', fontSize:'10px', fontWeight:800, padding:'2px 8px' }}>{totalPartial} PARTIAL</span>}
        </div>
        <div style={{ display:'flex', gap:'8px' }}>
          <button onClick={() => navigate('/app/location/dashboard')} style={{ background:'rgba(255,255,255,0.07)', border:'1px solid rgba(255,255,255,0.15)', color:'rgba(255,255,255,0.5)', padding:'6px 12px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>← DASHBOARD</button>
          <button onClick={() => navigate('/app/location/admin-assignment')} style={{ background:'rgba(124,58,237,0.15)', border:'1px solid rgba(124,58,237,0.4)', color:'#C4B5FD', padding:'6px 12px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>👤 ADMIN ASSIGNMENT</button>
        </div>
      </div>

      {/* Permission Warning */}
      {!hasControl && !canRequest && (
        <div style={{ background:'#FEF2F2', borderBottom:'2px solid #DC2626', padding:'10px 20px' }}>
          <span style={{ fontSize:'12px', color:'#991B1B', fontWeight:700 }}>⊘ {adminLevel} — View Only. Territory control requires SUPER_ADMIN or INDIA_ADMIN.</span>
        </div>
      )}
      {canRequest && (
        <div style={{ background:'#FFFBEB', borderBottom:'2px solid #D97706', padding:'10px 20px' }}>
          <span style={{ fontSize:'12px', color:'#92400E', fontWeight:700 }}>⚠ STATE_ADMIN — View Only. You can request territory changes through your India Admin.</span>
        </div>
      )}

      {/* Tabs */}
      <div style={{ background:'#0A1520', borderBottom:'1px solid rgba(220,38,38,0.3)', display:'flex', padding:'0 20px' }}>
        {TABS.map(t => {
          const isConnected = t === 'districts'
          const badge = t === 'overview' ? null
            : t === 'districts' ? String(districtItems.length)
            : 'PENDING'
          return (
            <button key={t} onClick={() => setTab(t)} style={{ padding:'10px 18px', border:'none', background:'none', cursor:'pointer', fontSize:'10px', fontWeight:tab===t?800:400, color:tab===t?'#FCA5A5':'rgba(255,255,255,0.35)', borderBottom:tab===t?'2px solid #DC2626':'2px solid transparent', letterSpacing:'1.5px', textTransform:'uppercase' }}>
              {t}
              {badge && (
                <span style={{ marginLeft:'5px', background: isConnected ? 'rgba(255,255,255,0.1)' : 'rgba(217,119,6,0.25)', color: isConnected ? 'rgba(255,255,255,0.5)' : '#FBBF24', fontSize:'9px', padding:'1px 5px' }}>
                  {badge}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Summary Strip */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:'1px', background:'#DC2626', borderBottom:'2px solid #DC2626' }}>
        {[
          { label:'Total Districts', value: districtsLoading ? '…' : total,                          color:'#B8960C' },
          { label:'OPEN',            value: districtsLoading ? '…' : (totalOpen ?? '—'),              color:'#059669' },
          { label:'PARTIAL',         value: districtsLoading ? '…' : totalPartial,                     color:'#D97706' },
          { label:'CLOSED',          value: districtsLoading ? '…' : totalClosed,                      color:'#DC2626' },
        ].map(k => (
          <div key={k.label} style={{ background:'#0D1B2A', padding:'10px 16px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
            <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.4)' }}>{k.label}</span>
            <span style={{ fontSize:'20px', fontWeight:800, color:k.color }}>{k.value}</span>
          </div>
        ))}
      </div>

      <div style={{ padding:'14px 20px' }}>

        {/* OVERVIEW */}
        {tab === 'overview' && (
          <div style={{ display:'grid', gap:'14px' }}>

            {/* Warning Banner */}
            <div style={{ background:'#7F1D1D', border:'2px solid #DC2626', padding:'16px 20px', display:'flex', alignItems:'center', gap:'14px' }}>
              <div style={{ fontSize:'32px' }}>⚠</div>
              <div>
                <div style={{ fontSize:'14px', fontWeight:800, color:'#fff', letterSpacing:'1px', marginBottom:'4px' }}>TERRITORY CONTROL — EMERGENCY PANEL</div>
                <div style={{ fontSize:'11px', color:'rgba(255,255,255,0.7)' }}>
                  Use this panel to open or close territories due to operational issues. All actions are logged permanently.
                  {hasControl ? ' You have full control.' : ' You have view-only access.'}
                  {' '}Currently showing <strong>Districts</strong> only — State and Area territory control are not yet connected.
                </div>
              </div>
            </div>

            {districtsError && (
              <div style={{ background:'#FEF2F2', border:'1px solid #DC2626', padding:'12px 16px', color:'#991B1B', fontSize:'12px', fontWeight:600, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                <span>⚠ Failed to load districts: {districtsError}</span>
                <button onClick={fetchExceptionDistricts} style={{ background:'#DC2626', color:'#fff', border:'none', padding:'6px 12px', fontSize:'11px', fontWeight:700, cursor:'pointer' }}>RETRY</button>
              </div>
            )}

            {/* Overview Cards */}
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:'14px' }}>
              {/* Closed Territories */}
              <BCard style={{ borderTop:'2px solid #DC2626' }}>
                <BCardHeader title={`Closed Districts (${totalClosed})`} action={
                  <span style={{ fontSize:'10px', color:'#DC2626', fontWeight:700 }}>⊘ CLOSED</span>
                }/>
                <div style={{ padding:'14px' }}>
                  {districtsLoading && <div style={{ padding:'20px', textAlign:'center', color:'#9E8E6E' }}>Loading…</div>}
                  {!districtsLoading && districtItems.filter(t => t.territory==='CLOSED').map(t => (
                    <div key={t.id} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'8px 0', borderBottom:'1px solid #F0EAE0' }}>
                      <div>
                        <div style={{ fontSize:'12px', fontWeight:700, color:'#1A1A2E' }}>{t.name}</div>
                        <div style={{ fontSize:'10px', color:'#DC2626' }}>⚠ {t.reason || 'No reason recorded'}</div>
                      </div>
                      {hasControl && (
                        <button onClick={() => setModal({ item:t, action:'OPEN' })}
                          style={{ background:'#059669', color:'#fff', border:'none', padding:'4px 8px', fontSize:'9px', fontWeight:700, cursor:'pointer' }}>✓ OPEN</button>
                      )}
                    </div>
                  ))}
                  {!districtsLoading && totalClosed === 0 && <div style={{ padding:'20px', textAlign:'center', color:'#059669', fontWeight:600 }}>✓ No closed districts</div>}
                </div>
              </BCard>

              {/* Partial Territories */}
              <BCard style={{ borderTop:'2px solid #D97706' }}>
                <BCardHeader title={`Partial Districts (${totalPartial})`} action={
                  <span style={{ fontSize:'10px', color:'#D97706', fontWeight:700 }}>⚠ PARTIAL</span>
                }/>
                <div style={{ padding:'14px' }}>
                  {districtsLoading && <div style={{ padding:'20px', textAlign:'center', color:'#9E8E6E' }}>Loading…</div>}
                  {!districtsLoading && districtItems.filter(t => t.territory==='PARTIAL').map(t => (
                    <div key={t.id} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'8px 0', borderBottom:'1px solid #F0EAE0' }}>
                      <div>
                        <div style={{ fontSize:'12px', fontWeight:700, color:'#1A1A2E' }}>{t.name}</div>
                        <div style={{ fontSize:'10px', color:'#D97706' }}>⚠ {t.reason || 'Partial operations'}</div>
                      </div>
                      {hasControl && (
                        <div style={{ display:'flex', gap:'3px' }}>
                          <button onClick={() => setModal({ item:t, action:'OPEN' })} style={{ background:'#059669', color:'#fff', border:'none', padding:'4px 6px', fontSize:'9px', fontWeight:700, cursor:'pointer' }}>✓</button>
                          <button onClick={() => setModal({ item:t, action:'CLOSE' })} style={{ background:'#DC2626', color:'#fff', border:'none', padding:'4px 6px', fontSize:'9px', fontWeight:700, cursor:'pointer' }}>⊘</button>
                        </div>
                      )}
                    </div>
                  ))}
                  {!districtsLoading && totalPartial === 0 && <div style={{ padding:'20px', textAlign:'center', color:'#059669', fontWeight:600 }}>✓ No partial districts</div>}
                </div>
              </BCard>

              {/* Quick Actions */}
              <BCard>
                <BCardHeader title="Quick Actions"/>
                <div style={{ padding:'14px' }}>
                  {hasControl ? (
                    <>
                      <div style={{ fontSize:'10px', color:'#9E8E6E', fontWeight:800, letterSpacing:'1px', marginBottom:'10px' }}>EMERGENCY ACTIONS</div>
                      {hasBulk ? (
                        <>
                          {[
                            { label:'Close All Partial',  color:'#DC2626', icon:'⊘' },
                            { label:'Open All Closed',    color:'#059669', icon:'✓' },
                          ].map(a => (
                            <button key={a.label} disabled
                              title="Bulk actions are not yet wired to the backend — coming in a later pass"
                              style={{ width:'100%', background:'#F5F0E8', border:`1px solid ${a.color}55`, color:'#C4B49A', padding:'10px', fontSize:'11px', fontWeight:700, cursor:'not-allowed', marginBottom:'8px', textAlign:'left' }}>
                              {a.icon} {a.label} <span style={{ fontSize:'9px', fontStyle:'italic' }}>(coming soon)</span>
                            </button>
                          ))}
                          <div style={{ marginTop:'4px', padding:'10px', background:'#FEF2F2', border:'1px solid #FEE2E2', fontSize:'10px', color:'#991B1B', fontWeight:600 }}>
                            ⚠ Bulk actions affect ALL districts. SUPER_ADMIN only. Not yet enabled — use individual controls in the Districts tab meanwhile.
                          </div>
                        </>
                      ) : (
                        <div style={{ padding:'10px', background:'#F5F0E8', border:'1px solid #E8DFD0', fontSize:'11px', color:'#9E8E6E', fontWeight:600 }}>
                          🔒 Bulk actions restricted to SUPER_ADMIN only.
                          <div style={{ fontSize:'10px', marginTop:'4px', color:'#C4B49A' }}>Individual territory control available in the Districts tab.</div>
                        </div>
                      )}
                    </>
                  ) : (
                    <div style={{ padding:'20px', textAlign:'center', color:'#9E8E6E' }}>
                      <div style={{ fontSize:'24px', marginBottom:'8px' }}>🔒</div>
                      <div style={{ fontSize:'12px', fontWeight:600 }}>Control actions require SUPER_ADMIN or INDIA_ADMIN</div>
                    </div>
                  )}
                </div>
              </BCard>
            </div>
          </div>
        )}

        {/* STATES — not yet connected */}
        {tab === 'states' && (
          <PendingCard
            title="States Territory Control"
            message="State-level territory control isn't wired up yet — the State controller hasn't been verified to support manualTerritoryOverride the same way District does. Rather than show placeholder numbers, this stays empty until that's confirmed."
          />
        )}

        {/* DISTRICTS — LIVE */}
        {tab === 'districts' && (
          <BCard>
            <BCardHeader
              title={`Districts Territory Control (${districtItems.length})`}
              action={
                <div style={{ display:'flex', alignItems:'center', gap:'10px' }}>
                  <span style={{ fontSize:'11px', color:'#9E8E6E' }}>
                    Partial: {totalPartial} | Closed: {totalClosed}
                  </span>
                  <button onClick={fetchExceptionDistricts} disabled={districtsLoading}
                    style={{ background:'#0D1B2A', color:'#fff', border:'none', padding:'4px 10px', fontSize:'10px', fontWeight:700, cursor:districtsLoading?'not-allowed':'pointer' }}>
                    {districtsLoading ? '…' : '↻ REFRESH'}
                  </button>
                </div>
              }
            />

            {districtsTruncated && (
              <div style={{ padding:'8px 14px', background:'#FFFBEB', borderBottom:'1px solid #FDE68A', fontSize:'10px', color:'#92400E', fontWeight:600 }}>
                ⚠ Showing first 100 of each category (Partial/Closed) — full pagination for this view isn't built yet. Use search/filters on the main Districts Registry page for the complete list.
              </div>
            )}

            {districtsError && (
              <div style={{ padding:'20px', textAlign:'center' }}>
                <div style={{ color:'#991B1B', fontSize:'12px', fontWeight:600, marginBottom:'10px' }}>⚠ {districtsError}</div>
                <button onClick={fetchExceptionDistricts} style={{ background:'#DC2626', color:'#fff', border:'none', padding:'6px 14px', fontSize:'11px', fontWeight:700, cursor:'pointer' }}>RETRY</button>
              </div>
            )}

            {!districtsError && (
              <>
                <div style={{ display:'grid', gridTemplateColumns:'0.8fr 1.6fr 0.5fr 0.6fr 0.8fr 1.8fr 1.6fr', padding:'8px 14px', background:'#F5F0E8', borderBottom:'1px solid #E8DFD0', gap:'8px' }}>
                  {TABLE_HEAD.map(h => (
                    <span key={h} style={{ fontSize:'9px', fontWeight:800, color:'#9E8E6E', letterSpacing:'1px' }}>{h}</span>
                  ))}
                </div>
                {districtsLoading && <div style={{ padding:'40px', textAlign:'center', color:'#9E8E6E' }}>Loading districts…</div>}
                {!districtsLoading && districtItems.length === 0 && (
                  <div style={{ padding:'40px', textAlign:'center', color:'#059669', fontWeight:600 }}>✓ No districts need attention — all OPEN</div>
                )}
                {!districtsLoading && districtItems.map(item => (
                  <TerritoryRow key={item.id} item={item} hasControl={hasControl} onAction={(item, action) => setModal({ item, action })}/>
                ))}
              </>
            )}
          </BCard>
        )}

        {/* AREAS — not available */}
        {tab === 'areas' && (
          <PendingCard
            title="Areas Territory Control"
            message="Area-level territory control isn't available yet — the Area model has no territory field today (only isServiceable). This will be enabled once a territory/closedReason field is added to the Area schema, following the same pattern used for District."
          />
        )}

      </div>

      {/* Footer */}
      <div style={{ background:'#0D1B2A', borderTop:'2px solid #DC2626', padding:'10px 20px', display:'flex', justifyContent:'space-between', marginTop:'14px' }}>
        <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.3)' }}>ZEMISH TERRITORY CONTROL v1.0.0</span>
        <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.3)' }}>NATIONAL COMMAND CENTER — EMERGENCY PANEL</span>
      </div>

      {modal && (
        <TerritoryActionModal
          item={modal.item}
          action={modal.action}
          isSaving={isSaving}
          onConfirm={handleAction}
          onCancel={() => !isSaving && setModal(null)}
        />
      )}
    </div>
  )
}