import { describe, expect, it } from 'vitest';
import { createIdempotencyKeys, newIdempotencyKey, paymentRequestFingerprint } from './payments';

// The panel used to mint a fresh idempotency key inside every submit, so a
// retry after a lost response reached the server under a NEW key and the
// payment was recorded twice. These tests drive the forms' key store
// (createIdempotencyKeys - what AddPaymentForm, RecordPaymentModal and
// ReversePaymentModal submit through) against a stand-in for the server that
// follows payment.service.js's contract:
//
//   known key, same request  -> replay the payment it recorded
//   known key, other request -> 409 IDEMPOTENCY_KEY_REUSED
//   new key                  -> record a new payment
//
// "Reopening the form" is a new store: each form creates its store once per
// mount (useState), and closing the form unmounts it. There is no DOM renderer
// in this node-environment suite, so the component wiring itself is not
// mounted here.

function fakePaymentServer() {
  const byKey = new Map();
  const payments = [];
  let loseNextResponse = false;
  let failNextBeforeRecording = false;

  return {
    payments,
    // The payment is recorded, but the response never reaches the panel.
    loseNextResponse() {
      loseNextResponse = true;
    },
    // The request never reaches the server at all.
    failNextBeforeRecording() {
      failNextBeforeRecording = true;
    },
    async createPayment({ idempotencyKey, ...body }) {
      if (failNextBeforeRecording) {
        failNextBeforeRecording = false;
        throw new TypeError('Failed to fetch');
      }
      const fingerprint = paymentRequestFingerprint(body);
      const existing = byKey.get(idempotencyKey);
      let response;
      if (existing) {
        if (existing.fingerprint !== fingerprint) {
          throw Object.assign(new Error('already submitted with different details'), {
            status: 409,
            code: 'IDEMPOTENCY_KEY_REUSED',
          });
        }
        response = { payment: existing.payment, replay: true };
      } else {
        const payment = { id: `pay-${payments.length + 1}`, ...body };
        payments.push(payment);
        byKey.set(idempotencyKey, { fingerprint, payment });
        response = { payment, replay: false };
      }
      if (loseNextResponse) {
        loseNextResponse = false;
        throw new TypeError('Failed to fetch');
      }
      return response;
    },
  };
}

// What AddPaymentForm builds from its fields.
function paymentBody(overrides = {}) {
  return {
    pharmacyId: 'ph-1',
    amount: 30000,
    currency: 'SYP',
    method: 'cash',
    reference: 'TX-1',
    note: undefined,
    ...overrides,
  };
}

// One submit, exactly as the forms do it. Resolves to the server's response,
// or to the error the form would show.
function submit(keys, server, body) {
  return keys
    .submit(body, (idempotencyKey) => server.createPayment({ ...body, idempotencyKey }))
    .catch((error) => ({ error }));
}

// Counts mints, so a test can say how many distinct keys were handed out.
function countingMint() {
  let count = 0;
  const mint = () => `key-${(count += 1)}`;
  mint.count = () => count;
  return mint;
}

describe('a payment retried after a network failure', () => {
  it('is recorded once when the first response was lost', async () => {
    const server = fakePaymentServer();
    const keys = createIdempotencyKeys();
    const body = paymentBody();

    server.loseNextResponse();
    const first = await submit(keys, server, body);
    expect(first.error).toBeInstanceOf(TypeError);
    expect(server.payments).toHaveLength(1); // it did reach the server

    const retry = await submit(keys, server, body);

    expect(retry.replay).toBe(true);
    expect(retry.payment.id).toBe('pay-1');
    expect(server.payments).toHaveLength(1);
  });

  it('is recorded once when the first attempt never reached the server', async () => {
    const server = fakePaymentServer();
    const keys = createIdempotencyKeys();

    server.failNextBeforeRecording();
    await submit(keys, server, paymentBody());
    const retry = await submit(keys, server, paymentBody());

    expect(retry.replay).toBe(false);
    expect(server.payments).toHaveLength(1);
  });

  it('keeps one key across any number of attempts', () => {
    const mint = countingMint();
    const keys = createIdempotencyKeys(mint);

    const first = keys.keyFor(paymentBody());
    expect(keys.keyFor(paymentBody())).toBe(first);
    expect(keys.keyFor(paymentBody())).toBe(first);
    expect(mint.count()).toBe(1);
  });
});

