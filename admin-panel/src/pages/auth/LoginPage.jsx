import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BRAND, COLORS, FONTS, SHADOW } from '../../config/brand'
import ENV from '../../config/env'

export default function LoginPage() {
  const navigate = useNavigate()
  const [phone,    setPhone]    = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(false)
  const [showPass, setShowPass] = useState(false)
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState('')

  const handleLogin = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const res  = await fetch(`${ENV.API_URL}/api/auth/admin/login`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ phone, password }),
      })
      const data = await res.json()
      if (data.accessToken) {
        localStorage.setItem('admin_token', data.accessToken)
        localStorage.setItem('admin_user',  JSON.stringify(data.admin))
        navigate('/app/dashboard')
      } else {
        setError(data.message || 'Invalid credentials')
      }
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
            <p style={{ ...s.tagline, color: COLORS.textWhiteSub }}>
              {BRAND.tagline}
            </p>
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
            <span>{BRAND.version}</span>
            <span>•</span>
            <span>{BRAND.sub}</span>
          </div>
        </div>

        {/* RIGHT — Login Form */}
        <div style={s.right}>
          <div style={s.formWrap}>
            <div style={{ marginBottom: '32px' }}>
              <h2 style={{ ...s.welcome, color: COLORS.navy, fontFamily: FONTS.heading }}>
                Welcome Back
              </h2>
              <p style={{ ...s.welcomeSub, color: COLORS.textMuted }}>
                Sign in to access the {BRAND.sub}
              </p>
            </div>

            <form onSubmit={handleLogin} style={s.form}>
              {error && (
                <div style={{ ...s.errorBox, background: COLORS.dangerBg, color: COLORS.danger }}>
                  ⚠ {error}
                </div>
              )}

              {/* Phone */}
              <div style={s.field}>
                <label style={{ ...s.label, color: COLORS.textMuted }}>MOBILE NUMBER</label>
                <div style={s.inputWrap}>
                  <svg style={s.inputIcon} width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={COLORS.textMuted} strokeWidth="1.5" strokeLinecap="round">
                    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 13a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.6 2.18h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>
                  </svg>
                  <input
                    style={{ ...s.input, border: `1px solid ${COLORS.border}`, background: COLORS.surfaceAlt, color: COLORS.text }}
                    type="tel"
                    placeholder="9548415653"
                    value={phone}
                    onChange={e => setPhone(e.target.value)}
                    required
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
                    type={showPass ? 'text' : 'password'}
                    placeholder="••••••••••"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    required
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

              <div style={s.rememberRow}>
                <label style={{ ...s.checkLabel, color: COLORS.textSub }}>
                  <input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)}
                    style={{ marginRight: '6px', accentColor: COLORS.gold }} />
                  Remember me
                </label>
                <a href="#" style={{ ...s.forgotLink, color: COLORS.gold }}>Forgot Password?</a>
              </div>

              <button
                style={{ ...s.btn, background: loading ? COLORS.navyLight : COLORS.navy }}
                type="submit"
                disabled={loading}
              >
                {loading ? 'Authenticating...' : 'Sign In to Command Center'}
              </button>
            </form>

            <p style={{ ...s.footer, color: COLORS.textLight }}>{BRAND.copy}</p>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(20px) }
          to   { opacity: 1; transform: translateY(0) }
        }
        input::placeholder { color: ${COLORS.textLight}; font-size: 13px; }
        input:focus { outline: none; border-color: ${COLORS.gold} !important; background: #fff !important; }
      `}</style>
    </div>
  )
}

const s = {
  page:        { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', overflow: 'hidden' },
  watermark:   { position: 'absolute', fontSize: '200px', fontWeight: 800, letterSpacing: '-8px', userSelect: 'none', pointerEvents: 'none' },
  wrapper:     { display: 'flex', width: '100%', maxWidth: '880px', background: '#fff', borderRadius: '4px', overflow: 'hidden', position: 'relative', animation: 'fadeIn 0.6s ease forwards', margin: '24px' },
  left:        { width: '340px', flexShrink: 0, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: '48px 40px 32px' },
  leftContent: { display: 'flex', flexDirection: 'column', alignItems: 'flex-start' },
  logoBox:     { width: '80px', height: '80px', border: '1.5px solid', borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '24px', background: 'rgba(255,255,255,0.05)', backdropFilter: 'blur(12px)' },
  brand:       { fontSize: '32px', fontWeight: 800, letterSpacing: '4px', margin: '0 0 12px' },
  goldLine:    { width: '40px', height: '1px', marginBottom: '16px' },
  tagline:     { fontSize: '14px', lineHeight: 1.7, margin: '0 0 40px', fontWeight: 400 },
  statsRow:    { display: 'flex', alignItems: 'center' },
  stat:        { textAlign: 'center' },
  statNum:     { fontSize: '18px', fontWeight: 700 },
  statLabel:   { fontSize: '10px', letterSpacing: '0.5px', marginTop: '3px', textTransform: 'uppercase' },
  statDivider: { width: '1px', height: '32px' },
  leftFooter:  { display: 'flex', gap: '8px', fontSize: '10px', letterSpacing: '0.5px' },
  right:       { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '48px 40px' },
  formWrap:    { width: '100%', maxWidth: '340px' },
  welcome:     { fontSize: '22px', fontWeight: 700, margin: '0 0 6px' },
  welcomeSub:  { fontSize: '13px', margin: 0, lineHeight: 1.5 },
  form:        { display: 'flex', flexDirection: 'column', gap: '18px' },
  errorBox:    { padding: '10px 14px', borderRadius: '4px', fontSize: '13px', border: '1px solid #FEE2E2' },
  field:       { display: 'flex', flexDirection: 'column', gap: '6px' },
  label:       { fontSize: '10px', fontWeight: 700, letterSpacing: '1px' },
  inputWrap:   { position: 'relative', display: 'flex', alignItems: 'center' },
  inputIcon:   { position: 'absolute', left: '13px', pointerEvents: 'none' },
  input:       { width: '100%', padding: '11px 14px 11px 38px', borderRadius: '4px', fontSize: '14px', boxSizing: 'border-box', transition: 'border-color 0.2s', fontFamily: 'inherit' },
  eyeBtn:      { position: 'absolute', right: '12px', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: '4px' },
  rememberRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  checkLabel:  { display: 'flex', alignItems: 'center', fontSize: '13px', cursor: 'pointer' },
  forgotLink:  { fontSize: '13px', fontWeight: 600, textDecoration: 'none' },
  btn:         { padding: '13px', color: '#fff', border: 'none', borderRadius: '4px', fontSize: '14px', fontWeight: 600, cursor: 'pointer', letterSpacing: '0.3px', marginTop: '4px' },
  footer:      { textAlign: 'center', fontSize: '11px', marginTop: '28px', marginBottom: 0 },
}