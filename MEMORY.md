# MEMORY.md — Project State

**Read this file first, before `PHASES.md` or any service code, at the start of
every session — regardless of which AI tool (Antigravity, Claude Code, Cursor,
etc.) is being used.** Update it last, before ending the session. This is the one
file every tool trusts to know "what's actually true right now" — code can be
half-written, but this file should always reflect the real current state.

Last updated: 2026-09-01 — Antigravity (Claude Opus 4.6 Thinking)

---

## 1. Current phase

**Active phase:** Phase 5 — Payment Integration *(Phases 0–4 complete)*
**Status:** Complete — code, docs, docker-compose, INTERVIEW_NOTES all written

## 2. Phase completion checklist

Mirrors `PHASES.md`. Mark `[x]` only when the Definition of Done in `AGENTS.md` is
fully met for everything in that phase — not just "code exists."

- [x] Phase 0 — Foundations (repo scaffold, docker-compose skeleton, gateway passthrough)
- [x] Phase 1 — Auth Service
- [x] Phase 2 — Catalog Service + Redis cache
- [x] Phase 3 — Cart Service
- [x] Phase 4 — Order + Inventory Services
- [x] Phase 5 — Payment integration
- [ ] Phase 6 — Events, deployment, docs polish
- [ ] Stretch goals (Prometheus/Grafana, circuit breaker, DLQ, read replicas)

## 3. Service status

