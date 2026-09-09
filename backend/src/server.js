const http = require('http');
const app = require('./app');
const env = require('./config/env');
const { connectDB } = require('./config/db');
const { startScheduledRefresh } = require('./services/exchangeRate.service');
const { supportsTransactions } = require('./utils/transaction');
const { startLedgerVerifier } = require('./services/ledgerVerifier.service');
const { ensureFinancialIndexes } = require('./services/ledger.service');
const { initRealtime } = require('./realtime');

async function start() {
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
