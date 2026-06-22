import { BRAND, COLORS, FONTS, SHADOW } from '../../config/brand'

const STATS = [
  { label:'Total Salons',    value:'248',     change:'+12 this week',     icon:'🏪', color: COLORS.gold    },
  { label:'Active Bookings', value:'1,847',   change:'+234 today',        icon:'📅', color: COLORS.success },
  { label:'Total Users',     value:'12,430',  change:'+89 today',         icon:'👥', color: COLORS.warning },
  { label:'Revenue Today',   value:'₹84,230', change:'+18% vs yesterday', icon:'💰', color: COLORS.danger  },
]

const APPROVALS = [
  { id:1, salon:'Salman Salmani', district:'Hapur, UP',   status:'APPROVED', time:'2h ago' },
  { id:2, salon:'Royal Cuts',     district:'Noida, UP',   status:'PENDING',  time:'3h ago' },
  { id:3, salon:'Style Studio',   district:'Lucknow, UP', status:'PENDING',  time:'5h ago' },
  { id:4, salon:'Hair Masters',   district:'Agra, UP',    status:'REJECTED', time:'6h ago' },
]

const BADGE = {
  APPROVED: { bg: COLORS.successBg, color: COLORS.success },
  PENDING:  { bg: COLORS.warningBg, color: COLORS.warning },
  REJECTED: { bg: COLORS.dangerBg,  color: COLORS.danger  },
}

export default function DashboardPage() {
  const admin = JSON.parse(localStorage.getItem('admin_user') || '{}')

  return (
    <div style={{ padding:'32px', fontFamily: FONTS.body }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:'32px' }}>
        <div>
          <h1 style={{ fontSize:'26px', fontWeight:800, color: COLORS.text, margin:0, fontFamily: FONTS.heading }}>Dashboard</h1>
          <p style={{ color: COLORS.textMuted, fontSize:'14px', marginTop:'4px' }}>
            Welcome back, {admin.name || 'Admin'} • {admin.adminLevel || ''}
          </p>
        </div>
        <div style={{ color: COLORS.textMuted, fontSize:'13px' }}>
          {new Date().toLocaleDateString('en-IN', { weekday:'long', year:'numeric', month:'long', day:'numeric' })}
        </div>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:'20px', marginBottom:'32px' }}>
        {STATS.map(s => (
          <div key={s.label} style={{ background: COLORS.surface, borderRadius:'4px', padding:'24px', border:`1px solid ${COLORS.borderLight}`, boxShadow: SHADOW.sm }}>
            <div style={{ width:'46px', height:'46px', borderRadius:'4px', background: s.color+'18', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'22px', marginBottom:'16px' }}>
              {s.icon}
            </div>
            <div style={{ fontSize:'28px', fontWeight:800, color: COLORS.text, fontFamily: FONTS.heading }}>{s.value}</div>
            <div style={{ fontSize:'13px', color: COLORS.textMuted, margin:'4px 0 8px' }}>{s.label}</div>
            <div style={{ fontSize:'12px', color: COLORS.success, fontWeight:600 }}>{s.change}</div>
          </div>
        ))}
      </div>

      <div style={{ background: COLORS.surface, borderRadius:'4px', padding:'24px', border:`1px solid ${COLORS.borderLight}`, boxShadow: SHADOW.sm }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'20px' }}>
          <h2 style={{ fontSize:'16px', fontWeight:700, color: COLORS.text, margin:0, fontFamily: FONTS.heading }}>Recent Approvals</h2>
          <a href="/approvals" style={{ color: COLORS.gold, fontSize:'13px', fontWeight:600 }}>View All →</a>
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'2fr 2fr 1fr 1fr', padding:'8px 16px', color: COLORS.textMuted, fontSize:'11px', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.5px' }}>
          <span>Salon</span><span>District</span><span>Status</span><span>Time</span>
        </div>
        {APPROVALS.map(row => (
          <div key={row.id} style={{ display:'grid', gridTemplateColumns:'2fr 2fr 1fr 1fr', padding:'14px 16px', borderTop:`1px solid ${COLORS.borderLight}`, alignItems:'center' }}>
            <span style={{ fontWeight:600, color: COLORS.text, fontSize:'14px' }}>{row.salon}</span>
            <span style={{ color: COLORS.textSub, fontSize:'13px' }}>{row.district}</span>
            <span style={{ display:'inline-block', padding:'4px 10px', borderRadius:'20px', fontSize:'11px', fontWeight:700, background: BADGE[row.status].bg, color: BADGE[row.status].color }}>
              {row.status}
            </span>
            <span style={{ color: COLORS.textMuted, fontSize:'12px' }}>{row.time}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
