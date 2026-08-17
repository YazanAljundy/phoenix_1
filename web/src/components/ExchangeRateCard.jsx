import { useState } from 'react';
import { api } from '../api/client';

// Section: USD display - a small standalone card (not its own page, per
// spec) showing the platform-wide USD -> new-SYP rate the Flutter app
// converts every price with. Lives on the admin's landing tab since it's
// global config, not tied to any one warehouse/product.
export function ExchangeRateCard({ rate, onChanged }) {
  const [input, setInput] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState(null);

  const handleSetManual = async (event) => {
    event.preventDefault();
    setError(null);
    const usdToSyp = Number(input);
    if (!Number.isFinite(usdToSyp) || usdToSyp <= 0) {
      setError('Enter a positive number.');
      return;
    }
    setIsSaving(true);
    try {
      await api.setExchangeRate(usdToSyp);
      setInput('');
      onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = async () => {
    setError(null);
    setIsSaving(true);
    try {
      await api.resetExchangeRate();
      onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="exchange-rate-card">
      <div className="exchange-rate-header">
        <h2>Exchange rate</h2>
        {rate.source && (
          <span
            className={`availability-badge ${rate.manualOverride ? 'availability-paused' : 'availability-available'}`}
          >
            {rate.manualOverride ? 'Manual' : 'API'}
          </span>
        )}
      </div>

      {rate.usdToSyp == null ? (
        <p className="hint">No rate set yet - enter one below.</p>
      ) : (
        <>
          <p className="exchange-rate-value">
            1 USD = {rate.usdToSyp.toLocaleString()} SYP
          </p>
          <p className="hint">Last updated: {new Date(rate.lastUpdated).toLocaleString()}</p>
        </>
      )}

      {rate.manualOverride && (
        <p className="exchange-rate-warning">
          ⚠️ السعر يدوي — آخر تحديث {new Date(rate.lastUpdated).toLocaleString()}
        </p>
      )}

      <p className="exchange-rate-disclaimer">
        سعر الـ API مصدره المصرف المركزي السوري (رسمي) وقد يختلف عن سعر السوق الفعلي. استخدم
        التحديث اليدوي لو أردت عرض سعر السوق الموازية.
      </p>

      <form onSubmit={handleSetManual} className="exchange-rate-form">
        <input
          type="number"
          min="0"
          step="0.01"
          placeholder="e.g. 130.5"
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
        <button type="submit" className="btn-primary" disabled={isSaving}>
          تحديث يدوي
        </button>
        <button
          type="button"
          className="btn-secondary"
          disabled={isSaving || !rate.manualOverride}
          onClick={handleReset}
        >
          رجوع للـ API التلقائي
        </button>
      </form>

      {error && <p className="error-text">{error}</p>}
    </div>
  );
}