| Service | Status | Notes |
|---|---|---|
| API Gateway | done | Express, /health, Helmet, CORS, structured JSON logging, proxies /api/auth/* → auth-service:3001, proxies /api/catalog/* → catalog-service:3002, proxies /api/cart/* → cart-service:3003, proxies /api/orders/* → order-service:3004, proxies /api/inventory/* → inventory-service:3005, proxies /api/payments/* → payment-service:3006, Dockerfile |
| Auth Service | done | Signup, login, JWT access+refresh rotation, RBAC (admin/customer), bcrypt, rate limiting (10/15min), Joi validation, /health with DB status, Sequelize+Postgres, Dockerfile |
| Catalog Service | done | Products CRUD (pagination, filtering, sorting, full-text search), Categories CRUD (auto-slug, parent nesting), MongoDB+Mongoose, Redis cache-aside (5min/30min/1hr TTLs), image upload (multer, local disk), Joi validation, JWT auth for admin routes, /health with MongoDB+Redis status, Dockerfile |
| Cart Service | done | Add/remove/update items, guest cart (x-guest-id header, 7d TTL), user cart (JWT, 30d TTL), cart merge on login, cross-service product validation (REST → catalog-service), Redis Hash data structure, optionalAuth middleware, Joi validation, /health with Redis status, Dockerfile |
| Order Service | done | Create order from cart, re-validate prices from catalog, order lifecycle (PENDING → CONFIRMED → PAID → SHIPPED → DELIVERED → CANCELLED), status transition validation, admin status update, customer cancel, POST /:id/pay (proxies to payment-service), Sequelize+Postgres, RabbitMQ publisher (order.created, order.cancelled), RabbitMQ consumer (inventory.reserved, inventory.failed), cross-service REST (cart-service, catalog-service, payment-service), JWT auth, RBAC, Joi validation, /health with Postgres+RabbitMQ status, Dockerfile |
| Inventory Service | done | Stock management (totalStock/reservedStock split), atomic reservation via SQL UPDATE WHERE, all-or-nothing reservation with Sequelize transaction, per-order Reservation tracking, stock release on cancellation, admin CRUD endpoints, RabbitMQ consumer (order.created, order.cancelled), RabbitMQ publisher (inventory.reserved, inventory.failed), JWT auth, RBAC, Joi validation, /health with Postgres+RabbitMQ status, Dockerfile |
| Payment Service | done | Stripe Checkout Sessions (sandbox/test mode), webhook signature verification, idempotent charge handling (orderId as idempotency key), payment lifecycle (PENDING → COMPLETED → REFUNDED / FAILED), session expiration handling, admin refund via Stripe API, cross-service REST (order-service for order verification + status update), internal service JWT for webhook → order update, express.raw() for webhook body, JSONB metadata for audit trail, Sequelize+Postgres, JWT auth, RBAC, Joi validation, /health with Postgres+Stripe config status, Dockerfile |
| User Service | not started | |
| Notification Service | not started | |
| Analytics Service | not started | |
| Frontend | not started | |

Status values to use: `not started`, `in progress`, `done`, `blocked`.

## 4. Decisions resolved (moved out of PRD.md § 7 "Open questions" as they're settled)

- **ORM choice: Sequelize** — most popular Node.js ORM for Postgres, easy to explain
  in interviews. Prisma was considered but Sequelize's explicit model definitions make
  the code more readable for interviewers. Resolved Phase 1.
- **Refresh token storage: SHA-256 in Postgres** — tokens hashed with SHA-256 (not bcrypt)
  because they're high-entropy random strings, not human-chosen passwords. Stored in
  Postgres (not Redis) for auditability and simpler setup. Resolved Phase 1.
- **Database-per-service init: SQL init script** — `infra/postgres/init.sql` auto-creates
  per-service databases on first Postgres boot. Mounted via docker-entrypoint-initdb.d.
  Resolved Phase 1.
- **Catalog ODM: Mongoose** — provides schema validation, middleware hooks, and population.
  Raw MongoDB driver would be faster but harder to explain and maintain. Resolved Phase 2.
- **Search strategy: MongoDB text index** — basic full-text search on name + description
  with weighted relevance scoring. No typo tolerance. Upgrade path documented as
  Elasticsearch/Atlas Search. Resolved Phase 2.
- **Image upload: local disk (dev stand-in)** — multer to `uploads/products/` with UUID
  filenames. Documented as production CDN/S3 stand-in. Docker volume for persistence.
  Resolved Phase 2.
- **Category hierarchy: single-level nesting** — optional `parentCategory` reference.
  Flat for now, extensible later. Resolved Phase 2.
- **Guest checkout: allowed** — guests can add to cart without registering. Cart persists
  7 days via `x-guest-id` header. Guest cart merges into user cart on login. Resolved
  Phase 3 (PRD.md §7 question answered: "yes, guest checkout is allowed").
- **Cart data store: Redis primary** — Redis is the source of truth for carts, not a
  cache. No backing database. Hash data structure for O(1) per-item access. Resolved
  Phase 3.
- **Cart merge strategy: user takes precedence** — on merge, user's existing items win
  over guest's for the same product. Guest-only items are added. Resolved Phase 3.
- **Cross-service communication: REST for synchronous** — cart-service validates products
  by calling catalog-service via REST (3s timeout). First real service-to-service call
  in the project. Resolved Phase 3.
- **Payment invocation: synchronous REST** — Order Service will call Payment Service via
  REST (not event-driven) because the user is waiting for payment feedback. Per the
  "spinner rule" in Technical_Specification.md §3. Resolved Phase 4 (documented in
  `docs/orders.md`).
- **RabbitMQ exchange type: topic** — allows routing-key-based filtering. More flexible
  than direct or fanout. New consumers can bind with wildcards without modifying
  publishers. Resolved Phase 4.
- **Inventory reservation pattern: atomic SQL UPDATE** — WHERE clause checks available
  stock, preventing overselling without application-level locks. Wrapped in Sequelize
  transaction for all-or-nothing across multiple items. Resolved Phase 4.
- **Payment provider: Stripe** — chosen over Razorpay for universal interviewer
  recognition, superior Node.js SDK, and test mode without KYC. Resolved Phase 5.
- **Payment integration model: Stripe Checkout Sessions** — chosen over PaymentIntents
  because card data never touches our servers (no PCI burden), Stripe handles 3D Secure,
  and it's simpler to implement and explain. Resolved Phase 5.
- **Idempotency key: orderId** — one payment per order. Unique constraint in DB prevents
  duplicates at the database level. Simpler than client-generated UUIDs. Resolved Phase 5.
- **Webhook → Order update auth: internal service JWT** — Payment Service signs a 30s
  admin JWT for the cross-service call. Production alternative: service mesh mTLS or
  OAuth2 client credentials. Resolved Phase 5.

## 5. Known issues / blockers

- **Postgres init.sql only runs on first boot.** If `pg_data` volume already exists with
  an older init.sql (before payments DB was added), the new database won't be created.
  Fix: `docker-compose down -v` to reset volumes, then `docker-compose up -d`.
- **Stripe keys required.** Payment Service starts but payment creation fails without
  valid `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` in `.env`. The health endpoint
  reports `stripe: "not_configured"` in this case.

## 6. What NOT to redo

Things already tried, decided against, or built and later reverted — so a new
agent session doesn't waste time re-litigating them.

- Phase 0 gateway uses a local stub route (`/api/catalog/ping`) instead of
  `http-proxy-middleware` because catalog-service doesn't exist yet. Replace the
  stub with a real proxy in Phase 2, don't re-debate whether to use a proxy now.
  **UPDATE Phase 2: stub removed, real proxy to catalog-service:3002 is live.**
- Gateway now uses `http-proxy-middleware` for auth, catalog, cart, orders, inventory,
  and payments. This is the pattern to follow for all future services.
- Auth service uses `sequelize.sync({ alter: true })` in dev for convenience.
  Don't switch to migrations until production deployment is a concern — sync is fine
  for the development workflow.
- Every service MUST have a `.dockerignore` that excludes `node_modules`. Without it,
  Windows-compiled native binaries (e.g. bcrypt) get copied into Alpine Linux containers
  via `COPY . .`, causing `ERR_DLOPEN_FAILED`. The Dockerfile's own `npm ci` produces
  correct Linux binaries — `.dockerignore` prevents overwriting them.
- Gateway proxy `pathRewrite` must use a function `(path) => /auth${path}`, NOT the
  regex form `{ '^/api/auth': '/auth' }`. When using `app.use('/api/auth', proxy)`,
  Express strips the mount path before the proxy sees it, so regex doesn't match.
- Catalog service auth middleware duplicates JWT verification logic from auth-service
  intentionally. Each service validates tokens independently — no shared npm library.
  This is a deliberate trade-off: slight duplication vs. coupling.
- Cache operations in CATALOG service are all wrapped in try/catch with error swallowing.
  Redis failure degrades to slower DB reads, never crashes the service. Don't add `throw`
  to cache helpers — graceful degradation is the design goal.
- Cart service uses `maxRetriesPerRequest: 3` (NOT null like catalog cache). This is
  intentional — Redis IS the primary store for cart, so errors must propagate. For
  catalog caching, errors are swallowed (cache miss = DB read). Different error handling
  for different Redis roles.
- Cart `/health` endpoint is at the root (`/health`), not at `/cart/health`. The gateway
  proxy rewrites `/api/cart/*` → `/cart/*`, so the health endpoint is only accessible
  internally (Docker healthcheck) not via gateway. This is by design — health checks
  are for infrastructure, not clients.
- `optionalAuth` middleware is cart-specific. Don't try to use `authenticate` (which
  401s on failure) for cart routes — guests need to use the cart without auth.
- RabbitMQ connection uses exponential backoff retry (5 attempts: 1s, 2s, 4s, 8s, 16s).
  Don't change to fixed delay — exponential backoff prevents thundering herd on broker
  restart.
- Order Service's `clearCart` call after order creation is fire-and-forget. If it fails,
  the cart will eventually expire via TTL. Don't make it blocking or add retry logic —
  the order is already created and that's what matters.
- Inventory reservation uses `UPDATE ... WHERE totalStock - reservedStock >= qty` (NOT
  `SELECT` then `UPDATE`). The SELECT-then-UPDATE pattern has a race condition. The
  WHERE clause provides database-level optimistic locking. Don't refactor to SELECT.
- Payment Service webhook route MUST use `express.raw({ type: 'application/json' })`
  mounted BEFORE `express.json()`. Stripe signature verification requires the raw
  Buffer body. If express.json() runs first, verification always fails. This middleware
  ordering is the #1 Stripe webhook integration bug.
- Payment Service uses `orderId` as the idempotency key, NOT a client-generated UUID.
  Don't add client-side idempotency key generation — orderId is simpler and enforces
  the "one payment per order" business rule at the database level.
- Order Service has a `POST /:id/pay` convenience route that proxies to Payment Service.
  This keeps Order Service as the orchestrator for the checkout flow. Don't move payment
  initiation to the frontend directly — the Order Service validates CONFIRMED status first.

## 7. Next recommended action

"Start Phase 6: Notification Service (email/SMS simulation via console logging),
Analytics Service (orders per period, top products), CI/CD with GitHub Actions,
deployment docs, and overall docs polish. Also consider the Frontend (React + Vite)."
