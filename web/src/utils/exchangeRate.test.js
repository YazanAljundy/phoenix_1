import { describe, expect, it, vi } from 'vitest';
import {
  applyRateFromAdminResponse,
  formatRate,
  isRateChangedError,
  submitWithRateCheck,
  withRateUsed,
} from './exchangeRate';

// The panel converted SYP to USD at a rate loaded once per session, and saved
// the result with no check, so a rate that moved (the daily refresh, an admin's
// change) was silently baked into prices, limits and package totals. Writes
// now carry `rateUsed`, the server refuses a stale one with RATE_CHANGED, and
// the forms (ProductFormModal, AdvertisementFormModal, WarehouseSettingsPage)
// all send through submitWithRateCheck - which is what these tests drive. There
// is no DOM renderer in this node-environment suite, so the forms themselves
// are not mounted here.

function rateChangedError(details) {
  return Object.assign(new Error('The exchange rate changed'), {
    status: 409,
    code: 'RATE_CHANGED',
    details,
  });
}

function fakeActions(refreshedRate = null) {
  return {
    applyServerRate: vi.fn(),
    refresh: vi.fn(async () => refreshedRate),
  };
}

describe('submitWithRateCheck', () => {
  it('sends once and hands back the result when the rate is current', async () => {
    const actions = fakeActions();
    const send = vi.fn(async () => ({ product: { id: 'p1' } }));

    const outcome = await submitWithRateCheck(send, { rateUsed: 130, actions });

    expect(send).toHaveBeenCalledTimes(1);
    expect(outcome).toEqual({ result: { product: { id: 'p1' } }, rateChange: null });
    expect(actions.applyServerRate).not.toHaveBeenCalled();
    expect(actions.refresh).not.toHaveBeenCalled();
  });

  it('does not resend after RATE_CHANGED, and moves the panel to the server rate', async () => {
    const actions = fakeActions();
    const send = vi.fn(async () => {
      throw rateChangedError({ rateUsed: 130, currentUsdToSyp: 135.5 });
    });

    const outcome = await submitWithRateCheck(send, { rateUsed: 130, actions });

    expect(send).toHaveBeenCalledTimes(1);
    expect(outcome).toEqual({ result: null, rateChange: { from: 130, to: 135.5 } });
    expect(actions.applyServerRate).toHaveBeenCalledWith(135.5);
    expect(actions.refresh).not.toHaveBeenCalled();
  });

  it('re-reads the rate when the refusal does not carry it', async () => {
    const actions = fakeActions(140);
    const send = vi.fn(async () => {
      throw rateChangedError(undefined);
    });

    const outcome = await submitWithRateCheck(send, { rateUsed: 130, actions });

    expect(send).toHaveBeenCalledTimes(1);
    expect(actions.refresh).toHaveBeenCalledTimes(1);
    expect(actions.applyServerRate).not.toHaveBeenCalled();
    expect(outcome.rateChange).toEqual({ from: 130, to: 140 });
  });

  it('still reports the change when the rate cannot be re-read', async () => {
    const outcome = await submitWithRateCheck(
      async () => {
        throw rateChangedError({});
      },
      { rateUsed: 130, actions: fakeActions(null) }
    );

    expect(outcome).toEqual({ result: null, rateChange: { from: 130, to: null } });
  });

  it('rethrows every other error untouched', async () => {
    const actions = fakeActions();
    const failure = Object.assign(new Error('Invalid price.'), { code: 'INVALID_PRICE' });

    await expect(
      submitWithRateCheck(
        async () => {
          throw failure;
        },
        { rateUsed: 130, actions }
      )
    ).rejects.toBe(failure);
    expect(actions.applyServerRate).not.toHaveBeenCalled();
  });

  it('works without the rate actions (outside the provider)', async () => {
    const outcome = await submitWithRateCheck(async () => {
      throw rateChangedError({ rateUsed: 130, currentUsdToSyp: 131 });
    });

    expect(outcome.rateChange).toEqual({ from: 130, to: 131 });
  });

  // The whole round trip: a form opened at one rate, an admin changes it, the
  // save is refused, and only the user's own second save goes through - at
  // the new rate.
  it('a save pending at an old rate is refused, and only an explicit second save sends again', async () => {
    const server = { usdToSyp: 130 };
    const panel = { usdToSyp: 130 };
    const actions = {
      applyServerRate: (rate) => {
        panel.usdToSyp = rate;
      },
      refresh: async () => server.usdToSyp,
    };
    const sent = [];
    const save = (priceSyp) => {
      const rateUsed = panel.usdToSyp;
      const body = withRateUsed({ priceUsd: Math.round((priceSyp / rateUsed) * 100) / 100 }, rateUsed);
      return submitWithRateCheck(
        async () => {
          sent.push(body);
          if (body.rateUsed !== server.usdToSyp) {
            throw rateChangedError({ rateUsed: body.rateUsed, currentUsdToSyp: server.usdToSyp });
          }
          return { saved: body };
        },
        { rateUsed, actions }
      );
    };

    // The admin moves the rate while the form is open.
    server.usdToSyp = 150;

    const refused = await save(1300);
    expect(refused.rateChange).toEqual({ from: 130, to: 150 });
    expect(sent).toEqual([{ priceUsd: 10, rateUsed: 130 }]);
    expect(panel.usdToSyp).toBe(150);

    // Nothing more is sent until the user confirms; then it goes at 150.
    const confirmed = await save(1300);
    expect(confirmed.rateChange).toBeNull();
    expect(sent).toEqual([
      { priceUsd: 10, rateUsed: 130 },
      { priceUsd: 8.67, rateUsed: 150 },
    ]);
  });
});

