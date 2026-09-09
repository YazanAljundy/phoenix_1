const mongoose = require('mongoose');
const { ApiError } = require('./ApiError');

// Money-Flow V2. Every financial write path runs through here.
//
// The V1 codebase had no transactions at all, with the stated reason that a
// bare local `mongod` is a standalone and Mongoose transactions need a replica
// set. V2 makes the replica set a requirement instead (single-node is fine -
// see backend/docs/LOCAL_SETUP.md), so that the same code path runs in dev,
// test and production, and a half-applied money operation is impossible.

// Mongo labels the errors that are safe to retry verbatim; anything else is a
// real failure and is rethrown to the caller.
const TRANSIENT_LABEL = 'TransientTransactionError';
const UNKNOWN_COMMIT_LABEL = 'UnknownTransactionCommitResult';

// Every ledger entry $inc's its account's balance cache, so two payments (or a
// payment and a delivery) landing on the SAME pharmacy-warehouse account at
// the same moment genuinely conflict at the storage layer. MongoDB labels
// those TransientTransactionError and withTransaction retries them; that is
// the intended mechanism, not a failure.
//
// The budget therefore has to cover a realistic burst on one hot account, not
// just a single unlucky collision - a handful of writers on the same account
// resolve well inside this, and anything that does not is a genuine problem
// worth surfacing rather than retrying forever.
const MAX_ATTEMPTS = 8;

// A standalone mongod rejects the very first command of a transaction with
// this. Detected explicitly so an operator gets a fixable message instead of a
// raw driver error 40 frames deep.
function isStandaloneError(err) {
  const message = String(err && err.message);
  return (
    message.includes('Transaction numbers are only allowed on a replica set member or mongos') ||
    message.includes('Transactions are not supported')
  );
}

function standaloneError() {
  return ApiError.badRequest(
    'This deployment is running a standalone MongoDB. Financial operations require a replica set ' +
      '(single-node is fine) - see backend/docs/LOCAL_SETUP.md.',
    undefined,
    'REPLICA_SET_REQUIRED'
  );
}

// Runs `work(session)` inside one transaction and returns whatever it returns.
//
// `session.withTransaction` already retries on the two labels above, but it
// swallows the return value, so the result is captured out of the closure.
// Retries are bounded rather than unlimited: a genuinely contended document
// (two payments landing on the same account at once) settles well inside three
// attempts, and anything that doesn't is a bug worth surfacing.
async function runInTransaction(work) {
  const session = await mongoose.startSession();
  let result;
  let attempts = 0;

  try {
    await session.withTransaction(async () => {
      attempts += 1;
      if (attempts > MAX_ATTEMPTS) {
        throw ApiError.conflict(
          'This operation could not be completed because of concurrent activity. Please retry.',
          'TRANSACTION_CONTENTION'
        );
      }
      // Reset per attempt - a retried transaction must not observe a value
      // computed by the attempt that was rolled back.
      result = undefined;
      result = await work(session);
    });
  } catch (err) {
    if (isStandaloneError(err)) throw standaloneError();
    throw err;
  } finally {
    await session.endSession();
  }

  return result;
}

// True when the connected server can actually run transactions. Used by the
// boot check below and by tests that need to skip rather than fail hard.
async function supportsTransactions() {
  try {
    const info = await mongoose.connection.db.admin().command({ hello: 1 });
    return Boolean(info.setName || info.msg === 'isdbgrid');
  } catch {
    return false;
  }
}

// Called once at boot (server.js). Fails loudly rather than letting the first
// real payment be the thing that discovers the misconfiguration.
async function assertTransactionSupport() {
  const ok = await supportsTransactions();
  if (!ok) {
    throw new Error(
      'MongoDB is running as a standalone. Feniq requires a replica set (single-node is fine) ' +
        'so financial operations can be transactional. See backend/docs/LOCAL_SETUP.md.'
    );
  }
}

module.exports = {
  runInTransaction,
  supportsTransactions,
  assertTransactionSupport,
  TRANSIENT_LABEL,
  UNKNOWN_COMMIT_LABEL,
};
