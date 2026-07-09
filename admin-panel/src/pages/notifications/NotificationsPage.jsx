import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FONTS } from '../../config/brand'
import useAuthStore from '../../store/authStore'

const ADMIN_LEVELS  = { SUPER_ADMIN:'SUPER_ADMIN', INDIA_ADMIN:'INDIA_ADMIN', STATE_ADMIN:'STATE_ADMIN', DISTRICT_ADMIN:'DISTRICT_ADMIN' }
const canBulkSend   = (l) => [ADMIN_LEVELS.SUPER_ADMIN, ADMIN_LEVELS.INDIA_ADMIN].includes(l)
const canTargeted   = (l) => [ADMIN_LEVELS.SUPER_ADMIN, ADMIN_LEVELS.INDIA_ADMIN, ADMIN_LEVELS.STATE_ADMIN].includes(l)
const canExport     = (l) => [ADMIN_LEVELS.SUPER_ADMIN, ADMIN_LEVELS.INDIA_ADMIN].includes(l)

// Char limits per channel
const CHAR_LIMITS = { PUSH:200, SMS:160, EMAIL:1000, IN_APP:300 }

const NOTIF_DATA = [
  { id:'NTF001', title:'New Booking Confirmation',    body:'Your booking at Salman Salmani is confirmed for 10:00 AM.',channel:'PUSH',   target:'ALL_USERS',   state:null, status:'SENT',      sentAt:'2026-06-23 10:00', sentBy:'Amit Verma',   reach:12840, opened:8420, delivered:12600, failed:240,  clicked:3200, scheduledAt:null, draft:false },
  { id:'NTF002', title:'KYC Verification Reminder',  body:'Complete your KYC to unlock full features.',             channel:'IN_APP', target:'PROVIDERS',   state:null, status:'SENT',      sentAt:'2026-06-23 09:00', sentBy:'Super Admin',  reach:284,   opened:210,  delivered:284,   failed:0,    clicked:140,  scheduledAt:null, draft:false },
  { id:'NTF003', title:'Weekend Offer — 20% OFF',    body:'Get 20% off on all haircut services this weekend!',      channel:'PUSH',   target:'STATE',       state:'UP', status:'SCHEDULED', sentAt:null,              sentBy:'Rajesh Kumar', reach:4820,  opened:0,    delivered:0,     failed:0,    clicked:0,    scheduledAt:'2026-06-25 09:00', draft:false },
  { id:'NTF004', title:'System Maintenance Alert',   body:'Platform will be down for maintenance 2:00-4:00 AM.',    channel:'EMAIL',  target:'ALL',         state:null, status:'SENT',      sentAt:'2026-06-22 08:00', sentBy:'Super Admin',  reach:13124, opened:9800, delivered:13000, failed:124,  clicked:0,    scheduledAt:null, draft:false },
  { id:'NTF005', title:'New Salon Near You',         body:'A new top-rated salon has opened in your area!',         channel:'PUSH',   target:'STATE',       state:'MH', status:'FAILED',    sentAt:'2026-06-21 03:00', sentBy:'Priya Desai',  reach:5200,  opened:0,    delivered:1200,  failed:4000, clicked:0,    scheduledAt:null, draft:false },
  { id:'NTF006', title:'Payment Received',           body:'₹450 has been credited to your salon wallet.',           channel:'SMS',    target:'PROVIDERS',   state:null, status:'SENT',      sentAt:'2026-06-21 12:00', sentBy:'Amit Verma',   reach:842,   opened:820,  delivered:842,   failed:0,    clicked:0,    scheduledAt:null, draft:false },
  { id:'NTF007', title:'Rate Your Last Visit',       body:'How was your experience? Leave a review.',               channel:'PUSH',   target:'ALL_USERS',   state:null, status:'DRAFT',     sentAt:null,              sentBy:'Amit Verma',   reach:0,     opened:0,    delivered:0,     failed:0,    clicked:0,    scheduledAt:null, draft:true  },
  { id:'NTF008', title:'Dispute Resolved',           body:'Your dispute DSP002 has been resolved. Check details.',  channel:'IN_APP', target:'ALL_USERS',   state:null, status:'SENT',      sentAt:'2026-06-20 04:00', sentBy:'Super Admin',  reach:1,     opened:1,    delivered:1,     failed:0,    clicked:1,    scheduledAt:null, draft:false },
]

