import { describe, expect, it } from 'vitest';
import { realtimeBatchMatchesOrder } from './warehouseOrderDetailRealtime';

// The bug this closes: WarehouseOrderDetailPage used to check only the LAST
// payload of a coalesced realtime batch against its own orderId. Two
// different orders' events landing in the same coalescing window meant the
// batch's last payload decided for everyone in it - so an earlier event for
// THIS order, followed by a later event for a DIFFERENT order in the same
// window, silently skipped the refresh this order's own event should have
// triggered.
describe('realtimeBatchMatchesOrder', () => {
  it('matches when the only payload is this order', () => {
    expect(realtimeBatchMatchesOrder('o1', [{ orderId: 'o1' }])).toBe(true);
  });

  it('does not match when the only payload is a different order', () => {
    expect(realtimeBatchMatchesOrder('o1', [{ orderId: 'o2' }])).toBe(false);
  });

  it('matches when THIS order is anywhere in the batch, not just last', () => {
    // The exact regression case: o1's own event fired first, a second order's
    // event coalesced into the same window and landed last.
    expect(
      realtimeBatchMatchesOrder('o1', [{ orderId: 'o1' }, { orderId: 'o2' }])
    ).toBe(true);
  });

  it('still matches when this order is last, not just first', () => {
    expect(
      realtimeBatchMatchesOrder('o1', [{ orderId: 'o3' }, { orderId: 'o1' }])
    ).toBe(true);
  });

  it('does not match a batch of several OTHER orders', () => {
    expect(
      realtimeBatchMatchesOrder('o1', [{ orderId: 'o2' }, { orderId: 'o3' }])
    ).toBe(false);
  });

  it('an empty batch never matches', () => {
    expect(realtimeBatchMatchesOrder('o1', [])).toBe(false);
  });

  it('a payload with no orderId at all is simply not a match, not a crash', () => {
    expect(realtimeBatchMatchesOrder('o1', [{}, null, undefined])).toBe(false);
  });

  it('undefined payloads (the reconnect call) always matches - the socket may have missed this order entirely', () => {
    expect(realtimeBatchMatchesOrder('o1', undefined)).toBe(true);
  });
});
