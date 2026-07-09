import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FONTS } from '../../config/brand'
import useAuthStore from '../../store/authStore'
import SalonsAPI from './api/salons.api'

const v    = (val, fb = '—') => (val !== null && val !== undefined && val !== '') ? val : fb
const date = (d) => d ? new Date(d).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' }) : '—'

const STATUS_COLORS = {
  APPROVED:  { bg: '#D1FAE5', color: '#065F46' },
  PENDING:   { bg: '#FEF9C3', color: '#92400E' },
  REJECTED:  { bg: '#FEE2E2', color: '#991B1B' },
  SUSPENDED: { bg: '#F3F4F6', color: '#374151' },
}
const TIER_COLORS = {
  STANDARD: { bg: '#F5F3FF', color: '#6D28D9' },
  PREMIUM:  { bg: '#EFF6FF', color: '#1D4ED8' },
  LUXURY:   { bg: '#FEF9C3', color: '#92400E' },
}
const CAT_COLORS = {
  MEN_ONLY:   { bg: '#EFF6FF', color: '#1D4ED8' },
  WOMEN_ONLY: { bg: '#FDF2F8', color: '#9D174D' },
  UNISEX:     { bg: '#F5F3FF', color: '#6D28D9' },
}

const STATUSES   = ['ALL', 'APPROVED', 'PENDING', 'REJECTED', 'SUSPENDED']
const CATEGORIES = ['ALL', 'MEN_ONLY', 'WOMEN_ONLY', 'UNISEX']
const PER_PAGE   = 20