// The admin who changes the rate is the one whose own panel used to miss it:
// their next converted save carried the old rate and came back refused. The
// admin endpoints answer with the rate now in effect, so the tab can adopt it
// from a response it already has.
describe('applyRateFromAdminResponse', () => {
  it('moves the panel onto the rate the response reports', () => {
    const actions = fakeActions();

    const applied = applyRateFromAdminResponse(actions, {
      exchangeRate: { usdToSyp: 13500, source: 'manual', manualOverride: true },
    });

    expect(applied).toBe(13500);
    expect(actions.applyServerRate).toHaveBeenCalledWith(13500);
    expect(actions.refresh).not.toHaveBeenCalled();
  });

  it('takes the server figure, which after "back to automatic" is nobody\'s input', () => {
    const actions = fakeActions();

    // The admin typed nothing here; the provider's own rate came back.
    const applied = applyRateFromAdminResponse(actions, {
      exchangeRate: { usdToSyp: 13712.5, source: 'api', manualOverride: false },
    });

    expect(applied).toBe(13712.5);
    expect(actions.applyServerRate).toHaveBeenCalledWith(13712.5);
  });

  it('ignores a payload with no usable rate', () => {
    const actions = fakeActions();

    // No rate has ever been set; a malformed or empty answer.
    expect(applyRateFromAdminResponse(actions, { exchangeRate: { usdToSyp: null } })).toBeNull();
    expect(applyRateFromAdminResponse(actions, { exchangeRate: { usdToSyp: 0 } })).toBeNull();
    expect(applyRateFromAdminResponse(actions, { exchangeRate: { usdToSyp: -5 } })).toBeNull();
    expect(applyRateFromAdminResponse(actions, { exchangeRate: {} })).toBeNull();
    expect(applyRateFromAdminResponse(actions, {})).toBeNull();
    expect(applyRateFromAdminResponse(actions, null)).toBeNull();

    expect(actions.applyServerRate).not.toHaveBeenCalled();
  });

  it('works without the rate actions (outside the provider)', () => {
    expect(() =>
      applyRateFromAdminResponse(null, { exchangeRate: { usdToSyp: 13500 } })
    ).not.toThrow();
    expect(applyRateFromAdminResponse(null, { exchangeRate: { usdToSyp: 13500 } })).toBe(13500);
  });
});

describe('the helpers', () => {
  it('isRateChangedError recognises only RATE_CHANGED', () => {
    expect(isRateChangedError(rateChangedError({}))).toBe(true);
    expect(isRateChangedError({ code: 'PRICE_CHANGED' })).toBe(false);
    expect(isRateChangedError(null)).toBe(false);
  });

  it('withRateUsed adds the rate only when something was converted', () => {
    const body = { priceUsd: 10 };
    expect(withRateUsed(body, 130)).toEqual({ priceUsd: 10, rateUsed: 130 });
    expect(withRateUsed(body, null)).toBe(body);
    expect(withRateUsed(body, undefined)).toBe(body);
    // The body itself is left alone.
    expect(body).toEqual({ priceUsd: 10 });
  });

  it('formatRate keeps a rate\'s decimals and groups its thousands', () => {
    expect(formatRate(130.4567, 'SYP')).toBe('130.4567 SYP');
    expect(formatRate(13000, 'ل.س')).toBe('13,000 ل.س');
    // Two rates that round to the same whole lira still read differently.
    expect(formatRate(130.25, 'SYP')).not.toBe(formatRate(130.75, 'SYP'));
    expect(formatRate(null, 'SYP')).toBe('—');
    expect(formatRate(0, 'SYP')).toBe('—');
  });
});
