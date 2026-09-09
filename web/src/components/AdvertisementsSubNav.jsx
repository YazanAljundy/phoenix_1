import { useTranslation } from 'react-i18next';
import { SubNav } from './SubNav';

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
//
// The row itself is SubNav, which this was the original of - on the warehouse
// side it now sits under a second sub-nav (Advertisements is a child of the
// Promotions group tab), and both rows are the same widget.
export function AdvertisementsSubNav({ basePath, variant }) {
  const { t } = useTranslation();

  return (
    <SubNav
      variant={variant}
      links={[
        { to: `${basePath}/general`, label: t('nav.advertisementsGeneral') },
        { to: `${basePath}/packages`, label: t('nav.advertisementsPackages') },
      ]}
    />
  );
}
