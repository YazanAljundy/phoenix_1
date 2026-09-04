import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { LoadMoreControl } from '../components/LoadMoreControl';
import { usePaginatedData } from '../hooks/usePaginatedData';
import { useExchangeRate } from '../context/ExchangeRateContext';
import { REALTIME_EVENTS, useRealtimeSync } from '../realtime/useRealtimeSync';
import { formatMoneyFromUsd } from '../utils/currency';
import { AdvertisementsSubNav } from '../components/AdvertisementsSubNav';
import { withArFallback } from '../utils/displayName';

const PAGE_SIZE = 20;

// The moderation queue for warehouse advertisement packages - the same shape
// as AdminOffersPage, with the package's individual product lines expanded
// underneath each row so the prices can actually be reviewed.
export function AdminAdvertisementsPage() {
  const { t } = useTranslation();
  const usdToSyp = useExchangeRate();
  const [busyId, setBusyId] = useState(null);
  const [actionError, setActionError] = useState(null);
  // Computed by the backend independently of pagination, so it stays accurate
  // however many pages have been loaded.
  const [totalCount, setTotalCount] = useState(0);

  const fetchPage = useCallback(
    (cursor) =>
      api.pendingAdvertisements({ limit: PAGE_SIZE, after: cursor }).then((data) => {
        setTotalCount(data.totalCount);
        return {
          rows: data.advertisements,
          hasMore: data.pagination.hasMore,
          nextCursor: data.pagination.nextCursor,
        };
      }),
    []
  );

  const { data: advertisements, isLoading, isLoadingMore, hasMore, error, loadMore, reset } =
    usePaginatedData(fetchPage);

  useEffect(() => {
    reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A warehouse submitting (or editing) a package, and another admin deciding
  // one, both change this queue - reset() re-reads page one, which also
  // refreshes the pending total.
  useRealtimeSync(
    [REALTIME_EVENTS.ADVERTISEMENT_PENDING, REALTIME_EVENTS.ADVERTISEMENT_STATUS_UPDATED],
    () => reset()
  );

  const handleApprove = async (advertisement) => {
    const confirmed = window.confirm(
      t('advertisements.admin.confirmApprove', { title: advertisement.titleEn })
    );
    if (!confirmed) return;

    setBusyId(advertisement.id);
    setActionError(null);
    try {
      await api.approveAdvertisement(advertisement.id);
      reset();
    } catch (err) {
      setActionError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  // A rejection always carries a reason - the warehouse curated a whole
  // package and needs to know what to fix (the backend requires it too).
  const handleReject = async (advertisement) => {
    const note = window.prompt(t('advertisements.admin.rejectPrompt', { title: advertisement.titleEn }));
    if (note === null) return;
    if (!note.trim()) {
      setActionError(t('advertisements.admin.rejectionNoteRequired'));
      return;
    }

    setBusyId(advertisement.id);
    setActionError(null);
    try {
      await api.rejectAdvertisement(advertisement.id, note.trim());
      reset();
    } catch (err) {
      setActionError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div>
      <AdvertisementsSubNav basePath="/admin/advertisements" variant="adm" />

      <div className="adm-page-head">
        <h1>{t('nav.advertisements')}</h1>
        <div className="adm-page-head-meta">{t('advertisements.admin.rejectionHint')}</div>
      </div>

      {(error || actionError) && <p className="error-text">{error || actionError}</p>}

      {isLoading ? (
        <p className="hint">{t('common.loading')}</p>
      ) : (
        <>
          <div className="adm-pills">
            <span className="adm-pill active">
              {t('advertisements.admin.pendingCountLabel', { count: totalCount })}
            </span>
          </div>

          {advertisements.length === 0 ? (
            <div className="adm-empty-state">
              <div className="adm-empty-state-icon">&#10003;</div>
              <div className="adm-empty-state-title">{t('advertisements.admin.noAdvertisements')}</div>
            </div>
          ) : (
            <>
              <div className="adm-card table-scroll">
                <table className="adm-table">
                  <thead>
                    <tr>
                      <th>{t('advertisements.admin.warehouseColumn')}</th>
                      <th>{t('advertisements.titleColumn')}</th>
                      <th>{t('advertisements.productsColumn')}</th>
                      <th>{t('advertisements.calculatedTotal')}</th>
                      <th>{t('advertisements.totalPrice')}</th>
                      <th>{t('offers.warehouse.fromColumn')}</th>
                      <th>{t('offers.warehouse.toColumn')}</th>
                      <th>{t('admin.pendingAccounts.actionColumn')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {advertisements.map((advertisement) => (
                      <tr key={advertisement.id}>
                        <td>{advertisement.warehouseNameEn}</td>
                        <td>
                          {advertisement.titleEn}
                          <div className="adm-table-sub" dir="rtl">
                            {advertisement.titleAr}
                          </div>
                        </td>
                        <td>
                          <ul className="adm-ad-items">
                            {advertisement.items.map((item) => (
                              <li key={item.productId}>
                                {withArFallback(item.productNameEn, item.productNameAr)}
                                {' ×'}
                                {item.quantity}
                                {' — '}
                                <span className="adm-num">
                                  {formatMoneyFromUsd(
                                    (item.priceUsd ?? 0) * item.quantity,
                                    usdToSyp
                                  )}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </td>
                        <td className="adm-num">
                          {formatMoneyFromUsd(advertisement.calculatedItemsTotalUsd, usdToSyp)}
                        </td>
                        <td className="adm-num">
                          <strong>{formatMoneyFromUsd(advertisement.totalPriceUsd, usdToSyp)}</strong>
                          {advertisement.savingPercentage > 0 && (
                            <div className="adm-table-sub">
                              {t('advertisements.savingPercent', {
                                percent: advertisement.savingPercentage,
                              })}
                            </div>
                          )}
                        </td>
                        <td className="adm-num">
                          {new Date(advertisement.startDate).toLocaleDateString()}
                        </td>
                        <td className="adm-num">
                          {new Date(advertisement.endDate).toLocaleDateString()}
                        </td>
                        <td>
                          <div className="adm-row-actions">
                            <button
                              className="btn-approve"
                              disabled={busyId === advertisement.id}
                              onClick={() => handleApprove(advertisement)}
                            >
                              {t('common.approve')}
                            </button>
                            <button
                              className="btn-reject"
                              disabled={busyId === advertisement.id}
                              onClick={() => handleReject(advertisement)}
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
