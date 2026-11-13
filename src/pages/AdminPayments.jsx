import { useEffect, useMemo, useState } from 'react'
import {
  collection,
  doc,
  increment,
  onSnapshot,
  serverTimestamp,
  writeBatch,
} from 'firebase/firestore'
import { CalendarDays, CheckCircle2, Clock3, CreditCard, ReceiptText } from 'lucide-react'
import { db } from '../firebase'
import { inr } from './NewProject'
import '../styles/admin-payments.css'

const METHODS = ['PhonePe', 'Cash', 'Bank transfer', 'Cheque', 'UPI', 'Card']
const formatDate = (value) => {
  if (!value) return 'Not set'
  if (typeof value === 'string') {
    const parsed = new Date(`${value}T00:00:00`)
    return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
  }
  const date = value?.toDate ? value.toDate() : new Date(value)
  return Number.isNaN(date.getTime()) ? 'Not set' : date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

function PaymentVerificationCard({ payment, projectName, canWrite = false }) {
  const [splits, setSplits] = useState([{ method: 'PhonePe', amount: String(payment.amount || '') }])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const sum = splits.reduce((total, split) => total + Number(split.amount || 0), 0)

  const updateSplit = (index, key, value) => setSplits((old) => old.map((split, i) => i === index ? { ...split, [key]: value } : split))

  const save = async () => {
    if (!canWrite) return
    setError('')
    const clean = splits.map((split) => ({ method: split.method, amount: Number(split.amount) }))
    if (!clean.length || clean.some((split) => !Number.isFinite(split.amount) || split.amount <= 0)) {
      setError('Enter a valid amount for every payment method.')
      return
    }
    if (!payment.projectId) {
      setError('This payment is missing its project ID.')
      return
    }
    setBusy(true)
    try {
      const batch = writeBatch(db)
      batch.update(doc(db, 'payments', payment.id), {
        splits: clean,
        received: sum,
        status: 'recorded',
        invoiceNo: `NEI-${Date.now().toString().slice(-7)}`,
        recordedAt: serverTimestamp(),
      })
      batch.update(doc(db, 'projects', payment.projectId), { paid: increment(sum), updatedAt: serverTimestamp() })
      await batch.commit()
      setSuccess('Payment recorded successfully.')
    } catch (err) {
      console.error('Payment recording failed:', err)
      setError(err.message || 'Unable to record this payment.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <article className="card admin-payment-card">
      <div className="admin-payment-top">
        <div>
          <span className="admin-payment-eyebrow">PAYMENT VERIFICATION</span>
          <h3>{projectName || payment.projectName || 'Interior project'}</h3>
          <p className="sub">{payment.clientName || payment.clientEmail || 'Client'}</p>
        </div>
        <span className="admin-payment-status">Awaiting verification</span>
      </div>
      <div className="admin-payment-reported"><span>Client reported amount</span><strong>{inr(payment.amount)}</strong></div>
      {payment.screenshotUrl && <a className="admin-payment-proof" href={payment.screenshotUrl} target="_blank" rel="noreferrer"><strong>View payment proof ↗</strong></a>}
      {canWrite && <div className="admin-payment-splits">
        {splits.map((split, index) => <div className="admin-payment-split" key={index}>
          <label>Payment method<select value={split.method} disabled={busy} onChange={(e) => updateSplit(index, 'method', e.target.value)}>{METHODS.map((method) => <option key={method}>{method}</option>)}</select></label>
          <label>Amount (₹)<input type="number" min="0.01" step="0.01" value={split.amount} disabled={busy} onChange={(e) => updateSplit(index, 'amount', e.target.value)} /></label>
          {splits.length > 1 && <button type="button" disabled={busy} onClick={() => setSplits((old) => old.filter((_, i) => i !== index))}>Remove</button>}
        </div>)}
      </div>}
      {canWrite && <div className="admin-payment-inline-actions"><button type="button" disabled={busy} onClick={() => setSplits((old) => [...old, { method: 'Cash', amount: '' }])}>+ Add payment method</button><strong>Total: {inr(sum)}</strong></div>}
      {error && <p className="admin-payment-message error">{error}</p>}
      {success && <p className="admin-payment-message success">{success}</p>}
      {canWrite && <button className="btn admin-payment-submit" type="button" disabled={busy || sum <= 0 || !!success} onClick={save}>{busy ? 'Recording…' : success ? 'Payment recorded' : 'Confirm payment & record'}</button>}
    </article>
  )
}

export default function AdminPayments({ canWrite = false }) {
  const [projects, setProjects] = useState([])
  const [payments, setPayments] = useState([])
  const [loadingProjects, setLoadingProjects] = useState(true)
  const [loadingPayments, setLoadingPayments] = useState(true)
  const [projectError, setProjectError] = useState('')
  const [paymentError, setPaymentError] = useState('')

  useEffect(() => {
    const unsubProjects = onSnapshot(collection(db, 'projects'), (snapshot) => {
      setProjects(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })))
      setLoadingProjects(false)
      setProjectError('')
    }, (error) => {
      console.error('Payment schedule project listener failed:', error)
      setProjectError('Could not load project payment plans. Check Firestore permissions.')
      setLoadingProjects(false)
    })
    const unsubPayments = onSnapshot(collection(db, 'payments'), (snapshot) => {
      setPayments(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })).filter((item) => item.status === 'submitted'))
      setLoadingPayments(false)
      setPaymentError('')
    }, (error) => {
      console.error('Payment verification listener failed:', error)
      setPaymentError('Could not load submitted payment proofs. Check Firestore permissions.')
      setLoadingPayments(false)
    })
    return () => { unsubProjects(); unsubPayments() }
  }, [])

  const schedules = useMemo(() => projects.flatMap((project) => {
    const installments = Array.isArray(project.installments) ? project.installments : []
    return installments.map((installment, index) => ({
      ...installment,
      id: `${project.id}-${installment.type || index}`,
      projectId: project.id,
      projectName: project.name || project.projectName || 'Interior project',
      clientName: project.clientName || project.customerName || '',
      projectStatus: project.status || '',
      total: Number(project.total ?? project.quotationTotal ?? project.quotedAmount ?? 0),
    }))
  }), [projects])

  return (
    <section className="admin-payments-page">
      <header className="admin-payments-header">
        <div><span className="admin-payment-eyebrow">FINANCE MANAGEMENT</span><h1>Payments</h1><p className="sub">Review payment plans, track milestones and verify client payment proofs.</p></div>
        <div className="admin-payment-count"><strong>{payments.length}</strong><span>Pending verification</span></div>
      </header>

      <section className="admin-payment-plans-section">
        <div className="admin-payment-section-heading"><div><span className="admin-payment-eyebrow">PROJECT BILLING</span><h2><ReceiptText size={20} /> Payment installments</h2><p className="sub">Installments configured when each project was created.</p></div><span className="admin-payment-count-small">{schedules.length} milestones</span></div>
        {projectError && <p className="admin-payment-message error">{projectError}</p>}
        {loadingProjects ? <div className="card admin-payment-empty">Loading project payment plans…</div> : !schedules.length ? <div className="card admin-payment-empty">No payment installments have been configured yet.</div> : (
          <div className="admin-payment-schedule-list">
            {projects.filter((project) => Array.isArray(project.installments) && project.installments.length).map((project) => {
              const total = Number(project.total ?? project.quotationTotal ?? project.quotedAmount ?? 0)
              return <article className="card admin-payment-schedule-card" key={project.id}>
                <div className="admin-payment-schedule-header"><div><h3>{project.name || project.projectName || 'Interior project'}</h3><p>{project.clientName || project.customerName || 'Client'} · {project.status || 'quoted'}</p></div><strong>{inr(total)}</strong></div>
                <div className="admin-payment-milestones">{project.installments.map((item, index) => <div className="admin-payment-milestone" key={`${project.id}-${item.type || index}`}>
                  <div className="admin-payment-milestone-icon">{index === 0 ? <CreditCard size={17} /> : index === project.installments.length - 1 ? <CheckCircle2 size={17} /> : <Clock3 size={17} />}</div>
                  <div className="admin-payment-milestone-copy"><strong>{item.label || `Installment ${index + 1}`}</strong><span><CalendarDays size={13} /> Due: {formatDate(item.dueDate)}</span></div>
                  <strong className="admin-payment-milestone-amount">{inr(item.amount)}</strong>
                </div>)}</div>
              </article>
            })}
          </div>
        )}
      </section>

      <section className="admin-payment-verification-section">
        <div className="admin-payment-section-heading"><div><span className="admin-payment-eyebrow">CLIENT SUBMISSIONS</span><h2>Payment verification</h2><p className="sub">Record payments after reviewing the client's uploaded proof.</p></div></div>
        {paymentError && <p className="admin-payment-message error">{paymentError}</p>}
        {loadingPayments ? <div className="card admin-payment-empty">Loading submitted payments…</div> : payments.length === 0 ? <div className="card admin-payment-empty"><CheckCircle2 size={22} /><h3>No payments awaiting verification</h3><p className="sub">Submitted client payment proofs will appear here.</p></div> : <div className="grid admin-payment-grid">{payments.map((payment) => <PaymentVerificationCard key={payment.id} payment={payment} canWrite={canWrite} projectName={projects.find((p) => p.id === payment.projectId)?.name} />)}</div>}
      </section>
    </section>
  )
}
