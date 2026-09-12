import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { formatSyp } from '../utils/currency';
import { withArFallback } from '../utils/displayName';
import { PAYMENT_METHODS } from '../utils/payments';
import { LoadMoreControl } from '../components/LoadMoreControl';
import { usePaginatedData } from '../hooks/usePaginatedData';

const COLLECTIONS_PAGE_SIZE = 50;

// Money-Flow V2 - the platform's side of commission.
//
// The warehouse's own Settlement tab answers "what do I keep?"; this answers
// the platform's question, "who owes us, and have they paid?" - every
// warehouse at once, over one admin-chosen window.
//
// Two things it is deliberately NOT:
//
//  * not a second ledger. Commission is warehouse-to-platform; a LedgerAccount
//    is pharmacy-to-warehouse. Recording a collection here never touches a
//    pharmacy's balance.
//  * not a recomputation. Every figure below is server-computed by the same
//    settlement service the warehouse's tab uses, so the two can never tell
//    different stories about the same period.
//
// The date range is owned by this page and applies to the whole table AND to
// the detail view beneath it, so a warehouse's row and its breakdown always
// describe the same window.

function toDateInputValue(value) {
  if (!value) return '';
  return new Date(value).toISOString().slice(0, 10);
}

function startOfThisMonth() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

// Outstanding is the one figure that can legitimately be negative: a warehouse
// that has handed over more than the window shows as owed. Rendered as a
// credit rather than clamped to zero, because an overpayment is something the
// admin needs to see, not something to tidy away.
function OutstandingAmount({ amountSyp }) {
  const { t } = useTranslation();
  if (amountSyp < 0) {
    return (
      <span className="adm-green" title={t('commission.overpaidHint')}>
        {formatSyp(amountSyp)}
      </span>
    );
  }
  return <span>{formatSyp(amountSyp)}</span>;
}

function StatCard({ label, value, hint, tone }) {
  return (
    <div className={`adm-stat-card${tone ? ` ${tone}` : ''}`}>
      <div className="adm-stat-label">{label}</div>
      <div className="adm-stat-value adm-num">{value}</div>
      {hint && <div className="adm-stat-hint">{hint}</div>}
    </div>
  );
}

// Records that a warehouse paid. The amount is pre-filled with what is
// outstanding for the current window but stays editable - a partial payment is
// a normal thing, and the admin may be recording a round figure that was
// actually handed over.
//
// The period submitted is the window currently being viewed: that is what the
// admin was looking at when they decided how much was owed, so it is the
// honest thing to file the payment against.
function RecordCollectionForm({ warehouseId, period, outstandingSyp, onSaved }) {
  const { t } = useTranslation();
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('cash');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState(null);

  // Re-prefills whenever the warehouse or the window changes, so the field
  // always opens on the figure sitting in the row above it.
  useEffect(() => {
    setAmount(outstandingSyp > 0 ? String(outstandingSyp) : '');
    setError(null);
  }, [warehouseId, outstandingSyp, period.from, period.to]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError(null);

    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) {
      setError(t('commission.amountPositive'));
      return;
    }

    setIsSaving(true);
    try {
      await api.recordCommissionCollection({
        warehouseId,
        periodFrom: period.from,
        periodTo: period.to,
        amountSyp: Math.round(value),
        method,
        reference: reference.trim() || undefined,
        note: note.trim() || undefined,
      });
      setReference('');
      setNote('');
      await onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="adm-detail-card">
      <h2 className="adm-detail-card-title">{t('commission.recordCollection')}</h2>
      <p className="adm-detail-card-hint">
        {t('commission.recordCollectionHint', {
          from: new Date(period.from).toLocaleDateString(),
          to: new Date(period.to).toLocaleDateString(),
        })}
      </p>
      <form onSubmit={handleSubmit} className="product-form">
        <label>
          {t('commission.amount')}
          <input
            type="number"
            min="1"
            step="1"
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
          {t('debts.referenceOptional')}
          <input
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder={t('debts.referencePlaceholder')}
          />
        </label>
        <label>
          {t('debts.noteOptional')}
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t('commission.notePlaceholder')}
          />
        </label>
        <div className="form-row">
          <button
            type="button"
            className="btn-secondary"
            disabled={outstandingSyp <= 0}
            onClick={() => setAmount(String(outstandingSyp))}
          >
            {t('commission.fullOutstanding')}
          </button>
          <button type="submit" className="btn-primary" style={{ flex: 1 }} disabled={isSaving}>
            {isSaving ? t('common.saving') : t('commission.recordCollectionButton')}
          </button>
        </div>
      </form>
      {error && <p className="error-text">{error}</p>}
    </div>
  );
}

