import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { LoadMoreControl } from '../components/LoadMoreControl';
import { usePaginatedData } from '../hooks/usePaginatedData';

const CURRENCIES = ['USD', 'SYP'];
const PAGE_SIZE = 20;

function formatUsd(amount) {
  return `$${Number(amount).toFixed(2)}`;
}

// Section 16: a negative balanceUsd means the pharmacy has paid ahead of
// what it owes - shown as a credit, styled differently, never as a debt.
function BalanceAmount({ balanceUsd }) {
  const { t } = useTranslation();
  const isCredit = balanceUsd < 0;
  return (
    <span className={`balance-amount ${isCredit ? 'is-credit' : 'is-debt'}`}>
      {isCredit ? t('debts.creditAmount', { amount: formatUsd(Math.abs(balanceUsd)) }) : formatUsd(balanceUsd)}
    </span>
  );
}

function AddPaymentForm({ pharmacyId, onSaved }) {
  const { t } = useTranslation();
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [note, setNote] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState(null);

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
        <button type="submit" className="btn-primary" style={{ width: '100%' }} disabled={isSaving}>
          {isSaving ? t('common.saving') : t('debts.recordPaymentButton')}
        </button>
      </form>
      {error && <p className="error-text">{error}</p>}
    </div>
  );
}

// `now` is passed down from the detail view (ticking every 15s) rather than
// read once at fetch time - canEditUntil is a fixed instant, so whether it's
// still in the future has to be re-evaluated live for the edit/delete
// buttons to actually disappear on their own after 5 minutes, not just on
// the next reload.
function PaymentRow({ payment, now, onChanged }) {
  const { t } = useTranslation();
  const canEdit = new Date(payment.canEditUntil) > now;
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

  if (isEditing) {
    return (
      <tr>
        <td colSpan={5}>
          <div className="form-row">
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              style={{ width: 100 }}
            />
            <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('debts.noteOptional')} />
            <button className="btn-secondary" disabled={isBusy} onClick={handleSave}>
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
      <td>{new Date(payment.createdAt).toLocaleString()}</td>
      <td>{payment.amount}</td>
      <td>{payment.currency}</td>
      <td>{payment.note ?? '-'}</td>
      <td>
        {canEdit ? (
          <div className="table-row-actions">
            <button className="btn-secondary" onClick={() => setIsEditing(true)}>
              {t('common.edit')}
            </button>
            <button className="btn-reject" disabled={isBusy} onClick={handleDelete}>
              {t('common.delete')}
            </button>
          </div>
        ) : (
          <span className="hint">{t('debts.locked')}</span>
        )}
      </td>
    </tr>
  );
}

function WarehouseDebtDetail({ pharmacyId, onBack }) {
  const { t } = useTranslation();
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState(null);
  const [now, setNow] = useState(new Date());

  // Ticks the edit-window check independently of any data reload, so an
  // edit/delete button actually vanishes ~on time instead of only after the
  // next fetch.
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 15000);
    return () => clearInterval(id);
  }, []);

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

  if (error) {
    return (
      <div>
        <button className="wh-detail-back" onClick={onBack}>
          &larr; {t('debts.backToDebts')}
        </button>
        <p className="error-text">{error}</p>
      </div>
    );
  }

  if (!detail) {
    return <p className="hint">{t('common.loading')}</p>;
  }

  const cardHeadStyle = { padding: '13px 16px', margin: 0, borderBottom: '2px solid var(--wh-border)' };

  return (
    <div>
      <button className="wh-detail-back" onClick={onBack}>
        &larr; {t('debts.backToDebts')}
      </button>

      <div className="wh-detail-card wh-pharmacy-card" style={{ marginBottom: 18 }}>
        <div>
          <div className="wh-pharmacy-name" style={{ fontSize: 20 }}>
            {detail.pharmacy?.nameEn}
          </div>
          <div className="wh-pharmacy-meta">{detail.pharmacy?.phone}</div>
        </div>
        <div className="wh-debt-stats">
          <div>
            <div className="wh-pharmacy-label">{t('debts.totalOrders')}</div>
            <div className="wh-debt-stat-value wh-num">{formatUsd(detail.totalOrdersUsd)}</div>
          </div>
          <div>
            <div className="wh-pharmacy-label">{t('debts.totalPaid')}</div>
            <div className="wh-debt-stat-value wh-debt-stat-paid wh-num">{formatUsd(detail.totalPaidUsd)}</div>
          </div>
          <div>
            <div className="wh-pharmacy-label">{t('debts.balance')}</div>
            <BalanceAmount balanceUsd={detail.balanceUsd} />
          </div>
        </div>
      </div>

      <div className="wh-debt-grid">
        <div className="wh-detail-card" style={{ padding: 0, overflow: 'hidden' }}>
          <h2 className="wh-detail-card-title" style={cardHeadStyle}>
            {t('debts.deliveredOrders')}
          </h2>
          {detail.orders.length === 0 ? (
            <p className="hint" style={{ padding: '0 16px 16px' }}>
              {t('debts.noDeliveredOrders')}
            </p>
          ) : (
            <div className="table-scroll">
              <table className="wh-table wh-table-narrow">
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
                      <td className="wh-table-order-num">{order.orderNumber}</td>
                      <td className="wh-num">{new Date(order.createdAt).toLocaleDateString()}</td>
                      <td className="wh-num wh-table-total">{order.finalPrice}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="wh-detail-card" style={{ padding: 0, overflow: 'hidden' }}>
          <h2 className="wh-detail-card-title" style={cardHeadStyle}>
            {t('debts.payments')}
          </h2>
          {detail.payments.length === 0 ? (
            <p className="hint" style={{ padding: '0 16px 16px' }}>
              {t('debts.noPayments')}
            </p>
          ) : (
            <div className="table-scroll">
              <table className="wh-table wh-table-compact">
                <thead>
                  <tr>
                    <th>{t('debts.date')}</th>
                    <th>{t('debts.amount')}</th>
                    <th>{t('debts.currency')}</th>
                    <th>{t('debts.noteColumn')}</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {detail.payments.map((payment) => (
                    <PaymentRow key={payment.id} payment={payment} now={now} onChanged={load} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="wh-table-hint" style={{ margin: 0, padding: '0 16px 14px' }}>
            {t('debts.editWindowNotice')}
          </p>
        </div>

        <AddPaymentForm pharmacyId={pharmacyId} onSaved={load} />
      </div>
    </div>
  );
}

// Section 16: the warehouse's debts tab - a list of every pharmacy currently
// in debt, and a per-pharmacy detail (orders + payments) reached by
// clicking a row, matching this panel's existing flat-tab/no-nested-routes
// convention (see WarehouseOrdersPage).
export function WarehouseDebtsPage() {
  const { t } = useTranslation();
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
          <div className="wh-empty-state-icon">$</div>
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
                    <td className="wh-num">{formatUsd(row.totalOrdersUsd)}</td>
                    <td className="wh-num">{formatUsd(row.totalPaidUsd)}</td>
                    <td className="wh-num">
                      <BalanceAmount balanceUsd={row.balanceUsd} />
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
