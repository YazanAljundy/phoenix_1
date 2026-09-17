// The warehouse sidebar, as data. Which tabs exist, which of them are groups,
// which URL each one opens, and which URLs light each one up.
//
// Kept out of WarehousePanel.jsx and out of JSX entirely so it can be
// unit-tested without a DOM - there is no jsdom harness in this project. Lives
// in utils/ rather than pages/ because components/WarehouseGroupSubNav.jsx
// reads it, and nothing in components/ imports from pages/.
//
// Labels are i18n KEYS, not text: the components resolve them with t(), so this
// module stays pure and language-agnostic.
//
// The sidebar used to be eleven flat tabs. Seven of them now sit under three
// group tabs - but ONLY in the sidebar. Every URL stayed exactly where it was:
// a group is an affordance, never a path prefix, so no bookmark or deep link
// breaks. That is what warehouseNav.test.js pins.

export const WAREHOUSE_NAV = [
  { id: 'orders', labelKey: 'nav.orders', path: '/warehouse/orders' },
  { id: 'catalog', labelKey: 'nav.catalog', path: '/warehouse/products' },
  // Deliberately standalone rather than folded into Orders or Promotions: it is
  // an action queue that needs quick access, not a browsing screen.
  { id: 'returns', labelKey: 'nav.returns', path: '/warehouse/returns' },
  {
    id: 'promotions',
    labelKey: 'nav.promotions',
    // Served by a redirect Route, for a typed or externally-linked URL only -
    // the sidebar itself links straight at the first child (see navItemTarget),
    // so opening a group never costs a second click or shows a landing page.
    aliasPath: '/warehouse/promotions',
    // Pre-merge bookmark. It already redirects into /advertisements; listing it
    // here just keeps the sidebar lit during the redirecting render.
    legacyPaths: ['/warehouse/banners'],
    children: [
      { id: 'offers', labelKey: 'nav.offers', path: '/warehouse/offers' },
      // /advertisements redirects to /advertisements/general. Pointing the pill
      // at the PARENT is deliberate: NavLink matches nested paths, so one pill
      // stays lit across both halves. /general alone would go dark on /packages.
      { id: 'advertisements', labelKey: 'nav.advertisements', path: '/warehouse/advertisements' },
      { id: 'discounts', labelKey: 'nav.discounts', path: '/warehouse/discounts' },
    ],
  },
  {
    id: 'financials',
    labelKey: 'nav.financials',
    aliasPath: '/warehouse/financials',
    children: [
      { id: 'debts', labelKey: 'nav.debts', path: '/warehouse/debts' },
      { id: 'settlement', labelKey: 'nav.settlement', path: '/warehouse/settlement' },
    ],
  },
  {
    id: 'feedback',
    labelKey: 'nav.feedback',
    aliasPath: '/warehouse/feedback',
    children: [
      { id: 'reviews', labelKey: 'nav.reviews', path: '/warehouse/reviews' },
      { id: 'complaints', labelKey: 'nav.complaints', path: '/warehouse/complaints' },
    ],
  },
  { id: 'settings', labelKey: 'nav.settings', path: '/warehouse/settings' },
];

export const WAREHOUSE_NAV_GROUPS = WAREHOUSE_NAV.filter((item) => Boolean(item.children));

// Whole-segment prefix match, the same rule NavLink uses without `end`: it has
// to cover the detail routes (/orders/:id, /returns/:id, /complaints/:id,
// /advertisements/general) without also matching "/warehouse/ordersomething".
// Also the rule realtime/unreadBadges.js uses for both panels' badges.
export function isUnder(pathname, path) {
  return pathname === path || pathname.startsWith(`${path}/`);
}

// Where clicking the tab goes. A group opens its FIRST child directly - there
// is no group landing page to land on.
export function navItemTarget(item) {
  return item.children ? item.children[0].path : item.path;
}

// Every URL that should light this tab up.
export function navItemMatchPaths(item) {
  if (!item.children) return [item.path];
  return [item.aliasPath, ...(item.legacyPaths ?? []), ...item.children.map((c) => c.path)];
}

// NavLink's own isActive cannot do this: a group's children kept their original
// flat URLs, so they share no path prefix with each other or with the parent.
export function isNavItemActive(pathname, item) {
  return navItemMatchPaths(item).some((path) => isUnder(pathname, path));
}

// Which group (if any) the current URL belongs to. Drives WarehouseGroupSubNav,
// so the pill row and the sidebar highlight come from the same function and can
// never disagree about which group you are in.
export function findNavGroup(pathname) {
  return WAREHOUSE_NAV.find((item) => item.children && isNavItemActive(pathname, item)) ?? null;
}
