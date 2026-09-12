import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { LoadMoreControl } from '../components/LoadMoreControl';
import { usePaginatedData } from '../hooks/usePaginatedData';
import { useExchangeRate } from '../context/ExchangeRateContext';
import { formatSyp, formatUsd, remainingPaymentAmountFromSyp } from '../utils/currency';
import { PAYMENT_METHODS, PAYMENT_CURRENCIES as CURRENCIES, newIdempotencyKey } from '../utils/payments';
import { WarehouseGroupSubNav } from '../components/WarehouseGroupSubNav';

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 300;

// A pharmacy's balance as a single figure: > 0 owes, < 0 has paid ahead and
// is shown as a credit rather than as a negative debt, = 0 is settled.
//
// Money-Flow V2: SYP-native. V1's version took a USD balance and a live
// exchange rate and converted on every render, so the same account read
// differently before and after a rate move. There is no rate here at all -
// the server sends the settlement figure and this renders it.
function BalanceAmount({ balanceSyp }) {
  const { t } = useTranslation();
  const state = balanceSyp < 0 ? 'is-credit' : balanceSyp > 0 ? 'is-debt' : 'is-settled';
  const text = formatSyp(Math.abs(balanceSyp));
  return (
    <span className={`balance-amount ${state}`}>
      {balanceSyp < 0 ? t('debts.creditAmount', { amount: text }) : text}
    </span>
  );
}

