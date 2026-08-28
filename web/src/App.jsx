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

  // Realtime is mounted for the warehouse panel only - warehouse rooms are
  // the only subscriptions the server hands out today (see
  // backend/src/realtime/index.js's resolveRoomsFor), so an admin session has
  // nothing to connect for.
  if (user?.role === 'warehouse') {
    return (
      <ExchangeRateProvider>
        <RealtimeProvider>
          <WarehousePanel />
        </RealtimeProvider>
      </ExchangeRateProvider>
    );
  }

  return (
    <ExchangeRateProvider>
      <AdminPanel />
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
