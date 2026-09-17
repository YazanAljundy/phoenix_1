import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { onTokenChange } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useRealtime } from './RealtimeProvider';
import {
  badgeEventsFor,
  countUnder,
  markRead,
  parseUnread,
  recordEvent,
  serializeUnread,
  totalUnread,
  unreadStorageKey,
} from './unreadBadges';

const UnreadBadgesContext = createContext(null);

// Storage can be missing or throw (private mode, quota, blocked site data). The
// badges are a convenience, so every read and write is allowed to fail quietly.
function loadUnread(storageKey, role) {
  if (!storageKey) return {};
  try {
    return parseUnread(sessionStorage.getItem(storageKey), role);
  } catch {
    return {};
  }
}

function saveUnread(storageKey, state) {
  if (!storageKey) return;
  try {
    if (Object.keys(state).length === 0) sessionStorage.removeItem(storageKey);
    else sessionStorage.setItem(storageKey, serializeUnread(state));
  } catch {
    // Not persisted: the badges still work for the life of the page.
  }
}

// Owns the unread badges for whichever panel is showing. It is mounted once,
// above the panels (see App.jsx), and outlives page navigation, so it keeps
// counting while the operator is on some other tab. The pages unmount and lose
// their state on every navigation.
//
// It never fetches anything. It only listens on the shared socket through the
// same RealtimeClient.on() the pages use, so it adds no connection and no
// request. The counting rules live in unreadBadges.js.
//
// One store per account, keyed here rather than by the caller: a different
// sign-in always starts a fresh store, so it can never render - or save - the
// previous account's badges under its own storage key.
export function UnreadBadgesProvider({ children }) {
  const { user } = useAuth();
  return (
    <UnreadBadgesStore key={user?.id ?? ''} user={user}>
      {children}
    </UnreadBadgesStore>
  );
}

function UnreadBadgesStore({ user, children }) {
  const { client } = useRealtime();
  const { pathname } = useLocation();
  const role = user?.role;
  const storageKey = user?.id ? unreadStorageKey(user.id) : null;

  // Seeded from this session's storage (a browser refresh), otherwise empty.
  // Rows that already existed when the panel opened are never "new".
  const [unread, setUnread] = useState(() => loadUnread(storageKey, role));

  // The URL the operator is actually on, read when an event arrives. Updated
  // in an effect so it matches what is committed on screen.
  const pathnameRef = useRef(pathname);
  // Set once the session ends, so nothing writes the badges back after they
  // were cleared.
  const endedRef = useRef(false);

  // Opening a tab marks that tab read, and only that tab.
  useEffect(() => {
    pathnameRef.current = pathname;
    setUnread((current) => markRead(current, role, pathname));
  }, [role, pathname]);

  const eventKey = badgeEventsFor(role).join('|');

  useEffect(() => {
    if (!client || !eventKey) return undefined;
    const unsubscribes = eventKey.split('|').map((event) =>
      client.on(event, (payload, _count, payloads) => {
        const at = pathnameRef.current;
        setUnread((current) => recordEvent(current, role, event, payloads ?? [payload], at));
      })
    );
    return () => {
      for (const unsubscribe of unsubscribes) unsubscribe();
    };
  }, [client, role, eventKey]);

  useEffect(() => {
    if (!endedRef.current) saveUnread(storageKey, unread);
  }, [storageKey, unread]);

  // Sign-out (or a session the server ended) clears the token. The badges
  // belong to that session and go with it.
  useEffect(
    () =>
      onTokenChange((token) => {
        if (token) return;
        endedRef.current = true;
        try {
          if (storageKey) sessionStorage.removeItem(storageKey);
        } catch {
          // Nothing to clean up if storage is unavailable.
        }
      }),
    [storageKey]
  );

  const countUnderPath = useCallback((path) => countUnder(role, unread, path), [role, unread]);

  const value = useMemo(
    () => ({ countUnder: countUnderPath, total: totalUnread(role, unread) }),
    [countUnderPath, role, unread]
  );

  return <UnreadBadgesContext.Provider value={value}>{children}</UnreadBadgesContext.Provider>;
}

const NO_BADGES = { countUnder: () => 0, total: 0 };

// A zero-everywhere shape outside the provider (a component rendered on its
// own, as in the SubNav tests), same as useRealtime. A badge is never a reason
// for a screen to fail to render.
export function useUnreadBadges() {
  return useContext(UnreadBadgesContext) ?? NO_BADGES;
}
