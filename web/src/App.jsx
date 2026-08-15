import { BrowserRouter } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { LoginPage } from './auth/LoginPage';
import { AdminPanel } from './pages/AdminPanel';
import { WarehousePanel } from './pages/WarehousePanel';

// Section 13b: one React app, role-based menus - admin and warehouse
// accounts each see only their own pages, each with real (bookmarkable,
// back/forward-capable) routes of its own. A pharmacy account can
// authenticate (the backend's /auth/login is role-agnostic) but is rejected
// in AuthContext.login before it ever reaches here.
function Gate() {
  const { status, user } = useAuth();

  if (status === 'loading') {
    return (
      <div className="auth-screen">
        <p className="hint">Loading...</p>
      </div>
    );
  }

  if (status === 'unauthenticated') {
    return <LoginPage />;
  }

  if (user?.role === 'warehouse') {
    return <WarehousePanel />;
  }

  return <AdminPanel />;
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
