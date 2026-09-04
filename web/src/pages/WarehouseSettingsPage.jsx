import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { useExchangeRate } from '../context/ExchangeRateContext';
import { sypFromUsd } from '../utils/currency';

// Section: the warehouse's own order-size limits. Both are opt-in - an empty
// minimum means "no minimum" (stored as 0) and an empty maximum means "no
// maximum" (stored as null), which is what every warehouse starts with.
//
// The limits are entered in SYP (the panel's default currency) but stored in
// USD on the server, same as product prices - converted at the live rate on
// save. A field left untouched re-sends its exact stored USD value so a
// moved rate can never silently shift a limit nobody edited.
export function WarehouseSettingsPage() {
  const { t } = useTranslation();
  const usdToSyp = useExchangeRate();
  const [minAmount, setMinAmount] = useState('');
  const [maxAmount, setMaxAmount] = useState('');
  // Opt-in proof-of-delivery: when on, an order can't be marked delivered
  // until the pharmacy uploads a photo of the shipment seal. Enforced
  // server-side (warehouseOrder.service.js) - this is just the switch.
  const [requireSealPhoto, setRequireSealPhoto] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);
  // What the fields were populated with, plus the raw stored USD values -
  // used to detect an untouched field on save.
  const loaded = useRef({ minSyp: '', maxSyp: '', minUsd: 0, maxUsd: null });

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await api.warehouseSettings();
      const minUsd = data.settings.minOrderAmountUsd || 0;
      const maxUsd = data.settings.maxOrderAmountUsd;
      // 0/null are the "no limit" states - shown as an empty field rather
      // than a literal 0, so the placeholder explains what empty means.
      const minSyp = minUsd > 0 ? String(sypFromUsd(minUsd, usdToSyp) ?? '') : '';
      const maxSyp = maxUsd != null ? String(sypFromUsd(maxUsd, usdToSyp) ?? '') : '';
      setMinAmount(minSyp);
      setMaxAmount(maxSyp);
      setRequireSealPhoto(Boolean(data.settings.requireDeliverySealPhoto));
      loaded.current = { minSyp, maxSyp, minUsd, maxUsd: maxUsd ?? null };
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, [usdToSyp]);

  useEffect(() => {
    load();
  }, [load]);

  // Turns a SYP field into the USD figure to store: 0/null when cleared, the
  // untouched stored value when unchanged, otherwise a rate conversion.
  const toStoredUsd = (value, { field }) => {
    const trimmed = value.trim();
    const emptyValue = field === 'min' ? 0 : null;
    if (trimmed === '') return { ok: true, value: emptyValue };

    if (trimmed === loaded.current[`${field}Syp`] && loaded.current[`${field}Syp`] !== '') {
      return { ok: true, value: loaded.current[`${field}Usd`] };
    }

    const syp = Number(trimmed);
    if (!Number.isFinite(syp) || syp < 0) {
      return { ok: false, error: t(field === 'min' ? 'warehouseSettings.minInvalid' : 'warehouseSettings.maxInvalid') };
    }
    if (usdToSyp == null || !(Number(usdToSyp) > 0)) {
      return { ok: false, error: t('warehouseSettings.rateRequired') };
    }
    return { ok: true, value: Math.round((syp / Number(usdToSyp)) * 100) / 100 };
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError(null);
    setSuccessMessage(null);

    const min = toStoredUsd(minAmount, { field: 'min' });
    if (!min.ok) return setError(min.error);
    const max = toStoredUsd(maxAmount, { field: 'max' });
    if (!max.ok) return setError(max.error);

    // Mirrors the server's own rule (warehouseSettings.service.js) so the
    // pharmacist-facing gate can never be configured into an impossible
    // window; the server still re-checks.
    if (min.value > 0 && max.value !== null && min.value >= max.value) {
      setError(t('warehouseSettings.minMustBeBelowMax'));
      return;
    }

    const confirmed = window.confirm(t('warehouseSettings.confirmSave'));
    if (!confirmed) return;

    setIsSaving(true);
    try {
      await api.updateWarehouseOrderLimits({
        minOrderAmountUsd: min.value,
        maxOrderAmountUsd: max.value,
        requireDeliverySealPhoto: requireSealPhoto,
      });
      await load();
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
          {usdToSyp == null && <p className="hint">{t('warehouseSettings.rateRequired')}</p>}

          <form onSubmit={handleSubmit} className="product-form">
            <label>
              {t('warehouseSettings.minLabel')}
              <input
                type="number"
                min="0"
                step="1"
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
                step="1"
                value={maxAmount}
                onChange={(e) => setMaxAmount(e.target.value)}
                placeholder={t('warehouseSettings.maxPlaceholder')}
              />
            </label>

            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={requireSealPhoto}
                onChange={(e) => setRequireSealPhoto(e.target.checked)}
              />
              {t('warehouseSettings.requireSealPhotoLabel')}
            </label>
            <p className="hint wh-settings-hint">{t('warehouseSettings.requireSealPhotoHint')}</p>

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
