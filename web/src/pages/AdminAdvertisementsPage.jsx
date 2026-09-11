import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { LoadMoreControl } from '../components/LoadMoreControl';
import { usePaginatedData } from '../hooks/usePaginatedData';
import { useExchangeRate } from '../context/ExchangeRateContext';
import { REALTIME_EVENTS, useRealtimeSync } from '../realtime/useRealtimeSync';
import { formatMoneyFromUsd } from '../utils/currency';
import { AdvertisementsSubNav } from '../components/AdvertisementsSubNav';
import { AdvertisementModal } from '../components/AdvertisementModal';
import { withArFallback } from '../utils/displayName';

const PAGE_SIZE = 20;

// All three tabs come from the same paginated endpoint with a `status` (see
// adminAdvertisement.service.listPaginatedAdvertisements) - Approved is also
// where a live package is paused or made available again; Rejected is kept
// (not deleted) along with its rejectionNote, same as Offer/Banner rejection.
const STATUS_TABS = ['pending', 'approved', 'rejected'];

// The moderation queue for warehouse advertisement packages - the same shape
// as AdminOffersPage, with the package's individual product lines expanded
// underneath each row so the prices can actually be reviewed.
export function AdminAdvertisementsPage() {
  const { t } = useTranslation();
  const usdToSyp = useExchangeRate();
  const [statusFilter, setStatusFilter] = useState('pending');
  const [busyId, setBusyId] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [editingAdvertisement, setEditingAdvertisement] = useState(null);
  // Computed by the backend independently of pagination, so it stays accurate
  // however many pages have been loaded. Always the count for the tab showing.
  const [totalCount, setTotalCount] = useState(0);

  // Every tab (pending/approved/rejected) is the same paginated endpoint with
  // a different `status`.
  const fetchPage = useCallback(
    (cursor) =>
      api
        .pendingAdvertisements({ status: statusFilter, limit: PAGE_SIZE, after: cursor })
        .then((data) => {
          setTotalCount(data.totalCount);
          return {
            rows: data.advertisements,
            hasMore: data.pagination.hasMore,
            nextCursor: data.pagination.nextCursor,
          };
        }),
    [statusFilter]
  );

  const { data: advertisements, isLoading, hasMore, isLoadingMore, error, loadMore, reset } =
    usePaginatedData(fetchPage);

  useEffect(() => {
    reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  // A warehouse submitting, editing or pausing a package, and another admin
  // deciding, editing, deleting or toggling one, all change this list -
  // re-read page one, which also refreshes the count.
  useRealtimeSync(
    [
      REALTIME_EVENTS.ADVERTISEMENT_PENDING,
      REALTIME_EVENTS.ADVERTISEMENT_STATUS_UPDATED,
      REALTIME_EVENTS.ADVERTISEMENT_AVAILABILITY_UPDATED,
    ],
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

  // Either direction, at any time. Pausing asks first - it pulls the package
  // from every pharmacy at once - while making one available again does not.
  const handleToggleAvailability = async (advertisement) => {
    const nextIsAvailable = !advertisement.isAvailable;
    if (
      !nextIsAvailable &&
      !window.confirm(t('advertisements.admin.confirmPause', { title: advertisement.titleEn }))
    ) {
      return;
    }

    setBusyId(advertisement.id);
    setActionError(null);
    try {
      await api.setAdvertisementAvailability(advertisement.id, nextIsAvailable);
      reset();
    } catch (err) {
      setActionError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const isPendingTab = statusFilter === 'pending';
  const isApprovedTab = statusFilter === 'approved';

  // A rejected package's content edit never touches status (the admin IS the
  // approval authority - see adminAdvertisement.service.adminUpdateAdvertisement),
  // unlike the warehouse's own edit which re-queues it. Delete works from any
  // tab; edit does too.
  const handleDelete = async (advertisement) => {
    if (!window.confirm(t('advertisements.confirmDelete', { title: advertisement.titleEn }))) return;
    setBusyId(advertisement.id);
    setActionError(null);
    try {
      await api.deleteAdminAdvertisement(advertisement.id);
      reset();
    } catch (err) {
      setActionError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const handleEditSaved = () => {
    setEditingAdvertisement(null);
    reset();
  };

  const hintText = isPendingTab
    ? t('advertisements.admin.rejectionHint')
    : isApprovedTab
      ? t('advertisements.admin.availabilityHint')
      : t('advertisements.admin.rejectedHint');

  const emptyStateText = isPendingTab
    ? t('advertisements.admin.noAdvertisements')
    : isApprovedTab
      ? t('advertisements.admin.noApprovedAdvertisements')
      : t('advertisements.admin.noRejectedAdvertisements');

  return (
    <div>
      <AdvertisementsSubNav basePath="/admin/advertisements" variant="adm" />

      <div className="adm-page-head">
        <h1>{t('nav.advertisements')}</h1>
        <div className="adm-page-head-meta">{hintText}</div>
      </div>

      {(error || actionError) && <p className="error-text">{error || actionError}</p>}

      <div className="adm-pills">
        {STATUS_TABS.map((status) => (
          <button
            key={status}
            type="button"
            className={`adm-pill${statusFilter === status ? ' active' : ''}`}
            onClick={() => setStatusFilter(status)}
          >
            {/* The count belongs to the list on screen, so only the active tab
                carries one - and not while it is still loading, when it would
                still be the previous tab's. */}
            {statusFilter === status && !isLoading
              ? t(`advertisements.admin.${status}CountLabel`, { count: totalCount })
              : t(`advertisements.admin.${status}Tab`)}
          </button>
        ))}
      </div>

      {isLoading ? (
        <p className="hint">{t('common.loading')}</p>
      ) : advertisements.length === 0 ? (
        <div className="adm-empty-state">
          <div className="adm-empty-state-icon">&#10003;</div>
          <div className="adm-empty-state-title">{emptyStateText}</div>
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
                  <th>{t('advertisements.admin.availabilityColumn')}</th>
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
                              {formatMoneyFromUsd((item.priceUsd ?? 0) * item.quantity, usdToSyp)}
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
                    <td className="adm-num">{new Date(advertisement.startDate).toLocaleDateString()}</td>
                    <td className="adm-num">{new Date(advertisement.endDate).toLocaleDateString()}</td>
                    {/* Shown on the pending tab too: a package its warehouse
                        paused stays paused through approval, and the admin
                        should see that before approving it. */}
                    <td>
                      <span
                        className={`availability-badge ${
                          advertisement.isAvailable ? 'availability-available' : 'availability-paused'
                        }`}
                      >
                        {advertisement.isAvailable
                          ? t('advertisements.available')
                          : t('advertisements.paused')}
                      </span>
                    </td>
                    <td>
                      <div className="adm-row-actions">
                        {isPendingTab && (
                          <>
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
                          </>
                        )}
                        {isApprovedTab && (
                          <button
                            className={advertisement.isAvailable ? 'btn-reject' : 'btn-approve'}
                            disabled={busyId === advertisement.id}
                            onClick={() => handleToggleAvailability(advertisement)}
                          >
                            {advertisement.isAvailable
                              ? t('advertisements.admin.pause')
                              : t('advertisements.admin.makeAvailable')}
                          </button>
                        )}
                        {/* Direct edit/delete, on every tab - full parity with
                            AdminOffersPage's own row actions. */}
                        <button
                          className="adm-row-action"
                          disabled={busyId === advertisement.id}
                          onClick={() => setEditingAdvertisement(advertisement)}
                        >
                          {t('common.edit')}
                        </button>
                        <button
                          className="adm-row-action adm-row-action-danger"
                          disabled={busyId === advertisement.id}
                          onClick={() => handleDelete(advertisement)}
                        >
                          {t('common.delete')}
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

      {editingAdvertisement && (
        <AdvertisementModal
          advertisement={editingAdvertisement}
          usdToSyp={usdToSyp}
          canAddProducts={false}
          onClose={() => setEditingAdvertisement(null)}
          onSubmit={(body) => api.updateAdminAdvertisement(editingAdvertisement.id, body)}
          onSaved={handleEditSaved}
        />
      )}
    </div>
  );
}
