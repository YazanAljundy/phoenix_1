// What every emit carries, independent of any one service: an eventId that
// identifies THIS emit. The dashboard dedupes on it (web/src/realtime/
// realtimeClient.js), which only works if it is unique per emit and never
// derived from the entity - two real changes to one entity are otherwise
// indistinguishable, and the panel drops the later one.
//
// No database and no sockets here: the io instance is a recorder injected
// through the module's own test seam.
process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/feniq-test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-realtime-tests-p';
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert');

const {
  emitToAdmins,
  emitToWarehouse,
  EVENTS,
  ADMIN_ROOM,
  warehouseRoom,
  _setIoForTesting,
} = require('../src/realtime');

const WAREHOUSE_ID = 'a0a0a0a0a0a0a0a0a0a0a0a0';

// Records what would go on the wire: one entry per room.emit.
function recorder() {
  const sent = [];
  return {
    sent,
    to(room) {
      return {
        emit(event, payload) {
          sent.push({ room, event, payload });
        },
      };
    },
  };
}

function withIo(run) {
  const io = recorder();
  _setIoForTesting(io);
  try {
    run(io);
  } finally {
    _setIoForTesting(null);
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

test('every emit carries an eventId, an emittedAt and the caller payload', () => {
  withIo((io) => {
    emitToAdmins(EVENTS.OFFER_PENDING, { offerId: 'of-1', warehouseId: WAREHOUSE_ID });

    assert.strictEqual(io.sent.length, 1);
    const { room, event, payload } = io.sent[0];
    assert.strictEqual(room, ADMIN_ROOM);
    assert.strictEqual(event, EVENTS.OFFER_PENDING);
    // The service's own fields are untouched.
    assert.strictEqual(payload.offerId, 'of-1');
    assert.strictEqual(payload.warehouseId, WAREHOUSE_ID);
    assert.strictEqual(payload.eventType, EVENTS.OFFER_PENDING);
    assert.match(payload.eventId, UUID);
    assert.strictEqual(Number.isNaN(Date.parse(payload.emittedAt)), false);
  });
});

test('two emits that look identical get different eventIds', () => {
  withIo((io) => {
    // The exact case that used to be swallowed: a second edit re-queues an
    // already-approved offer, so the same payload is announced twice.
    const payload = { offerId: 'of-1', warehouseId: WAREHOUSE_ID };
    emitToAdmins(EVENTS.OFFER_PENDING, payload);
    emitToAdmins(EVENTS.OFFER_PENDING, payload);

    assert.strictEqual(io.sent.length, 2);
    assert.notStrictEqual(io.sent[0].payload.eventId, io.sent[1].payload.eventId);
  });
});

test('the caller payload object is never mutated, so a reused object stays clean', () => {
  withIo(() => {
    // adminOffer.service.js builds ONE payload and sends it to both rooms.
    const payload = { offerId: 'of-1', warehouseId: WAREHOUSE_ID, status: 'approved' };
    emitToAdmins(EVENTS.OFFER_STATUS_UPDATED, payload);

    assert.deepStrictEqual(payload, {
      offerId: 'of-1',
      warehouseId: WAREHOUSE_ID,
      status: 'approved',
    });
  });
});

test('the same change sent to two rooms carries an id per emit', () => {
  withIo((io) => {
    const payload = { offerId: 'of-1', warehouseId: WAREHOUSE_ID, status: 'approved' };
    emitToAdmins(EVENTS.OFFER_STATUS_UPDATED, payload);
    emitToWarehouse(WAREHOUSE_ID, EVENTS.OFFER_STATUS_UPDATED, payload);

    assert.deepStrictEqual(
      io.sent.map((e) => e.room),
      [ADMIN_ROOM, warehouseRoom(WAREHOUSE_ID)]
    );
    // No client is ever in both rooms (resolveRoomsFor), and a socket only
    // needs to recognise a re-delivery of its own emit - so two ids here is
    // correct, not a duplicate signal.
    assert.notStrictEqual(io.sent[0].payload.eventId, io.sent[1].payload.eventId);
  });
});

test('ids stay unique across a burst of events of every kind', () => {
  withIo((io) => {
    const cases = [
      [EVENTS.ACCOUNT_STATUS_UPDATED, { userId: 'u-1', role: 'pharmacy', status: 'blocked' }],
      [EVENTS.ACCOUNT_STATUS_UPDATED, { userId: 'u-1', role: 'pharmacy', status: 'active' }],
      [EVENTS.ACCOUNT_STATUS_UPDATED, { userId: 'u-1', role: 'pharmacy', status: 'blocked' }],
      [EVENTS.ADVERTISEMENT_AVAILABILITY_UPDATED, { advertisementId: 'a-1', isAvailable: false }],
      [EVENTS.ADVERTISEMENT_AVAILABILITY_UPDATED, { advertisementId: 'a-1', isAvailable: true }],
      [EVENTS.ADVERTISEMENT_AVAILABILITY_UPDATED, { advertisementId: 'a-1', isAvailable: false }],
      [EVENTS.COMPLAINT_UPDATED, { complaintId: 'c-1', complaintNumber: 3, status: 'in_review' }],
      [EVENTS.COMPLAINT_UPDATED, { complaintId: 'c-1', complaintNumber: 3, status: 'in_review' }],
    ];
    for (const [event, payload] of cases) emitToAdmins(event, payload);

    const ids = io.sent.map((e) => e.payload.eventId);
    assert.strictEqual(ids.length, cases.length);
    assert.strictEqual(new Set(ids).size, cases.length, 'block/unblock/pause/answer repeats must differ');
  });
});

test('a missing io or room still emits nothing and throws nothing', () => {
  _setIoForTesting(null);
  assert.doesNotThrow(() => emitToAdmins(EVENTS.OFFER_PENDING, { offerId: 'of-1' }));

  withIo((io) => {
    // A general complaint has no warehouse: emitToWarehouse(null, ...) is a
    // guarded no-op, and must not become an emit with a stamped id.
    emitToWarehouse(null, EVENTS.COMPLAINT_CREATED, { complaintId: 'c-1' });
    assert.strictEqual(io.sent.length, 0);
  });
});
