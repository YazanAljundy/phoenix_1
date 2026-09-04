import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { withArFallback } from '../utils/displayName';
import { useExchangeRate } from '../context/ExchangeRateContext';
import { REALTIME_EVENTS, useRealtimeSync } from '../realtime/useRealtimeSync';
import { formatUsdAsSyp, formatSyp, formatMoneyFromUsd, remainingPaymentAmount } from '../utils/currency';

function statusKeySuffix(status) {
  return status
    .split('_')
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join('');
}

// Section 7/13b: same fixed forward sequence as WarehouseOrdersPage's
// ADVANCE_KEYS - one step at a time, no skipping, no cancel (pharmacist
// only).
const ADVANCE_KEYS = {
  pending: 'orders.advancePending',
  confirmed: 'orders.advanceConfirmed',
  preparing: 'orders.advancePreparing',
  out_for_delivery: 'orders.advanceOutForDelivery',
};

const REASON_KEYS = {
  damaged: 'returns.reasonDamaged',
  wrong_item: 'returns.reasonWrongItem',
  other: 'returns.reasonOther',
};

// SYP first: it is the default currency for every amount in the panel.
const CURRENCIES = ['SYP', 'USD'];

function RecordPaymentModal({ pharmacyId, onClose, onRecorded }) {
  const { t } = useTranslation();
  const usdToSyp = useExchangeRate();
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('SYP');
  const [note, setNote] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState(null);
  // The pharmacy's outstanding balance with this warehouse (USD), for the
  // "Full amount" prefill. Payments settle the running balance, not a single
  // order - same figure the Debts tab shows.
  const [remainingUsd, setRemainingUsd] = useState(null);

  useEffect(() => {
    let active = true;
    api
      .warehouseBalanceDetail(pharmacyId)
      .then((data) => {
        if (active) setRemainingUsd(data.balanceUsd);
      })
      .catch(() => {
        // Non-fatal: the form still works, "Full amount" just stays disabled.
      });
    return () => {
      active = false;
    };
  }, [pharmacyId]);

  const fullAmount = remainingPaymentAmount(remainingUsd, currency, usdToSyp);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError(null);

    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) {
      setError(t('debts.amountPositive'));
      return;
    }

    setIsSaving(true);
    try {
      await api.createPayment({ pharmacyId, amount: value, currency, note: note.trim() || undefined });
      onRecorded();
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(event) => event.stopPropagation()}>
        <h2>{t('orderDetail.recordPayment')}</h2>
        <form onSubmit={handleSubmit} className="product-form">
          <label>
            {t('debts.amount')}
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
            />
          </label>
          <label>
            {t('debts.currency')}
            <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('debts.noteOptional')}
            <input value={note} onChange={(e) => setNote(e.target.value)} />
          </label>

          <button
            type="button"
            className="btn-secondary"
            disabled={fullAmount == null}
            onClick={() => setAmount(String(fullAmount))}
          >
            {t('debts.fullAmount')}
          </button>

          {error && <p className="error-text">{error}</p>}

          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={onClose}>
              {t('common.cancel')}
            </button>
            <button type="submit" className="btn-primary" disabled={isSaving}>
              {isSaving ? t('common.saving') : t('orderDetail.recordPayment')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// Section: the warehouse correcting an order's items before it's confirmed
// - only ever rendered while status is 'pending' (the parent gates it, see
// WarehouseOrderDetailPage below); the backend rejects an edit past that
// point regardless. Local draft state (quantities, staged removals, staged
// new lines) lives here and is only ever sent to the server as one batched
// PATCH from "Save changes" - nothing here calls the API per keystroke.
function EditItemsSection({ order, onSaved }) {
  const { t } = useTranslation();
  const usdToSyp = useExchangeRate();

  const [items, setItems] = useState([]);
  const [removedIds, setRemovedIds] = useState(() => new Set());
  const [newItems, setNewItems] = useState([]);
  const [availableProducts, setAvailableProducts] = useState([]);
  const [selectedProductId, setSelectedProductId] = useState('');
  const [newQuantity, setNewQuantity] = useState(1);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);

  // Redraws the working draft from the server's own item list - runs on
  // mount and again after every successful save (the parent re-fetches and
  // hands down a fresh `order`), so the draft never lingers stale.
  useEffect(() => {
    setItems(
      order.items.map((item) => ({
        id: item.id,
        productNameAr: item.productNameAr,
        productNameEn: item.productNameEn,
        quantity: item.quantity,
      }))
    );
    setRemovedIds(new Set());
    setNewItems([]);
    setError(null);
  }, [order.items]);

  useEffect(() => {
    api
      .warehouseProducts({ available: true })
      .then((data) => setAvailableProducts(data.products))
      .catch(() => {
        // Silent - the "add item" picker just stays empty; everything else
        // on this section (quantity edits, removals) still works.
      });
  }, []);

  const remainingCount = items.filter((item) => !removedIds.has(item.id)).length + newItems.length;

  const handleQuantityChange = (id, value) => {
    const quantity = Math.max(1, Math.trunc(Number(value)) || 1);
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, quantity } : item)));
  };

  const handleRemove = (id) => {
    if (!window.confirm(t('orderDetail.confirmRemoveItem'))) return;
    setRemovedIds((prev) => new Set(prev).add(id));
  };

  const handleNewQuantityChange = (tempId, value) => {
    const quantity = Math.max(1, Math.trunc(Number(value)) || 1);
    setNewItems((prev) => prev.map((item) => (item.tempId === tempId ? { ...item, quantity } : item)));
  };

  const handleRemoveNew = (tempId) => {
    if (!window.confirm(t('orderDetail.confirmRemoveItem'))) return;
    setNewItems((prev) => prev.filter((item) => item.tempId !== tempId));
  };

  const handleAddItem = () => {
    const product = availableProducts.find((p) => p.id === selectedProductId);
    if (!product) return;
    setNewItems((prev) => [
      ...prev,
      {
        tempId: `${product.id}-${Date.now()}`,
        productId: product.id,
        productNameAr: product.nameAr,
        productNameEn: product.nameEn,
        quantity: Math.max(1, Math.trunc(Number(newQuantity)) || 1),
      },
    ]);
    setSelectedProductId('');
    setNewQuantity(1);
  };

  // The exact diff the PATCH endpoint expects - only items whose quantity
  // actually changed from the server's own value end up in updateItems, so
  // an untouched row never gets sent back.
  const diff = useMemo(() => {
    const originalQuantityById = new Map(order.items.map((item) => [item.id, item.quantity]));
    const updateItems = items
      .filter((item) => !removedIds.has(item.id) && originalQuantityById.get(item.id) !== item.quantity)
      .map((item) => ({ orderItemId: item.id, quantity: item.quantity }));
    const addItems = newItems.map((item) => ({ productId: item.productId, quantity: item.quantity }));
    return { addItems, removeItems: [...removedIds], updateItems };
  }, [items, removedIds, newItems, order.items]);

  const hasChanges = diff.addItems.length > 0 || diff.removeItems.length > 0 || diff.updateItems.length > 0;

  const handleSave = async () => {
    // Belt and suspenders - the Save button is already disabled with
    // nothing to send, but this is the one place that would actually fire
    // the request, so it guards here too.
    if (!hasChanges) return;
    if (!window.confirm(t('orderDetail.confirmSaveItemChanges'))) return;

    setIsSaving(true);
    setError(null);
    setMessage(null);
    try {
      await api.updateOrderItems(order.id, diff);
      setMessage(t('orderDetail.itemChangesSaved'));
      await onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="wh-detail-card">
      <h2 className="wh-detail-card-title">{t('orderDetail.editItemsTitle')}</h2>
      <div className="table-scroll">
        <table className="wh-table wh-table-compact">
          <thead>
            <tr>
              <th>{t('orderDetail.product')}</th>
              <th>{t('orderDetail.qty')}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {items
              .filter((item) => !removedIds.has(item.id))
              .map((item) => (
                <tr key={item.id}>
                  <td>{withArFallback(item.productNameEn, item.productNameAr)}</td>
                  <td className="wh-num">
                    <input
                      type="number"
                      min="1"
                      value={item.quantity}
                      onChange={(e) => handleQuantityChange(item.id, e.target.value)}
                      style={{ width: 70 }}
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn-reject"
                      disabled={remainingCount <= 1}
                      title={remainingCount <= 1 ? t('orderDetail.cannotRemoveLastItem') : undefined}
                      onClick={() => handleRemove(item.id)}
                    >
                      {t('orderDetail.removeItemButton')}
                    </button>
                  </td>
                </tr>
              ))}
            {newItems.map((item) => (
              <tr key={item.tempId}>
                <td>{withArFallback(item.productNameEn, item.productNameAr)}</td>
                <td className="wh-num">
                  <input
                    type="number"
                    min="1"
                    value={item.quantity}
                    onChange={(e) => handleNewQuantityChange(item.tempId, e.target.value)}
                    style={{ width: 70 }}
                  />
                </td>
                <td>
                  <button
                    type="button"
                    className="btn-reject"
                    disabled={remainingCount <= 1}
                    title={remainingCount <= 1 ? t('orderDetail.cannotRemoveLastItem') : undefined}
                    onClick={() => handleRemoveNew(item.tempId)}
                  >
                    {t('orderDetail.removeItemButton')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3 className="wh-detail-card-title" style={{ fontSize: '0.95rem', marginTop: 16 }}>
        {t('orderDetail.addItemTitle')}
      </h3>
      {availableProducts.length === 0 ? (
        <p className="hint">{t('orderDetail.noAvailableProducts')}</p>
      ) : (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <select
            value={selectedProductId}
            onChange={(e) => setSelectedProductId(e.target.value)}
            style={{ flex: '1 1 240px' }}
          >
            <option value="">{t('orderDetail.selectProductPlaceholder')}</option>
            {availableProducts.map((product) => (
              <option key={product.id} value={product.id}>
                {withArFallback(product.nameEn, product.nameAr)} ({formatUsdAsSyp(product.priceUsd, usdToSyp)})
              </option>
            ))}
          </select>
          <input
            type="number"
            min="1"
            value={newQuantity}
            onChange={(e) => setNewQuantity(e.target.value)}
            style={{ width: 70 }}
          />
          <button type="button" className="btn-secondary" disabled={!selectedProductId} onClick={handleAddItem}>
            {t('orderDetail.addItemButton')}
          </button>
        </div>
      )}

      {error && <p className="error-text">{error}</p>}
      {message && <p className="hint">{message}</p>}

      <button
        type="button"
        className="btn-primary"
        style={{ marginTop: 16 }}
        disabled={!hasChanges || isSaving}
        onClick={handleSave}
      >
        {isSaving ? t('common.saving') : t('orderDetail.saveItemChanges')}
      </button>
    </div>
  );
}

// Same normalization as the Flutter app's whatsapp_launcher.dart
// (normalizeSyrianPhoneForWhatsApp) - wa.me needs digits only with the
// country code, no leading +/spaces, and stored phones are local (leading
// 0) format.
function toWhatsAppNumber(phone) {
  const digits = (phone || '').replace(/\D/g, '');
  if (digits.startsWith('963')) return digits;
  if (digits.startsWith('0')) return `963${digits.slice(1)}`;
  return digits;
}

function handleCallPharmacyViaWhatsApp(phone) {
  const number = toWhatsAppNumber(phone);
  if (!number) return;
  window.open(`https://wa.me/${number}`, '_blank', 'noreferrer');
}

// Order detail, reached by clicking an order card on WarehouseOrdersPage.
// The rate-pharmacy action stays list-only (untouched); advance-status,
// return approve/reject, and record-payment are added here per the
// warehouse's allowed actions (see PROGRESSION in
// backend/src/services/warehouseOrder.service.js - one step at a time, no
// cancel, no item/price edits).
export function WarehouseOrderDetailPage() {
  const { t } = useTranslation();
  const { orderId } = useParams();
  const navigate = useNavigate();
  // Order/invoice figures are SYP-native; only per-line savings are USD and
  // need the live rate to show in SYP.
  const usdToSyp = useExchangeRate();
  const [order, setOrder] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isAdvancing, setIsAdvancing] = useState(false);
  const [sealBusy, setSealBusy] = useState(false);

  // The order-detail endpoint only exposes `hasReturn` (a badge, not enough
  // to act on) - the pending return itself, if any, comes from the existing
  // warehouse returns list (already carries orderId), matched client-side.
  // Same approve/reject endpoints WarehouseReturnsPage already uses.
  const [pendingReturn, setPendingReturn] = useState(null);
  const [returnBusy, setReturnBusy] = useState(false);

  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentMessage, setPaymentMessage] = useState(null);

  const statusLabel = useCallback((status) => t(`orders.status${statusKeySuffix(status)}`), [t]);
  const reasonText = useCallback(
    (item) => {
      if (item.reasonType === 'other' && item.customReason) return item.customReason;
      return REASON_KEYS[item.reasonType] ? t(REASON_KEYS[item.reasonType]) : item.reasonType;
    },
    [t],
  );

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await api.warehouseOrderDetail(orderId);
      setOrder(data.order);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, [orderId]);

  const loadPendingReturn = useCallback(async () => {
    try {
      const data = await api.warehouseReturns();
      const match = data.returns.find((r) => r.orderId === orderId && r.status === 'pending');
      setPendingReturn(match ?? null);
    } catch (err) {
      setError(err.message);
    }
  }, [orderId]);

  useEffect(() => {
    load();
    loadPendingReturn();
  }, [load, loadPendingReturn]);

  // Realtime: only re-read when the event is about the order on screen -
  // another order changing in the same warehouse is irrelevant here. A
  // reconnect (payload null) always resyncs, since we can't know what was
  // missed. Keeps a second operator's screen, or a pharmacy's cancellation,
  // from leaving this page acting on stale state.
  useRealtimeSync(
    [
      REALTIME_EVENTS.ORDER_CANCELLED,
      REALTIME_EVENTS.ORDER_STATUS_UPDATED,
      REALTIME_EVENTS.RETURN_CREATED,
      REALTIME_EVENTS.RETURN_STATUS_UPDATED,
    ],
    (payload) => {
      if (payload && payload.orderId !== orderId) return;
      load();
      loadPendingReturn();
    }
  );

  const handleAdvance = async () => {
    if (!window.confirm(t('orderDetail.confirmAdvance', { action: t(ADVANCE_KEYS[order.status]) }))) return;
    setIsAdvancing(true);
    setError(null);
    try {
      await api.advanceOrderStatus(order.id);
      // Re-fetches this order's own detail (status/statusHistory change) -
      // no full page reload. The list page picks up the new status on its
      // own next mount (it always refetches on mount/tab-change), so
      // there's nothing further to push there from here.
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setIsAdvancing(false);
    }
  };

  const handleSealRequirementChange = async (next) => {
    setSealBusy(true);
    setError(null);
    try {
      await api.setOrderDeliverySealRequirement(order.id, next);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSealBusy(false);
    }
  };

  const handleApproveReturn = async () => {
    const confirmed = window.confirm(t('orderDetail.confirmApproveReturn', { number: order.orderNumber }));
    if (!confirmed) return;

    setReturnBusy(true);
    setError(null);
    try {
      await api.approveReturn(pendingReturn.id);
      await loadPendingReturn();
    } catch (err) {
      setError(err.message);
    } finally {
      setReturnBusy(false);
    }
  };

  const handleRejectReturn = async () => {
    const rejectionNote = window.prompt(t('orderDetail.promptRejectReturn', { number: order.orderNumber }));
    if (!rejectionNote || !rejectionNote.trim()) return;

    setReturnBusy(true);
    setError(null);
    try {
      await api.rejectReturn(pendingReturn.id, rejectionNote.trim());
      await loadPendingReturn();
    } catch (err) {
      setError(err.message);
    } finally {
      setReturnBusy(false);
    }
  };

  const handlePaymentRecorded = () => {
    setShowPaymentModal(false);
    setPaymentMessage(t('orderDetail.paymentRecorded'));
  };

  return (
    <div>
      <button className="wh-detail-back" onClick={() => navigate('/warehouse/orders')}>
        &larr; {t('orderDetail.backToOrders')}
      </button>

      {error && <p className="error-text">{error}</p>}

      {isLoading ? (
        <p className="hint">{t('common.loading')}</p>
      ) : !order ? null : (
        <div className="wh-detail-grid">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
            <div className="wh-detail-card">
              <div className="wh-detail-header-row">
                <h1>{t('orders.orderNumber', { number: order.orderNumber })}</h1>
                <span className={`status-badge status-${order.status}`}>{statusLabel(order.status)}</span>
                {order.hasReturn && (
                  <span className="status-badge status-pending">{t('orderDetail.returnRequestExists')}</span>
                )}
              </div>
              <div className="wh-detail-timestamp wh-num">{new Date(order.createdAt).toLocaleString()}</div>
            </div>

            <div className="wh-detail-card wh-pharmacy-card">
              <div>
                <div className="wh-pharmacy-label">{t('orderDetail.pharmacy')}</div>
                <div className="wh-pharmacy-name">
                  {withArFallback(order.pharmacy?.nameEn, order.pharmacy?.nameAr)}
                </div>
                <div className="wh-pharmacy-meta">
                  {order.pharmacy?.address}
                  {order.pharmacy?.phone ? ` · ${order.pharmacy.phone}` : ''}
                </div>
              </div>
              {order.pharmacy?.phone && (
                <div className="wh-pharmacy-actions">
                  <button className="btn-approve" onClick={() => handleCallPharmacyViaWhatsApp(order.pharmacy.phone)}>
                    <img src="/images/whatsapp_icon.png" alt="" width="20" height="20" className="btn-icon" />
                    {t('orderDetail.whatsapp')}
                  </button>
                </div>
              )}
            </div>

            <div className="wh-detail-card" style={{ padding: 0, overflow: 'hidden' }}>
              <h2 className="wh-detail-card-title" style={{ padding: '14px 20px', margin: 0, borderBottom: '2px solid var(--wh-border)' }}>
                {t('orderDetail.items')}
              </h2>
              <div className="table-scroll">
                <table className="wh-table wh-table-compact">
                  <thead>
                    <tr>
                      <th>{t('orderDetail.product')}</th>
                      <th>{t('orderDetail.qty')}</th>
                      <th>{t('orderDetail.originalPrice')}</th>
                      <th>{t('orderDetail.afterDiscount')}</th>
                      <th>{t('orderDetail.total')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {order.items.map((item) => (
                      <tr key={item.id}>
                        <td>
                          <div className="product-name">
                            {withArFallback(item.productNameEn, item.productNameAr)}
                          </div>
                          {item.savingsUsd > 0 && (
                            <div className="hint">
                              💰 {t('orderDetail.saved', { amount: formatMoneyFromUsd(item.savingsUsd, usdToSyp) })}
                            </div>
                          )}
                        </td>
                        <td className="wh-num">{item.quantity}</td>
                        <td className="wh-num">{formatSyp(item.unitPrice)}</td>
                        <td className="wh-num">{formatSyp(item.discountPrice)}</td>
                        <td className="wh-num wh-table-total">{formatSyp(item.lineTotal)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {order.notes && (
                <p className="order-notes" style={{ margin: 0, padding: '12px 20px', borderTop: '1px solid #EEE' }}>
                  {t('common.note', { note: order.notes })}
                </p>
              )}
            </div>

            {order.status !== 'delivered' && order.status !== 'cancelled' && (
              <div className="wh-detail-card">
                <h2 className="wh-detail-card-title">{t('orderDetail.sealRequirementTitle')}</h2>
                <label className="checkbox-row" style={{ marginTop: 8 }}>
                  <input
                    type="checkbox"
                    checked={Boolean(order.requiresDeliverySealPhoto)}
                    disabled={sealBusy}
                    onChange={(e) => handleSealRequirementChange(e.target.checked)}
                  />
                  {t('orderDetail.sealRequirementToggle')}
                </label>
                <p className="hint" style={{ margin: '6px 0 0' }}>
                  {t('orderDetail.sealRequirementHint')}
                </p>
              </div>
            )}

            {order.status === 'pending' && <EditItemsSection order={order} onSaved={load} />}

            {order.deliverySealPhoto && (
              <div className="wh-detail-card">
                <h2 className="wh-detail-card-title">{t('orderDetail.deliverySealPhoto')}</h2>
                <a href={order.deliverySealPhoto} target="_blank" rel="noreferrer">
                  <img
                    src={order.deliverySealPhoto}
                    alt={t('orderDetail.deliverySealPhoto')}
                    style={{ maxWidth: '100%', borderRadius: 8, display: 'block' }}
                  />
                </a>
                {order.deliverySealConfirmedAt && (
                  <p className="hint" style={{ marginTop: 8, marginBottom: 0 }}>
                    {t('orderDetail.deliverySealConfirmedAt', {
                      date: new Date(order.deliverySealConfirmedAt).toLocaleString(),
                    })}
                  </p>
                )}
              </div>
            )}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="wh-detail-card">
              <h2 className="wh-detail-card-title">{t('orderDetail.summary')}</h2>
              <div className="wh-summary-row">
                <span>{t('orderDetail.total')}</span>
                <span className="wh-num">{formatSyp(order.totalPrice)}</span>
              </div>
              <div className="wh-summary-row wh-summary-discount">
                <span>{t('orderDetail.platformDiscountLabel')}</span>
                <span className="wh-num">− {formatSyp(order.discountAmount)}</span>
              </div>
              {/* Only on an order that came from an advertisement package -
                  its own line, never folded into the platform discount above,
                  so the two stay auditable. */}
              {order.advertisementDiscountAmount > 0 && (
                <div className="wh-summary-row wh-summary-discount">
                  <span>{t('orderDetail.advertisementDiscountLabel')}</span>
                  <span className="wh-num">
                    − {formatSyp(order.advertisementDiscountAmount)}
                  </span>
                </div>
              )}
              <div className="wh-summary-divider" />
              <div className="wh-summary-total">
                <span>{t('orderDetail.finalPriceColumn')}</span>
                <span className="wh-num">{formatSyp(order.finalPrice)}</span>
              </div>
            </div>

            <div className="wh-detail-card">
              <h2 className="wh-detail-card-title">{t('orderDetail.statusHistory')}</h2>
              {order.statusHistory.map((entry, index) => (
                <div className="wh-timeline-item" key={index}>
                  <div className="wh-timeline-dot" />
                  <div>
                    <div className="wh-timeline-label">{statusLabel(entry.status)}</div>
                    <div className="wh-timeline-at wh-num">{new Date(entry.changedAt).toLocaleString()}</div>
                  </div>
                </div>
              ))}
            </div>

            {pendingReturn && (
              <div className="wh-pending-return-card">
                <div className="wh-pending-return-title">{t('orderDetail.pendingReturnTitle')}</div>
                <div style={{ marginBottom: 12 }}>
                  {pendingReturn.items.map((item) => (
                    <p key={item.orderItemId} className="order-notes">
                      {t('returns.qtyLine', {
                        name: withArFallback(item.productNameEn, item.productNameAr),
                        quantity: item.quantity,
                        reason: reasonText(item),
                      })}
                    </p>
                  ))}
                  {pendingReturn.notes && (
                    <p className="order-notes">{t('common.note', { note: pendingReturn.notes })}</p>
                  )}
                </div>
                <div className="return-actions">
                  <button className="btn-approve" disabled={returnBusy} onClick={handleApproveReturn}>
                    {t('common.approve')}
                  </button>
                  <button className="btn-reject" disabled={returnBusy} onClick={handleRejectReturn}>
                    {t('common.reject')}
                  </button>
                </div>
              </div>
            )}

            <div className="wh-detail-actions" style={{ marginTop: 'auto' }}>
              {ADVANCE_KEYS[order.status] && (
                <button className="btn-primary" disabled={isAdvancing} onClick={handleAdvance}>
                  {isAdvancing ? t('orders.updating') : t(ADVANCE_KEYS[order.status])}
                </button>
              )}
              {order.requiresDeliverySealPhoto &&
                order.status === 'out_for_delivery' &&
                !order.deliverySealPhoto && (
                  <p className="hint">{t('orderDetail.awaitingDeliverySealPhoto')}</p>
                )}
              {order.status === 'delivered' && (
                <button className="btn-secondary" onClick={() => setShowPaymentModal(true)}>
                  {t('orderDetail.recordPayment')}
                </button>
              )}
              {paymentMessage && <p className="hint">{paymentMessage}</p>}
            </div>
          </div>
        </div>
      )}

      {showPaymentModal && order && (
        <RecordPaymentModal
          pharmacyId={order.pharmacy.id}
          onClose={() => setShowPaymentModal(false)}
          onRecorded={handlePaymentRecorded}
        />
      )}
    </div>
  );
}
