import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';

export function AdminOffersPage() {
  const [offers, setOffers] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await api.pendingOffers();
      setOffers(data.offers);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleDecision = async (offer, action) => {
    const confirmed = window.confirm(
      `${action === 'approve' ? 'Approve' : 'Reject'} "${offer.titleEn}" on ${offer.productNameEn} (${offer.discountPercentage}% off)?`,
    );
    if (!confirmed) return;

    setBusyId(offer.id);
    setError(null);
    try {
      if (action === 'approve') {
        await api.approveOffer(offer.id);
      } else {
        await api.rejectOffer(offer.id);
      }
      setOffers((prev) => prev.filter((o) => o.id !== offer.id));
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
      ) : offers.length === 0 ? (
        <p className="hint">No offers waiting for review.</p>
      ) : (
        <div className="account-list">
          {offers.map((offer) => (
            <div className="account-card" key={offer.id}>
              <div className="account-info">
                <span className="account-role-badge">{offer.warehouseNameEn}</span>
                <h2>{offer.titleEn}</h2>
                <p>
                  {offer.productNameEn} &middot; {offer.productPrice} SYP
                </p>
                <p>{offer.discountPercentage}% off</p>
                <p>
                  {new Date(offer.startDate).toLocaleDateString()} &ndash;{' '}
                  {new Date(offer.endDate).toLocaleDateString()}
                </p>
              </div>
              <div className="account-actions">
                <button
                  className="btn-approve"
                  disabled={busyId === offer.id}
                  onClick={() => handleDecision(offer, 'approve')}
                >
                  Approve
                </button>
                <button
                  className="btn-reject"
                  disabled={busyId === offer.id}
                  onClick={() => handleDecision(offer, 'reject')}
                >
                  Reject
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
