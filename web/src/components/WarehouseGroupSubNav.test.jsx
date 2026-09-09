import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import i18next from 'i18next';
import en from '../locales/en/translation.json';
import ar from '../locales/ar/translation.json';
import { WarehouseGroupSubNav } from './WarehouseGroupSubNav';
import { AdvertisementsSubNav } from './AdvertisementsSubNav';

// The group pill row is the half of the sidebar restructure that a data-only
// test cannot reach: which pills a URL produces, and which one comes up active.
// renderToStaticMarkup needs no DOM, so this runs in the project's existing
// node-environment vitest with no new tooling - see warehouseNav.test.js for
// the nav model itself.
//
// Arabic on purpose: it is the panel's default language.

const i18n = i18next.createInstance();
i18n.use(initReactI18next).init({
  lng: 'ar',
  fallbackLng: 'ar',
  resources: { en: { translation: en }, ar: { translation: ar } },
  interpolation: { escapeValue: false },
});

function renderAt(pathname, node) {
  return renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={[pathname]}>{node}</MemoryRouter>
    </I18nextProvider>
  );
}

const activePills = (html) => (html.match(/wh-pill active/g) ?? []).length;

describe('the warehouse group pill row', () => {
  it('shows the owning group\'s children, first one active on the landing URL', () => {
    const html = renderAt('/warehouse/offers', <WarehouseGroupSubNav />);
    expect(html).toContain('wh-pills wh-pills-group');
    for (const label of ['العروض', 'الإعلانات', 'الحسومات']) {
      expect(html, label).toContain(label);
    }
    expect(activePills(html)).toBe(1);
    expect(html).toMatch(/wh-pill active[^>]*>العروض/);
  });

  it('renders the right group for each grouped URL', () => {
    const cases = [
      ['/warehouse/discounts', 'الحسومات'],
      ['/warehouse/debts', 'الفواتير'],
      ['/warehouse/settlement', 'التسوية'],
      ['/warehouse/reviews', 'التقييمات'],
      ['/warehouse/complaints', 'الشكاوى'],
      // A detail URL still belongs to its parent's group.
      ['/warehouse/complaints/42', 'الشكاوى'],
    ];
    for (const [pathname, expected] of cases) {
      const html = renderAt(pathname, <WarehouseGroupSubNav />);
      expect(activePills(html), pathname).toBe(1);
      expect(html, pathname).toMatch(new RegExp(`wh-pill active[^>]*>${expected}`));
    }
  });

  // The Advertisements child points at the redirecting parent path precisely so
  // its pill survives both halves; /general alone would go dark on /packages.
  it('keeps the Advertisements pill lit across BOTH of its halves', () => {
    for (const p of ['/warehouse/advertisements/general', '/warehouse/advertisements/packages']) {
      const html = renderAt(p, <WarehouseGroupSubNav />);
      expect(activePills(html), p).toBe(1);
      expect(html, p).toMatch(/wh-pill active[^>]*>الإعلانات/);
    }
  });

  // Dropping it into an ungrouped page has to be a no-op, not an orphan row.
  it('renders nothing outside a group', () => {
    for (const p of [
      '/warehouse/orders',
      '/warehouse/products',
      '/warehouse/returns',
      '/warehouse/settings',
    ]) {
      expect(renderAt(p, <WarehouseGroupSubNav />), p).toBe('');
    }
  });
});

describe('the two stacked rows on the Advertisements pages', () => {
  it('gives only the upper row the divider-suppressing class', () => {
    const html = renderAt(
      '/warehouse/advertisements/packages',
      <div>
        <WarehouseGroupSubNav />
        <AdvertisementsSubNav basePath="/warehouse/advertisements" variant="wh" />
      </div>
    );
    expect((html.match(/wh-pills wh-pills-group/g) ?? []).length).toBe(1);
    expect((html.match(/class="wh-pills"/g) ?? []).length).toBe(1);
    // One pill lit per row, independently.
    expect(html).toMatch(/wh-pill active[^>]*>الإعلانات/);
    expect(html).toMatch(/wh-pill active[^>]*>إعلانات على العروض/);
  });

  // AdvertisementsSubNav was refactored onto the shared SubNav; the admin panel
  // renders it too and must be completely unaffected by the warehouse change.
  it('leaves the admin variant on its own classes', () => {
    const html = renderAt(
      '/admin/advertisements/general',
      <AdvertisementsSubNav basePath="/admin/advertisements" variant="adm" />
    );
    expect(html).toContain('class="adm-pills"');
    expect(html).not.toContain('wh-');
    expect(html).not.toContain('pills-group');
  });
});
