const env = require('../config/env');

function notFoundHandler(req, res, next) {
  next({ statusCode: 404, message: `Route not found: ${req.method} ${req.originalUrl}` });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const statusCode = err.statusCode || 500;
  const message = statusCode === 500 && env.nodeEnv === 'production'
    ? 'Something went wrong. Please try again.'
    : err.message || 'Something went wrong. Please try again.';

  if (statusCode === 500) {
    // eslint-disable-next-line no-console
    console.error(err);
  }

  res.status(statusCode).json({
    success: false,
    message,
    // Only ApiError sets a meaningful `code` - guard with isApiError so an
    // unrelated `.code` property on a generic/library error (e.g. MongoDB's
    // numeric duplicate-key code) never leaks through as if it were one of
    // ours.
    code: err.isApiError ? err.code || null : null,
    details: err.details,
  });
}

module.exports = { notFoundHandler, errorHandler };
