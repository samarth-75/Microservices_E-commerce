/**
 * CommerceSphere — API Gateway
 *
 * Responsibilities:
 *   1. /health endpoint (required by AGENTS.md for every service)
 *   2. Structured JSON logging with request ID
 *   3. Security headers (Helmet) and CORS
 *   4. Proxy routes to downstream services
 *   5. JWT auth middleware for protected routes (available for Phase 2+)
 *
 * Phase 0 stub route (/api/catalog/ping) is kept until catalog-service exists.
 * Phase 1 adds: proxy to auth-service at /api/auth/*
 *
 * IMPORTANT: Proxy routes are registered BEFORE express.json() body parsing.
 * http-proxy-middleware needs the raw request stream — if express.json() runs
 * first, it consumes the stream and the proxy forwards an empty body.
 */

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const { v4: uuidv4 } = require('uuid');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();
const PORT = process.env.PORT || 3000;

// Service URLs — resolved via Docker Compose service names
const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL || 'http://auth-service:3001';

// ---------------------------------------------------------------------------
// Pre-proxy middleware (must run before proxies AND before body parsing)
// ---------------------------------------------------------------------------

// Security headers
app.use(helmet());

// CORS
app.use(cors());

// Trust proxy — needed for correct IP detection behind Docker networking
app.set('trust proxy', 1);

// Request ID — attach a unique ID to every incoming request so logs from
// different services can be correlated for the same user action.
app.use((req, _res, next) => {
  req.id = req.headers['x-request-id'] || uuidv4();
  req.headers['x-request-id'] = req.id; // ensure downstream services receive it
  next();
});

// Structured JSON logging via Morgan custom format.
morgan.token('req-id', (req) => req.id);
app.use(
  morgan((tokens, req, res) =>
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'info',
      service: 'api-gateway',
      method: tokens.method(req, res),
      url: tokens.url(req, res),
      status: Number(tokens.status(req, res)),
      responseTime: `${tokens['response-time'](req, res)}ms`,
      requestId: tokens['req-id'](req, res),
    })
  )
);

// ---------------------------------------------------------------------------
// Service Proxies — BEFORE express.json() to preserve raw request streams
// ---------------------------------------------------------------------------

/**
 * /api/auth/* → Auth Service
 *
 * All auth requests (signup, login, refresh, logout, me) are proxied to the
 * auth-service container. The gateway strips /api/auth and forwards to /auth.
 *
 * Why proxy instead of duplicating auth logic in the gateway?
 *   - Single responsibility: the gateway routes, the auth service authenticates.
 *   - Independent deployment: auth-service can be scaled/updated independently.
 *   - Database-per-service: only auth-service touches the auth Postgres schema.
 */
app.use(
  '/api/auth',
  createProxyMiddleware({
    target: AUTH_SERVICE_URL,
    changeOrigin: true,
    // Express strips the mount path '/api/auth' before the proxy sees it,
    // so the proxy receives just '/signup', '/login', etc. We prepend '/auth'
    // to match the auth-service's internal route mounting (app.use('/auth', ...)).
    pathRewrite: (path) => `/auth${path}`,
    on: {
      proxyReq: (proxyReq, req) => {
        proxyReq.setHeader('x-request-id', req.id);
      },
    },
  })
);

// ---------------------------------------------------------------------------
// Body parsing — AFTER proxies (proxied routes don't need gateway-side parsing)
// ---------------------------------------------------------------------------
app.use(express.json());

// ---------------------------------------------------------------------------
// Gateway-local routes (these DO need the parsed body)
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
    service: 'api-gateway',
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
      service: 'api-gateway',
      message: `API Gateway listening on port ${PORT}`,
      environment: process.env.NODE_ENV || 'development',
    })
  );
});

module.exports = app; // exported for testing
