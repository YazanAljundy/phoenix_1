import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import { StarRating } from '../components/StarRating';

const STATUS_TABS = [
  { value: '', label: 'All' },
  { value: 'pending', label: 'Pending review' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'preparing', label: 'Preparing' },
  { value: 'out_for_delivery', label: 'Out for delivery' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'cancelled', label: 'Cancelled' },
];

const STATUS_LABELS = {
  pending: 'Pending review',
  confirmed: 'Confirmed',
  preparing: 'Preparing',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};

// Section 7/13b: one fixed forward sequence - no arbitrary status picking.
// The label is just a friendlier verb for what "advance" does from the
// order's current status; the server enforces the actual sequence.
const ADVANCE_LABELS = {
  pending: 'Confirm order',
  confirmed: 'Start preparing',
  preparing: 'Send out for delivery',
  out_for_delivery: 'Mark as delivered',
};

function itemsSummary(items) {
  return items.map((item) => `${item.quantity}× ${item.productNameEn}`).join(', ');
}

// Section 13b/13c: rating the pharmacy is a one-time action per delivered
// order (the unique {orderId, reviewerType} index backs this up server-side
// too) - shown immediately once submitted, unlike the reverse direction.
function RatePharmacyModal({ order, onClose, onRated }) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError(null);
    if (rating < 1) {
      setError('Please select a star rating.');
      return;
    }

    setIsSaving(true);
    try {
      await api.ratePharmacy(order.id, rating, comment.trim() || undefined);
      onRated();
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(event) => event.stopPropagation()}>
        <h2>Rate {order.pharmacy?.nameEn}</h2>
        <form onSubmit={handleSubmit} className="product-form">
          <label>
            Rating
            <StarRating value={rating} onChange={setRating} size={28} />
          </label>
          <label>
            Comment (optional)
            <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={3} />
          </label>

          {error && <p className="error-text">{error}</p>}

          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={isSaving}>
              {isSaving ? 'Submitting...' : 'Submit rating'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function WarehouseOrdersPage() {
  const [statusFilter, setStatusFilter] = useState('pending');
  const [orders, setOrders] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [rateModalOrder, setRateModalOrder] = useState(null);

  const load = useCallback(async (status) => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await api.warehouseOrders(status || undefined);
      setOrders(data.orders);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load(statusFilter);
  }, [load, statusFilter]);

  const handleAdvance = async (order) => {
    setBusyId(order.id);
    setError(null);
    try {
      await api.advanceOrderStatus(order.id);
      // The current filter may no longer include this order's new status
      // (e.g. advancing out of "Pending review") - simplest correct move is
      // to just reload the active filter rather than patch it in place.
      await load(statusFilter);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const handleRated = () => {
    setRateModalOrder(null);
    load(statusFilter);
  };

  return (
    <div>
      <div className="status-tabs">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.value}
            className={`status-tab${statusFilter === tab.value ? ' active' : ''}`}
            onClick={() => setStatusFilter(tab.value)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {error && <p className="error-text">{error}</p>}

      {isLoading ? (
        <p className="hint">Loading...</p>
      ) : orders.length === 0 ? (
        <p className="hint">No orders here right now.</p>
      ) : (
        <div className="order-list">
          {orders.map((order) => (
            <div className="order-card" key={order.id}>
              <div className="order-card-header">
                <div>
                  <h2>Order #{order.orderNumber}</h2>
                  <p>
                    {order.pharmacy?.nameEn} &middot; {order.pharmacy?.phone}
                  </p>
                  <p>{order.pharmacy?.address}</p>
                </div>
                <span className={`status-badge status-${order.status}`}>
                  {STATUS_LABELS[order.status] ?? order.status}
                </span>
              </div>

              <p className="order-items">{itemsSummary(order.items)}</p>
              {order.notes && <p className="order-notes">Note: {order.notes}</p>}
              <p className="order-price">{order.finalPrice} SYP</p>

              {ADVANCE_LABELS[order.status] && (
                <button
                  className="btn-primary"
                  disabled={busyId === order.id}
                  onClick={() => handleAdvance(order)}
                >
                  {busyId === order.id ? 'Updating...' : ADVANCE_LABELS[order.status]}
                </button>
              )}
              {order.status === 'delivered' && (
                order.hasReviewed ? (
                  <p className="hint">You rated this pharmacy.</p>
                ) : (
                  <button className="btn-secondary" onClick={() => setRateModalOrder(order)}>
                    Rate pharmacy
                  </button>
                )
              )}
            </div>
          ))}
        </div>
      )}

      {rateModalOrder && (
        <RatePharmacyModal
          order={rateModalOrder}
          onClose={() => setRateModalOrder(null)}
          onRated={handleRated}
        />
      )}
    </div>
  );
}
