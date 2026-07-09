import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { FONTS } from '../../config/brand'
import useAuthStore from '../../store/authStore'
import SalonsAPI from './api/salons.api'

const DAYS = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday']

// ─── Validation ──────────────────────────────────────────
const validateBasic = (b) => {
  const e = {}
  if (!b.shopName?.trim()) e.shopName = 'Salon name is required'
  if (!b.category)         e.category = 'Category is required'
  if (!b.tier)             e.tier     = 'Tier is required'
  return e
}
const validateTimings = (timings) => {
  const e = {}
  if (!timings) return e
  DAYS.forEach(day => {
    const t = timings[day]
    if (t && !t.isClosed && t.open >= t.close) e[day] = 'Close time must be after open time'
  })
  return e
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
const Sel = ({ value, onChange, options, disabled=false }) => (
  <select value={value ?? ''} onChange={onChange} disabled={disabled}
    style={{ width:'100%', border:`1px solid ${disabled?'#E8DFD0':'#D4C9B0'}`, padding:'8px 12px', fontSize:'13px', fontFamily:FONTS.body, outline:'none', background:disabled?'#F5F0E8':'#fff', color:disabled?'#9E8E6E':'#1A1A2E', cursor:disabled?'not-allowed':'pointer' }}>
    {options.map(o => <option key={o.value??o} value={o.value??o}>{o.label??o}</option>)}
  </select>
)
const Toggle = ({ label, checked, onChange, disabled=false }) => (
  <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'10px 0', borderBottom:'1px solid #F0EAE0' }}>
    <span style={{ fontSize:'12px', color:disabled?'#C4B49A':'#1A1A2E' }}>{label}</span>
    <button onClick={() => !disabled && onChange(!checked)}
      style={{ width:'44px', height:'24px', background:checked?'#B8960C':'#E8DFD0', border:'none', cursor:disabled?'not-allowed':'pointer', position:'relative', transition:'background 0.2s', opacity:disabled?0.5:1 }}>
      <div style={{ position:'absolute', top:'3px', left:checked?'23px':'3px', width:'18px', height:'18px', background:'#fff', transition:'left 0.2s' }}/>
    </button>
  </div>
)

// ─── Modals ───────────────────────────────────────────────
function ConfirmSaveModal({ onConfirm, onCancel, saving }) {
  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.75)', zIndex:2000, display:'flex', alignItems:'center', justifyContent:'center' }}>
      <div style={{ background:'#fff', width:'400px', border:'2px solid #B8960C' }}>
        <div style={{ background:'#0D1B2A', padding:'14px 18px', borderBottom:'2px solid #B8960C' }}>
          <div style={{ color:'#fff', fontWeight:800, fontSize:'13px', letterSpacing:'1px' }}>✓ CONFIRM SAVE CHANGES</div>
        </div>
        <div style={{ padding:'20px 18px' }}>
          <div style={{ fontSize:'13px', color:'#1A1A2E', marginBottom:'12px' }}>Save all changes to this salon profile?</div>
          <div style={{ background:'#FFFBEB', border:'1px solid #FDE68A', padding:'10px', marginBottom:'16px', fontSize:'11px', color:'#92400E', fontWeight:600 }}>
            ⚠ Changes will be permanently logged in audit trail.
          </div>
          <div style={{ display:'flex', gap:'8px', justifyContent:'flex-end' }}>
            <button onClick={onCancel} disabled={saving} style={{ background:'#fff', border:'1px solid #D4C9B0', color:'#6B5E3E', padding:'8px 16px', fontSize:'11px', fontWeight:700, cursor:'pointer' }}>CANCEL</button>
            <button onClick={onConfirm} disabled={saving} style={{ background:'#B8960C', border:'none', color:'#0D1B2A', padding:'8px 20px', fontSize:'11px', fontWeight:800, cursor:'pointer' }}>
              {saving ? 'SAVING...' : '✓ YES, SAVE'}
            </button>
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
          <div style={{ fontSize:'13px', color:'#1A1A2E', marginBottom:'16px' }}>You have unsaved changes. Are you sure you want to leave?</div>
          <div style={{ display:'flex', gap:'8px', justifyContent:'flex-end' }}>
            <button onClick={onStay}  style={{ background:'#B8960C', border:'none', color:'#0D1B2A', padding:'8px 20px', fontSize:'11px', fontWeight:800, cursor:'pointer' }}>STAY & SAVE</button>
            <button onClick={onLeave} style={{ background:'#FEF2F2', border:'1px solid #DC2626', color:'#DC2626', padding:'8px 16px', fontSize:'11px', fontWeight:700, cursor:'pointer' }}>LEAVE WITHOUT SAVING</button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────
