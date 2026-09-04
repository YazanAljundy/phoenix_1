import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { LoadMoreControl } from '../components/LoadMoreControl';
import { usePaginatedData } from '../hooks/usePaginatedData';
import { useExchangeRate } from '../context/ExchangeRateContext';
import { formatSyp, formatUsd, formatMoneyFromUsd, remainingPaymentAmount } from '../utils/currency';

// SYP first: it is the default currency for every amount in the panel.
const CURRENCIES = ['SYP', 'USD'];
const PAGE_SIZE = 20;

// Section 16: a negative balanceUsd means the pharmacy has paid ahead of
// what it owes - shown as a credit, styled differently, never as a debt.
// Balances are stored in USD (pharmacyBalance.model.js); shown in SYP at the
// live rate, falling back to USD only while the rate is still loading.
function BalanceAmount({ balanceUsd, usdToSyp }) {
  const { t } = useTranslation();
  const isCredit = balanceUsd < 0;
  const text = formatMoneyFromUsd(Math.abs(balanceUsd), usdToSyp);
  return (
    <span className={`balance-amount ${isCredit ? 'is-credit' : 'is-debt'}`}>
      {isCredit ? t('debts.creditAmount', { amount: text }) : text}
    </span>
  );
}

function AddPaymentForm({ pharmacyId, remainingUsd, onSaved }) {
  const { t } = useTranslation();
  const usdToSyp = useExchangeRate();
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('SYP');
  const [note, setNote] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState(null);

  // "Full amount": prefills the outstanding balance (converted to the picked
  // currency) into the editable amount field - the warehouse can still adjust
  // it. Disabled when nothing is owed, or when SYP is picked and no rate is
  // loaded to convert with.
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
      setAmount('');
      setNote('');
      await onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="wh-detail-card">
      <h2 className="wh-detail-card-title">{t('debts.recordPayment')}</h2>
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
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('debts.notePlaceholder')} />
        </label>
        <div className="form-row">
          <button
            type="button"
            className="btn-secondary"
            disabled={fullAmount == null}
            onClick={() => setAmount(String(fullAmount))}
          >
            {t('debts.fullAmount')}
          </button>
          <button type="submit" className="btn-primary" style={{ flex: 1 }} disabled={isSaving}>
            {isSaving ? t('common.saving') : t('debts.recordPaymentButton')}
          </button>
        </div>
      </form>
      {error && <p className="error-text">{error}</p>}
    </div>
  );
}

// A small centred placeholder for the orders / payments cards when a pharmacy
// has none yet - reuses the panel's muted-text style, just laid out to read as
// a deliberate empty state rather than a stray sentence.
function InvoiceEmpty({ icon, children }) {
  return (
    <div className="wh-invoice-empty">
      <span className="wh-invoice-empty-icon" aria-hidden="true">
        {icon}
      </span>
      <span>{children}</span>
    </div>
  );
}

// A recorded payment can be edited or deleted at any time - it is a manual
// bookkeeping entry and the balance is recomputed from scratch after every
// change (payment.service.js). Ownership is enforced server-side.
function PaymentRow({ payment, onChanged }) {
  const { t } = useTranslation();
  const [isEditing, setIsEditing] = useState(false);
  const [amount, setAmount] = useState(String(payment.amount));
  const [currency, setCurrency] = useState(payment.currency);
  const [note, setNote] = useState(payment.note ?? '');
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState(null);

  const handleSave = async () => {
    setError(null);
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) {
      setError(t('debts.amountPositive'));
      return;
    }
    setIsBusy(true);
    try {
      await api.updatePayment(payment.id, { amount: value, currency, note: note.trim() || undefined });
      setIsEditing(false);
      await onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setIsBusy(false);
    }
  };

  const handleDelete = async () => {
    const confirmed = window.confirm(t('debts.confirmDeletePayment'));
    if (!confirmed) return;
    setIsBusy(true);
    setError(null);
    try {
      await api.deletePayment(payment.id);
      await onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setIsBusy(false);
    }
  };

  const createdAt = new Date(payment.createdAt);

  if (isEditing) {
    return (
      <tr className="wh-invoice-payment-editing">
        <td colSpan={4}>
          <div className="wh-invoice-payment-edit">
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              aria-label={t('debts.amount')}
            />
            <select
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              aria-label={t('debts.currency')}
            >
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t('debts.noteOptional')}
              aria-label={t('debts.noteColumn')}
            />
            <button className="btn-primary" disabled={isBusy} onClick={handleSave}>
              {t('common.save')}
            </button>
            <button className="btn-secondary" onClick={() => setIsEditing(false)}>
              {t('common.cancel')}
            </button>
          </div>
          {error && <p className="error-text">{error}</p>}
        </td>
      </tr>
    );
  }

  return (
    <tr>
      <td>
        <div>{createdAt.toLocaleDateString()}</div>
        <div className="wh-table-sub">
          {createdAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </div>
      </td>
      <td className="wh-num wh-table-total">
        {payment.currency === 'USD' ? formatUsd(payment.amount) : formatSyp(payment.amount)}
      </td>
      <td>{payment.note ? payment.note : <span className="wh-table-sub">—</span>}</td>
      <td>
        <div className="table-row-actions">
          <button className="btn-secondary" onClick={() => setIsEditing(true)}>
            {t('common.edit')}
          </button>
          <button className="btn-reject" disabled={isBusy} onClick={handleDelete}>
            {t('common.delete')}
          </button>
        </div>
      </td>
    </tr>
  );
}

