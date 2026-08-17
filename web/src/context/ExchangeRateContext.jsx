import { createContext, useContext, useEffect, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';

const ExchangeRateContext = createContext(null);

// Fetched once per session, right after auth resolves (GET /exchange-rate is
// open to any authenticated role) - not refetched per page. Same
// session-wide, not-per-screen contract as the Flutter app's
// ExchangeRateCubit. Value is the plain usdToSyp number, or null if it
// hasn't loaded (or failed) yet - callers show USD-only prices in that case,
// no error UI.
export function ExchangeRateProvider({ children }) {
  const { status } = useAuth();
  const [usdToSyp, setUsdToSyp] = useState(null);

  useEffect(() => {
    if (status !== 'authenticated') return;
    api
      .exchangeRate()
      .then((data) => setUsdToSyp(data.usdToSyp))
      .catch(() => {
        // Silent fallback - see module comment.
      });
  }, [status]);

  return <ExchangeRateContext.Provider value={usdToSyp}>{children}</ExchangeRateContext.Provider>;
}

export function useExchangeRate() {
  return useContext(ExchangeRateContext);
}