export default function SalonEditPage() {
  const { id }   = useParams()
  const navigate = useNavigate()
  const admin    = useAuthStore(s => s.admin)

  const isIndia  = admin?.adminLevel === 'INDIA'
  const canEdit  = ['INDIA','STATE'].includes(admin?.adminLevel)

  // ── State ──
  const [salon,         setSalon]         = useState(null)
  const [loading,       setLoading]       = useState(true)
  const [saving,        setSaving]        = useState(false)
  const [error,         setError]         = useState(null)
  const [tab,           setTab]           = useState('basic')
  const [isDirty,       setIsDirty]       = useState(false)
  const [showConfirm,   setShowConfirm]   = useState(false)
  const [showExit,      setShowExit]      = useState(false)
  const [exitTarget,    setExitTarget]    = useState(null)
  const [toast,         setToast]         = useState(null)
  const [basicErrors,   setBasicErrors]   = useState({})
  const [timingErrors,  setTimingErrors]  = useState({})

  // ── Form state ──
  const [basic,     setBasic]     = useState(null)
  const [amenities, setAmenities] = useState(null)
  const [timings,   setTimings]   = useState(null)

  const showToast = (msg, color = '#059669') => { setToast({ msg, color }); setTimeout(() => setToast(null), 3000) }
  const markDirty = () => setIsDirty(true)

  // ── Fetch ──
  const fetchSalon = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await SalonsAPI.getById(id)
      const s   = res.data
      setSalon(s)
      setBasic({
        shopName:    s.shopName    ?? '',
        tagline:     s.tagline     ?? '',
        category:    s.category    ?? '',
        tier:        s.tier        ?? '',
        setupType:   s.setupType   ?? '',
        since:       s.since       ?? '',
        experience:  s.experience  ?? '',
        brandName:   s.brandName   ?? '',
        branchCode:  s.branchCode  ?? '',
        whatsapp:    s.whatsapp    ?? '',
      })
      setAmenities(s.amenities ?? {
        hasAC: false, hasParking: false, hasWifi: false, waitingArea: false, restroom: false,
      })
      setTimings(s.timings ?? {
        monday:{open:'09:00',close:'21:00',isClosed:false},
        tuesday:{open:'09:00',close:'21:00',isClosed:false},
        wednesday:{open:'09:00',close:'21:00',isClosed:false},
        thursday:{open:'09:00',close:'21:00',isClosed:false},
        friday:{open:'09:00',close:'21:00',isClosed:false},
        saturday:{open:'09:00',close:'21:00',isClosed:false},
        sunday:{open:'10:00',close:'18:00',isClosed:false},
      })
    } catch (err) {
      setError(err.message || 'Failed to load salon')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchSalon() }, [id])

  const handleNavigateAway = (path) => {
    if (isDirty) { setExitTarget(path); setShowExit(true) }
    else navigate(path)
  }

  const handleSaveAttempt = () => {
    const bErr = validateBasic(basic)
    const tErr = validateTimings(timings)
    setBasicErrors(bErr)
    setTimingErrors(tErr)
    if (Object.keys(bErr).length) { setTab('basic');   showToast('⚠ Fix errors in Basic Info', '#DC2626'); return }
    if (Object.keys(tErr).length) { setTab('timings'); showToast('⚠ Fix timing errors',        '#DC2626'); return }
    setShowConfirm(true)
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      await SalonsAPI.updateStatus(id, {
        basic, amenities, timings,
      })
      setIsDirty(false)
      setShowConfirm(false)
      showToast('✓ Changes saved successfully', '#059669')
      setTimeout(() => navigate(`/app/salons/${id}`), 1500)
    } catch (err) {
      setShowConfirm(false)
      showToast(`⚠ Save failed: ${err.message}`, '#DC2626')
    } finally {
      setSaving(false)
    }
  }

  const handleDiscard = () => {
    fetchSalon()
    setIsDirty(false)
    setBasicErrors({})
    setTimingErrors({})
    showToast('Changes discarded', '#6B5E3E')
  }

  // ── Loading ──
  if (loading) return (
    <div style={{ minHeight:'100vh', background:'#F0EAE0', display:'flex', alignItems:'center', justifyContent:'center', fontFamily:FONTS.body, color:'#9E8E6E' }}>
      Loading salon...
    </div>
  )

  if (error) return (
    <div style={{ minHeight:'100vh', background:'#F0EAE0', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', fontFamily:FONTS.body, gap:'12px' }}>
      <div style={{ color:'#DC2626' }}>⚠ {error}</div>
      <button onClick={fetchSalon} style={{ background:'#1A1A2E', color:'#fff', border:'none', padding:'8px 20px', cursor:'pointer', fontWeight:700 }}>RETRY</button>
    </div>
  )

  const TABS = ['basic','amenities','location','timings']

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
          <button onClick={() => handleNavigateAway(`/app/salons/${id}`)} style={{ background:'rgba(255,255,255,0.07)', border:'1px solid rgba(255,255,255,0.1)', color:'rgba(255,255,255,0.6)', padding:'5px 10px', cursor:'pointer', fontSize:'12px', fontWeight:700 }}>← BACK</button>
          <div style={{ width:'3px', height:'16px', background:'#B8960C' }}/>
          <div>
            <div style={{ color:'#fff', fontWeight:800, fontSize:'13px', letterSpacing:'1px' }}>{salon?.shopName ?? '—'} — EDIT</div>
            <div style={{ color:'#B8960C', fontSize:'9px', letterSpacing:'1px', marginTop:'1px' }}>
              {salon?.location?.district ?? '—'} • {salon?.location?.state ?? '—'}
            </div>
          </div>
          {isDirty && <span style={{ background:'#D97706', color:'#fff', fontSize:'9px', fontWeight:800, padding:'2px 8px' }}>UNSAVED CHANGES</span>}
        </div>
        <div style={{ display:'flex', gap:'8px' }}>
          {isDirty && <button onClick={handleDiscard} style={{ background:'rgba(255,255,255,0.07)', border:'1px solid rgba(255,255,255,0.15)', color:'rgba(255,255,255,0.5)', padding:'6px 12px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>DISCARD</button>}
          {canEdit
            ? <button onClick={() => isDirty && handleSaveAttempt()} style={{ background:isDirty?'#B8960C':'rgba(184,150,12,0.3)', border:'none', color:isDirty?'#0D1B2A':'rgba(255,255,255,0.3)', padding:'6px 16px', fontSize:'10px', fontWeight:800, cursor:isDirty?'pointer':'not-allowed' }}>✓ SAVE CHANGES</button>
            : <div style={{ background:'rgba(220,38,38,0.15)', border:'1px solid rgba(220,38,38,0.3)', color:'#FCA5A5', padding:'6px 12px', fontSize:'10px', fontWeight:700 }}>VIEW ONLY</div>
          }
        </div>
      </div>

      {!canEdit && (
        <div style={{ background:'#FEF2F2', borderBottom:'2px solid #DC2626', padding:'10px 20px' }}>
          <span style={{ fontSize:'12px', color:'#991B1B', fontWeight:700 }}>⚠ DISTRICT ADMIN — VIEW ONLY. Editing restricted to State Admin and above.</span>
        </div>
      )}

      {/* Tabs */}
      <div style={{ background:'#0A1520', borderBottom:'1px solid rgba(184,150,12,0.2)', display:'flex', padding:'0 20px' }}>
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)} style={{ padding:'10px 18px', border:'none', background:'none', cursor:'pointer', fontSize:'10px', fontWeight:tab===t?800:400, color:tab===t?'#B8960C':'rgba(255,255,255,0.35)', borderBottom:tab===t?'2px solid #B8960C':'2px solid transparent', letterSpacing:'1.5px', textTransform:'uppercase' }}>
            {t}
            {((t==='basic' && Object.keys(basicErrors).length > 0) || (t==='timings' && Object.keys(timingErrors).length > 0))
              ? <span style={{ marginLeft:'6px', background:'#DC2626', color:'#fff', fontSize:'9px', fontWeight:800, padding:'1px 5px' }}>!</span>
              : null
            }
          </button>
        ))}
      </div>

      <div style={{ padding:'16px 20px', maxWidth:'900px' }}>

        {/* ── BASIC ── */}
        {tab === 'basic' && basic && (
          <BCard>
            <BCardHeader title="Basic Information"/>
            <div style={{ padding:'20px', display:'grid', gridTemplateColumns:'1fr 1fr', gap:'16px' }}>
              <Field label="Salon Name" required error={basicErrors.shopName}>
                <Input value={basic.shopName} onChange={e=>{setBasic(b=>({...b,shopName:e.target.value}));markDirty()}} disabled={!canEdit} error={!!basicErrors.shopName}/>
              </Field>
              <Field label="Brand Name">
                <Input value={basic.brandName} onChange={e=>{setBasic(b=>({...b,brandName:e.target.value}));markDirty()}} disabled={!canEdit}/>
              </Field>
              <Field label="Branch Code">
                <Input value={basic.branchCode} onChange={e=>{setBasic(b=>({...b,branchCode:e.target.value}));markDirty()}} disabled={!canEdit}/>
              </Field>
              <Field label="Category" required error={basicErrors.category}>
                <Sel value={basic.category} onChange={e=>{setBasic(b=>({...b,category:e.target.value}));markDirty()}} options={['','MEN_ONLY','WOMEN_ONLY','UNISEX']} disabled={!canEdit}/>
              </Field>
              <Field label="Tier" required error={basicErrors.tier}>
                <Sel value={basic.tier} onChange={e=>{setBasic(b=>({...b,tier:e.target.value}));markDirty()}} options={['','STANDARD','PREMIUM','LUXURY']} disabled={!canEdit}/>
              </Field>
              <Field label="Setup Type">
                <Sel value={basic.setupType} onChange={e=>{setBasic(b=>({...b,setupType:e.target.value}));markDirty()}} options={['','PROPER_SHOP','OPEN_SETUP']} disabled={!canEdit}/>
              </Field>
              <Field label="In Business Since">
                <Input value={basic.since} onChange={e=>{setBasic(b=>({...b,since:e.target.value}));markDirty()}} type="number" disabled={!canEdit}/>
              </Field>
              <Field label="Experience">
                <Sel value={basic.experience} onChange={e=>{setBasic(b=>({...b,experience:e.target.value}));markDirty()}}
                  options={[{value:'',label:'—'},{value:'LESS_THAN_1',label:'< 1 Year'},{value:'1_TO_3',label:'1–3 Years'},{value:'3_TO_5',label:'3–5 Years'},{value:'5_PLUS',label:'5+ Years'},{value:'10_PLUS',label:'10+ Years'}]}
                  disabled={!canEdit}/>
              </Field>
              <Field label="WhatsApp">
                <Input value={basic.whatsapp} onChange={e=>{setBasic(b=>({...b,whatsapp:e.target.value}));markDirty()}} disabled={!canEdit}/>
              </Field>
              <div style={{ gridColumn:'1/-1' }}>
                <Field label="Tagline">
                  <Input value={basic.tagline} onChange={e=>{setBasic(b=>({...b,tagline:e.target.value}));markDirty()}} disabled={!canEdit}/>
                </Field>
              </div>
            </div>
          </BCard>
        )}

        {/* ── AMENITIES ── */}
        {tab === 'amenities' && amenities && (
          <BCard>
            <BCardHeader title="Amenities"/>
            <div style={{ padding:'20px' }}>
              {[
                { key:'hasAC',       label:'Air Conditioning' },
                { key:'hasParking',  label:'Parking Available' },
                { key:'hasWifi',     label:'WiFi Available' },
                { key:'restroom',    label:'Restroom' },
                { key:'waitingArea', label:'Waiting Area' },
              ].map(a => (
                <Toggle key={a.key} label={a.label} checked={!!amenities[a.key]} onChange={v=>{setAmenities(am=>({...am,[a.key]:v}));markDirty()}} disabled={!canEdit}/>
              ))}
            </div>
          </BCard>
        )}

        {/* ── LOCATION ── */}
        {tab === 'location' && (
          <BCard>
            <BCardHeader title="Location & Coordinates"/>
            <div style={{ padding:'20px' }}>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'16px', marginBottom:'16px' }}>
                <Field label="Latitude">
                  <Input value={salon?.location?.geo?.lat ?? ''} disabled={true} placeholder="—"/>
                </Field>
                <Field label="Longitude">
                  <Input value={salon?.location?.geo?.lng ?? ''} disabled={true} placeholder="—"/>
                </Field>
                <Field label="Address">
                  <Input value={salon?.location?.address ?? ''} disabled={true}/>
                </Field>
                <Field label="City">
                  <Input value={salon?.location?.city ?? ''} disabled={true}/>
                </Field>
                <Field label="District">
                  <Input value={salon?.location?.district ?? ''} disabled={true}/>
                </Field>
                <Field label="State">
                  <Input value={salon?.location?.state ?? ''} disabled={true}/>
                </Field>
              </div>
              <div style={{ background:'#FFFBEB', border:'1px solid #FDE68A', padding:'10px', fontSize:'11px', color:'#92400E', fontWeight:600 }}>
                ℹ Location changes require backend map integration (Phase 6).
              </div>
              <div style={{ background:'#F5F0E8', border:'1px solid #E8DFD0', height:'180px', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', borderTop:'2px solid #B8960C', marginTop:'12px' }}>
                <div style={{ fontSize:'32px', marginBottom:'8px' }}>📍</div>
                <div style={{ fontSize:'13px', fontWeight:700, color:'#1A1A2E' }}>{salon?.shopName ?? '—'}</div>
                <div style={{ fontSize:'11px', color:'#9E8E6E', marginTop:'4px' }}>{salon?.location?.address ?? '—'}</div>
              </div>
            </div>
          </BCard>
        )}

        {/* ── TIMINGS ── */}
        {tab === 'timings' && timings && (
          <BCard>
            <BCardHeader title="Operating Hours"/>
            <div>
              <div style={{ display:'grid', gridTemplateColumns:'1.2fr 0.8fr 1fr 1fr 1.5fr', padding:'8px 16px', background:'#F5F0E8', borderBottom:'1px solid #E8DFD0', gap:'8px' }}>
                {['DAY','CLOSED','OPEN TIME','CLOSE TIME',''].map(h => (
                  <span key={h} style={{ fontSize:'9px', fontWeight:800, color:'#9E8E6E', letterSpacing:'1px' }}>{h}</span>
                ))}
              </div>
              {DAYS.map(day => {
                const t   = timings[day] || { open:'09:00', close:'21:00', isClosed:false }
                const err = timingErrors[day]
                return (
                  <div key={day} style={{ borderBottom:'1px solid #F0EAE0' }}>
                    <div style={{ display:'grid', gridTemplateColumns:'1.2fr 0.8fr 1fr 1fr 1.5fr', padding:'12px 16px', alignItems:'center', gap:'8px', background:err?'#FEF2F2':t.isClosed?'#F5F0E8':'#fff' }}>
                      <span style={{ fontSize:'13px', fontWeight:600, color:'#1A1A2E', textTransform:'capitalize' }}>{day}</span>
                      <Toggle label="" checked={!!t.isClosed} onChange={v=>{setTimings(tm=>({...tm,[day]:{...tm[day],isClosed:v}}));markDirty()}} disabled={!canEdit}/>
                      <input type="time" value={t.open ?? '09:00'} disabled={t.isClosed||!canEdit}
                        onChange={e=>{setTimings(tm=>({...tm,[day]:{...tm[day],open:e.target.value}}));markDirty()}}
                        style={{ border:`1px solid ${err?'#DC2626':t.isClosed?'#E8DFD0':'#D4C9B0'}`, padding:'6px 10px', fontSize:'13px', fontFamily:FONTS.body, outline:'none', background:t.isClosed?'#F5F0E8':'#fff', color:t.isClosed?'#C4B49A':'#1A1A2E', width:'100%' }}
                      />
                      <input type="time" value={t.close ?? '21:00'} disabled={t.isClosed||!canEdit}
                        onChange={e=>{setTimings(tm=>({...tm,[day]:{...tm[day],close:e.target.value}}));markDirty()}}
                        style={{ border:`1px solid ${err?'#DC2626':t.isClosed?'#E8DFD0':'#D4C9B0'}`, padding:'6px 10px', fontSize:'13px', fontFamily:FONTS.body, outline:'none', background:t.isClosed?'#F5F0E8':'#fff', color:t.isClosed?'#C4B49A':'#1A1A2E', width:'100%' }}
                      />
                      {err ? <span style={{ fontSize:'10px', color:'#DC2626', fontWeight:700 }}>⚠ {err}</span> : <span/>}
                    </div>
                  </div>
                )
              })}
            </div>
          </BCard>
        )}

      </div>

      {/* Sticky Footer */}
      <div style={{ position:'sticky', bottom:0, background:'#0D1B2A', borderTop:'2px solid #B8960C', padding:'12px 20px', display:'flex', justifyContent:'space-between', alignItems:'center', zIndex:10 }}>
        <div style={{ fontSize:'11px', color:'rgba(255,255,255,0.4)' }}>
          {canEdit ? isDirty ? '⚠ You have unsaved changes' : '✓ No pending changes' : '⊘ View Only — DISTRICT ADMIN'}
        </div>
        <div style={{ display:'flex', gap:'8px' }}>
          <button onClick={() => handleNavigateAway(`/app/salons/${id}`)} style={{ background:'rgba(255,255,255,0.07)', border:'1px solid rgba(255,255,255,0.15)', color:'rgba(255,255,255,0.5)', padding:'8px 16px', fontSize:'11px', fontWeight:700, cursor:'pointer' }}>CANCEL</button>
          {isDirty && canEdit && (
            <button onClick={handleDiscard} style={{ background:'rgba(255,255,255,0.07)', border:'1px solid rgba(255,255,255,0.2)', color:'rgba(255,255,255,0.6)', padding:'8px 16px', fontSize:'11px', fontWeight:700, cursor:'pointer' }}>DISCARD</button>
          )}
          {canEdit && (
            <button onClick={() => isDirty && handleSaveAttempt()} style={{ background:isDirty?'#B8960C':'rgba(184,150,12,0.3)', border:'none', color:isDirty?'#0D1B2A':'rgba(255,255,255,0.3)', padding:'8px 20px', fontSize:'11px', fontWeight:800, cursor:isDirty?'pointer':'not-allowed', letterSpacing:'0.5px' }}>✓ SAVE CHANGES</button>
          )}
        </div>
      </div>

      {/* Footer */}
      <div style={{ background:'#0D1B2A', borderTop:'1px solid rgba(184,150,12,0.2)', padding:'8px 20px', display:'flex', justifyContent:'space-between' }}>
        <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.2)' }}>ZEMISH SALON EDIT v1.0.0</span>
        <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.2)' }}>NATIONAL COMMAND CENTER</span>
      </div>

      {showConfirm && <ConfirmSaveModal onConfirm={handleSave} onCancel={() => setShowConfirm(false)} saving={saving}/>}
      {showExit    && <UnsavedExitModal onLeave={() => { setShowExit(false); navigate(exitTarget) }} onStay={() => { setShowExit(false); handleSaveAttempt() }}/>}
    </div>
  )
}