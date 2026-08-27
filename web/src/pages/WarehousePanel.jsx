import { useState } from 'react';
import { Navigate, NavLink, Route, Routes } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/AuthContext';
import { LanguageToggle } from '../components/LanguageToggle';
import { WarehouseOrdersPage } from './WarehouseOrdersPage';
import { WarehouseOrderDetailPage } from './WarehouseOrderDetailPage';
import { WarehouseProductsPage } from './WarehouseProductsPage';
import { WarehouseOffersPage } from './WarehouseOffersPage';
import { WarehouseBannersPage } from './WarehouseBannersPage';
import { WarehouseReturnsPage } from './WarehouseReturnsPage';
import { WarehouseReturnDetailPage } from './WarehouseReturnDetailPage';
import { WarehouseReviewsPage } from './WarehouseReviewsPage';
import { WarehouseSettingsPage } from './WarehouseSettingsPage';
import { WarehouseDiscountsPage } from './WarehouseDiscountsPage';
import { WarehouseDebtsPage } from './WarehouseDebtsPage';

function navLinkClassName({ isActive }) {
  return `wh-nav-link${isActive ? ' active' : ''}`;
}

// Section 13b: the warehouse side of the shared React panel. Real routes
// (not component state) - each tab gets its own bookmarkable/refreshable
// URL. Shell is a sidebar (Phoenix Design import) rather than the admin
// panel's top tabs; see index.css's ".warehouse-shell" scope for why this
// is safe to restyle without touching AdminPanel.jsx's own look.
export function WarehousePanel() {
  const { t } = useTranslation();
  const { user, warehouse, logout } = useAuth();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  const TABS = [
    { path: '/warehouse/orders', label: t('nav.orders') },
    { path: '/warehouse/products', label: t('nav.catalog') },
    { path: '/warehouse/offers', label: t('nav.offers') },
    { path: '/warehouse/banners', label: t('nav.banners') },
    { path: '/warehouse/discounts', label: t('nav.discounts') },
    { path: '/warehouse/debts', label: t('nav.debts') },
    { path: '/warehouse/returns', label: t('nav.returns') },
    { path: '/warehouse/reviews', label: t('nav.reviews') },
    { path: '/warehouse/settings', label: t('nav.settings') },
  ];

  // Closing on every route change covers both a tab click and the
  // detail-page "back" buttons/browser back - anything that changes the
  // URL while the mobile drawer happens to be open.
  const closeSidebar = () => setIsSidebarOpen(false);

  return (
    <div className="warehouse-shell">
      <div
        className={`wh-sidebar-backdrop${isSidebarOpen ? ' wh-sidebar-open' : ''}`}
        onClick={closeSidebar}
      />
      <aside className={`wh-sidebar${isSidebarOpen ? ' wh-sidebar-open' : ''}`}>
        <div className="wh-sidebar-header">
          <img className="wh-sidebar-logo" src="/images/feniq_logo.png" alt={t('nav.brandName')} />
          <div className="wh-sidebar-brand">{t('nav.brandName')}</div>
          <div className="wh-sidebar-subtitle">{t('nav.warehouseTitleFallback')}</div>
        </div>
        <nav className="wh-nav">
          {TABS.map((tab) => (
            <NavLink key={tab.path} to={tab.path} className={navLinkClassName} onClick={closeSidebar}>
              {tab.label}
            </NavLink>
          ))}
        </nav>
      </aside>

      <div className="wh-main">
        <header className="wh-topbar">
          <div className="wh-topbar-left">
            <button
              type="button"
              className="wh-hamburger"
              aria-label={t('nav.openMenu')}
              onClick={() => setIsSidebarOpen((open) => !open)}
            >
              &#9776;
            </button>
            <div className="wh-topbar-title">
              {warehouse ? warehouse.nameEn : t('nav.warehouseTitleFallback')}
            </div>
          </div>
          <div className="wh-topbar-actions">
            <span className="user-name">{user?.name}</span>
            <LanguageToggle />
            <button className="wh-logout-btn" onClick={logout}>
              {t('common.logOut')}
            </button>
          </div>
        </header>

        <div className="wh-content">
          <Routes>
            <Route path="/warehouse/orders" element={<WarehouseOrdersPage />} />
            <Route path="/warehouse/orders/:orderId" element={<WarehouseOrderDetailPage />} />
            <Route path="/warehouse/products" element={<WarehouseProductsPage />} />
            <Route path="/warehouse/offers" element={<WarehouseOffersPage />} />
            <Route path="/warehouse/banners" element={<WarehouseBannersPage />} />
            <Route path="/warehouse/discounts" element={<WarehouseDiscountsPage />} />
            <Route path="/warehouse/debts" element={<WarehouseDebtsPage />} />
            <Route path="/warehouse/returns" element={<WarehouseReturnsPage />} />
            <Route path="/warehouse/returns/:returnId" element={<WarehouseReturnDetailPage />} />
            <Route path="/warehouse/reviews" element={<WarehouseReviewsPage />} />
            <Route path="/warehouse/settings" element={<WarehouseSettingsPage />} />
            <Route path="*" element={<Navigate to="/warehouse/orders" replace />} />
          </Routes>
        </div>
      </div>
    </div>
  );
}