describe('changing the payment between attempts', () => {
  const changes = {
    amount: { amount: 45000 },
    currency: { currency: 'USD', amount: 3 },
    method: { method: 'bank_transfer' },
    reference: { reference: 'TX-2' },
    note: { note: 'front desk' },
    pharmacy: { pharmacyId: 'ph-2' },
  };

  for (const [field, change] of Object.entries(changes)) {
    it(`a changed ${field} gets a new key and is accepted as a separate payment`, async () => {
      const server = fakePaymentServer();
      const keys = createIdempotencyKeys();

      server.loseNextResponse();
      await submit(keys, server, paymentBody());
      const firstKey = keys.keyFor(paymentBody());

      const changed = paymentBody(change);
      expect(keys.keyFor(changed)).not.toBe(firstKey);

      const response = await submit(keys, server, changed);

      expect(response.error).toBeUndefined();
      expect(response.replay).toBe(false);
      expect(server.payments).toHaveLength(2);
      expect(server.payments[1]).toMatchObject(change);
    });
  }

  it('going back to details already tried reuses their key, so nothing is duplicated', async () => {
    const server = fakePaymentServer();
    const keys = createIdempotencyKeys();

    server.loseNextResponse();
    await submit(keys, server, paymentBody({ amount: 30000 })); // recorded, response lost
    server.failNextBeforeRecording();
    await submit(keys, server, paymentBody({ amount: 35000 })); // typo, never arrived

    const backToFirst = await submit(keys, server, paymentBody({ amount: 30000 }));

    expect(backToFirst.replay).toBe(true);
    expect(server.payments).toHaveLength(1);
  });
});

describe('when a new key is minted', () => {
  it('after a success, the same details are a new payment', async () => {
    const server = fakePaymentServer();
    const keys = createIdempotencyKeys();

    const first = await submit(keys, server, paymentBody());
    const second = await submit(keys, server, paymentBody());

    expect(first.replay).toBe(false);
    expect(second.replay).toBe(false);
    expect(server.payments).toHaveLength(2);
  });

  it('reopening the form (a new store) gets a new key for the same details', () => {
    const firstOpening = createIdempotencyKeys();
    const key = firstOpening.keyFor(paymentBody());

    const secondOpening = createIdempotencyKeys();

    expect(secondOpening.keyFor(paymentBody())).not.toBe(key);
    expect(firstOpening.keyFor(paymentBody())).toBe(key);
  });

  it('after IDEMPOTENCY_KEY_REUSED, the next attempt carries a fresh key', async () => {
    const mint = countingMint();
    const keys = createIdempotencyKeys(mint);
    const body = paymentBody();
    const refusal = Object.assign(new Error('reused'), { code: 'IDEMPOTENCY_KEY_REUSED' });

    const sent = [];
    const outcome = await keys
      .submit(body, async (idempotencyKey) => {
        sent.push(idempotencyKey);
        throw refusal;
      })
      .catch((error) => error);
    expect(outcome).toBe(refusal);

    await keys.submit(body, async (idempotencyKey) => sent.push(idempotencyKey));

    expect(sent).toEqual(['key-1', 'key-2']);
  });

  it('any other failure keeps the key for the retry', async () => {
    const keys = createIdempotencyKeys(countingMint());
    const body = paymentBody();

    const sent = [];
    await keys
      .submit(body, async (idempotencyKey) => {
        sent.push(idempotencyKey);
        throw Object.assign(new Error('Exchange rate is not available yet'), { code: 'EXCHANGE_RATE_UNAVAILABLE' });
      })
      .catch(() => {});
    await keys.submit(body, async (idempotencyKey) => sent.push(idempotencyKey));

    expect(sent).toEqual(['key-1', 'key-1']);
  });

  it('submit hands back what the request resolved to', async () => {
    const keys = createIdempotencyKeys();
    await expect(keys.submit(paymentBody(), async () => 'recorded')).resolves.toBe('recorded');
  });
});

describe('reversing a payment', () => {
  // What ReversePaymentModal builds: the payment being reversed and the reason.
  it('keeps the key for the same reversal and mints one for a different reason', () => {
    const keys = createIdempotencyKeys();
    const key = keys.keyFor({ paymentId: 'pay-1', reason: 'entered twice' });

    expect(keys.keyFor({ paymentId: 'pay-1', reason: 'entered twice' })).toBe(key);
    expect(keys.keyFor({ paymentId: 'pay-1', reason: 'wrong pharmacy' })).not.toBe(key);
  });
});

describe('paymentRequestFingerprint', () => {
  it('ignores key order and undefined fields - neither changes what is sent', () => {
    expect(paymentRequestFingerprint({ amount: 1, currency: 'SYP', note: undefined })).toBe(
      paymentRequestFingerprint({ currency: 'SYP', amount: 1 })
    );
  });

  it('tells apart every value that is sent', () => {
    const base = paymentRequestFingerprint(paymentBody());
    expect(paymentRequestFingerprint(paymentBody({ amount: 30001 }))).not.toBe(base);
    expect(paymentRequestFingerprint(paymentBody({ note: '' }))).not.toBe(base);
    expect(paymentRequestFingerprint(paymentBody({ reference: undefined }))).not.toBe(base);
  });
});

describe('newIdempotencyKey', () => {
  it('mints a different key every call', () => {
    expect(newIdempotencyKey()).not.toBe(newIdempotencyKey());
  });
});
