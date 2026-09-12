import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { LoadMoreControl } from '../components/LoadMoreControl';
import { usePaginatedData } from '../hooks/usePaginatedData';
import { REALTIME_EVENTS, useRealtimeSync } from '../realtime/useRealtimeSync';
import { formatSyp } from '../utils/currency';

const PAGE_SIZE = 15;
const STATUS_FILTERS = ['all', 'pending', 'approved', 'rejected'];

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
  const [statusFilter, setStatusFilter] = useState('all');
  const [busyId, setBusyId] = useState(null);
  const [actionError, setActionError] = useState(null);

  const statusLabel = (returnRequest) => {
    if (returnRequest.status === 'approved') return t('returns.statusApproved');
    if (returnRequest.status === 'rejected') return t('returns.statusRejected');
    return t('returns.statusPending');
  };

  const filterLabel = (filter) => {
    if (filter === 'all') return t('returns.filterAll');
    if (filter === 'approved') return t('returns.statusApproved');
    if (filter === 'rejected') return t('returns.statusRejected');
    return t('returns.statusPending');
  };

  // Newest first is the backend's own paginated sort now (see
  // listPaginatedReturnsForWarehouse) - no client-side re-sort needed here.
  const fetchPage = useCallback(
    (cursor) =>
      api.warehouseReturns({ status: statusFilter, limit: PAGE_SIZE, after: cursor }).then((data) => ({
        rows: data.returns,
        hasMore: data.pagination.hasMore,
        nextCursor: data.pagination.nextCursor,
      })),
    [statusFilter]
  );

  const { data: returns, isLoading, isLoadingMore, hasMore, error, loadMore, reset } =
    usePaginatedData(fetchPage);

  useEffect(() => {
    reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  // Realtime: same signal-then-refetch shape as the orders queue. A return
  // filed by a pharmacy has a customer waiting on the decision, so the queue
  // shouldn't sit stale until someone reloads the browser.
  useRealtimeSync(
    [REALTIME_EVENTS.RETURN_CREATED, REALTIME_EVENTS.RETURN_STATUS_UPDATED],
    () => reset()
  );

  const handleApprove = async (returnRequest) => {
    // Money-Flow V2: approving credits the pharmacy, so the operator is shown
    // the exact figure (server-computed, from the original order's frozen
    // prices) before committing rather than after.
    let preview;
    try {
      preview = await api.returnCreditPreview(returnRequest.id);
    } catch (err) {
      setError(err.message);
      return;
    }
    const confirmed = window.confirm(
      t('returns.confirmApproveCredit', {
        number: returnRequest.orderNumber,
        amount: formatSyp(preview.preview.creditSyp),
      })
    );
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

      <div className="wh-pills">
        {STATUS_FILTERS.map((filter) => (
          <button
            key={filter}
            type="button"
            className={`wh-pill${statusFilter === filter ? ' active' : ''}`}
            onClick={() => setStatusFilter(filter)}
          >
            {filterLabel(filter)}
          </button>
        ))}
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
