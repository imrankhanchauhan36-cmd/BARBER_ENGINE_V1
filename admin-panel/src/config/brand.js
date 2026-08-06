// ─────────────────────────────────────────────
// ZEMISH — Brand Configuration
// Single source of truth for all UI tokens
// ─────────────────────────────────────────────

export const BRAND = {
  name:    'Zemish',
  // Short brand-lockup subtitle — rendered directly under the "ZEMISH"
  // wordmark on Splash/Login/Sidebar (separate text element, not baked
  // into the logo artwork). Distinct from `tagline` below, which is
  // older marketing copy shown further down those screens. Matches the
  // brandTagline pattern used in user-app/salon-app, with Admin Panel's
  // own role-specific wording.
  adminTagline: 'Admin Console',
  tagline: "Powering India's Beauty & Grooming Network",
  sub:     'NATIONAL COMMAND CENTER',
  version: 'ZEMISH ADMIN v1.0.0',
  logo:    'Z',
  copy:    '© 2024 Zemish. All rights reserved.',
}

export const COLORS = {
  // Primary
  gold:        '#B8960C',
  goldLight:   'rgba(184,150,12,0.08)',
  goldBorder:  'rgba(184,150,12,0.5)',
  navy:        '#1A1A2E',
  navyLight:   '#22223B',

  // Background
  bg:          '#F5F0E8',
  surface:     '#FFFFFF',
  surfaceAlt:  '#FDFAF6',

  // Sidebar
  sidebar:     '#1A1A2E',
  sidebarItem: 'rgba(255,255,255,0.06)',
  sidebarActive:'rgba(184,150,12,0.15)',

  // Text
  text:        '#1A1A2E',
  textSub:     '#6B5E3E',
  textMuted:   '#9E8E6E',
  textLight:   '#C4B49A',
  textWhite:   '#FFFFFF',
  textWhiteSub:'rgba(255,255,255,0.5)',
  textWhiteMuted:'rgba(255,255,255,0.25)',

  // Border
  border:      '#E8DFD0',
  borderLight: '#F0EAE0',

  // Status
  success:     '#16A34A',
  successBg:   '#DCFCE7',
  warning:     '#CA8A04',
  warningBg:   '#FEF9C3',
  danger:      '#DC2626',
  dangerBg:    '#FEF2F2',
  info:        '#2563EB',
  infoBg:      '#EFF6FF',

  // Watermark
  watermark:   'rgba(184,150,12,0.05)',
}

export const FONTS = {
  heading: "'Playfair Display', serif",
  body:    "'Inter', sans-serif",
}

export const RADIUS = {
  sm:   '2px',
  md:   '4px',
  lg:   '8px',
  xl:   '12px',
  full: '9999px',
}

export const SHADOW = {
  sm:  '0 1px 3px rgba(0,0,0,0.06)',
  md:  '0 4px 16px rgba(0,0,0,0.08)',
  lg:  '0 8px 48px rgba(0,0,0,0.10)',
  xl:  '0 16px 64px rgba(0,0,0,0.14)',
}

export default { BRAND, COLORS, FONTS, RADIUS, SHADOW }