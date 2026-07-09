import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { BRAND, COLORS, FONTS, SHADOW } from '../../config/brand'
import ENV from '../../config/env'
import useAuthStore from '../../store/authStore'

export default function LoginPage() {
  const navigate   = useNavigate()
  const location   = useLocation()
  const setSession = useAuthStore(s => s.setSession)

  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [adminKey, setAdminKey] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [showKey,  setShowKey]  = useState(false)
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState('')

  const from = location.state?.from?.pathname || '/app/dashboard'

  const handleLogin = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      //////////////////////////////////////////////////////
      // STEP 1 — Login → get accessToken
      //////////////////////////////////////////////////////
      const loginRes  = await fetch(`${ENV.API_URL}/api/admin-auth/login`, {
        method:      'POST',
        headers:     { 'Content-Type': 'application/json' },
        credentials: 'include',
        body:        JSON.stringify({ email, password, adminKey }),
      })
      const loginData = await loginRes.json()

      if (!loginRes.ok || !loginData.success || !loginData.data?.accessToken)  {
        setError(loginData.message || 'Invalid credentials')
        return
      }

      //////////////////////////////////////////////////////
      // STEP 2 — /api/admin/me try karo (optional)
      // Fail hone par loginData se fallback
      //////////////////////////////////////////////////////
      let permissions = Array.isArray(loginData.data.permissions)
        ? loginData.data.permissions
        : []
      let adminData = loginData.data.admin
      let scope = loginData.data.scope || null

      try {
        const meRes  = await fetch(`${ENV.API_URL}/api/admin-auth/me`, {
          headers:     { 'Authorization': `Bearer ${loginData.data.accessToken}` },
          credentials: 'include',
        })
        const meData = await meRes.json()  // ✅ ADD THIS LINE
        if (meRes.ok && meData.success && meData.data) {
          adminData   = meData.data
          permissions = Array.isArray(meData.data.permissions) ? meData.data.permissions : []
          scope = {
            countryRef:  meData.data.countryRef  || null,
            stateRef:    meData.data.stateRef    || null,
            districtRef: meData.data.districtRef || null,
            cityRef:     meData.data.cityRef     || null,
          }
        }
      } catch {
        // /api/admin/me nahi hai — loginData fallback use hoga
      }

      //////////////////////////////////////////////////////
      // STEP 3 — Session store karo
      //////////////////////////////////////////////////////
      setSession({
        token:       loginData.data.accessToken,
        admin:       adminData,
        permissions: permissions,
        scope:       scope,
      })

      navigate(from, { replace: true })

    } catch {
      setError('Server error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ ...s.page, background: COLORS.bg, fontFamily: FONTS.body }}>
      <div style={{ ...s.watermark, color: COLORS.watermark, fontFamily: FONTS.heading }}>
        {BRAND.name.toUpperCase()}
      </div>

      <div style={{ ...s.wrapper, boxShadow: SHADOW.lg }}>

        {/* LEFT — Brand Panel */}
        <div style={{ ...s.left, background: COLORS.navy }}>
          <div style={s.leftContent}>
            <div style={{ ...s.logoBox, borderColor: COLORS.goldBorder }}>
              <svg width="44" height="44" viewBox="0 0 48 48" fill="none">
                <path d="M8 10H40L10 38H42" stroke={COLORS.gold} strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <h1 style={{ ...s.brand, color: COLORS.textWhite, fontFamily: FONTS.heading }}>
              {BRAND.name.toUpperCase()}
            </h1>
            <div style={{ ...s.goldLine, background: COLORS.gold }} />
            <p style={{ ...s.tagline, color: COLORS.textWhiteSub }}>{BRAND.tagline}</p>
            <div style={s.statsRow}>
              {[
                { num: '21+', label: 'Modules' },
                { num: '4',   label: 'Admin Roles' },
                { num: 'PAN', label: 'India Scale' },
              ].map((stat, i, arr) => (
                <div key={stat.label} style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
                  <div style={s.stat}>
                    <div style={{ ...s.statNum, color: COLORS.gold }}>{stat.num}</div>
                    <div style={{ ...s.statLabel, color: COLORS.textWhiteMuted }}>{stat.label}</div>
                  </div>
                  {i < arr.length - 1 && <div style={{ ...s.statDivider, background: 'rgba(255,255,255,0.1)' }} />}
                </div>
              ))}
            </div>
          </div>
          <div style={{ ...s.leftFooter, color: COLORS.textWhiteMuted }}>
            <span>{BRAND.version}</span><span>•</span><span>{BRAND.sub}</span>
          </div>
        </div>

        {/* RIGHT — Login Form */}
        <div style={s.right}>
          <div style={s.formWrap}>
            <div style={{ marginBottom: '28px' }}>
              <h2 style={{ ...s.welcome, color: COLORS.navy, fontFamily: FONTS.heading }}>Welcome Back</h2>
              <p style={{ ...s.welcomeSub, color: COLORS.textMuted }}>Sign in to access the {BRAND.sub}</p>
            </div>

            <form onSubmit={handleLogin} style={s.form}>
              {error && (
                <div style={{ ...s.errorBox, background: COLORS.dangerBg, color: COLORS.danger }}>
                  ⚠ {error}
                </div>
              )}

              {/* Email */}
              <div style={s.field}>
                <label style={{ ...s.label, color: COLORS.textMuted }}>ADMIN EMAIL</label>
                <div style={s.inputWrap}>
                  <svg style={s.inputIcon} width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={COLORS.textMuted} strokeWidth="1.5" strokeLinecap="round">
                    <path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2z"/>
                    <polyline points="22,6 12,13 2,6"/>
                  </svg>
                  <input
                    style={{ ...s.input, border: `1px solid ${COLORS.border}`, background: COLORS.surfaceAlt, color: COLORS.text }}
                    type="email" placeholder="admin@barberapp.com"
                    value={email} onChange={e => setEmail(e.target.value)} required
                  />
                </div>
              </div>

              {/* Password */}
              <div style={s.field}>
                <label style={{ ...s.label, color: COLORS.textMuted }}>PASSWORD</label>
                <div style={s.inputWrap}>
                  <svg style={s.inputIcon} width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={COLORS.textMuted} strokeWidth="1.5" strokeLinecap="round">
                    <rect x="3" y="11" width="18" height="11" rx="2"/>
                    <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                  </svg>
                  <input
                    style={{ ...s.input, paddingRight: '44px', border: `1px solid ${COLORS.border}`, background: COLORS.surfaceAlt, color: COLORS.text }}
                    type={showPass ? 'text' : 'password'} placeholder="••••••••••"
                    value={password} onChange={e => setPassword(e.target.value)} required
                  />
                  <button type="button" style={s.eyeBtn} onClick={() => setShowPass(p => !p)}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={COLORS.textMuted} strokeWidth="1.5" strokeLinecap="round">
                      {showPass
                        ? <><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></>
                        : <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></>
                      }
                    </svg>
                  </button>
                </div>
              </div>

              {/* Admin Key */}
              <div style={s.field}>
                <label style={{ ...s.label, color: COLORS.textMuted }}>ADMIN SECRET KEY</label>
                <div style={s.inputWrap}>
                  <svg style={s.inputIcon} width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={COLORS.textMuted} strokeWidth="1.5" strokeLinecap="round">
                    <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>
                  </svg>
                  <input
                    style={{ ...s.input, paddingRight: '44px', border: `1px solid ${COLORS.border}`, background: COLORS.surfaceAlt, color: COLORS.text }}
                    type={showKey ? 'text' : 'password'} placeholder="Enter admin secret key"
                    value={adminKey} onChange={e => setAdminKey(e.target.value)} required
                  />
                  <button type="button" style={s.eyeBtn} onClick={() => setShowKey(p => !p)}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={COLORS.textMuted} strokeWidth="1.5" strokeLinecap="round">
                      {showKey
                        ? <><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></>
                        : <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></>
                      }
                    </svg>
                  </button>
                </div>
              </div>

              <button
                style={{ ...s.btn, background: loading ? COLORS.navyLight : COLORS.navy }}
                type="submit" disabled={loading}
              >
                {loading ? 'Authenticating...' : 'Sign In to Command Center'}
              </button>
            </form>

            <p style={{ ...s.footer, color: COLORS.textLight }}>{BRAND.copy}</p>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes fadeIn { from { opacity:0; transform:translateY(20px) } to { opacity:1; transform:translateY(0) } }
        input::placeholder { color: ${COLORS.textLight}; font-size: 13px; }
        input:focus { outline: none; border-color: ${COLORS.gold} !important; background: #fff !important; }
      `}</style>
    </div>
  )
}

const s = {
  page:        { minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', position:'relative', overflow:'hidden' },
  watermark:   { position:'absolute', fontSize:'200px', fontWeight:800, letterSpacing:'-8px', userSelect:'none', pointerEvents:'none' },
  wrapper:     { display:'flex', width:'100%', maxWidth:'880px', background:'#fff', borderRadius:'4px', overflow:'hidden', position:'relative', animation:'fadeIn 0.6s ease forwards', margin:'24px' },
  left:        { width:'340px', flexShrink:0, display:'flex', flexDirection:'column', justifyContent:'space-between', padding:'48px 40px 32px' },
  leftContent: { display:'flex', flexDirection:'column', alignItems:'flex-start' },
  logoBox:     { width:'80px', height:'80px', border:'1.5px solid', borderRadius:'4px', display:'flex', alignItems:'center', justifyContent:'center', marginBottom:'24px', background:'rgba(255,255,255,0.05)', backdropFilter:'blur(12px)' },
  brand:       { fontSize:'32px', fontWeight:800, letterSpacing:'4px', margin:'0 0 12px' },
  goldLine:    { width:'40px', height:'1px', marginBottom:'16px' },
  tagline:     { fontSize:'13px', lineHeight:1.7, margin:'0 0 36px', fontWeight:400 },
  statsRow:    { display:'flex', alignItems:'center' },
  stat:        { textAlign:'center' },
  statNum:     { fontSize:'18px', fontWeight:700 },
  statLabel:   { fontSize:'10px', letterSpacing:'0.5px', marginTop:'3px', textTransform:'uppercase' },
  statDivider: { width:'1px', height:'32px' },
  leftFooter:  { display:'flex', gap:'8px', fontSize:'10px', letterSpacing:'0.5px' },
  right:       { flex:1, display:'flex', alignItems:'center', justifyContent:'center', padding:'48px 40px' },
  formWrap:    { width:'100%', maxWidth:'340px' },
  welcome:     { fontSize:'22px', fontWeight:700, margin:'0 0 6px' },
  welcomeSub:  { fontSize:'13px', margin:0, lineHeight:1.5 },
  form:        { display:'flex', flexDirection:'column', gap:'16px' },
  errorBox:    { padding:'10px 14px', borderRadius:'4px', fontSize:'13px', border:'1px solid #FEE2E2' },
  field:       { display:'flex', flexDirection:'column', gap:'6px' },
  label:       { fontSize:'10px', fontWeight:700, letterSpacing:'1px' },
  inputWrap:   { position:'relative', display:'flex', alignItems:'center' },
  inputIcon:   { position:'absolute', left:'13px', pointerEvents:'none' },
  input:       { width:'100%', padding:'11px 14px 11px 38px', borderRadius:'4px', fontSize:'14px', boxSizing:'border-box', transition:'border-color 0.2s', fontFamily:'inherit' },
  eyeBtn:      { position:'absolute', right:'12px', background:'none', border:'none', cursor:'pointer', display:'flex', alignItems:'center', padding:'4px' },
  btn:         { padding:'13px', color:'#fff', border:'none', borderRadius:'4px', fontSize:'14px', fontWeight:600, cursor:'pointer', letterSpacing:'0.3px', marginTop:'4px' },
  footer:      { textAlign:'center', fontSize:'11px', marginTop:'24px', marginBottom:0 },
}