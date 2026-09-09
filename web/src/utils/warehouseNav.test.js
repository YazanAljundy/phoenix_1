import { describe, expect, it } from 'vitest';
import {
  WAREHOUSE_NAV,
  WAREHOUSE_NAV_GROUPS,
  findNavGroup,
  isNavItemActive,
  navItemTarget,
} from './warehouseNav';
import en from '../locales/en/translation.json';
import ar from '../locales/ar/translation.json';

// The sidebar collapsed from eleven flat tabs to seven by grouping seven of
// them under Promotions / Financials / Feedback. There is no jsdom harness in
// this project, so the contract is asserted against the pure nav model: nothing
// became unreachable, no URL moved, every group opens straight onto a real
// page, and exactly one tab lights up per URL.

// The eleven destinations the flat sidebar offered, frozen here on purpose.
// Grouping is a sidebar affordance only - it must not move, nest or drop a
// single URL, or every bookmark and deep link into the panel breaks.
const LEGACY_DESTINATIONS = [
  '/warehouse/orders',
  '/warehouse/products',
  '/warehouse/offers',
  '/warehouse/advertisements',
  '/warehouse/discounts',
  '/warehouse/debts',
  '/warehouse/settlement',
  '/warehouse/returns',
  '/warehouse/reviews',
  '/warehouse/complaints',
  '/warehouse/settings',
];

function allDestinations() {
  return WAREHOUSE_NAV.flatMap((item) =>
    item.children ? item.children.map((child) => child.path) : [item.path]
  );
}

function byId(id) {
  return WAREHOUSE_NAV.find((item) => item.id === id);
}

function label(locale, labelKey) {
  return locale.nav[labelKey.slice('nav.'.length)];
}

