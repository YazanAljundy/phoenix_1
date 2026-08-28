import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { LoadMoreControl } from '../components/LoadMoreControl';
import { usePaginatedData } from '../hooks/usePaginatedData';
import { REALTIME_EVENTS, useRealtimeSync } from '../realtime/useRealtimeSync';
import { withArFallback } from '../utils/displayName';

const PAGE_SIZE = 20;

export function AdminOffersPage() {
  const { t } = useTranslation();
  const [busyId, setBusyId] = useState(null);
  const [actionError, setActionError] = useState(null);
  // Stays accurate regardless of pagination - the backend computes it
  // independently of whichever page has been loaded.
  const [totalCount, setTotalCount] = useState(0);

  const fetchPage = useCallback(
    (cursor) =>
      api.pendingOffers({ limit: PAGE_SIZE, after: cursor }).then((data) => {
        setTotalCount(data.totalCount);
        return {
          rows: data.offers,
          hasMore: data.pagination.hasMore,
          nextCursor: data.pagination.nextCursor,
        };
      }),
    []
  );

  const { data: offers, isLoading, isLoadingMore, hasMore, error, loadMore, reset } =
    usePaginatedData(fetchPage);

  useEffect(() => {
    reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Realtime: a warehouse submitting an offer, or another admin deciding one,
  // both change this queue. `reset()` re-reads page one through the same
  // endpoint - which also refreshes the "Pending (N)" total, since the backend
  // computes that independently of pagination.
  useRealtimeSync(
    [REALTIME_EVENTS.OFFER_PENDING, REALTIME_EVENTS.OFFER_STATUS_UPDATED],
    () => reset()
  );

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
    setActionError(null);
    try {
      if (action === 'approve') {
        await api.approveOffer(offer.id);
      } else {
        await api.rejectOffer(offer.id);
      }
      reset();
    } catch (err) {
      setActionError(err.message);
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

      {(error || actionError) && <p className="error-text">{error || actionError}</p>}

      {isLoading ? (
        <p className="hint">{t('common.loading')}</p>
      ) : (
        <>
          <div className="adm-pills">
            <span className="adm-pill active">
              {t('offers.admin.pendingCountLabel', { count: totalCount })}
            </span>
          </div>

          {offers.length === 0 ? (
            <div className="adm-empty-state">
              <div className="adm-empty-state-icon">&#10003;</div>
              <div className="adm-empty-state-title">{t('offers.admin.noOffers')}</div>
            </div>
          ) : (
            <>
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
              <LoadMoreControl
                hasMore={hasMore}
                isLoadingMore={isLoadingMore}
                onLoadMore={loadMore}
                pageSize={PAGE_SIZE}
              />
            </>
          )}
        </>
      )}
    </div>
  );
}
