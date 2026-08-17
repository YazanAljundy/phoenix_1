import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api, getToken, setToken } from '../api/client';

const AuthContext = createContext(null);

const PANEL_ROLES = ['admin', 'warehouse'];

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [warehouse, setWarehouse] = useState(null);
  const [status, setStatus] = useState('loading'); // loading | unauthenticated | authenticated

  useEffect(() => {
    const token = getToken();
    if (!token) {
      setStatus('unauthenticated');
      return;
    }

    api
      .me()
      .then((data) => {
        setUser(data.user);
        setWarehouse(data.warehouse);
        setStatus('authenticated');
      })
      .catch(() => {
        setToken(null);
        setStatus('unauthenticated');
      });
  }, []);

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
    setToken(data.token);
    setUser(data.user);
    setWarehouse(data.warehouse);
    setStatus('authenticated');
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
    setWarehouse(null);
    setStatus('unauthenticated');
  }, []);

  return (
    <AuthContext.Provider value={{ user, warehouse, status, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
