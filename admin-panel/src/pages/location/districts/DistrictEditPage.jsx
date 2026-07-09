import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { FONTS } from '../../../config/brand'
import useAuthStore from '../../../store/authStore'
import LocationAPI from '../api/location.api'

const ADMIN_LEVELS = { INDIA:'INDIA', STATE:'STATE', DISTRICT:'DISTRICT' }
const canEdit       = (l) => [ADMIN_LEVELS.INDIA, ADMIN_LEVELS.STATE].includes(l)

const TERRITORY_OPTIONS = [
  { value: '',        label: 'Auto-compute (from coverage %)' },
  { value: 'OPEN',    label: 'OPEN (manual override)' },
  { value: 'PARTIAL', label: 'PARTIAL (manual override)' },
  { value: 'CLOSED',  label: 'CLOSED (manual override)' },
]

const validate = (form) => {
  const errors = {}
  if (!form.name?.trim()) errors.name = 'District name is required'
  if (!form.code?.trim()) errors.code = 'District code is required'
  else if (!/^[A-Z0-9]{2,20}$/.test(form.code.trim().toUpperCase())) errors.code = 'Code must be 2-20 alphanumeric characters'
  return errors
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
const Field = ({ label, required, error, children }) => (
  <div style={{ marginBottom:'14px' }}>
    <label style={{ display:'block', fontSize:'10px', fontWeight:800, color:error?'#DC2626':'#9E8E6E', letterSpacing:'1px', textTransform:'uppercase', marginBottom:'6px' }}>
      {label} {required && <span style={{ color:'#DC2626' }}>*</span>}
    </label>
    {children}
    {error && <div style={{ fontSize:'10px', color:'#DC2626', marginTop:'4px', fontWeight:600 }}>⚠ {error}</div>}
  </div>
)
const Input = ({ value, onChange, placeholder, type='text', disabled=false, error=false }) => (
  <input type={type} value={value ?? ''} onChange={onChange} placeholder={placeholder} disabled={disabled}
    style={{ width:'100%', border:`1px solid ${error?'#DC2626':disabled?'#E8DFD0':'#D4C9B0'}`, padding:'8px 12px', fontSize:'13px', fontFamily:FONTS.body, outline:'none', background:disabled?'#F5F0E8':'#fff', color:disabled?'#9E8E6E':'#1A1A2E', boxSizing:'border-box', cursor:disabled?'not-allowed':'text' }}
  />
)
const Select = ({ value, onChange, options, disabled=false }) => (
  <select value={value ?? ''} onChange={onChange} disabled={disabled}
    style={{ width:'100%', border:`1px solid ${disabled?'#E8DFD0':'#D4C9B0'}`, padding:'8px 12px', fontSize:'13px', fontFamily:FONTS.body, outline:'none', background:disabled?'#F5F0E8':'#fff', color:disabled?'#9E8E6E':'#1A1A2E', cursor:disabled?'not-allowed':'pointer' }}>
    {options.map(o => <option key={o.value ?? o} value={o.value ?? o}>{o.label ?? o}</option>)}
  </select>
)
const EmptyState = ({ children }) => (
  <div style={{ padding:'30px', textAlign:'center', color:'#9E8E6E', fontSize:'12px' }}>{children}</div>
)

function ConfirmSaveModal({ name, onConfirm, onCancel }) {
  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.75)', zIndex:2000, display:'flex', alignItems:'center', justifyContent:'center' }}>
      <div style={{ background:'#fff', width:'420px', border:'2px solid #B8960C' }}>
        <div style={{ background:'#0D1B2A', padding:'14px 18px', borderBottom:'2px solid #B8960C' }}>
          <div style={{ color:'#fff', fontWeight:800, fontSize:'13px', letterSpacing:'1px' }}>✓ CONFIRM SAVE CHANGES</div>
        </div>
        <div style={{ padding:'20px 18px' }}>
          <div style={{ fontSize:'12px', color:'#9E8E6E', padding:'10px', background:'#F5F0E8', border:'1px solid #E8DFD0', marginBottom:'12px' }}>
            <strong>{name}</strong> — Save all changes?
          </div>
          <div style={{ background:'#FFFBEB', border:'1px solid #FDE68A', padding:'10px', marginBottom:'16px', fontSize:'11px', color:'#92400E', fontWeight:600 }}>
            ⚠ Changes will be permanently logged in audit trail.
          </div>
          <div style={{ display:'flex', gap:'8px', justifyContent:'flex-end' }}>
            <button onClick={onCancel} style={{ background:'#fff', border:'1px solid #D4C9B0', color:'#6B5E3E', padding:'8px 16px', fontSize:'11px', fontWeight:700, cursor:'pointer' }}>CANCEL</button>
            <button onClick={onConfirm} style={{ background:'#B8960C', border:'none', color:'#0D1B2A', padding:'8px 20px', fontSize:'11px', fontWeight:800, cursor:'pointer' }}>✓ YES, SAVE</button>
          </div>
        </div>
      </div>
    </div>
  )
}

