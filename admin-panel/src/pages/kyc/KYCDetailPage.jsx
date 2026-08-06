import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { canApproveKYC, canRejectKYC, canVerifyAadhaar as canVerifyAadhaarRole, canVerifyBank as canVerifyBankRole, canVerifyPAN as canVerifyPANRole, canViewPII as canViewPIIRole } from '../../config/adminRoles'
import { FONTS } from '../../config/brand'
import useAuthStore from '../../store/authStore'
import KYCAPI from './api/kyc.api'

// ─── Helpers ─────────────────────────────────────────────
const v   = (val, fb = '—') => (val !== null && val !== undefined && val !== '') ? val : fb
const dt  = (d) => d ? new Date(d).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' }) : '—'
const dtm = (d) => d ? new Date(d).toLocaleString('en-IN') : '—'
const maskPhone = (p='') => p && p.length >= 4 ? p.slice(0,2)+'******'+p.slice(-2) : '******'
const maskEmail = (e='') => { if (!e || !e.includes('@')) return '***@***'; const [u,d]=e.split('@'); return u.slice(0,2)+'***@'+d }

// ─── Constants ────────────────────────────────────────────
const STATUS_COLORS = {
  DRAFT:              { bg:'#F3F4F6', color:'#374151' },
  PENDING:            { bg:'#FEF9C3', color:'#92400E' },
  UNDER_REVIEW:       { bg:'#EFF6FF', color:'#1D4ED8' },
  PARTIALLY_VERIFIED: { bg:'#FEF3C7', color:'#92400E' },
  VERIFIED:           { bg:'#D1FAE5', color:'#065F46' },
  REJECTED:           { bg:'#FEE2E2', color:'#991B1B' },
  EXPIRED:            { bg:'#F3F4F6', color:'#374151' },
  REVERIFY_REQUIRED:  { bg:'#FEF9C3', color:'#92400E' },
}

// ─── Components ──────────────────────────────────────────
const BCard = ({ children, style={} }) => (
  <div style={{ background:'#fff', border:'1px solid #D4C9B0', borderTop:'2px solid #B8960C', ...style }}>{children}</div>
)
const BCardHeader = ({ title, action }) => (
  <div style={{ padding:'10px 16px', borderBottom:'1px solid #E8DFD0', display:'flex', justifyContent:'space-between', alignItems:'center', background:'#FDFAF6' }}>
    <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
      <div style={{ width:'3px', height:'14px', background:'#B8960C' }}/>
      <span style={{ fontSize:'11px', fontWeight:800, color:'#1A1A2E', letterSpacing:'1px', textTransform:'uppercase' }}>{title}</span>
    </div>
    {action}
  </div>
)
const InfoRow = ({ label, value, valueColor }) => (
  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'7px 0', borderBottom:'1px solid #F0EAE0' }}>
    <span style={{ fontSize:'12px', color:'#9E8E6E' }}>{label}</span>
    <span style={{ fontSize:'12px', fontWeight:600, color:valueColor||'#1A1A2E', textAlign:'right', maxWidth:'65%' }}>{v(value)}</span>
  </div>
)
const SLabel = ({ title }) => (
  <div style={{ display:'flex', alignItems:'center', gap:'8px', margin:'12px 0 8px' }}>
    <div style={{ width:'3px', height:'12px', background:'#B8960C' }}/>
    <span style={{ fontSize:'9px', fontWeight:800, color:'#9E8E6E', letterSpacing:'2px', textTransform:'uppercase' }}>{title}</span>
  </div>
)

const DocCard = ({ label, doc }) => {
  const submitted = !!doc
  const verified  = doc?.status === 'APPROVED'
  const rejected  = doc?.status === 'REJECTED'
  const borderColor = verified ? '#059669' : rejected ? '#DC2626' : submitted ? '#B8960C' : '#DC2626'
  const statusLabel = verified ? '✓ APPROVED' : rejected ? '✗ REJECTED' : submitted ? 'UPLOADED' : '✗ MISSING'
  const statusBg    = verified ? '#D1FAE5' : rejected ? '#FEE2E2' : submitted ? '#FEF9C3' : '#FEE2E2'
  const statusColor = verified ? '#065F46' : rejected ? '#991B1B' : submitted ? '#92400E' : '#991B1B'

  return (
    <div style={{ padding:'12px', background:submitted?'#FDFAF6':'#FEF2F2', border:`1px solid ${submitted?'#D4C9B0':'#FEE2E2'}`, borderTop:`2px solid ${borderColor}` }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'6px' }}>
        <span style={{ fontSize:'11px', fontWeight:800, color:'#1A1A2E' }}>{label}</span>
        <span style={{ fontSize:'9px', fontWeight:800, background:statusBg, color:statusColor, padding:'2px 6px' }}>{statusLabel}</span>
      </div>
      {submitted && (
        <div style={{ fontSize:'10px', color:'#9E8E6E' }}>
          v{doc.version ?? 1} • {dt(doc.uploadedAt)}
          {doc.rejectedReason && <div style={{ color:'#DC2626', marginTop:'2px' }}>✗ {doc.rejectedReason}</div>}
        </div>
      )}
      {!submitted && <div style={{ fontSize:'10px', color:'#9E8E6E' }}>Not submitted yet</div>}
      {submitted && doc.thumbnailUrl && (
        <div style={{ marginTop:'8px' }}>
          <img src={doc.thumbnailUrl} alt={label} style={{ width:'100%', maxHeight:'80px', objectFit:'cover', border:'1px solid #E8DFD0' }}/>
        </div>
      )}
    </div>
  )
}

