import { useEffect, useMemo, useState } from 'react';
import {
  collectionGroup,
  onSnapshot,
  query,
  doc,
  updateDoc,
  serverTimestamp,
} from 'firebase/firestore';
import {
  Package,
  Search,
  ShoppingCart,
  Truck,
  CheckCircle2,
  Clock3,
  IndianRupee,
  RefreshCw,
} from 'lucide-react';

import { db } from '../firebase';
import '../styles/admin.css';

const PROCUREMENT_STATUSES = [
  'pending',
  'purchased',
  'delivered',
];

const formatINR = (value) =>
  '₹' + Number(value || 0).toLocaleString('en-IN');

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

const titleCase = (value = '') =>
  value.charAt(0).toUpperCase() + value.slice(1);

export default function AdminMaterials() {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [savingId, setSavingId] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    setLoading(true);
    setError('');

    const requestsQuery = query(
  collectionGroup(db, 'materialRequests')
);

    const unsubscribe = onSnapshot(
      requestsQuery,
      (snapshot) => {
        const items = snapshot.docs.map((item) => ({
          id: item.id,
          path: item.ref.path,
          projectId: item.ref.parent.parent?.id || '',
          ...item.data(),
        }));

        setRequests(items);
        setLoading(false);
      },
      (err) => {
        console.error('Admin materials query failed:', err);
        setError(
          'Could not load material requests. Verify Firestore rules and the materialRequests collection path.'
        );
        setLoading(false);
      }
    );

    return unsubscribe;
  }, []);

  const filteredRequests = useMemo(() => {
    const term = search.trim().toLowerCase();

    return requests.filter((item) => {
      const procurementStatus =
        item.procurementStatus || 'pending';

      const matchesStatus =
        statusFilter === 'all' ||
        (statusFilter === 'requested' &&
          item.status === 'requested') ||
        (statusFilter === 'approved' &&
          item.status === 'approved') ||
        (statusFilter === 'rejected' &&
          item.status === 'rejected') ||
        (statusFilter === 'pending-purchase' &&
          item.status === 'approved' &&
          procurementStatus === 'pending') ||
        (statusFilter === 'purchased' &&
          procurementStatus === 'purchased') ||
        (statusFilter === 'delivered' &&
          procurementStatus === 'delivered');

      const searchable = [
        item.itemName,
        item.projectName,
        item.carpenterName,
        item.vendor,
        item.notes,
        item.projectId,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      return matchesStatus && searchable.includes(term);
    });
  }, [requests, search, statusFilter]);

  const summary = useMemo(() => {
    const approved = requests.filter(
      (item) => item.status === 'approved'
    );

    return {
      total: requests.length,
      awaitingReview: requests.filter(
        (item) => item.status === 'requested'
      ).length,
      awaitingPurchase: approved.filter(
        (item) =>
          (item.procurementStatus || 'pending') === 'pending'
      ).length,
      delivered: requests.filter(
        (item) => item.procurementStatus === 'delivered'
      ).length,
      actualSpend: requests.reduce(
        (sum, item) =>
          sum +
          (item.status === 'approved'
            ? Number(item.purchaseCost || 0)
            : 0),
        0
      ),
    };
  }, [requests]);

  const saveProcurement = async (item, formElement) => {
    const formData = new FormData(formElement);
    const procurementStatus = formData.get('procurementStatus');
    const vendor = String(formData.get('vendor') || '').trim();
    const costText = String(formData.get('purchaseCost') || '').trim();
    const purchaseCost =
      costText === '' ? null : Number(costText);

    if (!PROCUREMENT_STATUSES.includes(procurementStatus)) {
      setError('Select a valid procurement status.');
      return;
    }

    if (
      purchaseCost !== null &&
      (!Number.isFinite(purchaseCost) || purchaseCost < 0)
    ) {
      setError('Enter a valid purchase cost.');
      return;
    }

    if (item.status !== 'approved') {
      setError(
        'Only supervisor-approved requests can be processed for procurement.'
      );
      return;
    }

    setSavingId(item.id);
    setError('');
    setNotice('');

    try {
      await updateDoc(doc(db, item.path), {
        procurementStatus,
        vendor,
        purchaseCost,
        procurementUpdatedAt: serverTimestamp(),
        ...(procurementStatus === 'delivered'
          ? { deliveredAt: serverTimestamp() }
          : {}),
      });

      setNotice(`Procurement saved for ${item.itemName}.`);
    } catch (err) {
      console.error('Procurement save failed:', err);
      setError(
        err.message || 'Unable to save procurement details.'
      );
    } finally {
      setSavingId('');
    }
  };

  return (
    <div className="admin-page admin-materials-page">
      <div className="admin-page-heading">
        <div>
          <span className="admin-eyebrow">
            INVENTORY & PROCUREMENT
          </span>
          <h1>Materials</h1>
          <p>
            Manage requests, purchasing and deliveries across
            your projects.
          </p>
        </div>

        <div className="admin-materials-total">
          <Package size={18} />
          <span>{summary.total} requests</span>
        </div>
      </div>

      {error && (
        <div className="admin-materials-alert error" role="alert">
          {error}
        </div>
      )}

      {notice && (
        <div className="admin-materials-alert success" role="status">
          {notice}
        </div>
      )}

      <div className="admin-materials-stats">
        <SummaryCard
          icon={<Package size={19} />}
          label="Total requests"
          value={summary.total}
          tone="neutral"
        />

        <SummaryCard
          icon={<Clock3 size={19} />}
          label="Awaiting review"
          value={summary.awaitingReview}
          tone="warning"
        />

        <SummaryCard
          icon={<ShoppingCart size={19} />}
          label="Awaiting purchase"
          value={summary.awaitingPurchase}
          tone="mint"
        />

        <SummaryCard
          icon={<Truck size={19} />}
          label="Delivered"
          value={summary.delivered}
          tone="mint"
        />

        <SummaryCard
          icon={<IndianRupee size={19} />}
          label="Recorded spend"
          value={formatINR(summary.actualSpend)}
          tone="neutral"
        />
      </div>

      <section className="admin-materials-panel">
        <div className="admin-materials-toolbar">
          <div>
            <h2>Material requests</h2>
            <p>Review request status and update procurement.</p>
          </div>

          <button
            type="button"
            className="admin-materials-refresh"
            onClick={() => {
              setNotice('');
              setError('');
            }}
            title="Clear messages"
          >
            <RefreshCw size={16} />
          </button>
        </div>

        <div className="admin-materials-filters">
          <label className="admin-materials-search">
            <Search size={17} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search material, project, carpenter or vendor"
            />
          </label>

          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
            aria-label="Filter material requests"
          >
            <option value="all">All requests</option>
            <option value="requested">Awaiting review</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="pending-purchase">Awaiting purchase</option>
            <option value="purchased">Purchased</option>
            <option value="delivered">Delivered</option>
          </select>
        </div>

        {loading ? (
          <div className="admin-materials-empty">
            <RefreshCw size={22} />
            <strong>Loading material requests…</strong>
          </div>
        ) : filteredRequests.length === 0 ? (
          <div className="admin-materials-empty">
            <Package size={26} />
            <strong>No material requests found</strong>
            <span>
              Requests will appear here when carpenters submit them.
            </span>
          </div>
        ) : (
          <div className="admin-materials-list">
            {filteredRequests.map((item) => (
              <article
                className="admin-material-request"
                key={item.path}
              >
                <div className="admin-material-request-main">
                  <div className="admin-material-icon">
                    <Package size={19} />
                  </div>

                  <div className="admin-material-request-info">
                    <div className="admin-material-title-row">
                      <h3>{item.itemName || 'Unnamed material'}</h3>
                      <StatusPill status={item.status || 'requested'} />
                    </div>

                    <p className="admin-material-quantity">
                      {item.quantity} {item.unit || 'Nos'}
                    </p>

                    <div className="admin-material-meta">
                      <span>
                        Project: {item.projectName || item.projectId}
                      </span>
                      <span>
                        Carpenter: {item.carpenterName || '—'}
                      </span>
                      <span>
                        Requested: {formatDate(item.createdAt)}
                      </span>
                    </div>

                    {item.notes && (
                      <p className="admin-material-notes">
                        {item.notes}
                      </p>
                    )}

                    {item.rejectionReason && (
                      <p className="admin-material-rejection">
                        Rejection reason: {item.rejectionReason}
                      </p>
                    )}
                  </div>
                </div>

                <div className="admin-material-procurement">
                  <div className="admin-material-procurement-head">
                    <strong>Procurement</strong>
                    <span>
                      {titleCase(item.procurementStatus || 'pending')}
                    </span>
                  </div>

                  {item.status === 'approved' ? (
                    <form
                      className="admin-material-procurement-form"
                      onSubmit={(event) => {
                        event.preventDefault();
                        saveProcurement(item, event.currentTarget);
                      }}
                    >
                      <label>
                        Vendor
                        <input
                          name="vendor"
                          defaultValue={item.vendor || ''}
                          placeholder="Vendor or supplier"
                        />
                      </label>

                      <label>
                        Actual cost (₹)
                        <input
                          name="purchaseCost"
                          type="number"
                          min="0"
                          step="0.01"
                          defaultValue={item.purchaseCost ?? ''}
                          placeholder="Enter cost"
                        />
                      </label>

                      <label>
                        Status
                        <select
                          name="procurementStatus"
                          defaultValue={
                            item.procurementStatus || 'pending'
                          }
                        >
                          {PROCUREMENT_STATUSES.map((status) => (
                            <option key={status} value={status}>
                              {titleCase(status)}
                            </option>
                          ))}
                        </select>
                      </label>

                      <button
                        type="submit"
                        disabled={savingId === item.id}
                      >
                        {savingId === item.id
                          ? 'Saving…'
                          : 'Save'}
                      </button>
                    </form>
                  ) : (
                    <p className="admin-material-lock-note">
                      {item.status === 'rejected'
                        ? 'Rejected requests cannot be procured.'
                        : 'Waiting for supervisor approval before procurement.'}
                    </p>
                  )}

                  {item.purchaseCost != null && (
                    <div className="admin-material-cost">
                      <span>Recorded cost</span>
                      <strong>{formatINR(item.purchaseCost)}</strong>
                    </div>
                  )}

                  {item.vendor && (
                    <p className="admin-material-vendor">
                      Vendor: {item.vendor}
                    </p>
                  )}

                  {item.procurementStatus === 'delivered' && (
                    <p className="admin-material-delivered">
                      <CheckCircle2 size={15} />
                      Delivered {formatDate(item.deliveredAt)}
                    </p>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function SummaryCard({ icon, label, value, tone }) {
  return (
    <article className={`admin-material-summary ${tone}`}>
      <div className="admin-material-summary-top">
        <span>{label}</span>
        <span className="admin-material-summary-icon">{icon}</span>
      </div>
      <strong>{value}</strong>
    </article>
  );
}

function StatusPill({ status }) {
  return (
    <span className={`admin-material-status ${status}`}>
      {titleCase(status)}
    </span>
  );
}
