const http = require('http');
const app = require('./app');
const env = require('./config/env');
const { connectDB } = require('./config/db');
const { startScheduledRefresh } = require('./services/exchangeRate.service');
const { initRealtime } = require('./realtime');

async function start() {
  try {
    await connectDB();
    // eslint-disable-next-line no-console
    console.log('MongoDB connected.');
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
    console.log(`Phoenix API listening on port ${env.port} (${env.nodeEnv})`);
  });
}

start();
