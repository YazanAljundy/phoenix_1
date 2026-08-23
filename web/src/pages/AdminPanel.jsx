import { useState } from 'react';
import { Navigate, NavLink, Route, Routes } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/AuthContext';
import { LanguageToggle } from '../components/LanguageToggle';
import { AdminDashboardPage } from './AdminDashboardPage';
import { PendingAccountsPage } from './PendingAccountsPage';
import { AdminOffersPage } from './AdminOffersPage';
import { AdminProductsPage } from './AdminProductsPage';
import { AdminCatalogPage } from './AdminCatalogPage';
import { AdminBannersPage } from './AdminBannersPage';
import { AdminExchangeRatePage } from './AdminExchangeRatePage';
import { AdminNotificationsPage } from './AdminNotificationsPage';

function navLinkClassName({ isActive }) {
  return `adm-nav-link${isActive ? ' active' : ''}`;
}

// Section 13c: the admin side of the shared React panel - same real-routes
// sidebar shell as the warehouse side (Phoenix Design import), under its own
// ".admin-shell" scope in index.css so restyling this can't touch
// WarehousePanel.jsx's look, same guarantee in reverse.
export function AdminPanel() {
  const { t } = useTranslation();
  const { user, logout } = useAuth();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  const TABS = [
    { path: '/admin/dashboard', label: t('nav.dashboard') },
    { path: '/admin/pending-accounts', label: t('nav.pendingAccounts') },
    { path: '/admin/offers', label: t('nav.offers') },
    { path: '/admin/banners', label: t('nav.banners') },
    { path: '/admin/products', label: t('nav.products') },
    { path: '/admin/catalog', label: t('nav.centralCatalog') },
    { path: '/admin/exchange-rate', label: t('nav.exchangeRate') },
    { path: '/admin/notifications', label: t('nav.notifications') },
  ];

  // Closing on every route change covers both a tab click and any in-page
  // "back" navigation - anything that changes the URL while the mobile
  // drawer happens to be open.
  const closeSidebar = () => setIsSidebarOpen(false);

  return (
    <div className="admin-shell">
      <div
        className={`adm-sidebar-backdrop${isSidebarOpen ? ' adm-sidebar-open' : ''}`}
        onClick={closeSidebar}
      />
      <aside className={`adm-sidebar${isSidebarOpen ? ' adm-sidebar-open' : ''}`}>
        <div className="adm-sidebar-header">
          <div className="adm-sidebar-logo">{t('nav.brandInitial')}</div>
          <div>
            <div className="adm-sidebar-brand">{t('nav.brandName')}</div>
            <div className="adm-sidebar-subtitle">{t('nav.adminTitle')}</div>
          </div>
        </div>
        <nav className="adm-nav">
          {TABS.map((tab) => (
            <NavLink key={tab.path} to={tab.path} className={navLinkClassName} onClick={closeSidebar}>
              {tab.label}
            </NavLink>
          ))}
        </nav>
      </aside>

      <div className="adm-main">
        <header className="adm-topbar">
          <div className="adm-topbar-left">
            <button
              type="button"
              className="adm-hamburger"
              aria-label={t('nav.openMenu')}
              onClick={() => setIsSidebarOpen((open) => !open)}
            >
              &#9776;
            </button>
            <div className="adm-topbar-title">{t('nav.adminTitle')}</div>
          </div>
          <div className="adm-topbar-actions">
            <span className="user-name">{user?.name}</span>
            <LanguageToggle />
            <button className="adm-logout-btn" onClick={logout}>
              {t('common.logOut')}
            </button>
          </div>
        </header>

        <div className="adm-content">
          <Routes>
            <Route path="/admin/dashboard" element={<AdminDashboardPage />} />
            <Route path="/admin/pending-accounts" element={<PendingAccountsPage />} />
            <Route path="/admin/offers" element={<AdminOffersPage />} />
            <Route path="/admin/banners" element={<AdminBannersPage />} />
            <Route path="/admin/products" element={<AdminProductsPage />} />
            <Route path="/admin/catalog" element={<AdminCatalogPage />} />
            <Route path="/admin/exchange-rate" element={<AdminExchangeRatePage />} />
            <Route path="/admin/notifications" element={<AdminNotificationsPage />} />
            <Route path="*" element={<Navigate to="/admin/pending-accounts" replace />} />
          </Routes>
        </div>
      </div>
    </div>
  );
}