// Money-Flow V2. Records money received. The form now also captures HOW it
// arrived and any external reference, both purely for reconciliation, and it
// generates an idempotency key per submission so a retry after a dropped
// response cannot credit the pharmacy twice.
function AddPaymentForm({ pharmacyId, remainingSyp, onSaved }) {
  const { t } = useTranslation();
  const usdToSyp = useExchangeRate();
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('SYP');
  const [method, setMethod] = useState('cash');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState(null);

  // "Full amount": prefills the outstanding balance into the editable amount
  // field - the warehouse can still adjust it. The balance is SYP-native, so
  // this only needs a rate when the warehouse is recording a USD payment.
  // Disabled when nothing is owed.
  const fullAmount = remainingPaymentAmountFromSyp(remainingSyp, currency, usdToSyp);

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
      await api.createPayment({
        pharmacyId,
        amount: value,
        currency,
        method,
        reference: reference.trim() || undefined,
        note: note.trim() || undefined,
        // One key per submission attempt. If the response never arrives and
        // the operator hits the button again, the server recognises the key
        // and returns the payment it already recorded.
        idempotencyKey: newIdempotencyKey(),
      });
      setAmount('');
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

// Money-Flow V2. A payment is append-only: there is no edit and no delete.
// A mistake is corrected by REVERSING it, which requires a reason and leaves
// both the original and the reversal on the record - so the account shows what
// was believed and when, not a tidied-up version of it.
//
// Uses the panel's existing .modal-overlay / .modal / .product-form markup, and
// is rendered by WarehouseDebtDetail rather than from inside a table row.
function ReversePaymentModal({ payment, onClose, onConfirm }) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState(null);

  const amountText =
    payment.currency === 'USD' ? formatUsd(payment.amount) : formatSyp(payment.amount);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!reason.trim()) {
      setError(t('debts.reverseReasonRequired'));
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
        <h2>{t('debts.reversePaymentTitle')}</h2>
        <p className="hint">{t('debts.reversePaymentExplain', { amount: amountText })}</p>
        <form onSubmit={handleSubmit} className="product-form">
          <label>
            {t('debts.reverseReason')}
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t('debts.reverseReasonPlaceholder')}
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
              {isBusy ? t('common.saving') : t('debts.reversePaymentButton')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// One row of the payments table. A reversal is rendered as a negative so the
// column reads as a running correction rather than two identical credits, and
// a reversed settlement is struck through with the reason that undid it.
function PaymentRow({ payment, onReverse }) {
  const { t } = useTranslation();

  const paidAt = new Date(payment.paidAt || payment.createdAt);
  const isReversal = payment.kind === 'reversal';
  const isReversed = payment.status === 'reversed';
  const amountText =
    payment.currency === 'USD' ? formatUsd(payment.amount) : formatSyp(payment.amount);

  return (
    <tr>
      <td>
        <div>{paidAt.toLocaleDateString()}</div>
        <div className="wh-table-sub">
          {paidAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </div>
      </td>
      <td className="wh-num wh-table-total">
        <span style={isReversed ? { textDecoration: 'line-through', opacity: 0.55 } : undefined}>
          {isReversal ? `- ${amountText}` : amountText}
        </span>
        {payment.paymentNumber != null && (
          <div className="wh-table-sub">
            {t('debts.paymentNumber', { number: payment.paymentNumber })}
          </div>
        )}
      </td>
      <td>
        {isReversal && <div className="wh-table-sub">{t('debts.reversalRow')}</div>}
        {isReversed && payment.reversalReason && (
          <div className="wh-table-sub">
            {t('debts.reversedBecause', { reason: payment.reversalReason })}
          </div>
        )}
        {payment.method && <div className="wh-table-sub">{t(`debts.method_${payment.method}`)}</div>}
        {payment.reference && <div className="wh-table-sub wh-num">{payment.reference}</div>}
        {payment.note && <div>{payment.note}</div>}
        {!payment.note && !payment.reference && !isReversal && !isReversed && (
          <span className="wh-table-sub">—</span>
        )}
      </td>
      <td>
        <div className="table-row-actions">
          {/* Only a posted settlement can be reversed: a reversal is final, and
              an already-reversed payment has nothing left to undo. */}
          {!isReversal && !isReversed && (
            <button className="btn-reject" onClick={() => onReverse(payment)}>
              {t('debts.reverse')}
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

// Money-Flow V2. The per-pharmacy account: a chronological statement over the
// ledger, plus the payments the panel can act on.
//
// V1 showed two disconnected lists - every delivered order, every payment -
// under three summary cards computed on a DIFFERENT basis from the rows
// beneath them (the cards live-converted a USD cache; the rows were frozen
// SYP), so after any exchange-rate move the two visibly disagreed. Here every
// row and every total is the same frozen SYP figure off the same entries.
const STATEMENT_KIND_KEYS = {
  charge: 'statement.kindCharge',
  charge_reversal: 'statement.kindChargeReversal',
  payment: 'statement.kindPayment',
  payment_reversal: 'statement.kindPaymentReversal',
  return_credit: 'statement.kindReturnCredit',
  return_credit_reversal: 'statement.kindReturnCreditReversal',
  manual_credit: 'statement.kindManualCredit',
  manual_debit: 'statement.kindManualDebit',
  migration_adjustment: 'statement.kindMigrationAdjustment',
  opening_balance: 'statement.kindOpeningBalance',
};

// What a human would quote when asking about a row.
function StatementReference({ row }) {
  const { t } = useTranslation();
  const ref = row.reference ?? {};

  if (ref.invoiceNumber != null) {
    return (
      <>
        <div className="wh-table-order-num">
          {t('settlement.invoiceNumber', { number: ref.invoiceNumber })}
        </div>
        {ref.orderNumber != null && (
          <div className="wh-table-sub">{t('orders.orderNumber', { number: ref.orderNumber })}</div>
        )}
      </>
    );
  }
  if (ref.paymentNumber != null) {
    return (
      <>
        <div className="wh-table-order-num">
          {t('debts.paymentNumber', { number: ref.paymentNumber })}
        </div>
        {ref.method && <div className="wh-table-sub">{t(`debts.method_${ref.method}`)}</div>}
      </>
    );
  }
  return <span className="wh-table-sub">&mdash;</span>;
}

function StatementTable({ statement }) {
  const { t } = useTranslation();

  return (
    <div className="wh-card table-scroll">
      <table className="wh-table wh-table-compact">
        <thead>
          <tr>
            <th>{t('statement.date')}</th>
            <th>{t('statement.type')}</th>
            <th>{t('statement.reference')}</th>
            <th className="wh-num">{t('statement.debit')}</th>
            <th className="wh-num">{t('statement.credit')}</th>
            <th className="wh-num">{t('statement.balance')}</th>
          </tr>
        </thead>
        <tbody>
          {/* The opening balance is a row of its own so the running total in
              the last column starts from something the reader can see. */}
          <tr className="wh-statement-opening">
            <td className="wh-num">{new Date(statement.period.from).toLocaleDateString()}</td>
            <td>{t('statement.opening')}</td>
            <td />
            <td className="wh-num" />
            <td className="wh-num" />
            <td className="wh-num">{formatSyp(statement.opening.syp)}</td>
          </tr>
          {statement.rows.map((row) => (
            <tr key={row.id}>
              <td className="wh-num">{new Date(row.effectiveAt).toLocaleDateString()}</td>
              <td>
                <div>{t(STATEMENT_KIND_KEYS[row.kind] ?? 'statement.kindOther')}</div>
                {/* Mandatory on adjustments and reversals - it is the whole
                    reason those rows are legible rather than mysterious. */}
                {row.reason && <div className="wh-table-sub">{row.reason}</div>}
              </td>
              <td>
                <StatementReference row={row} />
              </td>
              <td className="wh-num">{row.debitSyp ? formatSyp(row.debitSyp) : '—'}</td>
              <td className="wh-num">{row.creditSyp ? formatSyp(row.creditSyp) : '—'}</td>
              <td className="wh-num wh-table-total">{formatSyp(row.balanceSyp)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function WarehouseDebtDetail({ pharmacyId, onBack }) {
  const { t, i18n } = useTranslation();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  // The payment the operator is about to reverse, if any. Held here rather
  // than per row so the modal is a sibling of the table, not a cell inside it.
  const [reversing, setReversing] = useState(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await api.warehouseBalanceDetail(pharmacyId));
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

  if (!data) {
    return (
      <div>
        {backButton}
        <p className="hint">{t('common.loading')}</p>
      </div>
    );
  }

  const { statement, payments } = data;
  const balanceSyp = statement.closing.syp;
  // > 0 owes (red), < 0 credit (green), = 0 settled (neutral).
  const balanceState = balanceSyp < 0 ? 'is-credit' : balanceSyp > 0 ? 'is-debt' : 'is-settled';
  const balanceText =
    balanceSyp < 0
      ? t('debts.creditAmount', { amount: formatSyp(statement.creditBalanceSyp) })
      : formatSyp(statement.outstandingDebtSyp);

  const cardHeadStyle = {
    padding: '13px 16px',
    margin: 0,
    borderBottom: '2px solid var(--wh-border)',
  };

  return (
    <div>
      {backButton}

      <div className="wh-detail-card wh-invoice-header">
        <div className="wh-invoice-identity">
          <div className="wh-invoice-name">{statement.pharmacy?.nameEn}</div>
          {statement.pharmacy?.phone && (
            <div className="wh-invoice-phone wh-num">{statement.pharmacy.phone}</div>
          )}
        </div>
        <div className={`wh-invoice-balance ${balanceState}`}>
          <div className="wh-invoice-balance-label">{t('debts.currentBalance')}</div>
          <div className="wh-invoice-balance-value wh-num">{balanceText}</div>
        </div>
      </div>

      {/* The period's movement. These are sums of the very rows below, so the
          two can never tell different stories. */}
      <div className="wh-invoice-summary">
        <div className="wh-invoice-stat">
          <div className="wh-invoice-stat-label">{t('statement.charges')}</div>
          <div className="wh-invoice-stat-value wh-num">
            {formatSyp(statement.summary.chargesSyp)}
          </div>
        </div>
        <div className="wh-invoice-stat">
          <div className="wh-invoice-stat-label">{t('statement.payments')}</div>
          <div className="wh-invoice-stat-value wh-num is-paid">
            {formatSyp(statement.summary.paymentsSyp)}
          </div>
        </div>
        <div className="wh-invoice-stat">
          <div className="wh-invoice-stat-label">{t('statement.returnCredits')}</div>
          <div className="wh-invoice-stat-value wh-num is-paid">
            {formatSyp(statement.summary.returnCreditsSyp)}
          </div>
        </div>
        <div className="wh-invoice-stat">
          <div className="wh-invoice-stat-label">{t('debts.balance')}</div>
          <div className="wh-invoice-stat-value wh-num">
            <span className={`balance-amount ${balanceState}`}>{balanceText}</span>
          </div>
        </div>
      </div>

      <div className="wh-detail-grid">
        <div className="wh-invoice-main">
          <div className="wh-detail-card" style={{ padding: 0, overflow: 'hidden' }}>
            <h2 className="wh-detail-card-title wh-invoice-section-head" style={cardHeadStyle}>
              <span>{t('statement.title')}</span>
              {statement.rows.length > 0 && (
                <span className="wh-invoice-count">{statement.rows.length}</span>
              )}
            </h2>
            {statement.rows.length === 0 ? (
              <InvoiceEmpty icon="&#128196;">{t('statement.empty')}</InvoiceEmpty>
            ) : (
              <StatementTable statement={statement} />
            )}
          </div>

          <div className="wh-detail-card" style={{ padding: 0, overflow: 'hidden' }}>
            <h2 className="wh-detail-card-title wh-invoice-section-head" style={cardHeadStyle}>
              <span>{t('debts.payments')}</span>
              {payments.length > 0 && <span className="wh-invoice-count">{payments.length}</span>}
            </h2>
            {payments.length === 0 ? (
              <InvoiceEmpty icon="&#128181;">{t('debts.noPayments')}</InvoiceEmpty>
            ) : (
              <div className="table-scroll">
                <table className="wh-table wh-table-compact">
                  <thead>
                    <tr>
                      <th>{t('debts.date')}</th>
                      <th>{t('debts.amount')}</th>
                      <th>{t('debts.noteColumn')}</th>
                      <th aria-label={t('debts.reverse')} />
                    </tr>
                  </thead>
                  <tbody>
                    {payments.map((payment) => (
                      <PaymentRow key={payment.id} payment={payment} onReverse={setReversing} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        <div className="wh-invoice-side">
          <AddPaymentForm
            pharmacyId={pharmacyId}
            remainingSyp={statement.outstandingDebtSyp}
            onSaved={load}
          />
        </div>
      </div>

      {reversing && (
        <ReversePaymentModal
          payment={reversing}
          onClose={() => setReversing(null)}
          onConfirm={async (reason) => {
            await api.reversePayment(reversing.id, {
              reason,
              idempotencyKey: newIdempotencyKey(),
            });
            setReversing(null);
            await load();
          }}
        />
      )}
    </div>
  );
}

// Section 16: the warehouse's "Invoices" tab - a list of every pharmacy that
// has a delivered purchase from this warehouse (debt, settled at 0, or a
// credit - the current balance never decides visibility), and a per-pharmacy
// detail (orders + payments + balance) reached by clicking a row, matching
// this panel's existing flat-tab/no-nested-routes convention (see
// WarehouseOrdersPage). Money-Flow V2: the list is sourced from the ledger
// accounts themselves - an account exists precisely because something
// financial happened on it - and every balance is SYP-native, so no exchange
// rate is involved in rendering it.
export function WarehouseDebtsPage() {
  const { t } = useTranslation();
  const [selectedPharmacyId, setSelectedPharmacyId] = useState(null);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');

  // Debounced the same 300ms as every other search box in the panel, so
  // typing doesn't fire a request per keystroke.
  useEffect(() => {
    const timeout = setTimeout(() => setSearch(searchInput.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timeout);
  }, [searchInput]);

  const fetchPage = useCallback(
    (cursor) =>
      api.warehouseBalances({ limit: PAGE_SIZE, after: cursor, search: search || undefined }).then((data) => ({
        rows: data.pharmacies,
        hasMore: data.pagination.hasMore,
        nextCursor: data.pagination.nextCursor,
      })),
    [search]
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
  }, [search]);

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
      {/* List only - the pharmacy statement above early-returns without it, the
          same way every other detail screen in the panel drops the sub-nav in
          favour of its own Back control. */}
      <WarehouseGroupSubNav />

      <div className="wh-page-head">
        <h1>{t('nav.debts')}</h1>
      </div>

      <div className="wh-filters">
        <input
          type="search"
          className="wh-filter-search"
          placeholder={t('debts.searchPlaceholder')}
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
        />
      </div>

      {error && <p className="error-text">{error}</p>}

      {isLoading ? (
        <p className="hint">{t('common.loading')}</p>
      ) : pharmacies.length === 0 ? (
        <div className="wh-empty-state">
          <div className="wh-empty-state-icon">{t('common.currencySuffix')}</div>
          <div className="wh-empty-state-title">{search ? t('debts.noMatchingDebts') : t('debts.noDebts')}</div>
        </div>
      ) : (
        <>
          <div className="wh-card table-scroll">
            <table className="wh-table">
              <thead>
                <tr>
                  <th>{t('debts.pharmacy')}</th>
                  <th>{t('debts.phone')}</th>
                  <th>{t('debts.lastActivity')}</th>
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
                    <td className="wh-num">
                      {row.lastActivityAt
                        ? new Date(row.lastActivityAt).toLocaleDateString()
                        : '—'}
                    </td>
                    <td className="wh-num">
                      <BalanceAmount balanceSyp={row.balanceSyp} />
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
