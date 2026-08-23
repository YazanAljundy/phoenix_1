import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { StarRating } from '../components/StarRating';
import { LoadMoreControl } from '../components/LoadMoreControl';
import { usePaginatedData } from '../hooks/usePaginatedData';
import { withArFallback } from '../utils/displayName';

const PAGE_SIZE = 20;
const STATUS_VALUES = ['pending', 'confirmed', 'preparing', 'out_for_delivery', 'delivered', 'cancelled'];
const ADVANCE_KEYS = {
  pending: 'orders.advancePending',
  confirmed: 'orders.advanceConfirmed',
  preparing: 'orders.advancePreparing',
  out_for_delivery: 'orders.advanceOutForDelivery',
};

// Section 13b/13c: rating the pharmacy is a one-time action per delivered
// order (the unique {orderId, reviewerType} index backs this up server-side
// too) - shown immediately once submitted, unlike the reverse direction.
function RatePharmacyModal({ order, onClose, onRated }) {
  const { t } = useTranslation();
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError(null);
    if (rating < 1) {
      setError(t('orders.pleaseSelectRating'));
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
        <h2>{t('orders.rateModalTitle', { name: order.pharmacy?.nameEn })}</h2>
        <form onSubmit={handleSubmit} className="product-form">
          <label>
            {t('orders.rating')}
            <StarRating value={rating} onChange={setRating} size={28} />
          </label>
          <label>
            {t('orders.commentOptional')}
            <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={3} />
          </label>

          {error && <p className="error-text">{error}</p>}

          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={onClose}>
              {t('common.cancel')}
            </button>
            <button type="submit" className="btn-primary" disabled={isSaving}>
              {isSaving ? t('orders.submitting') : t('orders.submitRating')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function WarehouseOrdersPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [statusFilter, setStatusFilter] = useState('pending');
  const [busyId, setBusyId] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [rateModalOrder, setRateModalOrder] = useState(null);

  const statusLabel = useCallback((status) => t(`orders.status${statusKeySuffix(status)}`), [t]);

  const fetchPage = useCallback(
    (cursor) =>
      api
        .warehouseOrders({ status: statusFilter || undefined, limit: PAGE_SIZE, after: cursor })
        .then((data) => ({
          rows: data.orders,
          hasMore: data.pagination.hasMore,
          nextCursor: data.pagination.nextCursor,
        })),
    [statusFilter]
  );

  const { data: loadedOrders, isLoading, isLoadingMore, hasMore, error, loadMore, reset } =
    usePaginatedData(fetchPage);

  // Pending stays oldest-first (the fulfillment queue) - every other tab
  // (including "All") shows newest-first, flipping the server's oldest-first
  // page order (orderNumber ascending) without touching the endpoint. This
  // reverses everything loaded so far, so it stays correct as more pages
  // come in via "Load more".
  const orders = statusFilter === 'pending' ? loadedOrders : loadedOrders.slice().reverse();

  useEffect(() => {
    reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  const handleAdvance = async (order) => {
    setBusyId(order.id);
    setActionError(null);
    try {
      await api.advanceOrderStatus(order.id);
      // The current filter may no longer include this order's new status
      // (e.g. advancing out of "Pending review") - simplest correct move is
      // to just reset back to page one rather than patch it in place.
      reset();
    } catch (err) {
      setActionError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const handleRated = () => {
    setRateModalOrder(null);
    reset();
  };

  const statusTabs = [{ value: '', label: t('orders.tabAll') }, ...STATUS_VALUES.map((value) => ({
    value,
    label: statusLabel(value),
  }))];

  return (
    <div>
      <div className="wh-page-head">
        <h1>{t('nav.orders')}</h1>
        <div className="wh-page-head-meta">{t('orders.resultsCount', { count: orders.length })}</div>
      </div>

      <div className="wh-pills">
        {statusTabs.map((tab) => (
          <button
            key={tab.value}
            className={`wh-pill${statusFilter === tab.value ? ' active' : ''}`}
            onClick={() => setStatusFilter(tab.value)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {(error || actionError) && <p className="error-text">{error || actionError}</p>}

      {isLoading ? (
        <p className="hint">{t('common.loading')}</p>
      ) : orders.length === 0 ? (
        <p className="hint">{t('orders.noOrders')}</p>
      ) : (
        <>
          <div className="wh-card table-scroll">
            <table className="wh-table">
              <thead>
                <tr>
                  <th>{t('orders.orderNumberColumn')}</th>
                  <th>{t('orderDetail.pharmacy')}</th>
                  <th>{t('orders.itemCountColumn')}</th>
                  <th>{t('orderDetail.finalPriceColumn')}</th>
                  <th>{t('debts.date')}</th>
                  <th>{t('common.status')}</th>
                  <th>{t('orders.actionColumn')}</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => (
                  <tr key={order.id} onClick={() => navigate(`/warehouse/orders/${order.id}`)}>
                    <td>
                      <span className="wh-num wh-table-order-num">
                        {t('orders.orderNumber', { number: order.orderNumber })}
                      </span>
                    </td>
                    <td>
                      {withArFallback(order.pharmacy?.nameEn, order.pharmacy?.nameAr)}
                      <div className="wh-table-sub">{order.pharmacy?.city}</div>
                    </td>
                    <td className="wh-num">{order.items.length}</td>
                    <td className="wh-num wh-table-total">{order.finalPrice} SYP</td>
                    <td className="wh-num wh-table-date">
                      {order.createdAt ? new Date(order.createdAt).toLocaleString() : ''}
                    </td>
                    <td>
                      <span className={`status-badge status-${order.status}`}>{statusLabel(order.status)}</span>
                    </td>
                    <td>
                      {ADVANCE_KEYS[order.status] && (
                        <button
                          className="wh-row-action"
                          disabled={busyId === order.id}
                          onClick={(event) => {
                            event.stopPropagation();
                            handleAdvance(order);
                          }}
                        >
                          {busyId === order.id ? t('orders.updating') : t(ADVANCE_KEYS[order.status])}
                        </button>
                      )}
                      {order.status === 'delivered' &&
                        (order.hasReviewed ? (
                          <span className="hint">{t('orders.youRatedPharmacy')}</span>
                        ) : (
                          <button
                            className="wh-row-action"
                            onClick={(event) => {
                              event.stopPropagation();
                              setRateModalOrder(order);
                            }}
                          >
                            {t('orders.ratePharmacy')}
                          </button>
                        ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="wh-table-hint">{t('orders.clickRowHint')}</p>
          <LoadMoreControl
            hasMore={hasMore}
            isLoadingMore={isLoadingMore}
            onLoadMore={loadMore}
            pageSize={PAGE_SIZE}
          />
        </>
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

function statusKeySuffix(status) {
  return status
    .split('_')
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join('');
}