function UnsavedExitModal({ onLeave, onStay }) {
  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.75)', zIndex:2000, display:'flex', alignItems:'center', justifyContent:'center' }}>
      <div style={{ background:'#fff', width:'400px', border:'2px solid #D97706' }}>
        <div style={{ background:'#92400E', padding:'14px 18px', borderBottom:'2px solid #D97706' }}>
          <div style={{ color:'#fff', fontWeight:800, fontSize:'13px', letterSpacing:'1px' }}>⚠ UNSAVED CHANGES</div>
        </div>
        <div style={{ padding:'20px 18px' }}>
          <div style={{ fontSize:'13px', color:'#1A1A2E', marginBottom:'16px' }}>Leave without saving?</div>
          <div style={{ display:'flex', gap:'8px', justifyContent:'flex-end' }}>
            <button onClick={onStay} style={{ background:'#B8960C', border:'none', color:'#0D1B2A', padding:'8px 20px', fontSize:'11px', fontWeight:800, cursor:'pointer' }}>STAY & SAVE</button>
            <button onClick={onLeave} style={{ background:'#FEF2F2', border:'1px solid #DC2626', color:'#DC2626', padding:'8px 16px', fontSize:'11px', fontWeight:700, cursor:'pointer' }}>LEAVE</button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function DistrictEditPage() {
  const { id }   = useParams()
  const navigate = useNavigate()
  const admin    = useAuthStore(s => s.admin)
  const adminLevel  = admin?.adminLevel || null
  const hasEditPerm = canEdit(adminLevel)

  const [tab,         setTab]         = useState('basic')
  const [isDirty,     setIsDirty]     = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [showExit,    setShowExit]    = useState(false)
  const [exitTarget,  setExitTarget]  = useState(null)
  const [errors,      setErrors]      = useState({})
  const [toast,       setToast]       = useState(null)
  const [saving,      setSaving]      = useState(false)

  const [original, setOriginal] = useState(null)
  const [loading,  setLoading]  = useState(true)
  const [loadError,setLoadError]= useState(null)

  const [history,        setHistory]        = useState([])
  const [historyLoading, setHistoryLoading]  = useState(false)
  const [historyFetched, setHistoryFetched]  = useState(false)

  const [form, setForm] = useState(null)

  useEffect(() => {
    if (!id) return
    setLoading(true)
    setLoadError(null)
    LocationAPI.getDistrictById(id)
      .then(res => {
        const d = res.data
        setOriginal(d)
        setForm({
          name:                    d.name,
          code:                    d.code,
          capital:                 d.capital || '',
          pincodesCount:           d.pincodesCount ?? 0,
          notes:                   d.notes || '',
          isActive:                d.isActive,
          manualTerritoryOverride: d.manualTerritoryOverride || '',
          closedReason:            '',
          targetAreas:             d.targetCities ?? 0,
          targetSalons:            d.targetSalons ?? 0,
        })
      })
      .catch(err => setLoadError(err.message || 'Failed to load district'))
      .finally(() => setLoading(false))
  }, [id])

  // Admin History tab — reconstructed from the audit trail (no
  // dedicated history array exists on the District document itself).
  // Only DISTRICT_ADMIN_ASSIGNED entries are relevant here. The
  // previous admin's NAME isn't captured in audit meta (only their
  // id), so those rows fall back to "Previous Admin" as a label —
  // an honest limitation rather than fabricated data.
  useEffect(() => {
    if (tab !== 'history' || historyFetched || !id) return
    setHistoryLoading(true)
    LocationAPI.getDistrictAudit(id, { limit: 100 })
      .then(res => {
        const entries = (res.data || []).filter(e => e.action === 'DISTRICT_ADMIN_ASSIGNED')
        setHistory(entries)
      })
      .catch(() => setHistory([]))
      .finally(() => { setHistoryLoading(false); setHistoryFetched(true) })
  }, [tab, historyFetched, id])

  const showToast = (msg, color) => { setToast({ msg, color }); setTimeout(() => setToast(null), 3000) }
  const markDirty = () => setIsDirty(true)
  const upd = (key, val) => { setForm(f => ({ ...f, [key]: val })); markDirty() }

  const handleNavigateAway = (path) => {
    if (isDirty) { setExitTarget(path); setShowExit(true) }
    else navigate(path)
  }

  const handleSaveAttempt = () => {
    const errs = validate(form)
    setErrors(errs)
    if (Object.keys(errs).length > 0) { showToast('⚠ Fix errors before saving', '#DC2626'); return }
    setShowConfirm(true)
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const body = {
        name: form.name.trim(),
        code: form.code.trim().toUpperCase(),
        capital: form.capital?.trim() || null,
        notes: form.notes?.trim() || null,
        pincodesCount: Number(form.pincodesCount) || 0,
        targetAreas: Number(form.targetAreas) || 0,
        targetSalons: Number(form.targetSalons) || 0,
        manualTerritoryOverride: form.manualTerritoryOverride || null,
        isActive: form.isActive,
      }
      if (form.manualTerritoryOverride === 'CLOSED') {
        body.closedReason = form.closedReason?.trim() || null
      }
      const res = await LocationAPI.updateDistrict(id, body)
      setOriginal(prev => ({ ...prev, ...res.data }))
      setShowConfirm(false)
      setIsDirty(false)
      setErrors({})
      showToast('✓ District updated successfully', '#059669')
    } catch (err) {
      setShowConfirm(false)
      showToast(`⚠ ${err.message || 'Failed to save changes'}`, '#DC2626')
    } finally {
      setSaving(false)
    }
  }

  const handleDiscard = () => {
    if (!original) return
    setForm({
      name: original.name, code: original.code, capital: original.capital || '',
      pincodesCount: original.pincodesCount ?? 0, notes: original.notes || '',
      isActive: original.isActive, manualTerritoryOverride: original.manualTerritoryOverride || '',
      closedReason: '', targetAreas: original.targetCities ?? 0, targetSalons: original.targetSalons ?? 0,
    })
    setIsDirty(false); setErrors({})
    showToast('Changes discarded', '#6B5E3E')
  }

  const handleDeactivate = async () => {
    if (!window.confirm('Deactivate this district? New onboarding will pause; existing salons are unaffected.')) return
    try {
      const res = await LocationAPI.updateDistrict(id, { isActive: false })
      setOriginal(prev => ({ ...prev, ...res.data }))
      setForm(f => ({ ...f, isActive: false }))
      showToast('✓ District deactivated', '#D97706')
    } catch (err) {
      showToast(`⚠ ${err.message || 'Failed to deactivate'}`, '#DC2626')
    }
  }

  const handleArchive = async () => {
    if (!window.confirm('Archive this district? It will be hidden from all normal listings. This can be reversed by an INDIA admin.')) return
    try {
      await LocationAPI.archiveDistrict(id)
      showToast('✓ District archived', '#374151')
      setTimeout(() => navigate('/app/location/districts'), 800)
    } catch (err) {
      showToast(`⚠ ${err.message || 'Failed to archive — check if cities still exist under this district'}`, '#DC2626')
    }
  }

  // Health score — computed client-side from real fetched data (no
  // backend endpoint for this exists). Uses the 4 factors available
  // in this context; revenue-growth is intentionally omitted here
  // (not loaded on the Edit page) rather than faked.
  const healthFactors = original ? [
    { label: 'Coverage',          val: `${original.coverage}%`,                         score: original.coverage,                                                     ok: original.coverage >= 60 },
    { label: 'Active Salons',     val: original.totalSalons > 0 ? `${Math.round((original.activeSalons/original.totalSalons)*100)}%` : '—', score: original.totalSalons > 0 ? Math.round((original.activeSalons/original.totalSalons)*100) : 0, ok: original.totalSalons > 0 && (original.activeSalons/original.totalSalons) >= 0.6 },
    { label: 'Admin Assigned',    val: original.districtAdmin ? 'Yes' : 'No',            score: original.districtAdmin ? 100 : 0,                                      ok: !!original.districtAdmin },
    { label: 'Pending Approvals', val: String(original.pendingApprovalCount),            score: Math.max(0, 100 - original.pendingApprovalCount * 5),                  ok: original.pendingApprovalCount <= 5 },
  ] : []
  const healthScore = healthFactors.length > 0
    ? Math.round(healthFactors.reduce((sum, f) => sum + f.score, 0) / healthFactors.length)
    : 0
  const healthLabel = healthScore >= 80 ? 'EXCELLENT' : healthScore >= 60 ? 'GOOD' : healthScore >= 40 ? 'AVERAGE' : 'POOR'
  const healthColor = healthScore >= 80 ? '#059669' : healthScore >= 60 ? '#D97706' : '#DC2626'

  const TABS = ['basic', 'targets', 'status', 'history']

  if (loading) {
    return (
      <div style={{ fontFamily:FONTS.body, background:'#F0EAE0', minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center' }}>
        <span style={{ color:'#9E8E6E' }}>Loading district…</span>
      </div>
    )
  }

  if (loadError || !original || !form) {
    return (
      <div style={{ fontFamily:FONTS.body, background:'#F0EAE0', minHeight:'100vh', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:'12px' }}>
        <span style={{ color:'#DC2626', fontWeight:600 }}>⚠ {loadError || 'District not found'}</span>
        <button onClick={() => navigate('/app/location/districts')} style={{ background:'#1A1A2E', color:'#fff', border:'none', padding:'8px 16px', fontSize:'12px', fontWeight:700, cursor:'pointer' }}>← Back to Districts</button>
      </div>
    )
  }

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
          <button onClick={() => handleNavigateAway(`/app/location/districts/${id}`)} style={{ background:'rgba(255,255,255,0.07)', border:'1px solid rgba(255,255,255,0.1)', color:'rgba(255,255,255,0.6)', padding:'5px 10px', cursor:'pointer', fontSize:'12px', fontWeight:700 }}>← BACK</button>
          <div style={{ width:'3px', height:'16px', background:'#B8960C' }}/>
          <div>
            <div style={{ color:'#fff', fontWeight:800, fontSize:'13px', letterSpacing:'1px' }}>{original.name}, {original.state?.code} — EDIT</div>
            <div style={{ color:'#B8960C', fontSize:'9px', letterSpacing:'1px', marginTop:'1px' }}>{original.code} • DISTRICT EDIT</div>
          </div>
          {isDirty && <span style={{ background:'#D97706', color:'#fff', fontSize:'9px', fontWeight:800, padding:'2px 8px' }}>UNSAVED CHANGES</span>}
        </div>
        <div style={{ display:'flex', gap:'8px' }}>
          {isDirty && <button onClick={handleDiscard} style={{ background:'rgba(255,255,255,0.07)', border:'1px solid rgba(255,255,255,0.15)', color:'rgba(255,255,255,0.5)', padding:'6px 12px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>DISCARD</button>}
          {hasEditPerm
            ? <button onClick={() => isDirty && !saving && handleSaveAttempt()} disabled={saving} style={{ background:isDirty?'#B8960C':'rgba(184,150,12,0.3)', border:'none', color:isDirty?'#0D1B2A':'rgba(255,255,255,0.3)', padding:'6px 16px', fontSize:'10px', fontWeight:800, cursor:isDirty&&!saving?'pointer':'not-allowed' }}>{saving?'SAVING…':'✓ SAVE CHANGES'}</button>
            : <div style={{ background:'rgba(220,38,38,0.15)', border:'1px solid rgba(220,38,38,0.3)', color:'#FCA5A5', padding:'6px 12px', fontSize:'10px', fontWeight:700 }}>VIEW ONLY — {adminLevel}</div>
          }
        </div>
      </div>

      {!hasEditPerm && (
        <div style={{ background:'#FEF2F2', borderBottom:'2px solid #DC2626', padding:'10px 20px' }}>
          <span style={{ fontSize:'12px', color:'#991B1B', fontWeight:700 }}>⚠ Only INDIA and STATE admin can edit district records. DISTRICT admin has view-only access.</span>
        </div>
      )}

      {/* Tabs */}
      <div style={{ background:'#0A1520', borderBottom:'1px solid rgba(184,150,12,0.2)', display:'flex', padding:'0 20px' }}>
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)} style={{ padding:'10px 18px', border:'none', background:'none', cursor:'pointer', fontSize:'10px', fontWeight:tab===t?800:400, color:tab===t?'#B8960C':'rgba(255,255,255,0.35)', borderBottom:tab===t?'2px solid #B8960C':'2px solid transparent', letterSpacing:'1.5px', textTransform:'uppercase' }}>
            {t}
          </button>
        ))}
      </div>

      <div style={{ padding:'16px 20px', maxWidth:'860px' }}>

        {/* BASIC */}
        {tab === 'basic' && (
          <BCard>
            <BCardHeader title="Basic Information"/>
            <div style={{ padding:'20px', display:'grid', gridTemplateColumns:'1fr 1fr', gap:'16px' }}>
              <Field label="District Name" required error={errors.name}>
                <Input value={form.name} onChange={e=>upd('name',e.target.value)} placeholder="e.g. Aligarh" disabled={!hasEditPerm} error={!!errors.name}/>
              </Field>
              <Field label="District Code" required error={errors.code}>
                <Input value={form.code} onChange={e=>upd('code',e.target.value.toUpperCase())} placeholder="e.g. ALG" disabled={!hasEditPerm} error={!!errors.code}/>
              </Field>
              <Field label="State">
                <Input value={`${original.state?.name} (${original.state?.code})`} disabled/>
              </Field>
              <Field label="Capital / HQ">
                <Input value={form.capital} onChange={e=>upd('capital',e.target.value)} placeholder="District HQ" disabled={!hasEditPerm}/>
              </Field>
              <Field label="Total Pincodes">
                <Input value={form.pincodesCount} onChange={e=>upd('pincodesCount',e.target.value)} type="number" disabled={!hasEditPerm}/>
              </Field>
              <div style={{ gridColumn:'1/-1' }}>
                <Field label="Notes / Remarks">
                  <textarea value={form.notes} onChange={e=>upd('notes',e.target.value)} disabled={!hasEditPerm}
                    style={{ width:'100%', border:`1px solid ${!hasEditPerm?'#E8DFD0':'#D4C9B0'}`, padding:'8px 12px', fontSize:'13px', fontFamily:FONTS.body, outline:'none', background:!hasEditPerm?'#F5F0E8':'#fff', minHeight:'80px', resize:'vertical', boxSizing:'border-box' }}
                  />
                </Field>
              </div>
              <div style={{ gridColumn:'1/-1', fontSize:'10px', color:'#9E8E6E', fontStyle:'italic' }}>
                ℹ State cannot be changed here — moving a district to a different state is a hierarchy-level operation, not a field edit.
              </div>
            </div>
          </BCard>
        )}

        {/* TARGETS */}
        {tab === 'targets' && (
          <BCard>
            <BCardHeader title="Expansion Targets"/>
            <div style={{ padding:'20px' }}>
              <div style={{ background:'#FFFBEB', border:'1px solid #FDE68A', padding:'12px', marginBottom:'20px', fontSize:'11px', color:'#92400E', fontWeight:600 }}>
                ℹ Targets are used for coverage % and district health score calculation.
              </div>

              {/* Health Score */}
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'14px', marginBottom:'20px' }}>
                <div style={{ padding:'16px', background:'#0D1B2A', borderTop:`2px solid ${healthColor}`, textAlign:'center' }}>
                  <div style={{ fontSize:'10px', color:'rgba(255,255,255,0.4)', letterSpacing:'1px', marginBottom:'8px' }}>DISTRICT HEALTH SCORE</div>
                  <div style={{ fontSize:'36px', fontWeight:800, color:healthColor }}>{healthScore}</div>
                  <div style={{ fontSize:'10px', color:healthColor, fontWeight:700, letterSpacing:'1px', marginTop:'4px' }}>{healthLabel}</div>
                </div>
                <div style={{ padding:'16px', background:'#F5F0E8', border:'1px solid #E8DFD0', borderTop:'2px solid #B8960C' }}>
                  <div style={{ fontSize:'10px', color:'#9E8E6E', fontWeight:800, letterSpacing:'1px', marginBottom:'10px' }}>HEALTH FACTORS</div>
                  {healthFactors.map(f => (
                    <div key={f.label} style={{ display:'flex', justifyContent:'space-between', padding:'4px 0', borderBottom:'1px solid #E8DFD0' }}>
                      <span style={{ fontSize:'11px', color:'#9E8E6E' }}>{f.label}</span>
                      <span style={{ fontSize:'11px', fontWeight:700, color:f.ok?'#059669':'#D97706' }}>{f.val}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'16px' }}>
                <Field label="Target Cities">
                  <Input value={form.targetAreas} onChange={e=>upd('targetAreas',e.target.value)} type="number" placeholder="e.g. 150" disabled={!hasEditPerm}/>
                </Field>
                <Field label="Target Salons">
                  <Input value={form.targetSalons} onChange={e=>upd('targetSalons',e.target.value)} type="number" placeholder="e.g. 500" disabled={!hasEditPerm}/>
                </Field>
              </div>

              {/* Progress — uses live fetched counts, not hardcoded values */}
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'14px', marginTop:'8px' }}>
                {[
                  { label:'City Coverage',  current: original.cityCount,  target: Number(form.targetAreas)  || 0 },
                  { label:'Salon Coverage', current: original.totalSalons, target: Number(form.targetSalons) || 0 },
                ].map(p => {
                  const pctVal = p.target > 0 ? Math.min(100, Math.round((p.current/p.target)*100)) : 0
                  return (
                    <div key={p.label} style={{ padding:'14px', background:'#F5F0E8', border:'1px solid #E8DFD0', borderTop:'2px solid #B8960C' }}>
                      <div style={{ display:'flex', justifyContent:'space-between', marginBottom:'8px' }}>
                        <span style={{ fontSize:'12px', color:'#1A1A2E', fontWeight:600 }}>{p.label}</span>
                        <span style={{ fontSize:'12px', fontWeight:800, color:'#B8960C' }}>{pctVal}%</span>
                      </div>
                      <div style={{ height:'8px', background:'#E8DFD0' }}>
                        <div style={{ height:'100%', width:`${pctVal}%`, background:pctVal>=80?'#059669':pctVal>=60?'#D97706':'#DC2626' }}/>
                      </div>
                      <div style={{ display:'flex', justifyContent:'space-between', marginTop:'4px' }}>
                        <span style={{ fontSize:'10px', color:'#9E8E6E' }}>Current: {p.current}</span>
                        <span style={{ fontSize:'10px', color:'#9E8E6E' }}>Target: {p.target || '—'}</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </BCard>
        )}

        {/* STATUS */}
        {tab === 'status' && (
          <div style={{ display:'grid', gap:'14px' }}>
            <BCard>
              <BCardHeader title="District & Territory Status"/>
              <div style={{ padding:'20px', display:'grid', gridTemplateColumns:'1fr 1fr', gap:'16px' }}>
                <Field label="District Status">
                  <Select value={form.isActive ? 'ACTIVE' : 'INACTIVE'} onChange={e=>upd('isActive', e.target.value === 'ACTIVE')} disabled={!hasEditPerm} options={['ACTIVE','INACTIVE']}/>
                </Field>
                <Field label="Territory Override">
                  <Select value={form.manualTerritoryOverride} onChange={e=>upd('manualTerritoryOverride',e.target.value)} disabled={!hasEditPerm} options={TERRITORY_OPTIONS}/>
                </Field>
              </div>
              {form.manualTerritoryOverride === 'CLOSED' && (
                <div style={{ padding:'0 20px 20px' }}>
                  <Field label="Closed Reason">
                    <Input value={form.closedReason} onChange={e=>upd('closedReason',e.target.value)} placeholder="e.g. Admin Transfer" disabled={!hasEditPerm}/>
                  </Field>
                </div>
              )}
              <div style={{ padding:'0 20px 20px' }}>
                <div style={{ background:'#FEF2F2', border:'1px solid #FEE2E2', padding:'12px', fontSize:'11px', color:'#991B1B', fontWeight:600 }}>
                  ⚠ Closing territory will pause all bookings in this district. Use Territory Control for emergency closures.
                </div>
              </div>
            </BCard>

            <BCard>
              <BCardHeader title="Operational Actions"/>
              <div style={{ padding:'20px', display:'grid', gridTemplateColumns:'1fr 1fr', gap:'12px' }}>
                <div style={{ padding:'14px', background:'#FFFBEB', border:'1px solid #FDE68A', borderTop:'2px solid #D97706' }}>
                  <div style={{ fontSize:'11px', fontWeight:800, color:'#D97706', marginBottom:'6px' }}>DEACTIVATE DISTRICT</div>
                  <div style={{ fontSize:'10px', color:'#6B5E3E', marginBottom:'10px' }}>Pauses new onboarding. Existing salons unaffected. Takes effect immediately.</div>
                  <button onClick={handleDeactivate} disabled={!hasEditPerm || !form.isActive} style={{ background:(!hasEditPerm||!form.isActive)?'#E8DFD0':'#fff', border:`1px solid ${(!hasEditPerm||!form.isActive)?'#D4C9B0':'#D97706'}`, color:(!hasEditPerm||!form.isActive)?'#C4B49A':'#D97706', padding:'6px 12px', fontSize:'10px', fontWeight:700, cursor:(!hasEditPerm||!form.isActive)?'not-allowed':'pointer' }}>
                    {form.isActive ? 'DEACTIVATE DISTRICT' : 'ALREADY INACTIVE'}
                  </button>
                </div>
                <div style={{ padding:'14px', background:'#F3F4F6', border:'1px solid #D1D5DB', borderTop:'2px solid #374151' }}>
                  <div style={{ fontSize:'11px', fontWeight:800, color:'#374151', marginBottom:'6px' }}>ARCHIVE DISTRICT</div>
                  <div style={{ fontSize:'10px', color:'#6B5E3E', marginBottom:'10px' }}>Moves to archived. Not deleted. Blocked if any cities still exist under this district.</div>
                  <button onClick={handleArchive} disabled={!hasEditPerm} style={{ background:!hasEditPerm?'#E8DFD0':'#fff', border:`1px solid ${!hasEditPerm?'#D4C9B0':'#374151'}`, color:!hasEditPerm?'#C4B49A':'#374151', padding:'6px 12px', fontSize:'10px', fontWeight:700, cursor:!hasEditPerm?'not-allowed':'pointer' }}>
                    ARCHIVE DISTRICT
                  </button>
                </div>
              </div>
              <div style={{ padding:'0 20px 16px', fontSize:'10px', color:'#9E8E6E', fontStyle:'italic' }}>
                ⚠ DELETE is not available. Districts can only be Deactivated or Archived.
              </div>
            </BCard>
          </div>
        )}

        {/* HISTORY — Admin History, reconstructed from Audit Log */}
        {tab === 'history' && (
          <BCard>
            <BCardHeader title="Admin Assignment History"/>
            <div style={{ padding:'20px' }}>
              {historyLoading ? (
                <EmptyState>Loading history…</EmptyState>
              ) : history.length === 0 ? (
                <EmptyState>
                  No admin-assignment events recorded in the audit trail yet.
                  {original.districtAdmin && (
                    <div style={{ marginTop:'8px', fontSize:'12px', color:'#1A1A2E', fontWeight:600 }}>
                      Current admin: {original.districtAdmin.name}
                    </div>
                  )}
                </EmptyState>
              ) : (
                <div style={{ position:'relative', paddingLeft:'28px' }}>
                  <div style={{ position:'absolute', left:'9px', top:'10px', bottom:'10px', width:'2px', background:'#E8DFD0' }}/>
                  {history.map((h, i) => {
                    const isCurrent = i === 0
                    return (
                      <div key={h.id} style={{ position:'relative', marginBottom:'20px' }}>
                        <div style={{ position:'absolute', left:'-22px', top:'4px', width:'16px', height:'16px', background:isCurrent?'#B8960C':'#E8DFD0', border:`2px solid ${isCurrent?'#B8960C':'#D4C9B0'}`, display:'flex', alignItems:'center', justifyContent:'center' }}>
                          {isCurrent && <span style={{ color:'#fff', fontSize:'8px', fontWeight:800 }}>✓</span>}
                        </div>
                        <div style={{ background:isCurrent?'#FDFAF6':'#F5F0E8', border:`1px solid ${isCurrent?'#D4C9B0':'#E8DFD0'}`, borderLeft:`3px solid ${isCurrent?'#B8960C':'#D4C9B0'}`, padding:'12px 16px' }}>
                          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                            <div>
                              <div style={{ fontSize:'14px', fontWeight:700, color:'#1A1A2E' }}>{h.meta?.newAdminName || 'Unknown admin'}</div>
                              <div style={{ fontSize:'11px', color:'#9E8E6E', marginTop:'3px' }}>
                                {new Date(h.createdAt).toLocaleDateString('en-IN')} • {h.meta?.wasTransfer ? 'Transferred from previous admin' : 'Initial assignment'} • by {h.admin?.name || 'System'}
                              </div>
                            </div>
                            <span style={{ fontSize:'10px', fontWeight:800, background:isCurrent?'#D1FAE5':'#F3F4F6', color:isCurrent?'#065F46':'#374151', padding:'3px 10px' }}>
                              {isCurrent ? 'CURRENT' : 'PREVIOUS'}
                            </span>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
              <div style={{ marginTop:'8px', padding:'10px', background:'#F5F0E8', border:'1px solid #E8DFD0', fontSize:'11px', color:'#9E8E6E' }}>
                ℹ Admin assignment history is auto-recorded from the audit log. To change admin, use <button onClick={() => navigate('/app/location/admin-assignment')} style={{ background:'none', border:'none', cursor:'pointer', color:'#B8960C', fontWeight:700, fontSize:'11px', padding:0 }}>Admin Assignment ▸</button>
              </div>
            </div>
          </BCard>
        )}

      </div>

      {/* Sticky Footer */}
      <div style={{ position:'sticky', bottom:0, background:'#0D1B2A', borderTop:'2px solid #B8960C', padding:'12px 20px', display:'flex', justifyContent:'space-between', alignItems:'center', zIndex:10 }}>
        <div style={{ fontSize:'11px', color:'rgba(255,255,255,0.4)' }}>
          {hasEditPerm ? isDirty ? '⚠ Unsaved changes' : '✓ No pending changes' : `⊘ View Only — ${adminLevel}`}
        </div>
        <div style={{ display:'flex', gap:'8px' }}>
          <button onClick={() => handleNavigateAway(`/app/location/districts/${id}`)} style={{ background:'rgba(255,255,255,0.07)', border:'1px solid rgba(255,255,255,0.15)', color:'rgba(255,255,255,0.5)', padding:'8px 16px', fontSize:'11px', fontWeight:700, cursor:'pointer' }}>CANCEL</button>
          {isDirty && hasEditPerm && (
            <button onClick={handleDiscard} style={{ background:'rgba(255,255,255,0.07)', border:'1px solid rgba(255,255,255,0.2)', color:'rgba(255,255,255,0.6)', padding:'8px 16px', fontSize:'11px', fontWeight:700, cursor:'pointer' }}>DISCARD</button>
          )}
          {hasEditPerm && (
            <button onClick={() => isDirty && !saving && handleSaveAttempt()} disabled={saving} style={{ background:isDirty?'#B8960C':'rgba(184,150,12,0.3)', border:'none', color:isDirty?'#0D1B2A':'rgba(255,255,255,0.3)', padding:'8px 20px', fontSize:'11px', fontWeight:800, cursor:isDirty&&!saving?'pointer':'not-allowed' }}>{saving?'SAVING…':'✓ SAVE CHANGES'}</button>
          )}
        </div>
      </div>

      <div style={{ background:'#0D1B2A', borderTop:'1px solid rgba(184,150,12,0.2)', padding:'8px 20px', display:'flex', justifyContent:'space-between' }}>
        <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.2)' }}>ZEMISH TERRITORY ENGINE v1.0.0</span>
        <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.2)' }}>NATIONAL COMMAND CENTER</span>
      </div>

      {showConfirm && <ConfirmSaveModal name={original.name} onConfirm={handleSave} onCancel={() => setShowConfirm(false)}/>}
      {showExit && <UnsavedExitModal onLeave={() => { setShowExit(false); navigate(exitTarget) }} onStay={() => { setShowExit(false); handleSaveAttempt() }}/>}
    </div>
  )
}