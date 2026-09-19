import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { ExchangeRateCard } from '../components/ExchangeRateCard';
import { useExchangeRateActions } from '../context/ExchangeRateContext';
import { applyRateFromAdminResponse } from '../utils/exchangeRate';

// Section: now its own page (mockup frame 1h) rather than a card embedded on
// Pending Accounts - same ExchangeRateCard component/logic, only relocated.
// This page is just the fetch-on-mount wrapper; ExchangeRateCard still owns
// all the get/set/reset behavior itself.
export function AdminExchangeRatePage() {
  const { t } = useTranslation();
  const [exchangeRate, setExchangeRate] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const rateActions = useExchangeRateActions();

  // ExchangeRateCard calls this back after setting a manual rate or handing
  // control back to the API, and it also runs on mount - so this is where the
  // panel-wide rate is brought in line with what the server now holds. The
  // admin who just changed the rate was otherwise the one person whose own tab
  // still converted at the old one, and their next product/package save came
  // back refused with RATE_CHANGED for a change they made themselves.
  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await api.adminExchangeRate();
      setExchangeRate(data.exchangeRate);
      applyRateFromAdminResponse(rateActions, data);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, [rateActions]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div>
      <div className="adm-page-head">
        <h1>{t('nav.exchangeRate')}</h1>
      </div>

      {error && <p className="error-text">{error}</p>}

      {isLoading ? (
        <p className="hint">{t('common.loading')}</p>
      ) : (
        exchangeRate && (
          <div className="adm-rate-page-body">
            <ExchangeRateCard rate={exchangeRate} onChanged={load} />
          </div>
        )
      )}
    </div>
  );
}
