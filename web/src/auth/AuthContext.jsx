import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api, getToken, setSession } from '../api/client';
import { shouldClearSession } from './sessionError';

const AuthContext = createContext(null);

const PANEL_ROLES = ['admin', 'warehouse'];

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [warehouse, setWarehouse] = useState(null);
  // loading | unauthenticated | authenticated | offline
  const [status, setStatus] = useState('loading');

  // Validates the stored token. Only a 401/403 - the server actually
  // rejecting the credential - ends the session; everything else leaves it
  // untouched and surfaces a retry instead (audit F-04). See sessionError.js.
  const loadSession = useCallback(async () => {
    const token = getToken();
    if (!token) {
      setStatus('unauthenticated');
      return;
    }

    setStatus('loading');
    try {
      const data = await api.me();
      setUser(data.user);
      setWarehouse(data.warehouse);
      setStatus('authenticated');
    } catch (err) {
      if (shouldClearSession(err)) {
        setSession(null);
        setStatus('unauthenticated');
        return;
      }
      // Keep the token. The server was unreachable or unwell, which says
      // nothing about whether this session is still valid - and forcing a
      // re-login is impossible anyway while the backend is down.
      setStatus('offline');
    }
  }, []);

  useEffect(() => {
    loadSession();
  }, [loadSession]);

  // Section 6-2/3: phone + password, no OTP - the only login mechanism while
  // OTP is disabled. Role-agnostic on the backend (shared with the pharmacy
  // app); this panel serves admin and warehouse accounts only (Section 13b:
  // one React app, menus by role) - a pharmacy account has no business here.
  // The role check below is a UX gate; the actual security boundary is each
  // route's own authorize(...) on the server.
  const login = useCallback(async (phone, password) => {
    const data = await api.loginWithPassword(phone, password);
    if (!PANEL_ROLES.includes(data.user.role)) {
      throw new Error('This panel is for admin and warehouse accounts only.');
    }
    setSession({ token: data.token, refreshToken: data.refreshToken });
    setUser(data.user);
    setWarehouse(data.warehouse);
    setStatus('authenticated');
  }, []);

  const logout = useCallback(() => {
    // Both halves, or the refresh token would quietly outlive the session
    // it belongs to and could mint a new access token after sign-out.
    setSession(null);
    setUser(null);
    setWarehouse(null);
    setStatus('unauthenticated');
  }, []);

  return (
    <AuthContext.Provider value={{ user, warehouse, status, login, logout, retry: loadSession }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
