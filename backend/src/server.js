const app = require('./app');
const env = require('./config/env');
const { connectDB } = require('./config/db');

async function start() {
  try {
    await connectDB();
    // eslint-disable-next-line no-console
    console.log('MongoDB connected.');
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('MongoDB connection failed. Starting server anyway (DB-dependent routes will fail).');
    // eslint-disable-next-line no-console
    console.error(err.message);
  }

  app.listen(env.port, () => {
    // eslint-disable-next-line no-console
    console.log(`Phoenix API listening on port ${env.port} (${env.nodeEnv})`);
  });
}

start();
