import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

// The two halves of the Advertisements tab, shared by both panels.
//
// They were separate sidebar tabs until they collided: `banners` and
// `advertisements` both render as "الإعلانات" in Arabic, so the sidebar showed
// the same label twice with no way to tell them apart. They are now one tab
// with these two sub-sections:
//
//   General  -> the single-product image ads (Banner)
//   Packages -> the multi-product bundles with a package price (Advertisement)
//
// Real NavLinks, not local state: each sub-section keeps its own bookmarkable,
// refreshable URL, which is the convention the panels already follow (see the
// header comment on WarehousePanel.jsx).
//
// `variant` picks which shell's existing pill styling to reuse - 'wh' for the
// warehouse sidebar shell, 'adm' for the admin top-tab shell. No new design
// language: these are the same classes WarehouseOrdersPage and AccountsPage
// already use for their own pill rows.
export function AdvertisementsSubNav({ basePath, variant }) {
  const { t } = useTranslation();
  const prefix = variant === 'adm' ? 'adm' : 'wh';

  const links = [
    { to: `${basePath}/general`, label: t('nav.advertisementsGeneral') },
    { to: `${basePath}/packages`, label: t('nav.advertisementsPackages') },
  ];

  return (
    <div className={`${prefix}-pills`}>
      {links.map((link) => (
        <NavLink
          key={link.to}
          to={link.to}
          className={({ isActive }) => `${prefix}-pill${isActive ? ' active' : ''}`}
        >
          {link.label}
        </NavLink>
      ))}
    </div>
  );
}
