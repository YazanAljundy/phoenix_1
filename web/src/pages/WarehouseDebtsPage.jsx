import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';

const CURRENCIES = ['USD', 'SYP'];

function formatUsd(amount) {
  return `$${Number(amount).toFixed(2)}`;
}

// Section 16: a negative balanceUsd means the pharmacy has paid ahead of
// what it owes - shown as a credit, styled differently, never as a debt.
function BalanceAmount({ balanceUsd }) {
  const isCredit = balanceUsd < 0;
  return (
    <span className={`balance-amount ${isCredit ? 'is-credit' : 'is-debt'}`}>
      {isCredit ? `Credit: ${formatUsd(Math.abs(balanceUsd))}` : formatUsd(balanceUsd)}
    </span>
  );
}

function AddPaymentForm({ pharmacyId, onSaved }) {
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
      setError('Amount must be a positive number.');
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
    <div className="exchange-rate-card">
      <h2>Record a payment</h2>
      <form onSubmit={handleSubmit} className="form-row">
        <label>
          Amount
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
          Currency
          <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label>
          Note (optional)
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Cash, Aug 18" />
        </label>
        <button type="submit" className="btn-primary" disabled={isSaving}>
          {isSaving ? 'Saving...' : 'Record payment'}
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
      setError('Amount must be a positive number.');
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
    const confirmed = window.confirm('Remove this payment?');
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
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note" />
            <button className="btn-secondary" disabled={isBusy} onClick={handleSave}>
              Save
            </button>
            <button className="btn-secondary" onClick={() => setIsEditing(false)}>
              Cancel
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
              Edit
            </button>
            <button className="btn-reject" disabled={isBusy} onClick={handleDelete}>
              Delete
            </button>
          </div>
        ) : (
          <span className="hint">Locked</span>
        )}
      </td>
    </tr>
  );
}

function WarehouseDebtDetail({ pharmacyId, onBack }) {
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
        <button className="btn-secondary" onClick={onBack}>
          &larr; Back to debts
        </button>
        <p className="error-text">{error}</p>
      </div>
    );
  }

  if (!detail) {
    return <p className="hint">Loading...</p>;
  }

  return (
    <div>
      <button className="btn-secondary" onClick={onBack}>
        &larr; Back to debts
      </button>

      <div className="exchange-rate-card">
        <h2>{detail.pharmacy?.nameEn}</h2>
        <p className="hint">{detail.pharmacy?.phone}</p>
        <p>
          Total orders: {formatUsd(detail.totalOrdersUsd)} &middot; Total paid:{' '}
          {formatUsd(detail.totalPaidUsd)} &middot; Balance: <BalanceAmount balanceUsd={detail.balanceUsd} />
        </p>
      </div>

      <AddPaymentForm pharmacyId={pharmacyId} onSaved={load} />

      <h2>Delivered orders</h2>
      {detail.orders.length === 0 ? (
        <p className="hint">No delivered orders yet.</p>
      ) : (
        <div className="table-scroll">
          <table className="product-table">
            <thead>
              <tr>
                <th>Order #</th>
                <th>Date</th>
                <th>Amount (SYP)</th>
              </tr>
            </thead>
            <tbody>
              {detail.orders.map((order) => (
                <tr key={order.id}>
                  <td>{order.orderNumber}</td>
                  <td>{new Date(order.createdAt).toLocaleDateString()}</td>
                  <td>{order.finalPrice}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2>Payments</h2>
      {detail.payments.length === 0 ? (
        <p className="hint">No payments recorded yet.</p>
      ) : (
        <div className="table-scroll">
          <table className="product-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Amount</th>
                <th>Currency</th>
                <th>Note</th>
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
    </div>
  );
}

// Section 16: the warehouse's debts tab - a list of every pharmacy currently
// in debt, and a per-pharmacy detail (orders + payments) reached by
// clicking a row, matching this panel's existing flat-tab/no-nested-routes
// convention (see WarehouseOrdersPage).
export function WarehouseDebtsPage() {
  const [pharmacies, setPharmacies] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedPharmacyId, setSelectedPharmacyId] = useState(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await api.warehouseBalances();
      setPharmacies(data.pharmacies);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (selectedPharmacyId) {
    return (
      <WarehouseDebtDetail
        pharmacyId={selectedPharmacyId}
        onBack={() => {
          setSelectedPharmacyId(null);
          load();
        }}
      />
    );
  }

  return (
    <div>
      {error && <p className="error-text">{error}</p>}

      {isLoading ? (
        <p className="hint">Loading...</p>
      ) : pharmacies.length === 0 ? (
        <p className="hint">No pharmacies currently owe you anything.</p>
      ) : (
        <div className="table-scroll">
          <table className="product-table">
            <thead>
              <tr>
                <th>Pharmacy</th>
                <th>Phone</th>
                <th>Total orders</th>
                <th>Total paid</th>
                <th>Balance</th>
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
                  <td>{row.phone}</td>
                  <td>{formatUsd(row.totalOrdersUsd)}</td>
                  <td>{formatUsd(row.totalPaidUsd)}</td>
                  <td>
                    <BalanceAmount balanceUsd={row.balanceUsd} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
