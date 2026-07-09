import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { FONTS } from '../../../config/brand'
import useAuthStore from '../../../store/authStore'

const AREAS_DB = {
  'AR001': {
    id: 'AR001', name: 'Hazratganj', district: 'Lucknow', districtId: 'DT001',
    state: 'Uttar Pradesh', stateCode: 'UP',
    status: 'ACTIVE', territory: 'OPEN',
    description: 'Prime commercial area in Lucknow city center.',
    targetSalons: 50, currentSalons: 42,
    pincodes: ['226001', '226002', '226003'],
    createdAt: '2024-03-01', updatedAt: '2026-06-20',
    adminHistory: [
      { name: 'Rohit Verma', from: '2024-03-15', to: 'Present',    status: 'CURRENT'  },
      { name: 'Sunil Gupta', from: '2024-03-01', to: '2024-03-14', status: 'PREVIOUS' },
    ],
  },
  'AR002': {
    id: 'AR002', name: 'Gomti Nagar', district: 'Lucknow', districtId: 'DT001',
    state: 'Uttar Pradesh', stateCode: 'UP',
    status: 'ACTIVE', territory: 'OPEN',
    description: 'Residential and commercial mix area.',
    targetSalons: 45, currentSalons: 38,
    pincodes: ['226010', '226011'],
    createdAt: '2024-03-01', updatedAt: '2026-06-18',
    adminHistory: [
      { name: 'Priya Singh', from: '2024-03-01', to: 'Present', status: 'CURRENT' },
    ],
  },
  'AR010': {
    id: 'AR010', name: 'Andheri', district: 'Mumbai', districtId: 'DT009',
    state: 'Maharashtra', stateCode: 'MH',
    status: 'ACTIVE', territory: 'OPEN',
    description: 'High density commercial area in Mumbai suburbs.',
    targetSalons: 100, currentSalons: 92,
    pincodes: ['400053', '400058', '400059', '400069'],
    createdAt: '2024-02-01', updatedAt: '2026-06-22',
    adminHistory: [
      { name: 'Kavita Sharma', from: '2024-02-15', to: 'Present',    status: 'CURRENT'  },
      { name: 'Raj Mehta',     from: '2024-02-01', to: '2024-02-14', status: 'PREVIOUS' },
    ],
  },
}

const ADMIN_LEVELS = { SUPER_ADMIN:'SUPER_ADMIN', INDIA_ADMIN:'INDIA_ADMIN', STATE_ADMIN:'STATE_ADMIN', DISTRICT_ADMIN:'DISTRICT_ADMIN' }
const canEdit = (l) => [ADMIN_LEVELS.SUPER_ADMIN, ADMIN_LEVELS.INDIA_ADMIN].includes(l)

