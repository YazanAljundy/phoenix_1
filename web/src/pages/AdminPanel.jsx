import { useState } from 'react';
import { Navigate, NavLink, Route, Routes } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/AuthContext';
import { LanguageToggle } from '../components/LanguageToggle';
import { AdminDashboardPage } from './AdminDashboardPage';
import { AccountsPage } from './AccountsPage';
import { AdminOffersPage } from './AdminOffersPage';
import { AdminAdvertisementsPage } from './AdminAdvertisementsPage';
import { AdminProductsPage } from './AdminProductsPage';
import { AdminCatalogPage } from './AdminCatalogPage';
import { AdminBannersPage } from './AdminBannersPage';
import { AdminExchangeRatePage } from './AdminExchangeRatePage';
import { AdminNotificationsPage } from './AdminNotificationsPage';
import { AdminComplaintsPage } from './AdminComplaintsPage';
import { AdminComplaintDetailPage } from './AdminComplaintDetailPage';

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
    { path: '/admin/accounts', label: t('nav.accounts') },
    { path: '/admin/offers', label: t('nav.offers') },
    // One tab, two sub-sections (general ads / package ads) - see
    // AdvertisementsSubNav. They were separate tabs until it turned out both
    // render as "الإعلانات" in Arabic.
    { path: '/admin/advertisements', label: t('nav.advertisements') },
    { path: '/admin/products', label: t('nav.products') },
    { path: '/admin/catalog', label: t('nav.centralCatalog') },
    { path: '/admin/exchange-rate', label: t('nav.exchangeRate') },
    { path: '/admin/notifications', label: t('nav.notifications') },
    { path: '/admin/complaints', label: t('nav.complaints') },
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
          <img className="adm-sidebar-logo" src="/images/feniq_logo.png" alt={t('nav.brandName')} />
          <div className="adm-sidebar-brand">{t('nav.brandName')}</div>
          <div className="adm-sidebar-subtitle">{t('nav.adminTitle')}</div>
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
            <Route path="/admin/accounts" element={<AccountsPage />} />
            {/* Old bookmark - the section was renamed Pending Accounts -> Accounts. */}
            <Route path="/admin/pending-accounts" element={<Navigate to="/admin/accounts" replace />} />
            <Route path="/admin/offers" element={<AdminOffersPage />} />
            <Route
              path="/admin/advertisements"
              element={<Navigate to="/admin/advertisements/general" replace />}
            />
            <Route path="/admin/advertisements/general" element={<AdminBannersPage />} />
            <Route path="/admin/advertisements/packages" element={<AdminAdvertisementsPage />} />
            {/* Old bookmark - banners became the "general" half of Advertisements. */}
            <Route
              path="/admin/banners"
              element={<Navigate to="/admin/advertisements/general" replace />}
            />
            <Route path="/admin/products" element={<AdminProductsPage />} />
            <Route path="/admin/catalog" element={<AdminCatalogPage />} />
            <Route path="/admin/exchange-rate" element={<AdminExchangeRatePage />} />
            <Route path="/admin/notifications" element={<AdminNotificationsPage />} />
            <Route path="/admin/complaints" element={<AdminComplaintsPage />} />
            <Route path="/admin/complaints/:complaintId" element={<AdminComplaintDetailPage />} />
            <Route path="*" element={<Navigate to="/admin/accounts" replace />} />
          </Routes>
        </div>
      </div>
    </div>
  );
}
