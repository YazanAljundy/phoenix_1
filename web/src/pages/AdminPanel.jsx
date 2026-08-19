import { Navigate, NavLink, Route, Routes } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { PendingAccountsPage } from './PendingAccountsPage';
import { AdminOffersPage } from './AdminOffersPage';
import { AdminProductsPage } from './AdminProductsPage';
import { AdminCatalogPage } from './AdminCatalogPage';

const TABS = [
  { path: '/admin/pending-accounts', label: 'Pending accounts' },
  { path: '/admin/offers', label: 'Offers' },
  { path: '/admin/products', label: 'Products' },
  { path: '/admin/catalog', label: 'Catalog' },
];

function tabClassName({ isActive }) {
  return `panel-tab${isActive ? ' active' : ''}`;
}

// Section 13c: the admin side of the shared React panel - same real-routes
// shell as the warehouse side, for the same reason (this is about to grow
// past one page too).
export function AdminPanel() {
  const { user, logout } = useAuth();

  return (
    <div className="page">
      <header className="page-header">
        <div className="panel-header-left">
          <h1>Admin</h1>
          <nav className="panel-tabs">
            {TABS.map((tab) => (
              <NavLink key={tab.path} to={tab.path} className={tabClassName}>
                {tab.label}
              </NavLink>
            ))}
          </nav>
        </div>
        <div className="header-actions">
          <span className="user-name">{user?.name}</span>
          <button className="btn-secondary" onClick={logout}>
            Log out
          </button>
        </div>
      </header>

      <Routes>
        <Route path="/admin/pending-accounts" element={<PendingAccountsPage />} />
        <Route path="/admin/offers" element={<AdminOffersPage />} />
        <Route path="/admin/products" element={<AdminProductsPage />} />
        <Route path="/admin/catalog" element={<AdminCatalogPage />} />
        <Route path="*" element={<Navigate to="/admin/pending-accounts" replace />} />
      </Routes>
    </div>
  );
}
