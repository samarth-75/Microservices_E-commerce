/**
 * CommerceSphere — API Gateway
 *
 * Responsibilities (Phase 0 — minimal):
 *   1. /health endpoint (required by AGENTS.md for every service)
 *   2. Structured JSON logging with request ID
 *   3. Security headers (Helmet) and CORS
 *   4. One passthrough stub route to prove routing works
 *
 * Later phases will add:
 *   - JWT auth middleware (Phase 1)
 *   - Real proxy routes to downstream services (Phase 2+)
 *   - Rate limiting on auth endpoints (Phase 1)
 */

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

// Security headers — Helmet sets sensible defaults (X-Content-Type-Options,
// X-Frame-Options, Strict-Transport-Security, etc.)
app.use(helmet());

// CORS — allow all origins in dev; will be locked down per-environment later
app.use(cors());

// Parse JSON bodies
app.use(express.json());

// Request ID — attach a unique ID to every incoming request so logs from
// different services can be correlated for the same user action.
app.use((req, _res, next) => {
  req.id = req.headers['x-request-id'] || uuidv4();
  next();
});

// Structured JSON logging via Morgan custom format.
// Each log line is valid JSON with timestamp, method, url, status, response
// time, and the request ID for cross-service tracing.
morgan.token('req-id', (req) => req.id);
app.use(
  morgan((tokens, req, res) =>
    JSON.stringify({
      timestamp: new Date().toISOString(),
      method: tokens.method(req, res),
      url: tokens.url(req, res),
      status: Number(tokens.status(req, res)),
      responseTime: `${tokens['response-time'](req, res)}ms`,
      requestId: tokens['req-id'](req, res),
    })
  )
);

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/**
 * GET /health
 * Required by AGENTS.md for every service. Returns uptime and timestamp so
 * Docker healthchecks / monitoring can verify the process is alive.
 */
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'api-gateway',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /api/catalog/ping
 * Phase 0 stub — proves the gateway can route requests to a "service".
 * In Phase 2 this will be replaced by a real proxy to the Catalog Service.
 *
 * Why a stub instead of http-proxy-middleware right now?
 *   The Catalog Service container doesn't exist yet. A stub lets us verify
 *   the gateway's routing, logging, and middleware pipeline end-to-end
 *   without needing a downstream service running.
 */
app.get('/api/catalog/ping', (req, res) => {
  res.json({
    message: 'catalog pong',
    source: 'gateway-stub',
    requestId: req.id,
    note: 'This is a Phase 0 stub. Will proxy to catalog-service in Phase 2.',
  });
});

// ---------------------------------------------------------------------------
// 404 catch-all
// ---------------------------------------------------------------------------
app.use((_req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: 'The requested route does not exist on the API Gateway.',
  });
});

// ---------------------------------------------------------------------------
// Global error handler
// ---------------------------------------------------------------------------
app.use((err, _req, res, _next) => {
  console.error(JSON.stringify({
    timestamp: new Date().toISOString(),
    level: 'error',
    message: err.message,
    stack: err.stack,
  }));
  res.status(500).json({
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'production'
      ? 'Something went wrong'
      : err.message,
  });
});

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------
app.listen(PORT, () => {
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'info',
      message: `API Gateway listening on port ${PORT}`,
      environment: process.env.NODE_ENV || 'development',
    })
  );
});

module.exports = app; // exported for testing
