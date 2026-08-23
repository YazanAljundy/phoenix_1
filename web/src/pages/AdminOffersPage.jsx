import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { withArFallback } from '../utils/displayName';

export function AdminOffersPage() {
  const { t } = useTranslation();
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
      t('offers.admin.confirmDecision', {
        action: action === 'approve' ? t('common.approve') : t('common.reject'),
        title: offer.titleEn,
        product: withArFallback(offer.productNameEn, offer.productNameAr),
        percent: offer.discountPercentage,
      }),
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
      <div className="adm-page-head">
        <h1>{t('nav.offers')}</h1>
        <div className="adm-page-head-meta">{t('offers.admin.rejectionHint')}</div>
      </div>

      {error && <p className="error-text">{error}</p>}

      {isLoading ? (
        <p className="hint">{t('common.loading')}</p>
      ) : (
        <>
          <div className="adm-pills">
            <span className="adm-pill active">
              {t('offers.admin.pendingCountLabel', { count: offers.length })}
            </span>
          </div>

          {offers.length === 0 ? (
            <div className="adm-empty-state">
              <div className="adm-empty-state-icon">&#10003;</div>
              <div className="adm-empty-state-title">{t('offers.admin.noOffers')}</div>
            </div>
          ) : (
            <div className="adm-card table-scroll">
              <table className="adm-table">
                <thead>
                  <tr>
                    <th>{t('offers.admin.warehouseColumn')}</th>
                    <th>{t('offers.admin.productColumn')}</th>
                    <th>{t('offers.admin.discountColumn')}</th>
                    <th>{t('offers.warehouse.fromColumn')}</th>
                    <th>{t('offers.warehouse.toColumn')}</th>
                    <th>{t('common.status')}</th>
                    <th>{t('admin.pendingAccounts.actionColumn')}</th>
                  </tr>
                </thead>
                <tbody>
                  {offers.map((offer) => (
                    <tr key={offer.id}>
                      <td>{offer.warehouseNameEn}</td>
                      <td>{withArFallback(offer.productNameEn, offer.productNameAr)}</td>
                      <td className="adm-num adm-offer-discount">{offer.discountPercentage}%</td>
                      <td className="adm-num">{new Date(offer.startDate).toLocaleDateString()}</td>
                      <td className="adm-num">{new Date(offer.endDate).toLocaleDateString()}</td>
                      <td>
                        <span className="status-badge status-pending">{t('offers.warehouse.statusPending')}</span>
                      </td>
                      <td>
                        <div className="adm-row-actions">
                          <button
                            className="btn-approve"
                            disabled={busyId === offer.id}
                            onClick={() => handleDecision(offer, 'approve')}
                          >
                            {t('common.approve')}
                          </button>
                          <button
                            className="btn-reject"
                            disabled={busyId === offer.id}
                            onClick={() => handleDecision(offer, 'reject')}
                          >
                            {t('common.reject')}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
