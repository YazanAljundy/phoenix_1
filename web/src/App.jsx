import { BrowserRouter } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { LoginPage } from './auth/LoginPage';
import { ExchangeRateProvider } from './context/ExchangeRateContext';
import { RealtimeProvider } from './realtime/RealtimeProvider';
import { AdminPanel } from './pages/AdminPanel';
import { WarehousePanel } from './pages/WarehousePanel';

// Section 13b: one React app, role-based menus - admin and warehouse
// accounts each see only their own pages, each with real (bookmarkable,
// back/forward-capable) routes of its own. A pharmacy account can
// authenticate (the backend's /auth/login is role-agnostic) but is rejected
// in AuthContext.login before it ever reaches here.
function Gate() {
  const { t } = useTranslation();
  const { status, user } = useAuth();

  if (status === 'loading') {
    return (
      <div className="auth-screen">
        <p className="hint">{t('common.loading')}</p>
      </div>
    );
  }

  if (status === 'unauthenticated') {
    return <LoginPage />;
  }

  // One RealtimeProvider around both panels - it is role-agnostic (it just
  // connects with the stored token) and the SERVER decides which room the
  // connection belongs to from the authenticated user's role: `admin` for an
  // admin, `warehouse:<own id>` for a warehouse. Mounting it once here rather
  // than per-panel keeps a single connection and a single lifecycle for both.
  //
  // It sits inside the authenticated branch only, so an unauthenticated
  // visitor never opens a socket.
  return (
    <ExchangeRateProvider>
      <RealtimeProvider>
        {user?.role === 'warehouse' ? <WarehousePanel /> : <AdminPanel />}
      </RealtimeProvider>
    </ExchangeRateProvider>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Gate />
      </AuthProvider>
    </BrowserRouter>
  );
}
