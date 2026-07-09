import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FONTS } from '../../config/brand'
import useAuthStore from '../../store/authStore'

const ADMIN_LEVELS = { SUPER_ADMIN:'SUPER_ADMIN', INDIA_ADMIN:'INDIA_ADMIN', STATE_ADMIN:'STATE_ADMIN', DISTRICT_ADMIN:'DISTRICT_ADMIN' }

// Only SUPER_ADMIN can edit settings
const canEdit = (l) => l === ADMIN_LEVELS.SUPER_ADMIN

const INITIAL_SETTINGS = {
  platform: {
    name:        'Zemish Barber Engine',
    version:     'v1.0.0',
    env:         'PRODUCTION',
    supportEmail:'support@zemish.in',
    supportPhone:'1800-123-4567',
    website:     'https://zemish.in',
    timezone:    'Asia/Kolkata',
    currency:    'INR',
    language:    'en-IN',
  },
  business: {
    commissionRate:     10,
    minBookingAmount:   50,
    maxBookingAmount:   5000,
    refundWindowDays:   7,
    kycRequiredAbove:   0,
    maxSalonsPerProvider: 10,
    autoSettlementDays: 2,
    cancellationWindow: 30,
  },
  security: {
    sessionTimeoutMin:     60,
    maxLoginAttempts:       5,
    lockoutDurationMin:    30,
    requireMFA:          false,
    allowedIPs:           'ALL',
    passwordExpiryDays:   90,
    auditLogRetentionDays:365,
  },
  notifications: {
    enablePush:   true,
    enableSMS:    true,
    enableEmail:  true,
    enableInApp:  true,
    smsProvider:  'Twilio',
    emailProvider:'SendGrid',
    pushProvider: 'Firebase',
  },
  maintenance: {
    maintenanceMode: false,
    maintenanceMsg:  'Platform is under maintenance. We\'ll be back shortly.',
    allowAdminAccess:true,
    scheduledAt:     '',
  },
}

const TABS = ['platform','business','security','notifications','maintenance']
const TAB_LABELS = {
  platform:'Platform', business:'Business Rules',
  security:'Security', notifications:'Notifications',
  maintenance:'Maintenance',
}
const TAB_ICONS = {
  platform:'🏢', business:'📊', security:'🔒',
  notifications:'🔔', maintenance:'🔧',
}

const BCard = ({ children, style={} }) => (
  <div style={{ background:'#fff', border:'1px solid #D4C9B0', borderTop:'2px solid #B8960C', ...style }}>{children}</div>
)
const BCardHeader = ({ title, desc, action }) => (
  <div style={{ padding:'12px 16px', borderBottom:'1px solid #E8DFD0', display:'flex', justifyContent:'space-between', alignItems:'center', background:'#FDFAF6' }}>
    <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
      <div style={{ width:'3px', height:'14px', background:'#B8960C' }}/>
      <div>
        <div style={{ fontSize:'11px', fontWeight:800, color:'#1A1A2E', letterSpacing:'1px', textTransform:'uppercase' }}>{title}</div>
        {desc && <div style={{ fontSize:'10px', color:'#9E8E6E', marginTop:'1px' }}>{desc}</div>}
      </div>
    </div>
    {action}
  </div>
)

