import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { FONTS } from '../../../config/brand'
import useAuthStore from '../../../store/authStore'

const STATES_DB = {
  'ST001': {
    id: 'ST001', name: 'Uttar Pradesh', code: 'UP', status: 'ACTIVE', territory: 'OPEN',
    capital: 'Lucknow', region: 'North India', timezone: 'IST (UTC+5:30)',
    totalDistricts: 75, targetAreas: 3000, targetSalons: 5000,
    notes: 'Largest state by population. High priority for expansion.',
    admin: { name: 'Rajesh Kumar', email: 'rajesh.kumar@zemish.in', phone: '9812345678' },
    backupAdmin: { name: 'Amit Verma', email: 'amit.verma@zemish.in', phone: '9823456789' },
  },
  'ST002': {
    id: 'ST002', name: 'Maharashtra', code: 'MH', status: 'ACTIVE', territory: 'OPEN',
    capital: 'Mumbai', region: 'West India', timezone: 'IST (UTC+5:30)',
    totalDistricts: 36, targetAreas: 1800, targetSalons: 4000,
    notes: 'Highest revenue state. Focus on tier-2 cities.',
    admin: { name: 'Priya Desai', email: 'priya.desai@zemish.in', phone: '9834567890' },
    backupAdmin: { name: 'Rohit Shah', email: 'rohit.shah@zemish.in', phone: '9845678901' },
  },
}

const ADMIN_LEVELS = { SUPER_ADMIN:'SUPER_ADMIN', INDIA_ADMIN:'INDIA_ADMIN', STATE_ADMIN:'STATE_ADMIN', DISTRICT_ADMIN:'DISTRICT_ADMIN' }
const canEdit = (l) => [ADMIN_LEVELS.SUPER_ADMIN, ADMIN_LEVELS.INDIA_ADMIN].includes(l)

