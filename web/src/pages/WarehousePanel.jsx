import { useState } from 'react';
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/AuthContext';
import {
  WAREHOUSE_NAV,
  WAREHOUSE_NAV_GROUPS,
  isNavItemActive,
  navItemTarget,
} from '../utils/warehouseNav';
import { LanguageToggle } from '../components/LanguageToggle';
import { NavBadge } from '../components/NavBadge';
import { useUnreadBadges } from '../realtime/UnreadBadgesProvider';
import { WarehouseOrdersPage } from './WarehouseOrdersPage';
import { WarehouseOrderDetailPage } from './WarehouseOrderDetailPage';
import { WarehouseProductsPage } from './WarehouseProductsPage';
import { WarehouseOffersPage } from './WarehouseOffersPage';
import { WarehouseAdvertisementsPage } from './WarehouseAdvertisementsPage';
import { WarehouseBannersPage } from './WarehouseBannersPage';
import { WarehouseReturnsPage } from './WarehouseReturnsPage';
import { WarehouseReturnDetailPage } from './WarehouseReturnDetailPage';
import { WarehouseComplaintsPage } from './WarehouseComplaintsPage';
import { WarehouseComplaintDetailPage } from './WarehouseComplaintDetailPage';
import { WarehouseReviewsPage } from './WarehouseReviewsPage';
import { WarehouseSettingsPage } from './WarehouseSettingsPage';
import { WarehouseDiscountsPage } from './WarehouseDiscountsPage';
import { WarehouseDebtsPage } from './WarehouseDebtsPage';
import { WarehouseSettlementPage } from './WarehouseSettlementPage';

// Section 13b: the warehouse side of the shared React panel. Real routes
// (not component state) - each tab gets its own bookmarkable/refreshable
// URL. Shell is a sidebar (Feniq Design import) rather than the admin
// panel's top tabs; see index.css's ".warehouse-shell" scope for why this
// is safe to restyle without touching AdminPanel.jsx's own look.
//
// The sidebar is seven tabs, three of which group two or three pages each
// (Promotions / Financials / Feedback). The grouping is a sidebar affordance
// only - the grouped pages kept their original flat URLs. See
// utils/warehouseNav.js for the model and WarehouseGroupSubNav for the second
// row of pills the grouped pages render.
export function WarehousePanel() {
  const { t } = useTranslation();
  const { user, warehouse, logout } = useAuth();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const { pathname } = useLocation();
  // Per-tab "new since you last looked" counts - see realtime/unreadBadges.js.
  // A group tab shows the sum of its children, which is what its pill row
  // (WarehouseGroupSubNav) then breaks down.
  const { countUnder, total: unreadTotal } = useUnreadBadges();
  const navItemUnread = (item) =>
    item.children
      ? item.children.reduce((sum, child) => sum + countUnder(child.path), 0)
      : countUnder(item.path);

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
          <img className="wh-sidebar-logo" src="/images/feniq-mark-dark.png" alt={t('nav.brandName')} />
          <div className="wh-sidebar-brand">{t('nav.brandName')}</div>
          <div className="wh-sidebar-subtitle">{t('nav.warehouseTitleFallback')}</div>
        </div>
        <nav className="wh-nav">
          {WAREHOUSE_NAV.map((item) => {
            // Link, not NavLink, and the active state computed here: a grouped
            // tab has to light up for ANY of its children, and those children
            // kept their original flat URLs - they share no path prefix with
            // each other or with the parent, which is the only thing NavLink
            // can match on. NavLink would also CLOBBER aria-current, deriving
            // it from its own isActive and emitting nothing on a grouped tab
            // that is visibly active - so it would look active without reading
            // as active. Owning both attributes keeps them in agreement.
            const isActive = isNavItemActive(pathname, item);
            return (
              <Link
                key={item.id}
                // Straight to the first child - opening a group is one click and
                // there is no landing page in between.
                to={navItemTarget(item)}
                className={`wh-nav-link${isActive ? ' active' : ''}`}
                aria-current={isActive ? 'page' : undefined}
                onClick={closeSidebar}
              >
                {t(item.labelKey)}
                <NavBadge count={navItemUnread(item)} />
              </Link>
            );
          })}
        </nav>
      </aside>

      <div className="wh-main">
        <header className="wh-topbar">
          <div className="wh-topbar-left">
            <button
              type="button"
              className="wh-hamburger"
              aria-label={unreadTotal > 0 ? t('nav.openMenuWithUpdates') : t('nav.openMenu')}
              onClick={() => setIsSidebarOpen((open) => !open)}
            >
              &#9776;
              {/* The sidebar - and its badges - is off-canvas on a phone. */}
              {unreadTotal > 0 && <span className="nav-menu-dot" aria-hidden="true" />}
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
            <Route
              path="/warehouse/advertisements"
              element={<Navigate to="/warehouse/advertisements/general" replace />}
            />
            <Route path="/warehouse/advertisements/general" element={<WarehouseBannersPage />} />
            <Route
              path="/warehouse/advertisements/packages"
              element={<WarehouseAdvertisementsPage />}
            />
            {/* Old bookmark - banners became the "general" half of Advertisements. */}
            <Route
              path="/warehouse/banners"
              element={<Navigate to="/warehouse/advertisements/general" replace />}
            />
            {/* Group URLs. The sidebar links straight at the first child, so
                these only ever serve a typed or externally-linked URL - but they
                have to exist, or the catch-all below would silently bounce them
                to Orders. Generated from the same model the sidebar renders, so
                a new group cannot forget its redirect. */}
            {WAREHOUSE_NAV_GROUPS.map((group) => (
              <Route
                key={group.id}
                path={group.aliasPath}
                element={<Navigate to={navItemTarget(group)} replace />}
              />
            ))}
            <Route path="/warehouse/discounts" element={<WarehouseDiscountsPage />} />
            <Route path="/warehouse/debts" element={<WarehouseDebtsPage />} />
            <Route path="/warehouse/settlement" element={<WarehouseSettlementPage />} />
            <Route path="/warehouse/returns" element={<WarehouseReturnsPage />} />
            <Route path="/warehouse/returns/:returnId" element={<WarehouseReturnDetailPage />} />
            <Route path="/warehouse/complaints" element={<WarehouseComplaintsPage />} />
            <Route path="/warehouse/complaints/:complaintId" element={<WarehouseComplaintDetailPage />} />
            <Route path="/warehouse/reviews" element={<WarehouseReviewsPage />} />
            <Route path="/warehouse/settings" element={<WarehouseSettingsPage />} />
            <Route path="*" element={<Navigate to="/warehouse/orders" replace />} />
          </Routes>
        </div>
      </div>
    </div>
  );
}
