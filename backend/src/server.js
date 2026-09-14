const http = require('http');
const app = require('./app');
const env = require('./config/env');
const { connectDB } = require('./config/db');
const { startScheduledRefresh } = require('./services/exchangeRate.service');
const { supportsTransactions } = require('./utils/transaction');
const { startLedgerVerifier } = require('./services/ledgerVerifier.service');
const { ensureFinancialIndexes } = require('./services/ledger.service');
const { initRealtime } = require('./realtime');

// Audit L-5. Two behaviours branch on NODE_ENV and both get LOOSER when it is
// not 'production':
//   - errorHandler.js returns the raw internal message on a 500 instead of a
//     generic one, so a stack-level detail reaches the client;
//   - app.js (and realtime/index.js) accept any localhost origin for CORS
//     instead of the configured allowlist.
// Neither is wrong in development - they are there precisely to make local work
// possible. The failure mode is a real deployment where NODE_ENV was simply
// never set, which looks completely normal until one of those two matters.
//
// Warns rather than exits, per the same reasoning as the replica-set check
// below: refusing to boot a server that is otherwise healthy is the more
// damaging of the two outcomes. The heuristic is deliberately conservative -
// a local mongod on the default port is the overwhelmingly common dev setup,
// and anything else paired with a non-production NODE_ENV is worth a shout.
function warnIfProductionLikeButNotProduction() {
  if (env.nodeEnv === 'production') return;

  const uri = env.mongodbUri || '';
  const looksLocal = /(localhost|127\.0\.0\.1|0\.0\.0\.0)/.test(uri);
  if (looksLocal) return;

  // eslint-disable-next-line no-console
  console.warn(
    [
      '',
      '*** NODE_ENV is not "production" but MONGODB_URI points at a remote',
      `*** database (NODE_ENV=${env.nodeEnv}). While this holds:`,
      '***   - internal 500 error messages are returned to clients verbatim',
      '***   - CORS accepts any localhost origin instead of CORS_ORIGINS',
      '*** Set NODE_ENV=production on any real deployment.',
      '',
    ].join('\n')
  );
}

async function start() {
  warnIfProductionLikeButNotProduction();

  try {
    await connectDB();
    // eslint-disable-next-line no-console
    console.log('MongoDB connected.');

    // Money-Flow V2 runs every financial write inside a transaction, which
    // needs a replica set (single-node is fine). Checked once, at boot, so a
    // misconfigured deployment is obvious immediately rather than at the first
    // payment. Non-financial routes still work, so this warns rather than
    // exits - but it warns loudly.
    if (await supportsTransactions()) {
      // Built before the first request rather than lazily under one - see
      // ledger.service.js's ensureFinancialIndexes.
      await ensureFinancialIndexes();
      startLedgerVerifier();
    } else {
      // eslint-disable-next-line no-console
      console.error(
        [
          '',
          '*** MongoDB is a STANDALONE. Financial operations (delivery, payments,',
          '*** returns) will fail with REPLICA_SET_REQUIRED until a replica set',
          '*** is enabled. See backend/docs/LOCAL_SETUP.md.',
          '',
        ].join('\n')
      );
    }

    startScheduledRefresh();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('MongoDB connection failed. Starting server anyway (DB-dependent routes will fail).');
    // eslint-disable-next-line no-console
    console.error(err.message);
  }

  // The Express app is wrapped in an explicit http.Server (instead of
  // app.listen's implicit one) purely so Socket.IO can attach to that same
  // server - one process, one port, one listener. Every existing route,
  // middleware and health check is served exactly as before.
  const server = http.createServer(app);
  initRealtime(server);

  server.listen(env.port, () => {
    // eslint-disable-next-line no-console
    console.log(`Feniq API listening on port ${env.port} (${env.nodeEnv})`);
  });
}

start();
