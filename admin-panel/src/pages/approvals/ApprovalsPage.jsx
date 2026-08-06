import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FONTS } from '../../config/brand'
import useAuthStore from '../../store/authStore'
import ApprovalsAPI from './api/approvals.api'

// ─── Helpers ─────────────────────────────────────────────
const v   = (val, fb = '—') => (val !== null && val !== undefined && val !== '') ? val : fb
const dt  = (d) => d ? new Date(d).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' }) : '—'

// ─── Permission helpers ───────────────────────────────────
const canApprove   = (level) => ['INDIA', 'STATE'].includes(level)
const canRecommend = (level) => level === 'DISTRICT'

// ─── Constants ────────────────────────────────────────────
const STATUS_COLORS = {
  PENDING:     { bg: '#FEF9C3', color: '#92400E' },
  RECOMMENDED: { bg: '#DCFCE7', color: '#166534' },
  APPROVED:    { bg: '#D1FAE5', color: '#065F46' },
  REJECTED:    { bg: '#FEE2E2', color: '#991B1B' },
  DRAFT:       { bg: '#F3F4F6', color: '#374151' },
}
const CAT_COLORS = {
  MEN_ONLY:   { bg: '#EFF6FF', color: '#1D4ED8' },
  WOMEN_ONLY: { bg: '#FDF2F8', color: '#9D174D' },
  UNISEX:     { bg: '#F5F3FF', color: '#6D28D9' },
}

// ─── Components ──────────────────────────────────────────
const BCard = ({ children, style={} }) => (
  <div style={{ background:'#fff', border:'1px solid #D4C9B0', borderTop:'2px solid #B8960C', ...style }}>{children}</div>
)
const BCardHeader = ({ title, action }) => (
  <div style={{ padding:'10px 14px', borderBottom:'1px solid #E8DFD0', display:'flex', justifyContent:'space-between', alignItems:'center', background:'#FDFAF6' }}>
    <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
      <div style={{ width:'3px', height:'14px', background:'#B8960C' }}/>
      <span style={{ fontSize:'12px', fontWeight:700, color:'#1A1A2E', letterSpacing:'0.5px', textTransform:'uppercase' }}>{title}</span>
    </div>
    {action}
  </div>
)

