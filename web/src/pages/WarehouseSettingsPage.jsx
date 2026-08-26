import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';

// Section: the warehouse's own order-size limits. Both are opt-in - an empty
// minimum means "no minimum" (stored as 0) and an empty maximum means "no
// maximum" (stored as null), which is what every warehouse starts with.
export function WarehouseSettingsPage() {
  const { t } = useTranslation();
  const [minAmount, setMinAmount] = useState('');
  const [maxAmount, setMaxAmount] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await api.warehouseSettings();
      // 0/null are the "no limit" states - shown as an empty field rather
      // than a literal 0, so the placeholder explains what empty means.
      setMinAmount(data.settings.minOrderAmountUsd ? String(data.settings.minOrderAmountUsd) : '');
      setMaxAmount(data.settings.maxOrderAmountUsd != null ? String(data.settings.maxOrderAmountUsd) : '');
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError(null);
    setSuccessMessage(null);

    const min = minAmount.trim() === '' ? 0 : Number(minAmount);
    const max = maxAmount.trim() === '' ? null : Number(maxAmount);

    if (!Number.isFinite(min) || min < 0) {
      setError(t('warehouseSettings.minInvalid'));
      return;
    }
    if (max !== null && (!Number.isFinite(max) || max < 0)) {
      setError(t('warehouseSettings.maxInvalid'));
      return;
    }
    // Mirrors the server's own rule (warehouseSettings.service.js) so the
    // pharmacist-facing gate can never be configured into an impossible
    // window; the server still re-checks.
    if (min > 0 && max !== null && min >= max) {
      setError(t('warehouseSettings.minMustBeBelowMax'));
      return;
    }

    const confirmed = window.confirm(t('warehouseSettings.confirmSave'));
    if (!confirmed) return;

    setIsSaving(true);
    try {
      const data = await api.updateWarehouseOrderLimits({
        minOrderAmountUsd: min,
        maxOrderAmountUsd: max,
      });
      setMinAmount(data.settings.minOrderAmountUsd ? String(data.settings.minOrderAmountUsd) : '');
      setMaxAmount(data.settings.maxOrderAmountUsd != null ? String(data.settings.maxOrderAmountUsd) : '');
      setSuccessMessage(t('warehouseSettings.saved'));
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div>
      <div className="wh-page-head">
        <h1>{t('nav.settings')}</h1>
      </div>

      {isLoading ? (
        <p className="hint">{t('common.loading')}</p>
      ) : (
        <div className="wh-detail-card wh-settings-card">
          <h2 className="wh-detail-card-title">{t('warehouseSettings.orderLimitsTitle')}</h2>
          <p className="hint wh-settings-hint">{t('warehouseSettings.orderLimitsHint')}</p>

          <form onSubmit={handleSubmit} className="product-form">
            <label>
              {t('warehouseSettings.minLabel')}
              <input
                type="number"
                min="0"
                step="0.01"
                value={minAmount}
                onChange={(e) => setMinAmount(e.target.value)}
                placeholder={t('warehouseSettings.minPlaceholder')}
              />
            </label>
            <label>
              {t('warehouseSettings.maxLabel')}
              <input
                type="number"
                min="0"
                step="0.01"
                value={maxAmount}
                onChange={(e) => setMaxAmount(e.target.value)}
                placeholder={t('warehouseSettings.maxPlaceholder')}
              />
            </label>

            {error && <p className="error-text">{error}</p>}
            {successMessage && <p className="wh-settings-success">{successMessage}</p>}

            <button type="submit" className="btn-primary" disabled={isSaving}>
              {isSaving ? t('common.saving') : t('warehouseSettings.saveButton')}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
