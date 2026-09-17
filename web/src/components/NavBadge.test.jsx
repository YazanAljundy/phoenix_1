import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import i18next from 'i18next';
import en from '../locales/en/translation.json';
import ar from '../locales/ar/translation.json';
import { NavBadge } from './NavBadge';
import { WarehouseGroupSubNav } from './WarehouseGroupSubNav';
import { AdvertisementsSubNav } from './AdvertisementsSubNav';
import { AdminPanel } from '../pages/AdminPanel';
import { WarehousePanel } from '../pages/WarehousePanel';

// Where the unread badges show up, rendered to static HTML - the project's
// vitest runs in node with no DOM, same approach as
// WarehouseGroupSubNav.test.jsx. The counting rules themselves are covered in
// realtime/unreadBadges.test.js; here the store is replaced by a fixed
// path -> count map so each test says exactly what the sidebar should show.

const badges = vi.hoisted(() => ({ counts: {}, role: 'admin' }));

vi.mock('../realtime/UnreadBadgesProvider', () => ({
  useUnreadBadges: () => ({
    countUnder: (path) => badges.counts[path] ?? 0,
    total: Object.values(badges.counts).reduce((sum, n) => sum + n, 0),
  }),
}));

vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'u1', name: 'Tester', role: badges.role },
    warehouse: badges.role === 'warehouse' ? { nameEn: 'WH', nameAr: 'مستودع' } : null,
    logout: () => {},
  }),
}));

function makeI18n(lng) {
  const instance = i18next.createInstance();
  instance.use(initReactI18next).init({
    lng,
    fallbackLng: lng,
    resources: { en: { translation: en }, ar: { translation: ar } },
    interpolation: { escapeValue: false },
  });
  return instance;
}

const AR = makeI18n('ar');
const EN = makeI18n('en');

function renderAt(pathname, node, i18n = AR) {
  return renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={[pathname]}>{node}</MemoryRouter>
    </I18nextProvider>
  );
}

// The badge (if any) inside the link/pill whose visible label is `label`.
function badgeIn(html, label) {
  const match = html.match(
    new RegExp(`>${label}(<span class="nav-badge"[^>]*><span class="nav-badge-count">([^<]*)</span></span>)?</a>`)
  );
  if (!match) throw new Error(`no link labelled ${label}`);
  return match[2] ?? null;
}

beforeEach(() => {
  badges.counts = {};
  badges.role = 'admin';
});

describe('NavBadge', () => {
  it('renders nothing at zero', () => {
    expect(renderAt('/', <NavBadge count={0} />)).toBe('');
    expect(renderAt('/', <NavBadge />)).toBe('');
  });

  it('shows the count, with a spoken label in Arabic and English', () => {
    const arHtml = renderAt('/', <NavBadge count={3} />, AR);
    expect(arHtml).toContain('class="nav-badge"');
    expect(arHtml).toContain('role="img"');
    expect(arHtml).toContain('aria-label="3 تحديثات جديدة"');
    expect(arHtml).toMatch(/<span class="nav-badge-count">3<\/span><\/span>$/);

    expect(renderAt('/', <NavBadge count={1} />, EN)).toContain('aria-label="1 new update"');
    expect(renderAt('/', <NavBadge count={2} />, EN)).toContain('aria-label="2 new updates"');
    expect(renderAt('/', <NavBadge count={2} />, AR)).toContain('aria-label="تحديثان جديدان"');
  });

  it('caps the visible number at 99+ but reads out the real one', () => {
    const html = renderAt('/', <NavBadge count={124} />, EN);
    expect(html).toMatch(/<span class="nav-badge-count">99\+<\/span><\/span>$/);
    expect(html).toContain('aria-label="124 new updates"');
  });
});

describe('badges on the sub-nav pills', () => {
  it('a group pill row badges only the children with something new', () => {
    badges.role = 'warehouse';
    badges.counts = { '/warehouse/advertisements': 2 };
    const html = renderAt('/warehouse/offers', <WarehouseGroupSubNav />);

    expect(badgeIn(html, 'الإعلانات')).toBe('2');
    expect(badgeIn(html, 'العروض')).toBeNull();
    expect(badgeIn(html, 'الحسومات')).toBeNull();
    // The active-pill contract WarehouseGroupSubNav.test.jsx pins still holds:
    // the label stays the first thing inside the pill.
    expect(html).toMatch(/wh-pill active[^>]*>العروض/);
  });

  it('General and Packages each show their own half', () => {
    badges.counts = { '/admin/advertisements/packages': 5 };
    const html = renderAt('/admin/advertisements/general', <AdvertisementsSubNav basePath="/admin/advertisements" variant="adm" />);
    expect(badgeIn(html, 'الإعلانات العامة')).toBeNull();
    expect(badgeIn(html, 'إعلانات على العروض')).toBe('5');
  });

  it('with nothing unread the rows render exactly as before', () => {
    const html = renderAt('/warehouse/reviews', <WarehouseGroupSubNav />);
    expect(html).not.toContain('nav-badge');
  });
});

describe('badges in the admin sidebar', () => {
  it('shows a count on each tab that has one, and none elsewhere', () => {
    badges.counts = { '/admin/offers': 4, '/admin/accounts': 2, '/admin/complaints': 150 };
    const html = renderAt('/admin/notifications', <AdminPanel />, EN);

    expect(badgeIn(html, 'Offers')).toBe('4');
    expect(badgeIn(html, 'Accounts')).toBe('2');
    expect(badgeIn(html, 'Complaints')).toBe('99+');
    for (const label of ['Dashboard', 'Products', 'Central Catalog', 'Exchange rate', 'Notifications']) {
      expect(badgeIn(html, label), label).toBeNull();
    }
  });

  it('flags the phone-width menu button only while something is unread', () => {
    badges.counts = { '/admin/offers': 1 };
    const withUpdates = renderAt('/admin/notifications', <AdminPanel />, EN);
    expect(withUpdates).toContain('nav-menu-dot');
    expect(withUpdates).toContain('aria-label="Open menu (new updates)"');

    badges.counts = {};
    const quiet = renderAt('/admin/notifications', <AdminPanel />, EN);
    expect(quiet).not.toContain('nav-menu-dot');
    expect(quiet).not.toContain('nav-badge');
    expect(quiet).toContain('aria-label="Open menu"');
  });
});

describe('badges in the warehouse sidebar', () => {
  it('a group tab shows the sum of its children', () => {
    badges.role = 'warehouse';
    badges.counts = {
      '/warehouse/orders': 3,
      '/warehouse/offers': 1,
      '/warehouse/advertisements': 6,
      '/warehouse/reviews': 1,
      '/warehouse/complaints': 1,
    };
    const html = renderAt('/warehouse/settings', <WarehousePanel />);

    expect(badgeIn(html, 'الطلبات')).toBe('3');
    expect(badgeIn(html, 'الترويج')).toBe('7');
    expect(badgeIn(html, 'الملاحظات')).toBe('2');
    for (const label of ['الكتالوج', 'المرتجعات', 'الحسابات المالية', 'الإعدادات']) {
      expect(badgeIn(html, label), label).toBeNull();
    }
    expect(html).toContain('nav-menu-dot');
  });
});
