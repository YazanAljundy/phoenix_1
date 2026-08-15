import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';

const REASON_LABELS = {
  damaged: 'Damaged',
  wrong_item: 'Wrong item',
  other: 'Other',
};

// Section 6.9/8: status is the outcome directly now - no separate
// "resolution" and no "refund" (meaningless under COD). Approve always means
// a no-extra-charge replacement order.
const STATUS_LABELS = {
  pending: 'Pending review',
  approved: 'Approved',
  rejected: 'Rejected',
};

function reasonText(item) {
  if (item.reasonType === 'other' && item.customReason) {
    return item.customReason;
  }
  return REASON_LABELS[item.reasonType] ?? item.reasonType;
}

function statusBadgeClass(returnRequest) {
  if (returnRequest.status === 'approved') return 'status-delivered';
  if (returnRequest.status === 'rejected') return 'status-cancelled';
  return 'status-pending';
}

// Section 6.9: one return per order, covering every problem item in it at
// once - each row here is one item, all under the same return card.
export function WarehouseReturnsPage() {
  const [returns, setReturns] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await api.warehouseReturns();
      setReturns(data.returns);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleApprove = async (returnRequest) => {
    const confirmed = window.confirm(
      `Approve this return for order #${returnRequest.orderNumber}? This creates a new no-extra-charge replacement order and cannot be undone.`,
    );
    if (!confirmed) return;

    setBusyId(returnRequest.id);
    setError(null);
    try {
      await api.approveReturn(returnRequest.id);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const handleReject = async (returnRequest) => {
    const rejectionNote = window.prompt(
      `Explain why this return (order #${returnRequest.orderNumber}) is being rejected - the pharmacist will see this note:`,
    );
    if (!rejectionNote || !rejectionNote.trim()) return;

    setBusyId(returnRequest.id);
    setError(null);
    try {
      await api.rejectReturn(returnRequest.id, rejectionNote.trim());
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div>
      {error && <p className="error-text">{error}</p>}

      {isLoading ? (
        <p className="hint">Loading...</p>
      ) : returns.length === 0 ? (
        <p className="hint">No return requests yet.</p>
      ) : (
        <div className="order-list">
          {returns.map((returnRequest) => (
            <div className="order-card" key={returnRequest.id}>
              <div className="order-card-header">
                <div>
                  <h2>
                    {returnRequest.pharmacyNameEn} &middot; Order #{returnRequest.orderNumber}
                  </h2>
                  <p>{returnRequest.pharmacyPhone}</p>
                </div>
                <span className={`status-badge ${statusBadgeClass(returnRequest)}`}>
                  {STATUS_LABELS[returnRequest.status] ?? returnRequest.status}
                </span>
              </div>

              <div className="order-items">
                {returnRequest.items.map((item) => (
                  <p key={item.orderItemId}>
                    {item.productNameEn} &middot; Qty {item.quantity} &middot; {reasonText(item)}
                  </p>
                ))}
              </div>
              {returnRequest.notes && <p className="order-notes">Note: {returnRequest.notes}</p>}

              {returnRequest.images?.length > 0 && (
                <div className="return-photo-row">
                  {returnRequest.images.map((url) => (
                    <a key={url} href={url} target="_blank" rel="noreferrer">
                      <img className="return-photo-thumb" src={url} alt="Return evidence" />
                    </a>
                  ))}
                </div>
              )}

              {returnRequest.status === 'rejected' && returnRequest.rejectionNote && (
                <p className="order-notes">Rejection reason: {returnRequest.rejectionNote}</p>
              )}
              {returnRequest.status === 'approved' && (
                <p className="hint">Replacement order created.</p>
              )}

              {returnRequest.status === 'pending' && (
                <div className="return-actions">
                  <button
                    className="btn-approve"
                    disabled={busyId === returnRequest.id}
                    onClick={() => handleApprove(returnRequest)}
                  >
                    Approve (replace)
                  </button>
                  <button
                    className="btn-reject"
                    disabled={busyId === returnRequest.id}
                    onClick={() => handleReject(returnRequest)}
                  >
                    Reject
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