function WarehouseDebtDetail({ pharmacyId, onBack }) {
  const { t, i18n } = useTranslation();
  const usdToSyp = useExchangeRate();
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await api.warehouseBalanceDetail(pharmacyId);
      setDetail(data);
    } catch (err) {
      setError(err.message);
    }
  }, [pharmacyId]);

  useEffect(() => {
    load();
  }, [load]);

  // "Back" points toward where the list is - left in LTR, right in RTL.
  const backButton = (
    <button className="wh-detail-back" onClick={onBack}>
      <span aria-hidden="true">{i18n.language === 'ar' ? '→' : '←'}</span>{' '}
      {t('debts.backToDebts')}
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

  if (!detail) {
    return (
      <div>
        {backButton}
        <p className="hint">{t('common.loading')}</p>
      </div>
    );
  }

  const cardHeadStyle = { padding: '13px 16px', margin: 0, borderBottom: '2px solid var(--wh-border)' };

  // Same convention the list uses (BalanceAmount): > 0 owes (red), < 0 credit
  // (green, shown as "Credit: …"), = 0 settled (neutral). Nothing about the
  // calculation changes - this is presentation only.
  const balanceUsd = detail.balanceUsd;
  const balanceState = balanceUsd < 0 ? 'is-credit' : balanceUsd > 0 ? 'is-debt' : 'is-settled';
  const balanceMoney = formatMoneyFromUsd(Math.abs(balanceUsd), usdToSyp);
  const balanceText = balanceUsd < 0 ? t('debts.creditAmount', { amount: balanceMoney }) : balanceMoney;

  return (
    <div>
      {backButton}

      <div className="wh-detail-card wh-invoice-header">
        <div className="wh-invoice-identity">
          <div className="wh-invoice-name">{detail.pharmacy?.nameEn}</div>
          {detail.pharmacy?.phone && (
            <div className="wh-invoice-phone wh-num">{detail.pharmacy.phone}</div>
          )}
        </div>
        <div className={`wh-invoice-balance ${balanceState}`}>
          <div className="wh-invoice-balance-label">{t('debts.currentBalance')}</div>
          <div className="wh-invoice-balance-value wh-num">{balanceText}</div>
        </div>
      </div>

      <div className="wh-invoice-summary">
        <div className="wh-invoice-stat">
          <div className="wh-invoice-stat-label">{t('debts.totalOrders')}</div>
          <div className="wh-invoice-stat-value wh-num">
            {formatMoneyFromUsd(detail.totalOrdersUsd, usdToSyp)}
          </div>
        </div>
        <div className="wh-invoice-stat">
          <div className="wh-invoice-stat-label">{t('debts.totalPaid')}</div>
          <div className="wh-invoice-stat-value wh-num is-paid">
            {formatMoneyFromUsd(detail.totalPaidUsd, usdToSyp)}
          </div>
        </div>
        <div className="wh-invoice-stat">
          <div className="wh-invoice-stat-label">{t('debts.balance')}</div>
          <div className="wh-invoice-stat-value wh-num">
            <BalanceAmount balanceUsd={detail.balanceUsd} usdToSyp={usdToSyp} />
          </div>
        </div>
      </div>

      <div className="wh-detail-grid">
        <div className="wh-invoice-main">
          <div className="wh-detail-card" style={{ padding: 0, overflow: 'hidden' }}>
            <h2 className="wh-detail-card-title wh-invoice-section-head" style={cardHeadStyle}>
              <span>{t('debts.deliveredOrders')}</span>
              {detail.orders.length > 0 && (
                <span className="wh-invoice-count">{detail.orders.length}</span>
              )}
            </h2>
            {detail.orders.length === 0 ? (
              <InvoiceEmpty icon="📦">{t('debts.noDeliveredOrders')}</InvoiceEmpty>
            ) : (
              <div className="table-scroll">
                <table className="wh-table wh-table-compact">
                  <thead>
                    <tr>
                      <th>{t('debts.orderNumber')}</th>
                      <th>{t('debts.date')}</th>
                      <th>{t('debts.amountSyp')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.orders.map((order) => (
                      <tr key={order.id}>
                        <td className="wh-table-order-num">#{order.orderNumber}</td>
                        <td className="wh-num">{new Date(order.createdAt).toLocaleDateString()}</td>
                        <td className="wh-num wh-table-total">{formatSyp(order.finalPrice)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="wh-detail-card" style={{ padding: 0, overflow: 'hidden' }}>
            <h2 className="wh-detail-card-title wh-invoice-section-head" style={cardHeadStyle}>
              <span>{t('debts.payments')}</span>
              {detail.payments.length > 0 && (
                <span className="wh-invoice-count">{detail.payments.length}</span>
              )}
            </h2>
            {detail.payments.length === 0 ? (
              <InvoiceEmpty icon="💵">{t('debts.noPayments')}</InvoiceEmpty>
            ) : (
              <div className="table-scroll">
                <table className="wh-table wh-table-compact">
                  <thead>
                    <tr>
                      <th>{t('debts.date')}</th>
                      <th>{t('debts.amount')}</th>
                      <th>{t('debts.noteColumn')}</th>
                      <th aria-label={t('common.edit')}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.payments.map((payment) => (
                      <PaymentRow key={payment.id} payment={payment} onChanged={load} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        <div className="wh-invoice-side">
          <AddPaymentForm pharmacyId={pharmacyId} remainingUsd={detail.balanceUsd} onSaved={load} />
        </div>
      </div>
    </div>
  );
}

// Section 16: the warehouse's "Invoices" tab - a list of every pharmacy that
// has a delivered purchase from this warehouse (debt, settled at 0, or a
// credit - the current balance never decides visibility), and a per-pharmacy
// detail (orders + payments + balance) reached by clicking a row, matching
// this panel's existing flat-tab/no-nested-routes convention (see
// WarehouseOrdersPage). The list is driven by the order relationship on the
// backend; the detail view and all its financial logic are unchanged.
export function WarehouseDebtsPage() {
  const { t } = useTranslation();
  const usdToSyp = useExchangeRate();
  const [selectedPharmacyId, setSelectedPharmacyId] = useState(null);

  const fetchPage = useCallback(
    (cursor) =>
      api.warehouseBalances({ limit: PAGE_SIZE, after: cursor }).then((data) => ({
        rows: data.pharmacies,
        hasMore: data.pagination.hasMore,
        nextCursor: data.pagination.nextCursor,
      })),
    []
  );

  const {
    data: pharmacies,
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
  }, []);

  if (selectedPharmacyId) {
    return (
      <WarehouseDebtDetail
        pharmacyId={selectedPharmacyId}
        onBack={() => {
          setSelectedPharmacyId(null);
          reset();
        }}
      />
    );
  }

  return (
    <div>
      <div className="wh-page-head">
        <h1>{t('nav.debts')}</h1>
      </div>

      {error && <p className="error-text">{error}</p>}

      {isLoading ? (
        <p className="hint">{t('common.loading')}</p>
      ) : pharmacies.length === 0 ? (
        <div className="wh-empty-state">
          <div className="wh-empty-state-icon">{t('common.currencySuffix')}</div>
          <div className="wh-empty-state-title">{t('debts.noDebts')}</div>
        </div>
      ) : (
        <>
          <div className="wh-card table-scroll">
            <table className="wh-table">
              <thead>
                <tr>
                  <th>{t('debts.pharmacy')}</th>
                  <th>{t('debts.phone')}</th>
                  <th>{t('debts.totalOrders')}</th>
                  <th>{t('debts.totalPaid')}</th>
                  <th>{t('debts.balance')}</th>
                </tr>
              </thead>
              <tbody>
                {pharmacies.map((row) => (
                  <tr
                    key={row.pharmacyId}
                    className="clickable-row"
                    onClick={() => setSelectedPharmacyId(row.pharmacyId)}
                  >
                    <td>{row.nameEn}</td>
                    <td className="wh-num">{row.phone}</td>
                    <td className="wh-num">{formatMoneyFromUsd(row.totalOrdersUsd, usdToSyp)}</td>
                    <td className="wh-num">{formatMoneyFromUsd(row.totalPaidUsd, usdToSyp)}</td>
                    <td className="wh-num">
                      <BalanceAmount balanceUsd={row.balanceUsd} usdToSyp={usdToSyp} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="wh-table-hint">{t('debts.clickRowHint')}</p>
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
