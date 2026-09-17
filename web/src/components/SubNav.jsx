import { NavLink } from 'react-router-dom';
import { useUnreadBadges } from '../realtime/UnreadBadgesProvider';
import { NavBadge } from './NavBadge';

// One row of route-driven sub-tabs, rendered with the panel's existing pill
// styling. Extracted from AdvertisementsSubNav when the warehouse sidebar
// collapsed into groups and a second kind of sub-tab row appeared - both rows
// are the same widget, so they are the same component.
//
// Real NavLinks, not local state: every sub-tab keeps its own bookmarkable,
// refreshable URL, which is the convention both panels already follow (see the
// header comment on WarehousePanel.jsx). Active state is NavLink's own
// isActive, which matches nested paths too - that is what keeps the
// Advertisements pill lit on both /advertisements/general and /packages.
//
// `variant` picks which shell's existing pill classes to reuse - 'wh' for the
// warehouse sidebar shell, 'adm' for the admin top-tab shell. No new design
// language: these are the classes WarehouseOrdersPage and AccountsPage already
// use for their own pill rows.
//
// Each pill carries the unread badge for everything under its own URL, so every
// row built on this (group children, General/Packages) gets badges with no code
// of its own. Outside UnreadBadgesProvider every count is 0 and nothing renders.
export function SubNav({ links, variant, className }) {
  const prefix = variant === 'adm' ? 'adm' : 'wh';
  const { countUnder } = useUnreadBadges();

  return (
    <div className={`${prefix}-pills${className ? ` ${className}` : ''}`}>
      {links.map((link) => (
        <NavLink
          key={link.to}
          to={link.to}
          className={({ isActive }) => `${prefix}-pill${isActive ? ' active' : ''}`}
        >
          {link.label}
          <NavBadge count={countUnder(link.to)} />
        </NavLink>
      ))}
    </div>
  );
}
