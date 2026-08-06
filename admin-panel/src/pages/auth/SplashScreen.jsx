import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { BRAND, COLORS, FONTS } from '../../config/brand'
import BrandIcon from '../../components/shared/BrandIcon'

export default function SplashScreen() {
  const navigate = useNavigate()

  useEffect(() => {
    const timer = setTimeout(() => navigate('/login'), 3000)
    return () => clearTimeout(timer)
  }, [navigate])

  return (
    <div style={{ ...s.page, background: COLORS.bg, fontFamily: FONTS.body }}>

      {/* Watermark */}
      <div style={{ ...s.watermark, color: COLORS.watermark, fontFamily: FONTS.heading }}>
        {BRAND.name.toUpperCase()}
      </div>

      {/* Center */}
      <div style={s.center}>
        <div style={{ ...s.logoBox, borderColor: COLORS.goldBorder, background: 'rgba(255,255,255,0.45)' }}>
          <BrandIcon size={52} />
        </div>

        <h1 style={{ ...s.brand, color: COLORS.navy, fontFamily: FONTS.heading }}>
          {BRAND.name.toUpperCase()}
        </h1>

        <p style={{ ...s.adminTagline, color: COLORS.textMuted, fontFamily: FONTS.body }}>
          {BRAND.adminTagline}
        </p>

        <div style={{ ...s.divider, background: COLORS.gold }} />

        <p style={{ ...s.tagline, color: COLORS.textSub, fontFamily: FONTS.body }}>
          {BRAND.tagline}
        </p>

        <p style={{ ...s.sub, color: COLORS.gold, fontFamily: FONTS.body }}>
          {BRAND.sub}
        </p>

        <p style={{ ...s.version, color: COLORS.textMuted, fontFamily: FONTS.body }}>
          {BRAND.version}
        </p>
      </div>

      {/* Loader */}
      <div style={{ ...s.loaderWrap, background: COLORS.goldLight }}>
        <div style={{ ...s.loaderBar, background: COLORS.gold }} />
      </div>

      {/* Footer */}
      <div style={{ ...s.footer, color: COLORS.textMuted, fontFamily: FONTS.body }}>
        {BRAND.copy}
      </div>

      <style>{`
        @keyframes fill {
          from { width: 0% }
          to   { width: 100% }
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(16px) }
          to   { opacity: 1; transform: translateY(0) }
        }
      `}</style>
    </div>
  )
}

const s = {
  page: {
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    overflow: 'hidden',
  },
  watermark: {
    position: 'absolute',
    fontSize: '180px',
    fontWeight: 800,
    letterSpacing: '-8px',
    userSelect: 'none',
    pointerEvents: 'none',
  },
  center: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    animation: 'fadeIn 0.8s ease forwards',
  },
  logoBox: {
    width: '100px',
    height: '100px',
    border: '1.5px solid',
    borderRadius: '4px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: '28px',
    backdropFilter: 'blur(12px)',
    WebkitBackdropFilter: 'blur(12px)',
    boxShadow: '0 4px 24px rgba(184,150,12,0.08)',
  },
  brand: {
    fontSize: '52px',
    fontWeight: 800,
    letterSpacing: '4px',
    margin: 0,
  },
  adminTagline: {
    fontSize: '14px',
    fontWeight: 400,
    letterSpacing: '1px',
    margin: '8px 0 0',
  },
  divider: {
    width: '60px',
    height: '1px',
    margin: '16px 0',
  },
  tagline: {
    fontSize: '13px',
    letterSpacing: '0.5px',
    margin: '0 0 10px',
    fontWeight: 500,
  },
  sub: {
    fontSize: '11px',
    letterSpacing: '3px',
    fontWeight: 700,
    margin: '0 0 8px',
  },
  version: {
    fontSize: '10px',
    letterSpacing: '1.5px',
    fontWeight: 500,
    margin: 0,
  },
  loaderWrap: {
    position: 'absolute',
    bottom: '60px',
    width: '200px',
    height: '2px',
    borderRadius: '2px',
    overflow: 'hidden',
  },
  loaderBar: {
    height: '100%',
    borderRadius: '2px',
    animation: 'fill 2.8s ease forwards',
  },
  footer: {
    position: 'absolute',
    bottom: '24px',
    fontSize: '11px',
    letterSpacing: '0.5px',
  },
}