const STATUS_COLORS = {
  SENT:      { bg:'#D1FAE5', color:'#065F46' },
  SCHEDULED: { bg:'#EFF6FF', color:'#1D4ED8' },
  FAILED:    { bg:'#FEE2E2', color:'#991B1B' },
  DRAFT:     { bg:'#F3F4F6', color:'#374151' },
}
const CHANNEL_COLORS = {
  PUSH:   { bg:'#EFF6FF', color:'#1D4ED8', border:'#2563EB' },
  SMS:    { bg:'#F0FDF4', color:'#065F46', border:'#059669' },
  EMAIL:  { bg:'#F5F3FF', color:'#5B21B6', border:'#7C3AED' },
  IN_APP: { bg:'#FFFBEB', color:'#92400E', border:'#D97706' },
}
const STATUSES  = ['ALL','SENT','SCHEDULED','FAILED','DRAFT']
const CHANNELS  = ['ALL','PUSH','SMS','EMAIL','IN_APP']
const TARGETS   = ['ALL','ALL_USERS','PROVIDERS','STATE']
const SENT_BY   = ['All Admins',...new Set(NOTIF_DATA.map(n=>n.sentBy))] // ✅ Fix 5: Sent By filter

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
  <div style={{ display:'flex', justifyContent:'space-between', padding:'7px 0', borderBottom:'1px solid #F0EAE0' }}>
    <span style={{ fontSize:'12px', color:'#9E8E6E' }}>{label}</span>
    <span style={{ fontSize:'12px', fontWeight:600, color:valueColor||'#1A1A2E' }}>{value}</span>
  </div>
)

// ✅ Fix 7: Character counter component
function CharCounter({ value, channel }) {
  const limit = CHAR_LIMITS[channel]||160
  const len   = value.length
  const pct   = Math.min(len/limit,1)
  const color = pct>0.9?'#DC2626':pct>0.7?'#D97706':'#059669'
  return (
    <div style={{ display:'flex', justifyContent:'space-between', marginTop:'4px' }}>
      <div style={{ height:'3px', flex:1, background:'#E8DFD0', marginRight:'8px', marginTop:'6px' }}>
        <div style={{ height:'100%', width:`${pct*100}%`, background:color, transition:'width 0.2s' }}/>
      </div>
      <span style={{ fontSize:'10px', color, fontWeight:700, whiteSpace:'nowrap' }}>{len}/{limit}</span>
    </div>
  )
}