describe('the warehouse sidebar', () => {
  it('is seven tabs, in this order', () => {
    expect(WAREHOUSE_NAV.map((item) => item.id)).toEqual([
      'orders',
      'catalog',
      'returns',
      'promotions',
      'financials',
      'feedback',
      'settings',
    ]);
  });

  it('groups exactly three of them', () => {
    expect(WAREHOUSE_NAV_GROUPS.map((group) => group.id)).toEqual([
      'promotions',
      'financials',
      'feedback',
    ]);
  });

  it('still reaches every destination the flat sidebar offered', () => {
    const reachable = allDestinations();
    for (const path of LEGACY_DESTINATIONS) {
      expect(reachable, `no longer reachable: ${path}`).toContain(path);
    }
  });

  it('has not invented, moved or dropped a destination', () => {
    expect([...allDestinations()].sort()).toEqual([...LEGACY_DESTINATIONS].sort());
  });

  it('gives every entry a unique id', () => {
    const ids = WAREHOUSE_NAV.flatMap((item) => [
      item.id,
      ...(item.children ?? []).map((child) => child.id),
    ]);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('opening a tab', () => {
  it('lands a group on its first child - never on a landing page of its own', () => {
    for (const group of WAREHOUSE_NAV_GROUPS) {
      expect(navItemTarget(group), group.id).toBe(group.children[0].path);
      expect(navItemTarget(group), `${group.id} opens a landing page`).not.toBe(group.aliasPath);
    }
  });

  it('points an ungrouped tab at itself', () => {
    for (const item of WAREHOUSE_NAV.filter((entry) => !entry.children)) {
      expect(navItemTarget(item), item.id).toBe(item.path);
    }
  });

  // Each group also answers on its own URL, for anyone who types or links it.
  // That URL must be a redirect, not a page, or it would shadow a real screen.
  it('gives each group a distinct alias URL that is not itself a page', () => {
    const aliases = WAREHOUSE_NAV_GROUPS.map((group) => group.aliasPath);
    expect(new Set(aliases).size).toBe(aliases.length);
    for (const alias of aliases) {
      expect(allDestinations(), alias).not.toContain(alias);
    }
  });
});

describe('isNavItemActive', () => {
  it('lights a group for every one of its children', () => {
    for (const group of WAREHOUSE_NAV_GROUPS) {
      for (const child of group.children) {
        expect(isNavItemActive(child.path, group), `${group.id} <- ${child.path}`).toBe(true);
      }
    }
  });

  it('lights a group on a child detail URL', () => {
    expect(isNavItemActive('/warehouse/complaints/42', byId('feedback'))).toBe(true);
    expect(isNavItemActive('/warehouse/advertisements/general', byId('promotions'))).toBe(true);
    expect(isNavItemActive('/warehouse/advertisements/packages', byId('promotions'))).toBe(true);
  });

  // The behaviour NavLink gave the flat sidebar for free, and that the group
  // rewrite has to reproduce by hand.
  it('still lights an ungrouped tab on its detail URL', () => {
    expect(isNavItemActive('/warehouse/orders/900', byId('orders'))).toBe(true);
    expect(isNavItemActive('/warehouse/returns/7', byId('returns'))).toBe(true);
  });

  it('lights the group on its alias URL and on the legacy banners bookmark', () => {
    expect(isNavItemActive('/warehouse/promotions', byId('promotions'))).toBe(true);
    expect(isNavItemActive('/warehouse/banners', byId('promotions'))).toBe(true);
  });

  // Two lit tabs at once is the failure mode a path-prefix check invites, and
  // the one a reviewer cannot see without a browser.
  it('never lights two tabs for the same URL', () => {
    const urls = [
      ...allDestinations(),
      ...WAREHOUSE_NAV_GROUPS.map((group) => group.aliasPath),
      '/warehouse/orders/900',
      '/warehouse/returns/7',
      '/warehouse/complaints/42',
      '/warehouse/advertisements/general',
      '/warehouse/advertisements/packages',
      '/warehouse/banners',
    ];
    for (const url of urls) {
      const lit = WAREHOUSE_NAV.filter((item) => isNavItemActive(url, item)).map((i) => i.id);
      expect(lit, url).toHaveLength(1);
    }
  });

  it('lights nothing for an unknown URL', () => {
    for (const item of WAREHOUSE_NAV) {
      expect(isNavItemActive('/warehouse/nope', item), item.id).toBe(false);
    }
  });

  // A bare startsWith would also match "/warehouse/ordersomething".
  it('matches whole path segments, not string prefixes', () => {
    expect(isNavItemActive('/warehouse/ordersomething', byId('orders'))).toBe(false);
  });
});

describe('findNavGroup', () => {
  it('finds the group a grouped page belongs to', () => {
    expect(findNavGroup('/warehouse/discounts')?.id).toBe('promotions');
    expect(findNavGroup('/warehouse/advertisements/packages')?.id).toBe('promotions');
    expect(findNavGroup('/warehouse/settlement')?.id).toBe('financials');
    expect(findNavGroup('/warehouse/reviews')?.id).toBe('feedback');
  });

  // WarehouseGroupSubNav renders nothing when this is null - that is what keeps
  // an orphan pill row off the ungrouped pages.
  it('returns null on an ungrouped page', () => {
    for (const path of [
      '/warehouse/orders',
      '/warehouse/products',
      '/warehouse/returns',
      '/warehouse/settings',
    ]) {
      expect(findNavGroup(path), path).toBeNull();
    }
  });
});

describe('the labels the sidebar renders', () => {
  it('resolves every labelKey in both locales', () => {
    const keys = WAREHOUSE_NAV.flatMap((item) => [
      item.labelKey,
      ...(item.children ?? []).map((child) => child.labelKey),
    ]);
    for (const key of keys) {
      expect(typeof label(en, key), `en ${key}`).toBe('string');
      expect(typeof label(ar, key), `ar ${key}`).toBe('string');
    }
  });

  // Seven tabs that read the same are worse than eleven that do not - this is
  // the collision that merged Banners into Advertisements in the first place.
  // Arabic matters most here: it is the default language.
  it('gives no two sidebar tabs the same label, in either locale', () => {
    for (const [name, locale] of [
      ['en', en],
      ['ar', ar],
    ]) {
      const labels = WAREHOUSE_NAV.map((item) => label(locale, item.labelKey));
      expect(new Set(labels).size, `${name}: duplicate sidebar label`).toBe(labels.length);
    }
  });

  it('never labels a group the same as one of its own children', () => {
    for (const [name, locale] of [
      ['en', en],
      ['ar', ar],
    ]) {
      for (const group of WAREHOUSE_NAV_GROUPS) {
        const parent = label(locale, group.labelKey);
        for (const child of group.children) {
          expect(
            label(locale, child.labelKey),
            `${name}: ${group.id} == ${child.id}`
          ).not.toBe(parent);
        }
      }
    }
  });

  it('actually translates the three new group labels', () => {
    for (const group of WAREHOUSE_NAV_GROUPS) {
      expect(label(ar, group.labelKey), `${group.labelKey} is an English fallback`).not.toBe(
        label(en, group.labelKey)
      );
    }
  });
});
