const { randomUUID } = require('crypto');

/**
 * Centralized error handler.
 *
 * Recognizes common error patterns and maps them to correct HTTP status codes.
 * Always includes a requestId in the response so errors can be correlated with logs.
 */

// Map known Supabase/Postgres error codes to HTTP statuses
const PG_CODE_MAP = {
  '23505': 409, // unique_violation
  '23503': 409, // foreign_key_violation
  '23502': 400, // not_null_violation
  '42501': 403, // insufficient_privilege
  'PGRST301': 401, // JWT expired
  'PGRST302': 401, // JWT invalid
};

function resolveStatus(err) {
  // Already has a status set explicitly (e.g. from route logic)
  if (err.status && typeof err.status === 'number') return err.status;
  if (err.statusCode && typeof err.statusCode === 'number') return err.statusCode;

  const msg = (err.message || '').toLowerCase();

  // Supabase/PostgREST error codes
  if (err.code && PG_CODE_MAP[err.code]) return PG_CODE_MAP[err.code];

  // Auth errors
  if (msg.includes('jwt') || msg.includes('unauthorized') || msg.includes('not authenticated')) return 401;
  if (msg.includes('forbidden') || msg.includes('permission denied')) return 403;

  // Rate limit
  if (msg.includes('rate limit') || msg.includes('too many')) return 429;

  // Client errors
  if (msg.includes('not found')) return 404;
  if (msg.includes('invalid') || msg.includes('required') || msg.includes('must be')) return 400;

  return 500;
}

module.exports = function errorHandler(err, req, res, _next) {
  const requestId = req.requestId || randomUUID().slice(0, 8);
  const status = resolveStatus(err);

  // Log at appropriate level
  if (status >= 500) {
    console.error(`❌ [${requestId}] ${req.method} ${req.originalUrl} → ${status}`, err);
  } else {
    console.warn(`⚠️ [${requestId}] ${req.method} ${req.originalUrl} → ${status}: ${err.message}`);
  }

  res.status(status).json({
    error: err.message || 'Server error',
    requestId,
    ...(status === 429 && { retryAfter: 60 }),
  });
};
