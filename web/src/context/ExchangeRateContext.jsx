import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';

const ExchangeRateContext = createContext(null);
const ExchangeRateActionsContext = createContext(null);

// Fetched once per session, right after auth resolves (GET /exchange-rate is
// open to any authenticated role) - not refetched per page. Same
// session-wide, not-per-screen contract as the Flutter app's
// ExchangeRateCubit. Value is the plain usdToSyp number, or null if it
// hasn't loaded (or failed) yet - callers show USD-only prices in that case,
// no error UI.
//
// That one fetch can be hours old when a form converts SYP to USD with it, so
// every such write sends the rate it used (`rateUsed`) and the server refuses
// one that is no longer current (RATE_CHANGED - see utils/exchangeRate.js).
// The refusal is also what moves this value on: `useExchangeRateActions`
// replaces it with the rate the server reported, or re-reads it.
export function ExchangeRateProvider({ children }) {
  const { status } = useAuth();
  const [usdToSyp, setUsdToSyp] = useState(null);

  // Resolves to the rate now in effect, or null when it could not be read -
  // silently, see above.
  const refresh = useCallback(
    () =>
      api
        .exchangeRate()
        .then((data) => {
          setUsdToSyp(data.usdToSyp);
          return data.usdToSyp;
        })
        .catch(() => null),
    []
  );

  useEffect(() => {
    if (status !== 'authenticated') return;
    refresh();
  }, [status, refresh]);

  // The rate a RATE_CHANGED refusal named - already the server's own figure,
  // so no second request is needed to learn it.
  const applyServerRate = useCallback((rate) => {
    const value = Number(rate);
    if (Number.isFinite(value) && value > 0) setUsdToSyp(value);
  }, []);

  const actions = useMemo(() => ({ refresh, applyServerRate }), [refresh, applyServerRate]);

  return (
    <ExchangeRateActionsContext.Provider value={actions}>
      <ExchangeRateContext.Provider value={usdToSyp}>{children}</ExchangeRateContext.Provider>
    </ExchangeRateActionsContext.Provider>
  );
}

export function useExchangeRate() {
  return useContext(ExchangeRateContext);
}

// { refresh, applyServerRate }, or null outside the provider. Kept apart from
// useExchangeRate so the many screens that only read the rate are unchanged.
export function useExchangeRateActions() {
  return useContext(ExchangeRateActionsContext);
}