function Field({ label, desc, type='text', value, onChange, disabled, options, min, max, unit }) {
  return (
    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', alignItems:'center', padding:'10px 0', borderBottom:'1px solid #F0EAE0', gap:'12px' }}>
      <div>
        <div style={{ fontSize:'12px', fontWeight:600, color:'#1A1A2E' }}>{label}</div>
        {desc && <div style={{ fontSize:'10px', color:'#9E8E6E', marginTop:'2px' }}>{desc}</div>}
      </div>
      <div style={{ display:'flex', alignItems:'center', gap:'6px' }}>
        {type==='toggle' ? (
          <div onClick={disabled?undefined:()=>onChange(!value)}
            style={{ width:'40px', height:'22px', background:value?'#059669':'#D4C9B0', position:'relative', cursor:disabled?'not-allowed':'pointer', opacity:disabled?0.5:1 }}>
            <div style={{ width:'18px', height:'18px', background:'#fff', position:'absolute', top:'2px', left:value?'20px':'2px', transition:'left 0.2s' }}/>
          </div>
        ) : type==='select' ? (
          <select value={value} onChange={e=>onChange(e.target.value)} disabled={disabled}
            style={{ flex:1, border:'1px solid #D4C9B0', padding:'6px 8px', fontSize:'12px', fontFamily:FONTS.body, outline:'none', background:disabled?'#F5F0E8':'#fff', cursor:disabled?'not-allowed':'pointer' }}>
            {options.map(o=><option key={o}>{o}</option>)}
          </select>
        ) : (
          <div style={{ display:'flex', alignItems:'center', gap:'4px', flex:1 }}>
            <input type={type} value={value} onChange={e=>onChange(type==='number'?Number(e.target.value):e.target.value)}
              min={min} max={max} disabled={disabled}
              style={{ flex:1, border:'1px solid #D4C9B0', padding:'6px 10px', fontSize:'12px', fontFamily:FONTS.body, outline:'none', background:disabled?'#F5F0E8':'#fff', cursor:disabled?'not-allowed':'text' }}/>
            {unit && <span style={{ fontSize:'11px', color:'#9E8E6E', whiteSpace:'nowrap' }}>{unit}</span>}
          </div>
        )}
      </div>
    </div>
  )
}