// ─── Confirm Modal ────────────────────────────────────────
function ConfirmModal({ action, salonName, district, state, reason, onConfirm, onCancel }) {
  const isApprove   = action === 'APPROVE'
  const isRecommend = action === 'RECOMMEND'
  const borderColor = isApprove ? '#B8960C' : isRecommend ? '#059669' : '#DC2626'
  const bgColor     = isApprove ? '#0D1B2A' : isRecommend ? '#064E3B' : '#7F1D1D'

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.75)', zIndex:2000, display:'flex', alignItems:'center', justifyContent:'center' }}>
      <div style={{ background:'#fff', width:'420px', border:`2px solid ${borderColor}` }}>
        <div style={{ background:bgColor, padding:'14px 18px', borderBottom:`2px solid ${borderColor}` }}>
          <div style={{ color:'#fff', fontWeight:800, fontSize:'13px', letterSpacing:'1px' }}>
            {isApprove ? '✓ CONFIRM APPROVAL' : isRecommend ? '↑ CONFIRM RECOMMENDATION' : '✕ CONFIRM REJECTION'}
          </div>
        </div>
        <div style={{ padding:'20px 18px' }}>
          <div style={{ fontSize:'12px', color:'#9E8E6E', padding:'10px', background:'#F5F0E8', border:'1px solid #E8DFD0', marginBottom:'16px' }}>
            <strong>{v(salonName)}</strong> — {v(district)}, {v(state)}
          </div>
          {!isApprove && !isRecommend && reason && (
            <div style={{ fontSize:'12px', color:'#DC2626', marginBottom:'12px', padding:'8px', background:'#FEF2F2', border:'1px solid #FEE2E2' }}>
              Reason: {reason}
            </div>
          )}
          <div style={{ display:'flex', gap:'8px', justifyContent:'flex-end' }}>
            <button onClick={onCancel} style={{ background:'#fff', border:'1px solid #D4C9B0', color:'#6B5E3E', padding:'8px 16px', fontSize:'11px', fontWeight:700, cursor:'pointer' }}>CANCEL</button>
            <button onClick={onConfirm} style={{ background:borderColor, border:'none', color:isApprove?'#0D1B2A':'#fff', padding:'8px 20px', fontSize:'11px', fontWeight:800, cursor:'pointer' }}>
              {isApprove ? '✓ YES, APPROVE' : isRecommend ? '↑ YES, RECOMMEND' : '✕ YES, REJECT'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Review Modal ─────────────────────────────────────────
function ReviewModal({ salon, onClose, onApprove, onReject, adminLevel, processing }) {
  const [reason,  setReason]  = useState('')
  const [tab,     setTab]     = useState('overview')
  const [confirm, setConfirm] = useState(null)

  if (!salon) return null

  const canRec = canRecommend(adminLevel)
  const canApp = canApprove(adminLevel)

  const handleConfirm = () => {
    if (confirm === 'APPROVE')    onApprove(salon.id)
    else if (confirm === 'RECOMMEND') onApprove(salon.id) // recommend = approve for DISTRICT
    else onReject(salon.id, reason)
    setConfirm(null)
  }

  const st = STATUS_COLORS[salon.approvalStatus] || STATUS_COLORS.PENDING

  return (
    <>
      <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.65)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:'20px' }}>
        <div style={{ background:'#fff', width:'100%', maxWidth:'800px', maxHeight:'92vh', display:'flex', flexDirection:'column', border:'1px solid #B8960C' }}>

          {/* Header */}
          <div style={{ background:'#0D1B2A', borderBottom:'2px solid #B8960C', padding:'14px 20px', display:'flex', justifyContent:'space-between', alignItems:'center', flexShrink:0 }}>
            <div style={{ display:'flex', alignItems:'center', gap:'10px' }}>
              <div style={{ width:'3px', height:'20px', background:'#B8960C' }}/>
              <div>
                <div style={{ color:'#fff', fontWeight:800, fontSize:'15px' }}>{v(salon.shopName)}</div>
                <div style={{ color:'#B8960C', fontSize:'10px', letterSpacing:'1px', marginTop:'2px' }}>
                  {v(salon.district)} • {v(salon.state)} • {v(salon.category)}
                </div>
              </div>
            </div>
            <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
              <span style={{ fontSize:'10px', fontWeight:800, background:st.bg, color:st.color, padding:'3px 10px' }}>{v(salon.approvalStatus)}</span>
              <button onClick={onClose} style={{ background:'rgba(255,255,255,0.1)', border:'1px solid rgba(255,255,255,0.2)', color:'#fff', width:'28px', height:'28px', cursor:'pointer', fontSize:'14px', display:'flex', alignItems:'center', justifyContent:'center' }}>✕</button>
            </div>
          </div>

          {/* Tabs */}
          <div style={{ display:'flex', borderBottom:'1px solid #E8DFD0', background:'#FDFAF6', flexShrink:0 }}>
            {['overview', 'documents', 'timeline'].map(t => (
              <button key={t} onClick={() => setTab(t)} style={{ padding:'10px 20px', border:'none', background:'none', cursor:'pointer', fontSize:'11px', fontWeight:tab===t?800:400, color:tab===t?'#B8960C':'#9E8E6E', borderBottom:tab===t?'2px solid #B8960C':'2px solid transparent', letterSpacing:'1px', textTransform:'uppercase' }}>
                {t}
              </button>
            ))}
          </div>

          {/* Body */}
          <div style={{ flex:1, overflowY:'auto', padding:'18px 20px' }}>

            {tab === 'overview' && (
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'16px' }}>
                <div>
                  <div style={{ fontSize:'9px', color:'#9E8E6E', fontWeight:800, letterSpacing:'1.5px', textTransform:'uppercase', marginBottom:'8px', display:'flex', alignItems:'center', gap:'6px' }}>
                    <div style={{ width:'3px', height:'10px', background:'#B8960C' }}/> SALON INFORMATION
                  </div>
                  {[
                    { l:'Shop Name',    v: salon.shopName },
                    { l:'Owner Name',   v: salon.ownerName },
                    { l:'Phone',        v: salon.ownerPhone },
                    { l:'Category',     v: salon.category },
                    { l:'Tier',         v: salon.tier },
                    { l:'Submitted On', v: dt(salon.createdAt) },
                    { l:'Onboarding',   v: salon.onboardingStep ? `Step ${salon.onboardingStep}/7` : '—' },
                  ].map(r => (
                    <div key={r.l} style={{ display:'flex', justifyContent:'space-between', padding:'7px 0', borderBottom:'1px solid #F0EAE0' }}>
                      <span style={{ fontSize:'12px', color:'#9E8E6E' }}>{r.l}</span>
                      <span style={{ fontSize:'12px', fontWeight:600, color:'#1A1A2E' }}>{v(r.v)}</span>
                    </div>
                  ))}
                </div>
                <div>
                  <div style={{ fontSize:'9px', color:'#9E8E6E', fontWeight:800, letterSpacing:'1.5px', textTransform:'uppercase', marginBottom:'8px', display:'flex', alignItems:'center', gap:'6px' }}>
                    <div style={{ width:'3px', height:'10px', background:'#B8960C' }}/> ASSIGNMENT & LOCATION
                  </div>
                  {[
                    { l:'Assigned To',    v: salon.assignedAdmin?.name },
                    { l:'Admin Level',    v: salon.assignedAdmin?.adminLevel },
                    { l:'Approved By',    v: salon.approvedBy?.name || 'Not yet' },
                    { l:'Address',        v: salon.address },
                    { l:'District',       v: salon.district },
                    { l:'State',          v: salon.state },
                    { l:'Rejection Reason', v: salon.rejectionReason },
                  ].map(r => (
                    <div key={r.l} style={{ display:'flex', justifyContent:'space-between', padding:'7px 0', borderBottom:'1px solid #F0EAE0', gap:'10px' }}>
                      <span style={{ fontSize:'12px', color:'#9E8E6E', flexShrink:0 }}>{r.l}</span>
                      <span style={{ fontSize:'12px', fontWeight:600, color:'#1A1A2E', textAlign:'right' }}>{v(r.v)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {tab === 'documents' && (
              <div style={{ padding:'10px 0', color:'#9E8E6E', fontSize:'13px', textAlign:'center' }}>
                Documents — KYC module se aayenge (Phase 8)
              </div>
            )}

            {tab === 'timeline' && (
              <div style={{ position:'relative', paddingLeft:'24px' }}>
                <div style={{ position:'absolute', left:'7px', top:'8px', bottom:'8px', width:'2px', background:'#E8DFD0' }}/>
                {[
                  { event:'Salon Registered',    done: true,  time: dt(salon.createdAt) },
                  { event:'Documents Uploaded',   done: true,  time: '—' },
                  { event:'Assigned to Admin',    done: !!salon.assignedAdmin, time: '—' },
                  { event:'District Review',      done: ['APPROVED','REJECTED'].includes(salon.approvalStatus), time: '—' },
                  { event:'Salon Live',           done: salon.approvalStatus === 'APPROVED', time: dt(salon.approvedAt) },
                ].map((t, i) => (
                  <div key={i} style={{ position:'relative', marginBottom:'20px' }}>
                    <div style={{ position:'absolute', left:'-20px', top:'2px', width:'14px', height:'14px', background:t.done?'#B8960C':'#E8DFD0', border:`2px solid ${t.done?'#B8960C':'#D4C9B0'}`, display:'flex', alignItems:'center', justifyContent:'center' }}>
                      {t.done && <span style={{ color:'#fff', fontSize:'8px', fontWeight:800 }}>✓</span>}
                    </div>
                    <div style={{ background:t.done?'#FDFAF6':'#F5F0E8', border:`1px solid ${t.done?'#D4C9B0':'#E8DFD0'}`, borderLeft:`3px solid ${t.done?'#B8960C':'#D4C9B0'}`, padding:'10px 14px' }}>
                      <div style={{ fontSize:'13px', fontWeight:t.done?700:400, color:t.done?'#1A1A2E':'#9E8E6E' }}>{t.event}</div>
                      <div style={{ fontSize:'10px', color:t.done?'#B8960C':'#C4B49A', marginTop:'3px', fontWeight:600 }}>{t.time !== '—' ? t.time : t.done ? 'Done' : 'Awaiting...'}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Footer Actions */}
          <div style={{ borderTop:'2px solid #E8DFD0', padding:'14px 20px', background:'#FDFAF6', flexShrink:0 }}>
            <div style={{ marginBottom:'10px' }}>
              <label style={{ fontSize:'9px', color:'#9E8E6E', fontWeight:800, letterSpacing:'1px', textTransform:'uppercase', display:'block', marginBottom:'6px' }}>
                REJECTION REASON (REQUIRED IF REJECTING)
              </label>
              <input value={reason} onChange={e => setReason(e.target.value)} placeholder="Enter specific reason for rejection..."
                style={{ width:'100%', border:'1px solid #D4C9B0', padding:'8px 12px', fontSize:'13px', fontFamily:FONTS.body, background:'#fff', outline:'none', boxSizing:'border-box' }}
              />
            </div>
            <div style={{ display:'flex', gap:'8px', justifyContent:'flex-end' }}>
              <button onClick={onClose} style={{ background:'#fff', border:'1px solid #D4C9B0', color:'#6B5E3E', padding:'9px 16px', fontSize:'11px', fontWeight:700, cursor:'pointer' }}>CANCEL</button>
              {/* REJECT — sirf tab dikhao jab APPROVED ya PENDING ho */}
              {salon.approvalStatus !== 'REJECTED' && (
                <button onClick={() => setConfirm('REJECT')} disabled={processing}
                  style={{ background:'#FEF2F2', border:'1px solid #DC2626', color:'#DC2626', padding:'9px 16px', fontSize:'11px', fontWeight:800, cursor:'pointer' }}>✕ REJECT</button>
              )}
              {/* RECOMMEND — sirf DISTRICT admin + PENDING status */}
              {canRec && salon.approvalStatus === 'PENDING' && (
                <button onClick={() => setConfirm('RECOMMEND')} disabled={processing}
                  style={{ background:'#F0FDF4', border:'1px solid #059669', color:'#059669', padding:'9px 16px', fontSize:'11px', fontWeight:800, cursor:'pointer' }}>↑ RECOMMEND</button>
              )}
              {/* APPROVE — sirf tab dikhao jab APPROVED nahi ho */}
              {canApp && salon.approvalStatus !== 'APPROVED' && (
                <button onClick={() => setConfirm('APPROVE')} disabled={processing}
                  style={{ background:'#B8960C', border:'none', color:'#0D1B2A', padding:'9px 20px', fontSize:'11px', fontWeight:800, cursor:processing?'not-allowed':'pointer', opacity:processing?0.7:1 }}>
                  {processing ? 'PROCESSING...' : '✓ APPROVE'}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {confirm && (
        <ConfirmModal
          action={confirm}
          salonName={salon.shopName} district={salon.district} state={salon.state}
          reason={reason}
          onCancel={() => setConfirm(null)}
          onConfirm={handleConfirm}
        />
      )}
    </>
  )
}

// ─── Main Page ────────────────────────────────────────────
export default function ApprovalsPage() {
  const navigate   = useNavigate()
  const admin      = useAuthStore(s => s.admin)
  const adminLevel = admin?.adminLevel || 'INDIA'

  const [salons,      setSalons]      = useState([])
  const [loading,     setLoading]     = useState(true)
  const [error,       setError]       = useState(null)
  const [processing,  setProcessing]  = useState(false)
  const [pagination,  setPagination]  = useState({ page:1, limit:20, total:0, totalPages:1 })
  const [selected,    setSelected]    = useState(null)
  const [filter,      setFilter]      = useState('ALL')
  const [search,      setSearch]      = useState('')
  const [page,        setPage]        = useState(1)
  const [toast,       setToast]       = useState(null)

  const showToast = (msg, color = '#059669') => {
    setToast({ msg, color })
    setTimeout(() => setToast(null), 3000)
  }

  const fetchSalons = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = {
        page, limit: 20,
        ...(filter !== 'ALL' && { status: filter }),
        ...(search && { search }),
      }
      const res = await ApprovalsAPI.getAll(params)
      // Map response to approvals format
      const mapped = (res.data || []).map(s => ({
        id:              s.id,
        shopName:        s.shopName,
        ownerName:       s.ownerName,
        ownerPhone:      s.ownerPhone,
        category:        s.category,
        tier:            s.tier,
        state:           s.state,
        district:        s.district,
        address:         s.location?.address ?? null,
        approvalStatus:  s.status,
        assignedAdmin:   s.assignedAdmin,
        approvedBy:      s.approvedBy,
        approvedAt:      s.approvedAt,
        rejectionReason: s.rejectionReason,
        onboardingStep:  s.onboarding?.step,
        createdAt:       s.createdAt,
        isSuspended:     s.isSuspended,
        isForceClosed:   s.isForceClosed,
      }))
      setSalons(mapped)
      if (res.pagination) setPagination(res.pagination)
    } catch (err) {
      setError(err.message || 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [page, filter, search])

  useEffect(() => { fetchSalons() }, [fetchSalons])

  const handleApprove = async (id) => {
    setProcessing(true)
    try {
      await ApprovalsAPI.updateStatus(id, { status: 'APPROVED' })
      showToast('✓ Salon Approved', '#059669')
      setSelected(null)
      fetchSalons()
    } catch (err) {
      showToast(`⚠ ${err.message}`, '#DC2626')
    } finally {
      setProcessing(false)
    }
  }

  const handleReject = async (id, reason) => {
    if (!reason?.trim()) { showToast('⚠ Rejection reason required', '#D97706'); return }
    setProcessing(true)
    try {
      await ApprovalsAPI.updateStatus(id, { status: 'REJECTED', rejectionReason: reason })
      showToast('✕ Salon Rejected', '#DC2626')
      setSelected(null)
      fetchSalons()
    } catch (err) {
      showToast(`⚠ ${err.message}`, '#DC2626')
    } finally {
      setProcessing(false)
    }
  }

  // Counts from current list
  const counts = {
    ALL:         pagination.total,
    PENDING:     salons.filter(s => s.approvalStatus === 'PENDING').length,
    RECOMMENDED: salons.filter(s => s.approvalStatus === 'RECOMMENDED').length,
    APPROVED:    salons.filter(s => s.approvalStatus === 'APPROVED').length,
    REJECTED:    salons.filter(s => s.approvalStatus === 'REJECTED').length,
  }

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
          <div style={{ width:'3px', height:'16px', background:'#B8960C' }}/>
          <h1 style={{ fontSize:'13px', fontWeight:800, color:'#fff', margin:0, letterSpacing:'2px' }}>APPROVAL QUEUE</h1>
          <span style={{ background:'#DC2626', color:'#fff', fontSize:'9px', fontWeight:800, padding:'2px 8px' }}>
            {loading ? '...' : `${pagination.total} TOTAL`}
          </span>
        </div>
        <div style={{ display:'flex', gap:'8px', alignItems:'center' }}>
          <input value={search} onChange={e => setSearch(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && fetchSalons()}
            placeholder="SEARCH SALON OR DISTRICT... (Enter)"
            style={{ background:'rgba(255,255,255,0.07)', border:'1px solid rgba(184,150,12,0.3)', color:'rgba(255,255,255,0.7)', padding:'6px 12px', fontSize:'11px', fontFamily:FONTS.body, outline:'none', width:'260px' }}
          />
          <button onClick={fetchSalons} style={{ background:'#B8960C', border:'none', color:'#0D1B2A', padding:'6px 12px', fontSize:'10px', fontWeight:800, cursor:'pointer' }}>↻ REFRESH</button>
        </div>
      </div>

      <div style={{ padding:'14px 20px' }}>

        {error && (
          <div style={{ background:'#FEE2E2', border:'1px solid #DC2626', borderLeft:'4px solid #DC2626', padding:'10px 14px', marginBottom:'12px', fontSize:'13px', color:'#991B1B' }}>
            ⚠ {error} — <button onClick={fetchSalons} style={{ background:'none', border:'none', color:'#DC2626', cursor:'pointer', fontWeight:700, textDecoration:'underline' }}>Retry</button>
          </div>
        )}

        {/* Stats */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:'10px', marginBottom:'12px' }}>
          {[
            { label:'Total',       count: pagination.total, color:'#1A1A2E', f:'ALL'         },
            { label:'Pending',     count: counts.PENDING,   color:'#D97706', f:'PENDING'     },
            { label:'Recommended', count: counts.RECOMMENDED, color:'#059669', f:'RECOMMENDED' },
            { label:'Approved',    count: counts.APPROVED,  color:'#065F46', f:'APPROVED'    },
            { label:'Rejected',    count: counts.REJECTED,  color:'#DC2626', f:'REJECTED'    },
          ].map(s => (
            <div key={s.label} onClick={() => { setFilter(s.f); setPage(1) }}
              style={{ background:filter===s.f?s.color:'#fff', border:`1px solid ${s.color}40`, borderTop:`2px solid ${s.color}`, padding:'12px 14px', cursor:'pointer', textAlign:'center' }}>
              <div style={{ fontSize:'22px', fontWeight:800, color:filter===s.f?'#fff':s.color }}>{loading ? '...' : s.count}</div>
              <div style={{ fontSize:'9px', color:filter===s.f?'rgba(255,255,255,0.8)':'#9E8E6E', textTransform:'uppercase', letterSpacing:'0.5px', marginTop:'2px' }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* Table */}
        <BCard>
          <BCardHeader title={`Salon Applications (${pagination.total})`}
            action={<span style={{ fontSize:'11px', color:'#9E8E6E' }}>Page {page} of {pagination.totalPages || 1}</span>}
          />
          <div style={{ display:'grid', gridTemplateColumns:'2fr 1.2fr 1fr 0.8fr 0.8fr 1fr 1fr', padding:'8px 14px', background:'#F5F0E8', borderBottom:'1px solid #E8DFD0', gap:'8px' }}>
            {['SALON NAME','OWNER','DISTRICT','CATEGORY','TIER','STATUS','ACTIONS'].map(h => (
              <span key={h} style={{ fontSize:'9px', fontWeight:800, color:'#9E8E6E', letterSpacing:'1px' }}>{h}</span>
            ))}
          </div>

          {loading && <div style={{ padding:'40px', textAlign:'center', color:'#9E8E6E' }}>Loading...</div>}
          {!loading && salons.length === 0 && !error && (
            <div style={{ padding:'40px', textAlign:'center', color:'#9E8E6E' }}>No applications found</div>
          )}

          {!loading && salons.map((s, i) => {
            const st = STATUS_COLORS[s.approvalStatus] || STATUS_COLORS.PENDING
            const ct = CAT_COLORS[s.category] || CAT_COLORS.UNISEX
            return (
              <div key={s.id} style={{ display:'grid', gridTemplateColumns:'2fr 1.2fr 1fr 0.8fr 0.8fr 1fr 1fr', padding:'11px 14px', borderBottom:'1px solid #F0EAE0', alignItems:'center', gap:'8px', background:i%2===0?'#fff':'#FDFAF6' }}>
                <div>
                  <div style={{ fontSize:'13px', fontWeight:700, color:'#1A1A2E' }}>{v(s.shopName)}</div>
                  <div style={{ fontSize:'10px', color:'#9E8E6E', marginTop:'2px' }}>{dt(s.createdAt)}</div>
                </div>
                <div>
                  <div style={{ fontSize:'12px', color:'#1A1A2E', fontWeight:500 }}>{v(s.ownerName)}</div>
                  <div style={{ fontSize:'10px', color:'#9E8E6E' }}>{v(s.ownerPhone)}</div>
                </div>
                <div>
                  <div style={{ fontSize:'12px', color:'#1A1A2E' }}>{v(s.district)}</div>
                  <div style={{ fontSize:'10px', color:'#9E8E6E' }}>{v(s.state)}</div>
                </div>
                <span style={{ fontSize:'10px', fontWeight:700, background:ct.bg, color:ct.color, padding:'3px 6px', display:'inline-block' }}>{v(s.category)}</span>
                <span style={{ fontSize:'10px', color:'#6B5E3E', fontWeight:600 }}>{v(s.tier)}</span>
                <span style={{ fontSize:'9px', fontWeight:800, background:st.bg, color:st.color, padding:'3px 8px', display:'inline-block' }}>{v(s.approvalStatus)}</span>
                <div style={{ display:'flex', gap:'4px' }}>
                  <button onClick={() => setSelected(s)} style={{ background:'#1A1A2E', color:'#fff', border:'none', padding:'5px 8px', fontSize:'9px', fontWeight:700, cursor:'pointer' }}>REVIEW</button>
                  <button onClick={() => navigate(`/app/approvals/${s.id}`)} style={{ background:'#B8960C', color:'#fff', border:'none', padding:'5px 8px', fontSize:'9px', fontWeight:700, cursor:'pointer' }}>DETAIL</button>
                </div>
              </div>
            )
          })}

          {/* Pagination */}
          <div style={{ padding:'12px 14px', borderTop:'1px solid #E8DFD0', display:'flex', justifyContent:'space-between', alignItems:'center', background:'#FDFAF6' }}>
            <span style={{ fontSize:'11px', color:'#9E8E6E' }}>Showing {salons.length} of {pagination.total}</span>
            <div style={{ display:'flex', gap:'4px' }}>
              <button onClick={() => setPage(p => Math.max(1, p-1))} disabled={page===1}
                style={{ background:page===1?'#F5F0E8':'#1A1A2E', color:page===1?'#C4B49A':'#fff', border:'1px solid #D4C9B0', padding:'5px 10px', fontSize:'11px', fontWeight:700, cursor:page===1?'not-allowed':'pointer' }}>← PREV</button>
              <button onClick={() => setPage(p => Math.min(pagination.totalPages||1, p+1))} disabled={page===pagination.totalPages}
                style={{ background:page===pagination.totalPages?'#F5F0E8':'#1A1A2E', color:page===pagination.totalPages?'#C4B49A':'#fff', border:'1px solid #D4C9B0', padding:'5px 10px', fontSize:'11px', fontWeight:700, cursor:page===pagination.totalPages?'not-allowed':'pointer' }}>NEXT →</button>
            </div>
          </div>
        </BCard>
      </div>

      {selected && (
        <ReviewModal
          salon={selected}
          onClose={() => setSelected(null)}
          onApprove={handleApprove}
          onReject={handleReject}
          adminLevel={adminLevel}
          processing={processing}
        />
      )}

      <div style={{ background:'#0D1B2A', borderTop:'2px solid #B8960C', padding:'10px 20px', display:'flex', justifyContent:'space-between', marginTop:'14px' }}>
        <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.3)' }}>ZEMISH APPROVAL CENTER v1.0.0</span>
        <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.3)' }}>NATIONAL COMMAND CENTER</span>
      </div>
    </div>
  )
}