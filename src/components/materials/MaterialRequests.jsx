import { useEffect, useState } from 'react';
import {
  addDoc,
  collection,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  doc,
  where,
} from 'firebase/firestore';
import { auth, db } from '../../firebase';

const UNITS = ['Nos', 'Bags', 'Kg', 'Litre', 'Feet', 'Sheets', 'Boxes'];

const PROCUREMENT_STATUSES = [
  'pending',
  'purchased',
  'delivered',
];

const formatDate = (value) => {
  if (!value) return '—';

  const date = value?.toDate
    ? value.toDate()
    : new Date(value);

  if (Number.isNaN(date.getTime())) return '—';

  return date.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
};

const label = (value = '') =>
  value.charAt(0).toUpperCase() + value.slice(1);

export default function MaterialRequests({ project, role }) {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const [form, setForm] = useState({
    itemName: '',
    quantity: '',
    unit: 'Nos',
    notes: '',
  });

  const [rejectionReasons, setRejectionReasons] = useState({});
  const [procurementForms, setProcurementForms] = useState({});

  const user = auth.currentUser;
  const projectId = project?.id || project?.projectId;

  useEffect(() => {
    if (!projectId || !user) {
      setRequests([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError('');

    const requestsRef = collection(
      db,
      'projects',
      projectId,
      'materialRequests'
    );

    let requestsQuery;

    if (role === 'carpenter') {
      requestsQuery = query(
        requestsRef,
        where('carpenterUid', '==', user.uid),
        orderBy('createdAt', 'desc')
      );
    } else if (role === 'supervisor') {
      // This also includes carpenter requests because each request carries the project's supervisor UID.
      requestsQuery = query(
        requestsRef,
        where('supervisorUid', '==', user.uid),
        orderBy('createdAt', 'desc')
      );
    } else {
      requestsQuery = query(
        requestsRef,
        orderBy('createdAt', 'desc')
      );
    }

    const unsubscribe = onSnapshot(
      requestsQuery,
      (snapshot) => {
        setRequests(
          snapshot.docs.map((item) => ({
            id: item.id,
            ...item.data(),
          }))
        );
        setLoading(false);
      },
      (err) => {
        console.error('Material requests listener failed:', err);
        setError(
          'Unable to load material requests. Check Firestore rules and indexes.'
        );
        setLoading(false);
      }
    );

    return unsubscribe;
  }, [projectId, role, user?.uid]);

  const updateForm = (field, value) => {
    setForm((previous) => ({
      ...previous,
      [field]: value,
    }));
  };

  const submitRequest = async (event) => {
    event.preventDefault();

    if (!user || !projectId) {
      setError('Please sign in and select a project.');
      return;
    }

    if (
      !form.itemName.trim() ||
      !form.quantity ||
      Number(form.quantity) <= 0
    ) {
      setError('Enter a material name and a valid quantity.');
      return;
    }

    const supervisorUid = project?.supervisorUid;

    if (!supervisorUid) {
      setError(
        'This project does not have an assigned supervisor. Assign a supervisor before requesting materials.'
      );
      return;
    }

    setSaving(true);
    setError('');
    setMessage('');

    try {
      await addDoc(
        collection(
          db,
          'projects',
          projectId,
          'materialRequests'
        ),
       {
  projectId,
  projectName: project?.name || project?.projectName || '',
  itemName: form.itemName.trim(),
  quantity: Number(form.quantity),
  unit: form.unit,
  notes: form.notes.trim(),

  requestedByUid: user.uid,
  requestedByRole: role,
  requestedByName:
    user.displayName || user.email || role,

  // Keep the existing field for carpenter request queries.
  carpenterUid:
    role === 'carpenter'
      ? user.uid
      : project?.carpenterUid || '',

  carpenterName:
    role === 'carpenter'
      ? user.displayName || user.email || 'Carpenter'
      : project?.carpenterName || '',

  supervisorUid:
    role === 'supervisor'
      ? user.uid
      : project?.supervisorUid,

  status: 'requested',
  procurementStatus: 'pending',
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
}
      );

      setForm({
        itemName: '',
        quantity: '',
        unit: 'Nos',
        notes: '',
      });

      setMessage('Material request submitted successfully.');
    } catch (err) {
      console.error('Material request creation failed:', err);
      setError(err.message || 'Could not submit the request.');
    } finally {
      setSaving(false);
    }
  };

  const reviewRequest = async (requestItem, status) => {
    if (!user || !projectId) return;

    if (!['approved', 'rejected'].includes(status)) return;

    const rejectionReason =
      rejectionReasons[requestItem.id]?.trim() || '';

    if (status === 'rejected' && !rejectionReason) {
      setError('Enter a reason before rejecting the request.');
      return;
    }

    setSaving(true);
    setError('');
    setMessage('');

    try {
      const requestRef = doc(
        db,
        'projects',
        projectId,
        'materialRequests',
        requestItem.id
      );

      await updateDoc(requestRef, {
        status,
        ...(status === 'approved'
          ? {
              approvedBy: user.uid,
              approvedAt: serverTimestamp(),
              supervisorNote: '',
            }
          : {
              rejectedBy: user.uid,
              rejectedAt: serverTimestamp(),
              rejectionReason,
            }),
        updatedAt: serverTimestamp(),
      });

      setMessage(
        `Material request ${status} successfully.`
      );
    } catch (err) {
      console.error('Material request review failed:', err);
      setError(err.message || 'Could not update the request.');
    } finally {
      setSaving(false);
    }
  };

  const updateProcurementForm = (requestId, field, value) => {
    setProcurementForms((previous) => ({
      ...previous,
      [requestId]: {
        ...previous[requestId],
        [field]: value,
      },
    }));
  };

  const saveProcurement = async (requestItem) => {
    if (!user || !projectId) return;

    const values = procurementForms[requestItem.id] || {};
    const procurementStatus =
      values.procurementStatus ||
      requestItem.procurementStatus ||
      'pending';

    const vendor = (values.vendor ?? requestItem.vendor ?? '').trim();
    const purchaseCostText =
      values.purchaseCost ?? requestItem.purchaseCost ?? '';

    const purchaseCost =
      purchaseCostText === ''
        ? null
        : Number(purchaseCostText);

    if (
      purchaseCost !== null &&
      (!Number.isFinite(purchaseCost) || purchaseCost < 0)
    ) {
      setError('Enter a valid purchase cost.');
      return;
    }

    setSaving(true);
    setError('');
    setMessage('');

    try {
      await updateDoc(
        doc(
          db,
          'projects',
          projectId,
          'materialRequests',
          requestItem.id
        ),
        {
          procurementStatus,
          vendor,
          purchaseCost,
          procurementUpdatedBy: user.uid,
          procurementUpdatedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          ...(procurementStatus === 'delivered'
            ? { deliveredAt: serverTimestamp() }
            : {}),
        }
      );

      setMessage('Procurement details saved.');
    } catch (err) {
      console.error('Procurement update failed:', err);
      setError(err.message || 'Could not save procurement details.');
    } finally {
      setSaving(false);
    }
  };

  if (!projectId) {
    return (
      <section className="staff-form-card">
        <h3>Material requests</h3>
        <p className="staff-muted">
          Select a project to view its material requests.
        </p>
      </section>
    );
  }

  return (
    <section className="staff-form-card material-requests">
      <div className="staff-form-card-heading material-heading">
        <div>
          <span>PROJECT MATERIALS</span>
          <h3>Materials</h3>
          <p className="staff-muted">Request what the site needs and follow its progress.</p>
        </div>
        <span className="material-count">{requests.length} {requests.length === 1 ? 'request' : 'requests'}</span>
      </div>

      {error && (
        <p className="material-alert material-alert-error" role="alert">
          {error}
        </p>
      )}

      {message && (
        <p className="material-alert material-alert-success" role="status">
          {message}
        </p>
      )}

      {/* Carpenter request form */}
      {['carpenter', 'supervisor'].includes(role) && (
        <form className="material-request-form" onSubmit={submitRequest}>
          <div className="material-form-intro">
            <span className="material-step">1</span>
            <div><h4>What do you need?</h4><p>Add the item and amount. Notes are optional.</p></div>
          </div>

          <label>
            Material name *
            <input
              value={form.itemName}
              onChange={(event) =>
                updateForm('itemName', event.target.value)
              }
              placeholder="e.g. Plywood, hinges, paint"
              required
            />
          </label>

          <div className="material-form-row">
            <label>
              Quantity *
              <input
                type="number"
                min="0.01"
                step="any"
                value={form.quantity}
                onChange={(event) =>
                  updateForm('quantity', event.target.value)
                }
                placeholder="Enter quantity"
                required
              />
            </label>

            <label>
              Unit
              <select
                value={form.unit}
                onChange={(event) =>
                  updateForm('unit', event.target.value)
                }
              >
                {UNITS.map((unit) => (
                  <option key={unit} value={unit}>
                    {unit}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label>
            Notes
            <textarea
              rows={3}
              value={form.notes}
              onChange={(event) =>
                updateForm('notes', event.target.value)
              }
              placeholder="Specify size, colour, brand or why it is needed"
            />
          </label>

          <button type="submit" disabled={saving}>
            {saving ? 'Submitting…' : 'Submit material request'}
          </button>
        </form>
      )}

      {/* Request list */}
      <div className="material-request-list">
        <div className="material-list-heading">
          <div><span className="material-step">2</span><h4>{role === 'supervisor' ? 'Requests to review' : 'Request updates'}</h4></div>
          <p>{role === 'supervisor' ? 'Review your team’s requests and approve or reject them.' : 'See whether each item is approved, purchased or delivered.'}</p>
        </div>

        {loading ? (
          <p className="staff-muted">Loading material requests…</p>
        ) : requests.length === 0 ? (
         <p className="staff-muted">
  {['carpenter', 'supervisor'].includes(role)
    ? 'No material requests yet. Use the form above to request materials.'
    : 'Material requests for this project will appear here.'}
</p>
        ) : (
          requests.map((item) => {
            const procurement =
              item.procurementStatus || 'pending';

            return (
              <article
                className="material-request-item"
                key={item.id}
              >
                <div className="material-request-top">
                  <div>
                    <h4>{item.itemName}</h4>
                    <p>
                      {item.quantity} {item.unit}
                    </p>
                    <p className="staff-muted">
                      Requested by {item.requestedByName || item.carpenterName || 'Team member'}
                      {' · '}
                      {formatDate(item.createdAt)}
                    </p>
                  </div>

                  <span
                    className={`material-status material-status-${item.status}`}
                  >
                    {label(item.status || 'requested')}
                  </span>
                </div>

                {item.notes && <p>{item.notes}</p>}

                {item.rejectionReason && (
                  <p>
                    <strong>Rejection reason:</strong>{' '}
                    {item.rejectionReason}
                  </p>
                )}

                {/* Supervisor review */}
                {role === 'supervisor' &&
                  item.status === 'requested' && (
                    <div className="material-review-actions">
                      <label>
                        Reason (needed only if rejecting)
                        <input
                          value={rejectionReasons[item.id] || ''}
                          onChange={(event) =>
                            setRejectionReasons((previous) => ({
                              ...previous,
                              [item.id]: event.target.value,
                            }))
                          }
                          placeholder="Tell them what needs changing"
                        />
                      </label>

                      <div className="material-button-row">
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() =>
                            reviewRequest(item, 'approved')
                          }
                        >
                          Approve
                        </button>

                        <button
                          type="button"
                          className="material-reject-button"
                          disabled={saving}
                          onClick={() =>
                            reviewRequest(item, 'rejected')
                          }
                        >
                          Reject
                        </button>
                      </div>
                    </div>
                  )}

                {/* Admin procurement tracking */}
                {role === 'admin' && (
                  <div className="material-procurement">
                    <h5>Procurement tracking</h5>

                    <label>
                      Procurement status
                      <select
                        value={
                          procurementForms[item.id]?.procurementStatus ||
                          procurement
                        }
                        onChange={(event) =>
                          updateProcurementForm(
                            item.id,
                            'procurementStatus',
                            event.target.value
                          )
                        }
                      >
                        {PROCUREMENT_STATUSES.map((status) => (
                          <option key={status} value={status}>
                            {label(status)}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label>
                      Vendor
                      <input
                        value={
                          procurementForms[item.id]?.vendor ??
                          item.vendor ??
                          ''
                        }
                        onChange={(event) =>
                          updateProcurementForm(
                            item.id,
                            'vendor',
                            event.target.value
                          )
                        }
                        placeholder="Vendor or supplier name"
                      />
                    </label>

                    <label>
                      Actual purchase cost (₹)
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={
                          procurementForms[item.id]?.purchaseCost ??
                          item.purchaseCost ??
                          ''
                        }
                        onChange={(event) =>
                          updateProcurementForm(
                            item.id,
                            'purchaseCost',
                            event.target.value
                          )
                        }
                        placeholder="0.00"
                      />
                    </label>

                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => saveProcurement(item)}
                    >
                      {saving ? 'Saving…' : 'Save procurement'}
                    </button>
                  </div>
                )}

                <div className="material-request-footer">
                  <span>
                    Procurement: <strong>{label(procurement)}</strong>
                  </span>

                  {item.purchaseCost != null && (
                    <span>
                      Actual cost: ₹
                      {Number(item.purchaseCost).toLocaleString('en-IN')}
                    </span>
                  )}
                </div>
              </article>
            );
          })
        )}
      </div>
    </section>
  );
}