const validate = (form) => {
  const errors = {}
  if (!form.name?.trim())     errors.name     = 'Area name is required'
  if (!form.district?.trim()) errors.district = 'District is required'
  if (!form.state?.trim())    errors.state    = 'State is required'
  if (form.pincodes.some(p => !/^\d{6}$/.test(p.trim()))) errors.pincodes = 'All pincodes must be 6 digits'
  if (Number(form.targetSalons) < 0) errors.targetSalons = 'Target cannot be negative'
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
  <input type={type} value={value} onChange={onChange} placeholder={placeholder} disabled={disabled}
    style={{ width:'100%', border:`1px solid ${error?'#DC2626':disabled?'#E8DFD0':'#D4C9B0'}`, padding:'8px 12px', fontSize:'13px', fontFamily:FONTS.body, outline:'none', background:disabled?'#F5F0E8':'#fff', color:disabled?'#9E8E6E':'#1A1A2E', boxSizing:'border-box', cursor:disabled?'not-allowed':'text' }}
  />
)
const Select = ({ value, onChange, options, disabled=false }) => (
  <select value={value} onChange={onChange} disabled={disabled}
    style={{ width:'100%', border:`1px solid ${disabled?'#E8DFD0':'#D4C9B0'}`, padding:'8px 12px', fontSize:'13px', fontFamily:FONTS.body, outline:'none', background:disabled?'#F5F0E8':'#fff', color:disabled?'#9E8E6E':'#1A1A2E', cursor:disabled?'not-allowed':'pointer' }}>
    {options.map(o => <option key={o.value||o} value={o.value||o}>{o.label||o}</option>)}
  </select>
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
            <button onClick={onStay}  style={{ background:'#B8960C', border:'none', color:'#0D1B2A', padding:'8px 20px', fontSize:'11px', fontWeight:800, cursor:'pointer' }}>STAY & SAVE</button>
            <button onClick={onLeave} style={{ background:'#FEF2F2', border:'1px solid #DC2626', color:'#DC2626', padding:'8px 16px', fontSize:'11px', fontWeight:700, cursor:'pointer' }}>LEAVE</button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function AreaEditPage() {
  const { id }   = useParams()
  const navigate = useNavigate()
  const admin    = useAuthStore(s => s.admin)
  const adminLevel   = admin?.adminLevel || ADMIN_LEVELS.SUPER_ADMIN
  const hasEditPerm  = canEdit(adminLevel)

  const original = AREAS_DB[id] || Object.values(AREAS_DB)[0]

  const [tab,         setTab]         = useState('basic')
  const [isDirty,     setIsDirty]     = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [showExit,    setShowExit]    = useState(false)
  const [exitTarget,  setExitTarget]  = useState(null)
  const [errors,      setErrors]      = useState({})
  const [toast,       setToast]       = useState(null)

  const [form, setForm] = useState({
    name:         original.name,
    district:     original.district,
    state:        original.state,
    stateCode:    original.stateCode,
    description:  original.description,
    status:       original.status,
    territory:    original.territory,
    targetSalons: original.targetSalons,
    pincodes:     [...original.pincodes],
  })

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

  const handleSave = () => {
    setShowConfirm(false); setIsDirty(false); setErrors({})
    showToast('✓ Area updated successfully', '#059669')
  }

  const handleDiscard = () => {
    setForm({ name:original.name, district:original.district, state:original.state, stateCode:original.stateCode, description:original.description, status:original.status, territory:original.territory, targetSalons:original.targetSalons, pincodes:[...original.pincodes] })
    setIsDirty(false); setErrors({})
    showToast('Changes discarded', '#6B5E3E')
  }

  // Pincode handlers
  const addPincode    = () => { upd('pincodes', [...form.pincodes, '']); }
  const updatePincode = (i, val) => { const p=[...form.pincodes]; p[i]=val; upd('pincodes', p) }
  const removePincode = (i) => { if(form.pincodes.length > 1) { const p=[...form.pincodes]; p.splice(i,1); upd('pincodes', p) } }

  const coverage  = Math.min(100, Math.round((original.currentSalons / form.targetSalons) * 100))
  const TABS      = ['basic', 'pincodes', 'targets', 'status', 'history']

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
          <button onClick={() => handleNavigateAway(`/app/location/areas/${id}`)} style={{ background:'rgba(255,255,255,0.07)', border:'1px solid rgba(255,255,255,0.1)', color:'rgba(255,255,255,0.6)', padding:'5px 10px', cursor:'pointer', fontSize:'12px', fontWeight:700 }}>← BACK</button>
          <div style={{ width:'3px', height:'16px', background:'#B8960C' }}/>
          <div>
            <div style={{ color:'#fff', fontWeight:800, fontSize:'13px', letterSpacing:'1px' }}>{original.name}, {original.stateCode} — EDIT</div>
            <div style={{ color:'#B8960C', fontSize:'9px', letterSpacing:'1px', marginTop:'1px' }}>{original.id} • {original.district} • AREA EDIT</div>
          </div>
          {isDirty && <span style={{ background:'#D97706', color:'#fff', fontSize:'9px', fontWeight:800, padding:'2px 8px' }}>UNSAVED CHANGES</span>}
        </div>
        <div style={{ display:'flex', gap:'8px' }}>
          {isDirty && <button onClick={handleDiscard} style={{ background:'rgba(255,255,255,0.07)', border:'1px solid rgba(255,255,255,0.15)', color:'rgba(255,255,255,0.5)', padding:'6px 12px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>DISCARD</button>}
          {hasEditPerm
            ? <button onClick={() => isDirty && handleSaveAttempt()} style={{ background:isDirty?'#B8960C':'rgba(184,150,12,0.3)', border:'none', color:isDirty?'#0D1B2A':'rgba(255,255,255,0.3)', padding:'6px 16px', fontSize:'10px', fontWeight:800, cursor:isDirty?'pointer':'not-allowed' }}>✓ SAVE CHANGES</button>
            : <div style={{ background:'rgba(220,38,38,0.15)', border:'1px solid rgba(220,38,38,0.3)', color:'#FCA5A5', padding:'6px 12px', fontSize:'10px', fontWeight:700 }}>VIEW ONLY — {adminLevel}</div>
          }
        </div>
      </div>

      {!hasEditPerm && (
        <div style={{ background:'#FEF2F2', borderBottom:'2px solid #DC2626', padding:'10px 20px' }}>
          <span style={{ fontSize:'12px', color:'#991B1B', fontWeight:700 }}>⚠ Only SUPER_ADMIN and INDIA_ADMIN can edit area records. STATE_ADMIN and DISTRICT_ADMIN have view-only access.</span>
        </div>
      )}

      {/* Tabs */}
      <div style={{ background:'#0A1520', borderBottom:'1px solid rgba(184,150,12,0.2)', display:'flex', padding:'0 20px' }}>
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)} style={{ padding:'10px 18px', border:'none', background:'none', cursor:'pointer', fontSize:'10px', fontWeight:tab===t?800:400, color:tab===t?'#B8960C':'rgba(255,255,255,0.35)', borderBottom:tab===t?'2px solid #B8960C':'2px solid transparent', letterSpacing:'1.5px', textTransform:'uppercase' }}>
            {t}
            {t==='pincodes' && <span style={{ marginLeft:'5px', background:'rgba(184,150,12,0.3)', color:'#B8960C', fontSize:'9px', padding:'1px 5px' }}>{form.pincodes.length}</span>}
            {errors[t] && <span style={{ marginLeft:'5px', background:'#DC2626', color:'#fff', fontSize:'9px', padding:'1px 5px' }}>!</span>}
          </button>
        ))}
      </div>

      <div style={{ padding:'16px 20px', maxWidth:'860px' }}>

        {/* BASIC */}
        {tab === 'basic' && (
          <BCard>
            <BCardHeader title="Basic Information"/>
            <div style={{ padding:'20px', display:'grid', gridTemplateColumns:'1fr 1fr', gap:'16px' }}>
              <Field label="Area Name" required error={errors.name}>
                <Input value={form.name} onChange={e=>upd('name',e.target.value)} placeholder="e.g. Hazratganj" disabled={!hasEditPerm} error={!!errors.name}/>
              </Field>
              <Field label="District" required error={errors.district}>
                <Input value={form.district} onChange={e=>upd('district',e.target.value)} placeholder="e.g. Lucknow" disabled={!hasEditPerm} error={!!errors.district}/>
              </Field>
              <Field label="State" required error={errors.state}>
                <Input value={form.state} onChange={e=>upd('state',e.target.value)} placeholder="e.g. Uttar Pradesh" disabled={!hasEditPerm} error={!!errors.state}/>
              </Field>
              <Field label="State Code">
                <Input value={form.stateCode} onChange={e=>upd('stateCode',e.target.value.toUpperCase())} placeholder="e.g. UP" disabled={!hasEditPerm}/>
              </Field>
              <div style={{ gridColumn:'1/-1' }}>
                <Field label="Description / Notes">
                  <textarea value={form.description} onChange={e=>upd('description',e.target.value)} disabled={!hasEditPerm}
                    style={{ width:'100%', border:`1px solid ${!hasEditPerm?'#E8DFD0':'#D4C9B0'}`, padding:'8px 12px', fontSize:'13px', fontFamily:FONTS.body, outline:'none', background:!hasEditPerm?'#F5F0E8':'#fff', minHeight:'80px', resize:'vertical', boxSizing:'border-box' }}
                  />
                </Field>
              </div>
            </div>
          </BCard>
        )}

        {/* PINCODES */}
        {tab === 'pincodes' && (
          <BCard>
            <BCardHeader title={`Pincodes (${form.pincodes.length})`} action={
              hasEditPerm && (
                <button onClick={addPincode} style={{ background:'#B8960C', color:'#0D1B2A', border:'none', padding:'4px 12px', fontSize:'10px', fontWeight:800, cursor:'pointer' }}>+ ADD PINCODE</button>
              )
            }/>
            <div style={{ padding:'20px' }}>
              {errors.pincodes && (
                <div style={{ background:'#FEF2F2', border:'1px solid #FEE2E2', padding:'10px', marginBottom:'14px', fontSize:'11px', color:'#DC2626', fontWeight:600 }}>
                  ⚠ {errors.pincodes}
                </div>
              )}
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:'10px' }}>
                {form.pincodes.map((p, i) => (
                  <div key={i} style={{ display:'flex', gap:'6px', alignItems:'center' }}>
                    <div style={{ flex:1 }}>
                      <input
                        value={p}
                        onChange={e => updatePincode(i, e.target.value)}
                        placeholder="6-digit pincode"
                        maxLength={6}
                        disabled={!hasEditPerm}
                        style={{ width:'100%', border:`1px solid ${p && !/^\d{6}$/.test(p)?'#DC2626':'#D4C9B0'}`, padding:'8px 12px', fontSize:'13px', fontFamily:'monospace', outline:'none', background:!hasEditPerm?'#F5F0E8':'#fff', boxSizing:'border-box' }}
                      />
                      {p && !/^\d{6}$/.test(p) && <div style={{ fontSize:'9px', color:'#DC2626', marginTop:'2px' }}>Must be 6 digits</div>}
                    </div>
                    {hasEditPerm && form.pincodes.length > 1 && (
                      <button onClick={() => removePincode(i)} style={{ background:'#FEF2F2', border:'1px solid #DC2626', color:'#DC2626', padding:'6px 8px', fontSize:'12px', fontWeight:700, cursor:'pointer', flexShrink:0 }}>✕</button>
                    )}
                  </div>
                ))}
              </div>
              <div style={{ marginTop:'14px', padding:'10px', background:'#F5F0E8', border:'1px solid #E8DFD0', fontSize:'11px', color:'#9E8E6E' }}>
                ℹ Each pincode maps to a specific area. Salons are assigned via pincode during registration.
              </div>
            </div>
          </BCard>
        )}

        {/* TARGETS */}
        {tab === 'targets' && (
          <BCard>
            <BCardHeader title="Salon Coverage Targets"/>
            <div style={{ padding:'20px' }}>
              <div style={{ background:'#FFFBEB', border:'1px solid #FDE68A', padding:'12px', marginBottom:'20px', fontSize:'11px', color:'#92400E', fontWeight:600 }}>
                ℹ Target is used for area coverage % and health score calculation.
              </div>

              {/* Coverage Card */}
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'14px', marginBottom:'20px' }}>
                <div style={{ padding:'16px', background:'#0D1B2A', borderTop:'2px solid #B8960C', textAlign:'center' }}>
                  <div style={{ fontSize:'10px', color:'rgba(255,255,255,0.4)', letterSpacing:'1px', marginBottom:'8px' }}>CURRENT COVERAGE</div>
                  <div style={{ fontSize:'36px', fontWeight:800, color:coverage>=80?'#059669':coverage>=60?'#D97706':'#DC2626' }}>{coverage}%</div>
                  <div style={{ fontSize:'10px', color:'rgba(255,255,255,0.3)', marginTop:'4px' }}>{original.currentSalons} of {form.targetSalons} salons</div>
                </div>
                <div style={{ padding:'16px', background:'#F5F0E8', border:'1px solid #E8DFD0', borderTop:'2px solid #B8960C' }}>
                  <div style={{ fontSize:'10px', color:'#9E8E6E', fontWeight:800, letterSpacing:'1px', marginBottom:'10px' }}>COVERAGE HEALTH</div>
                  <div style={{ height:'10px', background:'#E8DFD0', marginBottom:'8px' }}>
                    <div style={{ height:'100%', width:`${coverage}%`, background:coverage>=80?'#059669':coverage>=60?'#D97706':'#DC2626' }}/>
                  </div>
                  <div style={{ fontSize:'12px', fontWeight:700, color:coverage>=80?'#059669':coverage>=60?'#D97706':'#DC2626' }}>
                    {coverage>=80?'✓ EXCELLENT':coverage>=60?'⚠ GOOD':'⚠ LOW — Needs Attention'}
                  </div>
                  {coverage < 50 && <div style={{ fontSize:'10px', color:'#DC2626', fontWeight:700, marginTop:'4px' }}>⚠ LOW COVERAGE AREA</div>}
                </div>
              </div>

              <Field label="Target Salons" error={errors.targetSalons}>
                <Input
                  value={form.targetSalons}
                  onChange={e => upd('targetSalons', Math.max(0, Number(e.target.value)))}
                  type="number"
                  placeholder="e.g. 50"
                  disabled={!hasEditPerm}
                  error={!!errors.targetSalons}
                />
              </Field>
            </div>
          </BCard>
        )}

        {/* STATUS */}
        {tab === 'status' && (
          <div style={{ display:'grid', gap:'14px' }}>
            <BCard>
              <BCardHeader title="Area & Territory Status"/>
              <div style={{ padding:'20px', display:'grid', gridTemplateColumns:'1fr 1fr', gap:'16px' }}>
                <Field label="Area Status">
                  <Select value={form.status} onChange={e=>upd('status',e.target.value)} disabled={!hasEditPerm} options={['ACTIVE','INACTIVE']}/>
                </Field>
                <Field label="Territory Status">
                  <Select value={form.territory} onChange={e=>upd('territory',e.target.value)} disabled={!hasEditPerm} options={['OPEN','PARTIAL','CLOSED']}/>
                </Field>
              </div>
              <div style={{ padding:'0 20px 20px' }}>
                <div style={{ background:'#FEF2F2', border:'1px solid #FEE2E2', padding:'12px', fontSize:'11px', color:'#991B1B', fontWeight:600 }}>
                  ⚠ Closing territory will pause all salon bookings in this area. Use Territory Control for emergency closures.
                </div>
              </div>
            </BCard>

            <BCard>
              <BCardHeader title="Operational Actions"/>
              <div style={{ padding:'20px', display:'grid', gridTemplateColumns:'1fr 1fr', gap:'12px' }}>
                {[
                  { label:'DEACTIVATE AREA', desc:'Pauses new salon onboarding. Existing salons unaffected.', color:'#D97706', bg:'#FFFBEB', border:'#FDE68A' },
                  { label:'ARCHIVE AREA',    desc:'Moves to archived. Not deleted. Can be restored.',        color:'#374151', bg:'#F3F4F6', border:'#D1D5DB' },
                ].map(a => (
                  <div key={a.label} style={{ padding:'14px', background:a.bg, border:`1px solid ${a.border}`, borderTop:`2px solid ${a.color}` }}>
                    <div style={{ fontSize:'11px', fontWeight:800, color:a.color, marginBottom:'6px' }}>{a.label}</div>
                    <div style={{ fontSize:'10px', color:'#6B5E3E', marginBottom:'10px' }}>{a.desc}</div>
                    <button disabled={!hasEditPerm} style={{ background:!hasEditPerm?'#E8DFD0':'#fff', border:`1px solid ${!hasEditPerm?'#D4C9B0':a.color}`, color:!hasEditPerm?'#C4B49A':a.color, padding:'6px 12px', fontSize:'10px', fontWeight:700, cursor:!hasEditPerm?'not-allowed':'pointer' }}>
                      {a.label}
                    </button>
                  </div>
                ))}
              </div>
              <div style={{ padding:'0 20px 16px', fontSize:'10px', color:'#9E8E6E', fontStyle:'italic' }}>
                ⚠ DELETE is not available. Areas can only be Deactivated or Archived.
              </div>
            </BCard>
          </div>
        )}

        {/* HISTORY */}
        {tab === 'history' && (
          <BCard>
            <BCardHeader title="Area Manager Assignment History"/>
            <div style={{ padding:'20px' }}>
              <div style={{ position:'relative', paddingLeft:'28px' }}>
                <div style={{ position:'absolute', left:'9px', top:'10px', bottom:'10px', width:'2px', background:'#E8DFD0' }}/>
                {original.adminHistory.map((h, i) => (
                  <div key={i} style={{ position:'relative', marginBottom:'16px' }}>
                    <div style={{ position:'absolute', left:'-22px', top:'4px', width:'16px', height:'16px', background:h.status==='CURRENT'?'#B8960C':'#E8DFD0', border:`2px solid ${h.status==='CURRENT'?'#B8960C':'#D4C9B0'}`, display:'flex', alignItems:'center', justifyContent:'center' }}>
                      {h.status==='CURRENT' && <span style={{ color:'#fff', fontSize:'8px', fontWeight:800 }}>✓</span>}
                    </div>
                    <div style={{ background:h.status==='CURRENT'?'#FDFAF6':'#F5F0E8', border:`1px solid ${h.status==='CURRENT'?'#D4C9B0':'#E8DFD0'}`, borderLeft:`3px solid ${h.status==='CURRENT'?'#B8960C':'#D4C9B0'}`, padding:'12px 16px' }}>
                      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                        <div>
                          <div style={{ fontSize:'14px', fontWeight:700, color:'#1A1A2E' }}>{h.name}</div>
                          <div style={{ fontSize:'11px', color:'#9E8E6E', marginTop:'3px' }}>{h.from} → {h.to}</div>
                        </div>
                        <span style={{ fontSize:'10px', fontWeight:800, background:h.status==='CURRENT'?'#D1FAE5':'#F3F4F6', color:h.status==='CURRENT'?'#065F46':'#374151', padding:'3px 10px' }}>
                          {h.status}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ marginTop:'8px', padding:'10px', background:'#F5F0E8', border:'1px solid #E8DFD0', fontSize:'11px', color:'#9E8E6E' }}>
                ℹ Manager history auto-recorded. To change:
                <button onClick={() => navigate('/app/location/admin-assignment')} style={{ background:'none', border:'none', cursor:'pointer', color:'#B8960C', fontWeight:700, fontSize:'11px', padding:'0 4px' }}>
                  Admin Assignment ▸
                </button>
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
          <button onClick={() => handleNavigateAway(`/app/location/areas/${id}`)} style={{ background:'rgba(255,255,255,0.07)', border:'1px solid rgba(255,255,255,0.15)', color:'rgba(255,255,255,0.5)', padding:'8px 16px', fontSize:'11px', fontWeight:700, cursor:'pointer' }}>CANCEL</button>
          {isDirty && hasEditPerm && (
            <button onClick={handleDiscard} style={{ background:'rgba(255,255,255,0.07)', border:'1px solid rgba(255,255,255,0.2)', color:'rgba(255,255,255,0.6)', padding:'8px 16px', fontSize:'11px', fontWeight:700, cursor:'pointer' }}>DISCARD</button>
          )}
          {hasEditPerm && (
            <button onClick={() => isDirty && handleSaveAttempt()} style={{ background:isDirty?'#B8960C':'rgba(184,150,12,0.3)', border:'none', color:isDirty?'#0D1B2A':'rgba(255,255,255,0.3)', padding:'8px 20px', fontSize:'11px', fontWeight:800, cursor:isDirty?'pointer':'not-allowed' }}>✓ SAVE CHANGES</button>
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