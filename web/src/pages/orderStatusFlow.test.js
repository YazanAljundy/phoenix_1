import { describe, expect, it, vi } from 'vitest';
import {
  CONFIRMED_ADVANCE_FROM_STATUS,
  mayAdvance,
  shouldConfirmAdvance,
} from './orderStatusFlow';
import en from '../locales/en/translation.json';
import ar from '../locales/ar/translation.json';

// Advancing an order's status used to prompt on every single step. Now exactly
// one does. These tests pin both halves of that: that the four cheap
// transitions never reach a dialog at all, and that the one expensive one
// still cannot happen without a yes.
//
// The panel has no jsdom/testing-library harness, so the click itself isn't
// simulated here - the decision the click makes is, which is the whole of what
// changed. `confirm` is injected, so "no dialog appeared" is assertable as
// "the confirm function was never called", not merely inferred from a return
// value.

// The forward sequence the panel offers a button for (ADVANCE_KEYS in
// WarehouseOrderDetailPage / WarehouseOrdersPage). 'delivered' and 'cancelled'
// are terminal and get no advance button at all.
const ADVANCEABLE_STATUSES = ['pending', 'confirmed', 'preparing', 'out_for_delivery'];
const UNPROMPTED_STATUSES = ADVANCEABLE_STATUSES.filter((s) => s !== CONFIRMED_ADVANCE_FROM_STATUS);

describe('which advances still ask first', () => {
  it('only asks when leaving preparing', () => {
    expect(shouldConfirmAdvance('preparing')).toBe(true);
    for (const status of UNPROMPTED_STATUSES) {
      expect(shouldConfirmAdvance(status)).toBe(false);
    }
  });

  it('is the preparing -> out_for_delivery step that is guarded', () => {
    // Documents the intent behind the from-status check: the guarded step is
    // the shipment leaving the warehouse.
    expect(CONFIRMED_ADVANCE_FROM_STATUS).toBe('preparing');
  });

  it('asks nothing for a terminal or unknown status', () => {
    for (const status of ['delivered', 'cancelled', '', undefined]) {
      expect(shouldConfirmAdvance(status)).toBe(false);
    }
  });
});

describe('advancing from a status that no longer prompts', () => {
  it.each(UNPROMPTED_STATUSES)('applies immediately from %s, with no dialog', (status) => {
    const confirm = vi.fn(() => {
      throw new Error('a dialog must never be raised for this transition');
    });

    expect(mayAdvance(status, { confirm })).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
  });

  it('does not prompt even if the operator would have said no', () => {
    // The point of the change: there is no longer a decision to make here, so
    // a confirm that would return false is simply never consulted.
    const confirm = vi.fn(() => false);

    expect(mayAdvance('confirmed', { confirm })).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
  });
});

describe('advancing out of preparing', () => {
  it('still asks, and applies once confirmed', () => {
    const confirm = vi.fn(() => true);

    expect(mayAdvance('preparing', { confirm })).toBe(true);
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it('applies nothing when the operator declines', () => {
    const confirm = vi.fn(() => false);

    expect(mayAdvance('preparing', { confirm })).toBe(false);
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it('treats a dismissed dialog as a no', () => {
    // window.confirm returns false on dismiss, but the coercion is what keeps
    // an undefined/null from a future dialog implementation from reading as
    // consent.
    for (const dismissed of [undefined, null, false, '']) {
      expect(mayAdvance('preparing', { confirm: () => dismissed })).toBe(false);
    }
  });

  it('asks exactly once per advance, not once per render', () => {
    const confirm = vi.fn(() => true);
    mayAdvance('preparing', { confirm });
    expect(confirm).toHaveBeenCalledTimes(1);
  });
});

// Same l10n contract the locales/*.test.js files pin for their own features:
// every key this flow renders exists in both languages, with its placeholder
// intact. The success line replaced a dialog, so a missing key here would mean
// the operator gets no acknowledgement at all.
describe('the status-advance translations', () => {
  const nonEmpty = (v) => typeof v === 'string' && v.trim().length > 0;

  it.each(['confirmAdvance', 'statusAdvanced'])('%s exists in both locales', (key) => {
    expect(nonEmpty(en.orderDetail[key]), `en.orderDetail.${key}`).toBe(true);
    expect(nonEmpty(ar.orderDetail[key]), `ar.orderDetail.${key}`).toBe(true);
    expect(ar.orderDetail[key], `ar.orderDetail.${key} is not the EN fallback`).not.toBe(
      en.orderDetail[key]
    );
  });

  it('keeps the placeholders the components interpolate', () => {
    // confirmAdvance is unchanged - the retained dialog keeps its exact copy.
    for (const locale of [en, ar]) {
      expect(locale.orderDetail.confirmAdvance).toContain('{{action}}');
      expect(locale.orderDetail.statusAdvanced).toContain('{{status}}');
    }
  });

  it('still labels every advanceable status, since the success line names one', () => {
    for (const key of ['statusPending', 'statusConfirmed', 'statusPreparing', 'statusOutForDelivery', 'statusDelivered']) {
      expect(nonEmpty(en.orders[key]), `en.orders.${key}`).toBe(true);
      expect(nonEmpty(ar.orders[key]), `ar.orders.${key}`).toBe(true);
    }
  });
});
