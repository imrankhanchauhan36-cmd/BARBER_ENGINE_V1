import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import BRAND from '../../config/brand'

const C = BRAND.colors

const GROUPS = [
  { title: 'MAIN', items: [
    { label: 'Dashboard', path: '/dashboard', icon: '📊' },
  ]},
  { title: 'OPERATIONS', items: [
    { label: 'Salons',    path: '/salons',    icon: '🏪' },
    { label: 'Providers', path: '/providers', icon: '👤' },
    { label: 'Users',     path: '/users',     icon: '👥' },
    { label: 'Bookings',  path: '/bookings',  icon: '📅' },
    { label: 'Approvals', path: '/approvals', icon: '✅' },
    { label: 'KYC',       path: '/kyc',       icon: '🪪' },
    { label: 'Disputes',  path: '/disputes',  icon: '⚖️'  },
  ]},
  { title: 'FINANCE', items: [
    { label: 'Wallets',      path: '/finance/wallets',      icon: '��' },
    { label: 'Transactions', path: '/finance/transactions', icon: '💳' },
    { label: 'Payouts',      path: '/finance/payouts',      icon: '💰' },
  ]},
  { title: 'LOCATION', items: [
    { label: 'States',    path: '/location/states',    icon: '🗺️'  },
    { label: 'Districts', path: '/location/districts', icon: '🏙️'  },
    { label: 'Cities',    path: '/location/cities',    icon: '🏘️'  },
    { label: 'Areas',     path: '/location/areas',     icon: '📍' },
  ]},
  { title: 'COMMUNICATION', items: [
    { label: 'Notifications', path: '/notifications', icon: '🔔' },
  ]},
  { title: 'SECURITY', items: [
    { label: 'Employees',  path: '/employees',  icon: '👨‍💼' },
    { label: 'Roles',      path: '/roles',      icon: '🔐' },
    { label: 'Permissions',path: '/permissions', icon: '🛡️'  },
    { label: 'Audit Logs', path: '/audit',      icon: '📋' },
  ]},
  { title: 'SYSTEM', items: [
    { label: 'Settings', path: '/settings', icon: '⚙️' },
  ]},
]

export default function MainLayout() {
  const navigate = useNavigate()
  const admin = JSON.parse(localStorage.getItem('admin_user') || '{}')

  const handleLogout = () => {
    localStorage.removeItem('admin_token')
    localStorage.removeItem('admin_user')
    navigate('/login')
  }

  return (
    <div style={{ display:'flex', height:'100vh', overflow:'hidden' }}>

      {/* Sidebar */}
      <aside style={{ width:'240px', background: C.sidebar, display:'flex', flexDirection:'column', overflowY:'auto', flexShrink:0 }}>
        
        {/* Brand */}
        <div style={{ padding:'20px 16px', borderBottom:'1px solid #1e293b', display:'flex', alignItems:'center', gap:'10px' }}>
          <span style={{ fontSize:'26px' }}>{BRAND.logo}</span>
          <div>
            <div style={{ color:'#fff', fontWeight:800, fontSize:'14px' }}>{BRAND.name}</div>
            <div style={{ color:C.textMuted, fontSize:'11px' }}>{BRAND.tagline}</div>
          </div>
        </div>

        {/* Nav */}
        <nav style={{ flex:1, padding:'8px 0' }}>
          {GROUPS.map(group => (
            <div key={group.title}>
              <div style={{ color:'#475569', fontSize:'10px', fontWeight:700, letterSpacing:'1px', padding:'12px 16px 4px' }}>
                {group.title}
              </div>
              {group.items.map(item => (
                <NavLink
                  key={item.path}
                  to={item.path}
                  style={({ isActive }) => ({
                    display:'flex', alignItems:'center', gap:'10px',
                    padding:'8px 16px', margin:'1px 8px', borderRadius:'6px',
                    color: isActive ? '#fff' : C.textMuted,
                    background: isActive ? C.primary : 'transparent',
                    fontSize:'13px', fontWeight: isActive ? 600 : 400,
                    textDecoration:'none',
                  })}
                >
                  <span>{item.icon}</span>
                  <span>{item.label}</span>
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        {/* User */}
        <div style={{ padding:'14px 16px', borderTop:'1px solid #1e293b', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <div>
            <div style={{ color:'#fff', fontSize:'13px', fontWeight:600 }}>{admin.name || 'Admin'}</div>
            <div style={{ color:C.textMuted, fontSize:'11px' }}>{admin.adminLevel || 'ADMIN'}</div>
          </div>
          <button
            onClick={handleLogout}
            style={{ background:'#1e293b', color:C.textMuted, border:'none', borderRadius:'6px', padding:'6px 12px', fontSize:'12px' }}
          >
            Logout
          </button>
        </div>
      </aside>

      {/* Main */}
      <main style={{ flex:1, overflowY:'auto', background: C.bg }}>
        <Outlet />
      </main>
    </div>
  )
}
