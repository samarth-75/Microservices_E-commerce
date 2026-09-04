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
 * Phase 0: stub route (/api/catalog/ping) — removed in Phase 2.
 * Phase 1: proxy to auth-service at /api/auth/*
 * Phase 2: proxy to catalog-service at /api/catalog/*
 * Phase 3: proxy to cart-service at /api/cart/*
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
const CATALOG_SERVICE_URL = process.env.CATALOG_SERVICE_URL || 'http://catalog-service:3002';
const CART_SERVICE_URL = process.env.CART_SERVICE_URL || 'http://cart-service:3003';
const ORDER_SERVICE_URL = process.env.ORDER_SERVICE_URL || 'http://order-service:3004';
const INVENTORY_SERVICE_URL = process.env.INVENTORY_SERVICE_URL || 'http://inventory-service:3005';
const PAYMENT_SERVICE_URL = process.env.PAYMENT_SERVICE_URL || 'http://payment-service:3006';

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

/**
 * /api/catalog/* → Catalog Service
 *
 * All catalog requests (products, categories, search) are proxied to the
 * catalog-service container. The gateway strips /api/catalog and forwards
 * to /catalog.
 *
 * Same pattern as the auth proxy — pathRewrite uses a function because
 * Express strips the mount path before the proxy sees it.
 */
app.use(
  '/api/catalog',
  createProxyMiddleware({
    target: CATALOG_SERVICE_URL,
    changeOrigin: true,
    pathRewrite: (path) => `/catalog${path}`,
    on: {
      proxyReq: (proxyReq, req) => {
        proxyReq.setHeader('x-request-id', req.id);
      },
    },
  })
);

/**
 * /api/cart/* → Cart Service
 *
 * Cart requests (add/remove items, get cart, merge) are proxied to the
 * cart-service container. Gateway passes through both JWT and x-guest-id
 * headers so the cart service can resolve the cart identity.
 */
app.use(
  '/api/cart',
  createProxyMiddleware({
    target: CART_SERVICE_URL,
    changeOrigin: true,
    pathRewrite: (path) => `/cart${path}`,
    on: {
      proxyReq: (proxyReq, req) => {
        proxyReq.setHeader('x-request-id', req.id);
      },
    },
  })
);

/**
 * /api/orders/* → Order Service
 *
 * Order requests (create, list, get, status update, cancel) are proxied to
 * the order-service container. Requires JWT authentication (handled by
 * order-service, not the gateway).
 */
app.use(
  '/api/orders',
  createProxyMiddleware({
    target: ORDER_SERVICE_URL,
    changeOrigin: true,
    pathRewrite: (path) => `/orders${path}`,
    on: {
      proxyReq: (proxyReq, req) => {
        proxyReq.setHeader('x-request-id', req.id);
      },
    },
  })
);

/**
 * /api/inventory/* → Inventory Service
 *
 * Inventory management requests (admin-only: set/get/update stock levels)
 * are proxied to the inventory-service container.
 */
app.use(
  '/api/inventory',
  createProxyMiddleware({
    target: INVENTORY_SERVICE_URL,
    changeOrigin: true,
    pathRewrite: (path) => `/inventory${path}`,
    on: {
      proxyReq: (proxyReq, req) => {
        proxyReq.setHeader('x-request-id', req.id);
      },
    },
  })
);

/**
 * /api/payments/* → Payment Service
 *
 * Payment requests (create Stripe session, webhook, get payment, refund)
 * are proxied to the payment-service container.
 *
 * IMPORTANT: The webhook route (/api/payments/webhook) receives raw body
 * from Stripe. The gateway proxy passes the body through as-is because
 * express.json() is mounted AFTER proxies. The payment-service handles
 * express.raw() internally for the webhook route.
 */
app.use(
  '/api/payments',
  createProxyMiddleware({
    target: PAYMENT_SERVICE_URL,
    changeOrigin: true,
    pathRewrite: (path) => `/payments${path}`,
    on: {
      proxyReq: (proxyReq, req) => {
        proxyReq.setHeader('x-request-id', req.id);
      },
    },
  })
);

/**
 * /api/analytics/* → Analytics Service
 *
 * Admin-only analytics endpoints (order summary, daily breakdown, top products).
 * Notification Service is a pure consumer — no REST API, no proxy needed.
 */
const ANALYTICS_SERVICE_URL = process.env.ANALYTICS_SERVICE_URL || 'http://analytics-service:3008';

app.use(
  '/api/analytics',
  createProxyMiddleware({
    target: ANALYTICS_SERVICE_URL,
    changeOrigin: true,
    pathRewrite: (path) => `/analytics${path}`,
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

// Phase 0 stub route (/api/catalog/ping) has been removed.
// Catalog requests are now proxied to the real catalog-service (Phase 2).

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
