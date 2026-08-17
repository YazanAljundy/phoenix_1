const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const mongoSanitize = require('express-mongo-sanitize');

const env = require('./config/env');
const routes = require('./routes');
const { apiLimiter } = require('./middlewares/rateLimiter');
const { notFoundHandler, errorHandler } = require('./middlewares/errorHandler');

const app = express();

// In dev, Vite's port shifts (5173, 5174, ...) whenever the default is
// already taken - a fixed CORS_ORIGINS allowlist just breaks the panel every
// time that happens, with no real security benefit on a local-only backend.
// Production keeps the strict env-configured allowlist.
function resolveCorsOrigin() {
  if (env.nodeEnv === 'production') {
    return env.corsOrigins.length > 0 ? env.corsOrigins : false;
  }
  return (origin, callback) => {
    if (!origin || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
      return callback(null, true);
    }
    return callback(new Error('Not allowed by CORS'));
  };
}
app.use(helmet());
app.use(
  cors({
    origin: resolveCorsOrigin(),
    credentials: true,
  })
);
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(mongoSanitize());
if (env.nodeEnv !== 'test') {
  app.use(morgan(env.nodeEnv === 'production' ? 'combined' : 'dev'));
}
app.use(apiLimiter);

// Verification photos need to load cross-origin into the Flutter web app and
// React admin panel (different ports in dev, different origins in
// production) - helmet's default same-origin CORP would silently block that.
app.use(
  '/uploads',
  (req, res, next) => {
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    next();
  },
  express.static(path.join(__dirname, '../uploads'))
);

app.use('/api', routes);

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