const BCard = ({ children, style = {} }) => (
  <div style={{ background: '#fff', border: '1px solid #D4C9B0', borderTop: '2px solid #B8960C', ...style }}>{children}</div>
)
const BCardHeader = ({ title, action }) => (
  <div style={{ padding: '10px 14px', borderBottom: '1px solid #E8DFD0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#FDFAF6' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <div style={{ width: '3px', height: '14px', background: '#B8960C' }}/>
      <span style={{ fontSize: '12px', fontWeight: 700, color: '#1A1A2E', letterSpacing: '0.5px', textTransform: 'uppercase' }}>{title}</span>
    </div>
    {action}
  </div>
)
const Sel = ({ value, onChange, options }) => (
  <select value={value} onChange={e => onChange(e.target.value)}
    style={{ fontSize: '11px', border: '1px solid #D4C9B0', padding: '5px 8px', color: '#6B5E3E', background: '#FDFAF6', cursor: 'pointer', fontFamily: FONTS.body, outline: 'none' }}>
    {options.map(o => <option key={o}>{o}</option>)}
  </select>
)

export default function SalonsPage() {
  const navigate = useNavigate()
  const admin    = useAuthStore(s => s.admin)

  const [salons,     setSalons]     = useState([])
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState(null)
  const [pagination, setPagination] = useState({ page:1, limit:PER_PAGE, total:0, totalPages:1 })

  const [search,   setSearch]   = useState('')
  const [status,   setStatus]   = useState('ALL')
  const [category, setCategory] = useState('ALL')
  const [page,     setPage]     = useState(1)

  const scopeLabel = admin?.adminLevel === 'INDIA'
    ? 'PAN India'
    : admin?.stateRef?.name    ? `State: ${admin.stateRef.name}`
    : admin?.districtRef?.name ? `District: ${admin.districtRef.name}`
    : '—'

  const fetchSalons = async () => {
    setLoading(true)
    setError(null)
    try {
      const params = {
        page, limit: PER_PAGE,
        ...(search   && { search }),
        ...(status   !== 'ALL' && { status }),
        ...(category !== 'ALL' && { category }),
      }
      const res = await SalonsAPI.getAll(params)
      setSalons(res.data || [])
      if (res.pagination) setPagination(res.pagination)
    } catch (err) {
      setError(err.message || 'Failed to load salons')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchSalons() }, [page, status, category])

  const handleSearch = (e) => { if (e.key === 'Enter') { setPage(1); fetchSalons() } }
  const resetFilters = () => { setSearch(''); setStatus('ALL'); setCategory('ALL'); setPage(1) }

  const total = pagination.total || 0

  return (
    <div style={{ fontFamily: FONTS.body, background: '#F0EAE0', minHeight: '100vh' }}>

      {/* Header */}
      <div style={{ background: '#0D1B2A', borderBottom: '2px solid #B8960C', padding: '0 20px', height: '52px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ width: '3px', height: '16px', background: '#B8960C' }}/>
          <h1 style={{ fontSize: '13px', fontWeight: 800, color: '#fff', margin: 0, letterSpacing: '2px' }}>SALONS MASTER</h1>
          <span style={{ background: 'rgba(184,150,12,0.2)', color: '#B8960C', fontSize: '10px', fontWeight: 800, padding: '2px 8px', border: '1px solid rgba(184,150,12,0.3)' }}>
            {loading ? '...' : `${total} TOTAL`}
          </span>
          <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.35)' }}>|</span>
          <span style={{ fontSize: '10px', color: '#B8960C', fontWeight: 600 }}>{scopeLabel}</span>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button onClick={resetFilters} style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.6)', padding: '6px 12px', fontSize: '10px', fontWeight: 700, cursor: 'pointer' }}>
            RESET FILTERS
          </button>
          <button onClick={fetchSalons} style={{ background: '#B8960C', border: 'none', color: '#0D1B2A', padding: '6px 14px', fontSize: '10px', fontWeight: 800, cursor: 'pointer' }}>
            ↻ REFRESH
          </button>
        </div>
      </div>

      <div style={{ padding: '14px 20px' }}>

        {/* Error */}
        {error && (
          <div style={{ background: '#FEE2E2', border: '1px solid #DC2626', borderLeft: '4px solid #DC2626', padding: '10px 14px', marginBottom: '12px', fontSize: '13px', color: '#991B1B' }}>
            ⚠ {error} — <button onClick={fetchSalons} style={{ background: 'none', border: 'none', color: '#DC2626', cursor: 'pointer', fontWeight: 700, textDecoration: 'underline' }}>Retry</button>
          </div>
        )}

        {/* Stats Row */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: '10px', marginBottom: '12px' }}>
          {[
            { label: 'Total',     color: '#1A1A2E', f: 'ALL'       },
            { label: 'Approved',  color: '#065F46', f: 'APPROVED'  },
            { label: 'Pending',   color: '#D97706', f: 'PENDING'   },
            { label: 'Rejected',  color: '#DC2626', f: 'REJECTED'  },
            { label: 'Suspended', color: '#374151', f: 'SUSPENDED' },
          ].map(s => (
            <div key={s.label} onClick={() => { setStatus(s.f); setPage(1) }}
              style={{ background: status === s.f ? s.color : '#fff', border: `1px solid ${s.color}30`, borderTop: `2px solid ${s.color}`, padding: '12px 14px', cursor: 'pointer', textAlign: 'center' }}>
              <div style={{ fontSize: '22px', fontWeight: 800, color: status === s.f ? '#fff' : s.color }}>
                {loading ? '...' : s.f === 'ALL' ? total : '—'}
              </div>
              <div style={{ fontSize: '9px', color: status === s.f ? 'rgba(255,255,255,0.8)' : '#9E8E6E', textTransform: 'uppercase', letterSpacing: '0.5px', marginTop: '2px' }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* Filters */}
        <BCard style={{ marginBottom: '12px' }}>
          <BCardHeader title="Filters" action={
            <span style={{ fontSize: '11px', color: '#B8960C', fontWeight: 700, cursor: 'pointer' }} onClick={resetFilters}>RESET ALL</span>
          }/>
          <div style={{ padding: '12px 14px', display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
            <input value={search} onChange={e => setSearch(e.target.value)} onKeyDown={handleSearch}
              placeholder="Search salon, phone... (Press Enter)"
              style={{ flex: 1, minWidth: '240px', border: '1px solid #D4C9B0', padding: '6px 10px', fontSize: '12px', fontFamily: FONTS.body, outline: 'none', background: '#FDFAF6' }}
            />
            <Sel value={status}   onChange={v => { setStatus(v);   setPage(1) }} options={STATUSES}   />
            <Sel value={category} onChange={v => { setCategory(v); setPage(1) }} options={CATEGORIES} />
            <span style={{ fontSize: '11px', color: '#9E8E6E', fontWeight: 600 }}>
              {loading ? 'Loading...' : `${total} results`}
            </span>
          </div>
        </BCard>

        {/* Table */}
        <BCard>
          <BCardHeader
            title={`Salon Registry (${total})`}
            action={<span style={{ fontSize: '11px', color: '#9E8E6E' }}>Page {page} of {pagination.totalPages || 1}</span>}
          />

          {/* Head */}
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1.2fr 1.2fr 0.8fr 1fr 1fr 0.7fr 0.7fr 0.8fr 1fr', padding: '8px 14px', background: '#F5F0E8', borderBottom: '1px solid #E8DFD0', gap: '8px' }}>
            {['SALON NAME','OWNER','PHONE','CATEGORY','STATE','DISTRICT','TIER','RATING','STATUS','ACTIONS'].map(h => (
              <span key={h} style={{ fontSize: '9px', fontWeight: 800, color: '#9E8E6E', letterSpacing: '1px' }}>{h}</span>
            ))}
          </div>

          {/* Loading */}
          {loading && <div style={{ padding: '40px', textAlign: 'center', color: '#9E8E6E', fontSize: '13px' }}>Loading salons...</div>}

          {/* Empty */}
          {!loading && salons.length === 0 && !error && (
            <div style={{ padding: '40px', textAlign: 'center', color: '#9E8E6E', fontSize: '13px' }}>No salons found</div>
          )}

          {/* Rows */}
          {!loading && salons.map((s, i) => {
            const st  = STATUS_COLORS[s.status]   || STATUS_COLORS.PENDING
            const ct  = CAT_COLORS[s.category]    || CAT_COLORS.UNISEX
            const tt  = TIER_COLORS[s.tier]        || TIER_COLORS.STANDARD

            return (
              <div key={s.id || i} style={{ display: 'grid', gridTemplateColumns: '2fr 1.2fr 1.2fr 0.8fr 1fr 1fr 0.7fr 0.7fr 0.8fr 1fr', padding: '10px 14px', borderBottom: '1px solid #F0EAE0', alignItems: 'center', gap: '8px', background: i%2===0 ? '#fff' : '#FDFAF6' }}>

                {/* Salon Name */}
                <div>
                  <div style={{ fontSize: '12px', fontWeight: 700, color: '#1A1A2E' }}>{v(s.shopName)}</div>
                  <div style={{ fontSize: '10px', color: '#9E8E6E', marginTop: '1px' }}>{date(s.createdAt)}</div>
                </div>

                {/* Owner */}
                <div style={{ fontSize: '12px', color: '#1A1A2E', fontWeight: 500 }}>{v(s.ownerName)}</div>

                {/* Phone */}
                <div style={{ fontSize: '11px', color: '#6B5E3E', fontFamily: 'monospace' }}>{v(s.ownerPhone)}</div>

                {/* Category */}
                <span style={{ fontSize: '9px', fontWeight: 700, background: ct.bg, color: ct.color, padding: '2px 6px', display: 'inline-block' }}>{v(s.category)}</span>

                {/* State */}
                <div style={{ fontSize: '11px', color: '#1A1A2E' }}>{v(s.state)}</div>

                {/* District */}
                <div style={{ fontSize: '11px', color: '#6B5E3E' }}>{v(s.district)}</div>

                {/* Tier */}
                <span style={{ fontSize: '9px', fontWeight: 700, background: tt.bg, color: tt.color, padding: '2px 6px', display: 'inline-block' }}>{v(s.tier)}</span>

                {/* Rating */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                  {s.rating
                    ? <><span style={{ fontSize: '11px', color: '#B8960C', fontWeight: 700 }}>{s.rating}</span><span style={{ fontSize: '10px', color: '#B8960C' }}>★</span></>
                    : <span style={{ fontSize: '11px', color: '#C4B49A' }}>—</span>
                  }
                </div>

                {/* Status */}
                <span style={{ fontSize: '9px', fontWeight: 800, background: st.bg, color: st.color, padding: '2px 6px', display: 'inline-block', letterSpacing: '0.3px' }}>{v(s.status)}</span>

                {/* Actions */}
                <div style={{ display: 'flex', gap: '3px' }}>
                  <button onClick={() => navigate(`/app/salons/${s.id}`)}
                    style={{ background: '#1A1A2E', color: '#fff', border: 'none', padding: '4px 7px', fontSize: '9px', fontWeight: 700, cursor: 'pointer' }}>VIEW</button>
                  <button onClick={() => navigate(`/app/salons/${s.id}/edit`)}
                    style={{ background: '#B8960C', color: '#fff', border: 'none', padding: '4px 7px', fontSize: '9px', fontWeight: 700, cursor: 'pointer' }}>EDIT</button>
                </div>
              </div>
            )
          })}

          {/* Pagination */}
          <div style={{ padding: '12px 14px', borderTop: '1px solid #E8DFD0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#FDFAF6' }}>
            <span style={{ fontSize: '11px', color: '#9E8E6E' }}>
              {total === 0 ? 'No results' : `Showing ${((page-1)*PER_PAGE)+1}–${Math.min(page*PER_PAGE, total)} of ${total}`}
            </span>
            <div style={{ display: 'flex', gap: '4px' }}>
              <button onClick={() => setPage(p => Math.max(1, p-1))} disabled={page===1}
                style={{ background: page===1 ? '#F5F0E8' : '#1A1A2E', color: page===1 ? '#C4B49A' : '#fff', border: '1px solid #D4C9B0', padding: '5px 10px', fontSize: '11px', fontWeight: 700, cursor: page===1 ? 'not-allowed' : 'pointer' }}>← PREV</button>
              {Array.from({ length: Math.min(pagination.totalPages || 1, 10) }, (_, i) => i+1).map(p => (
                <button key={p} onClick={() => setPage(p)}
                  style={{ background: p===page ? '#B8960C' : '#fff', color: p===page ? '#fff' : '#6B5E3E', border: '1px solid #D4C9B0', padding: '5px 10px', fontSize: '11px', fontWeight: 700, cursor: 'pointer' }}>{p}</button>
              ))}
              <button onClick={() => setPage(p => Math.min(pagination.totalPages||1, p+1))} disabled={page===pagination.totalPages}
                style={{ background: page===pagination.totalPages ? '#F5F0E8' : '#1A1A2E', color: page===pagination.totalPages ? '#C4B49A' : '#fff', border: '1px solid #D4C9B0', padding: '5px 10px', fontSize: '11px', fontWeight: 700, cursor: page===pagination.totalPages ? 'not-allowed' : 'pointer' }}>NEXT →</button>
            </div>
          </div>
        </BCard>
      </div>

      {/* Footer */}
      <div style={{ background: '#0D1B2A', borderTop: '2px solid #B8960C', padding: '10px 20px', display: 'flex', justifyContent: 'space-between', marginTop: '14px' }}>
        <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.3)', letterSpacing: '0.5px' }}>ZEMISH SALON REGISTRY v1.0.0</span>
        <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.3)', letterSpacing: '0.5px' }}>NATIONAL COMMAND CENTER</span>
      </div>
    </div>
  )
}