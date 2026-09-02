import { describe, expect, it } from 'vitest';
import { ACCOUNT_TYPES, coerceStatusForType, statusOptionsForType } from './accountsFilters';

// Pure logic behind the Accounts page's type/status filter coupling - the one
// business rule that has to hold no matter what the component does: a warehouse
// is only ever Active or Blocked, never Pending (spec §3/§5).

describe('statusOptionsForType', () => {
  it('offers pending for pharmacies and for "all"', () => {
    expect(statusOptionsForType('pharmacy')).toEqual(['all', 'active', 'pending', 'blocked']);
    expect(statusOptionsForType('all')).toEqual(['all', 'active', 'pending', 'blocked']);
  });

  it('never offers pending for warehouses', () => {
    const options = statusOptionsForType('warehouse');
    expect(options).toEqual(['all', 'active', 'blocked']);
    expect(options).not.toContain('pending');
  });
});

describe('coerceStatusForType', () => {
  it('drops pending back to "all" when switching to warehouse', () => {
    expect(coerceStatusForType('warehouse', 'pending')).toBe('all');
  });

  it('keeps a still-valid status when the type changes', () => {
    expect(coerceStatusForType('warehouse', 'blocked')).toBe('blocked');
    expect(coerceStatusForType('warehouse', 'active')).toBe('active');
    expect(coerceStatusForType('pharmacy', 'pending')).toBe('pending');
    expect(coerceStatusForType('all', 'blocked')).toBe('blocked');
  });
});

describe('ACCOUNT_TYPES', () => {
  it('is exactly all / pharmacy / warehouse', () => {
    expect(ACCOUNT_TYPES).toEqual(['all', 'pharmacy', 'warehouse']);
  });
});
