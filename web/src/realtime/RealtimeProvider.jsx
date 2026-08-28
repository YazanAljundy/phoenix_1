import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { getToken } from '../api/client';
import { realtimeClient } from './realtimeClient';

const RealtimeContext = createContext(null);

// Owns the single socket connection for the whole dashboard: opened once the
// user is authenticated, closed on logout. Mounted inside the authenticated
// panels only (see App.jsx), so an unauthenticated visitor never opens one.
//
// Pages never connect for themselves - they subscribe through
// useRealtimeSync, which cleans itself up on unmount. That split is what
// keeps component churn from multiplying connections.
export function RealtimeProvider({ children }) {
  const [isConnected, setIsConnected] = useState(realtimeClient.isConnected);

  useEffect(() => {
    const token = getToken();
    if (!token) return undefined;

    const unsubscribe = realtimeClient.onStatusChange(setIsConnected);
    realtimeClient.connect(token);

    return () => {
      unsubscribe();
      realtimeClient.disconnect();
    };
  }, []);

  const value = useMemo(() => ({ client: realtimeClient, isConnected }), [isConnected]);

  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}

// Returns a safe no-op shape when used outside the provider (e.g. a page
// rendered in isolation) rather than throwing - realtime is an enhancement,
// never a reason for a screen to fail to render.
export function useRealtime() {
  return useContext(RealtimeContext) ?? { client: null, isConnected: false };
}
