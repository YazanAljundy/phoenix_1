// Pure helpers for the Accounts page's type/status filter coupling, kept out of
// the component so they can be unit-tested without a DOM.
//
// Business rule (spec §3/§5): warehouses only ever have Active or Blocked -
// there is no pending warehouse. So when the type filter is "warehouse" the
// status filter must not offer (or hold) "pending".

export const ACCOUNT_TYPES = ['all', 'pharmacy', 'warehouse'];

const PHARMACY_STATUSES = ['all', 'active', 'pending', 'blocked'];
const WAREHOUSE_STATUSES = ['all', 'active', 'blocked'];

// The status options to show for a given account-type filter. "all" and
// "pharmacy" both include "pending" (it just naturally only matches
// pharmacies); "warehouse" drops it.
export function statusOptionsForType(type) {
  return type === 'warehouse' ? WAREHOUSE_STATUSES : PHARMACY_STATUSES;
}

// Coerce a currently-selected status to one that's valid for the given type -
// used when the type filter changes. "pending" while switching to "warehouse"
// falls back to "all"; everything else passes through.
export function coerceStatusForType(type, status) {
  return statusOptionsForType(type).includes(status) ? status : 'all';
}