// ─── Validation ──────────────────────────────────────────
const validate = (form) => {
  const errors = {}
  if (!form.name?.trim())    errors.name    = 'State name is required'
  if (!form.code?.trim())    errors.code    = 'State code is required'
  else if (form.code.length > 3) errors.code = 'Code must be 2-3 characters'
  if (!form.capital?.trim()) errors.capital = 'Capital is required'
  if (!form.region?.trim())  errors.region  = 'Region is required'
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
const Input = ({ value, onChange, placeholder, disabled=false, error=false }) => (
  <input value={value} onChange={onChange} placeholder={placeholder} disabled={disabled}
    style={{ width:'100%', border:`1px solid ${error?'#DC2626':disabled?'#E8DFD0':'#D4C9B0'}`, padding:'8px 12px', fontSize:'13px', fontFamily:FONTS.body, outline:'none', background:disabled?'#F5F0E8':'#fff', color:disabled?'#9E8E6E':'#1A1A2E', boxSizing:'border-box', cursor:disabled?'not-allowed':'text' }}
  />
)
const Select = ({ value, onChange, options, disabled=false }) => (
  <select value={value} onChange={onChange} disabled={disabled}
    style={{ width:'100%', border:`1px solid ${disabled?'#E8DFD0':'#D4C9B0'}`, padding:'8px 12px', fontSize:'13px', fontFamily:FONTS.body, outline:'none', background:disabled?'#F5F0E8':'#fff', color:disabled?'#9E8E6E':'#1A1A2E', cursor:disabled?'not-allowed':'pointer' }}>
    {options.map(o => <option key={o.value||o} value={o.value||o}>{o.label||o}</option>)}
  </select>
)

// ─── Confirm Modals ───────────────────────────────────────
function ConfirmSaveModal({ stateName, onConfirm, onCancel }) {
  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.75)', zIndex:2000, display:'flex', alignItems:'center', justifyContent:'center' }}>
      <div style={{ background:'#fff', width:'420px', border:'2px solid #B8960C' }}>
        <div style={{ background:'#0D1B2A', padding:'14px 18px', borderBottom:'2px solid #B8960C' }}>
          <div style={{ color:'#fff', fontWeight:800, fontSize:'13px', letterSpacing:'1px' }}>✓ CONFIRM SAVE CHANGES</div>
        </div>
        <div style={{ padding:'20px 18px' }}>
          <div style={{ fontSize:'12px', color:'#9E8E6E', padding:'10px', background:'#F5F0E8', border:'1px solid #E8DFD0', marginBottom:'12px' }}>
            <strong>{stateName}</strong> — Save all changes?
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
          <div style={{ fontSize:'13px', color:'#1A1A2E', marginBottom:'16px' }}>You have unsaved changes. Leave without saving?</div>
          <div style={{ display:'flex', gap:'8px', justifyContent:'flex-end' }}>
            <button onClick={onStay} style={{ background:'#B8960C', border:'none', color:'#0D1B2A', padding:'8px 20px', fontSize:'11px', fontWeight:800, cursor:'pointer' }}>STAY & SAVE</button>
            <button onClick={onLeave} style={{ background:'#FEF2F2', border:'1px solid #DC2626', color:'#DC2626', padding:'8px 16px', fontSize:'11px', fontWeight:700, cursor:'pointer' }}>LEAVE</button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────
export default function StateEditPage() {
  const { id }   = useParams()
  const navigate = useNavigate()
  const admin    = useAuthStore(s => s.admin)
  const adminLevel   = admin?.adminLevel || ADMIN_LEVELS.SUPER_ADMIN
  const hasEditPerm  = canEdit(adminLevel)

  const original = STATES_DB[id] || Object.values(STATES_DB)[0]

  const [tab,          setTab]          = useState('basic')
  const [isDirty,      setIsDirty]      = useState(false)
  const [showConfirm,  setShowConfirm]  = useState(false)
  const [showExit,     setShowExit]     = useState(false)
  const [exitTarget,   setExitTarget]   = useState(null)
  const [errors,       setErrors]       = useState({})
  const [toast,        setToast]        = useState(null)

  const [form, setForm] = useState({
    name:           original.name,
    code:           original.code,
    capital:        original.capital,
    region:         original.region,
    timezone:       original.timezone,
    status:         original.status,
    territory:      original.territory,
    totalDistricts: original.totalDistricts,
    targetAreas:    original.targetAreas,
    targetSalons:   original.targetSalons,
    notes:          original.notes,
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
    showToast('✓ State updated successfully', '#059669')
  }

  const handleDiscard = () => {
    setForm({ name:original.name, code:original.code, capital:original.capital, region:original.region, timezone:original.timezone, status:original.status, territory:original.territory, totalDistricts:original.totalDistricts, targetAreas:original.targetAreas, targetSalons:original.targetSalons, notes:original.notes })
    setIsDirty(false); setErrors({})
    showToast('Changes discarded', '#6B5E3E')
  }

  const TABS = ['basic', 'targets', 'status']

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
          <button onClick={() => handleNavigateAway(`/app/location/states/${id}`)} style={{ background:'rgba(255,255,255,0.07)', border:'1px solid rgba(255,255,255,0.1)', color:'rgba(255,255,255,0.6)', padding:'5px 10px', cursor:'pointer', fontSize:'12px', fontWeight:700 }}>← BACK</button>
          <div style={{ width:'3px', height:'16px', background:'#B8960C' }}/>
          <div>
            <div style={{ color:'#fff', fontWeight:800, fontSize:'13px', letterSpacing:'1px' }}>{original.name} ({original.code}) — EDIT</div>
            <div style={{ color:'#B8960C', fontSize:'9px', letterSpacing:'1px', marginTop:'1px' }}>{original.id} • STATE EDIT</div>
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

      {/* Permission Warning */}
      {!hasEditPerm && (
        <div style={{ background:'#FEF2F2', borderBottom:'2px solid #DC2626', padding:'10px 20px' }}>
          <span style={{ fontSize:'12px', color:'#991B1B', fontWeight:700 }}>⚠ Only SUPER_ADMIN and INDIA_ADMIN can edit state records.</span>
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
              <Field label="State Name" required error={errors.name}>
                <Input value={form.name} onChange={e=>upd('name',e.target.value)} placeholder="e.g. Uttar Pradesh" disabled={!hasEditPerm} error={!!errors.name}/>
              </Field>
              <Field label="State Code" required error={errors.code}>
                <Input value={form.code} onChange={e=>upd('code',e.target.value.toUpperCase())} placeholder="e.g. UP" disabled={!hasEditPerm} error={!!errors.code}/>
              </Field>
              <Field label="Capital City" required error={errors.capital}>
                <Input value={form.capital} onChange={e=>upd('capital',e.target.value)} placeholder="e.g. Lucknow" disabled={!hasEditPerm} error={!!errors.capital}/>
              </Field>
              <Field label="Region" required error={errors.region}>
                <Select value={form.region} onChange={e=>upd('region',e.target.value)} disabled={!hasEditPerm}
                  options={['North India','South India','East India','West India','Central India','North East India']}/>
              </Field>
              <Field label="Timezone">
                <Input value={form.timezone} onChange={e=>upd('timezone',e.target.value)} disabled={!hasEditPerm}/>
              </Field>
              <Field label="Total Districts">
                <Input value={form.totalDistricts} onChange={e=>upd('totalDistricts',e.target.value)} type="number" disabled={!hasEditPerm}/>
              </Field>
              <div style={{ gridColumn:'1/-1' }}>
                <Field label="Notes / Remarks">
                  <textarea value={form.notes} onChange={e=>upd('notes',e.target.value)} disabled={!hasEditPerm}
                    style={{ width:'100%', border:`1px solid ${!hasEditPerm?'#E8DFD0':'#D4C9B0'}`, padding:'8px 12px', fontSize:'13px', fontFamily:FONTS.body, outline:'none', background:!hasEditPerm?'#F5F0E8':'#fff', minHeight:'80px', resize:'vertical', boxSizing:'border-box' }}
                  />
                </Field>
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
                ℹ These targets are used for coverage % calculation and territory health score.
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'16px' }}>
                <Field label="Target Areas">
                  <Input value={form.targetAreas} onChange={e=>upd('targetAreas',e.target.value)} type="number" placeholder="e.g. 3000" disabled={!hasEditPerm}/>
                </Field>
                <Field label="Target Salons">
                  <Input value={form.targetSalons} onChange={e=>upd('targetSalons',e.target.value)} type="number" placeholder="e.g. 5000" disabled={!hasEditPerm}/>
                </Field>
              </div>
              {/* Progress bars */}
              <div style={{ marginTop:'16px', display:'grid', gridTemplateColumns:'1fr 1fr', gap:'16px' }}>
                {[
                  { label:'Area Coverage', current:2840, target:form.targetAreas },
                  { label:'Salon Coverage', current:4250, target:form.targetSalons },
                ].map(p => {
                  const pct = Math.min(100, Math.round((p.current/p.target)*100))
                  return (
                    <div key={p.label} style={{ padding:'14px', background:'#F5F0E8', border:'1px solid #E8DFD0', borderTop:'2px solid #B8960C' }}>
                      <div style={{ display:'flex', justifyContent:'space-between', marginBottom:'8px' }}>
                        <span style={{ fontSize:'12px', color:'#1A1A2E', fontWeight:600 }}>{p.label}</span>
                        <span style={{ fontSize:'12px', fontWeight:800, color:'#B8960C' }}>{pct}%</span>
                      </div>
                      <div style={{ height:'8px', background:'#E8DFD0' }}>
                        <div style={{ height:'100%', width:`${pct}%`, background:pct>=80?'#059669':pct>=60?'#D97706':'#DC2626' }}/>
                      </div>
                      <div style={{ display:'flex', justifyContent:'space-between', marginTop:'4px' }}>
                        <span style={{ fontSize:'10px', color:'#9E8E6E' }}>Current: {p.current.toLocaleString('en-IN')}</span>
                        <span style={{ fontSize:'10px', color:'#9E8E6E' }}>Target: {Number(p.target).toLocaleString('en-IN')}</span>
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
              <BCardHeader title="State & Territory Status"/>
              <div style={{ padding:'20px', display:'grid', gridTemplateColumns:'1fr 1fr', gap:'16px' }}>
                <Field label="State Status">
                  <Select value={form.status} onChange={e=>upd('status',e.target.value)} disabled={!hasEditPerm}
                    options={['ACTIVE','INACTIVE']}/>
                </Field>
                <Field label="Territory Status">
                  <Select value={form.territory} onChange={e=>upd('territory',e.target.value)} disabled={!hasEditPerm}
                    options={['OPEN','PARTIAL','CLOSED']}/>
                </Field>
              </div>
              <div style={{ padding:'0 20px 20px' }}>
                <div style={{ background:'#FEF2F2', border:'1px solid #FEE2E2', padding:'12px', fontSize:'11px', color:'#991B1B', fontWeight:600 }}>
                  ⚠ Closing territory will pause all bookings in this state. Use Territory Control for emergency closures.
                </div>
              </div>
            </BCard>

            {/* Deactivate / Archive — no delete */}
            <BCard>
              <BCardHeader title="Operational Actions"/>
              <div style={{ padding:'20px', display:'grid', gridTemplateColumns:'1fr 1fr', gap:'12px' }}>
                {[
                  { label:'DEACTIVATE STATE',  desc:'Pauses new onboarding. Existing salons unaffected.', color:'#D97706', bg:'#FFFBEB', border:'#FDE68A', disabled:!hasEditPerm },
                  { label:'ARCHIVE STATE',      desc:'Moves to archived. Not deleted. Can be restored.', color:'#374151', bg:'#F3F4F6', border:'#D1D5DB', disabled:!hasEditPerm },
                ].map(a => (
                  <div key={a.label} style={{ padding:'14px', background:a.bg, border:`1px solid ${a.border}`, borderTop:`2px solid ${a.color}` }}>
                    <div style={{ fontSize:'11px', fontWeight:800, color:a.color, letterSpacing:'0.5px', marginBottom:'6px' }}>{a.label}</div>
                    <div style={{ fontSize:'10px', color:'#6B5E3E', marginBottom:'10px' }}>{a.desc}</div>
                    <button disabled={a.disabled} style={{ background:a.disabled?'#E8DFD0':'#fff', border:`1px solid ${a.disabled?'#D4C9B0':a.color}`, color:a.disabled?'#C4B49A':a.color, padding:'6px 12px', fontSize:'10px', fontWeight:700, cursor:a.disabled?'not-allowed':'pointer', letterSpacing:'0.5px' }}>
                      {a.label}
                    </button>
                  </div>
                ))}
              </div>
              <div style={{ padding:'0 20px 16px', fontSize:'10px', color:'#9E8E6E', fontStyle:'italic' }}>
                ⚠ DELETE is not available. States can only be Deactivated or Archived for audit safety.
              </div>
            </BCard>
          </div>
        )}

      </div>

      {/* Sticky Footer */}
      <div style={{ position:'sticky', bottom:0, background:'#0D1B2A', borderTop:'2px solid #B8960C', padding:'12px 20px', display:'flex', justifyContent:'space-between', alignItems:'center', zIndex:10 }}>
        <div style={{ fontSize:'11px', color:'rgba(255,255,255,0.4)' }}>
          {hasEditPerm ? isDirty ? '⚠ Unsaved changes' : '✓ No pending changes' : `⊘ View Only — ${adminLevel}`}
        </div>
        <div style={{ display:'flex', gap:'8px' }}>
          <button onClick={() => handleNavigateAway(`/app/location/states/${id}`)} style={{ background:'rgba(255,255,255,0.07)', border:'1px solid rgba(255,255,255,0.15)', color:'rgba(255,255,255,0.5)', padding:'8px 16px', fontSize:'11px', fontWeight:700, cursor:'pointer' }}>CANCEL</button>
          {isDirty && hasEditPerm && (
            <button onClick={handleDiscard} style={{ background:'rgba(255,255,255,0.07)', border:'1px solid rgba(255,255,255,0.2)', color:'rgba(255,255,255,0.6)', padding:'8px 16px', fontSize:'11px', fontWeight:700, cursor:'pointer' }}>DISCARD</button>
          )}
          {hasEditPerm && (
            <button onClick={() => isDirty && handleSaveAttempt()} style={{ background:isDirty?'#B8960C':'rgba(184,150,12,0.3)', border:'none', color:isDirty?'#0D1B2A':'rgba(255,255,255,0.3)', padding:'8px 20px', fontSize:'11px', fontWeight:800, cursor:isDirty?'pointer':'not-allowed', letterSpacing:'0.5px' }}>✓ SAVE CHANGES</button>
          )}
        </div>
      </div>

      <div style={{ background:'#0D1B2A', borderTop:'1px solid rgba(184,150,12,0.2)', padding:'8px 20px', display:'flex', justifyContent:'space-between' }}>
        <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.2)' }}>ZEMISH TERRITORY ENGINE v1.0.0</span>
        <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.2)' }}>NATIONAL COMMAND CENTER</span>
      </div>

      {showConfirm && <ConfirmSaveModal stateName={original.name} onConfirm={handleSave} onCancel={() => setShowConfirm(false)}/>}
      {showExit && <UnsavedExitModal onLeave={() => { setShowExit(false); navigate(exitTarget) }} onStay={() => { setShowExit(false); handleSaveAttempt() }}/>}
    </div>
  )
}