export default function SettingsPage() {
  const navigate    = useNavigate()
  const admin       = useAuthStore(s=>s.admin)
  const adminLevel  = admin?.adminLevel||ADMIN_LEVELS.SUPER_ADMIN
  const isSuper     = canEdit(adminLevel)

  const [tab,      setTab]      = useState('platform')
  const [settings, setSettings] = useState(INITIAL_SETTINGS)
  const [unsaved,  setUnsaved]  = useState(false)
  const [toast,    setToast]    = useState(null)
  const [confirmMaint, setConfirmMaint] = useState(false)

  const showToast = (msg,color) => { setToast({msg,color}); setTimeout(()=>setToast(null),3000) }

  const set = (section, key, val) => {
    setSettings(s=>({ ...s, [section]:{ ...s[section], [key]:val } }))
    setUnsaved(true)
  }

  const handleSave = () => {
    // TODO backend: await api.put('/admin/settings', settings)
    setUnsaved(false)
    showToast('✓ Settings saved — Audit log updated', '#059669')
  }

  const handleReset = () => {
    setSettings(INITIAL_SETTINGS)
    setUnsaved(false)
    showToast('↺ Settings reset to defaults', '#D97706')
  }

  const handleMaintenance = () => {
    set('maintenance','maintenanceMode',!settings.maintenance.maintenanceMode)
    setConfirmMaint(false)
    showToast(settings.maintenance.maintenanceMode?'✓ Maintenance mode OFF':'⚠ Maintenance mode ON',
      settings.maintenance.maintenanceMode?'#059669':'#DC2626')
  }

  const s = settings

  return (
    <div style={{ fontFamily:FONTS.body, background:'#F0EAE0', minHeight:'100vh' }}>
      {toast && <div style={{ position:'fixed', top:'20px', right:'20px', background:toast.color, color:'#fff', padding:'12px 20px', fontSize:'13px', fontWeight:700, zIndex:9999, boxShadow:'0 4px 12px rgba(0,0,0,0.2)' }}>{toast.msg}</div>}

      {/* Header */}
      <div style={{ background:'#0D1B2A', borderBottom:'2px solid #B8960C', padding:'0 20px', height:'52px', display:'flex', alignItems:'center', justifyContent:'space-between', position:'sticky', top:0, zIndex:10 }}>
        <div style={{ display:'flex', alignItems:'center', gap:'12px' }}>
          <div style={{ width:'3px', height:'16px', background:'#B8960C' }}/>
          <h1 style={{ fontSize:'13px', fontWeight:800, color:'#fff', margin:0, letterSpacing:'2px', textTransform:'uppercase' }}>System Settings</h1>
          <span style={{ background:'rgba(184,150,12,0.2)', color:'#B8960C', fontSize:'10px', fontWeight:800, padding:'2px 8px', border:'1px solid rgba(184,150,12,0.3)' }}>v1.0.0</span>
          {!isSuper && <span style={{ background:'rgba(220,38,38,0.2)', color:'#FCA5A5', fontSize:'10px', fontWeight:700, padding:'2px 8px' }}>🔒 VIEW ONLY</span>}
          {s.maintenance.maintenanceMode && <span style={{ background:'#DC2626', color:'#fff', fontSize:'10px', fontWeight:800, padding:'2px 8px' }}>⚠ MAINTENANCE MODE ON</span>}
          {unsaved && <span style={{ background:'#D97706', color:'#fff', fontSize:'10px', fontWeight:800, padding:'2px 8px' }}>● UNSAVED</span>}
        </div>
        <div style={{ display:'flex', gap:'8px' }}>
          {isSuper && unsaved && (
            <>
              <button onClick={handleReset} style={{ background:'transparent', border:'1px solid rgba(220,38,38,0.5)', color:'#FCA5A5', padding:'6px 12px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>↺ RESET</button>
              <button onClick={handleSave} style={{ background:'#B8960C', border:'none', color:'#0D1B2A', padding:'6px 14px', fontSize:'10px', fontWeight:800, cursor:'pointer' }}>✓ SAVE SETTINGS</button>
            </>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div style={{ background:'#0A1520', borderBottom:'1px solid rgba(184,150,12,0.2)', display:'flex', padding:'0 20px', overflowX:'auto' }}>
        {TABS.map(t=>(
          <button key={t} onClick={()=>setTab(t)} style={{ padding:'10px 18px', border:'none', background:'none', cursor:'pointer', fontSize:'10px', fontWeight:tab===t?800:400, color:tab===t?'#B8960C':'rgba(255,255,255,0.35)', borderBottom:tab===t?'2px solid #B8960C':'2px solid transparent', letterSpacing:'1.5px', textTransform:'uppercase', whiteSpace:'nowrap' }}>
            {TAB_ICONS[t]} {TAB_LABELS[t]}
          </button>
        ))}
      </div>

      {/* Access Banner for non-Super */}
      {!isSuper && (
        <div style={{ background:'#FFFBEB', borderBottom:'1px solid #FDE68A', padding:'8px 20px', fontSize:'11px', color:'#92400E', fontWeight:600 }}>
          👁 View Only — Only SUPER_ADMIN can modify system settings.
        </div>
      )}

      <div style={{ padding:'16px 20px' }}>

        {/* PLATFORM */}
        {tab==='platform' && (
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'14px' }}>
            <BCard>
              <BCardHeader title="Platform Identity" desc="Core platform information"/>
              <div style={{ padding:'14px' }}>
                <Field label="Platform Name"    desc="Displayed in headers and emails" value={s.platform.name}        onChange={v=>set('platform','name',v)}        disabled={!isSuper}/>
                <Field label="Version"          desc="Current platform version"        value={s.platform.version}     onChange={v=>set('platform','version',v)}     disabled={true}/>
                <Field label="Environment"      desc="Deployment environment"          value={s.platform.env}         onChange={v=>set('platform','env',v)}         disabled={true} type="select" options={['PRODUCTION','STAGING','DEVELOPMENT']}/>
                <Field label="Support Email"    desc="Customer support email"          value={s.platform.supportEmail}onChange={v=>set('platform','supportEmail',v)} disabled={!isSuper} type="email"/>
                <Field label="Support Phone"    desc="Toll-free support number"        value={s.platform.supportPhone}onChange={v=>set('platform','supportPhone',v)} disabled={!isSuper}/>
                <Field label="Website"          desc="Public website URL"             value={s.platform.website}     onChange={v=>set('platform','website',v)}     disabled={!isSuper}/>
              </div>
            </BCard>
            <BCard>
              <BCardHeader title="Locale Settings" desc="Regional configuration"/>
              <div style={{ padding:'14px' }}>
                <Field label="Timezone" value={s.platform.timezone} onChange={v=>set('platform','timezone',v)} disabled={!isSuper} type="select" options={['Asia/Kolkata','UTC','Asia/Dubai']}/>
                <Field label="Currency" value={s.platform.currency} onChange={v=>set('platform','currency',v)} disabled={!isSuper} type="select" options={['INR','USD','AED']}/>
                <Field label="Language" value={s.platform.language} onChange={v=>set('platform','language',v)} disabled={!isSuper} type="select" options={['en-IN','hi-IN','en-US']}/>
                <div style={{ marginTop:'14px', padding:'12px', background:'#F0FDF4', border:'1px solid #D1FAE5', borderLeft:'3px solid #059669' }}>
                  <div style={{ fontSize:'10px', fontWeight:800, color:'#065F46', marginBottom:'4px' }}>SYSTEM STATUS</div>
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'8px', marginTop:'8px' }}>
                    {[
                      { label:'API',       status:'ONLINE',  color:'#059669' },
                      { label:'Database',  status:'ONLINE',  color:'#059669' },
                      { label:'Gateway',   status:'ONLINE',  color:'#059669' },
                      { label:'Storage',   status:'ONLINE',  color:'#059669' },
                    ].map(x=>(
                      <div key={x.label} style={{ display:'flex', justifyContent:'space-between', fontSize:'11px' }}>
                        <span style={{ color:'#9E8E6E' }}>{x.label}</span>
                        <span style={{ color:x.color, fontWeight:700 }}>● {x.status}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </BCard>
          </div>
        )}

        {/* BUSINESS */}
        {tab==='business' && (
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'14px' }}>
            <BCard>
              <BCardHeader title="Commission & Fees" desc="Revenue configuration"/>
              <div style={{ padding:'14px' }}>
                <Field label="Commission Rate"       desc="% taken from each transaction"     value={s.business.commissionRate}    onChange={v=>set('business','commissionRate',v)}    disabled={!isSuper} type="number" min={0} max={100} unit="%"/>
                <Field label="Min Booking Amount"    desc="Minimum allowed booking value"     value={s.business.minBookingAmount}  onChange={v=>set('business','minBookingAmount',v)}  disabled={!isSuper} type="number" min={0} unit="₹"/>
                <Field label="Max Booking Amount"    desc="Maximum allowed booking value"     value={s.business.maxBookingAmount}  onChange={v=>set('business','maxBookingAmount',v)}  disabled={!isSuper} type="number" min={0} unit="₹"/>
                <Field label="Auto Settlement Days"  desc="Days after booking for settlement" value={s.business.autoSettlementDays}onChange={v=>set('business','autoSettlementDays',v)} disabled={!isSuper} type="number" min={1} max={30} unit="days"/>
              </div>
            </BCard>
            <BCard>
              <BCardHeader title="Operational Rules" desc="Platform behaviour settings"/>
              <div style={{ padding:'14px' }}>
                <Field label="Refund Window"          desc="Days customer can request refund"     value={s.business.refundWindowDays}      onChange={v=>set('business','refundWindowDays',v)}      disabled={!isSuper} type="number" min={1} max={30} unit="days"/>
                <Field label="Cancellation Window"    desc="Minutes before booking to cancel"    value={s.business.cancellationWindow}    onChange={v=>set('business','cancellationWindow',v)}    disabled={!isSuper} type="number" min={0} unit="min"/>
                <Field label="Max Salons per Provider" desc="Provider can own max this many salons" value={s.business.maxSalonsPerProvider} onChange={v=>set('business','maxSalonsPerProvider',v)} disabled={!isSuper} type="number" min={1} unit="salons"/>
                <Field label="KYC Required Above"     desc="Mandatory KYC above this booking ₹" value={s.business.kycRequiredAbove}      onChange={v=>set('business','kycRequiredAbove',v)}      disabled={!isSuper} type="number" min={0} unit="₹"/>
              </div>
            </BCard>
          </div>
        )}

        {/* SECURITY */}
        {tab==='security' && (
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'14px' }}>
            <BCard>
              <BCardHeader title="Session & Login" desc="Authentication settings"/>
              <div style={{ padding:'14px' }}>
                <Field label="Session Timeout"       desc="Auto logout after inactivity"     value={s.security.sessionTimeoutMin}    onChange={v=>set('security','sessionTimeoutMin',v)}    disabled={!isSuper} type="number" min={5} unit="min"/>
                <Field label="Max Login Attempts"    desc="Before account lockout"           value={s.security.maxLoginAttempts}     onChange={v=>set('security','maxLoginAttempts',v)}     disabled={!isSuper} type="number" min={1} max={10}/>
                <Field label="Lockout Duration"      desc="Account lock period after failures" value={s.security.lockoutDurationMin} onChange={v=>set('security','lockoutDurationMin',v)} disabled={!isSuper} type="number" min={1} unit="min"/>
                <Field label="Password Expiry"       desc="Force password reset after days"   value={s.security.passwordExpiryDays} onChange={v=>set('security','passwordExpiryDays',v)} disabled={!isSuper} type="number" min={0} unit="days"/>
                <Field label="Require MFA"           desc="Mandatory two-factor authentication" value={s.security.requireMFA} onChange={v=>set('security','requireMFA',v)} disabled={!isSuper} type="toggle"/>
              </div>
            </BCard>
            <BCard>
              <BCardHeader title="Data & Compliance" desc="Audit and access settings"/>
              <div style={{ padding:'14px' }}>
                <Field label="Audit Log Retention"  desc="Days to keep audit records"        value={s.security.auditLogRetentionDays} onChange={v=>set('security','auditLogRetentionDays',v)} disabled={!isSuper} type="number" min={90} unit="days"/>
                <Field label="Allowed IPs"          desc="Restrict admin access by IP"       value={s.security.allowedIPs}            onChange={v=>set('security','allowedIPs',v)}            disabled={!isSuper}/>
                <div style={{ marginTop:'14px', padding:'12px', background:'#FEF2F2', border:'1px solid #FEE2E2', borderLeft:'3px solid #DC2626', fontSize:'11px', color:'#991B1B', fontWeight:600 }}>
                  ⚠ Security settings affect ALL admin accounts. Changes take effect immediately and are logged in the Audit Trail.
                </div>
                <div style={{ marginTop:'10px', padding:'10px', background:'#F0FDF4', border:'1px solid #D1FAE5', fontSize:'11px', color:'#065F46', fontWeight:600 }}>
                  ✓ All admin sessions are encrypted (TLS 1.3). Passwords hashed with bcrypt.
                </div>
              </div>
            </BCard>
          </div>
        )}

        {/* NOTIFICATIONS */}
        {tab==='notifications' && (
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'14px' }}>
            <BCard>
              <BCardHeader title="Channel Status" desc="Enable/disable notification channels"/>
              <div style={{ padding:'14px' }}>
                <Field label="Push Notifications" desc="Mobile push via Firebase"  value={s.notifications.enablePush}  onChange={v=>set('notifications','enablePush',v)}  disabled={!isSuper} type="toggle"/>
                <Field label="SMS Notifications"  desc="Text messages via Twilio"  value={s.notifications.enableSMS}   onChange={v=>set('notifications','enableSMS',v)}   disabled={!isSuper} type="toggle"/>
                <Field label="Email Notifications"desc="Emails via SendGrid"       value={s.notifications.enableEmail} onChange={v=>set('notifications','enableEmail',v)} disabled={!isSuper} type="toggle"/>
                <Field label="In-App Alerts"      desc="In-app notification center" value={s.notifications.enableInApp} onChange={v=>set('notifications','enableInApp',v)} disabled={!isSuper} type="toggle"/>
              </div>
            </BCard>
            <BCard>
              <BCardHeader title="Service Providers" desc="Third-party notification providers"/>
              <div style={{ padding:'14px' }}>
                <Field label="Push Provider"  value={s.notifications.pushProvider}  onChange={v=>set('notifications','pushProvider',v)}  disabled={!isSuper} type="select" options={['Firebase','OneSignal','AWS SNS']}/>
                <Field label="SMS Provider"   value={s.notifications.smsProvider}   onChange={v=>set('notifications','smsProvider',v)}   disabled={!isSuper} type="select" options={['Twilio','AWS SNS','MSG91']}/>
                <Field label="Email Provider" value={s.notifications.emailProvider} onChange={v=>set('notifications','emailProvider',v)} disabled={!isSuper} type="select" options={['SendGrid','Mailgun','AWS SES']}/>
                <div style={{ marginTop:'14px', padding:'10px', background:'#EFF6FF', border:'1px solid #BFDBFE', fontSize:'11px', color:'#1D4ED8', fontWeight:600 }}>
                  ℹ Provider credentials are configured via environment variables. Contact DevOps to change API keys.
                </div>
              </div>
            </BCard>
          </div>
        )}

        {/* MAINTENANCE */}
        {tab==='maintenance' && (
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'14px' }}>
            <BCard>
              <BCardHeader title="Maintenance Mode" desc="Platform availability control" action={
                isSuper && (
                  <button onClick={()=>setConfirmMaint(true)}
                    style={{ background:s.maintenance.maintenanceMode?'#059669':'#DC2626', color:'#fff', border:'none', padding:'6px 14px', fontSize:'10px', fontWeight:800, cursor:'pointer' }}>
                    {s.maintenance.maintenanceMode?'✓ DISABLE':'⚠ ENABLE'}
                  </button>
                )
              }/>
              <div style={{ padding:'14px' }}>
                <div style={{ padding:'14px', background:s.maintenance.maintenanceMode?'#FEF2F2':'#F0FDF4', border:`1px solid ${s.maintenance.maintenanceMode?'#FEE2E2':'#D1FAE5'}`, borderTop:`3px solid ${s.maintenance.maintenanceMode?'#DC2626':'#059669'}`, textAlign:'center', marginBottom:'14px' }}>
                  <div style={{ fontSize:'32px', marginBottom:'8px' }}>{s.maintenance.maintenanceMode?'🔴':'🟢'}</div>
                  <div style={{ fontSize:'16px', fontWeight:800, color:s.maintenance.maintenanceMode?'#991B1B':'#065F46' }}>
                    {s.maintenance.maintenanceMode?'MAINTENANCE MODE ACTIVE':'PLATFORM OPERATIONAL'}
                  </div>
                  <div style={{ fontSize:'11px', color:'#9E8E6E', marginTop:'4px' }}>
                    {s.maintenance.maintenanceMode?'Users cannot access the platform':'All services running normally'}
                  </div>
                </div>
                <Field label="Maintenance Message" desc="Shown to users during maintenance" value={s.maintenance.maintenanceMsg}    onChange={v=>set('maintenance','maintenanceMsg',v)}    disabled={!isSuper}/>
                <Field label="Allow Admin Access"  desc="Admins can still login"            value={s.maintenance.allowAdminAccess} onChange={v=>set('maintenance','allowAdminAccess',v)} disabled={!isSuper} type="toggle"/>
                <Field label="Scheduled At"        desc="Auto-enable maintenance (optional)" value={s.maintenance.scheduledAt}     onChange={v=>set('maintenance','scheduledAt',v)}     disabled={!isSuper} type="datetime-local"/>
              </div>
            </BCard>
            <BCard>
              <BCardHeader title="System Health"/>
              <div style={{ padding:'14px' }}>
                {[
                  { name:'API Server',    status:'ONLINE',  uptime:'99.9%',  color:'#059669' },
                  { name:'Database',      status:'ONLINE',  uptime:'99.8%',  color:'#059669' },
                  { name:'Payment Gateway',status:'ONLINE', uptime:'99.7%',  color:'#059669' },
                  { name:'File Storage',  status:'ONLINE',  uptime:'100%',   color:'#059669' },
                  { name:'SMS Gateway',   status:'ONLINE',  uptime:'98.9%',  color:'#059669' },
                  { name:'Push Service',  status:'DEGRADED',uptime:'94.2%',  color:'#D97706' },
                  { name:'Email Service', status:'ONLINE',  uptime:'99.5%',  color:'#059669' },
                  { name:'Cache Layer',   status:'ONLINE',  uptime:'99.9%',  color:'#059669' },
                ].map((svc,i)=>(
                  <div key={svc.name} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'9px 0', borderBottom:'1px solid #F0EAE0' }}>
                    <span style={{ fontSize:'12px', color:'#1A1A2E', fontWeight:500 }}>{svc.name}</span>
                    <div style={{ display:'flex', gap:'12px', alignItems:'center' }}>
                      <span style={{ fontSize:'10px', color:'#9E8E6E' }}>{svc.uptime}</span>
                      <span style={{ fontSize:'10px', fontWeight:800, color:svc.color }}>● {svc.status}</span>
                    </div>
                  </div>
                ))}
                <div style={{ marginTop:'12px', padding:'10px', background:'#FFFBEB', border:'1px solid #FDE68A', fontSize:'11px', color:'#92400E', fontWeight:600 }}>
                  ⚠ Push Service degraded — Firebase latency elevated. Engineering team notified.
                </div>
              </div>
            </BCard>
          </div>
        )}

      </div>

      <div style={{ background:'#0D1B2A', borderTop:'2px solid #B8960C', padding:'10px 20px', display:'flex', justifyContent:'space-between', marginTop:'14px' }}>
        <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.3)' }}>ZEMISH SYSTEM SETTINGS v1.0.0</span>
        <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.3)' }}>NATIONAL COMMAND CENTER</span>
      </div>

      {/* Maintenance Confirm Modal */}
      {confirmMaint && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.75)', zIndex:2000, display:'flex', alignItems:'center', justifyContent:'center' }}>
          <div style={{ background:'#fff', width:'440px', border:`2px solid ${s.maintenance.maintenanceMode?'#059669':'#DC2626'}` }}>
            <div style={{ background:s.maintenance.maintenanceMode?'#064E3B':'#7F1D1D', padding:'14px 18px', borderBottom:`2px solid ${s.maintenance.maintenanceMode?'#059669':'#DC2626'}` }}>
              <div style={{ color:'#fff', fontWeight:800, fontSize:'13px' }}>{s.maintenance.maintenanceMode?'✓ DISABLE MAINTENANCE MODE':'⚠ ENABLE MAINTENANCE MODE'}</div>
            </div>
            <div style={{ padding:'20px' }}>
              <div style={{ padding:'12px', background:s.maintenance.maintenanceMode?'#F0FDF4':'#FEF2F2', border:`1px solid ${s.maintenance.maintenanceMode?'#D1FAE5':'#FEE2E2'}`, marginBottom:'16px', fontSize:'12px', color:s.maintenance.maintenanceMode?'#065F46':'#991B1B', fontWeight:600 }}>
                {s.maintenance.maintenanceMode
                  ?'✓ Platform will resume normal operations immediately.'
                  :'⚠ ALL users (except admins) will lose access immediately. Active bookings may be affected.'}
              </div>
              <div style={{ display:'flex', gap:'8px', justifyContent:'flex-end' }}>
                <button onClick={()=>setConfirmMaint(false)} style={{ background:'#fff', border:'1px solid #D4C9B0', color:'#6B5E3E', padding:'8px 16px', fontSize:'11px', fontWeight:700, cursor:'pointer' }}>CANCEL</button>
                <button onClick={handleMaintenance} style={{ background:s.maintenance.maintenanceMode?'#059669':'#DC2626', color:'#fff', border:'none', padding:'8px 20px', fontSize:'11px', fontWeight:800, cursor:'pointer' }}>
                  {s.maintenance.maintenanceMode?'✓ CONFIRM DISABLE':'⚠ CONFIRM ENABLE'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}