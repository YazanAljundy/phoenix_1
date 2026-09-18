import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { withArFallback } from '../utils/displayName';
import { useExchangeRate } from '../context/ExchangeRateContext';
import { REALTIME_EVENTS, useRealtimeSync } from '../realtime/useRealtimeSync';
import { formatUsdAsSyp, formatSyp, formatMoneyFromUsd, remainingPaymentAmountFromSyp } from '../utils/currency';
import { PAYMENT_METHODS, PAYMENT_CURRENCIES as CURRENCIES, createIdempotencyKeys } from '../utils/payments';
import { mayAdvance } from './orderStatusFlow';

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

function RecordPaymentModal({ pharmacyId, onClose, onRecorded }) {
  const { t } = useTranslation();
  const usdToSyp = useExchangeRate();
  // One idempotency key per payment this modal records (createIdempotencyKeys).
  // The modal unmounts when closed, so reopening it starts from fresh keys.
  const [idempotencyKeys] = useState(createIdempotencyKeys);
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('SYP');
  const [method, setMethod] = useState('cash');
  const [note, setNote] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState(null);
  // The pharmacy's outstanding balance with this warehouse, for the "Full
  // amount" prefill. Payments settle the running balance, not a single order -
  // the same figure the Invoices tab shows.
  //
  // Money-Flow V2: SYP-native, read off the account statement's closing
  // position. This modal read the old `balanceUsd` field, which the endpoint
  // stopped returning when the read path moved to the ledger.
  const [remainingSyp, setRemainingSyp] = useState(null);

  useEffect(() => {
    let active = true;
    api
      .warehouseBalanceDetail(pharmacyId)
      .then((data) => {
        if (active) setRemainingSyp(data.statement?.outstandingDebtSyp ?? null);
      })
      .catch(() => {
        // Non-fatal: the form still works, "Full amount" just stays disabled.
      });
    return () => {
      active = false;
    };
  }, [pharmacyId]);

  const fullAmount = remainingPaymentAmountFromSyp(remainingSyp, currency, usdToSyp);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError(null);

    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) {
      setError(t('debts.amountPositive'));
      return;
    }

    const payment = {
      pharmacyId,
      amount: value,
      currency,
      method,
      note: note.trim() || undefined,
    };
    setIsSaving(true);
    try {
      // The same payment keeps the same key across attempts: if the response
      // never arrives and the operator submits again, the server returns the
      // payment it already recorded instead of crediting the pharmacy twice.
      await idempotencyKeys.submit(payment, (idempotencyKey) =>
        api.createPayment({ ...payment, idempotencyKey })
      );
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
            {t('debts.method')}
            <select value={method} onChange={(e) => setMethod(e.target.value)}>
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {t(`debts.method_${m}`)}
                </option>
              ))}
            </select>
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
  // The only two package edits there are: how many copies, and dropping one
  // outright. Keyed by package-group id.
  const [packageCopies, setPackageCopies] = useState({});
  const [removedGroupIds, setRemovedGroupIds] = useState(new Set());

  // Redraws the working draft from the server's own item list - runs on
  // mount and again after every successful save (the parent re-fetches and
  // hands down a fresh `order`), so the draft never lingers stale.
  useEffect(() => {
    setItems(
      order.items
        // Package lines never enter the draft: they are locked server-side
        // (PACKAGE_ITEMS_LOCKED) because their quantity is dictated by the
        // package's frozen snapshot, not by this row. They are shown, read
        // only, on the package cards below.
        .filter((item) => !item.packageGroupId)
        .map((item) => ({
          id: item.id,
          productNameAr: item.productNameAr,
          productNameEn: item.productNameEn,
          quantity: item.quantity,
        }))
    );
    setRemovedIds(new Set());
    setNewItems([]);
    setPackageCopies({});
    setRemovedGroupIds(new Set());
    setError(null);
  }, [order.items, order.packageGroups]);

  useEffect(() => {
    api
      .warehouseProducts({ available: true })
      .then((data) => setAvailableProducts(data.products))
      .catch(() => {
        // Silent - the "add item" picker just stays empty; everything else
        // on this section (quantity edits, removals) still works.
      });
  }, []);

  const packageGroups = order.packageGroups ?? [];
  const liveGroups = packageGroups.filter((group) => !removedGroupIds.has(group.id));
  const copiesOf = (group) => packageCopies[group.id] ?? group.copies;

  // Lines still on the order after this draft: the surviving loose lines, the
  // added ones, and every line the surviving packages bring with them.
  const remainingPackageLines = order.items.filter(
    (item) => item.packageGroupId && !removedGroupIds.has(item.packageGroupId)
  ).length;
  const remainingCount =
    items.filter((item) => !removedIds.has(item.id)).length + newItems.length + remainingPackageLines;

  const handleCopiesChange = (groupId, value) => {
    const copies = Math.max(1, Math.trunc(Number(value)) || 1);
    setPackageCopies((prev) => ({ ...prev, [groupId]: copies }));
  };

  const handleRemoveGroup = (groupId) => {
    if (!window.confirm(t('orderDetail.confirmRemovePackage'))) return;
    setRemovedGroupIds((prev) => new Set(prev).add(groupId));
  };

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
    // Only a package whose copies actually moved is sent, same rule the loose
    // lines follow - an untouched card never ends up in the request.
    const updatePackages = (order.packageGroups ?? [])
      .filter((group) => !removedGroupIds.has(group.id))
      .filter((group) => (packageCopies[group.id] ?? group.copies) !== group.copies)
      .map((group) => ({ groupId: group.id, copies: packageCopies[group.id] }));
    return {
      addItems,
      removeItems: [...removedIds],
      updateItems,
      updatePackages,
      removePackages: [...removedGroupIds],
    };
  }, [items, removedIds, newItems, order.items, order.packageGroups, packageCopies, removedGroupIds]);

  const hasChanges =
    diff.addItems.length > 0 ||
    diff.removeItems.length > 0 ||
    diff.updateItems.length > 0 ||
    diff.updatePackages.length > 0 ||
    diff.removePackages.length > 0;

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

      {/* Section: packages. A package was bought as a unit at an agreed price,
          so its products are not this warehouse's to change - the API refuses
          a per-line edit outright (PACKAGE_ITEMS_LOCKED) and this panel offers
          only what it will accept: how many copies, or dropping it entirely.
          The products are listed underneath, read only, so the picker still
          knows exactly what to put in the box. */}
      {liveGroups.map((group) => (
        <div key={group.id} className="wh-package-card">
          <div className="wh-package-head">
            <span className="wh-package-title">
              <span className="wh-package-badge">{t('orderDetail.packageBadge')}</span>
              {withArFallback(group.titleEn, group.titleAr)}
            </span>
            <span className="wh-num wh-package-price">
              {formatSyp(group.totalPriceSyp)}
              <span className="wh-package-locked">{t('orderDetail.packagePriceLocked')}</span>
            </span>
          </div>

          <div className="wh-package-controls">
            <label>
              {t('orderDetail.packageCopies')}
              <input
                type="number"
                min="1"
                value={copiesOf(group)}
                onChange={(e) => handleCopiesChange(group.id, e.target.value)}
                style={{ width: 70, marginInlineStart: 8 }}
              />
            </label>
            <button
              type="button"
              className="btn-reject"
              disabled={remainingCount - group.items.length < 1}
              title={
                remainingCount - group.items.length < 1
                  ? t('orderDetail.cannotRemoveLastItem')
                  : undefined
              }
              onClick={() => handleRemoveGroup(group.id)}
            >
              {t('orderDetail.removePackageButton')}
            </button>
          </div>

          <ul className="wh-package-items">
            {group.items.map((item) => {
              const line = order.items.find(
                (row) => row.packageGroupId === group.id && row.productId === item.productId
              );
              return (
                <li key={item.productId}>
                  {line ? withArFallback(line.productNameEn, line.productNameAr) : item.productId}
                  <span className="wh-num">
                    {' x'}
                    {item.quantityPerCopy * copiesOf(group)}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ))}

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
  // Replaces the dialog that used to acknowledge every status change: the
  // operator gets told what happened without having to dismiss anything.
  // An inline line in the action column, not a floating toast - see the
  // .wh-realtime-pill note in index.css for why this panel avoids those.
  const [statusMessage, setStatusMessage] = useState(null);

  const statusLabel = useCallback((status) => t(`orders.status${statusKeySuffix(status)}`), [t]);
  const reasonText = useCallback(
    (item) => {
      if (item.reasonType === 'other' && item.customReason) return item.customReason;
      return REASON_KEYS[item.reasonType] ? t(REASON_KEYS[item.reasonType]) : item.reasonType;
    },
    [t],
  );

  // `silent` skips the page-level loading state, leaving the order on screen
  // while it refreshes. Used only by handleAdvance: now that four of the five
  // transitions apply without a dialog, an operator clicks through a normal
  // order quickly, and blanking the whole detail to "Loading..." on each step
  // (which also wipes the success line it is meant to leave behind) reads as a
  // stutter rather than as progress. Every other caller keeps the visible
  // load it has always had.
  const load = useCallback(async (options) => {
    // Read defensively rather than destructured: `load` is handed straight to
    // EditItemsSection as its onSaved prop, so a caller can invoke it with
    // whatever it likes (a DOM event, null) - and that must degrade to a
    // normal visible load, never throw.
    const silent = options?.silent === true;
    if (!silent) setIsLoading(true);
    setError(null);
    try {
      const data = await api.warehouseOrderDetail(orderId);
      setOrder(data.order);
      // Returned as well as stored: handleAdvance needs the fresh status to
      // name it in its success line, and the state setter above won't have
      // landed by the time it reads it.
      return data.order;
    } catch (err) {
      setError(err.message);
      return null;
    } finally {
      if (!silent) setIsLoading(false);
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
    // Only leaving 'preparing' still asks - see orderStatusFlow.js. Every
    // other step applies on click and reports itself below the button.
    const proceed = mayAdvance(order.status, {
      confirm: () =>
        window.confirm(t('orderDetail.confirmAdvance', { action: t(ADVANCE_KEYS[order.status]) })),
    });
    if (!proceed) return;

    setIsAdvancing(true);
    setError(null);
    setStatusMessage(null);
    try {
      await api.advanceOrderStatus(order.id);
      // Re-fetches this order's own detail (status/statusHistory change) -
      // no full page reload. The list page picks up the new status on its
      // own next mount (it always refetches on mount/tab-change), so
      // there's nothing further to push there from here.
      const updated = await load({ silent: true });
      // Named from the reloaded order rather than from a local guess at the
      // next status: the backend owns the progression, and a realtime event
      // or a second operator could have moved it further in between.
      if (updated) setStatusMessage(t('orderDetail.statusAdvanced', { status: statusLabel(updated.status) }));
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
    // Money-Flow V2: show the operator the exact credit before committing.
    let preview;
    try {
      preview = await api.returnCreditPreview(pendingReturn.id);
    } catch (err) {
      setError(err.message);
      return;
    }
    const confirmed = window.confirm(
      t('orderDetail.confirmApproveReturnCredit', {
        number: order.orderNumber,
        amount: formatSyp(preview.preview.creditSyp),
      })
    );
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
                            {/* Says which lines came in as part of a package,
                                so the picking list reads the same way the
                                edit panel above groups them. */}
                            {item.packageGroupId && (
                              <span className="wh-package-badge">{t('orderDetail.packageBadge')}</span>
                            )}
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
              {/* Money-Flow V2: what this order actually nets the warehouse.
                  V1 stored a commission on every order and showed it nowhere,
                  so a warehouse could not tell what a package deal really
                  earned. Both figures are frozen on the order. */}
              <div className="wh-summary-row wh-summary-commission">
                <span>{t('orderDetail.commissionLabel')}</span>
                <span className="wh-num">− {formatSyp(order.commissionAmount)}</span>
              </div>
              <div className="wh-summary-total wh-summary-net">
                <span>{t('orderDetail.warehouseNetLabel')}</span>
                <span className="wh-num">
                  {formatSyp(order.warehouseNetSyp ?? order.finalPrice - order.commissionAmount)}
                </span>
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
              {statusMessage && <p className="hint">{statusMessage}</p>}
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
