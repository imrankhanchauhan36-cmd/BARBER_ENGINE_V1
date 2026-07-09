import { useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { COLORS, FONTS } from '../../config/brand'
import ENV from '../../config/env'
import useAuthStore from '../../store/authStore'

const GROUPS = [
  { title: null, items: [
    { label: 'Dashboard',     path: '/app/dashboard',            icon: '▦',  badge: null },
  ]},
  { title: 'OPERATIONS', items: [
    { label: 'Salons',        path: '/app/salons',               icon: '⊡',  badge: null },
    { label: 'Staff',     path: '/app/staff',     icon: '👤', badge: null },
    { label: 'Providers',     path: '/app/providers',            icon: '⊙',  badge: null },
    { label: 'Users',         path: '/app/users',                icon: '⊞',  badge: null },
    { label: 'Bookings',      path: '/app/bookings',             icon: '▤',  badge: null },
    { label: 'Approvals',     path: '/app/approvals',            icon: '▣',  badge: '842' },
    { label: 'KYC',           path: '/app/kyc',                  icon: '▢',  badge: '12' },
    { label: 'Disputes',      path: '/app/disputes',             icon: '▧',  badge: '18' },
  ]},
  { title: 'FINANCE', items: [
    { label: 'Wallets',       path: '/app/finance/wallets',      icon: '▨',  badge: null },
    { label: 'Transactions',  path: '/app/finance/transactions', icon: '▥',  badge: null },
    { label: 'Payouts',       path: '/app/finance/payouts',      icon: '▦',  badge: '186' },
    { label: 'Analytics',     path: '/app/finance/analytics',    icon: '◈',  badge: null },
  ]},
  { title: 'LOCATION', items: [
    { label: 'States',        path: '/app/location/states',      icon: '▩',  badge: null },
    { label: 'Districts',     path: '/app/location/districts',   icon: '▩',  badge: null },
    { label: 'Cities',        path: '/app/location/cities',      icon: '▤',  badge: null },
    { label: 'Areas',         path: '/app/location/areas',       icon: '▢',  badge: null },
  ]},
  { title: 'COMMUNICATION', items: [
    { label: 'Notifications', path: '/app/notifications',        icon: '▣',  badge: null },
  ]},
  { title: 'SECURITY', items: [
    { label: 'Employees',     path: '/app/employees',            icon: '⊙',  badge: null },
    { label: 'Roles',         path: '/app/roles',                icon: '▧',  badge: null },
    { label: 'Permissions',   path: '/app/permissions',          icon: '▨',  badge: null },
    { label: 'Audit Logs',    path: '/app/audit',                icon: '▥',  badge: null },
  ]},
  { title: 'SYSTEM', items: [
    { label: 'Settings',      path: '/app/settings',             icon: '▦',  badge: null },
  ]},
]

export default function MainLayout() {
  const navigate  = useNavigate()
  const admin     = useAuthStore(s => s.admin)
  const logout    = useAuthStore(s => s.logout)
  const token     = useAuthStore(s => s.token)
  const [search,  setSearch]  = useState('')
  const [hoverId, setHoverId] = useState(null)
  const handleLogout = async () => {
    try {
      await fetch(`${ENV.API_URL}/api/admin-auth/logout`, {
        method:      'POST',
        credentials: 'include',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type':  'application/json',
        },
      })
    } catch {
      // silent — local logout hoga anyway
    } finally {
      logout()
      navigate('/login')
    }
  }

  const adminLevel = admin?.adminLevel || 'SUPER_ADMIN'

  return (
    <div style={{ display:'flex', height:'100vh', overflow:'hidden', fontFamily: FONTS.body }}>

      {/* ══════════════════════════════════
          BANK-STYLE SIDEBAR
      ══════════════════════════════════ */}
      <aside style={{
        width: '230px',
        minWidth: '230px',
        background: '#0D1B2A',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
        borderRight: '3px solid #B8960C',
      }}>

        {/* ── Brand Box ── */}
        <div style={{
          background: '#0A1520',
          borderBottom: '1px solid rgba(184,150,12,0.3)',
          padding: '0',
        }}>
          <div style={{ padding: '16px', display: 'flex', alignItems: 'center', gap: '12px', borderBottom: '1px solid rgba(184,150,12,0.15)' }}>
            <div style={{
              width: '38px', height: '38px',
              background: '#B8960C',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
            }}>
              <svg width="20" height="20" viewBox="0 0 48 48" fill="none">
                <path d="M8 10H40L10 38H42" stroke="#0A1520" strokeWidth="4.5" strokeLinecap="square" strokeLinejoin="miter"/>
              </svg>
            </div>
            <div>
              <div style={{ color: '#FFFFFF', fontWeight: 800, fontSize: '15px', letterSpacing: '3px', fontFamily: FONTS.heading }}>ZEMISH</div>
              <div style={{ color: '#B8960C', fontSize: '8px', letterSpacing: '2px', fontWeight: 700, marginTop: '2px' }}>NATIONAL COMMAND CENTER</div>
            </div>
          </div>

          {/* Admin Info Box */}
          <div style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(184,150,12,0.06)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{ width: '30px', height: '30px', background: '#B8960C', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#0A1520', fontSize: '13px', fontWeight: 800 }}>
                {(admin?.name || 'A')[0].toUpperCase()}
              </div>
              <div>
                <div style={{ color: '#FFFFFF', fontSize: '11px', fontWeight: 700, letterSpacing: '0.3px' }}>{admin?.name || 'Super Admin'}</div>
                <div style={{ color: '#B8960C', fontSize: '9px', letterSpacing: '1px', fontWeight: 600, marginTop: '1px' }}>{adminLevel}</div>
              </div>
            </div>
            <button onClick={handleLogout} style={{ background: 'rgba(184,150,12,0.15)', border: '1px solid rgba(184,150,12,0.3)', color: '#B8960C', padding: '4px 8px', fontSize: '9px', fontWeight: 700, cursor: 'pointer', letterSpacing: '0.5px' }}>
              LOGOUT
            </button>
          </div>
        </div>

        {/* ── Search Box ── */}
        <div style={{ padding: '10px 12px', background: '#0A1520', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(184,150,12,0.2)', padding: '7px 10px' }}>
            <span style={{ fontSize: '11px', color: 'rgba(184,150,12,0.6)', fontWeight: 700 }}>▸</span>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="SEARCH MODULE..."
              style={{ background: 'none', border: 'none', outline: 'none', color: 'rgba(255,255,255,0.5)', fontSize: '10px', width: '100%', fontFamily: FONTS.body, letterSpacing: '0.5px' }}
            />
          </div>
        </div>

        {/* ── Nav ── */}
        <nav style={{ flex: 1, overflowY: 'auto', padding: '0' }}>
          {GROUPS.map((group, gi) => (
            <div key={gi} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
              {group.title && (
                <div style={{
                  background: 'rgba(184,150,12,0.06)',
                  borderTop: '1px solid rgba(184,150,12,0.1)',
                  borderBottom: '1px solid rgba(184,150,12,0.1)',
                  padding: '6px 14px',
                  display: 'flex', alignItems: 'center', gap: '8px',
                }}>
                  <div style={{ width: '3px', height: '12px', background: '#B8960C' }}/>
                  <span style={{ color: '#B8960C', fontSize: '9px', fontWeight: 800, letterSpacing: '2px' }}>
                    {group.title}
                  </span>
                </div>
              )}
              {group.items
                .filter(item => !search || item.label.toLowerCase().includes(search.toLowerCase()))
                .map(item => (
                  <NavLink
                    key={item.path}
                    to={item.path}
                    onMouseEnter={() => setHoverId(item.path)}
                    onMouseLeave={() => setHoverId(null)}
                    style={({ isActive }) => ({
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '9px 14px',
                      borderBottom: '1px solid rgba(255,255,255,0.03)',
                      borderLeft: isActive ? '3px solid #B8960C' : '3px solid transparent',
                      background: isActive
                        ? 'rgba(184,150,12,0.12)'
                        : hoverId === item.path
                          ? 'rgba(255,255,255,0.03)'
                          : 'transparent',
                      textDecoration: 'none',
                      transition: 'all 0.1s',
                      cursor: 'pointer',
                    })}
                  >
                    {({ isActive }) => (
                      <>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          <span style={{
                            width: '20px', height: '20px',
                            background: isActive ? '#B8960C' : 'rgba(255,255,255,0.06)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: '11px',
                            color: isActive ? '#0A1520' : 'rgba(255,255,255,0.4)',
                            flexShrink: 0,
                            fontWeight: 700,
                          }}>
                            {item.icon}
                          </span>
                          <span style={{
                            fontSize: '12px',
                            color: isActive ? '#FFFFFF' : 'rgba(255,255,255,0.5)',
                            fontWeight: isActive ? 700 : 400,
                            letterSpacing: isActive ? '0.3px' : '0',
                          }}>
                            {item.label}
                          </span>
                        </div>
                        {item.badge && (
                          <span style={{
                            background: '#DC2626',
                            color: '#fff',
                            fontSize: '9px',
                            fontWeight: 800,
                            padding: '2px 6px',
                            minWidth: '20px',
                            textAlign: 'center',
                            letterSpacing: '0.3px',
                          }}>
                            {item.badge}
                          </span>
                        )}
                      </>
                    )}
                  </NavLink>
                ))}
            </div>
          ))}

          {/* Live Status Box */}
          <div style={{ background: '#0A1520', borderTop: '1px solid rgba(184,150,12,0.15)', padding: '10px 14px' }}>
            <div style={{ color: '#B8960C', fontSize: '9px', fontWeight: 800, letterSpacing: '2px', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{ width: '3px', height: '10px', background: '#B8960C' }}/>
              LIVE STATUS
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px' }}>
              {['Server', 'MongoDB', 'Redis', 'Storage'].map(s => (
                <div key={s} style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '4px 6px', background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)' }}>
                  <div style={{ width: '5px', height: '5px', background: '#10B981', flexShrink: 0 }}/>
                  <span style={{ fontSize: '9px', color: 'rgba(255,255,255,0.35)', letterSpacing: '0.3px' }}>{s}</span>
                </div>
              ))}
            </div>
          </div>
        </nav>

        {/* ── Footer Box ── */}
        <div style={{ background: '#0A1520', borderTop: '1px solid rgba(184,150,12,0.2)', padding: '8px 14px' }}>
          <div style={{ fontSize: '8px', color: 'rgba(255,255,255,0.2)', letterSpacing: '0.5px', textAlign: 'center' }}>
            © 2024 ZEMISH. ALL RIGHTS RESERVED. v1.0.0
          </div>
        </div>
      </aside>

      {/* ── Main Content ── */}
      <main style={{ flex: 1, overflowY: 'auto', background: COLORS.bg }}>
        <Outlet />
      </main>
    </div>
  )
}