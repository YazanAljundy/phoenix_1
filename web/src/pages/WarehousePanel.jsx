import { Navigate, NavLink, Route, Routes } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { WarehouseOrdersPage } from './WarehouseOrdersPage';
import { WarehouseProductsPage } from './WarehouseProductsPage';
import { WarehouseOffersPage } from './WarehouseOffersPage';
import { WarehouseReturnsPage } from './WarehouseReturnsPage';
import { WarehouseReviewsPage } from './WarehouseReviewsPage';

const TABS = [
  { path: '/warehouse/orders', label: 'Orders' },
  { path: '/warehouse/products', label: 'Catalog' },
  { path: '/warehouse/offers', label: 'Offers' },
  { path: '/warehouse/returns', label: 'Returns' },
  { path: '/warehouse/reviews', label: 'Reviews' },
];

function tabClassName({ isActive }) {
  return `panel-tab${isActive ? ' active' : ''}`;
}

// Section 13b: the warehouse side of the shared React panel. Real routes
// (not component state) - each tab gets its own bookmarkable/refreshable URL.
export function WarehousePanel() {
  const { user, warehouse, logout } = useAuth();

  return (
    <div className="page">
      <header className="page-header">
        <div className="panel-header-left">
          <h1>{warehouse ? warehouse.nameEn : 'Warehouse panel'}</h1>
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
        <Route path="/warehouse/orders" element={<WarehouseOrdersPage />} />
        <Route path="/warehouse/products" element={<WarehouseProductsPage />} />
        <Route path="/warehouse/offers" element={<WarehouseOffersPage />} />
        <Route path="/warehouse/returns" element={<WarehouseReturnsPage />} />
        <Route path="/warehouse/reviews" element={<WarehouseReviewsPage />} />
        <Route path="*" element={<Navigate to="/warehouse/orders" replace />} />
      </Routes>
    </div>
  );
}