// ─── Reject Modal ─────────────────────────────────────────
function RejectModal({ kyc, onConfirm, onCancel, processing }) {
  const [reason, setReason] = useState('')
  const valid = reason.trim().length >= 10

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.75)', zIndex:2000, display:'flex', alignItems:'center', justifyContent:'center' }}>
      <div style={{ background:'#fff', width:'440px', border:'2px solid #DC2626' }}>
        <div style={{ background:'#7F1D1D', padding:'14px 18px', borderBottom:'2px solid #DC2626' }}>
          <div style={{ color:'#fff', fontWeight:800, fontSize:'13px', letterSpacing:'1px' }}>✗ REJECT KYC</div>
          <div style={{ color:'rgba(255,255,255,0.6)', fontSize:'10px', marginTop:'2px' }}>{v(kyc.owner?.name)} — {kyc.id}</div>
        </div>
        <div style={{ padding:'20px 18px' }}>
          <div style={{ background:'#FEF2F2', border:'1px solid #FEE2E2', padding:'10px', marginBottom:'14px', fontSize:'11px', color:'#991B1B', fontWeight:600 }}>
            ⚠ Provider will be notified with rejection reason and can resubmit documents.
          </div>
          <label style={{ fontSize:'10px', color:'#9E8E6E', fontWeight:800, letterSpacing:'1px', display:'block', marginBottom:'6px' }}>
            REJECTION REASON (REQUIRED — min 10 chars)
          </label>
          <textarea value={reason} onChange={e => setReason(e.target.value)}
            placeholder="e.g. Selfie does not match Aadhaar photo..."
            style={{ width:'100%', border:`1px solid ${valid?'#D4C9B0':'#FCA5A5'}`, padding:'8px 12px', fontSize:'13px', fontFamily:FONTS.body, outline:'none', minHeight:'80px', resize:'vertical', boxSizing:'border-box', marginBottom:'6px' }}
          />
          <div style={{ fontSize:'10px', color:valid?'#059669':'#9E8E6E', marginBottom:'14px' }}>
            {reason.trim().length}/500 {valid ? '✓' : `(need ${10-reason.trim().length} more)`}
          </div>
          <div style={{ display:'flex', gap:'8px', justifyContent:'flex-end' }}>
            <button onClick={onCancel} style={{ background:'#fff', border:'1px solid #D4C9B0', color:'#6B5E3E', padding:'8px 16px', fontSize:'11px', fontWeight:700, cursor:'pointer' }}>CANCEL</button>
            <button onClick={() => valid && onConfirm(reason.trim())} disabled={!valid || processing}
              style={{ background:valid?'#DC2626':'#F5F0E8', border:'none', color:valid?'#fff':'#C4B49A', padding:'8px 20px', fontSize:'11px', fontWeight:800, cursor:valid?'pointer':'not-allowed', opacity:processing?0.7:1 }}>
              {processing ? 'PROCESSING...' : '✗ REJECT KYC'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Request Reupload Modal ───────────────────────────────
function ReuploadModal({ onConfirm, onCancel, processing }) {
  const [documentType, setDocumentType] = useState('panCard')
  const [reason,       setReason]       = useState('')
  const valid = reason.trim().length >= 5

  const DOC_OPTIONS = [
    { value:'panCard',         label:'PAN Card' },
    { value:'aadhaarFront',    label:'Aadhaar Front' },
    { value:'aadhaarBack',     label:'Aadhaar Back' },
    { value:'cancelledCheque', label:'Cancelled Cheque' },
    { value:'gstCertificate',  label:'GST Certificate' },
    { value:'selfie',          label:'Selfie' },
  ]

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.75)', zIndex:2000, display:'flex', alignItems:'center', justifyContent:'center' }}>
      <div style={{ background:'#fff', width:'440px', border:'2px solid #D97706' }}>
        <div style={{ background:'#78350F', padding:'14px 18px', borderBottom:'2px solid #D97706' }}>
          <div style={{ color:'#fff', fontWeight:800, fontSize:'13px', letterSpacing:'1px' }}>↑ REQUEST RE-UPLOAD</div>
          <div style={{ color:'rgba(255,255,255,0.6)', fontSize:'10px', marginTop:'2px' }}>Provider will be asked to re-upload document</div>
        </div>
        <div style={{ padding:'20px 18px' }}>
          <label style={{ fontSize:'10px', color:'#9E8E6E', fontWeight:800, letterSpacing:'1px', display:'block', marginBottom:'6px' }}>DOCUMENT TYPE</label>
          <select value={documentType} onChange={e => setDocumentType(e.target.value)}
            style={{ width:'100%', border:'1px solid #D4C9B0', padding:'8px 10px', fontSize:'12px', fontFamily:FONTS.body, outline:'none', marginBottom:'14px', background:'#FDFAF6' }}>
            {DOC_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <label style={{ fontSize:'10px', color:'#9E8E6E', fontWeight:800, letterSpacing:'1px', display:'block', marginBottom:'6px' }}>REASON (REQUIRED)</label>
          <textarea value={reason} onChange={e => setReason(e.target.value)}
            placeholder="e.g. Image is blurry, document expired..."
            style={{ width:'100%', border:'1px solid #D4C9B0', padding:'8px 12px', fontSize:'13px', fontFamily:FONTS.body, outline:'none', minHeight:'70px', resize:'vertical', boxSizing:'border-box', marginBottom:'14px' }}
          />
          <div style={{ display:'flex', gap:'8px', justifyContent:'flex-end' }}>
            <button onClick={onCancel} style={{ background:'#fff', border:'1px solid #D4C9B0', color:'#6B5E3E', padding:'8px 16px', fontSize:'11px', fontWeight:700, cursor:'pointer' }}>CANCEL</button>
            <button onClick={() => valid && onConfirm(documentType, reason.trim())} disabled={!valid || processing}
              style={{ background:valid?'#D97706':'#F5F0E8', border:'none', color:valid?'#fff':'#C4B49A', padding:'8px 20px', fontSize:'11px', fontWeight:800, cursor:valid?'pointer':'not-allowed', opacity:processing?0.7:1 }}>
              {processing ? 'PROCESSING...' : '↑ REQUEST RE-UPLOAD'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Verify Bank Modal ────────────────────────────────────
// PATCH .../verify-bank requires the admin to re-enter the full raw
// account number (not just confirm the masked value on file) — this
// mirrors the backend's own real requirement (verifyBankHandler in
// adminKyc.controller.js), not an invented UI step. accountHolder/
// ifsc/bankName are pre-filled from what's already visible on this
// page (non-sensitive); the account number is never pre-filled,
// same principle already applied in the owner-app's bank screen —
// only a masked value is ever available to pre-fill from.
const IFSC_REGEX = /^[A-Z]{4}0[A-Z0-9]{6}$/

function VerifyBankModal({ kyc, onConfirm, onCancel, processing }) {
  const [accountHolder, setAccountHolder] = useState(kyc.bank?.accountHolder || '')
  const [accountNumber, setAccountNumber] = useState('')
  const [ifsc,          setIfsc]          = useState(kyc.bank?.ifsc || '')
  const [bankName,      setBankName]      = useState(kyc.bank?.bankName || '')

  const digitsOnly = accountNumber.replace(/\D/g, '')
  const valid = accountHolder.trim().length > 0
    && digitsOnly.length >= 9 && digitsOnly.length <= 18
    && IFSC_REGEX.test(ifsc.trim().toUpperCase())
    && bankName.trim().length > 0

  const fieldStyle = { width:'100%', border:'1px solid #D4C9B0', padding:'8px 10px', fontSize:'13px', fontFamily:FONTS.body, outline:'none', marginBottom:'12px', boxSizing:'border-box' }
  const labelStyle = { fontSize:'10px', color:'#9E8E6E', fontWeight:800, letterSpacing:'1px', display:'block', marginBottom:'6px' }

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.75)', zIndex:2000, display:'flex', alignItems:'center', justifyContent:'center' }}>
      <div style={{ background:'#fff', width:'440px', border:'2px solid #059669' }}>
        <div style={{ background:'#065F46', padding:'14px 18px', borderBottom:'2px solid #059669' }}>
          <div style={{ color:'#fff', fontWeight:800, fontSize:'13px', letterSpacing:'1px' }}>✓ VERIFY BANK ACCOUNT</div>
          <div style={{ color:'rgba(255,255,255,0.6)', fontSize:'10px', marginTop:'2px' }}>{v(kyc.owner?.name)} — {kyc.id}</div>
        </div>
        <div style={{ padding:'20px 18px' }}>
          <div style={{ background:'#F0FDF4', border:'1px solid #D1FAE5', padding:'10px', marginBottom:'14px', fontSize:'11px', color:'#065F46', fontWeight:600 }}>
            ℹ Re-enter the account number exactly as it appears on the cancelled cheque/passbook document to confirm this is a genuine, matching account. This unlocks payouts for the provider.
          </div>

          <label style={labelStyle}>ACCOUNT HOLDER NAME</label>
          <input value={accountHolder} onChange={e => setAccountHolder(e.target.value)} style={fieldStyle} placeholder="As per bank records"/>

          <label style={labelStyle}>ACCOUNT NUMBER (9–18 DIGITS)</label>
          <input value={accountNumber} onChange={e => setAccountNumber(e.target.value)} style={fieldStyle} placeholder="Re-enter to confirm"/>

          <label style={labelStyle}>IFSC CODE</label>
          <input value={ifsc} onChange={e => setIfsc(e.target.value.toUpperCase())} style={fieldStyle} placeholder="e.g. HDFC0001234" maxLength={11}/>

          <label style={labelStyle}>BANK NAME</label>
          <input value={bankName} onChange={e => setBankName(e.target.value)} style={fieldStyle} placeholder="e.g. HDFC Bank"/>

          <div style={{ display:'flex', gap:'8px', justifyContent:'flex-end', marginTop:'4px' }}>
            <button onClick={onCancel} style={{ background:'#fff', border:'1px solid #D4C9B0', color:'#6B5E3E', padding:'8px 16px', fontSize:'11px', fontWeight:700, cursor:'pointer' }}>CANCEL</button>
            <button
              onClick={() => valid && onConfirm({ accountHolder: accountHolder.trim(), accountNumber: accountNumber.trim(), ifsc: ifsc.trim().toUpperCase(), bankName: bankName.trim() })}
              disabled={!valid || processing}
              style={{ background:valid?'#059669':'#F5F0E8', border:'none', color:valid?'#fff':'#C4B49A', padding:'8px 20px', fontSize:'11px', fontWeight:800, cursor:valid?'pointer':'not-allowed', opacity:processing?0.7:1 }}>
              {processing ? 'VERIFYING...' : '✓ VERIFY BANK'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Verify PAN Modal ─────────────────────────────────────
// PATCH .../verify-pan requires panNumber (validated server-side
// against ^[A-Z]{5}[0-9]{4}[A-Z]{1}$) — mirrors VerifyBankModal's
// exact pattern/styling. nameOnPAN is optional, matching the
// backend handler's own `nameOnPAN?.trim() || null`.
const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/

function VerifyPANModal({ kyc, onConfirm, onCancel, processing }) {
  const [panNumber, setPanNumber] = useState('')
  const [nameOnPAN, setNameOnPAN] = useState(kyc.owner?.name || '')

  const valid = PAN_REGEX.test(panNumber.trim().toUpperCase())

  const fieldStyle = { width:'100%', border:'1px solid #D4C9B0', padding:'8px 10px', fontSize:'13px', fontFamily:FONTS.body, outline:'none', marginBottom:'12px', boxSizing:'border-box' }
  const labelStyle = { fontSize:'10px', color:'#9E8E6E', fontWeight:800, letterSpacing:'1px', display:'block', marginBottom:'6px' }

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.75)', zIndex:2000, display:'flex', alignItems:'center', justifyContent:'center' }}>
      <div style={{ background:'#fff', width:'440px', border:'2px solid #059669' }}>
        <div style={{ background:'#065F46', padding:'14px 18px', borderBottom:'2px solid #059669' }}>
          <div style={{ color:'#fff', fontWeight:800, fontSize:'13px', letterSpacing:'1px' }}>✓ VERIFY PAN</div>
          <div style={{ color:'rgba(255,255,255,0.6)', fontSize:'10px', marginTop:'2px' }}>{v(kyc.owner?.name)} — {kyc.id}</div>
        </div>
        <div style={{ padding:'20px 18px' }}>
          <div style={{ background:'#F0FDF4', border:'1px solid #D1FAE5', padding:'10px', marginBottom:'14px', fontSize:'11px', color:'#065F46', fontWeight:600 }}>
            ℹ Enter the PAN number exactly as it appears on the uploaded document.
          </div>

          <label style={labelStyle}>PAN NUMBER</label>
          <input value={panNumber} onChange={e => setPanNumber(e.target.value.toUpperCase())} style={fieldStyle} placeholder="ABCDE1234F" maxLength={10}/>

          <label style={labelStyle}>NAME ON PAN (OPTIONAL)</label>
          <input value={nameOnPAN} onChange={e => setNameOnPAN(e.target.value)} style={fieldStyle} placeholder="As per PAN card"/>

          <div style={{ display:'flex', gap:'8px', justifyContent:'flex-end', marginTop:'4px' }}>
            <button onClick={onCancel} style={{ background:'#fff', border:'1px solid #D4C9B0', color:'#6B5E3E', padding:'8px 16px', fontSize:'11px', fontWeight:700, cursor:'pointer' }}>CANCEL</button>
            <button
              onClick={() => valid && onConfirm({ panNumber: panNumber.trim().toUpperCase(), nameOnPAN: nameOnPAN.trim() || undefined })}
              disabled={!valid || processing}
              style={{ background:valid?'#059669':'#F5F0E8', border:'none', color:valid?'#fff':'#C4B49A', padding:'8px 20px', fontSize:'11px', fontWeight:800, cursor:valid?'pointer':'not-allowed', opacity:processing?0.7:1 }}>
              {processing ? 'VERIFYING...' : '✓ VERIFY PAN'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Verify Aadhaar Modal ─────────────────────────────────
// PATCH .../verify-aadhaar requires last4 (exactly 4 digits, matching
// the backend's ^\d{4}$ check) — mirrors VerifyBankModal's pattern.
function VerifyAadhaarModal({ kyc, onConfirm, onCancel, processing }) {
  const [last4, setLast4] = useState('')
  const valid = /^\d{4}$/.test(last4.trim())

  const fieldStyle = { width:'100%', border:'1px solid #D4C9B0', padding:'8px 10px', fontSize:'13px', fontFamily:FONTS.body, outline:'none', marginBottom:'12px', boxSizing:'border-box' }
  const labelStyle = { fontSize:'10px', color:'#9E8E6E', fontWeight:800, letterSpacing:'1px', display:'block', marginBottom:'6px' }

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.75)', zIndex:2000, display:'flex', alignItems:'center', justifyContent:'center' }}>
      <div style={{ background:'#fff', width:'440px', border:'2px solid #059669' }}>
        <div style={{ background:'#065F46', padding:'14px 18px', borderBottom:'2px solid #059669' }}>
          <div style={{ color:'#fff', fontWeight:800, fontSize:'13px', letterSpacing:'1px' }}>✓ VERIFY AADHAAR</div>
          <div style={{ color:'rgba(255,255,255,0.6)', fontSize:'10px', marginTop:'2px' }}>{v(kyc.owner?.name)} — {kyc.id}</div>
        </div>
        <div style={{ padding:'20px 18px' }}>
          <div style={{ background:'#F0FDF4', border:'1px solid #D1FAE5', padding:'10px', marginBottom:'14px', fontSize:'11px', color:'#065F46', fontWeight:600 }}>
            ℹ Enter the last 4 digits of the Aadhaar number as it appears on the uploaded document.
          </div>

          <label style={labelStyle}>LAST 4 DIGITS</label>
          <input value={last4} onChange={e => setLast4(e.target.value.replace(/\D/g, '').slice(0,4))} style={fieldStyle} placeholder="1234" maxLength={4} inputMode="numeric"/>

          <div style={{ display:'flex', gap:'8px', justifyContent:'flex-end', marginTop:'4px' }}>
            <button onClick={onCancel} style={{ background:'#fff', border:'1px solid #D4C9B0', color:'#6B5E3E', padding:'8px 16px', fontSize:'11px', fontWeight:700, cursor:'pointer' }}>CANCEL</button>
            <button
              onClick={() => valid && onConfirm({ last4: last4.trim() })}
              disabled={!valid || processing}
              style={{ background:valid?'#059669':'#F5F0E8', border:'none', color:valid?'#fff':'#C4B49A', padding:'8px 20px', fontSize:'11px', fontWeight:800, cursor:valid?'pointer':'not-allowed', opacity:processing?0.7:1 }}>
              {processing ? 'VERIFYING...' : '✓ VERIFY AADHAAR'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────
export default function KYCDetailPage() {
  const { id }     = useParams()
  const navigate   = useNavigate()
  const admin      = useAuthStore(s => s.admin)
  const adminLevel = admin?.adminLevel || 'INDIA'

  const hasApprove        = canApproveKYC(adminLevel)
  const hasReject         = canRejectKYC(adminLevel)
  const hasVerifyBank     = canVerifyBankRole(adminLevel)
  const hasVerifyPAN      = canVerifyPANRole(adminLevel)
  const hasVerifyAadhaar  = canVerifyAadhaarRole(adminLevel)
  const hasPII            = canViewPIIRole(adminLevel)

  const [kyc,                 setKyc]                = useState(null)
  const [loading,             setLoading]            = useState(true)
  const [error,               setError]              = useState(null)
  const [processing,          setProcessing]         = useState(false)
  const [tab,                 setTab]                = useState('overview')
  const [toast,               setToast]              = useState(null)
  const [rejectModal,         setRejectModal]        = useState(false)
  const [reuploadModal,       setReuploadModal]      = useState(false)
  const [verifyBankModal,     setVerifyBankModal]    = useState(false)
  const [verifyPANModal,      setVerifyPANModal]     = useState(false)
  const [verifyAadhaarModal,  setVerifyAadhaarModal] = useState(false)

  const showToast = (msg, color = '#059669') => {
    setToast({ msg, color })
    setTimeout(() => setToast(null), 3500)
  }

  const fetchKYC = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await KYCAPI.getById(id)
      setKyc(res.data)
    } catch (err) {
      setError(err.message || 'Failed to load')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchKYC() }, [id])

  const handleApprove = async () => {
    setProcessing(true)
    try {
      await KYCAPI.approve(id, {})
      showToast('✓ KYC approved successfully', '#059669')
      fetchKYC()
    } catch (err) {
      showToast(`⚠ ${err.message}`, '#DC2626')
    } finally {
      setProcessing(false)
    }
  }

  const handleReject = async (reason) => {
    setProcessing(true)
    try {
      await KYCAPI.reject(id, { reason })
      showToast('✗ KYC rejected', '#DC2626')
      setRejectModal(false)
      fetchKYC()
    } catch (err) {
      showToast(`⚠ ${err.message}`, '#DC2626')
    } finally {
      setProcessing(false)
    }
  }

  const handleReupload = async (documentType, reason) => {
    setProcessing(true)
    try {
      await KYCAPI.requestReupload(id, { documentType, reason })
      showToast(`↑ Re-upload requested for ${documentType}`, '#D97706')
      setReuploadModal(false)
      fetchKYC()
    } catch (err) {
      showToast(`⚠ ${err.message}`, '#DC2626')
    } finally {
      setProcessing(false)
    }
  }

  const handleVerifyBank = async (body) => {
    setProcessing(true)
    try {
      await KYCAPI.verifyBank(id, body)
      showToast('✓ Bank account verified', '#059669')
      setVerifyBankModal(false)
      fetchKYC()
    } catch (err) {
      // Real backend message surfaced verbatim (e.g. invalid IFSC
      // format, invalid account number length) — never replaced with
      // a guessed client-side string.
      showToast(`⚠ ${err.message}`, '#DC2626')
    } finally {
      setProcessing(false)
    }
  }

  const handleVerifyPAN = async (body) => {
    setProcessing(true)
    try {
      const res = await KYCAPI.verifyPAN(id, body)
      // Backend can respond 200 with success:false (e.g. provider
      // mismatch from the verification service) — surface that
      // distinctly from a network/validation failure.
      const ok = res.data?.panVerified ?? true
      showToast(ok ? '✓ PAN verified' : `⚠ ${res.message || 'PAN verification failed'}`, ok ? '#059669' : '#D97706')
      setVerifyPANModal(false)
      fetchKYC()
    } catch (err) {
      showToast(`⚠ ${err.message}`, '#DC2626')
    } finally {
      setProcessing(false)
    }
  }

  const handleVerifyAadhaar = async (body) => {
    setProcessing(true)
    try {
      const res = await KYCAPI.verifyAadhaar(id, body)
      const ok = res.data?.aadhaarVerified ?? true
      showToast(ok ? '✓ Aadhaar verified' : `⚠ ${res.message || 'Aadhaar verification failed'}`, ok ? '#059669' : '#D97706')
      setVerifyAadhaarModal(false)
      fetchKYC()
    } catch (err) {
      showToast(`⚠ ${err.message}`, '#DC2626')
    } finally {
      setProcessing(false)
    }
  }

  if (loading) return (
    <div style={{ minHeight:'100vh', background:'#F0EAE0', display:'flex', alignItems:'center', justifyContent:'center', fontFamily:FONTS.body, color:'#9E8E6E' }}>
      Loading KYC...
    </div>
  )
  if (error) return (
    <div style={{ minHeight:'100vh', background:'#F0EAE0', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', fontFamily:FONTS.body, gap:'12px' }}>
      <div style={{ color:'#DC2626' }}>⚠ {error}</div>
      <button onClick={fetchKYC} style={{ background:'#1A1A2E', color:'#fff', border:'none', padding:'8px 20px', cursor:'pointer', fontWeight:700 }}>RETRY</button>
    </div>
  )
  if (!kyc) return (
    <div style={{ minHeight:'100vh', background:'#F0EAE0', display:'flex', alignItems:'center', justifyContent:'center', fontFamily:FONTS.body }}>
      <div style={{ background:'#fff', border:'2px solid #D4C9B0', borderTop:'2px solid #B8960C', padding:'40px', textAlign:'center' }}>
        <div style={{ fontSize:'40px', marginBottom:'16px' }}>🔍</div>
        <div style={{ fontSize:'16px', fontWeight:800, color:'#1A1A2E', marginBottom:'8px' }}>KYC Not Found</div>
        <button onClick={() => navigate('/app/kyc')} style={{ background:'#0D1B2A', color:'#B8960C', border:'none', padding:'8px 20px', fontSize:'12px', fontWeight:700, cursor:'pointer' }}>← GO BACK</button>
      </div>
    </div>
  )

  const sc    = STATUS_COLORS[kyc.status] || { bg:'#F3F4F6', color:'#374151' }
  const docs  = kyc.documents || {}
  const vf    = kyc.verification || {}
  const TABS  = ['overview', 'documents', 'verification', 'risk', 'audit']
  const isPending = ['PENDING','UNDER_REVIEW','PARTIALLY_VERIFIED'].includes(kyc.status)

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
          <button onClick={() => navigate('/app/kyc')} style={{ background:'rgba(255,255,255,0.07)', border:'1px solid rgba(255,255,255,0.1)', color:'rgba(255,255,255,0.6)', padding:'5px 10px', cursor:'pointer', fontSize:'12px', fontWeight:700 }}>← BACK</button>
          <div style={{ width:'3px', height:'16px', background:'#B8960C' }}/>
          <div>
            <div style={{ color:'#fff', fontWeight:800, fontSize:'13px', letterSpacing:'1px' }}>{v(kyc.owner?.name)} — KYC Review</div>
            <div style={{ color:'#B8960C', fontSize:'9px', letterSpacing:'1px', marginTop:'1px' }}>
              {kyc.id} • Level {kyc.verificationLevel ?? 0}/7 • Submitted {dt(kyc.timeline?.submittedAt)}
            </div>
          </div>
          <span style={{ fontSize:'10px', fontWeight:800, background:sc.bg, color:sc.color, padding:'3px 8px' }}>{v(kyc.status)}</span>
          {kyc.risk?.manualReviewRequired && (
            <span style={{ fontSize:'10px', fontWeight:800, background:'rgba(124,58,237,0.2)', color:'#C4B5FD', padding:'3px 8px', border:'1px solid rgba(124,58,237,0.3)' }}>⚠ HIGH RISK</span>
          )}
        </div>
        <div style={{ display:'flex', gap:'8px' }}>
          <button onClick={fetchKYC} style={{ background:'rgba(255,255,255,0.07)', border:'1px solid rgba(255,255,255,0.15)', color:'rgba(255,255,255,0.5)', padding:'5px 10px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>↻</button>
          {kyc.owner?.id && (
            <button onClick={() => navigate(`/app/providers/${kyc.owner.id}`)} style={{ background:'rgba(184,150,12,0.15)', border:'1px solid rgba(184,150,12,0.4)', color:'#B8960C', padding:'6px 12px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>VIEW PROVIDER</button>
          )}
          {isPending && hasReject && (
            <button onClick={() => setReuploadModal(true)} style={{ background:'rgba(217,119,6,0.2)', border:'1px solid rgba(217,119,6,0.5)', color:'#FDE68A', padding:'6px 12px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>↑ RE-UPLOAD</button>
          )}
          {isPending && hasReject && (
            <button onClick={() => setRejectModal(true)} style={{ background:'rgba(220,38,38,0.2)', border:'1px solid rgba(220,38,38,0.5)', color:'#FCA5A5', padding:'6px 12px', fontSize:'10px', fontWeight:700, cursor:'pointer' }}>✗ REJECT</button>
          )}
          {isPending && hasApprove && (
            <button onClick={handleApprove} disabled={processing} style={{ background:'rgba(5,150,105,0.2)', border:'1px solid rgba(5,150,105,0.5)', color:'#6EE7B7', padding:'6px 14px', fontSize:'10px', fontWeight:700, cursor:'pointer', opacity:processing?0.7:1 }}>✓ APPROVE</button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div style={{ background:'#0A1520', borderBottom:'1px solid rgba(184,150,12,0.2)', display:'flex', padding:'0 20px', overflowX:'auto' }}>
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)} style={{ padding:'10px 16px', border:'none', background:'none', cursor:'pointer', fontSize:'10px', fontWeight:tab===t?800:400, color:tab===t?'#B8960C':'rgba(255,255,255,0.35)', borderBottom:tab===t?'2px solid #B8960C':'2px solid transparent', letterSpacing:'1.5px', textTransform:'uppercase', whiteSpace:'nowrap' }}>
            {t}
            {t==='audit' && <span style={{ marginLeft:'5px', background:'rgba(184,150,12,0.3)', color:'#B8960C', fontSize:'9px', padding:'1px 5px' }}>{kyc.auditLogs?.length ?? 0}</span>}
          </button>
        ))}
      </div>

      {/* KPI Strip */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:'1px', background:'#D4C9B0', borderBottom:'2px solid #B8960C' }}>
        {[
          { label:'Verify Level',  value:`${kyc.verificationLevel ?? 0}/7`,    color:'#7C3AED' },
          { label:'Risk Score',    value:`${kyc.risk?.score ?? 0}/100`,         color: (kyc.risk?.score??0) > 60 ? '#DC2626' : '#059669' },
          { label:'Phone',         value: vf.phone?.verified ? '✓' : '✗',      color: vf.phone?.verified ? '#059669' : '#DC2626' },
          { label:'PAN',           value: vf.pan?.verified   ? '✓' : '✗',      color: vf.pan?.verified   ? '#059669' : '#DC2626' },
          { label:'Bank',          value: vf.bank?.verified  ? '✓' : '✗',      color: vf.bank?.verified  ? '#059669' : '#DC2626' },
        ].map(k => (
          <div key={k.label} style={{ background:'#0D1B2A', padding:'10px 16px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
            <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.4)' }}>{k.label}</span>
            <span style={{ fontSize:'16px', fontWeight:800, color:k.color }}>{k.value}</span>
          </div>
        ))}
      </div>

      {/* Status Banners */}
      {kyc.status === 'REJECTED' && kyc.review?.rejectReason && (
        <div style={{ background:'#FEF2F2', borderBottom:'2px solid #DC2626', padding:'10px 20px' }}>
          <span style={{ fontSize:'12px', color:'#991B1B', fontWeight:700 }}>✗ REJECTED — {kyc.review.rejectReason}</span>
        </div>
      )}
      {kyc.status === 'VERIFIED' && (
        <div style={{ background:'#F0FDF4', borderBottom:'2px solid #059669', padding:'10px 20px' }}>
          <span style={{ fontSize:'12px', color:'#065F46', fontWeight:700 }}>✓ VERIFIED — Expires {dt(kyc.timeline?.expiresAt)}</span>
        </div>
      )}
      {kyc.status === 'REVERIFY_REQUIRED' && (
        <div style={{ background:'#FFFBEB', borderBottom:'2px solid #D97706', padding:'10px 20px' }}>
          <span style={{ fontSize:'12px', color:'#92400E', fontWeight:700 }}>⚠ RE-UPLOAD REQUESTED — Provider needs to resubmit documents</span>
        </div>
      )}

      <div style={{ padding:'16px 20px' }}>

        {/* ── OVERVIEW ── */}
        {tab === 'overview' && (
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'14px' }}>
            <BCard>
              <BCardHeader title="Provider Information"/>
              <div style={{ padding:'14px' }}>
                <div style={{ display:'flex', alignItems:'center', gap:'12px', padding:'12px', background:'#F5F0E8', border:'1px solid #E8DFD0', borderTop:'2px solid #B8960C', marginBottom:'14px' }}>
                  <div style={{ width:'44px', height:'44px', background:'#0D1B2A', display:'flex', alignItems:'center', justifyContent:'center', color:'#B8960C', fontSize:'18px', fontWeight:800, flexShrink:0 }}>
                    {(kyc.owner?.name||'?')[0].toUpperCase()}
                  </div>
                  <div>
                    <div style={{ fontSize:'15px', fontWeight:800, color:'#1A1A2E' }}>{v(kyc.owner?.name)}</div>
                    <div style={{ fontSize:'10px', color:'#9E8E6E', marginTop:'2px' }}>Provider • {v(kyc.owner?.accountStatus)}</div>
                  </div>
                </div>
                <SLabel title="Contact"/>
                <InfoRow label="Phone" value={hasPII ? v(kyc.owner?.phone) : maskPhone(kyc.owner?.phone||'')}/>
                <InfoRow label="Email" value={hasPII ? v(kyc.owner?.email) : kyc.owner?.email ? maskEmail(kyc.owner.email) : '—'}/>
                <SLabel title="Identity"/>
                <InfoRow label="PAN"     value={v(kyc.identity?.pan?.maskedNumber)}/>
                <InfoRow label="Aadhaar" value={v(kyc.identity?.aadhaar?.maskedNumber)}/>
                <InfoRow label="GST"     value={v(kyc.identity?.gst?.maskedNumber)}/>
                <SLabel title="Bank"/>
                <InfoRow label="Account" value={v(kyc.bank?.maskedAccount)}/>
                <InfoRow label="IFSC"    value={v(kyc.bank?.ifsc)}/>
                <InfoRow label="Bank"    value={v(kyc.bank?.bankName)}/>
                <InfoRow label="Penny Drop" value={v(kyc.bank?.pennyDropStatus)}/>
              </div>
            </BCard>

            <BCard>
              <BCardHeader title="Review & Timeline"/>
              <div style={{ padding:'14px' }}>
                <div style={{ background:'#0D1B2A', padding:'16px', marginBottom:'14px', textAlign:'center', borderTop:`2px solid ${sc.color}` }}>
                  <div style={{ fontSize:'10px', color:'rgba(255,255,255,0.4)', letterSpacing:'1px', marginBottom:'6px' }}>KYC STATUS</div>
                  <div style={{ fontSize:'22px', fontWeight:800, color:sc.color }}>{v(kyc.status)}</div>
                </div>
                <SLabel title="Review"/>
                <InfoRow label="Assigned To" value={v(kyc.review?.assignedTo?.name)}/>
                <InfoRow label="Reviewed By" value={v(kyc.review?.reviewedBy?.name)}/>
                <InfoRow label="Reviewed At" value={dt(kyc.review?.reviewedAt)}/>
                {kyc.review?.rejectReason && <InfoRow label="Reject Reason" value={v(kyc.review.rejectReason)} valueColor="#DC2626"/>}
                <SLabel title="Timeline"/>
                <InfoRow label="Submitted" value={dt(kyc.timeline?.submittedAt)}/>
                <InfoRow label="Approved"  value={dt(kyc.timeline?.approvedAt)}/>
                <InfoRow label="Rejected"  value={dt(kyc.timeline?.rejectedAt)}/>
                <InfoRow label="Expires"   value={dt(kyc.timeline?.expiresAt)}/>
                <InfoRow label="Created"   value={dt(kyc.timeline?.createdAt)}/>
                {kyc.review?.notes && (
                  <div style={{ marginTop:'12px', padding:'10px', background:'#FFFBEB', border:'1px solid #FDE68A', fontSize:'11px', color:'#92400E' }}>
                    ℹ {kyc.review.notes}
                  </div>
                )}
              </div>
            </BCard>
          </div>
        )}

        {/* ── DOCUMENTS ── */}
        {tab === 'documents' && (
          <div style={{ display:'grid', gap:'14px' }}>
            <BCard>
              <BCardHeader title="KYC Documents"/>
              <div style={{ padding:'16px', display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:'12px' }}>
                <DocCard label="PAN Card"         doc={docs.panCard}/>
                <DocCard label="Aadhaar Front"    doc={docs.aadhaarFront}/>
                <DocCard label="Aadhaar Back"     doc={docs.aadhaarBack}/>
                <DocCard label="Cancelled Cheque" doc={docs.cancelledCheque}/>
                <DocCard label="GST Certificate"  doc={docs.gstCertificate}/>
                <DocCard label="Selfie"           doc={docs.selfie}/>
              </div>
            </BCard>

            {isPending && (
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'12px' }}>
                <div style={{ padding:'16px', background:'#F0FDF4', border:'2px solid #059669' }}>
                  <div style={{ fontSize:'12px', fontWeight:800, color:'#065F46', marginBottom:'8px' }}>✓ APPROVE KYC</div>
                  <div style={{ fontSize:'11px', color:'#6B5E3E', marginBottom:'12px' }}>All documents verified. Provider will be activated for payouts.</div>
                  {hasApprove
                    ? <button onClick={handleApprove} disabled={processing} style={{ background:'#059669', color:'#fff', border:'none', padding:'10px 20px', fontSize:'12px', fontWeight:800, cursor:'pointer', opacity:processing?0.7:1 }}>✓ APPROVE</button>
                    : <div style={{ fontSize:'11px', color:'#9E8E6E' }}>No approve permission</div>
                  }
                </div>
                <div style={{ padding:'16px', background:'#FEF2F2', border:'2px solid #DC2626' }}>
                  <div style={{ fontSize:'12px', fontWeight:800, color:'#991B1B', marginBottom:'8px' }}>✗ REJECT KYC</div>
                  <div style={{ fontSize:'11px', color:'#6B5E3E', marginBottom:'12px' }}>Documents have issues. Provider will be asked to resubmit.</div>
                  {hasReject
                    ? <button onClick={() => setRejectModal(true)} style={{ background:'#DC2626', color:'#fff', border:'none', padding:'10px 20px', fontSize:'12px', fontWeight:800, cursor:'pointer' }}>✗ REJECT</button>
                    : <div style={{ fontSize:'11px', color:'#9E8E6E' }}>No reject permission</div>
                  }
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── VERIFICATION ── */}
        {tab === 'verification' && (
          <BCard>
            <BCardHeader title="Verification Checklist"/>
            <div style={{ padding:'14px' }}>
              {[
                { key:'phone',        label:'Phone OTP',     level:0 },
                { key:'email',        label:'Email OTP',     level:1 },
                { key:'pan',          label:'PAN Verify',    level:2 },
                { key:'aadhaar',      label:'Aadhaar',       level:3 },
                { key:'bank',         label:'Bank (Penny Drop)', level:4 },
                { key:'ocr',          label:'OCR',           level:5 },
                { key:'face',         label:'Face Match',    level:6 },
                { key:'manualReview', label:'Manual Review', level:7 },
              ].map(item => {
                const field = vf[item.key] || {}
                // PAN, Aadhaar, and Bank each have a real, dedicated
                // backend verify action (PATCH .../verify-pan,
                // .../verify-aadhaar, .../verify-bank). OCR/Face/Manual
                // Review have no such endpoint yet — no button for
                // those, per the same rule.
                const verifyAction =
                  item.key === 'pan'     ? { open: () => setVerifyPANModal(true),     has: hasVerifyPAN,     label: 'VERIFY PAN',     permLabel: 'verify-pan' } :
                  item.key === 'aadhaar' ? { open: () => setVerifyAadhaarModal(true), has: hasVerifyAadhaar, label: 'VERIFY AADHAAR', permLabel: 'verify-aadhaar' } :
                  item.key === 'bank'    ? { open: () => setVerifyBankModal(true),    has: hasVerifyBank,    label: 'VERIFY BANK',    permLabel: 'verify-bank' } :
                  null
                return (
                  <div key={item.key} style={{ borderBottom:'1px solid #F0EAE0' }}>
                    <div style={{ display:'grid', gridTemplateColumns:'0.5fr 1.5fr 1fr 1fr 1fr 1fr', padding:'10px 14px', alignItems:'center', gap:'8px' }}>
                      <span style={{ fontSize:'10px', color:'#9E8E6E', fontWeight:700 }}>L{item.level}</span>
                      <span style={{ fontSize:'12px', fontWeight:700, color:'#1A1A2E' }}>{item.label}</span>
                      <span style={{ fontSize:'10px', fontWeight:800, background:field.verified?'#D1FAE5':'#F3F4F6', color:field.verified?'#065F46':'#9E8E6E', padding:'2px 6px', display:'inline-block' }}>
                        {field.verified ? '✓ VERIFIED' : v(field.status)}
                      </span>
                      <span style={{ fontSize:'10px', color:'#9E8E6E' }}>{v(field.verificationSource)}</span>
                      <span style={{ fontSize:'10px', color:'#9E8E6E' }}>{dt(field.verifiedAt)}</span>
                      <span style={{ fontSize:'10px', color:'#6B5E3E' }}>{v(field.remarks)}</span>
                    </div>
                    {verifyAction && !field.verified && (
                      <div style={{ padding:'0 14px 12px', display:'flex', justifyContent:'flex-end' }}>
                        {verifyAction.has ? (
                          <button onClick={verifyAction.open}
                            style={{ background:'#059669', color:'#fff', border:'none', padding:'6px 14px', fontSize:'10px', fontWeight:800, cursor:'pointer' }}>
                            ✓ {verifyAction.label}
                          </button>
                        ) : (
                          <span style={{ fontSize:'10px', color:'#9E8E6E' }}>No {verifyAction.permLabel} permission</span>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </BCard>
        )}

        {/* ── RISK ── */}
        {tab === 'risk' && (
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'14px' }}>
            <BCard>
              <BCardHeader title="Risk Score"/>
              <div style={{ padding:'14px' }}>
                <div style={{ background:'#0D1B2A', padding:'20px', marginBottom:'14px', textAlign:'center', borderTop:`2px solid ${(kyc.risk?.score??0)>60?'#DC2626':'#059669'}` }}>
                  <div style={{ fontSize:'10px', color:'rgba(255,255,255,0.4)', letterSpacing:'1px', marginBottom:'6px' }}>RISK SCORE</div>
                  <div style={{ fontSize:'48px', fontWeight:800, color:(kyc.risk?.score??0)>60?'#DC2626':'#059669' }}>{kyc.risk?.score ?? 0}</div>
                  <div style={{ fontSize:'10px', color:'rgba(255,255,255,0.4)', marginTop:'4px' }}>out of 100</div>
                </div>
                <InfoRow label="Manual Review" value={kyc.risk?.manualReviewRequired ? '⚠ Required' : '✓ Not Required'} valueColor={kyc.risk?.manualReviewRequired?'#DC2626':'#059669'}/>
                <InfoRow label="Last Updated" value={dt(kyc.risk?.lastUpdatedAt)}/>
              </div>
            </BCard>
            <BCard>
              <BCardHeader title="Risk Flags"/>
              <div style={{ padding:'14px' }}>
                {(!kyc.risk?.flags || kyc.risk.flags.length === 0) ? (
                  <div style={{ padding:'20px', textAlign:'center', color:'#059669', fontWeight:700 }}>✓ No risk flags</div>
                ) : (
                  kyc.risk.flags.map((flag, i) => (
                    <div key={i} style={{ padding:'8px 12px', background:'#FEF2F2', border:'1px solid #FEE2E2', borderLeft:'3px solid #DC2626', marginBottom:'6px', fontSize:'12px', color:'#991B1B', fontWeight:600 }}>
                      ⚠ {flag}
                    </div>
                  ))
                )}
              </div>
            </BCard>
          </div>
        )}

        {/* ── AUDIT ── */}
        {tab === 'audit' && (
          <BCard>
            <BCardHeader title="Audit Log — Immutable" action={
              <span style={{ fontSize:'10px', color:'#DC2626', fontWeight:700 }}>⚠ CANNOT BE DELETED</span>
            }/>
            {(!kyc.auditLogs || kyc.auditLogs.length === 0) ? (
              <div style={{ padding:'40px', textAlign:'center', color:'#9E8E6E' }}>No audit logs yet</div>
            ) : (
              <>
                <div style={{ display:'grid', gridTemplateColumns:'1.2fr 1.5fr 1fr 1.5fr 1fr', padding:'8px 14px', background:'#F5F0E8', borderBottom:'1px solid #E8DFD0', gap:'8px' }}>
                  {['DATE','ACTION','SOURCE','BY','SUCCESS'].map(h => (
                    <span key={h} style={{ fontSize:'9px', fontWeight:800, color:'#9E8E6E', letterSpacing:'1px' }}>{h}</span>
                  ))}
                </div>
                {kyc.auditLogs.map((log, i) => (
                  <div key={i} style={{ display:'grid', gridTemplateColumns:'1.2fr 1.5fr 1fr 1.5fr 1fr', padding:'10px 14px', borderBottom:'1px solid #F0EAE0', alignItems:'center', gap:'8px', background:i%2===0?'#fff':'#FDFAF6' }}>
                    <span style={{ fontSize:'10px', color:'#6B5E3E', fontFamily:'monospace' }}>{dtm(log.createdAt)}</span>
                    <span style={{ fontSize:'11px', color:'#1A1A2E', fontWeight:600 }}>{v(log.action)}</span>
                    <span style={{ fontSize:'10px', color:'#9E8E6E' }}>{v(log.source)}</span>
                    <span style={{ fontSize:'11px', color:'#B8960C' }}>{v(log.triggeredBy?.name)}</span>
                    <span style={{ fontSize:'10px', fontWeight:700, color:log.success?'#059669':'#DC2626' }}>{log.success?'✓':'✗'}</span>
                  </div>
                ))}
                <div style={{ padding:'8px 14px', background:'#FFFBEB', borderTop:'1px solid #FDE68A', fontSize:'10px', color:'#92400E', fontWeight:600 }}>
                  ⚠ Audit logs are immutable. No records can be modified or deleted.
                </div>
              </>
            )}
          </BCard>
        )}

      </div>

      <div style={{ background:'#0D1B2A', borderTop:'2px solid #B8960C', padding:'10px 20px', display:'flex', justifyContent:'space-between', marginTop:'14px' }}>
        <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.3)' }}>ZEMISH KYC DETAIL v2.0.0</span>
        <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.3)' }}>NATIONAL COMMAND CENTER</span>
      </div>

      {rejectModal && (
        <RejectModal kyc={kyc} onConfirm={handleReject} onCancel={() => setRejectModal(false)} processing={processing}/>
      )}
      {reuploadModal && (
        <ReuploadModal onConfirm={handleReupload} onCancel={() => setReuploadModal(false)} processing={processing}/>
      )}
      {verifyBankModal && (
        <VerifyBankModal kyc={kyc} onConfirm={handleVerifyBank} onCancel={() => setVerifyBankModal(false)} processing={processing}/>
      )}
      {verifyPANModal && (
        <VerifyPANModal kyc={kyc} onConfirm={handleVerifyPAN} onCancel={() => setVerifyPANModal(false)} processing={processing}/>
      )}
      {verifyAadhaarModal && (
        <VerifyAadhaarModal kyc={kyc} onConfirm={handleVerifyAadhaar} onCancel={() => setVerifyAadhaarModal(false)} processing={processing}/>
      )}
    </div>
  )
}