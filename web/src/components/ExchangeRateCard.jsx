import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';

// Section: USD display - the platform-wide USD -> new-SYP rate the Flutter
// app converts every price with. Now rendered on its own page
// (AdminExchangeRatePage, mockup frame 1h) rather than embedded on Pending
// Accounts - this component still owns 100% of the get/set/reset behavior
// itself, only the surrounding page changed.
export function ExchangeRateCard({ rate, onChanged }) {
  const { t } = useTranslation();
  const [input, setInput] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState(null);

  const handleSetManual = async (event) => {
    event.preventDefault();
    setError(null);
    const usdToSyp = Number(input);
    if (!Number.isFinite(usdToSyp) || usdToSyp <= 0) {
      setError(t('admin.exchangeRate.enterPositive'));
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

  // Pure display arithmetic over the already-entered input and already-
  // fetched current rate - no new request, just a live "here's what that
  // change would look like" hint while typing.
  const inputValue = Number(input);
  const changePercent =
    input && Number.isFinite(inputValue) && inputValue > 0 && rate.usdToSyp
      ? (((inputValue - rate.usdToSyp) / rate.usdToSyp) * 100).toFixed(1)
      : null;

  return (
    <div className="adm-rate-card">
      <div className="adm-rate-section adm-rate-hero">
        <div className="adm-rate-label">{t('admin.exchangeRate.title')}</div>

        {rate.usdToSyp == null ? (
          <p className="hint">{t('admin.exchangeRate.noRate')}</p>
        ) : (
          <div className="adm-rate-value adm-num">
            {t('admin.exchangeRate.rateValue', { rate: rate.usdToSyp.toLocaleString() })}
          </div>
        )}

        <div className="adm-rate-meta">
          {rate.source && (
            <span
              className={`availability-badge ${rate.manualOverride ? 'availability-paused' : 'availability-available'}`}
            >
              {rate.manualOverride ? t('admin.exchangeRate.manual') : t('admin.exchangeRate.api')}
            </span>
          )}
          {rate.lastUpdated && (
            <span className="adm-rate-updated adm-num">
              {t('admin.exchangeRate.lastUpdated', { date: new Date(rate.lastUpdated).toLocaleString() })}
            </span>
          )}
        </div>

        {rate.manualOverride && (
          <div className="adm-rate-warning">
            {t('admin.exchangeRate.manualWarning', { date: new Date(rate.lastUpdated).toLocaleString() })}
          </div>
        )}
      </div>

      <div className="adm-rate-section">
        <div className="adm-rate-section-title">{t('admin.exchangeRate.manualUpdate')}</div>
        <form onSubmit={handleSetManual} className="adm-rate-form">
          <label className="adm-rate-input-label">
            {t('admin.exchangeRate.newRateLabel')}
            <input
              type="number"
              min="0"
              step="0.01"
              placeholder="e.g. 130.5"
              value={input}
              onChange={(e) => setInput(e.target.value)}
            />
          </label>
          <button type="submit" className="btn-primary" disabled={isSaving}>
            {t('admin.exchangeRate.manualUpdate')}
          </button>
        </form>
        {changePercent != null && (
          <p className="adm-rate-change-hint">
            {t('admin.exchangeRate.changeHint', { percent: `${inputValue > rate.usdToSyp ? '+' : ''}${changePercent}` })}
          </p>
        )}
      </div>

      <div className="adm-rate-footer">
        <p className="adm-rate-disclaimer">{t('admin.exchangeRate.disclaimer')}</p>
        <button
          type="button"
          className="btn-secondary"
          disabled={isSaving || !rate.manualOverride}
          onClick={handleReset}
        >
          {t('admin.exchangeRate.resetToApi')}
        </button>
      </div>

      {error && <p className="error-text">{error}</p>}
    </div>
  );
}