// A collection is corrected by reversing it, never by editing or deleting -
// same rule, and same modal shape, as reversing a pharmacy payment. The reason
// is mandatory here and again on the server.
function ReverseCollectionModal({ collection, onClose, onConfirm }) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!reason.trim()) {
      setError(t('commission.reverseReasonRequired'));
      return;
    }
    setIsBusy(true);
    setError(null);
    try {
      await onConfirm(reason.trim());
    } catch (err) {
      setError(err.message);
      setIsBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(event) => event.stopPropagation()}>
        <h2>{t('commission.reverseTitle')}</h2>
        <p className="hint">
          {t('commission.reverseExplain', { amount: formatSyp(collection.amountSyp) })}
        </p>
        <form onSubmit={handleSubmit} className="product-form">
          <label>
            {t('debts.reverseReason')}
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t('commission.reverseReasonPlaceholder')}
              autoFocus
              required
            />
          </label>
          {error && <p className="error-text">{error}</p>}
          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={onClose} disabled={isBusy}>
              {t('common.cancel')}
            </button>
            <button type="submit" className="btn-reject" disabled={isBusy}>
              {isBusy ? t('common.saving') : t('commission.reverseButton')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// Every collection ever recorded against this warehouse - not just the ones
// inside the current window. A reversed row stays, struck through with the
// reason that undid it, because the history is the point.
function CollectionHistory({ collections, onReverse }) {
  const { t } = useTranslation();

  if (collections.length === 0) {
    return (
      <div className="adm-detail-card">
        <h2 className="adm-detail-card-title">{t('commission.history')}</h2>
        <p className="hint">{t('commission.noCollections')}</p>
      </div>
    );
  }

  return (
    <div className="adm-card table-scroll">
      <table className="adm-table">
        <thead>
          <tr>
            <th>{t('debts.date')}</th>
            <th>{t('commission.coversPeriod')}</th>
            <th className="adm-num">{t('commission.amount')}</th>
            <th>{t('commission.details')}</th>
            <th aria-label={t('debts.reverse')} />
          </tr>
        </thead>
        <tbody>
          {collections.map((collection) => {
            const isReversed = collection.status === 'reversed';
            const recordedAt = new Date(collection.recordedAt);
            return (
              <tr key={collection.id}>
                <td>
                  <div>{recordedAt.toLocaleDateString()}</div>
                  <div className="adm-table-sub">
                    {recordedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </td>
                <td className="adm-num">
                  {new Date(collection.periodFrom).toLocaleDateString()} &ndash;{' '}
                  {new Date(collection.periodTo).toLocaleDateString()}
                </td>
                <td className="adm-num">
                  <span
                    style={isReversed ? { textDecoration: 'line-through', opacity: 0.55 } : undefined}
                  >
                    {formatSyp(collection.amountSyp)}
                  </span>
                </td>
                <td>
                  <div className="adm-table-sub">{t(`debts.method_${collection.method}`)}</div>
                  {collection.reference && (
                    <div className="adm-table-sub adm-num">{collection.reference}</div>
                  )}
                  {collection.note && <div>{collection.note}</div>}
                  {isReversed && (
                    <div className="adm-table-sub">
                      {t('debts.reversedBecause', { reason: collection.reversalReason })}
                    </div>
                  )}
                </td>
                <td>
                  <div className="adm-row-actions">
                    {/* A reversal is final - there is nothing left to undo. */}
                    {!isReversed && (
                      <button
                        className="adm-row-action adm-row-action-danger"
                        onClick={() => onReverse(collection)}
                      >
                        {t('debts.reverse')}
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// One warehouse: the same figures as its row above, the per-order settlement
// breakdown behind them, the form that records a payment, and the history.
function WarehouseCommissionDetail({ warehouseId, from, to, onBack, onChanged }) {
  const { t, i18n } = useTranslation();
  // summary/orders/warehouse/period are not paginated - every fetchPage call
  // (the first load AND every "load more" of the collections history below)
  // returns the full current detail, so they are refreshed as a side effect
  // of that same request rather than fetched separately (same reasoning as
  // AdminOffersPage's reviewCount, which rides along with its own fetchPage).
  const [meta, setMeta] = useState(null);
  // The collection about to be reversed, held here so the modal is a sibling
  // of the table rather than a cell inside it.
  const [reversing, setReversing] = useState(null);

  const fetchPage = useCallback(
    (cursor) =>
      api.adminCommissionWarehouse(warehouseId, { from, to, limit: COLLECTIONS_PAGE_SIZE, after: cursor }).then((response) => {
        const { collections, pagination, ...rest } = response.detail;
        setMeta(rest);
        return { rows: collections, hasMore: pagination.hasMore, nextCursor: pagination.nextCursor };
      }),
    [warehouseId, from, to]
  );
  const {
    data: collections,
    isLoading,
    isLoadingMore,
    hasMore,
    error,
    loadMore,
    reset,
  } = usePaginatedData(fetchPage);

  useEffect(() => {
    reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [warehouseId, from, to]);

  // "Back" points toward where the list is - left in LTR, right in RTL.
  const backButton = (
    <button className="wh-detail-back" onClick={onBack}>
      <span aria-hidden="true">{i18n.language === 'ar' ? '→' : '←'}</span>{' '}
      {t('commission.backToList')}
    </button>
  );

  if (error) {
    return (
      <div>
        {backButton}
        <p className="error-text">{error}</p>
      </div>
    );
  }

  if (isLoading || !meta) {
    return (
      <div>
        {backButton}
        <p className="hint">{t('common.loading')}</p>
      </div>
    );
  }

  const { summary, orders, warehouse, period } = meta;

  // Both the row above and this view have to move when a collection is
  // recorded or reversed, so every mutation refreshes the two together.
  const reload = async () => {
    await reset();
    await onChanged();
  };

  return (
    <div>
      {backButton}

      <div className="adm-page-head">
        <h1>{withArFallback(warehouse.nameEn, warehouse.nameAr)}</h1>
        {warehouse.phone && (
          <div className="adm-page-head-meta adm-num" dir="ltr">
            {warehouse.phone}
          </div>
        )}
      </div>

      <div className="adm-stats-grid">
        <StatCard
          label={t('commission.sales')}
          value={formatSyp(summary.salesSyp)}
          hint={t('settlement.salesHint', { count: summary.orderCount })}
          tone="adm-stat-navy"
        />
        <StatCard
          label={t('commission.returns')}
          value={formatSyp(summary.returnsSyp)}
          hint={t('commission.returnsHint')}
        />
        <StatCard
          label={t('commission.owed')}
          value={formatSyp(summary.commissionOwedSyp)}
          hint={t('commission.owedHint')}
          tone="adm-stat-info"
        />
        <StatCard
          label={t('commission.outstanding')}
          value={formatSyp(summary.outstandingSyp)}
          hint={t('commission.collectedSoFar', {
            amount: formatSyp(summary.alreadyCollectedSyp),
          })}
          tone={summary.outstandingSyp > 0 ? 'adm-stat-pending' : 'adm-stat-success'}
        />
      </div>

      <div className="adm-detail-grid">
        <div>
          <div className="adm-card-head">
            <span>{t('commission.ordersBreakdown')}</span>
          </div>
          {orders.length === 0 ? (
            <div className="adm-empty-state">
              <div className="adm-empty-state-title">{t('settlement.noOrders')}</div>
            </div>
          ) : (
            <div className="adm-card table-scroll">
              <table className="adm-table">
                <thead>
                  <tr>
                    <th>{t('settlement.invoice')}</th>
                    <th>{t('settlement.deliveredOn')}</th>
                    <th className="adm-num">{t('commission.sales')}</th>
                    <th className="adm-num">{t('commission.returns')}</th>
                    <th className="adm-num">{t('commission.owed')}</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((order) => (
                    <tr key={order.orderId}>
                      <td>
                        <div>
                          {order.invoiceNumber != null
                            ? t('settlement.invoiceNumber', { number: order.invoiceNumber })
                            : '—'}
                        </div>
                        <div className="adm-table-sub">
                          {t('orders.orderNumber', { number: order.orderNumber })}
                        </div>
                      </td>
                      <td className="adm-num">
                        {order.deliveredAt
                          ? new Date(order.deliveredAt).toLocaleDateString()
                          : '—'}
                      </td>
                      <td className="adm-num">{formatSyp(order.salesSyp)}</td>
                      <td className="adm-num">
                        {order.creditedSyp > 0 ? `- ${formatSyp(order.creditedSyp)}` : '—'}
                      </td>
                      <td className="adm-num">{formatSyp(order.netCommissionSyp)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="adm-card-head" style={{ marginTop: 24 }}>
            <span>{t('commission.history')}</span>
          </div>
          <CollectionHistory collections={collections} onReverse={setReversing} />
          {collections.length > 0 && (
            <LoadMoreControl
              hasMore={hasMore}
              isLoadingMore={isLoadingMore}
              onLoadMore={loadMore}
              pageSize={COLLECTIONS_PAGE_SIZE}
            />
          )}
        </div>

        <div>
          <RecordCollectionForm
            warehouseId={warehouseId}
            period={period}
            outstandingSyp={summary.outstandingSyp}
            onSaved={reload}
          />
        </div>
      </div>

      {reversing && (
        <ReverseCollectionModal
          collection={reversing}
          onClose={() => setReversing(null)}
          onConfirm={async (reason) => {
            await api.reverseCommissionCollection(reversing.id, { reason });
            setReversing(null);
            await reload();
          }}
        />
      )}
    </div>
  );
}

export function AdminCommissionPage() {
  const { t } = useTranslation();
  const [from, setFrom] = useState(toDateInputValue(startOfThisMonth()));
  const [to, setTo] = useState(toDateInputValue(new Date()));
  const [overview, setOverview] = useState(null);
  const [selectedWarehouseId, setSelectedWarehouseId] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await api.adminCommissionOverview({ from, to });
      setOverview(response.overview);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, [from, to]);

  useEffect(() => {
    load();
  }, [load]);

  const rangeFilters = (
    <div className="adm-filters-row">
      <label className="adm-account-type-label">
        {t('settlement.from')}
        <input
          className="adm-filter-select"
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
      </label>
      <label className="adm-account-type-label">
        {t('settlement.to')}
        <input
          className="adm-filter-select"
          type="date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
        />
      </label>
    </div>
  );

  if (selectedWarehouseId) {
    return (
      <div>
        {rangeFilters}
        <WarehouseCommissionDetail
          warehouseId={selectedWarehouseId}
          from={from}
          to={to}
          onBack={() => setSelectedWarehouseId(null)}
          onChanged={load}
        />
      </div>
    );
  }

  const totals = overview?.totals;

  return (
    <div>
      <div className="adm-page-head">
        <h1>{t('nav.commission')}</h1>
      </div>

      {rangeFilters}

      {error && <p className="error-text">{error}</p>}

      {isLoading ? (
        <p className="hint">{t('common.loading')}</p>
      ) : !overview ? null : (
        <>
          <div className="adm-stats-grid">
            <StatCard
              label={t('commission.sales')}
              value={formatSyp(totals.salesSyp)}
              hint={t('commission.salesHint')}
              tone="adm-stat-navy"
            />
            <StatCard
              label={t('commission.returns')}
              value={formatSyp(totals.returnsSyp)}
              hint={t('commission.returnsHint')}
            />
            <StatCard
              label={t('commission.owed')}
              value={formatSyp(totals.commissionOwedSyp)}
              hint={t('commission.owedHint')}
              tone="adm-stat-info"
            />
            <StatCard
              label={t('commission.outstanding')}
              value={formatSyp(totals.outstandingSyp)}
              hint={t('commission.collectedSoFar', {
                amount: formatSyp(totals.alreadyCollectedSyp),
              })}
              tone={totals.outstandingSyp > 0 ? 'adm-stat-pending' : 'adm-stat-success'}
            />
          </div>

          <div className="adm-card table-scroll">
            <table className="adm-table">
              <thead>
                <tr>
                  <th>{t('commission.warehouse')}</th>
                  <th className="adm-num">{t('commission.sales')}</th>
                  <th className="adm-num">{t('commission.returns')}</th>
                  <th className="adm-num">{t('commission.owed')}</th>
                  <th className="adm-num">{t('commission.collected')}</th>
                  <th className="adm-num">{t('commission.outstanding')}</th>
                </tr>
              </thead>
              <tbody>
                {/* Server-sorted by outstanding, descending - the order an
                    admin actually works through. Deliberately the only order:
                    no client-side re-sorting, so what is read here is what the
                    server computed. */}
                {overview.warehouses.map((row) => (
                  <tr
                    key={row.warehouseId}
                    className="clickable-row"
                    onClick={() => setSelectedWarehouseId(row.warehouseId)}
                  >
                    <td>
                      <div>{withArFallback(row.nameEn, row.nameAr)}</div>
                      {row.phone && (
                        <div className="adm-table-sub adm-num" dir="ltr">
                          {row.phone}
                        </div>
                      )}
                    </td>
                    <td className="adm-num">{formatSyp(row.salesSyp)}</td>
                    <td className="adm-num">
                      {row.returnsSyp > 0 ? `- ${formatSyp(row.returnsSyp)}` : '—'}
                    </td>
                    <td className="adm-num">{formatSyp(row.commissionOwedSyp)}</td>
                    <td className="adm-num">
                      {row.alreadyCollectedSyp > 0 ? formatSyp(row.alreadyCollectedSyp) : '—'}
                    </td>
                    <td className="adm-num">
                      <OutstandingAmount amountSyp={row.outstandingSyp} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="adm-table-hint">{t('commission.clickRowHint')}</p>
        </>
      )}
    </div>
  );
}
