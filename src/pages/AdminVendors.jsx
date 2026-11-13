import { useEffect, useMemo, useState } from 'react'
import { addDoc, collection, onSnapshot, serverTimestamp } from 'firebase/firestore'
import { ArrowLeft, Plus, Search, Store, X } from 'lucide-react'
import { db } from '../firebase'
import { inr } from './NewProject'
import '../styles/vendors.css'

const money = (value) => inr(Number(value || 0))
const dateLabel = (value) => {
  if (!value) return 'Date not recorded'
  const date = value?.toDate ? value.toDate() : new Date(value)
  return Number.isNaN(date.getTime()) ? 'Date not recorded' : date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

export default function AdminVendors({ user, canWrite = false }) {
  const [vendors, setVendors] = useState([])
  const [payments, setPayments] = useState([])
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [form, setForm] = useState({ name: '', categories: '', phone: '', gstin: '' })

  useEffect(() => {
    let ready = 0
    const done = () => { ready += 1; if (ready >= 3) setLoading(false) }
    const unVendors = onSnapshot(collection(db, 'vendors'), (snap) => {
      setVendors(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
      done()
    }, (err) => { console.error(err); setError('Could not load vendors. Check Firestore permissions.'); done() })
    const unPayments = onSnapshot(collection(db, 'vendorPayments'), (snap) => {
      setPayments(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
      done()
    }, (err) => { console.error('Vendor payments:', err); done() })
    const unProjects = onSnapshot(collection(db, 'projects'), (snap) => {
      setProjects(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
      done()
    }, (err) => { console.error('Projects:', err); done() })
    return () => { unVendors(); unPayments(); unProjects() }
  }, [])

  const rows = useMemo(() => vendors.map((vendor) => {
    const related = payments.filter((p) => p.vendorId === vendor.id)
    const paid = related.filter((p) => String(p.status || 'paid').toLowerCase() === 'paid').reduce((n, p) => n + Number(p.amount || 0), 0)
    const due = related.filter((p) => ['due', 'pending', 'unpaid'].includes(String(p.status || '').toLowerCase())).reduce((n, p) => n + Number(p.amount || 0), 0)
    const projectIds = new Set(related.map((p) => p.projectId).filter(Boolean))
    const categories = Array.isArray(vendor.categories) ? vendor.categories.join(', ') : String(vendor.categories || '')
    return { ...vendor, categories, paid, due, projectCount: projectIds.size }
  }), [vendors, payments])

  const visible = rows.filter((v) => `${v.name || ''} ${v.categories || ''}`.toLowerCase().includes(search.trim().toLowerCase()))
  const totalPaid = rows.reduce((n, v) => n + v.paid, 0)
  const selectedPayments = selected ? payments.filter((p) => p.vendorId === selected.id).sort((a, b) => {
    const ms = (x) => x?.toMillis?.() ?? new Date(x || 0).getTime()
    return ms(b.paidAt || b.createdAt || b.date) - ms(a.paidAt || a.createdAt || a.date)
  }) : []

  async function saveVendor(event) {
    event.preventDefault()
    if (!canWrite) return
    setSaving(true); setFormError('')
    try {
      await addDoc(collection(db, 'vendors'), {
        name: form.name.trim(),
        categories: form.categories.split(',').map((x) => x.trim()).filter(Boolean),
        phone: form.phone.trim(),
        gstin: form.gstin.trim().toUpperCase(),
        createdAt: serverTimestamp(),
        createdBy: user?.uid || null,
      })
      setForm({ name: '', categories: '', phone: '', gstin: '' })
      setShowForm(false)
    } catch (err) {
      console.error('Save vendor failed:', err)
      setFormError('Could not save vendor. Check Firestore rules and try again.')
    } finally { setSaving(false) }
  }

  if (loading) return <section className="vendors-page"><div className="vendors-empty">Loading vendors…</div></section>

  if (selected) {
    const paid = selectedPayments.filter((p) => String(p.status || 'paid').toLowerCase() === 'paid').reduce((n, p) => n + Number(p.amount || 0), 0)
    return <section className="vendors-page">
      <div className="vendors-subheading"><button className="vendors-back" onClick={() => setSelected(null)} aria-label="Back to vendors"><ArrowLeft size={23} /></button><div><h1>{selected.name}</h1><p>{Array.isArray(selected.categories) ? selected.categories.join(', ') : selected.categories || 'Supplier'}</p></div></div>
      <div className="vendors-panel vendors-history"><h2>Payment history</h2>
        {selectedPayments.length === 0 ? <div className="vendors-no-history"><strong>No payment history yet</strong><p>Payments recorded for this vendor will appear here.</p></div> : selectedPayments.map((p) => {
          const project = projects.find((x) => x.id === p.projectId)
          return <div className="vendors-payment-row" key={p.id}><div><strong>{p.category || p.material || 'Vendor payment'}{(project?.name || p.projectName) ? ` · ${project?.name || p.projectName}` : ''}</strong><span>{dateLabel(p.paidAt || p.createdAt || p.date)}</span>{p.note && <small>{p.note}</small>}</div><strong>{money(p.amount)}</strong></div>
        })}
        <div className="vendors-total"><span>Total paid</span><strong>{money(paid)}</strong></div>
      </div>
    </section>
  }

  return <section className="vendors-page">
    <div className="vendors-heading"><div><h1>Vendors</h1><p>{vendors.length} {vendors.length === 1 ? 'supplier' : 'suppliers'} <span>·</span> {money(totalPaid)} total spend</p></div>{canWrite && <button className="vendors-primary" onClick={() => setShowForm(true)}><Plus size={19} /> Add</button>}</div>
    {error && <div className="vendors-error">{error}</div>}
    <label className="vendors-search"><Search size={18} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search vendors…" /></label>
    {visible.length ? <div className="vendors-panel vendors-list">{visible.map((v) => <button className="vendors-row" key={v.id} onClick={() => setSelected(v)}><span className="vendors-row-info"><strong>{v.name || 'Unnamed vendor'}</strong><span>{v.categories || 'Supplies not specified'} · {v.projectCount} {v.projectCount === 1 ? 'project' : 'projects'}</span></span><span className="vendors-row-amount"><strong className={v.due > 0 ? 'due' : ''}>{money(v.due > 0 ? v.due : v.paid)}</strong><span>{v.due > 0 ? 'due' : 'total paid'}</span></span></button>)}</div> : <div className="vendors-empty"><div className="vendors-empty-icon"><Store size={24} /></div><h2>{vendors.length ? 'No matching vendors' : 'No vendors yet'}</h2><p>{vendors.length ? 'Try another search term.' : 'Add your first supplier to track materials and payments.'}</p>{canWrite && !vendors.length && <button className="vendors-primary" onClick={() => setShowForm(true)}><Plus size={17} /> Add vendor</button>}</div>}
    <p className="vendors-note">Vendor payment history is read from <code>vendorPayments</code>.</p>
    {canWrite && showForm && <div className="vendors-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget && !saving) setShowForm(false) }}><form className="vendors-form" onSubmit={saveVendor}><div className="vendors-form-title"><div><span>SUPPLIER DETAILS</span><h2>Add vendor</h2></div><button type="button" className="vendors-close" onClick={() => setShowForm(false)} disabled={saving} aria-label="Close"><X size={20} /></button></div>
      <label>Vendor name *<input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="ABC Timbers" /></label>
      <label>Supplies (categories)<input value={form.categories} onChange={(e) => setForm({ ...form, categories: e.target.value })} placeholder="Plywood, laminate" /></label>
      <label>Phone<input type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+91 98xxx xx400" /></label>
      <label>GSTIN (optional)<input value={form.gstin} onChange={(e) => setForm({ ...form, gstin: e.target.value })} placeholder="Leave blank if not registered" /></label>
      {formError && <div className="vendors-error">{formError}</div>}<div className="vendors-form-actions"><button type="button" className="vendors-secondary" onClick={() => setShowForm(false)} disabled={saving}>Cancel</button><button type="submit" className="vendors-primary" disabled={saving}>{saving ? 'Saving…' : 'Add vendor'}</button></div>
    </form></div>}
  </section>
}
