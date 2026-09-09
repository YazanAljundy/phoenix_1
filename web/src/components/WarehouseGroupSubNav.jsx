import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { SubNav } from './SubNav';
import { findNavGroup } from '../utils/warehouseNav';

// The second row of the warehouse nav: the children of whichever grouped
// sidebar tab the current URL belongs to (Promotions / Financials / Feedback).
//
// Takes no props on purpose. It reads the group off the URL with the SAME
// function the sidebar uses to decide which tab is lit (findNavGroup ->
// isNavItemActive), so the two can never disagree about which group you are in,
// and a page can never be labelled with the wrong group's pills. It renders
// nothing outside a group, so dropping it into a page is always safe.
export function WarehouseGroupSubNav() {
  const { t } = useTranslation();
  const { pathname } = useLocation();

  const group = findNavGroup(pathname);
  if (!group) return null;

  return (
    <SubNav
      variant="wh"
      className="wh-pills-group"
      links={group.children.map((child) => ({ to: child.path, label: t(child.labelKey) }))}
    />
  );
}
