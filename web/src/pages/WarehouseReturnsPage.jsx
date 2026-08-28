import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { LoadMoreControl } from '../components/LoadMoreControl';
import { usePaginatedData } from '../hooks/usePaginatedData';
import { REALTIME_EVENTS, useRealtimeSync } from '../realtime/useRealtimeSync';

const PAGE_SIZE = 15;

function statusBadgeClass(returnRequest) {
  if (returnRequest.status === 'approved') return 'status-delivered';
  if (returnRequest.status === 'rejected') return 'status-cancelled';
  return 'status-pending';
}

// Section 6.9: one return per order, covering every problem item in it at
// once - the item-level breakdown (products, reasons, photos) lives on
// WarehouseReturnDetailPage; this table is just the browsing queue.
export function WarehouseReturnsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [busyId, setBusyId] = useState(null);
  const [actionError, setActionError] = useState(null);

  const statusLabel = (returnRequest) => {
    if (returnRequest.status === 'approved') return t('returns.statusApproved');
    if (returnRequest.status === 'rejected') return t('returns.statusRejected');
    return t('returns.statusPending');
  };

  // Newest first is the backend's own paginated sort now (see
  // listPaginatedReturnsForWarehouse) - no client-side re-sort needed here.
  const fetchPage = useCallback(
    (cursor) =>
      api.warehouseReturns({ limit: PAGE_SIZE, after: cursor }).then((data) => ({
        rows: data.returns,
        hasMore: data.pagination.hasMore,
        nextCursor: data.pagination.nextCursor,
      })),
    []
  );

  const { data: returns, isLoading, isLoadingMore, hasMore, error, loadMore, reset } =
    usePaginatedData(fetchPage);

  useEffect(() => {
    reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Realtime: same signal-then-refetch shape as the orders queue. A return
  // filed by a pharmacy has a customer waiting on the decision, so the queue
  // shouldn't sit stale until someone reloads the browser.
  useRealtimeSync(
    [REALTIME_EVENTS.RETURN_CREATED, REALTIME_EVENTS.RETURN_STATUS_UPDATED],
    () => reset()
  );

  const handleApprove = async (returnRequest) => {
    const confirmed = window.confirm(t('returns.confirmApprove', { number: returnRequest.orderNumber }));
    if (!confirmed) return;

    setBusyId(returnRequest.id);
    setActionError(null);
    try {
      await api.approveReturn(returnRequest.id);
      reset();
    } catch (err) {
      setActionError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const handleReject = async (returnRequest) => {
    const rejectionNote = window.prompt(t('returns.promptReject', { number: returnRequest.orderNumber }));
    if (!rejectionNote || !rejectionNote.trim()) return;

    setBusyId(returnRequest.id);
    setActionError(null);
    try {
      await api.rejectReturn(returnRequest.id, rejectionNote.trim());
      reset();
    } catch (err) {
      setActionError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div>
      <div className="wh-page-head">
        <h1>{t('nav.returns')}</h1>
      </div>

      {(error || actionError) && <p className="error-text">{error || actionError}</p>}

      {isLoading ? (
        <p className="hint">{t('common.loading')}</p>
      ) : returns.length === 0 ? (
        <div className="wh-empty-state">
          <div className="wh-empty-state-icon">↩</div>
          <div className="wh-empty-state-title">{t('returns.noReturns')}</div>
        </div>
      ) : (
        <>
          <div className="wh-card table-scroll">
            <table className="wh-table">
              <thead>
                <tr>
                  <th>{t('orders.orderNumberColumn')}</th>
                  <th>{t('orderDetail.pharmacy')}</th>
                  <th>{t('orders.itemCountColumn')}</th>
                  <th>{t('common.status')}</th>
                  <th>{t('debts.date')}</th>
                  <th>{t('orders.actionColumn')}</th>
                </tr>
              </thead>
              <tbody>
                {returns.map((returnRequest) => (
                  <tr key={returnRequest.id} onClick={() => navigate(`/warehouse/returns/${returnRequest.id}`)}>
                    <td>
                      <span className="wh-num wh-table-order-num">
                        {t('orders.orderNumber', { number: returnRequest.orderNumber })}
                      </span>
                    </td>
                    <td>{returnRequest.pharmacyNameEn}</td>
                    <td className="wh-num">{returnRequest.items.length}</td>
                    <td>
                      <span className={`status-badge ${statusBadgeClass(returnRequest)}`}>
                        {statusLabel(returnRequest)}
                      </span>
                    </td>
                    <td className="wh-num wh-table-date">
                      {returnRequest.createdAt ? new Date(returnRequest.createdAt).toLocaleString() : ''}
                    </td>
                    <td>
                      {returnRequest.status === 'pending' && (
                        <div className="wh-row-actions">
                          <button
                            className="wh-row-action"
                            disabled={busyId === returnRequest.id}
                            onClick={(event) => {
                              event.stopPropagation();
                              handleApprove(returnRequest);
                            }}
                          >
                            {t('returns.approveReplace')}
                          </button>
                          <button
                            className="wh-row-action wh-row-action-danger"
                            disabled={busyId === returnRequest.id}
                            onClick={(event) => {
                              event.stopPropagation();
                              handleReject(returnRequest);
                            }}
                          >
                            {t('common.reject')}
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="wh-table-hint">{t('returns.clickRowHint')}</p>
          <LoadMoreControl
            hasMore={hasMore}
            isLoadingMore={isLoadingMore}
            onLoadMore={loadMore}
            pageSize={PAGE_SIZE}
          />
        </>
      )}
    </div>
  );
}