// ✅ Fix 1: Compose Modal with Save Draft button
function ComposeModal({ onSend, onDraft, onCancel, adminLevel }) {
  const hasBulk = canBulkSend(adminLevel)
  const [form, setForm] = useState({ title:'', body:'', channel:'PUSH', target: hasBulk?'ALL_USERS':'STATE', state:'', scheduledAt:'' })
  const charLimit = CHAR_LIMITS[form.channel]||160

  const set = (k,v) => setForm(f=>({...f,[k]:v}))
  const canSend = form.title.trim()&&form.body.trim()&&form.body.length<=charLimit

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.75)', zIndex:2000, display:'flex', alignItems:'center', justifyContent:'center' }}>
      <div style={{ background:'#fff', width:'520px', maxHeight:'90vh', overflowY:'auto', border:'2px solid #B8960C' }}>
        <div style={{ background:'#0D1B2A', padding:'14px 18px', borderBottom:'2px solid #B8960C', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <div style={{ color:'#fff', fontWeight:800, fontSize:'13px', letterSpacing:'1px' }}>COMPOSE NOTIFICATION</div>
          <button onClick={onCancel} style={{ background:'none', border:'none', color:'rgba(255,255,255,0.5)', fontSize:'16px', cursor:'pointer' }}>✕</button>
        </div>
        <div style={{ padding:'18px' }}>
          <div style={{ marginBottom:'12px' }}>
            <label style={{ fontSize:'10px', color:'#9E8E6E', fontWeight:800, letterSpacing:'1px', display:'block', marginBottom:'5px' }}>TITLE *</label>
            <input value={form.title} onChange={e=>set('title',e.target.value)} placeholder="Notification title..."
              style={{ width:'100%', border:'1px solid #D4C9B0', padding:'8px 10px', fontSize:'13px', fontFamily:FONTS.body, outline:'none', boxSizing:'border-box' }}/>
          </div>
          <div style={{ marginBottom:'12px' }}>
            <label style={{ fontSize:'10px', color:'#9E8E6E', fontWeight:800, letterSpacing:'1px', display:'block', marginBottom:'5px' }}>BODY * ({form.channel} limit: {charLimit} chars)</label>
            <textarea value={form.body} onChange={e=>set('body',e.target.value)} placeholder="Notification message..."
              style={{ width:'100%', border:`1px solid ${form.body.length>charLimit?'#DC2626':'#D4C9B0'}`, padding:'8px 10px', fontSize:'13px', fontFamily:FONTS.body, outline:'none', minHeight:'80px', resize:'vertical', boxSizing:'border-box' }}/>
            <CharCounter value={form.body} channel={form.channel}/>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'12px', marginBottom:'12px' }}>
            <div>
              <label style={{ fontSize:'10px', color:'#9E8E6E', fontWeight:800, letterSpacing:'1px', display:'block', marginBottom:'5px' }}>CHANNEL</label>
              <select value={form.channel} onChange={e=>set('channel',e.target.value)}
                style={{ width:'100%', border:'1px solid #D4C9B0', padding:'7px', fontSize:'12px', fontFamily:FONTS.body, outline:'none' }}>
                {Object.keys(CHAR_LIMITS).map(c=><option key={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize:'10px', color:'#9E8E6E', fontWeight:800, letterSpacing:'1px', display:'block', marginBottom:'5px' }}>
                TARGET {!hasBulk&&<span style={{ color:'#D97706' }}>(Targeted only)</span>}
              </label>
              <select value={form.target} onChange={e=>set('target',e.target.value)} disabled={!hasBulk}
                style={{ width:'100%', border:'1px solid #D4C9B0', padding:'7px', fontSize:'12px', fontFamily:FONTS.body, outline:'none', background:!hasBulk?'#F5F0E8':'#fff' }}>
                {/* ✅ Fix 8: STATE_ADMIN only sees STATE target */}
                {hasBulk && <option value="ALL_USERS">All Users</option>}
                {hasBulk && <option value="ALL">Everyone</option>}
                {hasBulk && <option value="PROVIDERS">All Providers</option>}
                <option value="STATE">State Targeted</option>
              </select>
            </div>
          </div>
          {form.target==='STATE' && (
            <div style={{ marginBottom:'12px' }}>
              <label style={{ fontSize:'10px', color:'#9E8E6E', fontWeight:800, letterSpacing:'1px', display:'block', marginBottom:'5px' }}>STATE</label>
              <input value={form.state} onChange={e=>set('state',e.target.value)} placeholder="e.g. UP, MH, DL..."
                style={{ width:'100%', border:'1px solid #D4C9B0', padding:'8px 10px', fontSize:'13px', fontFamily:FONTS.body, outline:'none', boxSizing:'border-box' }}/>
            </div>
          )}
          <div style={{ marginBottom:'16px' }}>
            <label style={{ fontSize:'10px', color:'#9E8E6E', fontWeight:800, letterSpacing:'1px', display:'block', marginBottom:'5px' }}>SCHEDULE (optional)</label>
            <input type="datetime-local" value={form.scheduledAt} onChange={e=>set('scheduledAt',e.target.value)}
              style={{ width:'100%', border:'1px solid #D4C9B0', padding:'7px 10px', fontSize:'12px', fontFamily:FONTS.body, outline:'none', boxSizing:'border-box' }}/>
          </div>
          {/* Preview */}
          {form.title && (
            <div style={{ marginBottom:'16px', padding:'12px', background:'#F5F0E8', border:'1px solid #D4C9B0', borderLeft:'3px solid #B8960C' }}>
              <div style={{ fontSize:'10px', color:'#9E8E6E', fontWeight:700, marginBottom:'6px' }}>PREVIEW</div>
              <div style={{ fontSize:'13px', fontWeight:700, color:'#1A1A2E', marginBottom:'3px' }}>{form.title}</div>
              <div style={{ fontSize:'12px', color:'#6B5E3E' }}>{form.body||'—'}</div>
            </div>
          )}
          <div style={{ display:'flex', gap:'8px', justifyContent:'flex-end' }}>
            <button onClick={onCancel} style={{ background:'#fff', border:'1px solid #D4C9B0', color:'#6B5E3E', padding:'8px 14px', fontSize:'11px', fontWeight:700, cursor:'pointer' }}>CANCEL</button>
            {/* ✅ Fix 1: Save Draft button */}
            <button onClick={()=>canSend&&onDraft(form)} style={{ background:canSend?'#374151':'#F5F0E8', border:'none', color:canSend?'#fff':'#C4B49A', padding:'8px 14px', fontSize:'11px', fontWeight:700, cursor:canSend?'pointer':'not-allowed' }}>SAVE DRAFT</button>
            <button onClick={()=>canSend&&onSend(form)} style={{ background:canSend?'#B8960C':'#F5F0E8', border:'none', color:canSend?'#fff':'#C4B49A', padding:'8px 16px', fontSize:'11px', fontWeight:800, cursor:canSend?'pointer':'not-allowed' }}>
              {form.scheduledAt?'⏰ SCHEDULE':'▶ SEND NOW'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// Detail Drawer
function DetailDrawer({ notif, onClose, onRetry, onEditSchedule, onCancelSchedule, navigate }) {
  if (!notif) return null
  const sc  = STATUS_COLORS[notif.status]||STATUS_COLORS.SENT
  const cc  = CHANNEL_COLORS[notif.channel]||CHANNEL_COLORS.PUSH
  // ✅ Fix 4: Full delivery stats
  const ctr = notif.clicked&&notif.delivered?((notif.clicked/notif.delivered)*100).toFixed(1):'0.0'
  const openRate = notif.delivered>0?((notif.opened/notif.delivered)*100).toFixed(1):'0.0'

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', zIndex:1500, display:'flex', justifyContent:'flex-end' }} onClick={onClose}>
      <div style={{ width:'420px', background:'#fff', height:'100%', overflowY:'auto', borderLeft:'2px solid #B8960C' }} onClick={e=>e.stopPropagation()}>
        <div style={{ background:'#0D1B2A', padding:'14px 18px', borderBottom:'2px solid #B8960C', display:'flex', justifyContent:'space-between', alignItems:'center', position:'sticky', top:0 }}>
          <div>
            <div style={{ color:'#fff', fontWeight:800, fontSize:'13px' }}>{notif.title}</div>
            <div style={{ color:'#B8960C', fontSize:'9px', marginTop:'2px' }}>{notif.id}</div>
          </div>
          <button onClick={onClose} style={{ background:'none', border:'none', color:'rgba(255,255,255,0.5)', fontSize:'18px', cursor:'pointer' }}>✕</button>
        </div>

        <div style={{ padding:'16px' }}>
          {/* Status + Action Buttons */}
          <div style={{ display:'flex', gap:'8px', marginBottom:'14px', flexWrap:'wrap' }}>
            <span style={{ fontSize:'10px', fontWeight:800, background:sc.bg, color:sc.color, padding:'4px 10px' }}>{notif.status}</span>
            <span style={{ fontSize:'10px', fontWeight:800, background:cc.bg, color:cc.color, border:`1px solid ${cc.border}`, padding:'4px 10px' }}>{notif.channel}</span>
            {/* ✅ Fix 2: Retry button for FAILED */}
            {notif.status==='FAILED' && (
              <button onClick={()=>onRetry(notif)} style={{ background:'#2563EB', color:'#fff', border:'none', padding:'4px 10px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>↻ RETRY</button>
            )}
            {/* ✅ Fix 3: Edit/Cancel Schedule for SCHEDULED */}
            {notif.status==='SCHEDULED' && (
              <>
                <button onClick={()=>onEditSchedule(notif)} style={{ background:'#D97706', color:'#fff', border:'none', padding:'4px 10px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>✎ EDIT SCHEDULE</button>
                <button onClick={()=>onCancelSchedule(notif)} style={{ background:'#DC2626', color:'#fff', border:'none', padding:'4px 10px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>✕ CANCEL</button>
              </>
            )}
          </div>

          <div style={{ padding:'10px', background:'#F5F0E8', border:'1px solid #E8DFD0', borderLeft:'3px solid #B8960C', marginBottom:'14px', fontSize:'12px', color:'#6B5E3E', lineHeight:'1.6' }}>
            {notif.body}
          </div>

          {/* ✅ Fix 4: Full delivery stats */}
          <div style={{ background:'#0D1B2A', padding:'14px', marginBottom:'14px', borderTop:'2px solid #B8960C' }}>
            <div style={{ fontSize:'10px', color:'rgba(255,255,255,0.4)', letterSpacing:'1px', marginBottom:'10px' }}>DELIVERY STATISTICS</div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'10px' }}>
              {[
                { label:'Reach',     value:notif.reach.toLocaleString('en-IN'),     color:'#B8960C' },
                { label:'Delivered', value:notif.delivered.toLocaleString('en-IN'), color:'#059669' },
                { label:'Failed',    value:notif.failed.toLocaleString('en-IN'),    color:'#DC2626' },
                { label:'Opened',    value:notif.opened.toLocaleString('en-IN'),    color:'#7C3AED' },
                { label:'Clicked',   value:notif.clicked.toLocaleString('en-IN'),   color:'#2563EB' },
                { label:'CTR',       value:`${ctr}%`,                               color:'#D97706' },
              ].map(s=>(
                <div key={s.label} style={{ textAlign:'center' }}>
                  <div style={{ fontSize:'16px', fontWeight:800, color:s.color }}>{s.value}</div>
                  <div style={{ fontSize:'9px', color:'rgba(255,255,255,0.4)', marginTop:'2px' }}>{s.label}</div>
                </div>
              ))}
            </div>
            <div style={{ marginTop:'10px', display:'flex', justifyContent:'space-between', fontSize:'10px', color:'rgba(255,255,255,0.4)' }}>
              <span>Open Rate: <strong style={{ color:'#7C3AED' }}>{openRate}%</strong></span>
              <span>Delivery Rate: <strong style={{ color:'#059669' }}>{notif.reach>0?((notif.delivered/notif.reach)*100).toFixed(1):0}%</strong></span>
            </div>
          </div>

          <InfoRow label="Target"     value={notif.target}/>
          {notif.state && <InfoRow label="State" value={notif.state}/>}
          {notif.scheduledAt && <InfoRow label="Scheduled At" value={notif.scheduledAt} valueColor="#2563EB"/>}
          {notif.sentAt && <InfoRow label="Sent At" value={notif.sentAt}/>}

          {/* ✅ Fix 6: Audit info */}
          <div style={{ marginTop:'12px', padding:'10px', background:'#F5F0E8', border:'1px solid #E8DFD0' }}>
            <div style={{ fontSize:'9px', color:'#9E8E6E', fontWeight:800, letterSpacing:'1px', marginBottom:'6px' }}>AUDIT INFO</div>
            <InfoRow label="Created By" value={notif.sentBy}/>
            <InfoRow label="Created At" value={notif.sentAt||notif.scheduledAt||'Draft'}/>
            <button onClick={()=>navigate('/app/audit')} style={{ marginTop:'8px', background:'none', border:'1px solid #B8960C', color:'#B8960C', padding:'5px 12px', fontSize:'10px', fontWeight:700, cursor:'pointer', width:'100%' }}>
              VIEW AUDIT LOG →
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function NotificationsPage() {
  const navigate   = useNavigate()
  const admin      = useAuthStore(s=>s.admin)
  const adminLevel = admin?.adminLevel||ADMIN_LEVELS.SUPER_ADMIN
  const hasBulk    = canBulkSend(adminLevel)
  const hasTarget  = canTargeted(adminLevel)
  const hasExport  = canExport(adminLevel)

  if (!hasTarget) {
    return (
      <div style={{ fontFamily:FONTS.body, background:'#F0EAE0', minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center' }}>
        <div style={{ background:'#fff', border:'2px solid #DC2626', padding:'40px', textAlign:'center', maxWidth:'400px' }}>
          <div style={{ fontSize:'40px', marginBottom:'16px' }}>🔒</div>
          <div style={{ fontSize:'16px', fontWeight:800, color:'#1A1A2E', marginBottom:'8px' }}>Access Denied</div>
          <div style={{ fontSize:'13px', color:'#9E8E6E', marginBottom:'16px' }}>DISTRICT_ADMIN cannot access Notifications.</div>
          <button onClick={()=>navigate(-1)} style={{ background:'#0D1B2A', color:'#B8960C', border:'none', padding:'8px 20px', fontSize:'12px', fontWeight:700, cursor:'pointer' }}>← GO BACK</button>
        </div>
      </div>
    )
  }

  const [notifs,    setNotifs]    = useState(NOTIF_DATA)
  const [search,    setSearch]    = useState('')
  const [statusF,   setStatusF]   = useState('ALL')
  const [channelF,  setChannelF]  = useState('ALL')
  const [targetF,   setTargetF]   = useState('ALL')
  const [sentByF,   setSentByF]   = useState('All Admins')   // ✅ Fix 5
  const [page,      setPage]      = useState(1)
  const [toast,     setToast]     = useState(null)
  const [compose,   setCompose]   = useState(false)
  const [drawer,    setDrawer]    = useState(null)
  const PER_PAGE = 8

  const showToast = (msg,color) => { setToast({msg,color}); setTimeout(()=>setToast(null),3000) }

  const handleSend = (form) => {
    const n = {
      id:`NTF${String(notifs.length+1).padStart(3,'0')}`,
      title:form.title, body:form.body, channel:form.channel,
      target:form.target, state:form.state||null,
      status:form.scheduledAt?'SCHEDULED':'SENT',
      sentAt:form.scheduledAt?null:new Date().toLocaleString('en-IN',{hour12:false}),
      sentBy:admin?.name||adminLevel,
      scheduledAt:form.scheduledAt||null,
      reach:Math.floor(Math.random()*10000+500), opened:0, delivered:0, failed:0, clicked:0, draft:false,
    }
    setNotifs(prev=>[n,...prev])
    setCompose(false)
    showToast(form.scheduledAt?'⏰ Notification scheduled':'✓ Notification sent', form.scheduledAt?'#2563EB':'#059669')
  }

  const handleDraft = (form) => {
    const n = {
      id:`NTF${String(notifs.length+1).padStart(3,'0')}`,
      title:form.title, body:form.body, channel:form.channel,
      target:form.target, state:form.state||null,
      status:'DRAFT', sentAt:null, sentBy:admin?.name||adminLevel,
      scheduledAt:null, reach:0, opened:0, delivered:0, failed:0, clicked:0, draft:true,
    }
    setNotifs(prev=>[n,...prev])
    setCompose(false)
    showToast('📋 Draft saved', '#374151')
  }

  // ✅ Fix 2: Retry
  const handleRetry = (n) => {
    setNotifs(prev=>prev.map(x=>x.id===n.id?{...x,status:'SENT',sentAt:new Date().toLocaleString('en-IN',{hour12:false}),delivered:x.reach,failed:0}:x))
    setDrawer(null)
    showToast(`↻ Retrying ${n.id}...`, '#2563EB')
  }

  // ✅ Fix 3: Edit/Cancel Schedule
  const handleEditSchedule = (n) => {
    const newTime = prompt('New scheduled time (YYYY-MM-DD HH:MM):',n.scheduledAt)
    if (newTime) {
      setNotifs(prev=>prev.map(x=>x.id===n.id?{...x,scheduledAt:newTime}:x))
      showToast('⏰ Schedule updated', '#D97706')
    }
  }
  const handleCancelSchedule = (n) => {
    setNotifs(prev=>prev.map(x=>x.id===n.id?{...x,status:'DRAFT',scheduledAt:null,draft:true}:x))
    setDrawer(null)
    showToast('✕ Schedule cancelled — moved to Draft', '#DC2626')
  }

  const filtered = notifs.filter(n=>{
    const q=search.toLowerCase()
    const matchSearch  = !search||n.title.toLowerCase().includes(q)||n.id.toLowerCase().includes(q)
    const matchStatus  = statusF==='ALL'||n.status===statusF
    const matchChannel = channelF==='ALL'||n.channel===channelF
    const matchTarget  = targetF==='ALL'||n.target===targetF
    const matchSentBy  = sentByF==='All Admins'||n.sentBy===sentByF   // ✅ Fix 5
    return matchSearch&&matchStatus&&matchChannel&&matchTarget&&matchSentBy
  })

  const totalPages = Math.ceil(filtered.length/PER_PAGE)
  const paginated  = filtered.slice((page-1)*PER_PAGE,page*PER_PAGE)

  const counts = {
    sent:      notifs.filter(n=>n.status==='SENT').length,
    scheduled: notifs.filter(n=>n.status==='SCHEDULED').length,
    failed:    notifs.filter(n=>n.status==='FAILED').length,
    draft:     notifs.filter(n=>n.status==='DRAFT').length,
  }
  const totalReach = notifs.filter(n=>n.status==='SENT').reduce((a,n)=>a+n.reach,0)

  return (
    <div style={{ fontFamily:FONTS.body, background:'#F0EAE0', minHeight:'100vh' }}>
      {toast && <div style={{ position:'fixed', top:'20px', right:'20px', background:toast.color, color:'#fff', padding:'12px 20px', fontSize:'13px', fontWeight:700, zIndex:9999, boxShadow:'0 4px 12px rgba(0,0,0,0.2)' }}>{toast.msg}</div>}

      {/* Header */}
      <div style={{ background:'#0D1B2A', borderBottom:'2px solid #B8960C', padding:'0 20px', height:'52px', display:'flex', alignItems:'center', justifyContent:'space-between', position:'sticky', top:0, zIndex:10 }}>
        <div style={{ display:'flex', alignItems:'center', gap:'12px' }}>
          <div style={{ width:'3px', height:'16px', background:'#B8960C' }}/>
          <h1 style={{ fontSize:'13px', fontWeight:800, color:'#fff', margin:0, letterSpacing:'2px', textTransform:'uppercase' }}>Notifications</h1>
          <span style={{ background:'rgba(184,150,12,0.2)', color:'#B8960C', fontSize:'10px', fontWeight:800, padding:'2px 8px', border:'1px solid rgba(184,150,12,0.3)' }}>{notifs.length} TOTAL</span>
          {counts.scheduled>0 && <span style={{ background:'rgba(37,99,235,0.2)', color:'#93C5FD', fontSize:'10px', fontWeight:800, padding:'2px 8px', border:'1px solid rgba(37,99,235,0.3)' }}>⏰ {counts.scheduled} SCHEDULED</span>}
          {counts.failed>0 && <span style={{ background:'rgba(220,38,38,0.2)', color:'#FCA5A5', fontSize:'10px', fontWeight:800, padding:'2px 8px', border:'1px solid rgba(220,38,38,0.3)' }}>⚠ {counts.failed} FAILED</span>}
          {/* ✅ Fix 8: STATE_ADMIN sees limited compose */}
          {!hasBulk && hasTarget && <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.3)', fontStyle:'italic' }}>Targeted send only</span>}
        </div>
        <div style={{ display:'flex', gap:'8px' }}>
          {hasExport && <button style={{ background:'rgba(255,255,255,0.07)', border:'1px solid rgba(255,255,255,0.15)', color:'rgba(255,255,255,0.6)', padding:'6px 12px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>↓ EXPORT</button>}
          {hasTarget && (
            <button onClick={()=>setCompose(true)} style={{ background:'#B8960C', border:'none', color:'#0D1B2A', padding:'6px 14px', fontSize:'10px', fontWeight:800, cursor:'pointer' }}>
              + {hasBulk?'COMPOSE':'TARGETED SEND'}
            </button>
          )}
        </div>
      </div>

      <div style={{ padding:'14px 20px' }}>

        {/* Summary Strip */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:'1px', background:'#D4C9B0', border:'1px solid #D4C9B0', marginBottom:'12px' }}>
          {[
            { label:'Total Reach',  value:totalReach.toLocaleString('en-IN'), color:'#B8960C' },
            { label:'Sent',         value:counts.sent,                         color:'#059669' },
            { label:'Scheduled',    value:counts.scheduled,                    color:'#2563EB' },
            { label:'Failed',       value:counts.failed,                       color:'#DC2626' },
            { label:'Drafts',       value:counts.draft,                        color:'#374151' },
          ].map(m=>(
            <div key={m.label} style={{ background:'#0D1B2A', padding:'12px 16px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <span style={{ fontSize:'11px', color:'rgba(255,255,255,0.4)' }}>{m.label}</span>
              <span style={{ fontSize:'18px', fontWeight:800, color:m.color }}>{m.value}</span>
            </div>
          ))}
        </div>

        {/* Channel Cards */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:'10px', marginBottom:'12px' }}>
          {Object.keys(CHANNEL_COLORS).map(ch=>{
            const cc=CHANNEL_COLORS[ch]
            const cnt=notifs.filter(n=>n.channel===ch).length
            return (
              <div key={ch} onClick={()=>setChannelF(p=>p===ch?'ALL':ch)}
                style={{ background:'#fff', border:`1px solid ${cc.border}30`, borderTop:`2px solid ${cc.border}`, padding:'10px 14px', cursor:'pointer', outline:channelF===ch?`2px solid ${cc.border}`:'none' }}>
                <div style={{ display:'flex', justifyContent:'space-between', marginBottom:'4px' }}>
                  <span style={{ fontSize:'11px', fontWeight:800, color:cc.color }}>{ch}</span>
                  <span style={{ fontSize:'18px', fontWeight:800, color:cc.color }}>{cnt}</span>
                </div>
                <div style={{ fontSize:'10px', color:'#9E8E6E' }}>{cc.color==='#1D4ED8'?'Mobile push':cc.color==='#065F46'?'SMS text':cc.color==='#5B21B6'?'Email message':'In-app alert'}</div>
              </div>
            )
          })}
        </div>

        {/* Filters */}
        <BCard style={{ marginBottom:'12px' }}>
          <div style={{ padding:'10px 14px', display:'flex', gap:'8px', alignItems:'center', flexWrap:'wrap' }}>
            <div style={{ display:'flex', alignItems:'center', gap:'6px' }}>
              <div style={{ width:'3px', height:'14px', background:'#B8960C' }}/>
              <span style={{ fontSize:'10px', fontWeight:800, color:'#9E8E6E', letterSpacing:'1px' }}>FILTERS</span>
            </div>
            <input value={search} onChange={e=>{setSearch(e.target.value);setPage(1)}} placeholder="Search title, ID..."
              style={{ flex:1, minWidth:'180px', border:'1px solid #D4C9B0', padding:'6px 10px', fontSize:'12px', fontFamily:FONTS.body, outline:'none', background:'#FDFAF6' }}/>
            {[
              { val:statusF,  set:v=>{setStatusF(v);setPage(1)},  opts:STATUSES },
              { val:channelF, set:v=>{setChannelF(v);setPage(1)}, opts:CHANNELS },
              { val:targetF,  set:v=>{setTargetF(v);setPage(1)},  opts:TARGETS  },
              { val:sentByF,  set:v=>{setSentByF(v);setPage(1)},  opts:SENT_BY  }, // ✅ Fix 5
            ].map((f,i)=>(
              <select key={i} value={f.val} onChange={e=>f.set(e.target.value)}
                style={{ border:'1px solid #D4C9B0', padding:'5px 8px', fontSize:'11px', color:'#6B5E3E', background:'#FDFAF6', cursor:'pointer', fontFamily:FONTS.body, outline:'none' }}>
                {f.opts.map(o=><option key={o}>{o}</option>)}
              </select>
            ))}
            <span style={{ fontSize:'11px', color:'#9E8E6E' }}>{filtered.length} results</span>
            <button onClick={()=>{setSearch('');setStatusF('ALL');setChannelF('ALL');setTargetF('ALL');setSentByF('All Admins');setPage(1)}}
              style={{ background:'#F5F0E8', border:'1px solid #D4C9B0', color:'#9E8E6E', padding:'5px 10px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>RESET</button>
          </div>
        </BCard>

        {/* Table */}
        <BCard>
          <BCardHeader title={`Notification Log (${filtered.length})`} action={<span style={{ fontSize:'11px', color:'#9E8E6E' }}>Page {page}/{totalPages||1}</span>}/>
          <div style={{ display:'grid', gridTemplateColumns:'0.7fr 2fr 0.7fr 0.8fr 0.7fr 0.6fr 0.6fr 0.6fr 0.7fr 0.6fr', padding:'8px 14px', background:'#F5F0E8', borderBottom:'1px solid #E8DFD0', gap:'8px' }}>
            {['ID','TITLE','CHANNEL','TARGET','BY','REACH','DELIVERED','FAILED','STATUS','DATE'].map(h=>(
              <span key={h} style={{ fontSize:'9px', fontWeight:800, color:'#9E8E6E', letterSpacing:'1px' }}>{h}</span>
            ))}
          </div>
          {paginated.length===0
            ?<div style={{ padding:'40px', textAlign:'center', color:'#9E8E6E' }}>No notifications found</div>
            :paginated.map((n,i)=>{
              const sc=STATUS_COLORS[n.status]||STATUS_COLORS.SENT
              const cc=CHANNEL_COLORS[n.channel]||CHANNEL_COLORS.PUSH
              return (
                <div key={n.id} onClick={()=>setDrawer(n)}
                  style={{ display:'grid', gridTemplateColumns:'0.7fr 2fr 0.7fr 0.8fr 0.7fr 0.6fr 0.6fr 0.6fr 0.7fr 0.6fr', padding:'10px 14px', borderBottom:'1px solid #F0EAE0', alignItems:'center', gap:'8px', background:n.status==='FAILED'?'#FEF2F2':n.status==='DRAFT'?'#F5F0E8':i%2===0?'#fff':'#FDFAF6', cursor:'pointer' }}>
                  <span style={{ fontSize:'10px', color:'#9E8E6E', fontFamily:'monospace', fontWeight:600 }}>{n.id}</span>
                  <div>
                    <div style={{ fontSize:'12px', fontWeight:700, color:'#1A1A2E' }}>{n.title}</div>
                    <div style={{ fontSize:'10px', color:'#9E8E6E', marginTop:'1px' }}>{n.body.slice(0,40)}...</div>
                  </div>
                  <span style={{ fontSize:'9px', fontWeight:800, background:cc.bg, color:cc.color, border:`1px solid ${cc.border}`, padding:'2px 5px', display:'inline-block' }}>{n.channel}</span>
                  <span style={{ fontSize:'10px', color:'#6B5E3E' }}>{n.target}{n.state?` — ${n.state}`:''}</span>
                  <span style={{ fontSize:'10px', color:'#9E8E6E' }}>{n.sentBy.split(' ')[0]}</span>
                  <span style={{ fontSize:'11px', fontWeight:700, color:'#B8960C' }}>{n.reach>0?n.reach.toLocaleString('en-IN'):'—'}</span>
                  <span style={{ fontSize:'11px', fontWeight:700, color:'#059669' }}>{n.delivered>0?n.delivered.toLocaleString('en-IN'):'—'}</span>
                  <span style={{ fontSize:'11px', fontWeight:700, color:n.failed>0?'#DC2626':'#9E8E6E' }}>{n.failed>0?n.failed:'—'}</span>
                  <span style={{ fontSize:'9px', fontWeight:800, background:sc.bg, color:sc.color, padding:'2px 5px', display:'inline-block' }}>{n.status}</span>
                  <span style={{ fontSize:'10px', color:'#9E8E6E' }}>{n.sentAt?.split(' ')[0]||n.scheduledAt?.split(' ')[0]||'Draft'}</span>
                </div>
              )
            })
          }
          <div style={{ padding:'12px 14px', borderTop:'1px solid #E8DFD0', display:'flex', justifyContent:'space-between', alignItems:'center', background:'#FDFAF6' }}>
            <span style={{ fontSize:'11px', color:'#9E8E6E' }}>Showing {filtered.length===0?0:((page-1)*PER_PAGE)+1}–{Math.min(page*PER_PAGE,filtered.length)} of {filtered.length}</span>
            <div style={{ display:'flex', gap:'4px' }}>
              <button onClick={()=>setPage(p=>Math.max(1,p-1))} disabled={page===1}
                style={{ background:page===1?'#F5F0E8':'#1A1A2E', color:page===1?'#C4B49A':'#fff', border:'1px solid #D4C9B0', padding:'5px 10px', fontSize:'11px', fontWeight:700, cursor:page===1?'not-allowed':'pointer' }}>← PREV</button>
              {Array.from({length:totalPages},(_,i)=>i+1).map(p=>(
                <button key={p} onClick={()=>setPage(p)} style={{ background:p===page?'#B8960C':'#fff', color:p===page?'#fff':'#6B5E3E', border:'1px solid #D4C9B0', padding:'5px 10px', fontSize:'11px', fontWeight:700, cursor:'pointer' }}>{p}</button>
              ))}
              <button onClick={()=>setPage(p=>Math.min(totalPages,p+1))} disabled={page===totalPages||totalPages===0}
                style={{ background:(page===totalPages||totalPages===0)?'#F5F0E8':'#1A1A2E', color:(page===totalPages||totalPages===0)?'#C4B49A':'#fff', border:'1px solid #D4C9B0', padding:'5px 10px', fontSize:'11px', fontWeight:700, cursor:(page===totalPages||totalPages===0)?'not-allowed':'pointer' }}>NEXT →</button>
            </div>
          </div>
        </BCard>
      </div>

      <div style={{ background:'#0D1B2A', borderTop:'2px solid #B8960C', padding:'10px 20px', display:'flex', justifyContent:'space-between', marginTop:'14px' }}>
        <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.3)' }}>ZEMISH NOTIFICATION CENTER v1.0.0</span>
        <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.3)' }}>NATIONAL COMMAND CENTER</span>
      </div>

      {compose && <ComposeModal onSend={handleSend} onDraft={handleDraft} onCancel={()=>setCompose(false)} adminLevel={adminLevel}/>}
      {drawer && <DetailDrawer notif={drawer} onClose={()=>setDrawer(null)} onRetry={handleRetry} onEditSchedule={handleEditSchedule} onCancelSchedule={handleCancelSchedule} navigate={navigate}/>}
    </div>
  )
}