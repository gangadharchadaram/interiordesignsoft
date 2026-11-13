import { useEffect, useMemo, useState } from 'react';
import {
  addDoc, collection, collectionGroup, doc, onSnapshot, orderBy,
  query, serverTimestamp, updateDoc,
} from 'firebase/firestore';
import { db } from '../firebase';
import '../../src/styles/adminInventory.css';

const money = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const dateLabel = (v) => {
  if (!v) return '—';
  const d = v?.toDate ? v.toDate() : new Date(v);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};
const title = (v = '') => v.replaceAll('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const requestPath = (r) => r.path || (r.projectId ? `projects/${r.projectId}/materialRequests/${r.id}` : '');

export default function AdminInventory({ role = 'admin', user: suppliedUser }) {
  const user = suppliedUser || auth.currentUser;
  const [requests, setRequests] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [vendorPayments, setVendorPayments] = useState([]);
  const [projects, setProjects] = useState([]);
  const [tab, setTab] = useState('requests');
  const [forms, setForms] = useState({});
  const [newVendor, setNewVendor] = useState({ name: '', phone: '', email: '', address: '' });
  const [paymentForm, setPaymentForm] = useState({ requestId: '', amount: '', method: 'Bank transfer', reference: '', notes: '' });
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const unsubs = [];
    unsubs.push(onSnapshot(collectionGroup(db, 'materialRequests'), (snap) => {
      setRequests(snap.docs.map((d) => ({ id: d.id, path: d.ref.path, ...d.data() })));
    }, (e) => { console.error('Inventory request listener:', e); setError(`Could not load requests: ${e.message}`); }));
    unsubs.push(onSnapshot(query(collection(db, 'vendors'), orderBy('name')), (snap) => {
      setVendors(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    }, (e) => { console.error('Vendor listener:', e); setError(`Could not load vendors: ${e.message}`); }));
    unsubs.push(onSnapshot(query(collection(db, 'vendorPayments'), orderBy('createdAt', 'desc')), (snap) => {
      setVendorPayments(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    }, (e) => { console.error('Vendor payments listener:', e); setError(`Could not load vendor ledger: ${e.message}`); }));
    unsubs.push(onSnapshot(collection(db, 'projects'), (snap) => {
      setProjects(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    }, (e) => console.error('Projects listener:', e)));
    return () => unsubs.forEach((unsub) => unsub());
  }, []);

  const setField = (id, key, value) => setForms((p) => ({ ...p, [id]: { ...p[id], [key]: value } }));
  const formFor = (r) => ({ vendorId: r.vendorId || '', unitPrice: r.unitPrice ?? '', invoiceNumber: r.invoiceNumber || '', expectedDeliveryDate: r.expectedDeliveryDate || '', receivedQuantity: r.receivedQuantity ?? '', actualCost: r.actualCost ?? '', notes: r.procurementNotes || '', ...(forms[r.id] || {}) });

  const ordered = useMemo(() => requests.filter((r) => ['ordered', 'partially_delivered', 'delivered'].includes(r.procurementStatus)), [requests]);
  const pendingApproval = useMemo(() => requests.filter((r) => (r.status || 'requested') === 'requested'), [requests]);
  const totalOrdered = useMemo(() => ordered.reduce((s, r) => s + Number(r.actualCost ?? r.purchaseCost ?? (Number(r.quantity || 0) * Number(r.unitPrice || 0))), 0), [ordered]);
  const totalPaid = useMemo(() => vendorPayments.filter((p) => p.kind === 'payment').reduce((s, p) => s + Number(p.amount || 0), 0), [vendorPayments]);

  const addVendor = async (e) => {
    e.preventDefault(); setError(''); setNotice('');
    if (!newVendor.name.trim()) return setError('Vendor name is required.');
    setSaving(true);
    try {
      await addDoc(collection(db, 'vendors'), {
        name: newVendor.name.trim(), phone: newVendor.phone.trim(), email: newVendor.email.trim(),
        address: newVendor.address.trim(), createdAt: serverTimestamp(), createdBy: user?.uid || '', active: true,
      });
      setNewVendor({ name: '', phone: '', email: '', address: '' });
      setNotice('Vendor added.');
    } catch (e2) { console.error(e2); setError(e2.message || 'Could not add vendor.'); }
    finally { setSaving(false); }
  };

  const review = async (r, status) => {
    if (!['supervisor', 'admin'].includes(role)) return;
    const reason = (forms[r.id]?.rejectionReason || '').trim();
    if (status === 'rejected' && !reason) return setError('Add a rejection reason first.');
    setSaving(true); setError(''); setNotice('');
    try {
      const path = requestPath(r); if (!path) throw new Error('Request is missing its project path.');
      await updateDoc(doc(db, path), {
        status,
        ...(status === 'approved' ? { approvedBy: user.uid, approvedAt: serverTimestamp() } : { rejectedBy: user.uid, rejectedAt: serverTimestamp(), rejectionReason: reason }),
        updatedAt: serverTimestamp(),
      });
      setNotice(`Request ${status}.`);
    } catch (e) { console.error(e); setError(e.message || 'Could not update request.'); }
    finally { setSaving(false); }
  };

  const bookOrder = async (r) => {
    if (!['admin', 'supervisor'].includes(role)) return;
    const f = formFor(r); const vendor = vendors.find((v) => v.id === f.vendorId);
    if (!vendor) return setError('Select a vendor before booking this order.');
    const unitPrice = Number(f.unitPrice);
    if (!Number.isFinite(unitPrice) || unitPrice < 0) return setError('Enter a valid unit price.');
    const total = Number((Number(r.quantity || 0) * unitPrice).toFixed(2));
    setSaving(true); setError(''); setNotice('');
    try {
      const path = requestPath(r); if (!path) throw new Error('Request is missing its project path.');
      await updateDoc(doc(db, path), {
        vendorId: vendor.id, vendorName: vendor.name, vendorPhone: vendor.phone || '', vendorEmail: vendor.email || '',
        unitPrice, purchaseCost: total, actualCost: total, invoiceNumber: f.invoiceNumber.trim(),
        expectedDeliveryDate: f.expectedDeliveryDate, procurementNotes: f.notes.trim(),
        procurementStatus: 'ordered', orderBookedBy: user.uid, orderBookedAt: serverTimestamp(),
        whatsappNotificationStatus: vendor.phone ? 'queued' : 'missing_vendor_phone', updatedAt: serverTimestamp(),
      });
      // This creates a ledger/order record; WhatsApp is sent by the configured Cloud Function trigger.
      await addDoc(collection(db, 'vendorPayments'), {
        kind: 'order', requestId: r.id, requestPath: path, projectId: r.projectId || '',
        projectName: r.projectName || projects.find((p) => p.id === r.projectId)?.name || '',
        vendorId: vendor.id, vendorName: vendor.name, amount: total, paidAmount: 0,
        balance: total, status: 'ordered', itemName: r.itemName || r.materialName || 'Material',
        quantity: Number(r.quantity || 0), unit: r.unit || 'Nos', invoiceNumber: f.invoiceNumber.trim(),
        expectedDeliveryDate: f.expectedDeliveryDate, createdAt: serverTimestamp(), createdBy: user.uid,
      });
      setNotice(vendor.phone ? 'Order booked. WhatsApp notification queued; verify the Cloud Function logs to confirm delivery.' : 'Order booked, but the vendor has no phone number. Add a phone number to enable WhatsApp notification.');
    } catch (e) { console.error('Order booking failed:', e); setError(e.message || 'Could not book order.'); }
    finally { setSaving(false); }
  };

  const updateDelivery = async (r) => {
    const f = formFor(r); const received = Number(f.receivedQuantity);
    if (!Number.isFinite(received) || received < 0) return setError('Enter a valid received quantity.');
    if (received > Number(r.quantity || 0)) return setError('Received quantity cannot exceed the requested quantity.');
    const status = received === 0 ? 'ordered' : received < Number(r.quantity || 0) ? 'partially_delivered' : 'delivered';
    setSaving(true); setError(''); setNotice('');
    try {
      const path = requestPath(r); if (!path) throw new Error('Request is missing its project path.');
      await updateDoc(doc(db, path), { receivedQuantity: received, procurementStatus: status, actualCost: Number(f.actualCost || r.actualCost || r.purchaseCost || 0), invoiceNumber: f.invoiceNumber.trim(), deliveredAt: status === 'delivered' ? serverTimestamp() : null, deliveryUpdatedBy: user.uid, updatedAt: serverTimestamp() });
      setNotice(`Delivery updated: ${title(status)}.`);
    } catch (e) { console.error(e); setError(e.message || 'Could not update delivery.'); }
    finally { setSaving(false); }
  };

  const recordPayment = async (e) => {
    e.preventDefault(); setError(''); setNotice('');
    const order = vendorPayments.find((p) => p.id === paymentForm.requestId && p.kind === 'order');
    const amount = Number(paymentForm.amount);
    if (!order) return setError('Select an order.');
    if (!Number.isFinite(amount) || amount <= 0) return setError('Enter a payment amount greater than zero.');
    const paidAlready = vendorPayments.filter((p) => p.kind === 'payment' && p.orderId === order.id).reduce((s, p) => s + Number(p.amount || 0), 0);
    if (paidAlready + amount > Number(order.amount || 0)) return setError('Payment exceeds the outstanding order balance.');
    setSaving(true);
    try {
      await addDoc(collection(db, 'vendorPayments'), {
        kind: 'payment', orderId: order.id, requestId: order.requestId, requestPath: order.requestPath,
        projectId: order.projectId, projectName: order.projectName, vendorId: order.vendorId, vendorName: order.vendorName,
        amount, method: paymentForm.method, reference: paymentForm.reference.trim(), notes: paymentForm.notes.trim(),
        createdAt: serverTimestamp(), createdBy: user.uid,
      });
      setPaymentForm({ requestId: '', amount: '', method: 'Bank transfer', reference: '', notes: '' });
      setNotice('Vendor payment recorded.');
    } catch (e2) { console.error(e2); setError(e2.message || 'Could not record payment.'); }
    finally { setSaving(false); }
  };

  const projectSpend = useMemo(() => {
    const map = new Map();
    vendorPayments.filter((x) => x.kind === 'order').forEach((o) => {
      const key = o.projectName || o.projectId || 'Unassigned project';
      map.set(key, (map.get(key) || 0) + Number(o.amount || 0));
    });
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [vendorPayments]);
  const vendorSpend = useMemo(() => {
    const map = new Map();
    vendorPayments.filter((x) => x.kind === 'order').forEach((o) => {
      const key = o.vendorName || 'Unknown vendor';
      map.set(key, (map.get(key) || 0) + Number(o.amount || 0));
    });
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [vendorPayments]);

  return <section className="inventory-workspace">
    <header className="inventory-heading"><div><span className="inventory-eyebrow">NORTH EAST INTERIORS</span><h2>Inventory & Procurement</h2><p>Request approvals, vendor orders, deliveries and spending in one place.</p></div><div className="inventory-heading-chip">{pendingApproval.length} awaiting review</div></header>
    <div className="inventory-kpis"><article><span>Open requests</span><strong>{requests.filter((r) => ['requested', 'approved'].includes(r.status)).length}</strong></article><article><span>Order value</span><strong>{money(totalOrdered)}</strong></article><article><span>Payments recorded</span><strong>{money(totalPaid)}</strong></article><article><span>Vendors</span><strong>{vendors.length}</strong></article></div>
    {error && <div className="inventory-alert error" role="alert">{error}</div>}{notice && <div className="inventory-alert success" role="status">{notice}</div>}
    <nav className="inventory-tabs">{[['requests','Requests'],['orders','Vendor orders'],['vendors','Vendors'],['ledger','Vendor ledger'],['reports','Spending reports']].map(([id, labelText]) => <button type="button" className={tab === id ? 'active' : ''} key={id} onClick={() => setTab(id)}>{labelText}</button>)}</nav>

    {tab === 'requests' && <div className="inventory-list">{requests.length === 0 ? <div className="inventory-empty">No material requests yet. Carpenter requests appear here automatically.</div> : requests.slice().sort((a,b) => Number((b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0))).map((r) => <article className="inventory-request" key={r.path}><div className="inventory-request-top"><div><span className="inventory-project">{r.projectName || 'Project'}</span><h3>{r.itemName || r.materialName || 'Material'} <small>{r.quantity} {r.unit || 'Nos'}</small></h3><p>Requested by {r.carpenterName || r.requestedByName || 'Carpenter'} · {dateLabel(r.createdAt)}</p>{r.notes && <p className="inventory-notes">{r.notes}</p>}</div><div className="inventory-badges"><span className={`inventory-badge ${r.status || 'requested'}`}>{title(r.status || 'requested')}</span><span className={`inventory-badge ${r.procurementStatus || 'pending'}`}>{title(r.procurementStatus || 'pending')}</span></div></div>
      {role === 'supervisor' && r.status === 'requested' && <div className="inventory-inline-actions"><input aria-label="Rejection reason" placeholder="Rejection reason (required to reject)" value={forms[r.id]?.rejectionReason || ''} onChange={(e) => setField(r.id, 'rejectionReason', e.target.value)} /><button disabled={saving} onClick={() => review(r,'approved')}>Approve request</button><button className="danger" disabled={saving} onClick={() => review(r,'rejected')}>Reject</button></div>}
      {['admin','supervisor'].includes(role) && r.status === 'approved' && !['ordered','partially_delivered','delivered'].includes(r.procurementStatus) && <div className="inventory-booking"><h4>Book vendor order</h4><div className="inventory-form-grid"><label>Vendor<select value={formFor(r).vendorId} onChange={(e) => setField(r.id,'vendorId',e.target.value)}><option value="">Select vendor</option>{vendors.map((v) => <option key={v.id} value={v.id}>{v.name}{v.phone ? ` · ${v.phone}` : ''}</option>)}</select></label><label>Unit price (₹)<input type="number" min="0" step="0.01" value={formFor(r).unitPrice} onChange={(e) => setField(r.id,'unitPrice',e.target.value)} placeholder="0.00" /></label><label>Invoice / PO reference<input value={formFor(r).invoiceNumber} onChange={(e) => setField(r.id,'invoiceNumber',e.target.value)} placeholder="Optional reference" /></label><label>Expected delivery<input type="date" value={formFor(r).expectedDeliveryDate} onChange={(e) => setField(r.id,'expectedDeliveryDate',e.target.value)} /></label><label className="span-two">Procurement notes<input value={formFor(r).notes} onChange={(e) => setField(r.id,'notes',e.target.value)} placeholder="Terms, colour, brand, delivery instructions" /></label></div><p className="inventory-calculated">Estimated order total <strong>{money(Number(r.quantity || 0) * Number(formFor(r).unitPrice || 0))}</strong></p><button disabled={saving || !vendors.length} onClick={() => bookOrder(r)}>{saving ? 'Saving…' : 'Book order & queue WhatsApp'}</button>{!vendors.length && <p className="inventory-muted">Add a vendor in the Vendors tab first.</p>}</div>}
      {r.status === 'rejected' && r.rejectionReason && <p className="inventory-rejection">Reason: {r.rejectionReason}</p>}
    </article>)}</div>}

    {tab === 'orders' && <div className="inventory-list">{ordered.length === 0 ? <div className="inventory-empty">Approved requests will appear here after a vendor order is booked.</div> : ordered.map((r) => <article className="inventory-request" key={r.path}><div className="inventory-request-top"><div><span className="inventory-project">{r.projectName || 'Project'} · {r.vendorName || 'Vendor not set'}</span><h3>{r.itemName || 'Material'} <small>{r.receivedQuantity || 0}/{r.quantity} {r.unit || 'Nos'} received</small></h3><p>Order total: {money(r.actualCost ?? r.purchaseCost)} · Expected: {r.expectedDeliveryDate || 'Not set'}</p><p>Invoice / PO: {r.invoiceNumber || '—'} · WhatsApp: {title(r.whatsappNotificationStatus || 'not tracked')}</p></div><span className={`inventory-badge ${r.procurementStatus}`}>{title(r.procurementStatus)}</span></div><div className="inventory-form-grid"><label>Received quantity<input type="number" min="0" max={r.quantity} step="any" value={formFor(r).receivedQuantity} onChange={(e) => setField(r.id,'receivedQuantity',e.target.value)} /></label><label>Actual total cost (₹)<input type="number" min="0" step="0.01" value={formFor(r).actualCost} onChange={(e) => setField(r.id,'actualCost',e.target.value)} /></label><label>Invoice number<input value={formFor(r).invoiceNumber} onChange={(e) => setField(r.id,'invoiceNumber',e.target.value)} /></label></div><button disabled={saving} onClick={() => updateDelivery(r)}>Save delivery / actual cost</button></article>)}</div>}

    {tab === 'vendors' && <div className="inventory-two-column"><form className="inventory-panel" onSubmit={addVendor}><h3>Add vendor</h3><label>Vendor / company name *<input required value={newVendor.name} onChange={(e) => setNewVendor({...newVendor,name:e.target.value})} /></label><label>WhatsApp number (include country code)<input value={newVendor.phone} onChange={(e) => setNewVendor({...newVendor,phone:e.target.value})} placeholder="e.g. 919876543210" /></label><label>Email<input type="email" value={newVendor.email} onChange={(e) => setNewVendor({...newVendor,email:e.target.value})} /></label><label>Address<input value={newVendor.address} onChange={(e) => setNewVendor({...newVendor,address:e.target.value})} /></label><button disabled={saving}>{saving ? 'Saving…' : 'Save vendor'}</button></form><div className="inventory-panel"><h3>Saved vendors <span className="inventory-count">{vendors.length}</span></h3>{vendors.length ? vendors.map((v) => <div className="inventory-vendor-row" key={v.id}><div><strong>{v.name}</strong><p>{v.phone || 'No WhatsApp number'}{v.email ? ` · ${v.email}` : ''}</p><small>{v.address || 'No address saved'}</small></div><span className="inventory-badge approved">{v.active === false ? 'Inactive' : 'Active'}</span></div>) : <p className="inventory-muted">No vendors added yet.</p>}</div></div>}

    {tab === 'ledger' && <div className="inventory-two-column"><form className="inventory-panel" onSubmit={recordPayment}><h3>Record vendor payment</h3><label>Vendor order *<select required value={paymentForm.requestId} onChange={(e) => setPaymentForm({...paymentForm,requestId:e.target.value})}><option value="">Select order</option>{vendorPayments.filter((p) => p.kind === 'order').map((o) => <option key={o.id} value={o.id}>{o.vendorName} · {o.itemName} · {money(o.amount)}</option>)}</select></label><label>Amount paid (₹) *<input required type="number" min="0.01" step="0.01" value={paymentForm.amount} onChange={(e) => setPaymentForm({...paymentForm,amount:e.target.value})} /></label><label>Payment method<select value={paymentForm.method} onChange={(e) => setPaymentForm({...paymentForm,method:e.target.value})}><option>Bank transfer</option><option>UPI</option><option>Cash</option><option>Cheque</option><option>Other</option></select></label><label>Transaction reference<input value={paymentForm.reference} onChange={(e) => setPaymentForm({...paymentForm,reference:e.target.value})} /></label><label>Notes<input value={paymentForm.notes} onChange={(e) => setPaymentForm({...paymentForm,notes:e.target.value})} /></label><button disabled={saving}>{saving ? 'Saving…' : 'Record payment'}</button></form><div className="inventory-panel"><h3>Vendor ledger</h3>{vendorPayments.slice().sort((a,b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)).map((p) => <div className="inventory-ledger-row" key={p.id}><div><strong>{p.kind === 'payment' ? 'Payment' : 'Order'} · {p.vendorName || 'Vendor'}</strong><p>{p.projectName || 'Project'} · {p.itemName || p.method || '—'}</p><small>{dateLabel(p.createdAt)}{p.reference ? ` · Ref: ${p.reference}` : ''}</small></div><strong className={p.kind === 'payment' ? 'inventory-money-paid' : ''}>{p.kind === 'payment' ? '−' : ''}{money(p.amount)}</strong></div>)}</div></div>}

    {tab === 'reports' && <div className="inventory-two-column"><div className="inventory-panel"><h3>Spend by project</h3>{projectSpend.length ? projectSpend.map(([name, amount]) => <div className="inventory-report-row" key={name}><span>{name}</span><strong>{money(amount)}</strong></div>) : <p className="inventory-muted">No orders recorded.</p>}</div><div className="inventory-panel"><h3>Spend by vendor</h3>{vendorSpend.length ? vendorSpend.map(([name, amount]) => <div className="inventory-report-row" key={name}><span>{name}</span><strong>{money(amount)}</strong></div>) : <p className="inventory-muted">No orders recorded.</p>}</div></div>}
    <p className="inventory-footnote">WhatsApp messages require a deployed Cloud Function, a configured WhatsApp Business Cloud API token/phone-number ID, an approved template, and a valid vendor phone number. A queued status does not prove delivery.</p>
  </section>;
}
