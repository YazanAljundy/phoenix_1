import { useTranslation } from 'react-i18next';
import { formatBadgeCount } from '../realtime/unreadBadges';

// The small red count on a sidebar tab or sub-nav pill: how many things changed
// there since the operator last opened it (see realtime/unreadBadges.js).
// Renders nothing at zero, so a tab with nothing new looks exactly as before.
//
// The visible label is capped ("99+"), but screen readers get the real count.
// role="img" + aria-label is what makes that label part of the link's
// accessible name ("Orders, 3 new updates").
export function NavBadge({ count }) {
  const { t } = useTranslation();
  const label = formatBadgeCount(count);
  if (!label) return null;

  return (
    <span className="nav-badge" role="img" aria-label={t('nav.unreadBadge', { count })}>
      {/* Only the number is forced LTR ("99+", never "+99"). The badge itself
          keeps the page direction, so its logical margins still resolve to
          the correct side in Arabic. */}
      <span className="nav-badge-count">{label}</span>
    </span>
  );
}
